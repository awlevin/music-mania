// The only thing in Music Mania that makes sound. It runs on the host screen;
// phones never load it.
//
// One <audio> element plays every preview, routed through a Web Audio graph
// for the fade-outs and the spectrum the record's halo draws. The iTunes CDN
// sends `access-control-allow-origin: *`, so the analyser gets real samples.

const FADE_SECONDS = 0.5;

/** A twentieth of a second of silence, as a WAV file. */
function silence(): string {
  const samples = 2205;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 88200, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

export class Jukebox {
  private audio: HTMLAudioElement;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrum: Uint8Array<ArrayBuffer> | null = null;
  private prefetcher: HTMLAudioElement | null = null;
  private primed = false;

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
    // Safari blesses each media element separately, and only for a play()
    // made inside a click. Spend this click on a moment of silence.
    if (!this.primed && !this.audio.src) {
      this.audio.src = silence();
      await this.audio.play();
      this.primed = true;
    }
  }

  get unlocked(): boolean {
    return this.context?.state === 'running';
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
  async play(offsetSeconds = 0, loop = false, volume = 1): Promise<void> {
    this.audio.loop = loop;
    if (this.gain && this.context) {
      this.gain.gain.cancelScheduledValues(this.context.currentTime);
      this.gain.gain.setValueAtTime(volume, this.context.currentTime);
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

  /**
   * A sad trombone, synthesised: four falling notes, the last one sagging.
   * It plays over the song without touching it.
   */
  womp(): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const out = context.createGain();
    out.gain.value = 0.22;
    const mute = context.createBiquadFilter();
    mute.type = 'lowpass';
    mute.frequency.value = 900;
    mute.connect(out).connect(context.destination);

    const notes = [233.1, 220, 207.7, 196];
    let at = context.currentTime + 0.05;
    notes.forEach((hz, i) => {
      const last = i === notes.length - 1;
      const length = last ? 1.1 : 0.34;
      const horn = context.createOscillator();
      horn.type = 'sawtooth';
      horn.frequency.setValueAtTime(hz, at);
      if (last) horn.frequency.exponentialRampToValueAtTime(hz * 0.84, at + length);
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(1, at + 0.04);
      envelope.gain.setValueAtTime(1, at + length - 0.08);
      envelope.gain.linearRampToValueAtTime(0, at + length);
      horn.connect(envelope).connect(mute);
      horn.start(at);
      horn.stop(at + length + 0.02);
      at += length + 0.03;
    });
  }

  stop(): void {
    this.audio.pause();
  }
}

let shared: Jukebox | null = null;

/**
 * One jukebox per tab. "Host a game" on the landing page unlocks it with its
 * click; the host screen, reached without a page load, inherits it unlocked,
 * so a game started from a phone can play straight away.
 */
export function getJukebox(): Jukebox {
  shared ??= new Jukebox();
  return shared;
}
