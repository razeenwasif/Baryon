// Hybrid AI provider router for Baryon Web:
// 1. Demo Studio (zero-config streaming engine with multi-model /fanout + interactive artifacts)
// 2. BYOK Direct Browser Streaming: Gemini, OpenAI, Claude, DeepSeek, Custom OpenAI-compatible
// 3. Paired Baryon Mac Host (/v1/overview, /v1/send, /v1/chat)

export type EngineId = 'demo' | 'gemini' | 'openai' | 'claude' | 'deepseek' | 'custom' | 'mac';
export type EffortLevel = 'low' | 'medium' | 'high';

export interface EngineInfo {
  id: EngineId;
  label: string;
  badge: string;
  note: string;
}

export interface ModelOption {
  id: string;
  label: string;
  tag: string;
}

export interface ProviderSettings {
  engine: EngineId | string;
  model: string;
  effort: EffortLevel | string;
  fanoutModels?: string[];
  geminiKey: string;
  openaiKey: string;
  claudeKey: string;
  deepseekKey: string;
  customUrl: string;
  customKey: string;
  customModel: string;
  macUrl: string;
  macToken: string;
  speakReplies?: boolean;
  systemPrompt: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type CompletionMeta = {
  elapsedMs: number;
  approxTokens: number;
  tokPerSec: number;
};

export interface StreamCompletionOptions {
  settings: ProviderSettings;
  history: ChatMessage[];
  model?: string;
  fanout?: boolean;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
}

export interface StreamCompletionResult {
  text: string;
  engine: EngineId;
  model: string;
  meta: CompletionMeta;
}

export interface MacHostOverview {
  name?: string;
  [key: string]: unknown;
}

interface GeminiSseEvent {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

interface OpenAISseEvent {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
}

interface ClaudeSseEvent {
  type?: string;
  delta?: {
    text?: string;
  };
}

export const ENGINES: readonly EngineInfo[] = [
  { id: 'demo', label: 'Demo Studio (Instant)', badge: 'No key needed', note: 'Streams multi-model /fanout comparisons, live HTML/SVG artifacts, and branching demos immediately.' },
  { id: 'gemini', label: 'Gemini API (BYOK)', badge: 'Google AI', note: 'Direct browser SSE via generativelanguage.googleapis.com using your API key.' },
  { id: 'openai', label: 'OpenAI API (BYOK)', badge: 'GPT / o-series', note: 'Direct browser SSE via api.openai.com using your API key.' },
  { id: 'claude', label: 'Anthropic Claude (BYOK)', badge: 'Claude API', note: 'Direct browser SSE via api.anthropic.com with direct-browser header.' },
  { id: 'deepseek', label: 'DeepSeek API (BYOK)', badge: 'DeepSeek V3/R1', note: 'Direct browser SSE via api.deepseek.com using your API key.' },
  { id: 'custom', label: 'Custom OpenAI-Compatible', badge: 'Local / Proxy', note: 'Connect LM Studio, Ollama, OpenRouter, or a LiteLLM proxy URL.' },
  { id: 'mac', label: 'Baryon Mac Host', badge: 'Tailscale / LAN', note: 'Connect directly to your Mac Baryon instance (/v1/overview & /v1/send) with paired token.' },
];

export const MODELS_BY_ENGINE: Record<EngineId, ModelOption[]> = {
  demo: [
    { id: 'baryon-stratus', label: 'Baryon Stratus Auto', tag: 'Adaptive' },
    { id: 'gemini-neon', label: 'Gemini 4 Neon', tag: 'Fast · Multimodal' },
    { id: 'claude-fable', label: 'Claude Fable 5.1', tag: 'Architect' },
    { id: 'gpt-astra', label: 'GPT-6 Astra', tag: 'Reasoning' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tag: 'Fast' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tag: 'Deep' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tag: 'Classic' },
  ],
  openai: [
    { id: 'gpt-4.1', label: 'GPT-4.1', tag: 'Flagship' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', tag: 'Fast' },
    { id: 'o4-mini', label: 'o4-mini', tag: 'Reasoning' },
  ],
  claude: [
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', tag: 'Balanced' },
    { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1', tag: 'Deep' },
    { id: 'claude-3-5-haiku-20241022', label: 'Claude Haiku 3.5', tag: 'Fast' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek V3', tag: 'General' },
    { id: 'deepseek-reasoner', label: 'DeepSeek R1', tag: 'Reasoning' },
  ],
  custom: [{ id: 'custom-model', label: 'Configured Model', tag: 'Custom' }],
  mac: [{ id: 'auto', label: 'Baryon Mac Auto', tag: 'Desktop Router' }],
};

export function modelLabel(modelId?: string | null): string {
  for (const list of Object.values(MODELS_BY_ENGINE)) {
    const found = list.find(m => m.id === modelId);
    if (found) return found.label;
  }
  return modelId || 'Baryon Auto';
}

export function resolveEffectiveEngine(settings?: Partial<ProviderSettings> | null): EngineId {
  const chosen = settings?.engine || 'demo';
  if (chosen === 'gemini' && settings?.geminiKey) return 'gemini';
  if (chosen === 'openai' && settings?.openaiKey) return 'openai';
  if (chosen === 'claude' && settings?.claudeKey) return 'claude';
  if (chosen === 'deepseek' && settings?.deepseekKey) return 'deepseek';
  if (chosen === 'custom' && settings?.customUrl) return 'custom';
  if (chosen === 'mac' && settings?.macUrl && settings?.macToken) return 'mac';
  return 'demo';
}

function demoInteractiveArtifact(topic: string): string {
  return `Here is a **live Stratus-themed interactive widget** you can inspect and interact with right inside Baryon Web's Artifact Drawer (click **Run Artifact ↗** if it isn't open already):

\`\`\`html
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; font-family: Inter, -apple-system, sans-serif; }
  body { margin: 0; min-height: 100vh; background: #050507; color: #f4f4f6; display: grid; place-items: center; padding: 20px; }
  .card { width: min(440px, 100%); background: #0b0b0e; border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 20px; }
  h2 { margin: 0 0 4px; font-size: 16px; }
  p { margin: 0 0 16px; color: #8e8e99; font-size: 12.5px; }
  .bars { display: grid; gap: 10px; margin-bottom: 16px; }
  .row { display: grid; grid-template-columns: 94px 1fr 48px; align-items: center; gap: 10px; font-size: 12px; }
  .track { height: 8px; border-radius: 999px; background: #141418; overflow: hidden; }
  .fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #18b8cc, #3e5aec); transition: width .35s ease; }
  .controls { display: flex; gap: 8px; }
  button { flex: 1; height: 34px; border-radius: 10px; border: 1px solid rgba(255,255,255,.1); background: #111114; color: #f4f4f6; font-size: 12px; font-weight: 500; cursor: pointer; }
  button.primary { background: #3e5aec; border-color: rgba(159,178,255,.4); }
</style>
</head>
<body>
  <div class="card">
    <h2>Baryon Signal Telemetry</h2>
    <p>Interactive artifact · ${topic.replace(/[<>&]/g, '').slice(0, 48)}</p>
    <div class="bars" id="bars"></div>
    <div class="controls">
      <button class="primary" onclick="pulse()">Simulate Burst</button>
      <button onclick="reset()">Reset Baseline</button>
    </div>
  </div>
  <script>
    const metrics = [
      { name: 'Throughput', val: 78 },
      { name: 'Cache Hit', val: 92 },
      { name: 'Branch Depth', val: 64 },
      { name: 'Coherence', val: 89 }
    ];
    function draw() {
      document.getElementById('bars').innerHTML = metrics.map(m =>
        '<div class="row"><span>' + m.name + '</span><div class="track"><div class="fill" style="width:' + m.val + '%"></div></div><span>' + m.val + '%</span></div>'
      ).join('');
    }
    function pulse() { metrics.forEach(m => m.val = Math.min(99, Math.max(32, Math.round(m.val + (Math.random() * 28 - 12))))); draw(); }
    function reset() { [78,92,64,89].forEach((v,i) => metrics[i].val = v); draw(); }
    draw();
  </script>
</body>
</html>
\`\`\`

You can also branch off this turn to iterate on the widget without losing the original version.`;
}

function buildDemoReply(
  prompt: string,
  modelId: string,
  { effort = 'medium', fanout = false }: { effort?: string; fanout?: boolean } = {},
): string {
  const q = prompt.trim();
  const lower = q.toLowerCase();

  if (lower.includes('artifact') || lower.includes('widget') || lower.includes('dashboard') || lower.includes('html') || lower.includes('build') || lower.includes('chart')) {
    return demoInteractiveArtifact(q);
  }

  if (lower.includes('svg') || lower.includes('diagram') || lower.includes('architecture')) {
    return `Here is an interactive architecture diagram rendered inside the **Artifact Drawer**:

\`\`\`svg
<svg viewBox="0 0 560 220" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#18b8cc" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#3e5aec" stop-opacity="0.9"/>
    </linearGradient>
  </defs>
  <rect width="560" height="220" rx="14" fill="#0b0b0e"/>
  <path d="M135 110 C190 110, 195 55, 250 55" stroke="url(#edge)" stroke-width="2" fill="none"/>
  <path d="M135 110 C190 110, 195 110, 250 110" stroke="url(#edge)" stroke-width="2" fill="none"/>
  <path d="M135 110 C190 110, 195 165, 250 165" stroke="url(#edge)" stroke-width="2" fill="none"/>
  <path d="M370 55 C415 55, 420 110, 455 110" stroke="#74e2a6" stroke-width="2" fill="none"/>
  <path d="M370 110 L455 110" stroke="#9fb2ff" stroke-width="2" fill="none"/>
  <path d="M370 165 C415 165, 420 110, 455 110" stroke="#74e2a6" stroke-width="2" fill="none"/>
  <rect x="28" y="84" width="108" height="52" rx="12" fill="#111114" stroke="#3e5aec"/>
  <text x="82" y="108" text-anchor="middle" fill="#f4f4f6" font-size="12" font-family="Inter,sans-serif">Prompt Node</text>
  <text x="82" y="124" text-anchor="middle" fill="#8e8e99" font-size="10" font-family="Inter,sans-serif">/fanout</text>
  <rect x="250" y="34" width="120" height="42" rx="10" fill="#111114" stroke="#18b8cc"/>
  <text x="310" y="59" text-anchor="middle" fill="#f4f4f6" font-size="11.5" font-family="Inter,sans-serif">Gemini 4 Neon</text>
  <rect x="250" y="89" width="120" height="42" rx="10" fill="#111114" stroke="#9fb2ff"/>
  <text x="310" y="114" text-anchor="middle" fill="#f4f4f6" font-size="11.5" font-family="Inter,sans-serif">Claude Fable 5.1</text>
  <rect x="250" y="144" width="120" height="42" rx="10" fill="#111114" stroke="#ffd27a"/>
  <text x="310" y="169" text-anchor="middle" fill="#f4f4f6" font-size="11.5" font-family="Inter,sans-serif">GPT-6 Astra</text>
  <rect x="455" y="84" width="82" height="52" rx="12" fill="#0d261c" stroke="#74e2a6"/>
  <text x="496" y="114" text-anchor="middle" fill="#74e2a6" font-size="12" font-family="Inter,sans-serif">Winner ✓</text>
</svg>
\`\`\`

Click **Pick Branch** or **Run Artifact ↗** above to inspect either view.`;
  }

  if (fanout || modelId === 'claude-fable' || modelId === 'gpt-astra' || modelId === 'gemini-neon') {
    if (modelId === 'claude-fable') {
      return `### Architectural Take (Claude Fable 5.1 · ${effort})

Regarding *"${q}"*:

- **First-principles framing**: Separate state ownership from transport so both browser-direct BYOK and paired Mac hosts share the exact same DAG conversation format.
- **Concrete next step**: Fork this turn via **Fork Branch** to test an alternative assumption cleanly without polluting the main timeline.

> Tip: Add your Anthropic, Gemini, OpenAI, or DeepSeek API key in **Settings** at any time for live model execution — keys stay locally in your browser.`;
    }
    if (modelId === 'gpt-astra') {
      return `### Formal & Quantitative Breakdown (GPT-6 Astra · ${effort})

Analyzing *"${q}"*:

| Dimension | Approach A | Approach B |
|---|---|---|
| Latency | Instant streaming | Branch + Verify |
| Context Hygiene | Side Chat \`/side\` | Main DAG Tree |
| Inspectability | Live Artifact Sandbox | Code Block |

\`\`\`js
// Every turn in Baryon Web is a DAG node — zero destructive overwrites
const branch = { parentId, childrenIds: [], chosenCandidate: 'winner' };
\`\`\`

Select **Use This Reply** above if you want subsequent turns to inherit this reasoning path.`;
    }
    return `### Concise Synthesis (Gemini 4 Neon · ${effort})

Here is a fast, structured take on *"${q}"*:

1. **Direct answer**: Baryon Web is running in **Demo Studio** right now so you can try **Time-Travel Branching**, **\`/fanout\` Arena Compare**, **Ephemeral \`/side\` Chat**, and **Live Sandboxed Artifacts** with zero setup.
2. **Go live in seconds**: Open **Settings → Engine** to paste any API key (**Gemini**, **OpenAI**, **Claude**, **DeepSeek**) or pair directly with your **Baryon Mac Host**.

Want to see an interactive live widget rendered inside Baryon? Type *"build an interactive dashboard artifact"* or run \`/fanout\`.`;
  }

  return `### Baryon Studio Response

You asked: *"${q}"*

Right now Baryon Web is running in **Instant Demo Studio** mode so every signature workflow works immediately across iPhone, iPad mini, iPad, and desktop:

- **\`/fanout\` Multi-Model Arena**: Race Gemini, Claude, and GPT side-by-side on one prompt with live \`ms\` & tok/s telemetry, then click **Pick Winner** to continue the thread.
- **Branching Timeline Tree**: Hover any message and click **Fork Branch** to explore another path without losing your history — inspect and switch timelines visually in the **Branches** drawer.
- **Live Sandboxed Artifacts**: Ask me to *"build an interactive HTML widget"* or *"draw an SVG architecture diagram"* to preview it live in the **Artifact** drawer.
- **Disposable \`/side\` Chat**: Ask quick side questions in the right drawer without adding noise to the main context.

Open **Settings** (bottom-left) whenever you're ready to connect **Gemini / OpenAI / Claude / DeepSeek API keys** or pair with your **Baryon Mac Host**.`;
}

async function streamDemo({
  prompt,
  model,
  effort,
  fanout,
  signal,
  onChunk,
}: {
  prompt: string;
  model: string;
  effort: string;
  fanout: boolean;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
}): Promise<string> {
  const full = buildDemoReply(prompt, model, { effort, fanout });
  const tokens = full.match(/\S+\s*/g) || [full];
  let acc = '';
  const step = fanout ? 3 : 2;
  for (let i = 0; i < tokens.length; i += step) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    acc += tokens.slice(i, i + step).join('');
    onChunk(acc);
    await new Promise(r => setTimeout(r, fanout ? 22 : 16));
  }
  return full;
}

async function readSse<T = unknown>(
  response: Response,
  signal: AbortSignal | undefined,
  onEvent: (evt: T) => void,
): Promise<void> {
  if (!response.body) throw new Error('Response body is empty');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try { onEvent(JSON.parse(payload) as T); } catch { /* ignore heartbeat */ }
    }
  }
}

async function streamGemini({
  settings,
  history,
  model,
  signal,
  onChunk,
}: {
  settings: ProviderSettings;
  history: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
}): Promise<string> {
  const mdl = model && !model.includes('claude') && !model.includes('gpt') ? model : 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mdl)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(settings.geminiKey.trim())}`;
  const contents = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const body: {
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    systemInstruction?: { parts: Array<{ text: string }> };
  } = { contents };
  if (settings.systemPrompt?.trim()) {
    body.systemInstruction = { parts: [{ text: settings.systemPrompt.trim() }] };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 180)}`);
  let acc = '';
  await readSse<GeminiSseEvent>(res, signal, evt => {
    const piece = evt?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    if (piece) { acc += piece; onChunk(acc); }
  });
  return acc;
}

