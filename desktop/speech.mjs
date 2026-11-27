import { spokenMath } from './math-speech.mjs';
// Only speech is simplified. Displayed replies and saved history keep the source.
function withoutLinks(text) {
  const link = /!?\[[^\]\n]*\]\(/g;
  let output = '', from = 0, match;
  while ((match = link.exec(text))) {
    let depth = 1, end = link.lastIndex;
    for (; end < text.length && depth; end++) {
      if (text[end] === '\\') { end++; continue; }
      if (text[end] === '(') depth++;
      if (text[end] === ')') depth--;
    }
    if (depth) continue;
    output += text.slice(from, match.index) + ' '; from = end; link.lastIndex = end;
  }
  return (output + text.slice(from))
    .replace(/!?\[[^\]\n]*\]\[[^\]\n]*\]/g, ' ')
    .replace(/\b(?:https?:\/\/|lyra-file:\/\/|www\.)[^\s<>]+/gi, ' ')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,24}\b/gi, ' ')
    .replace(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|edu|gov|io|ai|dev|co|uk|au|de|fr|ca|info|app)(?:\b)(?:\/[^\s<>]*)?/gi, ' ');
}

// A source list ("Sources consulted: [a](…), [b](…)", or a "Sources" label followed by
// link-only bullets) is for reading, never for speaking.
const SOURCE_LABEL = /^[\s>*_#-]*(?:sources?|notes|references|citations|further reading)(?:\s+(?:consulted|used|cited))?\s*:?[\s*_]*:?/i;
const linksOnly = text => !withoutLinks(text).replace(/https?:\/\/\S+/g, '').replace(/[\s,;·•*_\-–—.:()\[\]0-9]/g, '').length;

export function speechText(reply) {
  let fence = null, mathCloser = null, inSources = false;
  const lines = reply.replace(/\r\n?/g, '\n').split('\n');
  const prose = [];
  for (const original of lines) {
    const line = original.replace(/^\s*(?:>\s*)+/, '');
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { fence = { character: marker[1][0], length: marker[1].length }; continue; }
    let mathLine=Boolean(mathCloser);
    for(const token of line.match(/\\(?:\[|\]|\(|\))|\$\$/g)||[]) {
      mathLine=true;
      if(token===mathCloser)mathCloser=null;
      else if(!mathCloser)mathCloser=({'\\[':'\\]','\\(':'\\)','$$':'$$'})[token]||null;
    }
    if (!mathLine && /^(?: {4}|\t)/.test(line) || /^\s*(?:[-*_]\s*){3,}$/.test(line) || /^\s*\[[^\]]+\]:\s*\S/.test(line)) continue;
    const label = line.match(SOURCE_LABEL);
    if (label && linksOnly(line.slice(label[0].length))) { inSources = true;continue; }
    if (inSources && line.trim() && linksOnly(line)) continue;
    if (line.trim()) inSources = false;
    prose.push(line);
  }
  const text = prose.join('\n')
    .replace(/\uE200[^\uE201]*\uE201/g, ' ')
    .replace(/<(pre|code|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/(?<!`)(`+)(?!`)([\s\S]*?)\1(?!`)/g, '$2');
  return spokenMath(withoutLinks(text))
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, entity => ({ '&amp;': ' and ', '&lt;': ' ', '&gt;': ' ', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity.toLowerCase()])
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|[-+*][ \t]+(?:\[[ xX]\][ \t]*)?|\d+[.)][ \t]+)/gm, '')
    .replace(/\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?|[\u200D\uFE0F\u20E3\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/[\\`*_#~^|{}<>\[\]]/g, ' ')
    .replace(/(^|[\s([{])['"“‘]+(?=\S)/g, '$1')
    .replace(/(?<=\S)['"”’]+(?=$|[\s.,!?;:)])/g, '')
    .replace(/&/g, ' and ')
    .split(/\n[ \t]*\n+/)
    .map(paragraph => paragraph.replace(/\s+/g, ' ').replace(/\.\s+\./g, '.').replace(/\s+([,.;:!?])/g, '$1').replace(/\(\s*\)/g, '').replace(/[:;,]\s*([.!?])/g, '$1').replace(/\.\s+\./g, '.').replace(/^[,.;:!?\s]+/, '').trim())
    .filter(paragraph => /[\p{L}\p{N}]/u.test(paragraph))
    .join('\n\n');
}

export function voiceText(reply, settings) {
  const text = speechText(reply);
  if (settings.voiceProvider !== 'fish') return text;
  // S2 uses bracket cues; S1 uses parenthesized cues. Insert only after cleanup
  // so arbitrary response tags cannot control the voice.
  return text.replace(/\n\n/g, /^s2/i.test(settings.fishModel) ? '\n[pause]\n' : '\n(break)\n');
}

export const replyFormattingInstructions = 'Lead with the answer or outcome — no filler openers ("Sure!", "Great question", "I\'d be happy to") or empty sign-offs. Match length to weight: 1–3 sentences for simple asks; stop once answered without padding or repeating yourself. Write with natural human cadence: vary sentence length, use plain contractions and possessives, and prefer short paragraphs over bold-headed bullet dumps unless listing distinct steps. Use emphasis sparingly without decorative asterisks or quotes around ordinary words. Put math in LaTeX \\( \\) or \\[ \\] with a brief plain explanation for speech, code in fenced blocks with a language label, and source links at the end of the relevant paragraph rather than a spoken URL list.';
