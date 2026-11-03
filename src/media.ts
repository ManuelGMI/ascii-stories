// Fuentes de medios con una interfaz común de "transporte" (play, seek, paso a paso).

export interface Frame {
  src: TexImageSource;
  reset: boolean; // true tras un salto de tiempo: se descarta el suavizado temporal
  close?: () => void;
}

export interface Media {
  kind: 'image' | 'video' | 'gif';
  width: number;
  height: number;
  duration: number; // s (0 en imágenes)
  time: number; // s
  playing: boolean;
  play(): void;
  pause(): void;
  seek(t: number): void;
  step(dir: number, fps: number): void;
  /** Devuelve un fotograma nuevo si lo hay desde la última llamada. */
  pull(): Promise<Frame | null>;
  /** Fotograma exacto en el instante t del proyecto (en bucle). Para exportar; el medio debe estar en pausa. */
  frameAt(t: number): Promise<Frame>;
  /** Fuerza que el siguiente pull() entregue el fotograma actual (tras exportar). */
  refresh(): void;
  dispose(): void;
}

export class ImageMedia implements Media {
  kind = 'image' as const;
  duration = 0;
  time = 0;
  playing = false;
  private done = false;
  constructor(private src: ImageBitmap | HTMLCanvasElement) {}
  get width() { return this.src.width; }
  get height() { return this.src.height; }
  play() {}
  pause() {}
  seek() {}
  step() {}
  async pull(): Promise<Frame | null> {
    if (this.done) return null;
    this.done = true;
    return { src: this.src, reset: true };
  }
  async frameAt(): Promise<Frame> { return { src: this.src, reset: true }; }
  refresh() { this.done = false; }
  dispose() { if (this.src instanceof ImageBitmap) this.src.close(); }
}

export class VideoMedia implements Media {
  kind = 'video' as const;
  private dirty = true;
  private discontinuity = true;
  private lastTime = 0;
  private hasRvfc: boolean;

  private constructor(private video: HTMLVideoElement, private url: string) {
    video.addEventListener('seeked', () => { this.dirty = true; this.discontinuity = true; });
    this.hasRvfc = 'requestVideoFrameCallback' in video;
    if (this.hasRvfc) {
      const onFrame = () => {
        this.dirty = true;
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
    }
  }

  static async load(file: Blob): Promise<VideoMedia> {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; // el audio llega en el paso 4
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.addEventListener('loadeddata', () => res(), { once: true });
      v.addEventListener('error', () => rej(new Error('No se pudo decodificar el vídeo')), { once: true });
    });
    const m = new VideoMedia(v, url);
    await v.play().catch(() => {});
    return m;
  }

  get width() { return this.video.videoWidth; }
  get height() { return this.video.videoHeight; }
  get duration() { return this.video.duration; }
  get time() { return this.video.currentTime; }
  get playing() { return !this.video.paused; }
  play() { void this.video.play(); }
  pause() { this.video.pause(); }
  seek(t: number) { this.video.currentTime = Math.min(Math.max(t, 0), this.duration); }
  step(dir: number, fps: number) {
    this.pause();
    // Centro del intervalo del fotograma destino, para caer siempre en el fotograma exacto.
    const n = Math.round(this.video.currentTime * fps - 0.5) + dir;
    this.seek((n + 0.5) / fps);
  }

  async pull(): Promise<Frame | null> {
    const v = this.video;
    if (v.readyState < 2) return null;
    if (!this.hasRvfc && !v.paused) this.dirty = true;
    if (!this.dirty) return null;
    this.dirty = false;
    const reset = this.discontinuity || v.currentTime < this.lastTime - 0.2; // salto o bucle
    this.discontinuity = false;
    this.lastTime = v.currentTime;
    return { src: v, reset };
  }

  private exportLast = -1;
  async frameAt(t: number): Promise<Frame> {
    const v = this.video;
    const tt = Math.min(this.duration > 0 ? t % this.duration : 0, Math.max(this.duration - 0.001, 0));
    const reset = tt < this.exportLast; // bucle
    this.exportLast = tt;
    if (Math.abs(v.currentTime - tt) > 1e-4) {
      await new Promise<void>((res) => {
        v.addEventListener('seeked', () => res(), { once: true });
        v.currentTime = tt;
      });
    }
    return { src: v, reset };
  }
  refresh() { this.dirty = true; this.discontinuity = true; this.exportLast = -1; }

  dispose() {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    URL.revokeObjectURL(this.url);
  }
}

import { decompressFrames, parseGIF, type ParsedFrame } from 'gifuct-js';

type FrameSrc = { src: TexImageSource; close?: () => void };

// Secuencia de fotogramas con duraciones (GIF, WebP animado…). La lógica de tiempo, pausa y
// paso a paso es común; cada subclase solo sabe sacar el fotograma i.
abstract class FrameSequence implements Media {
  kind = 'gif' as const;
  playing = true;
  duration: number;
  private t = 0; // s
  private lastTick = performance.now();
  private shown = -1;
  private busy = false;
  private discontinuity = true;
  private starts: number[] = [];
  private exportLast = -1;

  constructor(protected durations: number[], readonly width: number, readonly height: number) {
    let acc = 0;
    for (const d of durations) {
      this.starts.push(acc);
      acc += d;
    }
    this.duration = acc / 1000;
  }

