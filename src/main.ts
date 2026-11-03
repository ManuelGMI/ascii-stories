import './style.css';
import { CHARSETS } from './atlas';
import { makeDemoImage } from './demo';
import { DEFAULTS, Engine, OUT_H, OUT_W, revealProgress, type Anim, type Params } from './engine';
import { GifMedia, ImageMedia, VideoMedia, type Media } from './media';
import { buildCurve, sampleCurve, type PulseSource } from './analysis';
import { AudioTrack } from './audio';
import { buildAudioUI } from './audioui';
import { drawTextLayers, newLayer, type HitRect } from './text';
import { buildTextUI, type Project } from './textui';
import { buildExportUI } from './exportui';
import { fmtTime, slider as uiSlider } from './ui';
import { CUSTOM_PALETTE, NO_PALETTE, PALETTES, resolvePalette } from './palette';

const canvas = document.getElementById('preview') as HTMLCanvasElement;
const panel = document.getElementById('controls') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLCanvasElement;
overlay.width = OUT_W;
overlay.height = OUT_H;
const octx = overlay.getContext('2d')!;

let engine: Engine;
try {
  engine = new Engine(canvas);
} catch (e) {
  status.textContent = String(e);
  throw e;
}

const params: Params = { ...DEFAULTS };
let needRender = true; // hay que repintar el ASCII (WebGL)
let needOverlay = true; // hay que repintar el texto
const redraw = () => { needRender = true; needOverlay = true; };

// Escribe en el DOM solo si el valor cambió (cada escritura puede forzar un recálculo de layout).
const domCache = new WeakMap<object, string>();
function setText(el: HTMLElement, v: string) {
  if (domCache.get(el) !== v) {
    el.textContent = v;
    domCache.set(el, v);
  }
}
function setValue(el: HTMLInputElement, v: string) {
  if (domCache.get(el) !== v) {
    el.value = v;
    domCache.set(el, v);
  }
}

// ---------- Construcción de controles ----------
function section(title: string) {
  const s = document.createElement('section');
  s.innerHTML = `<h2>${title}</h2>`;
  panel.appendChild(s);
  return s;
}

// Controles enlazados a `params`; refreshControls() los resincroniza tras cambios por código.
const refreshers: (() => void)[] = [];
const refreshControls = () => refreshers.forEach((f) => f());

function slider(
  s: HTMLElement, label: string, key: keyof Params,
  min: number, max: number, step: number,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'row';
  const val = document.createElement('span');
  val.className = 'val';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(params[key]);
  const upd = () => (val.textContent = Number(input.value).toFixed(step < 1 ? 2 : 0));
  upd();
  refreshers.push(() => {
    input.value = String(params[key]);
    upd();
  });
  input.addEventListener('input', () => {
    (params[key] as number) = Number(input.value);
    upd();
    redraw();
  });
  input.addEventListener('dblclick', () => {
    input.value = String(DEFAULTS[key]);
    input.dispatchEvent(new Event('input'));
  });
  row.append(Object.assign(document.createElement('span'), { textContent: label }), val, input);
  s.appendChild(row);
  return row;
}

function checkbox(s: HTMLElement, label: string, key: 'invert' | 'revealLoop' | 'pulseOn' | 'pulseText') {
  const row = document.createElement('label');
  row.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = params[key];
  input.addEventListener('change', () => {
    params[key] = input.checked;
    redraw();
  });
  row.append(input, document.createTextNode(' ' + label));
  s.appendChild(row);
}

function color(s: HTMLElement, label: string, key: 'monoColor' | 'bgColor'): HTMLElement {
  const row = document.createElement('label');
  row.className = 'check';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = params[key];
  input.addEventListener('input', () => {
    params[key] = input.value;
    redraw();
  });
  row.append(input, document.createTextNode(' ' + label));
  s.appendChild(row);
  return row;
}

