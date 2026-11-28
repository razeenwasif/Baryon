import { BookKeywords, type BookKeywordsData } from './book-keywords.mjs';
import { noteTokens, type NoteSearchHit } from './notes.mjs';

export interface BookPassageInput {
  id: string;
  path: string;
  page: number | string;
  answer: string;
  question?: string;
}

export interface BookPassagesData {
  priors: Float32Array;
  overview: Float32Array;
  explicit: Float32Array;
  index: BookKeywordsData;
}

interface PageSummary {
  text: string;
  enough: boolean;
  technical: boolean;
  kind?: string;
  introductory?: boolean;
}

// Strip the retrieval request, not the subject the user wants to learn about.
export function bookQuery(text: unknown): string {
  return String(text)
    .replace(/\b(?:my|our)\s+(?:books?|textbooks?|library)\b/gi, ' ')
    .replace(/^\s*(?:according to|based on|using|from)\s+(?:the\s+)?(?:books?|textbooks?|library)\s*[,,:]?/i, ' ')
    .replace(/\b(?:say about|tell me about|can you|could you)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function pageKind(text: unknown): string {
  const head = String(text).split('\n').slice(0, 5).join('\n');
  const match = head.match(/(?:^|\n)\s*(?:(?:\d+|[ivxlcdm]+)\s+)?(preface|foreword|bibliography|references|table of contents|list of (?:figures|tables|algorithms)|contents|index|authors|acknowledgements|acknowledgments)(?:\s+(?:\d+|[ivxlcdm]+))?\s*(?:\n|$)/i);
  if (match) return match[1].toLowerCase();
  if (/copyright|all rights reserved|isbn[ :\d-]/i.test(head) && !/chapter|algorithm/i.test(head)) return 'publication';
  return 'body';
}

const TECHNICAL = /algorithm|function|procedure|theorem|proof/i;
const INTRODUCTORY = /\bintroduction\b|\boverview\b|\bbasic (?:concepts|principles)\b/i;
const lineBreaks = (text: string): number => {
  let n = 0;
  for (let i = text.indexOf('\n'); i >= 0 && n < 5; i = text.indexOf('\n', i + 1)) n++;
  return n;
};

export class BookPassages {
  priors: Float32Array;
  overview: Float32Array;
  explicit: Float32Array;
  index: BookKeywords;

  constructor(values: Iterable<BookPassageInput>) {
    const items = [...values];
    const pages = new Map<string, PageSummary>();
    this.priors = new Float32Array(items.length);
    this.overview = new Float32Array(items.length);
    this.explicit = new Float32Array(items.length);
    // A page is its passages joined by line breaks, but only its start (first five lines, first 220 characters) and
    // whether any of it mentions an algorithm, function, procedure, theorem or proof are used, so only those are kept.
    // A whole copy of every page cost as much as the books' text itself. (The words can't span the line break between
    // passages, so testing each passage gives the same answer as testing the page.)
    for (const item of items) {
      const key = `${item.path}\0${item.page}`;
      const answer = item.answer;
      let page = pages.get(key);
      if (!page) pages.set(key, page = { text: '', enough: false, technical: false });
      if (!page.technical && TECHNICAL.test(answer)) page.technical = true;
      if (!page.enough) {
        page.text += '\n' + answer;
        const start = page.text.trimStart();
        if (start.length > 220 && lineBreaks(start) >= 5) {
          page.text = start;
          page.enough = true;
        }
      }
    }
    for (const page of pages.values()) {
      if (!page.enough) page.text = page.text.trim();
      page.kind = pageKind(page.text);
      page.introductory = INTRODUCTORY.test(page.text.slice(0, 220));
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const answer = item.answer;
      const page = pages.get(`${item.path}\0${item.page}`)!;
      const kind = page.kind!;
      const lines = answer.split('\n').filter(l => l.trim());
      const words = noteTokens(answer).length;
      // Title-only fragments and diagram labels are poor summaries; code/math remain eligible.
      let weight = words < 12 && !/[.!?](?:\s|$)/.test(answer) ? .25 : 1;
      if (lines.length > 12 && lines.filter(l => l.trim().length < 30).length / lines.length > .65 && !page.technical) weight *= .6;
      this.explicit[i] = weight;
      if (kind !== 'body') weight *= ['preface', 'foreword'].includes(kind) ? .16 : .06;
      this.priors[i] = weight;
      this.overview[i] = weight * (page.introductory ? 1.3 : 1);
    }
    // Book titles identify sources; repeating a title on every passage must not
    // count as evidence that its body discusses the requested subject. The text is read through, not copied.
    this.index = new BookKeywords(items.map(item => ({ id: item.id, question: '', get answer() { return item.answer; } })));
  }

  // Plain data to hand to another thread (see book-index-worker.mjs); fromData takes it back.
  toData(): BookPassagesData {
    return { priors: this.priors, overview: this.overview, explicit: this.explicit, index: this.index.toData() };
  }

  static transfers(data: BookPassagesData): ArrayBufferLike[] {
    return [data.priors.buffer, data.overview.buffer, data.explicit.buffer, ...BookKeywords.transfers(data.index)];
  }

  static fromData(data: BookPassagesData): BookPassages {
    const passages = Object.create(BookPassages.prototype) as BookPassages;
    Object.assign(passages, { priors: data.priors, overview: data.overview, explicit: data.explicit, index: BookKeywords.fromData(data.index) });
    return passages;
  }

  search(query: string): NoteSearchHit[] {
    const text = bookQuery(query);
    const terms = noteTokens(text);
    const metadata = /\b(?:preface|foreword|bibliograph\w*|references|sources? (?:cited|referenced)|table of contents|list of (?:figures|tables|algorithms)|copyright|isbn|author biography)\b/i.test(text);
    return this.index.search(text, { limit: 48, minScore: .2, weights: metadata ? this.explicit : terms.length <= 3 ? this.overview : this.priors });
  }
}
