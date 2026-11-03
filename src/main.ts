import './style.css';
import { CHARSETS } from './atlas';
import { makeDemoImage } from './demo';
import { DEFAULTS, Engine, OUT_H, OUT_W, revealProgress, type Anim, type Params } from './engine';
import { GifMedia, ImageMedia, VideoMedia, type Media } from './media';
import { AudioTrack } from './audio';
import { buildAudioUI } from './audioui';
import { drawTextLayers, newLayer, type HitRect } from './text';
import { buildTextUI, type Project } from './textui';
import { fmtTime, slider as uiSlider } from './ui';

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
let needRender = true;
const redraw = () => { needRender = true; };

// ---------- Construcción de controles ----------
function section(title: string) {
  const s = document.createElement('section');
  s.innerHTML = `<h2>${title}</h2>`;
  panel.appendChild(s);
  return s;
}

function slider(
  s: HTMLElement, label: string, key: keyof Params,
  min: number, max: number, step: number,
) {
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
}

function checkbox(s: HTMLElement, label: string, key: 'invert' | 'mono' | 'revealLoop') {
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

function color(s: HTMLElement, label: string, key: 'monoColor' | 'bgColor') {
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
}

// Imagen
const sImg = section('Imagen');
const file = document.createElement('input');
file.type = 'file';
file.accept = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm';
file.addEventListener('change', () => file.files?.[0] && loadFile(file.files[0]));
sImg.appendChild(file);
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
  btnPlayAll.textContent = clockPlaying ? '❚❚ Pausa' : '▶︎ Reproducir';
  if (!tlScrubbing) tlScrub.value = String((clock / dur) * 1000);
  tlLabel.textContent = `${fmtTime(clock)} / ${fmtTime(dur)}`;
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
  btnPlay.textContent = clockPlaying ? '❚❚ Pausa' : '▶︎ Reproducir';
  if (!scrubbing) timeline.value = String((media.time / media.duration) * 1000);
  timeLabel.textContent = `${fmt(media.time)} / ${fmt(media.duration)}`;
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
slider(sCh, 'Tamaño de celda (px)', 'cell', 6, 40, 1);
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
const sEd = section('Bordes direccionales');
slider(sEd, 'Intensidad (0 = off)', 'edgeStrength', 0, 10, 0.1);
slider(sEd, 'Umbral', 'edgeThreshold', 0, 1.5, 0.01);

// Color
const sCo = section('Color');
slider(sCo, 'Brillo', 'brightness', -0.5, 0.5, 0.01);
slider(sCo, 'Contraste', 'contrast', 0.3, 2.5, 0.01);
slider(sCo, 'Saturación', 'saturation', 0, 3, 0.01);
slider(sCo, 'Gamma', 'gamma', 0.4, 2.5, 0.01);
slider(sCo, 'Intensidad del carácter', 'glyphBoost', 0.5, 2, 0.01);
checkbox(sCo, 'Monocromo', 'mono');
color(sCo, 'Color monocromo', 'monoColor');

// Fondo y efectos
const sFx = section('Fondo y efectos');
color(sFx, 'Color de fondo', 'bgColor');
slider(sFx, 'Imagen tenue en el fondo', 'bgMix', 0, 0.6, 0.01);
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
    params.reveal > 0 || params.flicker > 0 || params.scanSpeed !== 0 || params.scanBar > 0 || params.crtFlash > 0
  );
}
async function exportFrame(): Promise<Blob> {
  engine.render(params, currentAnim()); // y se copia en la misma tarea, antes de que se limpie el búfer
  const out = document.createElement('canvas');
  out.width = OUT_W;
  out.height = OUT_H;
  const c = out.getContext('2d')!;
  c.drawImage(canvas, 0, 0);
  drawTextLayers(c, project.layers, clock, projectDuration());
  return new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
}
function currentAnim(): Anim {
  return { time: clock, progress: params.reveal > 0 ? revealProgress(params, clock) : 1 };
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
  status.textContent = `${label} · ${m.width}×${m.height}` + (m.kind !== 'image' ? ` · ${fmt(m.duration)}` : '');
  redraw();
}

async function loadFile(f: File) {
  try {
    if (f.type.startsWith('video/')) {
      status.textContent = 'Cargando vídeo…';
      setMedia(await VideoMedia.load(f), f.name);
    } else if (f.type === 'image/gif') {
      const gif = await GifMedia.load(f, (i, n) => (status.textContent = `Leyendo GIF… ${i}/${n}`));
      setMedia(gif, `${f.name} · ${gif.frameCount} fotogramas`);
    } else {
      setMedia(new ImageMedia(await createImageBitmap(f)), f.name);
    }
  } catch (e) {
    status.textContent = e instanceof Error ? e.message : 'No se pudo leer ese archivo';
  }
}
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (f && (f.type.startsWith('image/') || f.type.startsWith('video/'))) loadFile(f);
});

let hits: HitRect[] = [];
const hasTimedText = () => project.layers.length > 0;
function drawOverlay() {
  octx.clearRect(0, 0, OUT_W, OUT_H);
  hits = drawTextLayers(octx, project.layers, clock, projectDuration(), project.selected);
}

// Arrastrar textos sobre la vista previa
let drag: { id: string; dx: number; dy: number } | null = null;
const toCanvas = (e: PointerEvent) => {
  const r = overlay.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * OUT_W, y: ((e.clientY - r.top) / r.height) * OUT_H };
};
overlay.addEventListener('pointerdown', (e) => {
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
      .finally(() => (pulling = false));
  }
  const now = performance.now();
  const dt = (now - lastNow) / 1000;
  lastNow = now;
  if (clockPlaying) {
    clock = audio.running ? audio.clockTime : clock + dt;
    if (clock >= projectDuration()) restartAll();
  }
  if (needRender || (clockPlaying && (animActive() || hasTimedText()))) {
    needRender = false;
    engine.render(params, currentAnim());
    drawOverlay();
  }
  audioUI.draw(audio.buffer ? clock : -1);
  updateTimeline();
  updateTransport();
}

setMedia(new ImageMedia(makeDemoImage()), 'Imagen de prueba');
status.textContent = 'Imagen de prueba · arrastra una foto, GIF o vídeo, o usa el selector';
loop();
