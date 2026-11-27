// Crisp vector file-type icons (pure geometric SVG, zero <text> nodes so textContent & copy/paste stay clean).
const svg = (color, body, extra = '') =>
  `<svg class="file-icon-svg" viewBox="0 0 16 16" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:${color}"${extra}>${body}</svg>`;

const ICONS = {
  folder: {
    label: 'Folder',
    color: '#7aa2f7',
    svg: svg('#7aa2f7', '<path d="M1.8 4.2A1.4 1.4 0 0 1 3.2 2.8h3.1l1.4 1.4h5.1a1.4 1.4 0 0 1 1.4 1.4v6.2a1.4 1.4 0 0 1-1.4 1.4H3.2a1.4 1.4 0 0 1-1.4-1.4V4.2Z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>'),
  },
  'folder-open': {
    label: 'Folder',
    color: '#89b4fa',
    svg: svg('#89b4fa', '<path d="M1.8 4.2A1.4 1.4 0 0 1 3.2 2.8h3l1.3 1.4h5.3a1.4 1.4 0 0 1 1.4 1.4v1H3.6a1.2 1.2 0 0 0-1.15.86L1.8 10.6V4.2Z" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2.6 7.4h11.1a.9.9 0 0 1 .86 1.15l-1.08 3.6a1.2 1.2 0 0 1-1.15.85H2.8a1 1 0 0 1-.96-1.28l.76-4.32Z" fill="currentColor" fill-opacity=".28" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),
  },
  javascript: {
    label: 'JavaScript',
    color: '#f0db4f',
    svg: svg('#f0db4f', '<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.4" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.2"/><path d="M6.8 5.4v4.4a1.4 1.4 0 0 1-2.5.85M11.6 6.2a1.45 1.45 0 0 0-2.4.55c0 .9 2.55.8 2.55 2.2a1.55 1.55 0 0 1-2.8.8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  typescript: {
    label: 'TypeScript',
    color: '#4ea1f3',
    svg: svg('#4ea1f3', '<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.4" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="1.2"/><path d="M4.2 5.6h3.6M6 5.6v5.2M11.8 6.4a1.45 1.45 0 0 0-2.35.5c0 .9 2.5.8 2.5 2.2a1.5 1.5 0 0 1-2.7.75" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  react: {
    label: 'React',
    color: '#61dafb',
    svg: svg('#61dafb', '<circle cx="8" cy="8" r="1.45" fill="currentColor"/><ellipse cx="8" cy="8" rx="6.2" ry="2.45" stroke="currentColor" stroke-width="1.15"/><ellipse cx="8" cy="8" rx="6.2" ry="2.45" transform="rotate(60 8 8)" stroke="currentColor" stroke-width="1.15"/><ellipse cx="8" cy="8" rx="6.2" ry="2.45" transform="rotate(120 8 8)" stroke="currentColor" stroke-width="1.15"/>'),
  },
  python: {
    label: 'Python',
    color: '#5ca4e6',
    svg: svg('#5ca4e6', '<path d="M8 2.2c-2.2 0-2.5.95-2.5 2v1.3h3.2v.65H4.4c-1.15 0-2.1.75-2.1 2.25 0 1.45.8 2.25 2.05 2.25h1v-1.2c0-1.15.9-2.05 2.1-2.05h2.55c.9 0 1.6-.7 1.6-1.6V4.1c0-1.05-.9-1.9-2.6-1.9H8Z" fill="#5ca4e6" fill-opacity=".35" stroke="#5ca4e6" stroke-width="1.1" stroke-linejoin="round"/><path d="M8 13.8c2.2 0 2.5-.95 2.5-2v-1.3H7.3v-.65h4.3c1.15 0 2.1-.75 2.1-2.25 0-1.45-.8-2.25-2.05-2.25h-1v1.2c0 1.15-.9 2.05-2.1 2.05H6c-.9 0-1.6.7-1.6 1.6v1.7c0 1.05.9 1.9 2.6 1.9H8Z" fill="#ffd43b" fill-opacity=".32" stroke="#ffd43b" stroke-width="1.1" stroke-linejoin="round"/><circle cx="6.7" cy="3.9" r=".6" fill="#5ca4e6"/><circle cx="9.3" cy="12.1" r=".6" fill="#ffd43b"/>'),
  },
  jupyter: {
    label: 'Jupyter Notebook',
    color: '#f37626',
    svg: svg('#f37626', '<path d="M3.2 5.4c1.3-1.4 3.1-2 4.8-2s3.5.6 4.8 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3.2 10.6c1.3 1.4 3.1 2 4.8 2s3.5-.6 4.8-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12.8" cy="3.2" r="1.1" fill="#9ea8c4"/><circle cx="3.3" cy="12.9" r=".95" fill="#9ea8c4"/>'),
  },
  html: {
    label: 'HTML',
    color: '#f06538',
    svg: svg('#f06538', '<path d="M5.4 4.3 2 8l3.4 3.7M10.6 4.3 14 8l-3.4 3.7M8.9 3.2 7.1 12.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  css: {
    label: 'CSS',
    color: '#56b6f6',
    svg: svg('#56b6f6', '<path d="M6.2 3.1 4.8 12.9M11.2 3.1 9.8 12.9M3 6h10.5M2.5 10H13" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>'),
  },
  scss: {
    label: 'SCSS',
    color: '#d973a9',
    svg: svg('#d973a9', '<path d="M6.2 3.1 4.8 12.9M11.2 3.1 9.8 12.9M3 6h10.5M2.5 10H13" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>'),
  },
  json: {
    label: 'JSON',
    color: '#e5c07b',
    svg: svg('#e5c07b', '<path d="M5.7 2.8C4.4 2.8 4 3.5 4 4.5v1.8c0 .8-.5 1.4-1.3 1.7.8.3 1.3.9 1.3 1.7v1.8c0 1 .4 1.7 1.7 1.7M10.3 2.8c1.3 0 1.7.7 1.7 1.7v1.8c0 .8.5 1.4 1.3 1.7-.8.3-1.3.9-1.3 1.7v1.8c0 1-.4 1.7-1.7 1.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  markdown: {
    label: 'Markdown',
    color: '#7aa2f7',
    svg: svg('#7aa2f7', '<rect x="1.5" y="3" width="13" height="10" rx="1.8" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="1.2"/><path d="M3.7 10.3V5.8L5.6 8l1.9-2.2v4.5M10.8 5.8v4.2m0 0-1.4-1.5m1.4 1.5 1.4-1.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  shell: {
    label: 'Shell',
    color: '#89d185',
    svg: svg('#89d185', '<rect x="1.6" y="2.4" width="12.8" height="11.2" rx="2.2" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="1.2"/><path d="m4.5 6.2 2.4 2-2.4 2M8.3 10.2h3.1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  swift: {
    label: 'Swift',
    color: '#f46542',
    svg: svg('#f46542', '<path d="M12.9 11.4c1.3-1.7.9-5-1.6-7.6.9 2 .7 4.2-.8 5.3-1.8-1.1-4.1-3.1-5.6-4.9.9 1.9 2.4 3.8 3.9 5.1-1.9-.6-4-1.8-5.7-3.4 1.2 2.4 3.5 4.4 6.1 4.9-1.5.7-3.3.7-5.1-.1 1.7 2.2 5.3 3.2 7.8 1.6.9.5 1.6.7 2 .4-.3-.5-.6-.9-1-1.3Z" fill="currentColor" fill-opacity=".28" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>'),
  },
  rust: {
    label: 'Rust',
    color: '#dea584',
    svg: svg('#dea584', '<circle cx="8" cy="8" r="4.4" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="1.35"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
  },
  go: {
    label: 'Go',
    color: '#29c5e6',
    svg: svg('#29c5e6', '<path d="M2.2 6h3.2M1.8 8.3h2.8M2.8 10.6h2.4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="M13.3 6.2A3.7 3.7 0 1 0 13.7 9H10.4" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  c: {
    label: 'C / C++',
    color: '#659ad2',
    svg: svg('#659ad2', '<path d="M8 1.8 13.4 4.9v6.2L8 14.2 2.6 11.1V4.9L8 1.8Z" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M10.1 6.1a2.6 2.6 0 1 0 0 3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),
  },
  java: {
    label: 'Java',
    color: '#ec7c5b',
    svg: svg('#ec7c5b', '<path d="M3.6 6.8h7.2v3.6a3 3 0 0 1-3 3H6.6a3 3 0 0 1-3-3V6.8Z" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.25"/><path d="M10.8 7.6h1.3a1.4 1.4 0 0 1 0 2.8h-1.3M6 4.4c0-.9.8-1 .8-1.9M8.5 4.4c0-.9.8-1 .8-1.9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
  },
  kotlin: {
    label: 'Kotlin',
    color: '#b084f5',
    svg: svg('#b084f5', '<path d="M2.5 2.5h11L8 8l5.5 5.5h-11V2.5Z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>'),
  },
  ruby: {
    label: 'Ruby',
    color: '#e55c6e',
    svg: svg('#e55c6e', '<path d="M4.2 3.2h7.6l2.4 3.2L8 13.2 1.8 6.4l2.4-3.2Z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M1.8 6.4h12.4M5.4 6.4 8 13.2l2.6-6.8" stroke="currentColor" stroke-width="1.1"/>'),
  },
  php: {
    label: 'PHP',
    color: '#939ee0',
    svg: svg('#939ee0', '<ellipse cx="8" cy="8" rx="6.4" ry="4" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.2"/><path d="M5 9.8V6.2h1.4a1.1 1.1 0 0 1 0 2.2H5m4.2 1.4V6.2h1.4a1.1 1.1 0 0 1 0 2.2H9.2" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  yaml: {
    label: 'YAML / Config',
    color: '#c792ea',
    svg: svg('#c792ea', '<path d="M3 4.5h3.2M8.2 4.5H13M3 8h2M7 8h6M3 11.5h4.2M9.2 11.5H13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'),
  },
  xml: {
    label: 'XML',
    color: '#e59a5c',
    svg: svg('#e59a5c', '<path d="M5.4 4.3 2 8l3.4 3.7M10.6 4.3 14 8l-3.4 3.7M8.9 3.2 7.1 12.8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  sql: {
    label: 'SQL',
    color: '#61afef',
    svg: svg('#61afef', '<ellipse cx="8" cy="4" rx="4.8" ry="1.8" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.2"/><path d="M3.2 4v8c0 1 2.15 1.8 4.8 1.8s4.8-.8 4.8-1.8V4M3.2 8c0 1 2.15 1.8 4.8 1.8s4.8-.8 4.8-1.8" stroke="currentColor" stroke-width="1.2"/>'),
  },
  pdf: {
    label: 'PDF',
    color: '#ef6b73',
    svg: svg('#ef6b73', '<path d="M3.4 2.2h6l3.2 3.2v8.4a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1Z" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.4 2.2v3.2h3.2M5 9.2h6M5 11.6h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
  },
  image: {
    label: 'Image',
    color: '#7fd1a0',
    svg: svg('#7fd1a0', '<rect x="1.8" y="2.6" width="12.4" height="10.8" rx="1.8" fill="currentColor" fill-opacity=".15" stroke="currentColor" stroke-width="1.2"/><circle cx="5.6" cy="6.1" r="1.15" fill="currentColor"/><path d="m2.4 11.7 3.3-3.1 2.4 2.2 2.2-2.4 3.3 3.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  svg: {
    label: 'SVG',
    color: '#ffb86c',
    svg: svg('#ffb86c', '<path d="M3 12.2C3 6.6 6.6 3.5 13 3.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><circle cx="3" cy="12.2" r="1.4" fill="currentColor"/><circle cx="13" cy="3.5" r="1.4" fill="currentColor"/><circle cx="8.2" cy="7.6" r="1.2" stroke="currentColor" stroke-width="1.2"/>'),
  },
  media: {
    label: 'Media',
    color: '#d38aea',
    svg: svg('#d38aea', '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="1.2"/><path d="m6.5 5.8 4 2.2-4 2.2V5.8Z" fill="currentColor"/>'),
  },
  table: {
    label: 'Spreadsheet / CSV',
    color: '#7fd1a0',
    svg: svg('#7fd1a0', '<rect x="1.8" y="2.5" width="12.4" height="11" rx="1.6" fill="currentColor" fill-opacity=".15" stroke="currentColor" stroke-width="1.2"/><path d="M1.8 6.2h12.4M1.8 9.8h12.4M6.2 2.5v11M10.2 2.5v11" stroke="currentColor" stroke-width="1.1"/>'),
  },
  latex: {
    label: 'LaTeX',
    color: '#4fd1c5',
    svg: svg('#4fd1c5', '<path d="M12.2 3.2H4.2l4.4 4.8-4.4 4.8h8" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  git: {
    label: 'Git',
    color: '#f16347',
    svg: svg('#f16347', '<circle cx="4.5" cy="4" r="1.5" stroke="currentColor" stroke-width="1.25"/><circle cx="4.5" cy="12" r="1.5" stroke="currentColor" stroke-width="1.25"/><circle cx="11.5" cy="6.2" r="1.5" stroke="currentColor" stroke-width="1.25"/><path d="M4.5 5.5v5M11.5 7.7c0 2.5-3.2 2.6-5.5 3.8" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>'),
  },
  docker: {
    label: 'Docker',
    color: '#38a3f1',
    svg: svg('#38a3f1', '<rect x="3.2" y="6.6" width="2.4" height="2" rx=".4" fill="currentColor"/><rect x="6.4" y="6.6" width="2.4" height="2" rx=".4" fill="currentColor"/><rect x="9.6" y="6.6" width="2.4" height="2" rx=".4" fill="currentColor"/><rect x="6.4" y="3.8" width="2.4" height="2" rx=".4" fill="currentColor"/><path d="M1.8 9.6h11.6c-.4 2.4-2.2 3.6-5.4 3.6-3.4 0-5.8-1.2-6.2-3.6Z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/>'),
  },
  lock: {
    label: 'Lock / Env',
    color: '#f3be89',
    svg: svg('#f3be89', '<rect x="3.2" y="7" width="9.6" height="6.6" rx="1.6" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="1.2"/><path d="M5.4 7V5.3a2.6 2.6 0 0 1 5.2 0V7" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>'),
  },
  diff: {
    label: 'Diff',
    color: '#9fb2ff',
    svg: svg('#9fb2ff', '<path d="M8 3.2v4.6M5.7 5.5h4.6" stroke="#8fd6a5" stroke-width="1.4" stroke-linecap="round"/><path d="M5.7 11.4h4.6" stroke="#ff8a96" stroke-width="1.4" stroke-linecap="round"/>'),
  },
  text: {
    label: 'Text',
    color: '#9aa8c4',
    svg: svg('#9aa8c4', '<path d="M3.4 2.2h6l3.2 3.2v8.4a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1Z" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.4 2.2v3.2h3.2M5 8h6M5 10.6h4.2" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
  },
  file: {
    label: 'File',
    color: '#8f9eb8',
    svg: svg('#8f9eb8', '<path d="M3.4 2.2h6l3.2 3.2v8.4a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1Z" fill="currentColor" fill-opacity=".12" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.4 2.2v3.2h3.2" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),
  },
};

const EXT_TO_ICON = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  jsx: 'react', tsx: 'react',
  py: 'python', pyw: 'python', pyi: 'python',
  ipynb: 'jupyter',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  css: 'css', less: 'css',
  scss: 'scss', sass: 'scss',
  json: 'json', jsonl: 'json', jsonc: 'json', geojson: 'json',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown', rst: 'markdown',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', command: 'shell', ps1: 'shell',
  swift: 'swift',
  rs: 'rust',
  go: 'go',
  c: 'c', h: 'c', cpp: 'c', cc: 'c', cxx: 'c', hpp: 'c', hh: 'c', m: 'c', mm: 'c', cs: 'c',
  java: 'java', gradle: 'java',
  kt: 'kotlin', kts: 'kotlin',
  rb: 'ruby',
  php: 'php',
  yml: 'yaml', yaml: 'yaml', toml: 'yaml', ini: 'yaml', cfg: 'yaml', conf: 'yaml', tf: 'yaml', properties: 'yaml',
  xml: 'xml', plist: 'xml', xib: 'xml', storyboard: 'xml', xcconfig: 'yaml', pbxproj: 'xml',
  sql: 'sql', sqlite: 'sql', db: 'sql',
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', ico: 'image', icns: 'image', bmp: 'image',
  svg: 'svg',
  mp3: 'media', wav: 'media', m4a: 'media', ogg: 'media', mp4: 'media', mov: 'media', webm: 'media',
  csv: 'table', tsv: 'table', xlsx: 'table', xls: 'table',
  tex: 'latex', bib: 'latex', sty: 'latex', cls: 'latex',
  lock: 'lock', env: 'lock',
  diff: 'diff', patch: 'diff',
  txt: 'text', log: 'text',
  lua: 'c', r: 'c', jl: 'c', dart: 'typescript', graphql: 'yaml', gql: 'yaml',
};

const EXT_TO_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  py: 'python', pyw: 'python', pyi: 'python',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', plist: 'xml', vue: 'xml', svelte: 'xml',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  json: 'json', jsonl: 'json', jsonc: 'json',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', command: 'bash',
  swift: 'swift', rs: 'rust', go: 'go',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', m: 'objectivec', mm: 'objectivec', cs: 'csharp',
  java: 'java', kt: 'kotlin', kts: 'kotlin',
  rb: 'ruby', php: 'php', lua: 'lua', r: 'r',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
  sql: 'sql', diff: 'diff', patch: 'diff',
  tex: 'latex', bib: 'latex',
  graphql: 'graphql', gql: 'graphql',
  makefile: 'makefile', dockerfile: 'dockerfile',
};

const SPECIAL_NAMES = {
  dockerfile: 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  '.dockerignore': 'docker',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.gitkeep': 'git',
  makefile: 'shell',
  'cmakelists.txt': 'yaml',
  'package.json': 'json',
  'package-lock.json': 'lock',
  'yarn.lock': 'lock',
  'pnpm-lock.yaml': 'lock',
  'cargo.lock': 'lock',
  'uv.lock': 'lock',
  'poetry.lock': 'lock',
  'gemfile.lock': 'lock',
  'podfile.lock': 'lock',
  'tsconfig.json': 'typescript',
  'jsconfig.json': 'javascript',
  'vite.config.js': 'javascript',
  'vite.config.ts': 'typescript',
  'readme.md': 'markdown',
  'agents.md': 'markdown',
  'claude.md': 'markdown',
  'license': 'text',
  'license.md': 'markdown',
};

const LANG_DISPLAY = {
  js: { label: 'JavaScript', icon: 'javascript' },
  javascript: { label: 'JavaScript', icon: 'javascript' },
  mjs: { label: 'JavaScript', icon: 'javascript' },
  cjs: { label: 'JavaScript', icon: 'javascript' },
  jsx: { label: 'JSX', icon: 'react' },
  ts: { label: 'TypeScript', icon: 'typescript' },
  typescript: { label: 'TypeScript', icon: 'typescript' },
  tsx: { label: 'TSX', icon: 'react' },
  py: { label: 'Python', icon: 'python' },
  python: { label: 'Python', icon: 'python' },
  sh: { label: 'Shell', icon: 'shell' },
  bash: { label: 'Bash', icon: 'shell' },
  zsh: { label: 'Zsh', icon: 'shell' },
  shell: { label: 'Shell', icon: 'shell' },
  console: { label: 'Shell', icon: 'shell' },
  html: { label: 'HTML', icon: 'html' },
  xml: { label: 'XML', icon: 'xml' },
  svg: { label: 'SVG', icon: 'svg' },
  css: { label: 'CSS', icon: 'css' },
  scss: { label: 'SCSS', icon: 'scss' },
  less: { label: 'Less', icon: 'css' },
  json: { label: 'JSON', icon: 'json' },
  jsonl: { label: 'JSONL', icon: 'json' },
  jsonc: { label: 'JSONC', icon: 'json' },
  md: { label: 'Markdown', icon: 'markdown' },
  markdown: { label: 'Markdown', icon: 'markdown' },
  swift: { label: 'Swift', icon: 'swift' },
  rs: { label: 'Rust', icon: 'rust' },
  rust: { label: 'Rust', icon: 'rust' },
  go: { label: 'Go', icon: 'go' },
  golang: { label: 'Go', icon: 'go' },
  c: { label: 'C', icon: 'c' },
  cpp: { label: 'C++', icon: 'c' },
  'c++': { label: 'C++', icon: 'c' },
  csharp: { label: 'C#', icon: 'c' },
  cs: { label: 'C#', icon: 'c' },
  objectivec: { label: 'Objective-C', icon: 'c' },
  objc: { label: 'Objective-C', icon: 'c' },
  java: { label: 'Java', icon: 'java' },
  kt: { label: 'Kotlin', icon: 'kotlin' },
  kotlin: { label: 'Kotlin', icon: 'kotlin' },
  rb: { label: 'Ruby', icon: 'ruby' },
  ruby: { label: 'Ruby', icon: 'ruby' },
  php: { label: 'PHP', icon: 'php' },
  yaml: { label: 'YAML', icon: 'yaml' },
  yml: { label: 'YAML', icon: 'yaml' },
  toml: { label: 'TOML', icon: 'yaml' },
  ini: { label: 'INI', icon: 'yaml' },
  sql: { label: 'SQL', icon: 'sql' },
  diff: { label: 'Diff', icon: 'diff' },
  patch: { label: 'Diff', icon: 'diff' },
  dockerfile: { label: 'Dockerfile', icon: 'docker' },
  docker: { label: 'Docker', icon: 'docker' },
  makefile: { label: 'Makefile', icon: 'shell' },
  tex: { label: 'LaTeX', icon: 'latex' },
  latex: { label: 'LaTeX', icon: 'latex' },
  r: { label: 'R', icon: 'c' },
  lua: { label: 'Lua', icon: 'c' },
  graphql: { label: 'GraphQL', icon: 'yaml' },
  plaintext: { label: 'Text', icon: 'text' },
  text: { label: 'Text', icon: 'text' },
  txt: { label: 'Text', icon: 'text' },
};

const KNOWN_FILE_EXTS = new Set(Object.keys(EXT_TO_ICON));
// Single-letter extensions (.c, .h, .m, .r) and code-like identifiers (.log, .env, .db, .go, .rs, .py, .js, etc.)
// need extra care when appearing in inline code without a path separator.
const SINGLE_LETTER_EXTS = new Set(['c', 'h', 'm', 'r']);
const CODE_OBJECT_PREFIXES = new Set([
  'console', 'process', 'window', 'document', 'navigator', 'location', 'history', 'localstorage', 'sessionstorage',
  'math', 'object', 'array', 'string', 'number', 'boolean', 'symbol', 'bigint', 'json', 'promise', 'date', 'error',
  'regexp', 'map', 'set', 'weakmap', 'weakset', 'buffer', 'reflect', 'proxy', 'intl', 'url', 'global', 'globalthis',
  'this', 'self', 'super', 'event', 'state', 'props', 'args', 'opts', 'options', 'params', 'config', 'settings',
  'result', 'response', 'request', 'req', 'res', 'err', 'row', 'item', 'entry', 'node', 'el', 'element', 'api', 'app',
]);
const BARE_SPECIAL_FILES = new Set([
  'dockerfile', 'makefile', 'gemfile', 'podfile', 'procfile', 'rakefile', 'vagrantfile', 'justfile',
  'license', 'readme', 'changelog', 'cmakelists.txt',
  '.gitignore', '.gitattributes', '.gitmodules', '.dockerignore', '.eslintrc', '.prettierrc', '.npmrc', '.nvmrc', '.env',
]);

function stripLineLocation(raw) {
  let clean = String(raw || '').trim();
  const hashMatch = /#L\d+(?:-L?\d+)?$/i.exec(clean);
  let lineRange = '';
  if (hashMatch) { lineRange = hashMatch[0]; clean = clean.slice(0, hashMatch.index); }
  else {
    const colonMatch = /:(\d+(?:[-–]\d+)?(?::\d+)?)$/.exec(clean);
    if (colonMatch) { lineRange = `:${colonMatch[1]}`; clean = clean.slice(0, colonMatch.index); }
  }
  return { path: clean, lineRange };
}

function baseNameOf(nameOrPath) {
  const clean = stripLineLocation(nameOrPath).path.replace(/\/+$/, '');
  return clean.split('/').pop() || clean;
}

export function fileTypeInfo(nameOrPath, { isFolder = false, open = false } = {}) {
  if (isFolder) {
    const entry = open ? ICONS['folder-open'] : ICONS.folder;
    return { id: open ? 'folder-open' : 'folder', ...entry };
  }
  const base = baseNameOf(nameOrPath).toLowerCase();
  if (!base) return { id: 'file', ...ICONS.file };
  if (base.startsWith('.env')) return { id: 'lock', ...ICONS.lock };
  if (SPECIAL_NAMES[base]) {
    const id = SPECIAL_NAMES[base];
    return { id, ...ICONS[id] };
  }
  if (/^dockerfile\b/.test(base)) return { id: 'docker', ...ICONS.docker };
  const dot = base.lastIndexOf('.');
  if (dot > 0 && dot < base.length - 1) {
    const ext = base.slice(dot + 1);
    const id = EXT_TO_ICON[ext];
    if (id) return { id, ...ICONS[id] };
  }
  return { id: 'file', ...ICONS.file };
}

export function fileIconHTML(nameOrPath, { isFolder = false, open = false, className = '' } = {}) {
  const info = fileTypeInfo(nameOrPath, { isFolder, open });
  const extra = className ? ` ${className}` : '';
  return `<span class="file-icon file-icon-${info.id}${extra}" aria-hidden="true">${info.svg}</span>`;
}

export function fileIconElement(nameOrPath, { isFolder = false, open = false, className = '' } = {}) {
  const info = fileTypeInfo(nameOrPath, { isFolder, open });
  const span = document.createElement('span');
  span.className = `file-icon file-icon-${info.id}${className ? ` ${className}` : ''}`;
  span.setAttribute('aria-hidden', 'true');
  // info.svg comes exclusively from static built-in ICONS definitions above; no external text is interpolated.
  span.innerHTML = info.svg;
  return span;
}

export function languageForPath(nameOrPath) {
  const base = baseNameOf(nameOrPath).toLowerCase();
  if (!base) return '';
  if (base === 'makefile') return 'makefile';
  if (/^dockerfile\b/.test(base)) return 'dockerfile';
  const dot = base.lastIndexOf('.');
  if (dot > 0 && dot < base.length - 1) return EXT_TO_LANG[base.slice(dot + 1)] || '';
  return '';
}

export function languageDisplayInfo(lang, filename = '') {
  if (filename) {
    const info = fileTypeInfo(filename);
    return { label: filename, iconId: info.id, iconHTML: fileIconHTML(filename) };
  }
  const key = String(lang || '').trim().toLowerCase();
  if (!key) return { label: 'Code', iconId: 'file', iconHTML: `<span class="file-icon file-icon-file" aria-hidden="true">${ICONS.file.svg}</span>` };
  const entry = LANG_DISPLAY[key];
  if (entry) {
    const icon = ICONS[entry.icon] || ICONS.file;
    return { label: entry.label, iconId: entry.icon, iconHTML: `<span class="file-icon file-icon-${entry.icon}" aria-hidden="true">${icon.svg}</span>` };
  }
  return { label: key, iconId: 'file', iconHTML: `<span class="file-icon file-icon-file" aria-hidden="true">${ICONS.file.svg}</span>` };
}

export function detectFileReference(rawText) {
  const text = String(rawText || '').trim();
  if (!text || text.length > 260) return null;
  // Never match multi-word code expressions, URLs, flags, or function calls.
  if (/[\s()\[\]{}<>"'`,;!?*|$&=+]/.test(text)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;
  if (text.startsWith('-')) return null;

  const { path, lineRange } = stripLineLocation(text);
  if (!path || path === '.' || path === '..' || path.endsWith('/')) return null;
  const hasSlash = path.includes('/');
  const base = baseNameOf(path);
  const lower = base.toLowerCase();
  if (!base) return null;

  if (BARE_SPECIAL_FILES.has(lower) || /^\.env(?:\.[a-z0-9_-]+)?$/i.test(lower) || /^dockerfile(?:\.[a-z0-9_-]+)?$/i.test(lower)) {
    return { path, name: base, lineRange, type: fileTypeInfo(path) };
  }

  const dot = lower.lastIndexOf('.');
  if (dot <= 0 || dot === lower.length - 1) return null;
  const stem = lower.slice(0, dot);
  const ext = lower.slice(dot + 1);
  if (!KNOWN_FILE_EXTS.has(ext)) return null;

  // Reject version numbers (v1.2, 1.0) or purely numeric stems when there is no slash.
  if (!hasSlash && /^v?\d+(?:\.\d+)*$/i.test(stem)) return null;
  // Reject common JS/Python property accesses like console.log, process.env, obj.m, a.c when bare.
  if (!hasSlash) {
    const firstPart = stem.split('.')[0];
    if (CODE_OBJECT_PREFIXES.has(firstPart)) return null;
    if (SINGLE_LETTER_EXTS.has(ext) && stem.length < 2) return null;
    // Also reject bare `foo.log` unless it looks like a real log file (not e.g. `logger.log`).
    if (ext === 'log' && (firstPart === 'console' || firstPart === 'logger')) return null;
  }

  return { path, name: base, lineRange, type: fileTypeInfo(path) };
}
