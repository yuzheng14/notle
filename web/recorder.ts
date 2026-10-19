import type { AudioTake } from './types';
export type RecordingState = 'idle' | 'requesting' | 'recording' | 'stopping';
const LIMIT = 24_500_000;
export class Recorder {
  state: RecordingState = 'idle';
  private media?: MediaRecorder;
  private stream?: MediaStream;
  private context?: AudioContext;
  private timer?: number;
  private frame?: number;
  private started = 0;
  private disposed = false;
  constructor(private onState: (state: RecordingState, elapsed: number) => void, private onReady: (take: AudioTake) => void, private onError: (message: string) => void, private onLevels: (levels: number[]) => void) {}
  private update(state: RecordingState) { this.state = state; this.onState(state, this.started ? performance.now() - this.started : 0); }
  async start() {
    if (this.state !== 'idle' || this.disposed) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { this.onError('当前浏览器不支持录音。请使用新版浏览器，并通过 localhost 或 HTTPS 打开。'); return; }
    this.update('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      if (this.disposed) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const media = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 96_000 });
      this.media = media;
      const chunks: Blob[] = [];
      let bytes = 0;
      let failed = false;
      media.ondataavailable = event => {
        if (!event.data.size) return;
        chunks.push(event.data); bytes += event.data.size;
        if (bytes >= LIMIT && media.state === 'recording') { this.stop(); this.onError('已接近 25 MB 上限，录音已自动停止。'); }
      };
      media.onerror = () => { failed = true; this.stop(); this.onError('录音设备发生错误，请重新录音。'); };
      media.onstop = () => {
        const durationMs = performance.now() - this.started;
        const blob = new Blob(chunks, { type: media.mimeType || chunks[0]?.type || 'audio/webm' });
        this.release(); this.started = 0; this.update('idle');
        if (!this.disposed && !failed) {
          if (!blob.size || durationMs < 300) { this.onError('录音太短，请至少录制一秒后再停止。'); return; }
          if (blob.size > 25_000_000) { this.onError('录音超过 25 MB，请缩短后重试。'); return; }
          const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
          this.onReady({ blob, name: `notle-${Date.now()}.${extension}`, durationMs, url: URL.createObjectURL(blob) });
        }
      };
      stream.getAudioTracks().forEach(track => { track.onended = () => { if (this.state === 'recording') { this.stop(); this.onError('麦克风已断开，已保留录音。'); } }; });
      this.started = performance.now(); media.start(1000); this.update('recording');
      this.timer = window.setInterval(() => { this.onState(this.state, performance.now() - this.started); if (performance.now() - this.started >= 600_000) this.stop(); }, 200);
      this.measure(stream);
    } catch (error) {
      this.release(); this.started = 0; this.update('idle');
      const name = error instanceof DOMException ? error.name : '';
      this.onError(name === 'NotAllowedError' ? '麦克风访问被拒绝，请在浏览器地址栏的权限设置中允许录音。' : name === 'NotFoundError' ? '没有找到可用的麦克风，请连接设备后重试。' : '无法启动录音，请检查麦克风是否可用。');
    }
  }
  stop() { if (this.media?.state === 'recording') { this.update('stopping'); this.media.stop(); } }
  private measure(stream: MediaStream) {
    try {
      const context = new AudioContext(); this.context = context;
      const analyser = context.createAnalyser(); analyser.fftSize = 128;
      context.createMediaStreamSource(stream).connect(analyser);
      const values = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => { analyser.getByteFrequencyData(values); this.onLevels(Array.from({ length: 32 }, (_, index) => values[index * 2] / 255)); this.frame = requestAnimationFrame(draw); };
      draw();
    } catch { /* Metering is optional; MediaRecorder remains functional. */ }
  }
  private release() {
    clearInterval(this.timer); if (this.frame) cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    void this.context?.close().catch(() => {});
    this.context = undefined; this.stream = undefined; this.media = undefined;
  }
  dispose() { this.disposed = true; if (this.media?.state === 'recording') this.media.stop(); this.release(); }
}
