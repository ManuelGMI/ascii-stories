import './style.css';
import { CHARSETS } from './atlas';
import { makeDemoImage } from './demo';
import { DEFAULTS, Engine, type Params } from './engine';

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
let queued = false;
function redraw() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    engine.render(params);
  });
}

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

function checkbox(s: HTMLElement, label: string, key: 'invert' | 'mono') {
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
file.accept = 'image/png,image/jpeg,image/webp';
file.addEventListener('change', () => file.files?.[0] && loadFile(file.files[0]));
sImg.appendChild(file);
const btnPng = document.createElement('button');
btnPng.textContent = 'Exportar PNG 1080×1920';
btnPng.addEventListener('click', async () => {
  const blob = await engine.exportPNG(params);
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

const btnReset = document.createElement('button');
btnReset.textContent = 'Restablecer';
btnReset.addEventListener('click', () => location.reload());
panel.appendChild(btnReset);

// ---------- Carga de imágenes ----------
async function loadFile(f: File) {
  try {
    const bmp = await createImageBitmap(f);
    engine.setImage(bmp);
    status.textContent = `${f.name} · ${bmp.width}×${bmp.height}`;
    redraw();
  } catch {
    status.textContent = 'No se pudo leer esa imagen';
  }
}
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (f && f.type.startsWith('image/')) loadFile(f);
});

engine.setImage(makeDemoImage());
status.textContent = 'Imagen de prueba · arrastra una foto o usa el selector';
redraw();
