import type { BaryonPreloadApi } from '../desktop/ipc-contract.js';
import { ConditionalTask } from './conditional-task.js';
import './music.css';

export type VocalPreviewKind = 'hum' | 'sing' | 'original-song';

export interface SpotifyStatus {
  connected?: boolean;
  connecting?: boolean;
  clientId?: string;
  error?: string;
}

export interface SpotifyTrack {
  name: string;
  url?: string;
  artists: string;
  duration: number;
}

export interface SpotifyNowResult {
  track?: SpotifyTrack | null;
  playing?: boolean;
  progress: number;
}

export interface SpotifyLibraryItem {
  id?: string;
  name: string;
  url?: string;
  owner?: string;
  artists?: string;
  available?: boolean;
}

export interface SpotifyLibraryResult {
  items: SpotifyLibraryItem[];
  next: number | null;
  total: number;
}

export interface SetupMusicOptions {
  api: BaryonPreloadApi | null | undefined;
  openWorkspace: () => Promise<unknown> | unknown;
  previewVocal: (kind: VocalPreviewKind) => Promise<boolean>;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (msg) return String(msg);
  }
  return String(error);
}

export function setupMusic({ api, openWorkspace, previewVocal }: SetupMusicOptions): void {
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="music" aria-labelledby="music-title">
      <div class="dialog-header"><div><span class="eyebrow">Your listening space</span><h2 id="music-title">Music · Spotify</h2></div><button id="music-close" class="quiet" aria-label="Close music">✕</button></div>
      <p class="field-note">Browse your music here. Spotify library and playback details stay out of Fairy’s AI conversations and voice requests. No audio is recorded.</p>
      <div id="music-setup"><label>Spotify Client ID<input id="spotify-client" maxlength="32" autocomplete="off" placeholder="Paste your Spotify app’s Client ID"></label>
      <p class="field-note">Create a Web API app in the <a href="https://developer.spotify.com/dashboard">Spotify developer dashboard</a>. Set its redirect URI to <code>http://127.0.0.1:43821/callback</code>. Premium is required. No Client Secret is needed.</p></div>
      <div class="music-actions"><button id="spotify-connect" class="primary">Connect Spotify ↗</button><button id="spotify-disconnect" class="quiet" hidden>Disconnect</button></div>
      <p id="music-status" class="field-note" role="status"></p>
      <section class="music-now" aria-label="Your song"><span class="eyebrow">Fairy sings</span>
        <p>Your original song</p><p class="field-note">Your saved 20-second singing clip, played locally with mouth animation. Say or type “sing my song,” or press play. Pause Spotify first. Stop or start talking to interrupt.</p>
        <div class="music-actions"><button id="play-song" class="primary" disabled>Play my song</button></div><p id="singing-status" class="field-note" role="status">Checking your saved song…</p>
      </section>
      <section class="music-now" aria-label="Original vocal previews"><span class="eyebrow">Fairy’s voice</span>
        <p>Try a little tune</p><p class="field-note">Short, original humming and wordless singing in your Fish voice. Quiet volume, up to 8 seconds. Pause your music first. Set quiet-time humming and its frequency in Companion settings. Each preview uses your Fish API plan.</p>
        <div class="music-actions"><button id="preview-hum" class="quiet">Preview soft hum</button><button id="preview-sing" class="quiet">Preview wordless melody</button><button id="cancel-vocal" class="quiet" hidden>Cancel preview</button></div><p id="vocal-status" class="field-note" role="status"></p>
      </section>
      <section id="music-connected" hidden>
        <div class="music-now"><span class="eyebrow">Now playing · Spotify</span><div id="music-now-track">Checking playback…</div><p id="music-playback" class="field-note"></p><button id="music-refresh" class="quiet">Refresh playback</button></div>
        <div class="music-actions"><button id="music-liked" class="quiet">Liked Songs</button><button id="music-playlists" class="quiet">Your playlists</button></div>
        <p class="field-note">Spotify allows track lists for playlists you own or collaborate on. Other playlists can be opened in Spotify.</p>
        <h3 id="music-list-title">Liked Songs</h3><p id="music-list-status" class="field-note" role="status"></p><div id="music-list"></div><button id="music-more" class="quiet" hidden>Load more</button>
      </section>
    </dialog>`);
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const dialog = $<HTMLDialogElement>('music');
  let songAvailable = false;
  let previewBusy = false;
  const floatingSing = document.createElement('button');
  floatingSing.id = 'floating-sing';
  floatingSing.textContent = 'Sing';
  floatingSing.title = 'Sing your original song';
  floatingSing.setAttribute('aria-label', 'Sing your original song');
  document.getElementById('floating-ideas-bar')!.append(floatingSing);

  function vocalControls(): void {
    $<HTMLButtonElement>('preview-hum').disabled = $<HTMLButtonElement>('preview-sing').disabled = !api || previewBusy;
    $<HTMLButtonElement>('play-song').disabled = floatingSing.disabled = !api || !songAvailable || previewBusy;
    $<HTMLButtonElement>('cancel-vocal').hidden = !previewBusy;
  }

  async function refreshSinging(): Promise<void> {
    try {
      songAvailable = Boolean(api && (await api.singingStatus() as { available?: boolean }).available);
      $<HTMLParagraphElement>('singing-status').textContent = songAvailable
        ? 'Ready · saved on this Mac · no API usage for playback'
        : 'Your singing clip has not been installed on this Mac.';
    } catch {
      songAvailable = false;
      $<HTMLParagraphElement>('singing-status').textContent = 'Could not read your saved singing clip.';
    }
    vocalControls();
  }

  vocalControls();
  void refreshSinging();
  const vocalButtons: ReadonlyArray<readonly [string, VocalPreviewKind]> = [
    ['preview-hum', 'hum'],
    ['preview-sing', 'sing'],
    ['play-song', 'original-song'],
    ['floating-sing', 'original-song'],
  ];
  for (const [id, kind] of vocalButtons) {
    $<HTMLButtonElement>(id).onclick = async () => {
      previewBusy = true;
      vocalControls();
      $<HTMLParagraphElement>('vocal-status').textContent = kind === 'original-song' ? 'Loading your song…' : 'Preparing a short preview…';
      try {
        const finished = await previewVocal(kind);
        $<HTMLParagraphElement>('vocal-status').textContent = finished ? 'Playback finished.' : 'Playback stopped.';
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        $<HTMLParagraphElement>('vocal-status').textContent = String(msg).replace(/Error invoking remote method '[^']+': Error: /g, '');
      } finally {
        previewBusy = false;
        vocalControls();
      }
    };
  }
  $<HTMLButtonElement>('cancel-vocal').onclick = () => { void api?.stop(); };

  let connected = false;
  let connecting = false;
  let epoch = 0;
  let listEpoch = 0;
  let nowBusy = false;
  let listBusy = false;
  let next: number | null = null;
  let kind = 'liked';
  let playlistId: string | undefined;

  const playbackTask = new ConditionalTask({ enabled: () => connected && dialog.open && !document.hidden, delay: 30000, run: refreshNow });
  const message = (error: unknown): string => errorMessage(error).replace(/Error invoking remote method '[^']+': Error: /g, '');
  const link = (name: string, url?: string): HTMLAnchorElement | HTMLSpanElement => {
    const element = document.createElement(url ? 'a' : 'span');
    element.textContent = name;
    if (url && element instanceof HTMLAnchorElement) {
      element.href = url;
      element.onclick = event => {
        event.preventDefault();
        void api?.openSource(url).catch(e => { $<HTMLParagraphElement>('music-status').textContent = message(e); });
      };
    }
    return element;
  };
  (dialog.querySelector('a') as HTMLAnchorElement).onclick = event => {
    event.preventDefault();
    void api?.openSource((event.currentTarget as HTMLAnchorElement).href);
  };

  function controls(status: SpotifyStatus = {}): void {
    connected = Boolean(status.connected);
    connecting = Boolean(status.connecting);
    playbackTask.sync();
    document.dispatchEvent(new Event('fairy:spotify-change'));
    $<HTMLElement>('music-connected').hidden = !connected;
    $<HTMLDivElement>('music-setup').hidden = connected;
    $<HTMLButtonElement>('spotify-connect').hidden = connected;
    $<HTMLButtonElement>('spotify-connect').disabled = connecting || !api;
    $<HTMLInputElement>('spotify-client').disabled = connecting;
    $<HTMLButtonElement>('spotify-disconnect').hidden = !connected && !connecting;
    $<HTMLButtonElement>('spotify-disconnect').textContent = connecting ? 'Cancel sign-in' : 'Disconnect';
    if (status.clientId) $<HTMLInputElement>('spotify-client').value = status.clientId;
    if (!connected) {
      $<HTMLDivElement>('music-list').replaceChildren();
      $<HTMLDivElement>('music-now-track').replaceChildren();
      $<HTMLParagraphElement>('music-playback').textContent = '';
    }
  }

  async function refreshNow(): Promise<void> {
    if (!connected || !dialog.open || nowBusy) return;
    const requestEpoch = epoch;
    nowBusy = true;
    $<HTMLButtonElement>('music-refresh').disabled = true;
    try {
      const current = await api!.spotifyNow() as SpotifyNowResult;
      if (requestEpoch !== epoch || !dialog.open) return;
      const nowTrack = $<HTMLDivElement>('music-now-track');
      nowTrack.replaceChildren();
      if (current.track) {
        nowTrack.append(link(current.track.name, current.track.url), document.createTextNode(` — ${current.track.artists}`));
        const time = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
        $<HTMLParagraphElement>('music-playback').textContent = `${current.playing ? 'Playing' : 'Paused'} · ${time(current.progress)} / ${time(current.track.duration)} · refreshes every 30 seconds while open`;
      } else {
        nowTrack.textContent = 'No song is currently available.';
        $<HTMLParagraphElement>('music-playback').textContent = 'Start a song in Spotify, then refresh. Private sessions and non-music playback may not appear.';
      }
    } catch (e) {
      if (requestEpoch === epoch) {
        $<HTMLDivElement>('music-now-track').replaceChildren();
        $<HTMLParagraphElement>('music-playback').textContent = message(e);
      }
    } finally {
      nowBusy = false;
      $<HTMLButtonElement>('music-refresh').disabled = false;
    }
  }

  async function loadList(append = false): Promise<void> {
    if (!connected || (listBusy && append)) return;
    const requestEpoch = epoch;
    const requestList = ++listEpoch;
    listBusy = true;
    $<HTMLButtonElement>('music-more').disabled = true;
    if (!append) {
      next = null;
      $<HTMLButtonElement>('music-more').hidden = true;
      $<HTMLDivElement>('music-list').replaceChildren();
    }
    $<HTMLParagraphElement>('music-list-status').textContent = 'Loading…';
    try {
      const result = await api!.spotifyLibrary(kind, append ? (next ?? undefined) : 0, playlistId) as SpotifyLibraryResult;
      if (requestEpoch !== epoch || requestList !== listEpoch || !dialog.open) return;
      const listEl = $<HTMLDivElement>('music-list');
      for (const item of result.items) {
        const row = document.createElement('div');
        row.className = 'music-row';
        const text = document.createElement('div');
        text.append(link(item.name, item.url));
        const detail = document.createElement('small');
        detail.textContent = (kind === 'playlists' ? item.owner : item.artists) ?? '';
        text.append(detail);
        row.append(text);
        if (kind === 'playlists' && item.available) {
          const button = document.createElement('button');
          button.className = 'quiet';
          button.textContent = 'View songs';
          button.onclick = () => {
            kind = 'playlist';
            playlistId = item.id;
            $<HTMLHeadingElement>('music-list-title').textContent = item.name;
            void loadList();
          };
          row.append(button);
        }
        listEl.append(row);
      }
      next = result.next;
      $<HTMLButtonElement>('music-more').hidden = next === null;
      $<HTMLParagraphElement>('music-list-status').textContent = result.total ? `${listEl.children.length} of ${result.total}` : 'Nothing saved here yet.';
    } catch (e) {
      if (requestEpoch === epoch && requestList === listEpoch) $<HTMLParagraphElement>('music-list-status').textContent = message(e);
    } finally {
      if (requestList === listEpoch) {
        listBusy = false;
        $<HTMLButtonElement>('music-more').disabled = false;
      }
    }
  }

  async function open(): Promise<void> {
    await openWorkspace();
    dialog.showModal();
    playbackTask.sync();
    void refreshSinging();
    if (!api) {
      controls();
      $<HTMLParagraphElement>('music-status').textContent = 'Open the desktop app to connect Spotify.';
      return;
    }
    try {
      const status = await api.spotifyStatus() as SpotifyStatus;
      controls(status);
      $<HTMLParagraphElement>('music-status').textContent = status.error || (status.connecting ? 'Finish signing in in your browser.' : status.connected ? 'Connected · read-only access' : 'Connect to browse your Liked Songs, playlists and current song.');
      if (connected) {
        void refreshNow();
        void loadList();
      }
    } catch (e) {
      $<HTMLParagraphElement>('music-status').textContent = message(e);
    }
  }

  $<HTMLButtonElement>('music-button').onclick = () => void open();
  const floatingButton = document.createElement('button');
  floatingButton.id = 'floating-music';
  floatingButton.textContent = '♫';
  floatingButton.title = 'Open Spotify library';
  floatingButton.setAttribute('aria-label', 'Open Spotify library');
  document.getElementById('floating-ideas-bar')!.append(floatingButton);
  floatingButton.onclick = () => void open();
  $<HTMLButtonElement>('music-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    playbackTask.sync();
    epoch++;
    listEpoch++;
    listBusy = false;
    $<HTMLDivElement>('music-list').replaceChildren();
    $<HTMLDivElement>('music-now-track').replaceChildren();
  });
  $<HTMLButtonElement>('spotify-connect').onclick = async () => {
    const requestEpoch = ++epoch;
    controls({ connecting: true });
    $<HTMLParagraphElement>('music-status').textContent = 'Finish signing in and approve read access in your browser.';
    try {
      const status = await api!.spotifyConnect($<HTMLInputElement>('spotify-client').value) as SpotifyStatus;
      if (requestEpoch !== epoch) return;
      controls(status);
      $<HTMLParagraphElement>('music-status').textContent = 'Connected · read-only access';
      void refreshNow();
      void loadList();
    } catch (e) {
      if (requestEpoch === epoch) {
        controls(await api!.spotifyStatus() as SpotifyStatus);
        $<HTMLParagraphElement>('music-status').textContent = message(e);
      }
    }
  };
  $<HTMLButtonElement>('spotify-disconnect').onclick = async () => {
    epoch++;
    listEpoch++;
    listBusy = false;
    try {
      controls(await api!.spotifyDisconnect() as SpotifyStatus);
      $<HTMLParagraphElement>('music-status').textContent = 'Disconnected. Saved Spotify tokens and displayed library data were removed. You can also revoke access at spotify.com/account/apps.';
    } catch (e) {
      $<HTMLParagraphElement>('music-status').textContent = message(e);
    }
  };
  $<HTMLButtonElement>('music-liked').onclick = () => {
    kind = 'liked';
    playlistId = undefined;
    $<HTMLHeadingElement>('music-list-title').textContent = 'Liked Songs';
    void loadList();
  };
  $<HTMLButtonElement>('music-playlists').onclick = () => {
    kind = 'playlists';
    playlistId = undefined;
    $<HTMLHeadingElement>('music-list-title').textContent = 'Your playlists';
    void loadList();
  };
  $<HTMLButtonElement>('music-more').onclick = () => void loadList(true);
  $<HTMLButtonElement>('music-refresh').onclick = () => void refreshNow();
  document.addEventListener('visibilitychange', () => playbackTask.sync());
  window.addEventListener('beforeunload', () => playbackTask.dispose());
}