// Imagen
const sImg = section('Imagen');
const file = document.createElement('input');
file.type = 'file';
file.accept = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm';
file.addEventListener('change', () => {
  const f = file.files?.[0];
  file.value = ''; // permite volver a elegir el mismo archivo
  if (f) void loadFile(f);
});
sImg.appendChild(file);
const loadMsg = document.createElement('p');
loadMsg.className = 'hint error';
loadMsg.hidden = true;
sImg.appendChild(loadMsg);
const btnRemove = document.createElement('button');
btnRemove.textContent = 'Quitar imagen';
btnRemove.title = 'Vuelve a la imagen de prueba';
btnRemove.addEventListener('click', () => {
  loadMsg.hidden = true;
  setMedia(new ImageMedia(makeDemoImage()), 'Imagen de prueba');
});
sImg.appendChild(btnRemove);
// Vista previa: la exportación siempre es 1080×1920; la vista previa puede renderizarse a menos
// resolución para gastar menos GPU (mismos parámetros, se escalan solos).
let previewScale = 2 / 3;
const previewSel = document.createElement('select');
[['1', 'Vista previa: alta (1080×1920)'], ['0.6667', 'Vista previa: media (720×1280)'], ['0.5', 'Vista previa: baja (540×960)']]
  .forEach(([v, l]) => previewSel.add(new Option(l, v)));
previewSel.value = '0.6667';
previewSel.addEventListener('change', () => {
  previewScale = Number(previewSel.value);
  engine.setResolution(previewScale);
  redraw();
});
sImg.appendChild(previewSel);
engine.setResolution(previewScale);

// Estilo
const sSt = section('Estilo');
const styleSel = document.createElement('select');
['ASCII a color', 'ASCII monocromo', 'Pixel art', 'Dithering (tramado)'].forEach((n, i) => styleSel.add(new Option(n, String(i))));
sSt.appendChild(styleSel);
styleSel.addEventListener('change', () => setStyle(Number(styleSel.value)));

// Línea de tiempo del proyecto: gobierna revelado, textos y audio.
const project: Project = { layers: [newLayer()], selected: '' };
project.selected = project.layers[0].id;
const story = { duration: 15 };
const audio = new AudioTrack();
const projectDuration = () => (audio.buffer ? audio.duration : story.duration);

const sTl = section('Línea de tiempo');
const tlRow = document.createElement('div');
tlRow.className = 'two';
const btnPlayAll = Object.assign(document.createElement('button'), { textContent: '❚❚ Pausa' });
const btnRestart = Object.assign(document.createElement('button'), { textContent: '↺ Reiniciar' });
tlRow.append(btnPlayAll, btnRestart);
const tlScrub = document.createElement('input');
tlScrub.type = 'range';
tlScrub.min = '0';
tlScrub.max = '1000';
tlScrub.value = '0';
const tlLabel = document.createElement('span');
tlLabel.className = 'val';
sTl.append(tlRow, tlScrub, tlLabel);
const durRow = document.createElement('div');
sTl.appendChild(durRow);
const durSlider = uiSlider(durRow, 'Duración de la historia (s)', story, 'duration', 3, 60, 0.5, () => redraw(), 15);
const durHint = document.createElement('p');
durHint.className = 'hint';
durHint.textContent = 'La duración sigue el recorte del audio.';
durHint.hidden = true;
sTl.appendChild(durHint);

let clock = 0;
let clockPlaying = true;
let lastNow = performance.now();
let tlScrubbing = false;

function restartAll() {
  clock = 0;
  if (media && media.kind !== 'image') media.seek(0);
  if (clockPlaying) audio.playFrom(0);
  redraw();
}
function togglePlay() {
  clockPlaying = !clockPlaying;
  if (clockPlaying) {
    audio.playFrom(clock);
    media?.play();
  } else {
    audio.stop();
    media?.pause();
  }
  redraw();
}
btnPlayAll.addEventListener('click', togglePlay);
btnRestart.addEventListener('click', restartAll);
tlScrub.addEventListener('pointerdown', () => (tlScrubbing = true));
tlScrub.addEventListener('input', () => {
  clock = (Number(tlScrub.value) / 1000) * projectDuration();
  audio.stop();
  if (media && media.kind !== 'image') media.seek(clock % media.duration);
  redraw();
});
tlScrub.addEventListener('change', () => {
  tlScrubbing = false;
  if (clockPlaying) audio.playFrom(clock);
});
function updateTimeline() {
  const dur = projectDuration();
  setText(btnPlayAll, clockPlaying ? '❚❚ Pausa' : '▶︎ Reproducir');
  if (!tlScrubbing) setValue(tlScrub, String(Math.round((clock / dur) * 1000)));
  setText(tlLabel, `${fmtTime(clock)} / ${fmtTime(dur)}`);
  durSlider.disabled = !!audio.buffer;
  durHint.hidden = !audio.buffer;
}

