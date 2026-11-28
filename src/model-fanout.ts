const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  gemini: 'Gemini',
  antigravity: 'Gemini',
  codex: 'Codex',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
};

export interface FanoutResultItem {
  ok: boolean;
  provider?: string;
  label?: string;
  model?: string;
  ms?: number;
  text?: string;
  error?: string;
}

export interface RenderFanoutCardOptions {
  prompt?: string;
  results?: readonly FanoutResultItem[];
  onPick?: (item: FanoutResultItem) => void;
  onCopy?: (item: FanoutResultItem) => void;
}

/**
 * Renders side-by-side multi-model `/fanout` comparison cards with Pick and Copy actions.
 */
export function renderFanoutCard({
  prompt = '',
  results = [],
  onPick = () => {},
  onCopy = () => {},
}: RenderFanoutCardOptions = {}): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'fanout-wrap';

  const head = document.createElement('div');
  head.className = 'fanout-head';
  const title = document.createElement('strong');
  title.textContent = `Parallel comparison (${results.length} models)`;
  const sub = document.createElement('span');
  sub.className = 'fanout-prompt';
  sub.textContent = String(prompt).slice(0, 120);
  head.append(title, sub);
  wrap.append(head);

  const grid = document.createElement('div');
  grid.className = 'fanout-grid';

  for (const item of results) {
    const col = document.createElement('section');
    col.className = `fanout-col${item.ok ? '' : ' is-error'}`;

    const colHead = document.createElement('div');
    colHead.className = 'fanout-col-head';
    const label = document.createElement('span');
    label.className = 'fanout-col-name';
    label.textContent = (item.provider && PROVIDER_LABELS[item.provider]) || item.label || item.provider || 'Model';
    const meta = document.createElement('span');
    meta.className = 'fanout-col-meta';
    const secs = item.ms ? `${(item.ms / 1000).toFixed(1)}s` : '';
    meta.textContent = [item.model, secs].filter(Boolean).join(' · ');
    colHead.append(label, meta);

    const body = document.createElement('div');
    body.className = 'fanout-col-body';
    body.textContent = item.ok ? (item.text ?? '') : (item.error || 'Failed');

    const foot = document.createElement('div');
    foot.className = 'fanout-col-actions';
    if (item.ok) {
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'composer-queue-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.onclick = () => onCopy(item);

      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'composer-queue-btn steer';
      pickBtn.textContent = 'Continue with this';
      pickBtn.onclick = () => onPick(item);
      foot.append(copyBtn, pickBtn);
    }

    col.append(colHead, body, foot);
    grid.append(col);
  }

  wrap.append(grid);
  return wrap;
}
