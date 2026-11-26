// Shared by the request router and the scoped reader so supported files cannot
// silently fall back to ordinary chat when another language/format is used.
export const LOCAL_TEXT_EXTENSIONS = '.txt .md .markdown .py .ipynb .tex .csv .tsv .json .yaml .yml .toml .ini .cfg .lp .mps .dat .jl .r .c .cpp .h .hpp .js .mjs .ts .sql .rst .log'.split(' ');
export const LOCAL_IMAGE_EXTENSIONS = ['.png','.jpg','.jpeg','.webp'];
export const LOCAL_READ_EXTENSIONS = [...LOCAL_TEXT_EXTENSIONS,...LOCAL_IMAGE_EXTENSIONS,'.pdf'];
// Readable as text, but too common in ordinary words and addresses to send a message to the file tools by themselves.
export const LOCAL_MORE_TEXT_EXTENSIONS = '.html .htm .css .scss .sh .zsh .bash .swift .java .go .rs .rb .php .kt .tsx .jsx .xml .svg .lua .cs .vue .m .mm .conf .tf .gradle'.split(' ');
export const ATTACHABLE_EXTENSIONS = [...LOCAL_READ_EXTENSIONS,...LOCAL_MORE_TEXT_EXTENSIONS];
