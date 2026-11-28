export const REACTION_KINDS = ['laugh', 'surprise', 'pout'] as const;

export type ReactionKind = (typeof REACTION_KINDS)[number];

export interface ConversationReactionOutput {
  kind: ReactionKind | null;
  frame: number;
}

export interface ConversationReactionTickOptions {
  allowed?: boolean;
  ready?: boolean;
}

// Deliberately conservative and local; no extra model request, metadata or TTS tags.
export function replyReaction(reply: unknown, user: unknown = ''): ReactionKind | null {
  const text = String(reply || '')
    .slice(0, 6000)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .trim()
    .slice(0, 280);
  const context = `${String(user || '').slice(0, 2000)} ${text}`;
  if (/\b(?:grief|died|death|funeral|suicid\w*|abuse|assault|cancer|diagnos\w*|emergency|depress\w*|not funny|not joking)\b/i.test(context)) {
    return null;
  }
  if (/^(?:[“"*\s]*(?:ha(?:ha)+|he(?:he)+|lol|that(?:'s| is) hilarious|you made me laugh|that made me laugh)\b|[“"*\s]*[😂🤣])/i.test(text)) {
    return 'laugh';
  }
  if (/^[“"*\s]*(?:wow|whoa|oh wow|that(?:'s| is) surprising|i didn['’]t expect that)\b/i.test(text)) {
    return 'surprise';
  }
  if (/^[“"*\s]*(?:hmph|hey[,!]?[ ]+no fair|you(?:'re| are) teasing me)\b/i.test(text)) {
    return 'pout';
  }
  return null;
}

export class ConversationReaction {
  output: ConversationReactionOutput;
  kind: ReactionKind | null;
  time: number;
  cooldown: number;

  constructor() {
    this.output = { kind: null, frame: 0 };
    this.kind = null;
    this.time = 0;
    this.cooldown = 0;
  }

  play(kind: string, manual = false): boolean {
    if (!REACTION_KINDS.includes(kind as ReactionKind) || (!manual && this.cooldown > 0)) return false;
    this.kind = kind as ReactionKind;
    this.time = 0;
    this.cooldown = 12;
    return true;
  }

  stop(): void {
    this.kind = null;
    this.time = 0;
  }

  tick(dt: number, { allowed = true, ready = true }: ConversationReactionTickOptions = {}): void {
    dt = Math.max(0, Math.min(0.1, dt));
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!allowed) {
      this.stop();
      return;
    }
    if (this.kind && ready) {
      this.time += dt;
      if (this.time >= 4.8) this.stop();
    }
  }

  sample(): ConversationReactionOutput {
    this.output.kind = this.kind;
    this.output.frame = Math.min(5, Math.floor(this.time / 0.8));
    return this.output;
  }
}
