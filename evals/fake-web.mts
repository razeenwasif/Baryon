import type { ReadWebPageResult, SearchWebResult, WebPageLink, WebSearchResultItem } from '../desktop/web-tools.mjs';

export interface FakeWebPage {
  title: string;
  text: string;
  links?: WebPageLink[];
}

export interface FakeWebOptions {
  results?: WebSearchResultItem[];
  pages?: Record<string, FakeWebPage>;
}

export interface FakeWeb {
  searches: string[];
  reads: string[];
  search(opts: { query: string }): Promise<SearchWebResult>;
  read(opts: { url: string }): Promise<ReadWebPageResult>;
}

// The web, as far as a work task's web_search and read_page reach it: a search that always returns the task's results,
// and pages kept in memory. Nothing reaches the internet. Every search and read is recorded.
export function fakeWeb({ results = [], pages = {} }: FakeWebOptions = {}): FakeWeb {
  const searches: string[] = [], reads: string[] = [];
  return {
    searches, reads,
    async search({ query }: { query: string }): Promise<SearchWebResult> {
      searches.push(query);
      return { results: results.map(({ title, url, snippet }) => ({ title, url, snippet })), text: '' };
    },
    async read({ url }: { url: string }): Promise<ReadWebPageResult> {
      reads.push(url);
      const page = pages[url];
      if (!page) throw new Error('That page couldn’t be reached.');
      return { url, title: page.title, text: page.text, links: page.links || [], status: 200 };
    },
  };
}
