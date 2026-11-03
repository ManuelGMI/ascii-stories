import './style.css';
import { CHARSETS } from './atlas';
import { makeDemoImage } from './demo';
import { DEFAULTS, Engine, revealProgress, type Anim, type Params } from './engine';
import { GifMedia, ImageMedia, VideoMedia, type Media } from './media';

const canvas = document.getElementById('preview') as HTMLCanvasElement;
const panel = document.getElementById('controls') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;

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
btnPlay.addEventListener('click', () => {
  if (!media) return;
  media.playing ? media.pause() : media.play();
  redraw();
});
btnPrev.addEventListener('click', () => media?.step(-1, fps));
btnNext.addEventListener('click', () => media?.step(1, fps));
timeline.addEventListener('pointerdown', () => (scrubbing = true));
timeline.addEventListener('pointerup', () => (scrubbing = false));
timeline.addEventListener('input', () => media?.seek((Number(timeline.value) / 1000) * media.duration));

function fmt(t: number) {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
}
function updateTransport() {
  const animated = !!media && media.kind !== 'image';
  transport.hidden = !animated;
  sTr.hidden = !animated;
  if (!media || !animated) return;
  btnPlay.textContent = media.playing ? '❚❚ Pausa' : '▶︎ Reproducir';
  if (!scrubbing) timeline.value = String((media.time / media.duration) * 1000);
  timeLabel.textContent = `${fmt(media.time)} / ${fmt(media.duration)}`;
}
sTr.hidden = true;

const btnPng = document.createElement('button');
btnPng.textContent = 'Exportar PNG 1080×1920';
btnPng.addEventListener('click', async () => {
  const blob = await engine.exportPNG(params, currentAnim());
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
const clockRow = document.createElement('div');
clockRow.className = 'two';
const btnClock = Object.assign(document.createElement('button'), { textContent: '❚❚ Pausar animación' });
const btnRestart = Object.assign(document.createElement('button'), { textContent: '↺ Reiniciar' });
clockRow.append(btnClock, btnRestart);
sAn.appendChild(clockRow);

// Reloj de animación (independiente del vídeo): lo usan revelado, parpadeo y efectos CRT.
let clock = 0;
let clockPlaying = true;
let lastNow = performance.now();
function restartClock() {
  clock = 0;
  redraw();
}
btnRestart.addEventListener('click', restartClock);
btnClock.addEventListener('click', () => {
  clockPlaying = !clockPlaying;
  btnClock.textContent = clockPlaying ? '❚❚ Pausar animación' : '▶︎ Reanudar animación';
});
function animActive() {
  return (
    params.reveal > 0 || params.flicker > 0 || params.scanSpeed !== 0 || params.scanBar > 0 || params.crtFlash > 0
  );
}
function currentAnim(): Anim {
  return { time: clock, progress: params.reveal > 0 ? revealProgress(params, clock) : 1 };
}

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
  if (clockPlaying) clock += (now - lastNow) / 1000;
  lastNow = now;
  if (needRender || (clockPlaying && animActive())) {
    needRender = false;
    engine.render(params, currentAnim());
  }
  updateTransport();
}

setMedia(new ImageMedia(makeDemoImage()), 'Imagen de prueba');
status.textContent = 'Imagen de prueba · arrastra una foto, GIF o vídeo, o usa el selector';
loop();
