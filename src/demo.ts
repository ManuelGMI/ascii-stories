// Lienzo inicial: gris claro liso (9:16), para empezar sin ninguna imagen cargada.
export function makeBlankCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1920;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e3e4e8';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}
