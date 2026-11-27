// Responses SSE can split JSON and UTF-8 at any byte boundary.
export async function readResponseStream(response, onText, signal, onThought = null) {
  if (!response.body) throw new Error('The reply stream is unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', text = '', completed, thoughtSeq = 0;
  const reasonings = new Map();
  const getReasoning = id => {
    const key = String(id || `resp-think-${++thoughtSeq}`);
    let entry = reasonings.get(key);
    if (!entry) { entry = { id: key, parts: [], startedAt: Date.now() }; reasonings.set(key, entry); }
    return entry;
  };
  function event(block) {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const value = JSON.parse(data);
    if (onThought) {
      if (value.type === 'response.output_item.added' && value.item?.type === 'reasoning') {
        const entry = getReasoning(value.item.id);
        onThought({ id: entry.id, text: '', status: 'running', kind: 'thinking' });
      } else if (value.type === 'response.reasoning_summary_part.added') {
        const entry = getReasoning(value.item_id);
        const idx = Number(value.summary_index) || 0;
        if (entry.parts[idx] === undefined) entry.parts[idx] = '';
      } else if (value.type === 'response.reasoning_summary_text.delta') {
        const entry = getReasoning(value.item_id);
        const idx = Number(value.summary_index) || 0;
        entry.parts[idx] = (entry.parts[idx] || '') + (value.delta || '');
        onThought({ id: entry.id, text: entry.parts.filter(Boolean).join('\n\n'), status: 'running', kind: 'thinking' });
      } else if (value.type === 'response.output_item.done' && value.item?.type === 'reasoning') {
        const entry = getReasoning(value.item.id);
        const summary = Array.isArray(value.item.summary) && value.item.summary.length
          ? value.item.summary.map(part => typeof part === 'string' ? part : part?.text || '').filter(Boolean).join('\n\n')
          : entry.parts.filter(Boolean).join('\n\n');
        onThought({ id: entry.id, text: summary.trim(), status: 'done', kind: 'thinking', durationMs: Date.now() - entry.startedAt });
        reasonings.delete(entry.id);
      }
    }
    if (value.type === 'response.output_text.delta') {
      text += value.delta || '';
      if (text.length > 24000) throw new Error('Reply exceeded the text limit.');
      onText(text);
    }
    if (['error', 'response.failed', 'response.incomplete'].includes(value.type)) throw new Error('The reply stream did not complete. Please try again.');
    if (value.type === 'response.completed') completed = value.response;
  }
  try {
    while (true) {
      signal?.throwIfAborted();
      const {value, done} = await reader.read();
      pending = (pending + decoder.decode(value, {stream: !done})).replace(/\r\n/g, '\n');
      if (pending.length > 1024 * 1024) throw new Error('Reply stream event is too large.');
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) { event(pending.slice(0, boundary)); pending = pending.slice(boundary + 2); }
      if (done) break;
    }
    if (pending.trim()) event(pending);
    if (onThought) {
      for (const entry of reasonings.values()) onThought({ id: entry.id, text: entry.parts.filter(Boolean).join('\n\n').trim(), status: 'done', kind: 'thinking', durationMs: Date.now() - entry.startedAt });
      reasonings.clear();
    }
    signal?.throwIfAborted();
    if (!completed || completed.status !== 'completed') throw new Error('The reply stream ended early. Please try again.');
    return completed;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Chat Completions SSE (OpenAI/DeepSeek)
export async function readChatStream(response, onText, signal, onThought = null) {
  if (!response.body) throw new Error('The reply stream is unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', text = '', usage, reasoning = '', reasoningStarted = 0, reasoningDone = false;
  const finishReasoning = () => {
    if (!onThought || reasoningDone || !reasoningStarted) return;
    reasoningDone = true;
    onThought({ id: 'chat-think-1', text: reasoning.trim(), status: 'done', kind: 'thinking', durationMs: Date.now() - reasoningStarted });
  };
  function event(block) {
    const lines = block.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const value = JSON.parse(data);
        const delta = value.choices?.[0]?.delta;
        if (onThought && delta?.reasoning_content) {
          reasoningStarted ||= Date.now();
          reasoning += delta.reasoning_content;
          onThought({ id: 'chat-think-1', text: reasoning, status: 'running', kind: 'thinking' });
        }
        if (delta?.content) {
          finishReasoning();
          text += delta.content;
          if (text.length > 24000) throw new Error('Reply exceeded the text limit.');
          onText?.(text);
        }
        if (value.usage) usage = value.usage;
      } catch (err) {
        if (err.message?.includes('limit')) throw err;
      }
    }
  }
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      pending = (pending + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n');
      if (pending.length > 1024 * 1024) throw new Error('Reply stream event is too large.');
      let boundary;
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        event(pending.slice(0, boundary));
        pending = pending.slice(boundary + 2);
      }
      if (done) break;
    }
    if (pending.trim()) event(pending);
    finishReasoning();
    signal?.throwIfAborted();
    return { text, usage };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