async function streamOpenAICompat({
  endpoint,
  apiKey,
  model,
  settings,
  history,
  signal,
  onChunk,
}: {
  endpoint: string;
  apiKey: string;
  model: string;
  settings: ProviderSettings;
  history: ChatMessage[];
  signal?: AbortSignal;
  onChunk: (text: string) => void;
}): Promise<string> {
  const messages: ChatMessage[] = [];
  if (settings.systemPrompt?.trim()) messages.push({ role: 'system', content: settings.systemPrompt.trim() });
  messages.push(...history);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 180)}`);
  let acc = '';
  await readSse<OpenAISseEvent>(res, signal, evt => {
    const piece = evt?.choices?.[0]?.delta?.content || evt?.choices?.[0]?.delta?.reasoning_content || '';
    if (piece) { acc += piece; onChunk(acc); }
  });
  return acc;
}

async function streamClaude({
  settings,
  history,
  model,
  signal,
  onChunk,
}: {
  settings: ProviderSettings;
  history: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
}): Promise<string> {
  const mdl = model?.startsWith('claude-') && !model.includes('fable') ? model : 'claude-sonnet-4-5-20250929';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.claudeKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: mdl,
      max_tokens: 4096,
      stream: true,
      ...(settings.systemPrompt?.trim() ? { system: settings.systemPrompt.trim() } : {}),
      messages: history,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 180)}`);
  let acc = '';
  await readSse<ClaudeSseEvent>(res, signal, evt => {
    if (evt?.type === 'content_block_delta' && evt?.delta?.text) {
      acc += evt.delta.text;
      onChunk(acc);
    }
  });
  return acc;
}

