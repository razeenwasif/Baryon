// Eval tasks saved from real work sessions (docs/evals-from-sessions.md), as scripts/eval.mjs runs them. What a saved
// task holds, where it's kept, its checks and its runner task are desktop/saved-evals.mjs, which the app shares.
import {
  CHECKS,
  SAVED_DIR,
  cleanSaved,
  readSaved,
  runnerTask,
  saveTask,
  type ReadSavedProblem,
  type SavedRunnerTask,
} from '../desktop/saved-evals.mjs';

export { CHECKS, SAVED_DIR, cleanSaved, runnerTask, saveTask };
export type {
  ReadSavedProblem,
  SavedCheck,
  SavedKind,
  SavedPermission,
  SavedRunnerTask,
  SavedTask,
  SavedTaskReference,
  SavedTaskStart,
  SavedUntrackedFile,
} from '../desktop/saved-evals.mjs';

// Every saved task, as runner tasks, and the ones that couldn't be read with why.
export async function loadSaved({ dir = SAVED_DIR }: { dir?: string } = {}): Promise<{
  tasks: SavedRunnerTask[];
  problems: ReadSavedProblem[];
}> {
  const { tasks, problems } = await readSaved({ dir });
  return { tasks: tasks.map(task => runnerTask(task)), problems };
}
