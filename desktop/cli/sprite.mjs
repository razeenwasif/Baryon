// Terminal Fairy Sprite + animated spinner for the Fairy CLI.
// Designed strictly with 1-cell glyphs (no wide emojis) for crisp alignment in every terminal.

export const SPRITE_MOODS = Object.freeze(['idle', 'thinking', 'working', 'approval', 'happy', 'error']);

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
});

/** Returns true when ANSI styling should be emitted to `stream`. */
export function useColor(stream = process.stdout, env = process.env) {
  if (!stream || stream.isTTY !== true) return false;
  if ('NO_COLOR' in (env || {})) return false;
  if (env?.FORCE_COLOR === '0' || env?.TERM === 'dumb') return false;
  return true;
}

const paint = (text, code, colored) => (colored ? `${code}${text}${ANSI.reset}` : text);

const FRAMES = {
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

export const MINI_FRAMES = Object.freeze({
  thinking: ['✦ ˚ (◔ᴗ◔) ˚ ✧', '✧ ˚ (◕ᴗ◕) ˚ ✦', '✦ ˚ (•ᴗ•) ˚ ✧'],
  working: ['✦ ˚ (◠‿◠) ˚ ✧', '✧ ˚ (•◡•) ˚ ✦', '✦ ˚ (•‿•) ˚ ✧'],
  approval: ['! ˚ (•_•) ˚ !'],
  idle: ['✦ ˚ (•‿•) ˚ ✧'],
  happy: ['✦ ✧ (^‿^) ✧ ✦'],
  error: ['× · (×︵×) · ×'],
});

function colorizeSpriteLine(line, index, accentKey, colored) {
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
export function renderSpriteLines({ mood = 'idle', frame = 0, color = false } = {}) {
  const key = SPRITE_MOODS.includes(mood) ? mood : 'idle';
  const variants = FRAMES[key] || FRAMES.idle;
  const picked = variants[Math.abs(Number(frame) || 0) % variants.length];
  return picked.lines.map((line, idx) => colorizeSpriteLine(line, idx, picked.accent, color));
}

/** Renders the 5-line winged Terminal Fairy sprite as a single newline-joined string. */
export function renderSprite(options = {}) {
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
} = {}) {
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

  const rows = [];
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
} = {}) {
  let timer = null;
  let frame = 0;
  let currentMood = 'thinking';
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
    start(label = 'Thinking…', mood = 'thinking') {
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
    update(label, mood = currentMood) {
      if (label !== undefined) currentLabel = String(label);
      if (mood !== undefined) currentMood = mood;
      if (active && enabled) draw();
    },
    pause() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (active && enabled) {
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
