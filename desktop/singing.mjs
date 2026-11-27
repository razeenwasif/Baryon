import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

// User recordings live outside the app bundle and Git. The renderer cannot
// choose a filesystem path or cause a new conversion/upload through this API.
export class SingingClip {
  constructor(dataDir) { this.path = join(dataDir, 'singing', 'accepted-song.mp3'); }

  async status() {
    try {
      const info = await stat(this.path);
      return { available: info.isFile() && info.size > 0 && info.size <= 8 * 1024 * 1024 };
    } catch (error) {
      if (error.code === 'ENOENT') return { available: false };
      throw error;
    }
  }

  async play({ signal, checkPlayback }) {
    signal?.throwIfAborted();
    if (!(await this.status()).available) throw new Error('Your singing clip is not installed on this Mac yet.');
    await checkPlayback(); signal?.throwIfAborted();
    const bytes = new Uint8Array(await readFile(this.path, { signal }));
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('The saved singing clip is empty or too large.');
    await checkPlayback(); signal?.throwIfAborted();
    return bytes;
  }
}
