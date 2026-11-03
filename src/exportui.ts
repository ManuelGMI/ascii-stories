import { exportGif, exportMp4, type ExportInput } from './exporter';
import { checkbox, el } from './ui';

export interface ExportHooks {
  /** Prepara el estado (pausa, guarda posición) y devuelve la función que lo restaura. */
  begin(): () => void;
  input(): ExportInput;
}

/** Sección "Exportar": MP4 (H.264 + AAC) para Instagram y GIF, con barra de progreso y cancelación. */
export function buildExportUI(parent: HTMLElement, hooks: ExportHooks) {
  const state = { format: 'mp4', dither: true };

  const fmt = el('select');
  fmt.add(new Option('MP4 (H.264 + AAC) · Instagram', 'mp4'));
  fmt.add(new Option('GIF · sin audio', 'gif'));

  // Opciones MP4
  const mp4Box = el('div');
  const fps = el('select');
  fps.add(new Option('30 fps (lo que usa Instagram)', '30'));
  fps.add(new Option('60 fps (más fluido en el Mac)', '60'));
  const qual = el('select');
  qual.add(new Option('Calidad alta · 12 Mbps', '12000000'));
  qual.add(new Option('Calidad media · 8 Mbps', '8000000'));
  qual.add(new Option('Calidad baja · 5 Mbps', '5000000'));
  mp4Box.append(fps, qual, el('p', { className: 'hint', textContent: '1080×1920 · la duración es la de la línea de tiempo.' }));

  // Opciones GIF
  const gifBox = el('div');
  const gw = el('select');
  [['360', '360×640 (ligero)'], ['480', '480×853'], ['540', '540×960'], ['720', '720×1280 (pesado)']]
    .forEach(([v, l]) => gw.add(new Option(l, v)));
  gw.value = '540';
  const gfps = el('select');
  [['10', '10 fps'], ['8', '12,5 fps'], ['5', '20 fps'], ['4', '25 fps']]
    .forEach(([v, l]) => gfps.add(new Option(l, v))); // valor = retardo en centésimas
  gfps.value = '8';
  gifBox.append(gw, gfps);
  checkbox(gifBox, 'Dithering (Floyd–Steinberg)', state, 'dither', () => {});
  gifBox.append(el('p', { className: 'hint', textContent: '256 colores por fotograma con paleta optimizada. El ASCII monocromo es el que mejor queda.' }));
  gifBox.hidden = true;

  fmt.addEventListener('change', () => {
    state.format = fmt.value;
    mp4Box.hidden = fmt.value !== 'mp4';
    gifBox.hidden = fmt.value !== 'gif';
  });

  const go = el('button', { textContent: 'Exportar', className: 'primary' });
  const msg = el('p', { className: 'hint' });
  const result = el('div', { className: 'two' });
  result.hidden = true;
  const btnSave = el('button', { textContent: '⬇︎ Descargar' });
  const btnShare = el('button', { textContent: '↗︎ Compartir / Guardar' });
  result.append(btnSave, btnShare);
  parent.append(fmt, mp4Box, gifBox, go, msg, result);

  // En el móvil, la hoja de compartir permite guardar en Fotos o abrir Instagram directamente.
  const isTouch = matchMedia('(pointer: coarse)').matches;
  let last: { blob: Blob; name: string } | null = null;
  const download = () => {
    if (!last) return;
    const a = el('a', { href: URL.createObjectURL(last.blob), download: last.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  btnSave.addEventListener('click', download);
  btnShare.addEventListener('click', async () => {
    if (!last) return;
    const file = new File([last.blob], last.name, { type: last.blob.type });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
      else download();
    } catch { /* el usuario cerró la hoja */ }
  });

  // Capa de progreso que bloquea el panel mientras se exporta
  const overlay = el('div', { className: 'export-overlay' });
  const title = el('h2', { textContent: 'Exportando…' });
  const bar = el('progress', { max: 1, value: 0 });
  const label = el('p', { className: 'hint' });
  const cancel = el('button', { textContent: 'Cancelar' });
  overlay.append(title, bar, label, cancel);
  overlay.hidden = true;
  document.body.appendChild(overlay);

  let controller: AbortController | null = null;
  cancel.addEventListener('click', () => controller?.abort());

  go.addEventListener('click', async () => {
    if (controller) return;
    controller = new AbortController();
    msg.textContent = '';
    result.hidden = true;
    bar.value = 0;
    label.textContent = 'Preparando…';
    overlay.hidden = false;
    const restore = hooks.begin();
    const t0 = performance.now();
    const progress = (i: number, n: number) => {
      bar.value = i / n;
      const secs = (performance.now() - t0) / 1000;
      label.textContent = `Fotograma ${i}/${n} · quedan ~${Math.max(0, Math.round((secs / i) * (n - i)))} s`;
    };
    try {
      const cx = hooks.input();
      const blob = state.format === 'mp4'
        ? await exportMp4(cx, { fps: Number(fps.value), bitrate: Number(qual.value) }, progress, controller.signal)
        : await exportGif(cx, { width: Number(gw.value), delayCs: Number(gfps.value), dither: state.dither }, progress, controller.signal);
      last = { blob, name: `ascii-story.${state.format}` };
      result.hidden = false;
      btnShare.hidden = !navigator.canShare;
      if (!isTouch) download();
      msg.textContent = `Listo · ${(blob.size / 1e6).toFixed(1)} MB`;
    } catch (e) {
      msg.textContent = e instanceof DOMException && e.name === 'AbortError'
        ? 'Exportación cancelada'
        : `Error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      restore();
      overlay.hidden = true;
      controller = null;
    }
  });
}
