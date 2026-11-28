// Canonical mono PCM WAV, accepted by Apple's AVAudioFile without an external
// codec dependency. Mix channels without changing the recording's sample rate.
export function encodeWav(channels: ReadonlyArray<ArrayLike<number>>, sampleRate: number): Uint8Array {
  const length = channels[0]?.length;
  if (!length || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000 || length / sampleRate > 65 || channels.some(c => c.length !== length)) {
    throw new Error('Unsupported local recording. Record up to 60 seconds and try again.');
  }
  const bytes = new Uint8Array(44 + length * 2), view = new DataView(bytes.buffer);
  const label = (at: number, text: string): void => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  label(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); label(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + (Number.isFinite(channel[i]) ? channel[i] : 0), 0) / channels.length));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export async function localRecording(blob: Blob): Promise<Uint8Array> {
  const context = new AudioContext({ sampleRate: 48000 });
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return encodeWav(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), buffer.sampleRate);
  } finally { await context.close(); }
}
