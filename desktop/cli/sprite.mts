// Terminal Fairy Sprite + animated spinner for the Fairy CLI.
// Designed strictly with 1-cell glyphs (no wide emojis) for crisp alignment in every terminal.

export const SPRITE_MOODS = Object.freeze(['idle', 'thinking', 'working', 'approval', 'happy', 'error'] as const);
export type SpriteMood = (typeof SPRITE_MOODS)[number];

const ANSI = Object.freeze({
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  wing: '\x1b[38;5;141m',
  glow: '\x1b[38;5;81m',
  mint: '\x1b[38;5;114m',
  gold: '\x1b[38;5;221m',
  coral: '\x1b[38;5;203m',
  text: '\x1b[38;5;252m',
} as const);

type AccentKey = 'glow' | 'mint' | 'gold' | 'coral';

interface SpriteFrame {
  accent: AccentKey;
  lines: string[];
}

export interface SpriteStreamLike {
  isTTY?: boolean;
  write?: (chunk: string) => unknown;
}

export interface RenderSpriteOptions {
  mood?: SpriteMood | string;
  frame?: number;
  color?: boolean;
}

export interface RenderBannerOptions {
  name?: string;
  connectionMode?: string;
  provider?: string;
  model?: string;
  folder?: string;
  permission?: string;
  mode?: string;
  chatId?: string;
  mood?: SpriteMood | string;
  color?: boolean;
}

export interface SpinnerOptions {
  stream?: SpriteStreamLike | null;
  color?: boolean;
  enabled?: boolean;
  intervalMs?: number;
}

export interface Spinner {
  start(label?: string, mood?: SpriteMood): void;
  update(label?: string, mood?: SpriteMood): void;
  pause(): void;
  stop(finalLine?: string): void;
}

/** Returns true when ANSI styling should be emitted to `stream`. */
export function useColor(stream: SpriteStreamLike | null | undefined = process.stdout, env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined = process.env): boolean {
  if (!stream || stream.isTTY !== true) return false;
  if ('NO_COLOR' in (env || {})) return false;
  if (env?.FORCE_COLOR === '0' || env?.TERM === 'dumb') return false;
  return true;
}

const paint = (text: string, code: string, colored: boolean): string => (colored ? `${code}${text}${ANSI.reset}` : text);

const FRAMES: Record<SpriteMood, SpriteFrame[]> = {
  idle: [
    {
      accent: 'glow',
      lines: [
        '    ✦   ✧   ✦    ',
        '╭─\\ ( • ‿ • ) /─╮',
        '│  \\(   ✦   )/  │',
        '╰─/  \\──˚──/  \\─╯',
        '    ╰─╯   ╰─╯    ',
      ],
    },
  ],
  thinking: [
    {
      accent: 'glow',
      lines: [
        '  ˚   ✦   ?   ˚  ',
        '╭─\\ ( ◔ ᴗ ◔ ) /─╮',
        '│  \\(   ~   )/  │',
        '╰─/  \\──˚──/  \\─╯',
        '    ╰─╯   ╰─╯    ',
      ],
    },
    {
      accent: 'glow',
      lines: [
        '  ✦   ˚   ?   ✦  ',
        '╭─\\ ( ◕ ᴗ ◕ ) /─╮',
        '│  \\(   ✧   )/  │',
        '╰─/  \\──˚──/  \\─╯',
        '    ╰─╯   ╰─╯    ',
      ],
    },
  ],
  working: [
    {
      accent: 'mint',
      lines: [
        '    ✦   ✧   ✦    ',
        '╭─\\ ( ◠ ‿ ◠ ) /─╮',
        '│  \\(   ✦   )/  │',
        '╰─/  \\──✧──/  \\─╯',
        '   ~╰─╯   ╰─╯~   ',
      ],
    },
    {
      accent: 'mint',
      lines: [
        '  ✧   ✦   ✧   ✦  ',
        '.─\\ ( • ◡ • ) /─.',
        ' \\ \\(   ✧   )/ / ',
        '  ╰─/\\──✦──/\\─╯  ',
        '    ╰─╯   ╰─╯    ',
      ],
    },
  ],
  approval: [
    {
      accent: 'gold',
      lines: [
        '   ˚  [ ! ]  ˚   ',
        '╭─\\ ( • _ • ) /─╮',
        '│  \\(   !   )/  │',
        '╰─/  \\──!──/  \\─╯',
        '    ╰─╯   ╰─╯    ',
      ],
    },
  ],
  happy: [
    {
      accent: 'mint',
      lines: [
        ' ✦  ✧   ✦   ✧  ✦ ',
        '╭─\\ ( ^ ‿ ^ ) /─╮',
        '│  \\(   ✦   )/  │',
        '╰─/  \\──✦──/  \\─╯',
        '  ˚ ╰─╯   ╰─╯ ˚  ',
      ],
    },
  ],
  error: [
    {
      accent: 'coral',
      lines: [
        '    ·   ×   ·    ',
        '╭─\\ ( × ︵ × ) /─╮',
        '│  \\(   ·   )/  │',
        '╰─/  \\──·──/  \\─╯',
        '    ╰─╯   ╰─╯    ',
      ],
    },
  ],
};

