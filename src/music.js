import {ConditionalTask} from './conditional-task.js';
import './music.css';

export function setupMusic({ api, openWorkspace, previewVocal }) {
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
  const $ = id => document.getElementById(id);
  const dialog = $('music');
  let songAvailable = false, previewBusy = false;
  const floatingSing = document.createElement('button'); floatingSing.id = 'floating-sing'; floatingSing.textContent = 'Sing'; floatingSing.title = 'Sing your original song'; floatingSing.setAttribute('aria-label', 'Sing your original song');
  document.getElementById('floating-ideas-bar').append(floatingSing);
  function vocalControls() {
    $('preview-hum').disabled = $('preview-sing').disabled = !api || previewBusy;
    $('play-song').disabled = floatingSing.disabled = !api || !songAvailable || previewBusy;
    $('cancel-vocal').hidden = !previewBusy;
  }
  async function refreshSinging() {
    try {
      songAvailable = Boolean(api && (await api.singingStatus()).available);
      $('singing-status').textContent = songAvailable ? 'Ready · saved on this Mac · no API usage for playback' : 'Your singing clip has not been installed on this Mac.';
    } catch { songAvailable = false; $('singing-status').textContent = 'Could not read your saved singing clip.'; }
    vocalControls();
  }
  vocalControls(); void refreshSinging();
  for (const [id, kind] of [['preview-hum', 'hum'], ['preview-sing', 'sing'], ['play-song', 'original-song'], ['floating-sing', 'original-song']]) {
    $(id).onclick = async () => {
      previewBusy = true; vocalControls();
      $('vocal-status').textContent = kind === 'original-song' ? 'Loading your song…' : 'Preparing a short preview…';
      try { const finished = await previewVocal(kind); $('vocal-status').textContent = finished ? 'Playback finished.' : 'Playback stopped.'; }
      catch (e) { $('vocal-status').textContent = String(e.message).replace(/Error invoking remote method '[^']+': Error: /g, ''); }
      finally { previewBusy = false; vocalControls(); }
    };
  }
  $('cancel-vocal').onclick = () => { void api?.stop(); };

  let connected = false, connecting = false, epoch = 0, listEpoch = 0, nowBusy = false, listBusy = false, next = null, kind = 'liked', playlistId;
  const playbackTask=new ConditionalTask({enabled:()=>connected&&dialog.open&&!document.hidden,delay:30000,run:refreshNow});
  const message = error => String(error?.message || error).replace(/Error invoking remote method '[^']+': Error: /g, '');
  const link = (name, url) => {
    const element = document.createElement(url ? 'a' : 'span'); element.textContent = name;
    if (url) { element.href = url; element.onclick = event => { event.preventDefault(); void api?.openSource(url).catch(e => { $('music-status').textContent = message(e); }); }; }
    return element;
  };
  dialog.querySelector('a').onclick = event => { event.preventDefault(); void api?.openSource(event.currentTarget.href); };
  function controls(status = {}) {
    connected = Boolean(status.connected); connecting = Boolean(status.connecting);playbackTask.sync();document.dispatchEvent(new Event('fairy:spotify-change'));
    $('music-connected').hidden = !connected; $('music-setup').hidden = connected;
    $('spotify-connect').hidden = connected; $('spotify-connect').disabled = connecting || !api;
    $('spotify-client').disabled = connecting;
    $('spotify-disconnect').hidden = !connected && !connecting;
    $('spotify-disconnect').textContent = connecting ? 'Cancel sign-in' : 'Disconnect';
    if (status.clientId) $('spotify-client').value = status.clientId;
    if (!connected) { $('music-list').replaceChildren(); $('music-now-track').replaceChildren(); $('music-playback').textContent = ''; }
  }
  async function refreshNow() {
    if (!connected || !dialog.open || nowBusy) return;
    const requestEpoch = epoch; nowBusy = true; $('music-refresh').disabled = true;
    try {
      const current = await api.spotifyNow();
      if (requestEpoch !== epoch || !dialog.open) return;
      $('music-now-track').replaceChildren();
      if (current.track) {
        $('music-now-track').append(link(current.track.name, current.track.url), document.createTextNode(` — ${current.track.artists}`));
        const time = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
        $('music-playback').textContent = `${current.playing ? 'Playing' : 'Paused'} · ${time(current.progress)} / ${time(current.track.duration)} · refreshes every 30 seconds while open`;
      } else { $('music-now-track').textContent = 'No song is currently available.'; $('music-playback').textContent = 'Start a song in Spotify, then refresh. Private sessions and non-music playback may not appear.'; }
    } catch (e) { if (requestEpoch === epoch) { $('music-now-track').replaceChildren(); $('music-playback').textContent = message(e); } }
    finally { nowBusy = false; $('music-refresh').disabled = false; }
  }
  async function loadList(append = false) {
    if (!connected || listBusy && append) return;
    const requestEpoch = epoch, requestList = ++listEpoch;
    listBusy = true; $('music-more').disabled = true;
    if (!append) { next = null; $('music-more').hidden = true; $('music-list').replaceChildren(); }
    $('music-list-status').textContent = 'Loading…';
    try {
      const result = await api.spotifyLibrary(kind, append ? next : 0, playlistId);
      if (requestEpoch !== epoch || requestList !== listEpoch || !dialog.open) return;
      for (const item of result.items) {
        const row = document.createElement('div'); row.className = 'music-row';
        const text = document.createElement('div'); text.append(link(item.name, item.url));
        const detail = document.createElement('small'); detail.textContent = kind === 'playlists' ? item.owner : item.artists; text.append(detail); row.append(text);
        if (kind === 'playlists' && item.available) {
          const button = document.createElement('button'); button.className = 'quiet'; button.textContent = 'View songs';
          button.onclick = () => { kind = 'playlist'; playlistId = item.id; $('music-list-title').textContent = item.name; void loadList(); }; row.append(button);
        }
        $('music-list').append(row);
      }
      next = result.next; $('music-more').hidden = next === null;
      $('music-list-status').textContent = result.total ? `${$('music-list').children.length} of ${result.total}` : 'Nothing saved here yet.';
    } catch (e) { if (requestEpoch === epoch && requestList === listEpoch) $('music-list-status').textContent = message(e); }
    finally { if (requestList === listEpoch) { listBusy = false; $('music-more').disabled = false; } }
  }
  async function open() {
    await openWorkspace(); dialog.showModal();playbackTask.sync();
    void refreshSinging();
    if (!api) { controls(); $('music-status').textContent = 'Open the desktop app to connect Spotify.'; return; }
    try {
      const status = await api.spotifyStatus(); controls(status);
      $('music-status').textContent = status.error || (status.connecting ? 'Finish signing in in your browser.' : status.connected ? 'Connected · read-only access' : 'Connect to browse your Liked Songs, playlists and current song.');
      if (connected) { void refreshNow(); void loadList(); }
    } catch (e) { $('music-status').textContent = message(e); }
  }
  $('music-button').onclick = () => void open();
  const floatingButton = document.createElement('button'); floatingButton.id = 'floating-music'; floatingButton.textContent = '♫'; floatingButton.title = 'Open Spotify library'; floatingButton.setAttribute('aria-label', 'Open Spotify library');
  document.getElementById('floating-ideas-bar').append(floatingButton); floatingButton.onclick = () => void open();
  $('music-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { playbackTask.sync(); epoch++; listEpoch++; listBusy = false; $('music-list').replaceChildren(); $('music-now-track').replaceChildren(); });
  $('spotify-connect').onclick = async () => {
    const requestEpoch = ++epoch;
    controls({ connecting: true }); $('music-status').textContent = 'Finish signing in and approve read access in your browser.';
    try {
      const status = await api.spotifyConnect($('spotify-client').value);
      if (requestEpoch !== epoch) return;
      controls(status); $('music-status').textContent = 'Connected · read-only access'; void refreshNow(); void loadList();
    } catch (e) { if (requestEpoch === epoch) { controls(await api.spotifyStatus()); $('music-status').textContent = message(e); } }
  };
  $('spotify-disconnect').onclick = async () => {
    epoch++; listEpoch++; listBusy = false;
    try { controls(await api.spotifyDisconnect()); $('music-status').textContent = 'Disconnected. Saved Spotify tokens and displayed library data were removed. You can also revoke access at spotify.com/account/apps.'; }
    catch (e) { $('music-status').textContent = message(e); }
  };
  $('music-liked').onclick = () => { kind = 'liked'; playlistId = undefined; $('music-list-title').textContent = 'Liked Songs'; void loadList(); };
  $('music-playlists').onclick = () => { kind = 'playlists'; playlistId = undefined; $('music-list-title').textContent = 'Your playlists'; void loadList(); };
  $('music-more').onclick = () => void loadList(true);
  $('music-refresh').onclick = () => void refreshNow();
  document.addEventListener('visibilitychange',()=>playbackTask.sync());
  window.addEventListener('beforeunload',()=>playbackTask.dispose());
}
