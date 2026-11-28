export interface TexFileEntry {
  name?: string | null;
}

// The .tex files in the notebook's files/ that a note goes with: a note titled “Practice Exam 2 — …” goes with
// practice-exam-2.tex (its name's words, whole, in the title), not practice-exam-1.tex or practice-exam-20.tex.
export function texFilesFor(title: string, files: readonly (TexFileEntry | null | undefined)[] = []): string[] {
  const words = (value: string): string => ` ${String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const said = words(title);
  return files
    .map(f => f?.name)
    .filter((name): name is string => typeof name === 'string' && /\.tex$/i.test(name))
    .filter(name => {
      const stem = words(name.replace(/\.tex$/i, ''));
      return Boolean(stem.trim()) && said.includes(stem);
    });
}
