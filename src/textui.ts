import { ENTRY_ANIMS, FONTS, newLayer, type TextLayer } from './text';
import { button, checkbox, color, el, fileButton, select, slider } from './ui';

export interface Project {
  layers: TextLayer[];
  selected: string;
}

export interface TextUI {
  /** Reconstruye lista y editor (tras cambios hechos fuera, p. ej. arrastrar). */
  refresh(): void;
}

export function buildTextUI(
  parent: HTMLElement, project: Project, getDuration: () => number, onChange: () => void,
): TextUI {
  const list = el('select');
  const rowBtns = el('div', { className: 'two' });
  const editor = el('div', { className: 'editor' });
  parent.append(list, rowBtns);

  const current = () => project.layers.find((l) => l.id === project.selected);
  const label = (l: TextLayer) => (l.text.replace(/\s+/g, ' ').slice(0, 26) || '(vacío)');

  function rebuildList() {
    list.replaceChildren();
    project.layers.forEach((l, i) => list.add(new Option(`${i + 1}. ${label(l)}`, l.id)));
    list.value = project.selected;
  }
  list.addEventListener('change', () => {
    project.selected = list.value;
    rebuildEditor();
    onChange();
  });

  button(rowBtns, '＋ Añadir', () => {
    const l = newLayer({ y: 0.5 + 0.08 * (project.layers.length % 5) });
    project.layers.push(l);
    project.selected = l.id;
    refresh();
    onChange();
  });
  button(rowBtns, '⧉ Duplicar', () => {
    const c = current();
    if (!c) return;
    const l = newLayer({ ...c, y: Math.min(c.y + 0.06, 0.95) });
    project.layers.push(l);
    project.selected = l.id;
    refresh();
    onChange();
  });
  const btnDel = button(parent, 'Eliminar capa', () => {
    project.layers = project.layers.filter((l) => l.id !== project.selected);
    project.selected = project.layers.at(-1)?.id ?? '';
    refresh();
    onChange();
  });
  parent.append(editor); // el editor va tras los botones

  function rebuildEditor() {
    editor.replaceChildren();
    btnDel.disabled = project.layers.length === 0;
    const L = current();
    if (!L) {
      editor.append(el('p', { className: 'hint', textContent: 'No hay textos. Pulsa “Añadir”.' }));
      return;
    }
    const changed = () => {
      rebuildList();
      onChange();
    };
    const dur = getDuration();

    const ta = el('textarea', { className: 'text', value: L.text, rows: 3 });
    ta.addEventListener('input', () => {
      L.text = ta.value;
      changed();
    });
    editor.append(ta);

    const fam = select(editor, L as never, 'family', [...new Set([...FONTS, L.family])].map((f) => [f, f]), onChange);
    const fontFile = el('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2' });
    fontFile.addEventListener('change', async () => {
      const f = fontFile.files?.[0];
      if (!f) return;
      const name = f.name.replace(/\.[^.]+$/, '');
      const face = new FontFace(name, await f.arrayBuffer());
      document.fonts.add(await face.load());
      if (!FONTS.includes(name)) FONTS.push(name);
      L.family = name;
      rebuildEditor();
      onChange();
    });
    fileButton(editor, 'Cargar tipografía propia (.ttf, .otf, .woff2)…', fontFile);
    void fam;

    slider(editor, 'Tamaño (px)', L, 'size', 24, 320, 1, onChange, 96);
    slider(editor, 'Espaciado entre letras', L, 'letterSpacing', -6, 40, 0.5, onChange, 0);
    slider(editor, 'Ancho máximo del bloque', L, 'maxWidth', 0.2, 1, 0.01, onChange, 0.85);
    const style = el('div', { className: 'two' });
    checkbox(style, 'Negrita', L, 'bold', onChange);
    checkbox(style, 'Cursiva', L, 'italic', onChange);
    editor.append(style);
    select(editor, L as never, 'align', [['left', 'Alinear a la izquierda'], ['center', 'Centrado'], ['right', 'Alinear a la derecha']], onChange);
    color(editor, 'Color del texto', L, 'color', onChange);
    checkbox(editor, 'Sombra suave', L, 'shadow', onChange);

    slider(editor, 'Posición horizontal', L, 'x', 0, 1, 0.005, onChange, 0.5);
    slider(editor, 'Posición vertical', L, 'y', 0, 1, 0.005, onChange, 0.5);
    editor.append(el('p', { className: 'hint', textContent: 'También puedes arrastrar el texto sobre la vista previa.' }));

    checkbox(editor, 'Caja de fondo', L, 'bg', () => { rebuildEditor(); onChange(); });
    if (L.bg) {
      color(editor, 'Color de la caja', L, 'bgColor', onChange);
      slider(editor, 'Opacidad de la caja', L, 'bgOpacity', 0, 1, 0.01, onChange, 0.6);
      slider(editor, 'Margen interior', L, 'padding', 0, 120, 1, onChange, 28);
      slider(editor, 'Esquinas redondeadas', L, 'radius', 0, 80, 1, onChange, 18);
    }

    editor.append(el('h2', { textContent: 'Tiempos' }));
    slider(editor, 'Aparece en (s)', L, 'tIn', 0, dur, 0.05, onChange, 0.5);
    checkbox(editor, 'Hasta el final', L, 'untilEnd', () => { rebuildEditor(); onChange(); });
    if (!L.untilEnd) slider(editor, 'Desaparece en (s)', L, 'tOut', 0, dur, 0.05, onChange, 5);
    select(editor, L as never, 'animIn', ENTRY_ANIMS, onChange);
    slider(editor, 'Duración de la entrada (s)', L, 'animDur', 0.05, 3, 0.05, onChange, 0.6);
    slider(editor, 'Duración del fundido de salida (s)', L, 'exitFade', 0, 2, 0.05, onChange, 0.3);
  }

  function refresh() {
    rebuildList();
    rebuildEditor();
  }
  refresh();
  return { refresh };
}
