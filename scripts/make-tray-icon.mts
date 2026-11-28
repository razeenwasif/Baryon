// Rasterizes Fairy's bird silhouette into macOS template PNGs (black + alpha).
// Run with: npx electron scripts/make-tray-icon.mjs
import { app, BrowserWindow, nativeImage } from 'electron';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveRepoRoot } from './repo-root.mjs';

const root = resolveRepoRoot(import.meta.url);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 64, height: 64, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const svg = await readFile(join(root, 'assets/tray/fairy.svg'), 'utf8');
  const url = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  await window.loadURL('data:text/html,<body></body>');
  await mkdir(join(root, 'assets/tray'), { recursive: true });
  for (const [size, name] of [[22, 'trayTemplate.png'], [44, 'trayTemplate@2x.png']] as const) {
    // Explicit canvas pixels produce the same 1x/2x assets on any display scale.
    const data = await window.webContents.executeJavaScript(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = ${size};
      const bird = new Image(); bird.src = ${JSON.stringify(url)};
      await bird.decode();
      canvas.getContext('2d').drawImage(bird, 0, 0, ${size}, ${size});
      return canvas.toDataURL('image/png');
    })()`) as string;
    const image = nativeImage.createFromDataURL(data);
    const dimensions = image.getSize();
    if (image.isEmpty() || dimensions.width !== size || dimensions.height !== size) throw new Error('Incorrect tray icon dimensions.');
    await writeFile(join(root, 'assets/tray', name), image.toPNG());
    console.log(name, nativeImage.createFromBuffer(image.toPNG()).getSize());
  }
  app.quit();
}).catch((error: unknown) => { console.error(error); app.exit(1); });
