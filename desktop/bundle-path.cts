// Where the files Fairy can't read through her own archive are.
//
// A packaged Fairy keeps her code in one sealed archive, Resources/app.asar, and Electron checks it against a hash in
// the signed Info.plist before running any of it (the asar fuses, scripts/fuses.mjs). Electron reads files in the
// archive itself, so most paths need nothing. Two kinds can't live there: a program macOS has to start, and a file
// handed to one. Those are left out of the archive at build time (scripts/package-fairy.mjs) and sit beside it in
// Resources/app.asar.unpacked, at the same path. spawn() isn't taught that, so every such path goes through here.
// In a checkout there is no archive, and the path comes back as it was.
const { join } = require('node:path') as typeof import('node:path');
const { resolveAppRoot } = require('./app-root.cjs') as { resolveAppRoot(fromDir: string): string };

const unpacked = (path: string): string =>
  String(path).replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
// One of the helper programs in native/bin, by name.
const nativeBin = (name: string): string =>
  unpacked(join(resolveAppRoot(__dirname), 'native/bin', name));
// Any other file beside the archive, by its path from the app's root: 'assets/tray/trayTemplate.png'.
const beside = (relative: string): string =>
  unpacked(join(resolveAppRoot(__dirname), relative));

module.exports = { unpacked, nativeBin, beside };
