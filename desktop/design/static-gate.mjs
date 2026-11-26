// Static Verification Gate (Phase 2 -> Phase 3): Token Lock, Banned Font checks, JS syntax, A11y & WCAG contrast.
import { BANNED_FONTS } from './skill.mjs';

function parseHexColor(hex) {
  const clean = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(clean)) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }
  return null;
}

function relativeLuminance([r, g, b]) {
  const toLinear = v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(hexA, hexB) {
  const rgbA = parseHexColor(hexA);
  const rgbB = parseHexColor(hexB);
  if (!rgbA || !rgbB) return null;
  const lumA = relativeLuminance(rgbA);
  const lumB = relativeLuminance(rgbB);
  const hi = Math.max(lumA, lumB);
  const lo = Math.min(lumA, lumB);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

function extractCssVarValues(css) {
  const vars = {};
  for (const m of String(css || '').matchAll(/(--[a-z0-9_-]+)\s*:\s*([^;{}\n]+)/gi)) {
    vars[m[1].trim()] = m[2].trim();
  }
  return vars;
}

/**
 * Run static token lock, typography, contrast, structural, and JS syntax checks before Chromium capture.
 */
export function runStaticGate({ html = '', spec = null, enforceTokenLock = true, allowRepoFonts = false } = {}) {
  const source = String(html || '');
  const errors = [];
  const warnings = [];

  if (!source.trim()) {
    return {
      passed: false,
      errors: ['Generated HTML is empty.'],
      warnings: [],
      metrics: { rawHexOutsideRoot: 0, textContrast: null, accentContrast: null, tokenCount: 0, bannedFontsFound: [] },
    };
  }

  const styleBlocks = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
  const css = styleBlocks.join('\n');
  const cssVars = { ...(spec?.tokens || {}), ...extractCssVarValues(css) };

  // Strip :root { ... } blocks to check raw hex usage outside token definitions.
  const cssWithoutRoot = css.replace(/:root\s*\{[\s\S]*?\}/gi, '');
  const inlineStyles = [...source.matchAll(/\bstyle\s*=\s*["']([^"']*)["']/gi)].map(m => m[1]).join('\n');
  const outsideCss = `${cssWithoutRoot}\n${inlineStyles}`;
  const rawHexMatches = [...outsideCss.matchAll(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/gi)].map(m => m[0]);

  if (enforceTokenLock && Object.keys(cssVars).length > 0 && rawHexMatches.length > 2) {
    errors.push(
      `Token Lock violation: found ${rawHexMatches.length} hardcoded hex colors outside :root (${rawHexMatches.slice(0, 4).join(', ')}). Use var(--token) instead.`,
    );
  }

  // Banned fonts scan
  const bannedFound = new Set();
  for (const m of css.matchAll(/font-family\s*:\s*([^;{}\n]+)/gi)) {
    const val = m[1].toLowerCase();
    for (const bf of BANNED_FONTS) {
      if (new RegExp(`\\b${bf}\\b`, 'i').test(val)) bannedFound.add(bf);
    }
  }
  if (!allowRepoFonts && bannedFound.size > 0) {
    errors.push(`Typography anti-slop violation: banned font(s) detected (${[...bannedFound].join(', ')}).`);
  }

  // Balanced CSS braces sanity check
  const openBraces = (css.match(/\{/g) || []).length;
  const closeBraces = (css.match(/\}/g) || []).length;
  if (Math.abs(openBraces - closeBraces) > 1) {
    errors.push(`Unbalanced CSS braces (${openBraces} '{' vs ${closeBraces} '}').`);
  }

  // Inline JS syntax verification
  for (const m of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    if (/\bsrc\s*=/.test(attrs) || !body.trim() || /\btype\s*=\s*["']module["']/i.test(attrs)) continue;
    try {
      // Syntax validation without executing untrusted generated code
      new Function(body);
    } catch (err) {
      errors.push(`Inline script syntax error: ${err.message}`);
    }
  }

  // Structural & A11y checks
  if (!/<meta\b[^>]*name\s*=\s*["']viewport["']/i.test(source)) {
    warnings.push('Missing responsive <meta name="viewport"> tag.');
  }
  if (!/<(main|header|nav|section|article)\b/i.test(source)) {
    warnings.push('Missing semantic HTML landmarks (<main>, <header>, <section>).');
  }
  if (/<img\b(?![^>]*\balt\s*=)[^>]*>/i.test(source)) {
    warnings.push('One or more <img> elements lack an alt attribute.');
  }
  if (/<div\b[^>]*onclick\s*=/i.test(source)) {
    warnings.push('Clickable <div> detected; prefer native <button> elements for keyboard accessibility.');
  }

  const textContrast = contrastRatio(cssVars['--text-primary'], cssVars['--bg-canvas']);
  const accentContrast = contrastRatio(cssVars['--accent-primary'], cssVars['--bg-canvas']);
  if (textContrast !== null && textContrast < 4.5) {
    errors.push(`Primary text contrast ${textContrast}:1 against --bg-canvas fails WCAG AA (4.5:1 minimum).`);
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    metrics: {
      rawHexOutsideRoot: rawHexMatches.length,
      textContrast,
      accentContrast,
      tokenCount: Object.keys(cssVars).length,
      bannedFontsFound: [...bannedFound],
    },
  };
}
