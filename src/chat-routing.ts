import { clipboardRequest } from './clipboard-request.js';
import { LOCAL_READ_EXTENSIONS } from './local-file-types.js';
export { ATTACHABLE_EXTENSIONS } from './local-file-types.js';

export interface ChatRoutingHistoryEntry {
  mode?: string;
  attachments?: unknown[];
}

export interface SummaryWriteRequest {
  operation: 'create';
  target: string;
}

export interface FileWriteRequest {
  operation: 'create' | 'append' | 'update' | 'write';
  target: string | null;
}

const readFileName = new RegExp(String.raw`\b[\w-]+\.(?:${LOCAL_READ_EXTENSIONS.map(ext => ext.slice(1)).join('|')})(?![\w.])`, 'i');

// Route only explicit screen references; ordinary mentions of display technology
// and quoted examples must not cause an unsolicited screenshot.
export function declinesScreen(text: string): boolean {
  return /\b(?:don't|do not|without|never|stop)\b.{0,45}\b(?:screen|screenshot|display|capture)\b/i.test(text.replaceAll('’', "'"));
}

export function wantsScreen(text: string): boolean {
  const message = text.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|"[^"\n]*"|“[^”\n]*”|(^|\s)'[^'\n]+'(?=\s|[.,?!]|$)/g, '').toLowerCase().replace(/[’]/g, "'");
  if (/\b(?:don't|do not|without|never|stop)\b.{0,45}\b(?:screen|screenshot|display|capture)\b/.test(message)) return false;
  return /\b(?:on|in|at)\s+(?:(?:my|the|this|your)\s+)?screen\b/.test(message)
    || /\b(?:look at|read|explain|describe|summari[sz]e|check|see|capture)\s+(?:what(?:'s| is)\s+on\s+)?(?:my|the|this)\s+(?:screen|display|screenshot)\b/.test(message)
    || /\b(?:screen|screenshot)\s+(?:in front of me|right now)\b/.test(message);
}

// Floating Fairy (and the companion) draws her answer when you ask to be shown, taught or walked through something, ask
// how or why something works, or ask her to solve, plot or draw it, with or without anything on the screen. Small
// talk, plans and plain facts stay ordinary chats, and "don't draw" always does.
export function wantsSketch(text: string): boolean {
  const message = String(text).replace(/```[\s\S]*?(?:```|$)|`[^`]*`|"[^"\n]*"|“[^”\n]*”/g, ' ').toLowerCase().replaceAll('’', "'").replace(/\s+/g, ' ').trim();
  if (declinesScreen(message) || /\b(?:don't|do not|no need to|without|no)\b.{0,30}\b(?:draw|drawing|sketch|diagram|visuals?|pictures?)/.test(message)) return false;
  // About Fairy or the user, not something to explain.
  if (/^(?:hey |hi |ok |okay |so )?(?:fairy,? )?(?:how (?:are|r) (?:you|u)|how's it going|how was|how do you feel|what's up|what are you|who are you|what time|what's the time|what day)\b/.test(message)) return false;
  if (/\b(?:draw|sketch|diagram|visuali[sz]e|illustrate|annotate|map out|animate|plot|graph it|chart it)\b/.test(message)) return true;
  // Practice: quizzes and exam questions are drawn as cards you answer with a click.
  if (/\b(?:quiz me|test me|drill me|quiz|practi[cs]e (?:questions?|problems?|exam)|exam(?:-style)? questions?|mock (?:exam|test)|past paper questions?)\b/.test(message)) return true;
  if (/\b(?:show|teach|walk|talk) (?:me|us) (?:how|why|what|where|when|the|a|an|through|about)\b/.test(message) || /\b(?:can|could|would) you (?:show|teach|explain|demonstrate)\b/.test(message)) return true;
  if (/\b(?:explain|demonstrate|teach me|break down|help me (?:understand|see|picture|practi[cs]e)|walk me through|derive|prove|solve|work through|step through)\b/.test(message)) return true;
  // "How is a black hole formed?", "why does the gradient point uphill?"
  if (/\b(?:how|why) (?:does|do|is|are|did|was|were|can|would|will) (?!(?:you|i|we)\b)\S+(?: \S+){1,}/.test(message)) return true;
  const pointing = message.replace(/\b(?:this|these|that) (?:morning|afternoon|evening|week|weekend|month|year|time|semester|term)\b/g, '');
  return /\b(?:explain|what(?:'s| is| are| does)|how (?:does|do|is|are))\b.{0,60}\b(?:this|these|that|here)\b/.test(pointing) && /\b(?:this|these|here)\b/.test(pointing);
}

// Show me how: how to do something in the app you're using, so Fairy rings each control on your screen and waits for your
// click. It needs both a how-to ("how do I", "show me how to", "where is") and something done in an app (a UI word or
// action like export, settings, button, turn on), so "how do I find the minimum of f" stays an explanation.
export function wantsShowHow(text: string): boolean {
  const message = String(text).toLowerCase().replaceAll('’', "'").replace(/\s+/g, ' ').trim();
  if (/\b(?:don't|do not)\b.{0,20}\b(?:show|point|guide)/.test(message)) return false;
  const asking = /\b(?:how (?:do|can|would|should) (?:i|we|you)|how to|show me how|walk me through (?:how to )?|guide me|where (?:is|are|do i find|can i find|'s)|help me (?:find|turn|change|set|switch|get to|open))\b/.test(message);
  const inApp = /\b(?:button|menu|toolbar|sidebar|tab|setting|settings|preferences|option|options|dialog|panel|pane|window|app|shortcut|icon|dark mode|light mode|notifications?)\b/.test(message)
    || /\b(?:click|export|import|save as|save (?:this|it|the|my)|print|share|attach|upload|download|install|uninstall|sign (?:in|out)|log (?:in|out)|enable|disable|turn (?:on|off)|switch (?:on|off|to)|toggle|rename|duplicate|bookmark|pin|unpin|zoom|crop|resize|undo|redo|format|insert|merge|split|mute|unmute|subscribe|unsubscribe|add an? (?:account|extension|plugin|filter|column|row|page|slide|tab)|change the (?:theme|font|language|wallpaper|password|default))\b/.test(message);
  return asking && inApp;
}

// "Clear it", "erase the drawing", "clean up the screen": wipes the ink without asking a model.
export function wantsInkClear(text: string): boolean {
  const message = String(text).trim().toLowerCase().replaceAll('’', "'").replace(/[.!]+$/, '')
    .replace(/^(?:(?:ok(?:ay)?|thanks|thank you|great|cool|nice|got it)[, ]+)*(?:please\s+)?/, '').replace(/,?\s+please$/, '');
  if (/^(?:clear|erase|wipe)(?: it all| all)?$/.test(message)) return true;
  const what = String.raw`(?:it|that|this|them|everything|all|it all|(?:the |your |my |those |these )?(?:drawings?|sketch(?:es)?|ink|screen|board|cards?|marks?|notes?))`;
  return new RegExp(String.raw`^(?:clear|erase|wipe|clean up|remove|get rid of|hide)\s+${what}(?:\s+(?:off|from)\s+(?:my |the )?screen)?$`).test(message);
}

export function wantsLatest(text: string): boolean {
  const message = text.toLowerCase();
  if (/\b(?:don't|do not|without|never)\b.{0,30}\b(?:browse|search|internet|web)\b/.test(message)) return false;
  return /\b(?:latest|news|headlines|up.to.date|current developments|new developments|what'?s new|what is new)\b/.test(message)
    || /\b(?:recent|current)\s+(?:research|discoveries|advances|developments|papers|updates|events|releases|prices|weather)\b/.test(message)
    || /\b(?:what happened|what is happening|what'?s happening|who won|what changed)\b.{0,80}\b(?:today|this week|this month)\b/.test(message)
    || /\b(?:search|look up|browse|verify|fact.check)\b/.test(message);
}

// Recognize direct requests locally, without another model round trip. Quoted
// examples and explanations cannot opt the user into desktop control. This
// selects tools only; the native action reviewer still decides what may run.
export function wantsDesktop(text: string): boolean {
  const message = text.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|"[^"\n]*"|“[^”\n]*”|(^|\s)'[^'\n]+'(?=\s|[.,?!]|$)/g, ' quoted-content ')
    .replaceAll('’', "'").trim().toLowerCase();
  if (declinesScreen(message) || /\b(?:don't|do not|never|without|stop)\b.{0,50}\b(?:scroll|click|press|type|open|control|operate|desktop|interact)\b/.test(message)) return false;
  const command = message.replace(/^(?:(?:hey|hi)[, ]+)?(?:(?:fairy|robin|stella|lyra|mavuika|mav|astra)[,:]?\s+)?(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:i(?:'d| would) like|i want|i need)\s+you\s+to\s+|help me\s+(?:to\s+)?)?/, '');
  return /^scroll\b(?:\s+(?:up|down|left|right|through|to|in|on|a little|a bit|this|the|my))?[\s.!?]*$/.test(command)
    || /^scroll\s+(?:up|down|left|right|through|to|in|on|this|the|my|a little|a bit)\b/.test(command)
    || /^(?:click|double[ -]click|right[ -]click|tap)\s+(?:on\s+)?\S/.test(command)
    || /^(?:press|hit)\s+(?:(?:the\s+)?(?:enter|return|escape|esc|tab|space|spacebar|arrow|page\s+(?:up|down)|command|cmd|control|ctrl|shift|option|alt)\b)/.test(command)
    || /^(?:type|paste|enter)\b.+\b(?:into|in|inside)\s+(?:the|this|that|my|a)\s+(?:field|box|document|search|address|editor|form)\b/.test(command)
    || /^(?:open|launch|switch to|bring up)\s+(?:(?:the|this|that|my|a|an|next|previous)\s+)*(?:calculator|finder|preview|textedit|safari|chrome|firefox|spotify|blender|spotlight|app|application|browser|tab|window|document|pdf|file|folder|website|webpage|link|page|settings|https?:\/\/)(?:\b|\/)/.test(command)
    || /^(?:go|jump)\s+to\s+(?:the\s+)?(?:top|bottom|next page|previous page|next tab|previous tab)\b/.test(command)
    || /^(?:switch to|close|select|refresh|reload)\s+(?:(?:the|this|that|next|previous|other|current)\s+)+(?:tab|window|page|button|checkbox|option)\b/.test(command)
    || /^(?:zoom|page)\s+(?:in|out|up|down)\b/.test(command);
}

// "Try again" after a failed integration request belongs to that integration, not to chat.
const RETRY = /^(?:(?:ok(?:ay)?|please|(?:can|could|would) you)[, ]+)*(?:try (?:it |that |this )?again|retry|check again|do (?:it|that) again|again|one more time|i(?:'ve| have)? reconnected)\b/;

export function wantsCalendar(text: string, history: ChatRoutingHistoryEntry[] = []): boolean {
  const message = text.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|"[^"\n]*"|“[^”\n]*”/g, '').replaceAll('’', "'").toLowerCase();
  if (/^(?:how (?:do|can|would)|explain how|translate|what is (?:a|the) calendar)/.test(message.trim()) || /\b(?:don't|do not|without|never)\b.{0,40}\b(?:calendar|schedule|events)\b/.test(message)) return false;
  if (/\b(?:my|google|our)\s+(?:calendar|schedule|agenda|appointments|meetings)\b|\b(?:am i|are we)\s+(?:free|busy|available)\b|\b(?:find|check)\s+(?:my\s+)?(?:free time|availability)\b/.test(message)) return true;
  if (/\b(?:add|put|create|schedule|book)\b.{0,100}\b(?:on|in|to)\s+(?:my|the|google)\s+calendar\b/.test(message) || /^(?:(?:can|could|would) you\s+)?(?:please\s+)?schedule\s+(?:a|an|my|the)\s+(?:meeting|appointment|event|study|focus|workout)\b/.test(message.trim())) return true;
  const last = history.at(-1);
  if (last?.mode === 'calendar' && RETRY.test(message.trim())) return true;
  return last?.mode === 'calendar' && /^(?:what about|how about|and (?:tomorrow|today|next|this)|yes\b|no,|make it\b|at \d|tomorrow\b|today\b|next (?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|call it\b|for \d+ (?:minutes|hours)\b)/.test(message.trim());
}

export function wantsGmail(text: string, history: ChatRoutingHistoryEntry[] = []): boolean {
  const t = text.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|"[^"\n]*"|“[^”\n]*”/g, '').replaceAll('’', "'").trim().toLowerCase();
  if (/^(?:how (?:do|can|would)|explain|translate|what is|what are)\b/.test(t) && !/\b(?:my|unread)\b/.test(t)) return false;
  if (/\b(?:don't|do not|without|never)\b.{0,40}\b(?:gmail|email|inbox|mailbox)\b/.test(t)) return false;
  if (/\b(?:my|unread|new|recent|important)\s+(?:e?mails?|inbox|gmail|messages)\b|\b(?:email|mail|message)s?\s+(?:from|about)\b/.test(t)) return true;
  if (/\b(?:check|search|read|summari[sz]e|find)\b.{0,65}\b(?:gmail|inbox|mailbox|emails)\b/.test(t)) return true;
  if (/\b(?:check|read|summari[sz]e|reply to|extract|suggest)\b.{0,65}\b(?:this|that|the) email\b/.test(t)) return true;
  if (/^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:draft|write|prepare|save)\b.{0,60}\b(?:reply|email|draft)\b/.test(t)) return true;
  if (history.at(-1)?.mode === 'gmail' && RETRY.test(t)) return true;
  return history.at(-1)?.mode === 'gmail' && /^(?:summari[sz]e|read|open|the (?:first|second|third|last|one)|that one|reply|draft|write|save|make it|yes|what about|how about|check (?:those|the times)|suggest|extract)\b/.test(t);
}

// Neutrino: hosted local git server, pull requests, review notes, Graviton CI, GitHub mirrors, branch rules, and Vault metadata.
export function wantsNeutrino(text: string, history: ChatRoutingHistoryEntry[] = []): boolean {
  const t = text.replace(/```[\s\S]*?(?:```|$)|`[^`]*`/g, '').replaceAll('’', "'").trim().toLowerCase();
  if (/\b(?:don't|do not|without|never)\b.{0,30}\b(?:neutrino|ntr|graviton)\b/.test(t)) return false;
  if (/^(?:how (?:do|can|would)|explain|what is|what are|what's the difference)\b/.test(t) && !/\b(?:my|our|this|that|waiting|failing|open|running|pending|status|prs?|runs?|mirrors?)\b/.test(t)) return false;
  if (/\b(?:neutrino|neutrinod|ntr|graviton)\b/.test(t)) return true;
  if (/\bmirror(?:s|ing)?\b.{0,40}\b(?:github|status|failing|sync|now|pending)\b|\b(?:sync|Sync)\s+(?:the\s+)?mirrors?\b/.test(t)) return true;
  if (/\b(?:deploy(?:ment)?\s+approvals?|waiting\s+deploy(?:s|ments?)?|approve\s+(?:the\s+|pending\s+)?deploy)\b/.test(t)) return true;
  if (/\bbranch\s+rules?\b.{0,40}\b(?:repo|repository|main|master|branch|checks?)\b/.test(t)) return true;
  if (/\b(?:hosted\s+repos?(?:itor(?:y|ies))?|create\s+(?:a\s+)?hosted\s+repo)\b/.test(t)) return true;
  return history.at(-1)?.mode === 'neutrino' && (/^(?:and|also|what about|then|now|ok|okay|yes|reply|note|merge|approve|rerun|cancel|sync|show|read|open)\b/.test(t) || /\b(?:it|that one|the log|the diff|that pr|that run|the mirror)\b/.test(t));
}

// GitHub: pull requests, reviews, checks and CI, issues and repositories. Plain words such as "issue" or "build" need a
// GitHub context around them, so "an issue with my essay" stays a chat.
export function wantsGitHub(text: string, history: ChatRoutingHistoryEntry[] = []): boolean {
  const t = text.replace(/```[\s\S]*?(?:```|$)|`[^`]*`/g, '').replaceAll('’', "'").trim().toLowerCase();
  if (/\b(?:don't|do not|without|never)\b.{0,30}\b(?:github|pull request|pr)\b/.test(t)) return false;
  if (/^(?:how (?:do|can|would)|explain|what is|what are|what's the difference)\b/.test(t) && !/\b(?:my|our|this|that)\b/.test(t)) return false;
  if (/\bgithub\b|\bgh (?:pr|issue|run)\b/.test(t)) return true;
  if (/\b(?:pull requests?|prs?)\s*#?\d+\b|\bpr\s*#\d+\b|\bissue\s*#\d+\b/.test(t)) return true;
  if (/\b(?:my|our|open|the|this|that|review(?:ing)?|merged)\s+(?:pull requests?|prs)\b/.test(t)) return true;
  if (/\b(?:review comments?|code review|review requests?|requested (?:my )?review)\b/.test(t)) return true;
  if (/\b(?:pull requests?|prs)\b.{0,40}\b(?:wait(?:ing)?|need(?:s|ing)?|assigned|for (?:my|me)|to review)\b/.test(t)) return true;
  if (/\b(?:ci|checks?|github actions|workflow runs?|actions run)\b.{0,40}\b(?:fail(?:ed|ing|s|ure)?|red|broken|pass(?:ed|ing)?|green|status|log)\b/.test(t)) return true;
  if (/\bwhy (?:is|did) (?:the |my )?(?:ci|build|checks?|workflow)\b/.test(t)) return true;
  if (/\b(?:open|create|file|raise|close|list|triage)\s+(?:an?\s+|the\s+|my\s+)?issues?\b.{0,40}\b(?:repo|repository|project|lyra|github)\b/.test(t)) return true;
  if (/\b(?:my|open) issues\b.{0,30}\b(?:repo|repository|on|in)\b/.test(t)) return true;
  return history.at(-1)?.mode === 'github' && (/^(?:and|also|what about|then|now|ok|okay|yes|reply|post|comment|approve|show|read|open)\b/.test(t) || /\b(?:it|that one|the log|the diff|that pr|that issue)\b/.test(t));
}

export function wantsDrive(text: string, history: ChatRoutingHistoryEntry[] = []): boolean {
  const t = text.replace(/```[\s\S]*?(?:```|$)|`[^`]*`|"[^"\n]*"|“[^”\n]*”/g, '').replaceAll('’', "'").trim().toLowerCase();
  if (/^(?:how (?:do|can|would)|explain|translate|what is|what are)\b/.test(t) && !/\b(?:my|drive|google doc)\b/.test(t)) return false;
  if (/\b(?:don't|do not|without|never)\b.{0,40}\b(?:drive|google drive|doc|sheet)\b/.test(t)) return false;
  if (/\b(?:google\s+drive|gdrive|my\s+drive)\b/.test(t)) return true;
  if (/\b(?:search|find|check|list|open|look for|browse)\b.{0,60}\b(?:in|on)\s+(?:my\s+)?(?:google\s+)?drive\b/.test(t)) return true;
  if (/\b(?:read|summari[sz]e|check|open|find|inspect)\s+(?:my\s+)?(?:google\s+)?(?:doc|document|spreadsheet|sheet|slides?)\b/.test(t)) return true;
  if (/\b(?:google\s+docs?|google\s+sheets?|google\s+slides?)\b/.test(t)) return true;
  if (/\b(?:create|make|write|save)\b.{0,50}\b(?:on|in|to)\s+(?:my\s+)?(?:google\s+)?drive\b/.test(t)) return true;
  if (history.at(-1)?.mode === 'drive' && RETRY.test(t)) return true;
  return history.at(-1)?.mode === 'drive' && /^(?:summari[sz]e|read|open|the (?:first|second|third|last|one)|that one|what about|how about|search for|find|check|yes|next|what's inside|what is inside)\b/.test(t);
}

// Only the current user's direct command can authorize a file mutation.
// Quoted prose/code is data, including imperative sentences in pasted material.
export function summaryWriteRequest(text: unknown): SummaryWriteRequest | null {
  const message = String(text).replaceAll('’', "'").trim();
  if (/[\n\r]|```|~~~/u.test(message) || /\b(?:don't|do not|never|without|not yet|only explain|just explain|instead of|unless|if|hypothetical|example only|draft only)\b/i.test(message)) return null;
  if (/\b(?:in|within)\s+(?:(?:this|your|the)\s+)?(?:chat|reply|answer)\b/i.test(message)) return null;
  const command = message.replace(/^(?:(?:hey|hi)[, ]+)?(?:(?:fairy|robin|stella|lyra)[,:]?\s+)?(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:i(?:'d| would) like|i want|i need)\s+you\s+to\s+)?/i, '');
  if (!/^summari[sz]e\s+/i.test(command)) return null;
  const match = command.match(/^summari[sz]e\s+(.+?)\s+(?:into|to)\s+(.+)$/i);
  if (!match) return null;
  const sources = [...match[1].matchAll(/([\w-]+)\.pdf\b/gi)];
  if (sources.length !== 1) return null;
  let destination = match[2].trim().replace(/[.!?]$/, '');
  if (/^["'`“]/.test(destination)) {
    const closeMap: Record<string, string> = { '"': '"', "'": "'", '`': '`', '“': '”' };
    const close = closeMap[destination[0]];
    if (!close || !destination.endsWith(close)) return null;
    destination = destination.slice(1, -1);
  }
  if (!/^(?:~\/|\/)[\p{L}\p{N}_ ./-]+$/u.test(destination)) return null;
  if (/\s+(?:and|then|but|please)\s+/i.test(destination)) return null;
  if (/\.[a-z0-9]+$/i.test(destination) && !/\.(?:md|markdown)$/i.test(destination)) return null;
  const target = /\.(?:md|markdown)$/i.test(destination) ? destination : `${destination.replace(/\/+$/, '')}/${sources[0][1]}-summary.md`;
  return { operation: 'create', target };
}

export function fileWriteRequest(text: unknown): SummaryWriteRequest | FileWriteRequest | null {
  const summary = summaryWriteRequest(text);
  if (summary) return summary;
  const pathPattern = /^(?:~\/|\/)?[\w./ -]+\.(?:txt|md|markdown|py|tex|csv|tsv|json|yaml|yml|toml|ini|cfg|lp|mps|dat|jl|r|c|cpp|h|hpp|js|mjs|ts|sql|rst|log)$/i;
  const paths: string[] = [];
  const message = String(text).replaceAll('’', "'")
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, ' quoted-content ')
    .replace(/`+([^`\n]*)`+|"([^"\n]*)"|“([^”\n]*)”|(?<![\p{L}\p{N}])'([^'\n]+)'/gu, (_all, ...parts: Array<string | undefined>) => {
      const value = parts.slice(0, 4).find(v => v !== undefined)?.trim() || '';
      if (pathPattern.test(value)) { paths.push(value); return ` FILETARGET${paths.length - 1} `; }
      return ' quoted-content ';
    }).trim();
  const command = message.replace(/^(?:(?:hey|hi)[, ]+)?(?:(?:fairy|robin|stella|lyra)[,:]?\s+)?(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:i(?:'d| would) like|i want|i need)\s+you\s+to\s+)?/i, '');
  const verb = command.match(/^(create|write|save|append|edit|update|replace|overwrite)\b/i)?.[1]?.toLowerCase();
  if (/\b(?:in|within)\s+(?:(?:this|your|the)\s+)?(?:chat|reply|answer)\b|\b(?:hypothetical|example only|draft only)\b/i.test(message)) return null;
  if (!verb || /\b(?:don't|do not|never|without|not yet|only explain|just explain|instead of|unless|if)\b/i.test(message)) return null;
  // Content after a colon/newline is never a destination or authorization.
  const header = command.split(/[:\n]/, 1)[0];
  const matches = [...header.matchAll(/FILETARGET(\d+)|(?:~\/|\/)?[\w.-]+(?:\/[\w.-]+)*\.(?:txt|md|markdown|py|tex|csv|tsv|json|yaml|yml|toml|ini|cfg|lp|mps|dat|jl|r|c|cpp|h|hpp|js|mjs|ts|sql|rst|log)(?![\w.])/gi)];
  const candidates = matches.map(m => m[1] !== undefined ? paths[Number(m[1])] : m[0]);
  if (candidates.length === 1) {
    const prefix = header.slice(verb.length, matches[0].index).trim();
    const direct = /^(?:(?:a|the|my|new|text|markdown|python|json|file|named|called|at)\s*)*$/i.test(prefix);
    const destination = ['write', 'save', 'append'].includes(verb) && /\b(?:to|into|in|inside)\b\s*(?:(?:a|the|my|new|text|markdown|file|named|called|at)\s*)*$/i.test(prefix);
    if (!direct && !destination) return null;
  }
  if (!candidates.length && !/\bfile\b/i.test(header)) return null;
  return {
    operation: verb === 'create' ? 'create' : verb === 'append' ? 'append' : ['edit', 'update', 'replace', 'overwrite'].includes(verb) ? 'update' : 'write',
    target: candidates.length === 1 ? candidates[0] : null,
  };
}

export function wantsFiles(text: string, history: ChatRoutingHistoryEntry[] = []): boolean {
  if (fileWriteRequest(text)) return true;
  let quotedFile = false;
  const t = String(text).replaceAll('’', "'")
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, ' quoted-content ')
    .replace(/`([^`\n]+)`|"([^"\n]+)"|“([^”\n]*)”|(?<![\p{L}\p{N}])'([^'\n]+)'/gu, (_all, ...groups: Array<string | undefined>) => {
      const value = groups.slice(0, 4).find(v => v !== undefined)?.trim() || '';
      if (readFileName.test(value) && !/[!?\n]/.test(value) && !/^(?:read|find|search|inspect|explain|check|summari[sz]e|access|open|delete|write|create|do not|don't)\s/i.test(value)) {
        quotedFile = true;
        return ' file-reference ';
      }
      return ' quoted-content ';
    }).trim().toLowerCase();
  if (/\b(?:don't|do not|without|never)\b.{0,45}\b(?:read|search|inspect|access|open|files?|folders?|lab)\b/.test(t) || /\b(?:can|could|would|will) you not\b/.test(t)) return false;
  if (/^translate\b/.test(t)) return false;
  if (history.at(-1)?.mode === 'files' && /^(?:explain|why|what about|how about|how (?:can|do|should|would)|and |read|find|search|check|show|the |that |this |which |what does|how does|can you|could you|yes|continue|next)\b/.test(t)) return true;
  if (/^(?:how (?:do|can) i|what is a|what are)\b/.test(t)) return false;
  if (/~\/|\/users\/|\b(?:local|approved|coursework) (?:files?|folders?)\b|\bmy (?:mip |optimization )?(?:lab|coursework|assignment|notebook|project|files?|folders?)\b/.test(t)) return true;
  if (/\b(?:read|find|search|inspect|explain|check|summari[sz]e|why|access|locate|show)\b/.test(t) && (quotedFile || readFileName.test(t) || /\b(?:mip|optimization) lab\b/.test(t))) return true;
  if (/\b(?:read|list|search|inspect|browse|access)\b/.test(t) && /\b(?:the|my|this|that|local|approved)\s+(?:files?|folders?|directory|directories)\b/.test(t)) return true;
  return history.at(-1)?.mode === 'files' && /^(?:explain|why|what about|how about|and |read|find|search|check|show|the |that |this |which |what does|how does|can you|could you|yes|continue|next)\b/.test(t);
}

// Asking for interactive A2UI widgets in chat (/ui or interactive card/widget/form/calculator/checklist requests).
export function wantsA2UI(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/^\/ui(?:\s|$)/i.test(t)) return true;
  if (wantsPage(t) && pageKind(t) !== 'a2ui') return false;
  return /\b(?:a2ui|interactive\s+(?:ui|card|form|widget|calculator|planner|checklist|converter|picker|controls?))\b/i.test(t);
}

// Asking for a page to look at, as opposed to mentioning one, or writing a page of prose.
const A2UI_PAGE = /\b(?:a2ui|interactive\s+(?:ui|form|widget|calculator|planner|checklist|converter))\b/i;

export function wantsPage(text: string, history: ChatRoutingHistoryEntry[] = []): boolean {
  const t = String(text || '').trim();
  if (/^\s*(?:what|who|why|where|when|how)\b/i.test(t) || /^\/ui(?:\s|$)/i.test(t)) return false;
  if (/\b(?:make|create|build|design|generate|put together)\b[^.?!\n]{0,60}\b(?:web ?page|html page|landing page|artifact|dashboard|tracker|scorecard|one-pager|infographic|slides?|slide ?deck|deck|presentation|mock-?ups?|wireframes?|(?:design|ui)\s+(?:concepts?|mock-?ups?|options|variations|directions|renders?)|renders? of|a2ui|interactive\s+(?:ui|form|widget|calculator|planner|checklist|converter)|(?:a|an|me a|my)\s+(?:\w+\s+){0,3}page)\b(?!\s+break)/i.test(t)) return true;
  if (/\b(?:make|create|write|draft|generate|put together)\b[^.?!\n]{0,40}\b(?:a|an|me a|the|my)\s+(?:\w+\s+){0,3}(?:document|doc|report|proposal|memo|write-?up)\b/i.test(t)) return true;
  if (WHITEBOARD.test(t) && /\b(?:make|create|build|start|open|sketch|draw|map(?:\s+out)?|lay\s+out|brainstorm|diagram|plan|put|jot|organi[sz]e|show|set up|on|onto|in)\b/i.test(t)) return true;
  if (SHEET.test(t) && /\b(?:make|create|build|start|set up|put|list|track|tabulate|organi[sz]e|collect|enter|record|log|turn|convert|keep|move|import|on|onto|in|into)\b/i.test(t)) return true;
  return history.at(-1)?.mode === 'page' && /^(?:please\s+|can you\s+|could you\s+|now\s+)?(?:change|make it|make the|add|remove|update|fix|edit|use|try|move|replace|rename|turn it)\b/i.test(t);
}

// A whiteboard, and a spreadsheet as opposed to a cheat sheet, a Google Sheet or a sheet of paper.
const WHITEBOARD = /\b(?:white ?board|mind ?map|sticky notes|post-?its?|flow ?chart|brainstorm(?:ing)? board|concept map)\b/i;
const SHEET = /\b(?:spread ?sheet|(?<!(?:cheat|google|style|fact|balance|answer|work|music|data|bed|cookie|baking|title|cover|spec|tip|info|crib)\s*)sheet)s?\b(?!\s+(?:of paper|music|metal|mask|pan|cake))/i;

// Which kind of thing was asked for, the most specific first.
export function pageKind(text: string): 'a2ui' | 'slides' | 'canvas' | 'whiteboard' | 'sheet' | 'dashboard' | 'page' | 'doc' {
  const t = String(text || '');
  if (A2UI_PAGE.test(t)) return 'a2ui';
  if (/\b(?:slides?|slide ?deck|deck|presentation)\b/i.test(t)) return 'slides';
  if (/\b(?:design|ui)\s+(?:concepts?|mock-?ups?|options|variations|directions|renders?)\b|\bmock-?ups?\b|\bwireframes?\b|\brenders? of\b/i.test(t)) return 'canvas';
  if (WHITEBOARD.test(t)) return 'whiteboard';
  if (SHEET.test(t)) return 'sheet';
  if (/\b(?:dashboard|tracker|scorecard)\b/i.test(t)) return 'dashboard';
  if (/\b(?:web ?page|landing page|artifact|one-pager|infographic)\b/i.test(t)) return 'page';
  if (/\b(?:document|doc|report|proposal|memo|write-?up)\b/i.test(t)) return 'doc';
  return 'page';
}

// Whether a page request changes the chat's latest page. Asking outright for another kind, such as a sheet after a
// whiteboard, starts a new one; "make it blue" or "add a column" changes the last.
export function changesPage(text: string, kind: string): boolean {
  return !(wantsPage(text) && pageKind(text) !== kind);
}

// Attached files are the whole job unless the message reaches for the approved folders as well.
export const asksAboutFolders = (text: string): boolean =>
  /~\/|\/users\/|\b(?:my|approved|local)\s+(?:\w+\s+)?(?:notes|files|folders?|vault|books?|library|coursework|labs?|project)\b/i.test(String(text));

// Starting a separate work session for a task, or messaging one this chat started.
export function wantsSessions(text: string, history: ChatRoutingHistoryEntry[] = []): boolean {
  const t = String(text || '').toLowerCase();
  if (/\b(?:don't|do not|without|no need to)\b.{0,30}\bsessions?\b/.test(t)) return false;
  if (/\b(?:start|open|spin up|split|kick off|make|create|propose|offer|hand|give|run|put)\b.{0,80}\b(?:(?:its|their) own|separate|side|new|another|sub-?|parallel|background)\s+(?:work\s+)?sessions?\b/.test(t)) return true;
  if (/\b(?:message|tell|ask|answer|reply to)\s+(?:the|that|my)\s+(?:side\s+|sub-?|other\s+|linked\s+)?session\b/.test(t)) return true;
  // Any work session, by its name: "message the Notebook search session…", "send a message to my build session".
  if (/\b(?:message|send (?:a )?message to)\s+(?:the|that|my)\s+[\w’'.\- ]{1,50}?\s+session\b/.test(t)) return true;
  // Which sessions are running: "which sessions are working?", "list my other sessions".
  if (/\b(?:which|what)\s+(?:other\s+|work\s+)?sessions\s+(?:are\s+)?(?:running|working|open)\b|\b(?:list|show(?: me)?)\s+(?:my|the)\s+(?:other\s+|running\s+|work\s+)*sessions\b/.test(t)) return true;
  return history.at(-1)?.mode === 'sessions' && /^(?:yes|yeah|ok|okay|sure|go ahead|start it|do it|in|use|the folder|~\/|\/)/.test(t.trim());
}

export function requestMode(
  text: string,
  mode: string,
  settings: { autoDesktop?: string; autoScreen?: string },
  history: ChatRoutingHistoryEntry[] = [],
  attached = false,
): string {
  if (attached && ['chat', 'files'].includes(mode)) return wantsPage(text) && pageKind(text) !== 'dashboard' ? 'page' : 'files';
  if (['chat', 'desktop'].includes(mode) && clipboardRequest(text)) return 'clipboard';
  // Explicit local writes always use the scoped file tools, including from Desktop task.
  if (['chat', 'desktop'].includes(mode) && fileWriteRequest(text)) return 'files';
  if (mode !== 'chat') return mode;
  if (wantsSessions(text, history)) return 'sessions';
  if (settings.autoDesktop === 'on' && wantsDesktop(text)) return 'desktop';
  if (settings.autoScreen === 'on' && wantsScreen(text)) return 'screen';
  // A dashboard mentions calendars and email without needing them read now: the page reads them itself.
  if (wantsPage(text) && pageKind(text) === 'dashboard') return 'page';
  // A page reads approved folders itself, so asking it to read them doesn't make this a file question.
  if (wantsFiles(text)) return wantsPage(text) ? 'page' : 'files';
  // Explicit requests for another integration override local-file follow-ups.
  if (wantsDrive(text)) return 'drive';
  if (wantsGmail(text)) return 'gmail';
  if (wantsCalendar(text)) return 'calendar';
  if (wantsNeutrino(text)) return 'neutrino';
  if (wantsGitHub(text)) return 'github';
  if (/\b(?:my notes|my books|my library|my textbooks|my vault|onyxvault|obsidian|second brain)\b/i.test(text)) return 'chat';
  // Attached files stay in the conversation until it moves on to something else.
  if (history.at(-1)?.mode === 'files' && history.slice(-10).some(entry => entry.attachments?.length)) return 'files';
  if (wantsFiles(text, history)) return 'files';
  if (wantsDrive(text, history)) return 'drive';
  if (wantsGmail(text, history)) return 'gmail';
  if (wantsCalendar(text, history)) return 'calendar';
  if (wantsNeutrino(text, history)) return 'neutrino';
  if (wantsGitHub(text, history)) return 'github';
  if (wantsPage(text, history)) return 'page';
  return 'chat';
}