  /** Fotograma i (0-based). Puede devolver siempre el mismo lienzo reutilizado. */
  protected abstract getFrame(i: number): Promise<FrameSrc>;
  abstract dispose(): void;

  get frameCount() { return this.durations.length; }
  private indexAt(sec: number) {
    const ms = sec * 1000;
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= ms) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  get time() { this.advance(); return this.t; }
  private advance() {
    const now = performance.now();
    if (this.playing) this.t = (this.t + (now - this.lastTick) / 1000) % this.duration;
    this.lastTick = now;
  }
  play() { this.advance(); this.playing = true; }
  pause() { this.advance(); this.playing = false; }
  seek(t: number) {
    this.advance();
    this.t = Math.min(Math.max(t, 0), this.duration - 0.001);
    this.discontinuity = true;
  }
  step(dir: number) {
    this.pause();
    const n = (this.indexAt(this.t) + dir + this.frameCount) % this.frameCount;
    this.seek((this.starts[n] + this.durations[n] / 2) / 1000);
  }

  async pull(): Promise<Frame | null> {
    this.advance();
    const i = this.indexAt(this.t);
    if (i === this.shown || this.busy) return null;
    this.busy = true;
    try {
      const f = await this.getFrame(i);
      const reset = this.discontinuity || i < this.shown;
      this.discontinuity = false;
      this.shown = i;
      return { src: f.src, reset, close: f.close };
    } finally {
      this.busy = false;
    }
  }

  async frameAt(t: number): Promise<Frame> {
    const i = this.indexAt(t % this.duration);
    const reset = i < this.exportLast;
    this.exportLast = i;
    const f = await this.getFrame(i);
    return { src: f.src, reset, close: f.close };
  }
  refresh() { this.shown = -1; this.discontinuity = true; this.exportLast = -1; }
}

// Con ImageDecoder (WebCodecs; Chrome / Brave). Los fotogramas se decodifican bajo demanda
// para no llenar la memoria; solo se guardan las duraciones.
export class GifMedia extends FrameSequence {
  private constructor(private dec: ImageDecoder, durations: number[], w: number, h: number) {
    super(durations, w, h);
  }

  static async load(file: Blob, onProgress?: (i: number, n: number) => void, mime = 'image/gif'): Promise<GifMedia> {
    if (typeof ImageDecoder === 'undefined') throw new Error('Este navegador no soporta ImageDecoder');
    const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: mime });
    await dec.tracks.ready;
    const n = dec.tracks.selectedTrack!.frameCount;
    const durations: number[] = [];
    let w = 0, h = 0;
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const ms = (image.duration ?? 100000) / 1000;
      durations.push(ms <= 10 ? 100 : ms); // convención de los navegadores
      w = image.displayWidth;
      h = image.displayHeight;
      image.close();
      onProgress?.(i + 1, n);
    }
    return new GifMedia(dec, durations, w, h);
  }

  protected async getFrame(i: number): Promise<FrameSrc> {
    const { image } = await this.dec.decode({ frameIndex: i });
    return { src: image, close: () => image.close() };
  }
  dispose() { this.dec.close(); }
}

type GifFrame = ParsedFrame;

// Alternativa en JavaScript puro (gifuct-js) para navegadores sin ImageDecoder, como Safari
// en el iPhone. Compone los fotogramas sobre un lienzo respetando los modos de descarte del GIF.
export class JsGifMedia extends FrameSequence {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private patch = document.createElement('canvas');
  private pctx: CanvasRenderingContext2D;
  private cur = -1; // último fotograma compuesto en el lienzo
  private saved: ImageData | null = null; // para disposalType 3 (restaurar lo anterior)

  private constructor(private frames: GifFrame[], durations: number[], w: number, h: number) {
    super(durations, w, h);
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.pctx = this.patch.getContext('2d')!;
  }

  static async load(file: Blob, onProgress?: (i: number, n: number) => void): Promise<JsGifMedia> {
    const gif = parseGIF(await file.arrayBuffer());
    const frames = decompressFrames(gif, true) as ParsedFrame[];
    if (!frames.length) throw new Error('GIF sin fotogramas');
    const durations = frames.map((f) => (f.delay <= 10 ? 100 : f.delay));
    onProgress?.(frames.length, frames.length);
    return new JsGifMedia(frames, durations, gif.lsd.width, gif.lsd.height);
  }

  private apply(j: number) {
    const f = this.frames[j];
    const prev = this.frames[j - 1];
    if (prev) {
      if (prev.disposalType === 2) this.ctx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
      else if (prev.disposalType === 3 && this.saved) this.ctx.putImageData(this.saved, 0, 0);
    }
    this.saved = f.disposalType === 3 ? this.ctx.getImageData(0, 0, this.width, this.height) : null;
    const { width, height, left, top } = f.dims;
    this.patch.width = width;
    this.patch.height = height;
    this.pctx.putImageData(new ImageData(f.patch as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    this.ctx.drawImage(this.patch, left, top); // drawImage respeta la transparencia del parche
  }

  protected async getFrame(i: number): Promise<FrameSrc> {
    if (i < this.cur) {
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.cur = -1;
      this.saved = null;
    }
    while (this.cur < i) this.apply(++this.cur);
    return { src: this.canvas };
  }
  dispose() {}
}
