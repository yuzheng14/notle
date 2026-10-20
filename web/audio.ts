import type { AudioTake } from './types';

// MediaRecorder produces WebM/MP4; both ASR providers accept PCM WAV.
// Decode/resample in the browser, retaining the original take for playback/download/retry.
export async function prepareAudio(take: AudioTake): Promise<{ blob: Blob; durationMs: number }> {
  if (take.durationMs > 600_000) throw new Error('每段音频最长 10 分钟，请分段后重试。');
  let decoded: AudioBuffer;
  const decoder = new OfflineAudioContext(1, 1, 16_000);
  try { decoded = await decoder.decodeAudioData(await take.blob.arrayBuffer()); }
  catch { throw new Error('浏览器无法读取这段音频。请重新录音，或导入可播放的 WAV / MP3 文件。'); }
  if (!decoded.length || decoded.duration > 600) throw new Error('音频不能为空且最长为 10 分钟，请分段后重试。');
  const frames = Math.ceil(decoded.duration * 16_000);
  const context = new OfflineAudioContext(1, frames, 16_000);
  const source = context.createBufferSource();
  source.buffer = decoded; source.connect(context.destination); source.start();
  const mono = (await context.startRendering()).getChannelData(0);
  const data = new ArrayBuffer(44 + mono.length * 2);
  const view = new DataView(data);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + mono.length * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, mono.length * 2, true);
  for (let i = 0; i < mono.length; i++) {
    const sample = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return { blob: new Blob([data], { type: 'audio/wav' }), durationMs: Math.round(decoded.duration * 1000) };
}
