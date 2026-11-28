// Auto by task's moves (docs/auto-by-task-plan.md, stage 5): when a pick goes to another provider's model, and how a
// chat or work session stays with it. Main runs these with Fairy's router and settings; they're here to be tested.
//
// A move happens only for a kind you turned on (autoKinds, with autoByTask on), to a provider you allow, where the shadow
// pick (pick.mjs) says the move is free and clear: a new chat's first message, a work session's first turn, or a job.
// After that a chat or session stays on the provider it started on; Choose another moves a chat on your say.

export interface ChatHistoryAutoMeta {
  provider?: string | null;
  model?: string | null;
}

export interface ChatHistoryEntry {
  role?: string;
  auto?: ChatHistoryAutoMeta | null;
}

export interface ShadowMove {
  moved?: boolean;
  provider: string;
  model?: string;
}

export interface ShadowOffer {
  provider: string;
  [key: string]: unknown;
}

export interface PickShadow {
  moved?: boolean;
  provider?: string;
  model?: string;
  offer?: ShadowOffer;
  [key: string]: unknown;
}

export interface RouterPick {
  provider: string;
  model?: string;
  kind?: string;
  shadow?: PickShadow;
  byTaskMoved?: boolean;
  chosen?: boolean;
  [key: string]: unknown;
}

export interface RouterLike {
  pick(input: {
    provider: string;
    text: string;
    context: readonly unknown[];
    where: string;
    signal?: AbortSignal;
    spoken: boolean;
    place: 'new-chat' | 'chat';
  }): Promise<RouterPick | null>;
}

export interface ChatPickOptions {
  router: RouterLike;
  yours: string;
  text: string;
  context?: readonly unknown[];
  history?: readonly ChatHistoryEntry[];
  where?: string;
  signal?: AbortSignal;
  spoken?: boolean;
  forced?: string;
  kindsOn?: readonly string[];
  allowed?: readonly string[];
  declined?: readonly string[];
  log?: (event: {
    type: 'override';
    where: string;
    kind: string | null;
    from: string;
    to: string;
    fromModel: string | null;
    toModel: string | undefined;
  }) => void;
}

export interface ChatPickResult {
  pick: RouterPick;
  used: string;
  held: boolean;
}

export interface WorkMoveOptions {
  pick?: RouterPick | null;
  standIn?: { provider: string } | null;
  sessionProvider?: string | null;
  firstTurn?: boolean;
  kindsOn?: readonly string[];
  allowed?: readonly string[];
}

export type WorkMoveResult =
  | { provider: string; model?: string; moved: true }
  | { provider: string | null; moved: false };

// The provider a chat is held to: the one by task chose at its first message, or you chose with Choose another.
export const chatProviderOf = (history?: readonly ChatHistoryEntry[]): string | null =>
  [...(history || [])].reverse().find(entry => entry?.role === 'assistant' && entry.auto?.provider)?.auto?.provider || null;

// The shadow pick, as a move, when it may be made: for a kind that's on, to an allowed provider.
export const byTaskMove = (
  pick: RouterPick | null | undefined,
  { kindsOn = [], allowed = [] }: { kindsOn?: readonly string[]; allowed?: readonly string[] } = {},
): ShadowMove | null =>
  pick?.shadow?.moved && pick.kind && kindsOn.includes(pick.kind) && pick.shadow.provider && allowed.includes(pick.shadow.provider)
    ? (pick.shadow as ShadowMove)
    : null;

// A chat turn's pick: on the provider you chose with Choose another, else the one the chat is held to, else yours; and
// at a new chat's first message, by task where it's on. Returns null without a pick, else { pick, used, held }, held
// meaning the chat is kept on used from here on (the reply records it as auto.provider).
// declined: kinds whose mid-chat offer you turned down in this chat (stage 6), which aren't offered again.
export async function chatPick({
  router,
  yours,
  text,
  context = [],
  history = [],
  where = 'chat',
  signal,
  spoken = false,
  forced = '',
  kindsOn = [],
  allowed = [],
  declined = [],
  log = () => {},
}: ChatPickOptions): Promise<ChatPickResult | null> {
  if (!yours) return null;
  const held = where === 'chat' ? chatProviderOf(history) : null, chosen = where === 'chat' && allowed.includes(forced) ? forced : '';
  const provider = chosen || held || yours;
  let pick = await router.pick({ provider, text, context, where, signal, spoken, place: where === 'chat' && !context.length && !chosen ? 'new-chat' : 'chat' });
  if (!pick) return null;
  const moved = !chosen && !held && !spoken && where === 'chat' ? byTaskMove(pick, { kindsOn, allowed }) : null;
  if (moved) pick = { ...pick, provider: moved.provider, model: moved.model, byTaskMoved: true };
  // Choose another is evidence for the use layer (evidence.mjs): the model you left and the one you chose.
  const left = [...history].reverse().find(entry => entry?.role === 'assistant' && entry.auto?.model)?.auto?.model || null;
  if (chosen) { pick = { ...pick, chosen: true }; log({ type: 'override', where, kind: pick.kind || null, from: held || yours, to: chosen, fromModel: left, toModel: pick.model }); }
  // A mid-chat offer is made only for a kind that's on, and not again for one you turned down in this chat.
  if (pick.shadow?.offer && (!pick.kind || !kindsOn.includes(pick.kind) || declined.includes(pick.kind) || !allowed.includes(pick.shadow.offer.provider))) {
    const { offer: _offer, ...shadow } = pick.shadow;
    pick = { ...pick, shadow };
  }
  const used = pick.provider;
  return { pick, used, held: Boolean(moved || chosen || (held && held !== yours)) };
}

// A work turn's provider: a stand-in when yours can't take it; else the session's own once by task chose it; else, at
// the session's first turn, by task where it's on. Returns { provider, moved } (moved: keep it on the session).
export function workMove({ pick, standIn = null, sessionProvider = null, firstTurn = false, kindsOn = [], allowed = [] }: WorkMoveOptions): WorkMoveResult {
  if (standIn) return { provider: standIn.provider, moved: false };
  if (sessionProvider && allowed.includes(sessionProvider)) return { provider: sessionProvider, moved: false };
  const moved = pick && firstTurn ? byTaskMove(pick, { kindsOn, allowed }) : null;
  return moved ? { provider: moved.provider, model: moved.model, moved: true } : { provider: null, moved: false };
}
