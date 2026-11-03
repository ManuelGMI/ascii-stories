// Análisis de ritmo: envolventes por banda, volumen y golpes (onsets) del audio completo.
// Se calcula una vez al cargar el audio; después todo son consultas por instante, así que la
// vista previa y la exportación dan exactamente el mismo resultado.

export type PulseSource = 'bass' | 'mid' | 'high' | 'vol' | 'beat';

export interface AudioEnvelope {
  hop: number; // s entre muestras de la envolvente
  bass: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  vol: Float32Array;
  beat: Float32Array; // impulsos (0..1) en los golpes detectados
}

const N = 2048;

// FFT radix-2 iterativa (in situ)
const cosT = new Float32Array(N / 2);
const sinT = new Float32Array(N / 2);
for (let i = 0; i < N / 2; i++) {
  cosT[i] = Math.cos((2 * Math.PI * i) / N);
  sinT[i] = -Math.sin((2 * Math.PI * i) / N);
}
const rev = new Uint16Array(N);
for (let i = 0; i < N; i++) {
  let r = 0;
  for (let b = 0; b < 11; b++) if (i & (1 << b)) r |= 1 << (10 - b);
  rev[i] = r;
}
const hann = new Float32Array(N);
for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

function fft(re: Float32Array, im: Float32Array) {
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const a = start + k, b = a + half;
        const xr = re[b] * cosT[t] - im[b] * sinT[t];
        const xi = re[b] * sinT[t] + im[b] * cosT[t];
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

/** Normaliza por el percentil 95 para que 1.0 sea "fuerte" en cualquier canción. */
function normalize(a: Float32Array) {
  const sorted = Float32Array.from(a).sort();
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1e-9;
  for (let i = 0; i < a.length; i++) a[i] = Math.min(a[i] / p95, 1.5);
}

export async function analyzeAudio(buf: AudioBuffer, hopSec = 0.01): Promise<AudioEnvelope> {
  const sr = buf.sampleRate;
  const hop = Math.max(1, Math.round(sr * hopSec));
  const frames = Math.max(1, Math.floor(buf.length / hop));
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const mono = (i: number) => {
    let s = 0;
    for (const d of chans) s += d[i];
    return s / chans.length;
  };

  const bin = (hz: number) => Math.min(N / 2 - 1, Math.max(1, Math.round((hz * N) / sr)));
  const bands: [number, number][] = [[bin(20), bin(150)], [bin(150), bin(2000)], [bin(2000), bin(8000)]];
  const fluxTo = bin(5000);

  const bass = new Float32Array(frames), mid = new Float32Array(frames), high = new Float32Array(frames);
  const vol = new Float32Array(frames), flux = new Float32Array(frames);
  const re = new Float32Array(N), im = new Float32Array(N);
  const prev = new Float32Array(N / 2);
  const mag = new Float32Array(N / 2);

  for (let f = 0; f < frames; f++) {
    const start = f * hop - N / 2 + hop / 2;
    let rms = 0;
    for (let i = 0; i < N; i++) {
      const j = Math.round(start) + i;
      const v = j >= 0 && j < buf.length ? mono(j) : 0;
      re[i] = v * hann[i];
      im[i] = 0;
      rms += v * v;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    const mean = ([a, b]: [number, number]) => {
      let s = 0;
      for (let k = a; k < b; k++) s += mag[k];
      return s / Math.max(1, b - a);
    };
    bass[f] = mean(bands[0]);
    mid[f] = mean(bands[1]);
    high[f] = mean(bands[2]);
    vol[f] = Math.sqrt(rms / N);
    let fl = 0;
    for (let k = 1; k < fluxTo; k++) fl += Math.max(0, mag[k] - prev[k]) * (k < bands[0][1] ? 2 : 1);
    flux[f] = fl;
    prev.set(mag);
    if (f % 400 === 399) await new Promise((r) => setTimeout(r)); // no bloquear la interfaz
  }

  // Golpes: picos del flujo espectral por encima de la media local
  const beat = new Float32Array(frames);
  const pre = new Float64Array(frames + 1), pre2 = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) {
    pre[i + 1] = pre[i] + flux[i];
    pre2[i + 1] = pre2[i] + flux[i] * flux[i];
  }
  const W = Math.round(0.5 / hopSec), P = Math.round(0.06 / hopSec);
  for (let i = 0; i < frames; i++) {
    const a = Math.max(0, i - W), b = Math.min(frames, i + W + 1);
    const m = (pre[b] - pre[a]) / (b - a);
    const sd = Math.sqrt(Math.max(0, (pre2[b] - pre2[a]) / (b - a) - m * m));
    if (flux[i] <= m + sd) continue;
    let isMax = true;
    for (let j = Math.max(0, i - P); j <= Math.min(frames - 1, i + P) && isMax; j++) if (flux[j] > flux[i]) isMax = false;
    if (isMax) beat[i] = Math.min(1, 0.5 + (flux[i] - m) / (sd * 6 + 1e-9)); // todo golpe ≥ 0,5; los fuertes llegan a 1
  }

  for (const a of [bass, mid, high, vol]) normalize(a);
  return { hop: hop / sr, bass, mid, high, vol, beat };
}

/**
 * Curva suavizada (ataque / relajación exponenciales) de una fuente, a la resolución de la envolvente.
 * Es determinista: no depende del ritmo de fotogramas con que se consulte.
 */
export function buildCurve(env: AudioEnvelope, source: PulseSource, attackMs: number, releaseMs: number): Float32Array {
  const src = env[source];
  const out = new Float32Array(src.length);
  const ca = 1 - Math.exp(-env.hop / Math.max(attackMs / 1000, 1e-4));
  const cr = 1 - Math.exp(-env.hop / Math.max(releaseMs / 1000, 1e-4));
  let y = 0;
  for (let i = 0; i < src.length; i++) {
    y += (src[i] - y) * (src[i] > y ? ca : cr);
    out[i] = y;
  }
  return out;
}

/** Valor de la curva en el instante t (s de audio), con interpolación lineal. */
export function sampleCurve(curve: Float32Array, hop: number, t: number): number {
  const x = t / hop;
  if (x <= 0) return curve[0] ?? 0;
  const i = Math.floor(x);
  if (i >= curve.length - 1) return curve[curve.length - 1] ?? 0;
  const f = x - i;
  return curve[i] * (1 - f) + curve[i + 1] * f;
}
