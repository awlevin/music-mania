// The only thing in Music Mania that makes sound. It runs on the host screen;
// phones never load it.
//
// One <audio> element plays every preview, routed through a Web Audio graph
// for the fade-outs and the spectrum the record's halo draws. The iTunes CDN
// sends `access-control-allow-origin: *`, so the analyser gets real samples.

const FADE_SECONDS = 0.5;

export class Jukebox {
  private audio: HTMLAudioElement;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrum: Uint8Array<ArrayBuffer> | null = null;
  private prefetcher: HTMLAudioElement | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.audio.preload = 'auto';
  }

  /**
   * Browsers only let sound start from a click. Call this from one; after
   * that the jukebox may play for the rest of the page's life.
   */
  async unlock(): Promise<void> {
    if (!this.context) {
      const context = new AudioContext();
      const source = context.createMediaElementSource(this.audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      const gain = context.createGain();
      source.connect(analyser).connect(gain).connect(context.destination);
      this.context = context;
      this.analyser = analyser;
      this.gain = gain;
      this.spectrum = new Uint8Array(analyser.frequencyBinCount);
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  get currentUrl(): string {
    return this.audio.src;
  }

  get playing(): boolean {
    return !this.audio.paused && !this.audio.ended;
  }

  /** Resolves once enough of `url` has arrived to play without stalling. */
  load(url: string, timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = this.audio;
      const done = (error?: Error) => {
        clearTimeout(timer);
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('error', onError);
        if (error) reject(error);
        else resolve();
      };
      const onReady = () => done();
      const onError = () => done(new Error('The preview would not load.'));
      const timer = setTimeout(() => done(new Error('The preview took too long.')), timeoutMs);
      audio.addEventListener('canplaythrough', onReady);
      audio.addEventListener('error', onError);
      audio.pause();
      audio.src = url;
      audio.load();
    });
  }

  /** Start from `offsetSeconds`. Resolves when sound is actually coming out. */
  async play(offsetSeconds = 0): Promise<void> {
    if (this.gain && this.context) {
      this.gain.gain.cancelScheduledValues(this.context.currentTime);
      this.gain.gain.setValueAtTime(1, this.context.currentTime);
    }
    if (offsetSeconds > 0) this.audio.currentTime = offsetSeconds;
    await this.audio.play();
  }

  async fadeOut(): Promise<void> {
    if (!this.playing) return;
    if (this.gain && this.context) {
      const t = this.context.currentTime;
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(this.gain.gain.value, t);
      this.gain.gain.linearRampToValueAtTime(0, t + FADE_SECONDS);
      await new Promise((r) => setTimeout(r, FADE_SECONDS * 1000));
    }
    this.audio.pause();
  }

  /** Warm the browser cache with the next round's preview. */
  prefetch(url: string): void {
    if (this.prefetcher?.src === url) return;
    this.prefetcher = new Audio();
    this.prefetcher.crossOrigin = 'anonymous';
    this.prefetcher.preload = 'auto';
    this.prefetcher.src = url;
  }

  /** Current spectrum, 0–255 per bin; null until unlocked. */
  readSpectrum(): Uint8Array | null {
    if (!this.analyser || !this.spectrum) return null;
    this.analyser.getByteFrequencyData(this.spectrum);
    return this.spectrum;
  }

  stop(): void {
    this.audio.pause();
  }
}
