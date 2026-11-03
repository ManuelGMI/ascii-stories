import type { AudioTrack } from './audio';
import { button, el, fmtTime, slider } from './ui';

const W = 268;
const H = 56;

export interface AudioUI {
  /** Redibuja la onda (p. ej. para mostrar la posición de reproducción). */
  draw(playhead?: number): void;
}

/**
 * Panel de audio: carga, onda con asas de recorte arrastrables, entradas numéricas y volumen.
 * onTrim(commit): se llama al cambiar el recorte; commit = true al soltar / confirmar.
 */
export function buildAudioUI(
  parent: HTMLElement, audio: AudioTrack, onLoaded: () => void, onTrim: (commit: boolean) => void, onCleared: () => void,
): AudioUI {
  const file = el('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.wav' });
  const info = el('p', { className: 'hint', textContent: 'Sin audio. Carga un MP3, M4A o WAV.' });
  const wave = el('canvas', { width: W * 2, height: H * 2, className: 'wave' });
  const trimRow = el('div', { className: 'two' });
  const inStart = el('input', { type: 'number', step: '0.01', min: '0', className: 'text' });
  const inEnd = el('input', { type: 'number', step: '0.01', min: '0', className: 'text' });
  trimRow.append(
    el('label', { className: 'hint' }, 'Inicio (s)', inStart),
    el('label', { className: 'hint' }, 'Fin (s)', inEnd),
  );
  const box = el('div');
  parent.append(file, info, box);
  box.append(wave, trimRow);
  slider(box, 'Volumen', audio as never, 'volume', 0, 2, 0.01, () => audio.setVolume(audio.volume), 1);
  button(box, 'Quitar audio', () => {
    audio.clear();
    file.value = '';
    sync();
    onCleared();
  });
  box.hidden = true;

  const ctx = wave.getContext('2d')!;
  let peaks: Float32Array | null = null;
  let playhead = -1;

  // La onda (fondo, picos, asas) se pinta una vez en `base`; cada fotograma solo se
  // recompone si cambia la posición del cursor.
  const base = document.createElement('canvas');
  base.width = wave.width;
  base.height = wave.height;
  const bctx = base.getContext('2d')!;
  let dirty = true;
  let lastX = -2;

  function paintBase() {
    const b = audio.buffer!;
    const w = base.width, h = base.height;
    const a = (audio.trimStart / b.duration) * w;
    const e = (audio.trimEnd / b.duration) * w;
    bctx.clearRect(0, 0, w, h);
    bctx.fillStyle = '#1b1e27';
    bctx.fillRect(0, 0, w, h);
    bctx.fillStyle = '#2b3a55';
    bctx.fillRect(a, 0, e - a, h);
    for (let i = 0; i < peaks!.length; i++) {
      bctx.fillStyle = i >= a && i <= e ? '#7fb6ff' : '#4a4f60';
      const ph2 = Math.max(2, peaks![i] * h * 0.9);
      bctx.fillRect(i, (h - ph2) / 2, 1, ph2);
    }
    bctx.fillStyle = '#ffcc33';
    bctx.fillRect(a - 2, 0, 4, h);
    bctx.fillRect(e - 2, 0, 4, h);
  }

  function draw(ph = playhead) {
    playhead = ph;
    const b = audio.buffer;
    if (!b || !peaks) {
      if (lastX !== -3) {
        ctx.clearRect(0, 0, wave.width, wave.height);
        lastX = -3;
      }
      return;
    }
    const x = ph >= 0 ? Math.round(((audio.trimStart + ph) / b.duration) * wave.width) : -1;
    if (!dirty && x === lastX) return; // nada que repintar
    if (dirty) {
      paintBase();
      dirty = false;
    }
    ctx.clearRect(0, 0, wave.width, wave.height);
    ctx.drawImage(base, 0, 0);
    if (x >= 0) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 1, 0, 2, wave.height);
    }
    lastX = x;
  }

  function sync() {
    const b = audio.buffer;
    box.hidden = !b;
    if (!b) {
      info.textContent = 'Sin audio. Carga un MP3, M4A o WAV.';
      peaks = null;
      return;
    }
    peaks = audio.peaks(wave.width);
    dirty = true;
    info.textContent = `${audio.name} · ${fmtTime(b.duration)} · recorte ${fmtTime(audio.duration)}`;
    inStart.value = audio.trimStart.toFixed(2);
    inEnd.value = audio.trimEnd.toFixed(2);
    inStart.max = inEnd.max = String(b.duration);
    draw();
  }

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    info.textContent = 'Decodificando y analizando el ritmo…';
    try {
      await audio.load(f);
      sync();
      onLoaded();
    } catch {
      info.textContent = 'No se pudo decodificar ese audio';
    }
  });

  const MIN = 0.1;
  function setTrim(start: number, end: number, commit: boolean) {
    const b = audio.buffer!;
    start = Math.min(Math.max(start, 0), b.duration - MIN);
    end = Math.min(Math.max(end, start + MIN), b.duration);
    audio.trimStart = start;
    audio.trimEnd = end;
    inStart.value = start.toFixed(2);
    inEnd.value = end.toFixed(2);
    info.textContent = `${audio.name} · ${fmtTime(b.duration)} · recorte ${fmtTime(audio.duration)}`;
    dirty = true;
    draw();
    onTrim(commit);
  }
  inStart.addEventListener('change', () => setTrim(Number(inStart.value), audio.trimEnd, true));
  inEnd.addEventListener('change', () => setTrim(audio.trimStart, Number(inEnd.value), true));

  // Arrastrar asas
  let dragging: 'start' | 'end' | null = null;
  const timeAt = (e: PointerEvent) => {
    const r = wave.getBoundingClientRect();
    return Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * audio.buffer!.duration;
  };
  wave.addEventListener('pointerdown', (e) => {
    if (!audio.buffer) return;
    const t = timeAt(e);
    dragging = Math.abs(t - audio.trimStart) <= Math.abs(t - audio.trimEnd) ? 'start' : 'end';
    wave.setPointerCapture(e.pointerId);
    move(e);
  });
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const t = timeAt(e);
    if (dragging === 'start') setTrim(t, audio.trimEnd, false);
    else setTrim(audio.trimStart, t, false);
  };
  wave.addEventListener('pointermove', move);
  const stop = () => {
    if (!dragging) return;
    dragging = null;
    onTrim(true);
  };
  wave.addEventListener('pointerup', stop);
  wave.addEventListener('pointercancel', stop);

  return { draw };
}