async function streamMacHost({
  settings,
  history,
  signal,
  onChunk,
}: {
  settings: ProviderSettings;
  history: ChatMessage[];
  signal?: AbortSignal;
  onChunk: (text: string) => void;
}): Promise<string> {
  const base = settings.macUrl.trim().replace(/\/+$/, '');
  const prompt = history[history.length - 1]?.content || '';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${settings.macToken.trim()}`,
  };
  const threadRes = await fetch(`${base}/v1/thread`, { method: 'POST', headers, signal });
  if (!threadRes.ok) throw new Error(`Mac Host ${threadRes.status}`);
  const { id: chatId } = (await threadRes.json()) as { id: string };

  const sendRes = await fetch(`${base}/v1/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ chat: chatId, text: prompt, mode: 'chat' }),
    signal,
  });
  if (!sendRes.ok) throw new Error(`Mac Host send ${sendRes.status}`);

  // Poll /v1/chat briefly until reply completes (safe across CORS/EventSource auth header limits)
  for (let i = 0; i < 90; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise(r => setTimeout(r, 700));
    const chatRes = await fetch(`${base}/v1/chat?id=${encodeURIComponent(chatId)}`, { headers, signal });
    if (!chatRes.ok) continue;
    const data = (await chatRes.json()) as {
      history?: ChatMessage[];
      messages?: ChatMessage[];
      busy?: boolean;
      working?: boolean;
    };
    const msgs = data?.history || data?.messages || [];
    const last = [...msgs].reverse().find(m => m.role === 'assistant');
    if (last?.content) {
      onChunk(last.content);
      if (!data.busy && !data.working) return last.content;
    }
  }
  throw new Error('Mac Host timed out waiting for reply.');
}

