"use strict";

// Decode MP3 segments and encode them as one 16-bit mono PCM WAV file.
// eslint-disable-next-line no-unused-vars
async function encodeWav(mp3Segments, sampleRate = 24000, onProgress = () => {}) {
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const pcm = [];
  let samples = 0;
  for (let i = 0; i < mp3Segments.length; i++) {
    const bytes = mp3Segments[i];
    // decodeAudioData detaches its input, so pass a copy.
    const buf = await ctx.decodeAudioData(bytes.slice().buffer);
    const ch = buf.getChannelData(0);
    const out = new Int16Array(ch.length);
    for (let k = 0; k < ch.length; k++) {
      const v = Math.max(-1, Math.min(1, ch[k]));
      out[k] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    pcm.push(out);
    samples += out.length;
    onProgress(i + 1, mp3Segments.length);
  }

  const dataBytes = samples * 2;
  const wav = new Uint8Array(44 + dataBytes);
  const dv = new DataView(wav.buffer);
  const str = (off, s) => { for (let k = 0; k < s.length; k++) wav[off + k] = s.charCodeAt(k); };
  str(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);          // fmt chunk size
  dv.setUint16(20, 1, true);           // PCM
  dv.setUint16(22, 1, true);           // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byte rate
  dv.setUint16(32, 2, true);           // block align
  dv.setUint16(34, 16, true);          // bits per sample
  str(36, "data");
  dv.setUint32(40, dataBytes, true);
  let off = 44;
  for (const chunk of pcm) {
    wav.set(new Uint8Array(chunk.buffer), off);
    off += chunk.byteLength;
  }
  return wav;
}