// Transporte (vídeo / GIF)
const sTr = section('Reproducción');
const transport = document.createElement('div');
sTr.appendChild(transport);
transport.className = 'transport';
const btnPlay = document.createElement('button');
const btnPrev = Object.assign(document.createElement('button'), { textContent: '◀︎ 1 fotograma' });
const btnNext = Object.assign(document.createElement('button'), { textContent: '1 fotograma ▶︎' });
const timeline = document.createElement('input');
timeline.type = 'range';
timeline.min = '0';
timeline.max = '1000';
timeline.value = '0';
const timeLabel = document.createElement('span');
timeLabel.className = 'val';
const fpsSel = document.createElement('select');
fpsSel.add(new Option('30 fps', '30'));
fpsSel.add(new Option('60 fps', '60'));
const stepRow = document.createElement('div');
stepRow.className = 'two';
stepRow.append(btnPrev, btnNext);
transport.append(btnPlay, timeline, timeLabel, stepRow, fpsSel);
let fps = 30;
let scrubbing = false;
fpsSel.addEventListener('change', () => (fps = Number(fpsSel.value)));
btnPlay.addEventListener('click', togglePlay);
btnPrev.addEventListener('click', () => media?.step(-1, fps));
btnNext.addEventListener('click', () => media?.step(1, fps));
timeline.addEventListener('pointerdown', () => (scrubbing = true));
timeline.addEventListener('pointerup', () => (scrubbing = false));
timeline.addEventListener('input', () => media?.seek((Number(timeline.value) / 1000) * media.duration));

const fmt = fmtTime;
function updateTransport() {
  const animated = !!media && media.kind !== 'image';
  transport.hidden = !animated;
  sTr.hidden = !animated;
  if (!media || !animated) return;
  setText(btnPlay, clockPlaying ? '❚❚ Pausa' : '▶︎ Reproducir');
  if (!scrubbing) setValue(timeline, String(Math.round((media.time / media.duration) * 1000)));
  setText(timeLabel, `${fmt(media.time)} / ${fmt(media.duration)}`);
}
sTr.hidden = true;