export async function testMacHostConnection(macUrl: string, macToken: string): Promise<MacHostOverview> {
  const base = String(macUrl || '').trim().replace(/\/+$/, '');
  if (!base || !macToken) throw new Error('Enter both Host URL and Pairing Token.');
  const res = await fetch(`${base}/v1/overview`, {
    headers: { Authorization: `Bearer ${String(macToken).trim()}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as MacHostOverview;
}

export async function streamCompletion({
  settings,
  history,
  model,
  fanout = false,
  signal,
  onChunk = () => {},
}: StreamCompletionOptions): Promise<StreamCompletionResult> {
  const started = performance.now();
  const engine = resolveEffectiveEngine(settings);
  const prompt = history[history.length - 1]?.content || '';

  let text = '';
  if (engine === 'gemini') {
    text = await streamGemini({ settings, history, model, signal, onChunk });
  } else if (engine === 'openai') {
    text = await streamOpenAICompat({
      endpoint: 'https://api.openai.com/v1/chat/completions',
      apiKey: settings.openaiKey.trim(),
      model: model?.startsWith('gpt-') || model?.startsWith('o') ? model : 'gpt-4.1-mini',
      settings,
      history,
      signal,
      onChunk,
    });
  } else if (engine === 'deepseek') {
    text = await streamOpenAICompat({
      endpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: settings.deepseekKey.trim(),
      model: model?.startsWith('deepseek') ? model : 'deepseek-chat',
      settings,
      history,
      signal,
      onChunk,
    });
  } else if (engine === 'claude') {
    text = await streamClaude({ settings, history, model, signal, onChunk });
  } else if (engine === 'custom') {
    const base = settings.customUrl.trim().replace(/\/+$/, '');
    const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    text = await streamOpenAICompat({
      endpoint,
      apiKey: settings.customKey?.trim() || '',
      model: settings.customModel?.trim() || model || 'gpt-4o-mini',
      settings,
      history,
      signal,
      onChunk,
    });
  } else if (engine === 'mac') {
    text = await streamMacHost({ settings, history, signal, onChunk });
  } else {
    text = await streamDemo({
      prompt,
      model: model || settings?.model || 'baryon-stratus',
      effort: settings?.effort || 'medium',
      fanout,
      signal,
      onChunk,
    });
  }

  const elapsedMs = Math.max(1, Math.round(performance.now() - started));
  const approxTokens = Math.max(1, Math.round(text.length / 4));
  const tokPerSec = Math.round((approxTokens / (elapsedMs / 1000)) * 10) / 10;
  return {
    text,
    engine,
    model: model || settings?.model || 'baryon-stratus',
    meta: { elapsedMs, approxTokens, tokPerSec },
  };
}