export const MINI_FRAMES: Readonly<Record<SpriteMood, readonly string[]>> = Object.freeze({
  thinking: ['✦ ˚ (◔ᴗ◔) ˚ ✧', '✧ ˚ (◕ᴗ◕) ˚ ✦', '✦ ˚ (•ᴗ•) ˚ ✧'],
  working: ['✦ ˚ (◠‿◠) ˚ ✧', '✧ ˚ (•◡•) ˚ ✦', '✦ ˚ (•‿•) ˚ ✧'],
  approval: ['! ˚ (•_•) ˚ !'],
  idle: ['✦ ˚ (•‿•) ˚ ✧'],
  happy: ['✦ ✧ (^‿^) ✧ ✦'],
  error: ['× · (×︵×) · ×'],
});

function colorizeSpriteLine(line: string, index: number, accentKey: AccentKey, colored: boolean): string {
  if (!colored) return line;
  const accent = ANSI[accentKey] || ANSI.glow;
  if (index === 0) return `${accent}${line}${ANSI.reset}`;
  if (index === 1) {
    const start = line.indexOf('(');
    const end = line.lastIndexOf(')');
    if (start >= 0 && end > start) {
      return (
        `${ANSI.wing}${line.slice(0, start)}` +
        `${ANSI.bold}${ANSI.text}${line.slice(start, end + 1)}${ANSI.reset}` +
        `${ANSI.wing}${line.slice(end + 1)}${ANSI.reset}`
      );
    }
  }
  if (index === 2) {
    return `${ANSI.wing}${line.slice(0, 5)}${accent}${line.slice(5, 12)}${ANSI.wing}${line.slice(12)}${ANSI.reset}`;
  }
  return `${ANSI.wing}${line}${ANSI.reset}`;
}

/** Renders the 5-line winged Terminal Fairy sprite as an array of strings. */
export function renderSpriteLines({ mood = 'idle', frame = 0, color = false }: RenderSpriteOptions = {}): string[] {
  const key: SpriteMood = (SPRITE_MOODS as readonly string[]).includes(mood) ? (mood as SpriteMood) : 'idle';
  const variants = FRAMES[key] || FRAMES.idle;
  const picked = variants[Math.abs(Number(frame) || 0) % variants.length];
  return picked.lines.map((line, idx) => colorizeSpriteLine(line, idx, picked.accent, color));
}

/** Renders the 5-line winged Terminal Fairy sprite as a single newline-joined string. */
export function renderSprite(options: RenderSpriteOptions = {}): string {
  return renderSpriteLines(options).join('\n');
}

/**
 * Renders the Claude Code / Codex style two-column startup banner with Fairy's
 * winged sprite on the left and active mode/model/folder metadata on the right.
 */
