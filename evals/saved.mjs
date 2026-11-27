// Eval tasks saved from real work sessions (docs/evals-from-sessions.md), as scripts/eval.mjs runs them. What a saved
// task holds, where it's kept, its checks and its runner task are desktop/saved-evals.mjs, which the app shares.
import { CHECKS, SAVED_DIR, cleanSaved, readSaved, runnerTask, saveTask } from '../desktop/saved-evals.mjs';
export { CHECKS, SAVED_DIR, cleanSaved, runnerTask, saveTask };

// Every saved task, as runner tasks, and the ones that couldn't be read with why.
export async function loadSaved({ dir = SAVED_DIR } = {}) {
  const { tasks, problems } = await readSaved({ dir });
  return { tasks: tasks.map(task => runnerTask(task)), problems };
}
