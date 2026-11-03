// Tramado por difusión de error (Floyd–Steinberg, Atkinson) sobre la cuadrícula de píxeles.
// Es secuencial, así que se hace en CPU sobre la cuadrícula (pocos miles de píxeles).

export type DiffusionKernel = 'fs' | 'atkinson';

// [dx, dy, peso]
const KERNELS: Record<DiffusionKernel, [number, number, number][]> = {
  fs: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
  atkinson: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
};

let errBuf = new Float32Array(0);
const cache = new Int16Array(32768);

/**
 * Cuantiza `rgba` (w×h, filas de arriba abajo) a la paleta, difundiendo el error.
 * `amount` (0..1) escala el error que se propaga: 0 = sin tramado, 1 = completo.
 * Modifica `rgba` en el sitio.
 */
export function diffuse(
  rgba: Uint8Array, w: number, h: number, palette: number[][], kernel: DiffusionKernel, amount: number,
) {
  const n = w * h;
  if (errBuf.length < n * 3) errBuf = new Float32Array(n * 3);
  errBuf.fill(0, 0, n * 3);
  cache.fill(-1);

  const nearest = (r: number, g: number, b: number) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let idx = cache[key];
    if (idx >= 0) return idx;
    const cr = (r & 0xf8) | 4, cg = (g & 0xf8) | 4, cb = (b & 0xf8) | 4;
    let best = Infinity;
    idx = 0;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const dr = p[0] - cr, dg = p[1] - cg, db = p[2] - cb;
      const d = 0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db;
      if (d < best) { best = d; idx = i; }
    }
    cache[key] = idx;
    return idx;
  };

  const k = KERNELS[kernel];
  for (let y = 0; y < h; y++) {
    const ltr = (y & 1) === 0; // serpentina: evita las líneas diagonales típicas
    for (let s = 0; s < w; s++) {
      const x = ltr ? s : w - 1 - s;
      const i = y * w + x;
      const e = i * 3;
      const r = Math.min(255, Math.max(0, rgba[i * 4] + errBuf[e]));
      const g = Math.min(255, Math.max(0, rgba[i * 4 + 1] + errBuf[e + 1]));
      const b = Math.min(255, Math.max(0, rgba[i * 4 + 2] + errBuf[e + 2]));
      const p = palette[nearest(r, g, b)];
      rgba[i * 4] = p[0];
      rgba[i * 4 + 1] = p[1];
      rgba[i * 4 + 2] = p[2];
      rgba[i * 4 + 3] = 255;
      if (amount <= 0) continue;
      const er = (r - p[0]) * amount, eg = (g - p[1]) * amount, eb = (b - p[2]) * amount;
      for (const [dx, dy, wt] of k) {
        const nx = x + (ltr ? dx : -dx), ny = y + dy;
        if (nx < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 3;
        errBuf[j] += er * wt;
        errBuf[j + 1] += eg * wt;
        errBuf[j + 2] += eb * wt;
      }
    }
  }
}
