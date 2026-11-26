// Efficiency audit, fix 12: the speech engine and its English rules cost about 100 ms of every launch, and memory
// after, but are only needed to read maths aloud. So they load the first time a reply with maths is about to be
// spoken: callers that speak await loadMathSpeech() when hasMath() says so. The rules are bundled; maths never
// needs a network request. Before the engine has loaded, an expression reads as a pointer to the screen instead
// of holding the voice up, and that stand-in isn't cached.
let engine = null, loading = null;
export function loadMathSpeech() {
  return loading ??= (async () => {
    const [{ default: katex }, { default: sre }] = await Promise.all([import('katex'), import('speech-rule-engine')]);
    await sre.setupEngine({locale: 'en', domain: 'clearspeak', style: 'default', markup: 'none'});
    await sre.engineReady();
    engine = { katex, sre };
  })().catch(error => { loading = null; throw error; });
}
export const mathSpeechLoaded = () => Boolean(engine);
// The delimiters spokenMath reads: \( \[ $ and $$.
export const hasMath = text => /\\[[(]|\$/.test(String(text ?? ''));
const NOT_LOADED = 'the equation shown on screen';
const cache = new Map();
export function mathSpeech(tex) {
  if (cache.has(tex)) return cache.get(tex);
  if (!engine) { loadMathSpeech().catch(() => {}); return NOT_LOADED; }
  const { katex, sre } = engine;
  let spoken;
  try {
    if (tex.length > 4000) throw new Error('Expression too long');
    const rendered = katex.renderToString(tex, {output: 'mathml', throwOnError: true, trust: false, strict: 'ignore', maxExpand: 100});
    const mathml = rendered.match(/<math[\s\S]*?<\/math>/)?.[0];
    spoken = mathml && sre.toSpeech(mathml);
    if (!spoken) throw new Error('No math description');
  } catch { spoken = 'an expression I can’t read reliably; please refer to the displayed equation'; }
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  cache.set(tex, spoken);
  return spoken;
}

export function spokenMath(text) {
  return text
    .replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_m, a, b) => `\n\n${mathSpeech(a ?? b)}.\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, tex) => mathSpeech(tex))
    .replace(/(?<![\\\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_m, tex) => mathSpeech(tex))
    .replace(/\\(?:\[|\()[\s\S]*$|\$\$[\s\S]*$/g, 'an incomplete equation; please refer to the displayed text');
}
