// Ayudantes genéricos para construir controles enlazados a un objeto.

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

export function slider(
  parent: HTMLElement, label: string, obj: Obj, key: string,
  min: number, max: number, step: number, onChange: () => void, def?: number,
) {
  const val = el('span', { className: 'val' });
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(obj[key]) });
  const upd = () => (val.textContent = Number(input.value).toFixed(step < 1 ? (step < 0.01 ? 3 : 2) : 0));
  upd();
  input.addEventListener('input', () => {
    obj[key] = Number(input.value);
    upd();
    onChange();
  });
  if (def !== undefined) {
    input.addEventListener('dblclick', () => {
      input.value = String(def);
      input.dispatchEvent(new Event('input'));
    });
  }
  parent.appendChild(el('label', { className: 'row' }, el('span', { textContent: label }), val, input));
  return input;
}

export function checkbox(parent: HTMLElement, label: string, obj: Obj, key: string, onChange: () => void) {
  const input = el('input', { type: 'checkbox', checked: !!obj[key] });
  input.addEventListener('change', () => {
    obj[key] = input.checked;
    onChange();
  });
  parent.appendChild(el('label', { className: 'check' }, input, ' ' + label));
  return input;
}

export function color(parent: HTMLElement, label: string, obj: Obj, key: string, onChange: () => void) {
  const input = el('input', { type: 'color', value: obj[key] });
  input.addEventListener('input', () => {
    obj[key] = input.value;
    onChange();
  });
  parent.appendChild(el('label', { className: 'check' }, input, ' ' + label));
  return input;
}

export function select(
  parent: HTMLElement, obj: Obj, key: string, options: [string, string][], onChange: () => void,
) {
  const s = el('select');
  for (const [v, l] of options) s.add(new Option(l, v));
  s.value = String(obj[key]);
  s.addEventListener('change', () => {
    obj[key] = s.value;
    onChange();
  });
  parent.appendChild(s);
  return s;
}

export function button(parent: HTMLElement, label: string, onClick: () => void) {
  const b = el('button', { textContent: label });
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

export function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
}
