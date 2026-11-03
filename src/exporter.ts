import { GIFEncoder, quantize } from 'gifenc';
import {
  AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output,
  canEncodeAudio, canEncodeVideo,
} from 'mediabunny';
import type { AudioTrack } from './audio';
import { OUT_H, OUT_W, type Anim, type Engine, type Params } from './engine';
import type { Media } from './media';
import { drawTextLayers, type TextLayer } from './text';

export interface ExportInput {
  engine: Engine;
  glCanvas: HTMLCanvasElement;
  params: Params;
  media: Media | null;
  layers: TextLayer[];
  audio: AudioTrack;
  duration: number; // s
  animAt(t: number): Anim;
}

export type Progress = (done: number, total: number) => void;

/** Dibuja el fotograma del instante t (ASCII + texto) en un lienzo 2D de 1080×1920. */
async function renderFrame(cx: ExportInput, comp: CanvasRenderingContext2D, t: number, first: boolean) {
  const m = cx.media;
  // Las imágenes fijas no cambian: basta con subirlas una vez.
  if (m && !(m.kind === 'image' && !first)) {
    const fr = await m.frameAt(t);
    cx.engine.ingest(fr.src, m.width, m.height, cx.params.smooth, first || fr.reset);
    fr.close?.();
  }
  cx.engine.render(cx.params, cx.animAt(t));
  comp.drawImage(cx.glCanvas, 0, 0); // en la misma tarea que render(), antes de que se limpie el búfer
  drawTextLayers(comp, cx.layers, t, cx.duration);
}

function makeComp() {
  const c = document.createElement('canvas');
  c.width = OUT_W;
  c.height = OUT_H;
  return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: false })! };
}

const tick = () => new Promise<void>((r) => setTimeout(r));
const abortError = () => new DOMException('Exportación cancelada', 'AbortError');

/** Audio recortado y con volumen aplicado, renderizado offline a 48 kHz estéreo. */
async function renderAudio(audio: AudioTrack, duration: number): Promise<AudioBuffer> {
  const sr = 48000;
  const off = new OfflineAudioContext(2, Math.ceil(duration * sr), sr);
  const src = off.createBufferSource();
  src.buffer = audio.buffer;
  const gain = off.createGain();
  gain.gain.value = audio.volume;
  src.connect(gain).connect(off.destination);
  src.start(0, audio.trimStart, duration);
  return off.startRendering();
}

export interface Mp4Options { fps: number; bitrate: number }

export async function exportMp4(cx: ExportInput, o: Mp4Options, progress: Progress, signal: AbortSignal): Promise<Blob> {
  const withAudio = !!cx.audio.buffer;
  if (!(await canEncodeVideo('avc', { width: OUT_W, height: OUT_H, bitrate: o.bitrate, frameRate: o.fps }))) {
    throw new Error(`Este navegador no puede codificar H.264 a ${OUT_W}×${OUT_H} y ${o.fps} fps. Usa Chrome en el Mac.`);
  }
  if (withAudio && !(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 }))) {
    throw new Error('Este navegador no puede codificar audio AAC. Usa Chrome en el Mac.');
  }

  const { canvas, ctx } = makeComp();
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: o.bitrate });
  output.addVideoTrack(video, { frameRate: o.fps });
  const audioSrc = withAudio ? new AudioBufferSource({ codec: 'aac', bitrate: 192_000 }) : null;
  if (audioSrc) output.addAudioTrack(audioSrc);

  await output.start();
  try {
    if (audioSrc) await audioSrc.add(await renderAudio(cx.audio, cx.duration));
    const n = Math.max(1, Math.round(cx.duration * o.fps));
    for (let i = 0; i < n; i++) {
      if (signal.aborted) throw abortError();
      await renderFrame(cx, ctx, i / o.fps, i === 0);
      await video.add(i / o.fps, 1 / o.fps);
      progress(i + 1, n);
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return new Blob([target.buffer!], { type: 'video/mp4' });
}

// ---------- GIF ----------

export interface GifOptions { width: number; delayCs: number; dither: boolean }

/** Floyd–Steinberg contra la paleta, con caché del color más cercano por cubo de 5 bits. */
function ditherFS(rgba: Uint8ClampedArray, palette: number[][], w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r: number, g: number, b: number) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = cache[key];
    if (idx >= 0) return idx;
    const cr = (r & 0xf8) | 4, cg = (g & 0xf8) | 4, cb = (b & 0xf8) | 4;
    let best = Infinity;
    idx = 0;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - cr) ** 2 + (p[1] - cg) ** 2 + (p[2] - cb) ** 2;
      if (d < best) { best = d; idx = i; }
    }
    cache[key] = idx;
    return idx;
  };
  let cur = new Float32Array((w + 2) * 3);
  let nxt = new Float32Array((w + 2) * 3);
  for (let y = 0; y < h; y++) {
    nxt.fill(0);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = (x + 1) * 3;
      const r = Math.min(255, Math.max(0, rgba[i * 4] + cur[e]));
      const g = Math.min(255, Math.max(0, rgba[i * 4 + 1] + cur[e + 1]));
      const b = Math.min(255, Math.max(0, rgba[i * 4 + 2] + cur[e + 2]));
      const idx = nearest(r, g, b);
      out[i] = idx;
      const p = palette[idx];
      const er = r - p[0], eg = g - p[1], eb = b - p[2];
      for (let c = 0; c < 3; c++) {
        const err = c === 0 ? er : c === 1 ? eg : eb;
        cur[e + 3 + c] += err * (7 / 16);
        nxt[e - 3 + c] += err * (3 / 16);
        nxt[e + c] += err * (5 / 16);
        nxt[e + 3 + c] += err * (1 / 16);
      }
    }
    [cur, nxt] = [nxt, cur];
  }
  return out;
}

export async function exportGif(cx: ExportInput, o: GifOptions, progress: Progress, signal: AbortSignal): Promise<Blob> {
  const w = o.width;
  const h = Math.round((w * OUT_H) / OUT_W);
  const dt = o.delayCs / 100;
  const n = Math.max(1, Math.round(cx.duration / dt));
  const { ctx: comp } = makeComp();
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = 'high';

  const gif = GIFEncoder();
  for (let i = 0; i < n; i++) {
    if (signal.aborted) throw abortError();
    await renderFrame(cx, comp, i * dt, i === 0);
    sctx.drawImage(comp.canvas, 0, 0, w, h);
    const { data } = sctx.getImageData(0, 0, w, h);
    const palette: number[][] = quantize(data, 256); // paleta optimizada por fotograma
    const index = o.dither ? ditherFS(data, palette, w, h) : nearestIndex(data, palette, w * h);
    gif.writeFrame(index, w, h, { palette, delay: o.delayCs * 10 });
    progress(i + 1, n);
    await tick();
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

function nearestIndex(rgba: Uint8ClampedArray, palette: number[][], n: number): Uint8Array {
  const out = new Uint8Array(n);
  const cache = new Int16Array(32768).fill(-1);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = cache[key];
    if (idx < 0) {
      let best = Infinity;
      idx = 0;
      for (let j = 0; j < palette.length; j++) {
        const p = palette[j];
        const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
        if (d < best) { best = d; idx = j; }
      }
      cache[key] = idx;
    }
    out[i] = idx;
  }
  return out;
}
