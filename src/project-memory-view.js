// Project memory in the window (desktop/project-memory.mjs): the card under a work reply that proposes findings to keep,
// and the list of what's kept for the folder, to forget any of it.
const element = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
const sourceText = ({ kind, ref }) => (kind === 'file' ? `File: ${ref}` : kind === 'run' ? `Ran: ${ref}` : `Page: ${ref}`);

// proposal: { findings, decided, kept }. decide(keep) sends the chosen indexes; an empty list skips them all.
export function memoryCard(proposal, decide) {
  const card = element('div', 'memory-card');
  if (proposal.decided) {
    card.classList.add('decided');
    card.append(element('span', 'memory-card-done', proposal.decided === 'kept' ? `Kept ${proposal.kept} ${proposal.kept === 1 ? 'finding' : 'findings'} for this project.` : 'Nothing kept from this turn.'));
    return card;
  }
  card.append(element('p', 'memory-card-title', 'Remember for this project?'));
  const boxes = proposal.findings.map((finding, index) => {
    const row = element('label', 'memory-card-row'), box = element('input'); box.type = 'checkbox'; box.checked = true; box.dataset.index = String(index);
    const words = element('span', 'memory-card-text'); words.append(element('span', '', finding.text), element('small', 'memory-card-source', sourceText(finding.source)));
    row.append(box, words); card.append(row);
    return box;
  });
  const keep = element('button', '', 'Keep'), skip = element('button', 'quiet', 'Not now'); keep.type = skip.type = 'button';
  const status = element('span', 'memory-card-status');
  const send = async chosen => { keep.disabled = skip.disabled = true; status.textContent = ''; try { await decide(chosen); } catch (error) { status.textContent = error.message; keep.disabled = skip.disabled = false; } };
  keep.onclick = () => send(boxes.filter(box => box.checked).map(box => Number(box.dataset.index)));
  skip.onclick = () => send([]);
  for (const box of boxes) box.onchange = () => { keep.disabled = !boxes.some(other => other.checked); };
  const actions = element('div', 'memory-card-actions'); actions.append(status, skip, keep); card.append(actions);
  return card;
}

let dialog = null;
// The folder's kept findings, each with Forget.
export async function openProjectMemory({ api, onError = () => {} }) {
  let data;
  try { data = await api.projectMemoryList(); } catch (error) { onError(error.message); return; }
  dialog?.remove();
  dialog = element('dialog', 'chat-notes project-memory'); dialog.setAttribute('aria-labelledby', 'project-memory-title');
  const title = element('h3', '', 'Project memory'); title.id = 'project-memory-title';
  const about = element('p', 'chat-notes-about', 'What you’ve kept about this folder from earlier work. Fairy reads it at the start of every turn here, checking a finding before relying on it. Findings are proposed under a reply after work that changed files, ran commands or read the web.');
  const list = element('ul', 'project-memory-list');
  const draw = findings => {
    list.replaceChildren();
    if (!findings.length) { list.append(element('li', 'project-memory-empty', 'Nothing kept yet.')); return; }
    for (const finding of findings) {
      const row = element('li', 'project-memory-row'), words = element('span', 'memory-card-text');
      words.append(element('span', '', finding.text), element('small', 'memory-card-source', `${sourceText(finding.source)} · ${new Date(finding.at).toLocaleDateString([], { day: 'numeric', month: 'short' })}`));
      const forget = element('button', 'quiet', 'Forget'); forget.type = 'button';
      forget.onclick = async () => { forget.disabled = true; try { draw((await api.projectMemoryForget(finding.id)).findings); } catch (error) { onError(error.message); forget.disabled = false; } };
      row.append(words, forget); list.append(row);
    }
  };
  draw(data.findings);
  const close = element('button', 'quiet', 'Close'); close.type = 'button'; close.onclick = () => dialog.close();
  const actions = element('div', 'chat-notes-actions'); actions.append(close);
  dialog.append(title, about, list, actions);
  dialog.addEventListener('close', () => { dialog?.remove(); dialog = null; });
  document.body.append(dialog); dialog.showModal();
}
