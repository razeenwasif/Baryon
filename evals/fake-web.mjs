// The web, as far as a work task's web_search and read_page reach it: a search that always returns the task's results,
// and pages kept in memory. Nothing reaches the internet. Every search and read is recorded.
export function fakeWeb({ results = [], pages = {} } = {}) {
  const searches = [], reads = [];
  return {
    searches, reads,
    async search({ query }) { searches.push(query); return { results: results.map(({ title, url, snippet }) => ({ title, url, snippet })), text: '' }; },
    async read({ url }) {
      reads.push(url);
      const page = pages[url];
      if (!page) throw new Error('That page couldn’t be reached.');
      return { url, title: page.title, text: page.text, links: page.links || [], status: 200 };
    },
  };
}
