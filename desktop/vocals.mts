// Original non-lexical phrases only: callers cannot supply song names, lyrics,
// Spotify metadata, or arbitrary Fish control tags to this endpoint.
export const VOCAL_PROMPTS = Object.freeze({
  hum: '[softly humming a short gentle original melody, closed mouth, no words] Mmm, mm-mm, mmm.',
  sing: '[softly singing a short gentle original melody, unaccompanied] La la, la-la la, laa.',
});

export type VocalKind = keyof typeof VOCAL_PROMPTS;

export interface VocalProvider {
  keys: {
    fish?: string;
    [key: string]: unknown;
  };
  request(
    url: string,
    options: { method: string; headers: Record<string, string>; body: string },
    signal?: AbortSignal,
  ): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
}

export interface VocalSettings {
  voiceProvider?: string;
  fishVoiceId?: string;
  fishModel?: string;
}

export interface CreateVocalOptions {
  provider: VocalProvider;
  settings: VocalSettings;
  kind: string;
  signal?: AbortSignal;
  checkPlayback: () => Promise<unknown> | unknown;
}

export interface SpotifyLike {
  status(): { connected: boolean };
  nowPlaying(): Promise<{ playing?: boolean }>;
}

export async function createVocal({ provider, settings, kind, signal, checkPlayback }: CreateVocalOptions): Promise<Uint8Array> {
  if (!Object.hasOwn(VOCAL_PROMPTS, kind)) throw new Error('Choose humming or a wordless melody.');
  if (settings.voiceProvider !== 'fish') throw new Error('Select your Fish Audio custom voice in Settings to preview vocals.');
  if (!provider.keys.fish || !settings.fishVoiceId) throw new Error('Add your Fish Audio API key and custom voice ID in Settings first.');
  await checkPlayback(); signal?.throwIfAborted();
  const response = await provider.request('https://api.fish.audio/v1/tts', {
    method: 'POST', headers: { Authorization: `Bearer ${provider.keys.fish}`, model: settings.fishModel || 's2.1-pro-free', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: VOCAL_PROMPTS[kind as VocalKind], reference_id: settings.fishVoiceId, format: 'mp3' }),
  }, signal);
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal?.throwIfAborted(); await checkPlayback(); signal?.throwIfAborted();
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('Fish returned an empty or unusually large vocal clip. Try again.');
  return bytes;
}

export async function requireQuietSpotify(spotify: SpotifyLike): Promise<void> {
  if (!spotify.status().connected) return;
  let playback: { playing?: boolean };
  try { playback = await spotify.nowPlaying(); }
  catch { throw new Error('Could not check Spotify playback. Try again once Spotify is available.'); }
  if (playback.playing) throw new Error('Pause Spotify first. These original vocal previews play separately from your music.');
}
