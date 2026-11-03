// Atlas de glifos: una fila de celdas con los caracteres ordenados por densidad
// (rampa de luminosidad) seguidos de 4 caracteres de borde: - \ | /

export const GLYPH_W = 48;
export const GLYPH_H = 96;
export const EDGE_CHARS = ['-', '\\', '|', '/'];

export const CHARSETS: Record<string, string> = {
  Clásico: ' .:-=+*#%@',
  Referencia: ' .-=os#%',
  Detallado: ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  Bloques: ' ░▒▓█',
  Símbolos: ' .,:;+*o#@',
  Binario: ' 01',
  Puntos: ' ·•●',
};

export interface Atlas {
  canvas: HTMLCanvasElement;
  rampCount: number;
  chars: string[];
}

const FONT = `bold 80px Menlo, "SF Mono", "DejaVu Sans Mono", monospace`;

function drawGlyph(ctx: CanvasRenderingContext2D, ch: string, x: number) {
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = FONT;
  ctx.fillText(ch, x + GLYPH_W / 2, GLYPH_H / 2 + 4);
}

// Cobertura media de cada carácter (0..1), para ordenar la rampa por densidad real.
function measureDensity(chars: string[]): number[] {
  const c = document.createElement('canvas');
  c.width = GLYPH_W;
  c.height = GLYPH_H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return chars.map((ch) => {
    ctx.clearRect(0, 0, GLYPH_W, GLYPH_H);
    drawGlyph(ctx, ch, 0);
    const d = ctx.getImageData(0, 0, GLYPH_W, GLYPH_H).data;
    let sum = 0;
    for (let i = 3; i < d.length; i += 4) sum += d[i];
    return sum / (255 * GLYPH_W * GLYPH_H);
  });
}

export function buildAtlas(charset: string): Atlas {
  const unique = Array.from(new Set(Array.from(charset))).slice(0, 200);
  if (!unique.includes(' ')) unique.unshift(' ');
  if (unique.length < 2) unique.push('#');
  const density = measureDensity(unique);
  const chars = unique
    .map((ch, i) => ({ ch, d: density[i] }))
    .sort((a, b) => a.d - b.d)
    .map((o) => o.ch);

  const all = [...chars, ...EDGE_CHARS];
  const canvas = document.createElement('canvas');
  canvas.width = all.length * GLYPH_W;
  canvas.height = GLYPH_H;
  const ctx = canvas.getContext('2d')!;
  all.forEach((ch, i) => drawGlyph(ctx, ch, i * GLYPH_W));
  return { canvas, rampCount: chars.length, chars };
}
