export const IDLE_TOPIC = 'saved idle dialogue';

export interface IdleDialogueSettings {
  idleDialogueMode?: string;
  idleDialogueLines?: string;
}

export interface IdleHistoryEntry {
  role?: string;
  mode?: string;
  topic?: string;
  content?: string;
}

export interface IdleDialogueChoice {
  text: string;
  topic: string;
}

export function parseIdleLines(value = ''): string[] {
  if (typeof value !== 'string' || value.length > 12000) throw new Error('Keep saved idle dialogue within 12,000 characters.');
  const lines = [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean))];
  if (lines.length > 30) throw new Error('Save up to 30 idle lines, one per line.');
  if (lines.some(line => line.length > 500)) throw new Error('Keep each idle line within 500 characters.');
  return lines;
}

export function chooseIdleDialogue(
  settings: IdleDialogueSettings,
  history: IdleHistoryEntry[],
  random: () => number = Math.random,
): IdleDialogueChoice | null {
  if (settings.idleDialogueMode !== 'mixed') return null;
  const lines = parseIdleLines(settings.idleDialogueLines || '');
  if (!lines.length) return null;
  const recent = history.filter(entry => entry.role === 'assistant' && entry.mode === 'proactive');
  // Keep two ordinary openings between saved lines. News retains first priority.
  if (recent.slice(-2).some(entry => entry.topic === IDLE_TOPIC)) return null;
  const previous = recent.filter(entry => entry.topic === IDLE_TOPIC).slice(-Math.min(3, lines.length - 1)).map(entry => entry.content);
  const available = lines.length === 1 ? lines : lines.filter(line => !previous.includes(line));
  const choices = available.length ? available : lines;
  return { text: choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))], topic: IDLE_TOPIC };
}
