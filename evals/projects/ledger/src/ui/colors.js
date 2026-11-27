// The two themes' colours. Which one is used is decided elsewhere.
export function palette(theme) {
  return theme === 'light' ? { text: '#111', page: '#fff' } : { text: '#eee', page: '#111' };
}