const btnPng = document.createElement('button');
btnPng.textContent = 'Exportar PNG 1080×1920';
btnPng.addEventListener('click', async () => {
  const blob = await exportFrame();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ascii-story.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
sImg.appendChild(btnPng);

// Caracteres
const sCh = section('Caracteres');
const rowCell = slider(sCh, 'Tamaño de celda / píxel (px)', 'cell', 3, 40, 1);
const preset = document.createElement('select');
for (const name of Object.keys(CHARSETS)) preset.add(new Option(name, name));
preset.add(new Option('Personalizado', ''));
const custom = document.createElement('input');
custom.type = 'text';
custom.className = 'text';
custom.spellcheck = false;
const setChars = (v: string) => {
  params.charset = v;
  redraw();
};
preset.addEventListener('change', () => {
  if (preset.value) {
    custom.value = CHARSETS[preset.value];
    setChars(custom.value);
  }
});
custom.addEventListener('input', () => {
  preset.value = Object.entries(CHARSETS).find(([, v]) => v === custom.value)?.[0] ?? '';
  setChars(custom.value);
});
preset.value = 'Referencia';
custom.value = CHARSETS.Referencia;
params.charset = custom.value;
sCh.append(preset, custom);
checkbox(sCh, 'Invertir luminosidad', 'invert');

// Bordes
const sEd = section('Bordes y contornos');
slider(sEd, 'Intensidad (0 = off)', 'edgeStrength', 0, 10, 0.1);
slider(sEd, 'Umbral', 'edgeThreshold', 0, 1.5, 0.01);

// Color
const sCo = section('Color');
slider(sCo, 'Brillo', 'brightness', -0.5, 0.5, 0.01);
slider(sCo, 'Contraste', 'contrast', 0.3, 2.5, 0.01);
slider(sCo, 'Saturación', 'saturation', 0, 3, 0.01);
slider(sCo, 'Gamma', 'gamma', 0.4, 2.5, 0.01);
const rowBoost = slider(sCo, 'Intensidad del carácter', 'glyphBoost', 0.5, 2, 0.01);
const rowMono = color(sCo, 'Color monocromo', 'monoColor');
const monoInput = rowMono.querySelector('input') as HTMLInputElement;
const monoPresets = document.createElement('div');
monoPresets.className = 'two';
for (const [name, c] of [['Blanco', '#f2f2f2'], ['Verde terminal', '#33ff66'], ['Ámbar', '#ffb000'], ['Cian', '#33ddff']]) {
  const b = document.createElement('button');
  b.textContent = name;
  b.addEventListener('click', () => {
    params.monoColor = c;
    monoInput.value = c;
    redraw();
  });
  monoPresets.appendChild(b);
}
sCo.appendChild(monoPresets);

// Paleta y tramado (pixel art / dithering)
const sPal = section('Paleta y tramado');
const palSel = document.createElement('select');
for (const n of [...Object.keys(PALETTES), CUSTOM_PALETTE, NO_PALETTE]) palSel.add(new Option(n, n));
const palCustom = document.createElement('input');
palCustom.type = 'text';
palCustom.className = 'text';
palCustom.spellcheck = false;
palCustom.placeholder = '#000000 #ff0066 #ffffff …';
const swatches = document.createElement('div');
swatches.className = 'swatches';
const dithSel = document.createElement('select');
['Sin tramado', 'Ordenado (Bayer)', 'Difusión de error (Floyd–Steinberg)', 'Difusión de error (Atkinson)']
  .forEach((n, i) => dithSel.add(new Option(n, String(i))));
const matSel = document.createElement('select');
[['1', 'Matriz Bayer 2×2'], ['2', 'Matriz Bayer 4×4'], ['3', 'Matriz Bayer 8×8']].forEach(([v, l]) => matSel.add(new Option(l, v)));
const dithHint = document.createElement('p');
dithHint.className = 'hint';
dithHint.textContent = 'La difusión de error puede titilar en vídeo; Bayer es estable entre fotogramas.';
sPal.append(palSel, palCustom, swatches, dithSel, matSel);
const rowDither = slider(sPal, 'Intensidad del tramado', 'ditherAmount', 0, 2, 0.01);
sPal.appendChild(dithHint);

function syncPaletteUI() {
  palSel.value = params.palette;
  palCustom.value = params.customPalette;
  palCustom.hidden = params.palette !== CUSTOM_PALETTE;
  dithSel.value = String(params.ditherMode);
  matSel.value = String(params.bayerLevels);
  matSel.hidden = params.ditherMode !== 1;
  rowDither.hidden = params.ditherMode === 0;
  swatches.replaceChildren(
    ...resolvePalette(params.palette, params.customPalette).map((c) =>
      Object.assign(document.createElement('span'), { title: `rgb(${c})` , style: `background: rgb(${c})` }) as HTMLElement),
  );
}
palSel.addEventListener('change', () => { params.palette = palSel.value; syncPaletteUI(); redraw(); });
palCustom.addEventListener('input', () => { params.customPalette = palCustom.value; syncPaletteUI(); redraw(); });
dithSel.addEventListener('change', () => { params.ditherMode = Number(dithSel.value); syncPaletteUI(); redraw(); });
matSel.addEventListener('change', () => { params.bayerLevels = Number(matSel.value); redraw(); });

// Cada grupo de estilos recuerda su tamaño de celda y contornos.
const groupStore = { ascii: { cell: 12, edgeStrength: 3 }, grid: { cell: 6, edgeStrength: 0 } };
let group: 'ascii' | 'grid' = 'ascii';
function setStyle(v: number) {
  const prev = params.style;
  const g = v >= 2 ? 'grid' : 'ascii';
  if (g !== group) {
    groupStore[group] = { cell: params.cell, edgeStrength: params.edgeStrength };
    Object.assign(params, groupStore[g]);
    group = g;
  }
  if (v === 2 && prev !== 2) Object.assign(params, { palette: 'PICO-8', ditherMode: 0 });
  if (v === 3 && prev !== 3) Object.assign(params, { palette: 'Blanco y negro', ditherMode: 1, bayerLevels: 2, ditherAmount: 1 });
  params.style = v;
  styleSel.value = String(v);
  refreshControls();
  syncPaletteUI();
  const grid = v >= 2;
  sCh.hidden = grid;
  sPal.hidden = !grid;
  rowBoost.hidden = rowMono.hidden = rowBgMix.hidden = grid;
  rowMono.hidden = monoPresets.hidden = v !== 1;
  rowCell.hidden = false;
  redraw();
}

// Fondo y efectos
const sFx = section('Fondo y efectos');
color(sFx, 'Color de fondo', 'bgColor');
const rowBgMix = slider(sFx, 'Imagen tenue en el fondo', 'bgMix', 0, 0.6, 0.01);
slider(sFx, 'Scanlines', 'scanlines', 0, 1, 0.01);
slider(sFx, 'Grosor scanline (px)', 'scanPeriod', 2, 16, 1);
slider(sFx, 'Brillo CRT (bloom)', 'bloom', 0, 3, 0.01);

const sAn = section('Animación');
const revealSel = document.createElement('select');
['Sin revelado', 'Carácter a carácter (aleatorio)', 'Escritura (línea a línea)', 'Barrido →', 'Barrido ↓', 'Radial desde el centro', 'Lluvia Matrix']
  .forEach((n, i) => revealSel.add(new Option(n, String(i))));
revealSel.addEventListener('change', () => {
  params.reveal = Number(revealSel.value);
  restartClock();
});
sAn.appendChild(revealSel);
slider(sAn, 'Duración del revelado (s)', 'revealDuration', 0.5, 15, 0.1);
slider(sAn, 'Pausa antes de repetir (s)', 'revealHold', 0, 8, 0.1);
checkbox(sAn, 'Repetir en bucle', 'revealLoop');
slider(sAn, 'Parpadeo de caracteres', 'flicker', 0, 1, 0.01);
slider(sAn, 'Velocidad del parpadeo (Hz)', 'flickerRate', 1, 30, 1);
slider(sAn, 'Scanlines en movimiento (px/s)', 'scanSpeed', -200, 200, 1);
slider(sAn, 'Barra de brillo CRT', 'scanBar', 0, 1, 0.01);
slider(sAn, 'Destellos CRT', 'crtFlash', 0, 1, 0.01);
function restartClock() {
  restartAll();
}
function animActive() {
  return (
    params.pulseOn || params.reveal > 0 || params.flicker > 0 || params.scanSpeed !== 0 || params.scanBar > 0 || params.crtFlash > 0
  );
}
async function exportFrame(): Promise<Blob> {
  engine.setResolution(1); // el PNG siempre sale a 1080×1920
  engine.render(params, currentAnim()); // y se copia en la misma tarea, antes de que se limpie el búfer
  const out = document.createElement('canvas');
  out.width = OUT_W;
  out.height = OUT_H;
  const c = out.getContext('2d')!;
  c.drawImage(canvas, 0, 0);
  drawTextLayers(c, project.layers, clock, projectDuration(), undefined, currentAnim().textScale ?? 1);
  engine.setResolution(previewScale);
  redraw();
  return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
}
// Pulso al ritmo: función determinista del tiempo (vale igual en vista previa y exportación).
let curve: Float32Array | null = null;
let curveKey = '';
let curveEnv: unknown = null;
function pulseLevel(t: number): number {
  if (!params.pulseOn) return 0;
  let v = 0;
  if (params.pulseSource === 'metronome') {
    v = Math.exp(-((t * params.pulseBpm) / 60 % 1) * 5);
  } else if (audio.env) {
    const key = `${params.pulseSource}|${params.pulseAttack}|${params.pulseRelease}`;
    if (key !== curveKey || curveEnv !== audio.env) {
      curve = buildCurve(audio.env, params.pulseSource as PulseSource, params.pulseAttack, params.pulseRelease);
      curveKey = key;
      curveEnv = audio.env;
    }
    v = sampleCurve(curve!, audio.env.hop, audio.trimStart + t);
  }
  return v * params.pulseSens;
}

function currentAnim(t = clock): Anim {
  const level = pulseLevel(t);
  return {
    time: t,
    progress: params.reveal > 0 ? revealProgress(params, t) : 1,
    level,
    textScale: params.pulseText ? 1 + level * params.pulseZoom * 1.5 : 1,
  };
}

const sPu = section('Pulso al ritmo');
checkbox(sPu, 'Activar pulso', 'pulseOn');
const pulseSel = document.createElement('select');
[['bass', 'Graves (bombo)'], ['mid', 'Medios'], ['high', 'Agudos'], ['vol', 'Volumen general'], ['beat', 'Golpes (beats detectados)'], ['metronome', 'Metrónomo (sin audio)']]
  .forEach(([v, l]) => pulseSel.add(new Option(l, v)));
sPu.appendChild(pulseSel);
const pulseHint = document.createElement('p');
pulseHint.className = 'hint';
sPu.appendChild(pulseHint);
const rowBpm = slider(sPu, 'Pulsaciones por minuto', 'pulseBpm', 40, 220, 1);
rowBpm.hidden = true;
pulseSel.addEventListener('change', () => {
  params.pulseSource = pulseSel.value;
  rowBpm.hidden = pulseSel.value !== 'metronome';
  redraw();
});
slider(sPu, 'Sensibilidad', 'pulseSens', 0.2, 3, 0.01);
slider(sPu, 'Ataque (ms)', 'pulseAttack', 1, 200, 1);
slider(sPu, 'Relajación (ms)', 'pulseRelease', 20, 1200, 1);
slider(sPu, 'Brillo de la imagen', 'pulseBright', 0, 0.6, 0.01);
slider(sPu, 'Destello (bloom)', 'pulseGlow', 0, 3, 0.01);
slider(sPu, 'Zoom de la imagen', 'pulseZoom', 0, 0.3, 0.005);
checkbox(sPu, 'El texto también late', 'pulseText');
const meter = document.createElement('div');
meter.className = 'meter';
const meterBar = document.createElement('div');
meter.appendChild(meterBar);
sPu.appendChild(meter);
let meterW = '';
function updatePulseUI(level: number) {
  const w = `${Math.round((Math.min(level, 1.5) / 1.5) * 100)}%`;
  if (w !== meterW) {
    meterBar.style.width = w;
    meterW = w;
  }
  const needAudio = params.pulseSource !== 'metronome' && !audio.env;
  setText(pulseHint, !params.pulseOn
    ? 'Desactivado.'
    : needAudio ? 'Carga un audio (o elige “Metrónomo”) para ver el pulso.' : 'Activo: reacciona al ritmo.');
}

const sTx = section('Texto');
const textUI = buildTextUI(sTx, project, projectDuration, redraw);

const sAu = section('Audio');
const audioUI = buildAudioUI(
  sAu, audio,
  () => { if (clockPlaying) audio.playFrom(0); clock = 0; redraw(); },
  (commit) => {
    clock = Math.min(clock, Math.max(audio.duration - 0.01, 0));
    if (commit && clockPlaying) audio.playFrom(clock);
    redraw();
  },
  () => redraw(),
);

const sVid = section('Vídeo / GIF');
slider(sVid, 'Suavizado temporal (0 = off)', 'smooth', 0, 0.9, 0.01);

setStyle(0);

const sEx = section('Exportar');
let exporting = false;
buildExportUI(sEx, {
  begin() {
    const was = { playing: clockPlaying, clock };
    engine.setResolution(1);
    clockPlaying = false;
    exporting = true;
    audio.stop();
    media?.pause();
    return () => {
      exporting = false;
      engine.setResolution(previewScale);
      clock = was.clock;
      media?.refresh();
      if (media && media.kind !== 'image') media.seek(clock % media.duration);
      clockPlaying = was.playing;
      if (was.playing) {
        audio.playFrom(clock);
        media?.play();
      }
      redraw();
    };
  },
  input: () => ({
    engine, glCanvas: canvas, params, media, layers: project.layers, audio,
    duration: projectDuration(), animAt: (t: number) => currentAnim(t),
  }),
});

const btnReset = document.createElement('button');
btnReset.textContent = 'Restablecer';
btnReset.addEventListener('click', () => location.reload());
panel.appendChild(btnReset);

// ---------- Carga de medios ----------
let media: Media | null = null;
let pulling = false;

function setMedia(m: Media, label: string) {
  media?.dispose();
  media = m;
  if (m.kind !== 'image') {
    // La historia dura lo que el vídeo / GIF (entre 3 y 60 s); se puede cambiar después.
    durSlider.value = String(Math.min(60, Math.max(3, Math.round(m.duration * 2) / 2)));
    durSlider.dispatchEvent(new Event('input'));
  }
  clock = 0;
  status.textContent = `${label} · ${m.width}×${m.height}` + (m.kind !== 'image' ? ` · ${fmt(m.duration)}` : '');
  redraw();
}

// El formato se decide por el contenido (no por la extensión): muchos ".gif" de descargas
// son en realidad WebP animado o MP4.
type Sniffed = { kind: 'gif' | 'webp' | 'png' | 'jpeg' | 'video' | 'heic' | 'other'; mime: string };
async function sniff(f: Blob): Promise<Sniffed> {
  const b = new Uint8Array(await f.slice(0, 16).arrayBuffer());
  const at = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (at(0, 4) === 'GIF8') return { kind: 'gif', mime: 'image/gif' };
  if (at(0, 4) === 'RIFF' && at(8, 4) === 'WEBP') return { kind: 'webp', mime: 'image/webp' };
  if (b[0] === 0x89 && at(1, 3) === 'PNG') return { kind: 'png', mime: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8) return { kind: 'jpeg', mime: 'image/jpeg' };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', mime: 'video/webm' };
  if (at(4, 4) === 'ftyp') {
    const brand = at(8, 4);
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) return { kind: 'heic', mime: 'image/heic' };
    if (brand === 'avif') return { kind: 'other', mime: 'image/avif' };
    return { kind: 'video', mime: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4' };
  }
  return { kind: 'other', mime: f.type };
}

async function loadFile(f: File) {
  loadMsg.hidden = true;
  const still = async () => setMedia(new ImageMedia(await createImageBitmap(f)), f.name);
  try {
    const { kind, mime } = await sniff(f);
    if (kind === 'video') {
      status.textContent = 'Cargando vídeo…';
      setMedia(await VideoMedia.load(f.slice(0, f.size, mime)), f.name);
    } else if (kind === 'gif' || kind === 'webp' || kind === 'png') {
      // Puede ser animado (GIF, WebP, APNG) o fijo.
      let anim: GifMedia | null = null;
      if (typeof ImageDecoder !== 'undefined') {
        try {
          anim = await GifMedia.load(f.slice(0, f.size, mime), (i, n) => (status.textContent = `Leyendo fotogramas… ${i}/${n}`), mime);
        } catch {
          anim = null; // se intentará como imagen fija
        }
      } else if (kind === 'gif') {
        throw new Error('Este navegador no soporta GIF animado. Usa Chrome.');
      }
      if (anim && anim.frameCount > 1) setMedia(anim, `${f.name} · ${anim.frameCount} fotogramas`);
      else {
        anim?.dispose();
        await still();
      }
    } else if (kind === 'heic') {
      throw new Error('Chrome no abre HEIC. Expórtala como JPG o PNG.');
    } else {
      await still();
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    loadMsg.textContent = `No se pudo abrir «${f.name}»: ${why}`;
    loadMsg.hidden = false;
    status.textContent = 'Error al cargar el archivo';
    console.error(e);
  }
}
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (f) void loadFile(f);
});

let hits: HitRect[] = [];
// Firma del estado visible del texto: cambia cuando una capa aparece/desaparece o está en plena
// animación de entrada/salida (o late con la música). Así el texto solo se repinta cuando hace falta.
function overlaySignature(): string {
  const dur = projectDuration();
  const pulsing = params.pulseOn && params.pulseText;
  let sig = project.selected;
  for (const L of project.layers) {
    const tOut = L.untilEnd ? dur : L.tOut;
    if (clock < L.tIn || clock > tOut) {
      sig += 'h';
      continue;
    }
    const moving =
      pulsing || (L.animIn !== 'none' && clock < L.tIn + L.animDur) || (L.exitFade > 0 && clock > tOut - L.exitFade);
    sig += moving ? `|${clock.toFixed(3)}` : 'v';
  }
  return sig;
}
let overlaySig = '';
function drawOverlay() {
  octx.clearRect(0, 0, OUT_W, OUT_H);
  hits = drawTextLayers(octx, project.layers, clock, projectDuration(), project.selected, currentAnim().textScale ?? 1);
}

// Arrastrar textos sobre la vista previa
let drag: { id: string; dx: number; dy: number } | null = null;
const toCanvas = (e: PointerEvent) => {
  const r = overlay.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * OUT_W, y: ((e.clientY - r.top) / r.height) * OUT_H };
};
overlay.addEventListener('pointerdown', (e) => {
  if (exporting) return;
  const p = toCanvas(e);
  const hit = [...hits].reverse().find((h) => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h);
  if (!hit) return;
  const L = project.layers.find((l) => l.id === hit.id)!;
  project.selected = L.id;
  drag = { id: L.id, dx: p.x - L.x * OUT_W, dy: p.y - L.y * OUT_H };
  overlay.setPointerCapture(e.pointerId);
  overlay.classList.add('dragging');
  textUI.refresh();
  redraw();
});
overlay.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const L = project.layers.find((l) => l.id === drag!.id);
  if (!L) return;
  const p = toCanvas(e);
  L.x = Math.min(Math.max((p.x - drag.dx) / OUT_W, 0), 1);
  L.y = Math.min(Math.max((p.y - drag.dy) / OUT_H, 0), 1);
  redraw();
});
const endDrag = () => {
  if (!drag) return;
  drag = null;
  overlay.classList.remove('dragging');
  textUI.refresh();
};
overlay.addEventListener('pointerup', endDrag);
overlay.addEventListener('pointercancel', endDrag);

