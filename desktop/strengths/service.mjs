// The strengths table as Fairy runs it (docs/auto-by-task-plan.md, stage 2): the table's state for the Strengths page,
// and Refresh, which reads each source's page and asks the scout once per page, in the background, after you press it.
// Nothing here picks a model; that waits for stage 5.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ROUTED_KINDS, modelKey, tableView } from './table.mjs';
import { loadSources, offeredModels, refreshTable } from './index.mjs';
import { useRows, withUseRows } from './evidence.mjs';
import { dismiss, freshness } from './fresh.mjs';

// A path, not a URL, so Electron's archive reader finds it inside app.asar.
export const BUILT_IN_SOURCES = fileURLToPath(new URL('./sources.json', import.meta.url));

// onChanged(): the table on disk changed (a refresh ended, a pin), so whoever caches it reads it again.
// routing: routing.jsonl, folded into the use layer (stage 6) by fold(), at most every ten minutes when state() is read.
export function strengthsService({ store, override, read, ask, offered, tierOf, nameOf, now = () => new Date().toISOString(), onBackground = () => {}, onChanged = () => {}, routing = null }) {
  let running = null, folded = 0;
  // Real use, from routing.jsonl, as the use layer: replaced whole each time, so faded signals leave.
  async function fold() {
    if (!routing) return null;
    let text = '';
    try { text = await readFile(routing, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const lines = text.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } });
    folded = Date.parse(now());
    const table = await store.update(current => withUseRows(current, useRows(lines, { now: now() })));
    onChanged();
    return table.use.length;
  }
  // Your own list (strengths-sources.json in the data folder) when there is one, else the one Fairy comes with.
  async function sources() {
    for (const [where, path] of [['yours', override], ['built-in', BUILT_IN_SOURCES]]) {
      if (!path) continue;
      let text;
      try { text = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      try { return { ...loadSources(JSON.parse(text)), where }; }
      catch (error) { return { sources: [], problems: [`The source list (${where}) couldn’t be read: ${error.message}`], where }; }
    }
    return { sources: [], problems: ['There is no source list.'], where: 'none' };
  }
  return {
    async state() {
      if (routing && !running && Date.parse(now()) - folded > 10 * 60 * 1000) await fold().catch(error => console.warn('Could not fold real use into the strengths table:', error.message));
      const table = await store.load(), listed = await sources(), models = offeredModels(offered(), tierOf, nameOf);
      return {
        kinds: ROUTED_KINDS, view: tableView(table, { models }), where: listed.where, problems: [...listed.problems, ...(store.problem ? [store.problem] : [])],
        sources: listed.sources.map(source => ({ ...source, status: table.sources?.[source.id] || null })),
        aside: (table.aside || []).length, refreshing: running ? { ...running.progress } : null, pinned: { ...(table.pinned || {}) },
        notices: (table.notices || []).filter(notice => !notice.dismissed),
        kindsWithSources: ROUTED_KINDS.filter(kind => listed.sources.some(source => source.kinds.includes(kind))),
      };
    },
    // Starts a refresh and answers at once; state() says how far it has gone.
    async refresh() {
      if (running) return { started: false, running: true };
      const { sources: list } = await sources();
      if (!list.length) throw new Error('There are no sources to read.');
      const controller = new AbortController();
      running = { controller, progress: { done: 0, total: list.length, current: list[0].name } };
      onBackground(list.length);
      const job = store.update(table => refreshTable(table, { sources: list, read, ask, offered: offeredModels(offered(), tierOf).map(model => model.id), now, signal: controller.signal,
        onSource: id => { running.progress.done++; running.progress.current = list[running.progress.done]?.name || ''; } }));
      job.catch(error => { if (!controller.signal.aborted) console.warn('Could not refresh the strengths table:', error.message); }).finally(() => { running = null; onChanged(); });
      return { started: true, total: list.length };
    },
    stop() { running?.controller.abort(); return Boolean(running); },
    fold,
    // Stage 7: new models and stale web numbers, checked hourly by main. mode 'auto' refreshes on its own; 'ask' leaves
    // a notice. Returns the new notices, for a notification.
    async keepFresh({ mode = 'ask' } = {}) {
      let result;
      await store.update(table => { result = freshness(table, { models: offeredModels(offered(), tierOf), now: now(), mode }); return result.table; });
      if (result.refresh && !running) await this.refresh().catch(error => console.warn('Could not refresh the strengths table:', error.message));
      if (result.notices.length) onChanged();
      return result.notices;
    },
    async dismiss(id) {
      if (typeof id !== 'string' || !/^[a-z]+-[\w.:-]{1,80}$/.test(id)) throw new Error('That isn’t a notice.');
      await store.update(table => dismiss(table, id));
      return true;
    },
    // A pin for a kind (decision 7): one of the models you're offered, or '' to take it off. It outranks every score but
    // gives way to a provider that can't take it.
    async pin(kind, model) {
      if (!ROUTED_KINDS.includes(kind)) throw new Error('Choose a kind of task to pin.');
      const key = model ? modelKey(model) : '';
      if (key && !offeredModels(offered(), tierOf).some(item => modelKey(item.id) === key)) throw new Error('Pin one of the models you’re offered.');
      const table = await store.update(current => { const pinned = { ...(current.pinned || {}) }; if (key) pinned[kind] = key; else delete pinned[kind]; return { ...current, pinned }; });
      onChanged();
      return table.pinned;
    },
    get running() { return Boolean(running); },
  };
}
