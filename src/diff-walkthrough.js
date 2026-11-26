const VALID_RISKS = new Set(['low', 'medium', 'high']);

/**
 * Builds the read-only prompt requesting a structured JSON walkthrough tour across changed files.
 */
export function buildWalkthroughPrompt({ what = 'recent changes', diff = '', files = [] } = {}) {
  const clippedDiff = String(diff ?? '').slice(0, 60_000);
  const fileList = Array.isArray(files) && files.length ? `Changed files:\n${files.map(f => `- ${f}`).join('\n')}\n\n` : '';
  return `Generate a concise AI-guided code walkthrough tour for ${what}.
Group the changes into 2 to 8 logical stops ordered for a reviewer.
Reply ONLY with valid JSON (no markdown fences needed, or a single \`\`\`json block) matching:
{
  "title": "Short summary of the change",
  "stops": [
    {
      "path": "relative/file/path.js",
      "line": 1,
      "title": "What this change does",
      "explanation": "Why and how it works in 1-2 plain sentences.",
      "risk": "low|medium|high"
    }
  ]
}

${fileList}Diff:
${clippedDiff}`;
}

/**
 * Parses and normalizes an LLM walkthrough JSON payload into safe ordered stops.
 */
export function parseWalkthroughTour(raw) {
  const source = typeof raw === 'string' ? raw.trim() : raw;
  let parsed = source;
  if (typeof source === 'string') {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(source);
    const jsonText = fenced ? fenced[1].trim() : source;
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(jsonText.slice(start, end + 1));
      } catch {
        parsed = null;
      }
    } else {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return { title: 'Walkthrough', stops: [] };
  const stops = Array.isArray(parsed.stops)
    ? parsed.stops
        .filter(s => s && typeof s.path === 'string' && s.path.trim())
        .slice(0, 12)
        .map((s, idx) => ({
          index: idx,
          path: s.path.trim(),
          line: Number.isInteger(s.line) && s.line > 0 ? s.line : Number(s.line) > 0 ? Math.floor(Number(s.line)) : 1,
          title: String(s.title || s.path).trim().slice(0, 140),
          explanation: String(s.explanation || '').trim().slice(0, 500),
          risk: VALID_RISKS.has(String(s.risk).toLowerCase()) ? String(s.risk).toLowerCase() : 'low',
        }))
    : [];
  return {
    title: String(parsed.title || 'Change walkthrough').trim().slice(0, 140),
    stops,
  };
}

/**
 * Renders the interactive walkthrough bar at the top of the Changes pane.
 */
export function renderWalkthroughBar({
  tour,
  index = 0,
  onNavigate = () => {},
  onAsk = () => {},
  onClose = () => {},
} = {}) {
  const box = document.createElement('div');
  box.className = 'walkthrough-bar';
  if (!tour?.stops?.length) {
    const msg = document.createElement('span');
    msg.className = 'page-detail';
    msg.textContent = 'No walkthrough stops returned for these changes.';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'page-link';
    close.textContent = 'Close';
    close.onclick = () => onClose();
    box.append(msg, close);
    return box;
  }

  const total = tour.stops.length;
  const clamped = Math.max(0, Math.min(total - 1, index));
  const stop = tour.stops[clamped];

  const top = document.createElement('div');
  top.className = 'walkthrough-head';
  const counter = document.createElement('strong');
  counter.textContent = `Tour ${clamped + 1}/${total}: ${stop.title}`;
  const risk = document.createElement('span');
  risk.className = `walkthrough-risk is-${stop.risk}`;
  risk.textContent = stop.risk;
  const controls = document.createElement('div');
  controls.className = 'walkthrough-controls';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'changes-toggle';
  prev.textContent = '‹ Prev';
  prev.disabled = clamped <= 0;
  prev.onclick = () => onNavigate(clamped - 1, tour.stops[clamped - 1]);

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'changes-toggle';
  next.textContent = 'Next ›';
  next.disabled = clamped >= total - 1;
  next.onclick = () => onNavigate(clamped + 1, tour.stops[clamped + 1]);

  const ask = document.createElement('button');
  ask.type = 'button';
  ask.className = 'changes-toggle';
  ask.textContent = 'Ask about this stop';
  ask.onclick = () => onAsk(stop);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'changes-toggle';
  close.textContent = '×';
  close.title = 'Close tour';
  close.onclick = () => onClose();

  controls.append(prev, next, ask, close);
  top.append(counter, risk, controls);

  const fileLine = document.createElement('button');
  fileLine.type = 'button';
  fileLine.className = 'walkthrough-file';
  fileLine.textContent = `${stop.path}:${stop.line}`;
  fileLine.onclick = () => onNavigate(clamped, stop);

  const desc = document.createElement('p');
  desc.className = 'walkthrough-desc';
  desc.textContent = stop.explanation;

  box.append(top, fileLine, desc);
  return box;
}
