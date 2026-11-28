// Following the question you're on in the paper beside the tutor (docs: "Notebook paper view and clippings", stage 4).
// The paper's map comes from the mini (desktop/notebook/questions.mjs); here: where you are as you scroll, a click or a
// question that names one fixing it until you scroll a page away, and picking one from the list.

export interface QuestionPlace {
  key: string;
  page: number;
  y: number;
}

export interface QuestionFollower {
  readonly places: readonly QuestionPlace[];
  read: (page: number, y: number) => void;
  fix: (key: string) => boolean;
  at: () => string | null;
  fixed: () => boolean;
}

const flat = (text: unknown): string => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
// The ways a place can be named in a message: its whole name ("question4b", "problem2part12"), and without its first
// word ("4b", "2part12"), but never a bare number, which is too common to mean a question.
function namesOf(key: string): string[] {
  const whole = flat(key), short = flat(key.replace(/^\S+\s+/, ''));
  return [whole, ...(/[a-z]/.test(short) && short.length >= 2 ? [short] : [])];
}
// The place a message names, the longest name found winning; null when it names none.
export function namedIn(text: unknown, places: readonly QuestionPlace[] | null | undefined): QuestionPlace | null {
  const said = flat(text);
  let best: QuestionPlace | null = null;
  let length = 0;
  for (const place of places || []) for (const name of namesOf(place.key)) if (name.length > length && said.includes(name)) { best = place; length = name.length; }
  return best;
}

// The last place that starts above y on page, or on a page before it (as questions.mjs placeAt).
export function placeAt(places: readonly QuestionPlace[] | null | undefined, page: number, y: number): QuestionPlace | null {
  let found: QuestionPlace | null = null;
  for (const place of places || []) { if (place.page < page || (place.page === page && place.y <= y + 0.005)) found = place; else break; }
  return found;
}

// One paper's following: places, its map; at(), the key you're on. read(page, y) as you scroll; fix(key) for a click,
// a named question or one picked from the list, which holds until you've scrolled to a page that isn't the fixed one's
// or its neighbour.
export function follower(places: readonly QuestionPlace[]): QuestionFollower {
  let reading: QuestionPlace | null = null;
  let fixed: QuestionPlace | null = null;
  return {
    places,
    read(page, y) { reading = placeAt(places, page, y); if (fixed && Math.abs(page - fixed.page) > 1) fixed = null; },
    fix(key) { const place = places.find(p => p.key === key); if (place) fixed = place; return Boolean(place); },
    at: () => (fixed || reading)?.key || null,
    fixed: () => Boolean(fixed),
  };
}