function loop() {
  requestAnimationFrame(loop);
  if (exporting) return; // el exportador usa el motor y el reloj
  const m = media;
  if (m && !pulling) {
    pulling = true;
    m.pull()
      .then((fr) => {
        if (!fr || m !== media) return;
        engine.ingest(fr.src, m.width, m.height, params.smooth, fr.reset);
        fr.close?.();
        needRender = true;
      })
      .catch((err) => console.warn('pull', err))
      .finally(() => (pulling = false));
  }
  const now = performance.now();
  const dt = (now - lastNow) / 1000;
  lastNow = now;
  if (clockPlaying) {
    clock = audio.running ? audio.clockTime : clock + dt;
    if (clock >= projectDuration()) restartAll();
  }
  // Solo se dibuja si algo cambió: parámetros, un fotograma nuevo, una animación en marcha o
  // texto en transición. Una imagen fija en pausa o sin animaciones no gasta GPU.
  const sig = overlaySignature();
  const drawGL = needRender || (clockPlaying && animActive());
  const drawText = needOverlay || sig !== overlaySig;
  if (drawGL) {
    needRender = false;
    engine.render(params, currentAnim());
  }
  if (drawText) {
    needOverlay = false;
    overlaySig = sig;
    drawOverlay();
  }
  if (params.pulseOn) updatePulseUI(pulseLevel(clock));
  else updatePulseUI(0);
  audioUI.draw(audio.buffer ? clock : -1);
  updateTimeline();
  updateTransport();
}

setMedia(new ImageMedia(makeDemoImage()), 'Imagen de prueba');
status.textContent = 'Imagen de prueba · arrastra una foto, GIF o vídeo, o usa el selector';
loop();

if (import.meta.env.DEV) (window as unknown as { __app: unknown }).__app = { audio, pulseLevel, params };
