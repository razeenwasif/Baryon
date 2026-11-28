// The quick box: a one-line terminal prompt that floats at the pointer when you tap ⌥⌘ (or beside an area you dragged
// over with ⌃⌥A). Enter asks Fairy; Esc, or clicking elsewhere, closes it.
import '@fontsource/martian-mono/latin-400.css';
import '@fontsource/martian-mono/latin-600.css';
import './quickask.css';

const api = window.fairyQuick;
const form = document.querySelector<HTMLFormElement>('.quick')!;
const input = document.querySelector<HTMLInputElement>('.quick-input')!;
const area = new URLSearchParams(location.search).get('area') === '1';
input.placeholder = area ? 'ask about this area…' : 'ask fairy…';
form.addEventListener('submit', (event: SubmitEvent) => {
  event.preventDefault();
  const text = input.value.trim();
  if (text) api?.submit(text);
  else api?.close();
});
document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    api?.close();
  }
});
addEventListener('focus', () => input.focus());
input.focus();
