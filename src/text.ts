// Capas de texto limpio por encima del ASCII. Todo es función pura del tiempo,
// para poder usarlo igual en la vista previa y en la exportación.

export type EntryAnim = 'none' | 'fade' | 'slideUp' | 'slideDown' | 'slideLeft' | 'pop' | 'typewriter';

export const ENTRY_ANIMS: [EntryAnim, string][] = [
  ['none', 'Sin animación'],
  ['fade', 'Fundido'],
  ['slideUp', 'Sube'],
  ['slideDown', 'Baja'],
  ['slideLeft', 'Entra desde la derecha'],
  ['pop', 'Pop (rebote)'],
  ['typewriter', 'Máquina de escribir'],
];

export interface TextLayer {
  id: string;
  text: string;
  family: string;
  size: number; // px a 1080 de ancho
  bold: boolean;
  italic: boolean;
  letterSpacing: number; // px
  color: string;
  align: 'left' | 'center' | 'right';
  maxWidth: number; // fracción del ancho (ajuste de línea)
  x: number; // centro del bloque, 0..1
  y: number;
  bg: boolean;
  bgColor: string;
  bgOpacity: number;
  padding: number;
  radius: number;
  shadow: boolean;
  tIn: number; // s
  tOut: number; // s
  untilEnd: boolean;
  animIn: EntryAnim;
  animDur: number; // s
  exitFade: number; // s
}

export const FONTS: string[] = [
  'Helvetica Neue', 'Avenir Next', 'Futura', 'Georgia', 'Didot', 'Impact',
  'American Typewriter', 'Marker Felt', 'Menlo',
];

let counter = 0;
export function newLayer(over: Partial<TextLayer> = {}): TextLayer {
  counter++;
  return {
    id: `t${counter}`,
    text: 'Tu texto aquí',
    family: 'Helvetica Neue',
    size: 96,
    bold: true,
    italic: false,
    letterSpacing: 0,
    color: '#ffffff',
    align: 'center',
    maxWidth: 0.85,
    x: 0.5,
    y: 0.5,
    bg: false,
    bgColor: '#000000',
    bgOpacity: 0.6,
    padding: 28,
    radius: 18,
    shadow: true,
    tIn: 0.5,
    tOut: 5,
    untilEnd: true,
    animIn: 'fade',
    animDur: 0.6,
    exitFade: 0.3,
    ...over,
  };
}

export interface HitRect { id: string; x: number; y: number; w: number; h: number }

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
const easeOutBack = (u: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
};

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxW) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Dibuja las capas visibles en el instante t. Devuelve las cajas (en px del lienzo)
 * para poder seleccionarlas con el ratón. `selectedId` solo se usa en la vista previa.
 */
export function drawTextLayers(
  ctx: CanvasRenderingContext2D,
  layers: TextLayer[],
  t: number,
  duration: number,
  selectedId?: string,
  pulse = 1, // escala extra por el pulso al ritmo
): HitRect[] {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const hits: HitRect[] = [];

  for (const L of layers) {
    const tOut = L.untilEnd ? duration : L.tOut;
    if (t < L.tIn || t > tOut || !L.text) continue;

    ctx.save();
    ctx.font = `${L.italic ? 'italic ' : ''}${L.bold ? 'bold ' : ''}${L.size}px "${L.family}", sans-serif`;
    ctx.letterSpacing = `${L.letterSpacing}px`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const lines = wrap(ctx, L.text, L.maxWidth * W);
    const lh = L.size * 1.2;
    const widths = lines.map((l) => ctx.measureText(l).width);
    const bw = Math.max(...widths, 1);
    const bh = lines.length * lh;
    const cx = L.x * W;
    const cy = L.y * H;
    const pad = L.bg ? L.padding : 0;
    hits.push({ id: L.id, x: cx - bw / 2 - pad, y: cy - bh / 2 - pad, w: bw + 2 * pad, h: bh + 2 * pad });

    // Entrada y salida
    const u = L.animIn === 'none' ? 1 : clamp01((t - L.tIn) / Math.max(L.animDur, 0.01));
    const outA = L.exitFade > 0 ? clamp01((tOut - t) / L.exitFade) : 1;
    let alpha = outA;
    let offX = 0, offY = 0, scale = 1;
    let chars = Infinity;
    switch (L.animIn) {
      case 'fade': alpha *= easeOut(u); break;
      case 'slideUp': alpha *= easeOut(u); offY = (1 - easeOut(u)) * 90; break;
      case 'slideDown': alpha *= easeOut(u); offY = -(1 - easeOut(u)) * 90; break;
      case 'slideLeft': alpha *= easeOut(u); offX = (1 - easeOut(u)) * 160; break;
      case 'pop': alpha *= clamp01(u * 3); scale = 0.5 + 0.5 * easeOutBack(u); break;
      case 'typewriter': chars = Math.floor(u * lines.reduce((s, l) => s + l.length, 0)); break;
    }

    ctx.globalAlpha = alpha;
    ctx.translate(cx + offX, cy + offY);
    ctx.scale(scale * pulse, scale * pulse);

    if (L.bg) {
      ctx.save();
      ctx.globalAlpha = alpha * L.bgOpacity;
      ctx.fillStyle = L.bgColor;
      ctx.beginPath();
      ctx.roundRect(-bw / 2 - pad, -bh / 2 - pad, bw + 2 * pad, bh + 2 * pad, L.radius);
      ctx.fill();
      ctx.restore();
    }

    if (L.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = L.size * 0.18;
      ctx.shadowOffsetY = L.size * 0.04;
    }
    ctx.fillStyle = L.color;
    let remaining = chars;
    lines.forEach((line, i) => {
      if (remaining <= 0) return;
      const x = L.align === 'left' ? -bw / 2 : L.align === 'right' ? bw / 2 - widths[i] : -widths[i] / 2;
      ctx.fillText(line.slice(0, remaining), x, -bh / 2 + lh * (i + 0.5));
      remaining -= line.length;
    });
    ctx.restore();
  }

  if (selectedId) {
    const h = hits.find((r) => r.id === selectedId);
    if (h) {
      ctx.save();
      ctx.strokeStyle = '#4da3ff';
      ctx.lineWidth = 3;
      ctx.setLineDash([14, 10]);
      ctx.strokeRect(h.x - 8, h.y - 8, h.w + 16, h.h + 16);
      ctx.restore();
    }
  }
  return hits;
}
