// Paletas para pixel art y dithering.

export const PALETTES: Record<string, string[]> = {
  'Game Boy': ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  'Game Boy Pocket': ['#1f1f1f', '#4d533c', '#8b956d', '#c4cfa1'],
  'PICO-8': [
    '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
    '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
  ],
  NES: [
    '#7c7c7c', '#0000fc', '#0000bc', '#4428bc', '#940084', '#a80020', '#a81000', '#881400',
    '#503000', '#007800', '#006800', '#005800', '#004058', '#000000',
    '#bcbcbc', '#0078f8', '#0058f8', '#6844fc', '#d800cc', '#e40058', '#f83800', '#e45c10',
    '#ac7c00', '#00b800', '#00a800', '#00a844', '#008888',
    '#f8f8f8', '#3cbcfc', '#6888fc', '#9878f8', '#f878f8', '#f85898', '#f87858', '#fca044',
    '#f8b800', '#b8f818', '#58d854', '#58f898', '#00e8d8', '#787878',
    '#fcfcfc', '#a4e4fc', '#b8b8f8', '#d8b8f8', '#f8b8f8', '#f8a4c0', '#f0d0b0', '#fce0a8',
    '#f8d878', '#d8f878', '#b8f8b8', '#b8f8d8', '#00fcfc', '#f8d8f8',
  ],
  'Commodore 64': [
    '#000000', '#ffffff', '#68372b', '#70a4b2', '#6f3d86', '#588d43', '#352879', '#b8c76f',
    '#6f4f25', '#433900', '#9a6759', '#444444', '#6c6c6c', '#9ad284', '#6c5eb5', '#959595',
  ],
  'Sweetie 16': [
    '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
    '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
  ],
  CGA: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
  Sepia: ['#1a1008', '#4a3220', '#8a6a45', '#c9a875', '#f2e3c0'],
  'Blanco y negro': ['#000000', '#ffffff'],
};

export const NO_PALETTE = 'Sin paleta (color real)';
export const CUSTOM_PALETTE = 'Personalizada';
export const MAX_COLORS = 64;

/** Colores 0..255 de la paleta elegida. Vacío = sin paleta. */
export function resolvePalette(name: string, custom: string): number[][] {
  let hexes: string[];
  if (name === NO_PALETTE) return [];
  if (name === CUSTOM_PALETTE) {
    hexes = (custom.match(/#?[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? []).map((h) => {
      h = h.replace('#', '');
      return '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h);
    });
  } else {
    hexes = PALETTES[name] ?? [];
  }
  return hexes.slice(0, MAX_COLORS).map((h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
}

const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Color más oscuro (para los contornos). */
export function darkest(pal: number[][]): number[] {
  return pal.length ? pal.reduce((a, b) => (lum(b) < lum(a) ? b : a)) : [0, 0, 0];
}

/**
 * Amplitud adecuada del tramado ordenado: la separación media de luminosidad entre colores
 * (2 colores → 1.0; 4 → ~0.33; 16 → ~0.07), de modo que el patrón cubra un escalón de paleta.
 */
export function bayerSpread(pal: number[][]): number {
  if (pal.length < 2) return 0;
  const ls = pal.map(lum).sort((a, b) => a - b);
  return Math.min(1, Math.max(0.05, (ls[ls.length - 1] - ls[0]) / 255 / (ls.length - 1)));
}