export function renderBanner({
  name = 'Fairy',
  connectionMode = 'headless',
  provider = '',
  model = '',
  folder = '',
  permission = 'auto',
  mode = 'work',
  chatId = '',
  mood = 'idle',
  color = false,
}: RenderBannerOptions = {}): string {
  const sprite = renderSpriteLines({ mood, color });
  const connLabel = connectionMode === 'face'
    ? 'MacBook Face -> Body'
    : connectionMode === 'body'
      ? 'Connected (cli.sock)'
      : 'Standalone Headless';
  const titleLine = `${paint('Baryon', `${ANSI.bold}${ANSI.glow}`, color)} ${paint('CLI', `${ANSI.bold}${ANSI.wing}`, color)}${name && name !== 'Baryon' ? ` ${paint(`(${name})`, ANSI.dim, color)}` : ''} ${paint(`· ${connLabel}`, ANSI.dim, color)}`;
  const modelText = [provider, model].filter(Boolean).join(' · ') || 'default';
  const permText = mode === 'chat' ? 'plain chat' : permission === 'plan' ? 'plan (read-only)' : 'edit (sandboxed)';
  const info = [
    titleLine,
    `${paint('Model:', ANSI.dim, color)} ${modelText}`,
    `${paint('Mode:', ANSI.dim, color)} ${permText}${chatId ? `  ${paint(`#${chatId.slice(0, 12)}`, ANSI.dim, color)}` : ''}`,
    folder ? `${paint('Folder:', ANSI.dim, color)} ${folder}` : `${paint('Folder:', ANSI.dim, color)} (none)`,
    paint('Type a message or /help  ·  /plan  /edit  /chat  /work  /exit', ANSI.dim, color),
  ];

  const rows: string[] = [];
  for (let i = 0; i < Math.max(sprite.length, info.length); i++) {
    const left = sprite[i] ?? '                 ';
    const right = info[i] ?? '';
    rows.push(right ? `  ${left}   ${right}` : `  ${left}`);
  }
  return `\n${rows.join('\n')}\n`;
}

/**
 * Creates a flicker-free inline mini-sprite spinner on `stream` (usually `stderr`).
 * Safe no-op on non-TTY streams unless `forceAnimation` is set.
 */
export function createSpinner({
  stream = process.stderr,
  color = false,
  enabled = Boolean(stream?.isTTY),
  intervalMs = 140,
}: SpinnerOptions = {}): Spinner {
  let timer: ReturnType<typeof setInterval> | null = null;
  let frame = 0;
  let currentMood: SpriteMood = 'thinking';
  let currentLabel = 'Thinking…';
  let active = false;

  const draw = () => {
    if (!enabled || !stream?.write) return;
    const frames = MINI_FRAMES[currentMood] || MINI_FRAMES.thinking;
    const icon = frames[frame % frames.length];
    frame += 1;
    const styledIcon = paint(icon, currentMood === 'approval' ? ANSI.gold : currentMood === 'working' ? ANSI.mint : ANSI.glow, color);
    const text = paint(currentLabel, ANSI.dim, color);
    stream.write(`\r\x1b[2K${styledIcon}  ${text}`);
  };

  return {
    start(label = 'Thinking…', mood: SpriteMood = 'thinking') {
      currentLabel = String(label || 'Working…');
      currentMood = mood;
      if (!enabled) return;
      active = true;
      draw();
      if (!timer) {
        timer = setInterval(draw, intervalMs);
        timer.unref?.();
      }
    },
    update(label, mood: SpriteMood = currentMood) {
      if (label !== undefined) currentLabel = String(label);
      if (mood !== undefined) currentMood = mood;
      if (active && enabled) draw();
    },
    pause() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (active && enabled && stream?.write) {
        stream.write('\r\x1b[2K');
      }
      active = false;
    },
    stop(finalLine = '') {
      this.pause();
      if (finalLine && stream?.write) {
        stream.write(`${finalLine}\n`);
      }
    },
  };
}
