export const VERT = `#version 300 es
void main() {
  // Triángulo a pantalla completa sin buffers.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Código común a los shaders que leen la imagen: muestreo "cover", ajustes de color y
// revelado por celdas (compartido por ASCII y pixel art).
const COMMON = `
uniform sampler2D u_src;
uniform vec2  u_res;        // tamaño de salida (px)
uniform vec2  u_srcSize;    // tamaño de la imagen (px)
uniform vec2  u_cell;       // tamaño de celda en salida (px)
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_gamma;
uniform float u_time;       // s
uniform float u_reveal;     // 0 off, 1 aleatorio, 2 escritura, 3 barrido →, 4 barrido ↓, 5 radial, 6 lluvia
uniform float u_progress;   // 0..1 del revelado

const float PI = 3.14159265;

// Imagen "cover" dentro del lienzo de salida. px con origen arriba-izquierda.
vec2 srcUV(vec2 px) {
  float s = max(u_res.x / u_srcSize.x, u_res.y / u_srcSize.y);
  return (px - 0.5 * u_res) / (u_srcSize * s) + 0.5;
}

float lodForCell() {
  float s = max(u_res.x / u_srcSize.x, u_res.y / u_srcSize.y);
  float srcPx = sqrt(u_cell.x * u_cell.y) / s;
  return max(0.0, log2(srcPx));
}

vec3 grade(vec3 c) {
  c = (c - 0.5) * u_contrast + 0.5 + u_brightness;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, u_saturation);
  c = clamp(c, 0.0, 1.0);
  return pow(c, vec3(1.0 / u_gamma));
}

vec3 fetch(vec2 px, float lod) {
  return grade(textureLod(u_src, srcUV(px), lod).rgb);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Estado de revelado de una celda:
//  x = 0 normal | 1 oculta | 2 frente "en construcción" (y = intensidad 0..1)
//      | 3 estela de lluvia (y = brillo, z = 1 si es la cabeza)
vec4 revealFx(vec2 idx, vec2 grid, vec2 uvc) {
  if (u_reveal < 0.5) return vec4(0.0);
  if (u_reveal < 5.5) {
    float thr;
    if (u_reveal < 1.5)      thr = hash(idx);
    else if (u_reveal < 2.5) thr = (idx.y * grid.x + idx.x) / (grid.x * grid.y);
    else if (u_reveal < 3.5) thr = uvc.x;
    else if (u_reveal < 4.5) thr = uvc.y;
    else thr = min(length((uvc - 0.5) * vec2(u_res.x / u_res.y, 1.0)) / 0.62, 1.0);
    float W = 0.08;
    float d = u_progress * (1.0 + W) - thr;
    if (d < 0.0) return vec4(1.0, 0.0, 0.0, 0.0);
    if (d < W)   return vec4(2.0, 1.0 - d / W, 0.0, 0.0);
    return vec4(0.0);
  }
  // Lluvia: cada columna tiene su retardo, velocidad y longitud de estela.
  float delay = hash(vec2(idx.x, 7.7)) * 0.4;
  float spd = 1.0 + 0.4 * hash(vec2(idx.x, 3.3));
  float trail = 8.0 + 16.0 * hash(vec2(idx.x, 1.1));
  float head = (u_progress - delay) / 0.6 * spd * (grid.y + trail);
  float dist = head - idx.y;
  if (dist < 0.0) return vec4(1.0, 0.0, 0.0, 0.0);
  if (dist < trail) return vec4(3.0, 1.0 - dist / trail, dist < 1.5 ? 1.0 : 0.0, 0.0);
  return vec4(0.0);
}

// Sobel de luminosidad a escala de celda, en coordenadas con y hacia abajo.
vec2 sobel(vec2 center, float lod) {
  vec2 o = u_cell;
  float tl = luma(fetch(center + vec2(-o.x, -o.y), lod));
  float t  = luma(fetch(center + vec2( 0.0, -o.y), lod));
  float tr = luma(fetch(center + vec2( o.x, -o.y), lod));
  float l  = luma(fetch(center + vec2(-o.x,  0.0), lod));
  float r  = luma(fetch(center + vec2( o.x,  0.0), lod));
  float bl = luma(fetch(center + vec2(-o.x,  o.y), lod));
  float b  = luma(fetch(center + vec2( 0.0,  o.y), lod));
  float br = luma(fetch(center + vec2( o.x,  o.y), lod));
  return vec2(((tr + 2.0 * r + br) - (tl + 2.0 * l + bl)) * 0.25,
              ((bl + 2.0 * b + br) - (tl + 2.0 * t + tr)) * 0.25);
}
`;

// Pasada 1 (ASCII): cada celda elige un glifo por luminosidad o, si hay borde,
// por la orientación del borde (- \\ | /).
export const FRAG_ASCII = `#version 300 es
precision highp float;
${COMMON}
uniform sampler2D u_atlas;
uniform float u_n;          // nº de glifos en la rampa
uniform float u_edgeStrength;
uniform float u_edgeThreshold;
uniform float u_invert;
uniform float u_mono;
uniform float u_bgMix;
uniform float u_glyphBoost;
uniform float u_flicker;     // prob. de que una celda cambie de carácter
uniform float u_flickerRate; // Hz
uniform vec3  u_monoColor;
uniform vec3  u_bg;

out vec4 outColor;

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 idx = floor(px / u_cell);
  vec2 local = px / u_cell - idx;
  vec2 center = (idx + 0.5) * u_cell;
  float lod = lodForCell();

  vec3 col = fetch(center, lod);
  float lum = luma(col);

  vec2 g = sobel(center, lod);
  float mag = length(g) * u_edgeStrength;

  float total = u_n + 4.0;
  float glyph;
  if (u_edgeStrength > 0.0 && mag > u_edgeThreshold) {
    // El borde es perpendicular al gradiente.
    vec2 d = vec2(-g.y, g.x);
    float a = atan(d.y, d.x);
    if (a < 0.0) a += PI;
    float bin = mod(floor(a / (PI * 0.25) + 0.5), 4.0); // 0:- 1:\\\\ 2:| 3:/
    glyph = u_n + bin;
  } else {
    float v = mix(lum, 1.0 - lum, u_invert);
    glyph = min(floor(v * u_n), u_n - 1.0);
  }

  vec2 grid = ceil(u_res / u_cell);
  vec2 uvc = (idx + 0.5) / grid;
  vec3 gcol0 = u_mono > 0.5 ? u_monoColor * mix(0.55, 1.0, lum) : col * u_glyphBoost;
  vec3 gcol = gcol0;
  float visible = 1.0;

  // Parpadeo: algunas celdas saltan a un carácter vecino de la rampa y vibran de brillo.
  if (u_flicker > 0.0 && glyph < u_n) {
    float tick = floor(u_time * u_flickerRate);
    if (hash(idx + tick * 17.3) < u_flicker) {
      float h2 = hash(idx + tick * 5.1 + 9.0);
      glyph = clamp(glyph + floor(h2 * 5.0) - 2.0, 0.0, u_n - 1.0);
      gcol *= 0.8 + 0.5 * hash(idx + tick * 2.7 + 3.0);
    }
  }

  vec4 rv = revealFx(idx, grid, uvc);
  if (rv.x > 0.5 && rv.x < 1.5) {
    visible = 0.0;
  } else if (rv.x < 2.5 && rv.x > 1.5) {
    glyph = max(1.0, floor(hash(idx + floor(u_time * 30.0)) * u_n));
    gcol = mix(gcol0, vec3(1.0), 0.85 * rv.y);
  } else if (rv.x > 2.5) {
    glyph = max(1.0, floor(hash(idx + floor(u_time * 14.0 + idx.x)) * u_n));
    gcol = rv.z > 0.5 ? vec3(0.85, 1.0, 0.9) : vec3(0.1, 0.95, 0.35) * rv.y * rv.y;
  }

  vec2 auv = vec2((glyph + local.x) / total, local.y);
  float cov = texture(u_atlas, auv).a * visible;

  vec3 bg = u_bg + col * u_bgMix * visible;
  outColor = vec4(mix(bg, gcol, clamp(cov, 0.0, 1.0)), 1.0);
}`;

// Cuadrícula de colores (una celda = un texel), ya con los ajustes de color aplicados.
// La lee la CPU para el tramado por difusión de error.
export const FRAG_GRID = `#version 300 es
precision highp float;
${COMMON}
out vec4 outColor;
void main() {
  vec2 idx = floor(gl_FragCoord.xy); // fila 0 de memoria = fila 0 de la imagen
  outColor = vec4(fetch((idx + 0.5) * u_cell, lodForCell()), 1.0);
}`;

// Pixel art / dithering: píxeles cuadrados, paleta limitada, tramado ordenado (Bayer) en GPU
// o color ya cuantizado por la CPU (difusión de error), contornos opcionales.
export const FRAG_PIXEL = `#version 300 es
precision highp float;
${COMMON}
uniform sampler2D u_quant;
uniform float u_quantMode;   // 1 = leer el color ya cuantizado de u_quant
uniform vec3  u_pal[64];
uniform float u_palN;        // 0 = sin paleta
uniform float u_bayer;       // 0 = sin Bayer; 1..3 = matriz 2×2, 4×4, 8×8
uniform float u_spread;
uniform float u_edgeStrength;
uniform float u_edgeThreshold;
uniform float u_flicker;
uniform float u_flickerRate;
uniform vec3  u_bg;
uniform vec3  u_outline;

out vec4 outColor;

// Matriz de Bayer normalizada (0..1), construida bit a bit.
float bayer(vec2 p, float levels) {
  float v = 0.0;
  for (int i = 0; i < 3; i++) {
    if (float(i) >= levels) break;
    float bx = mod(floor(p.x / exp2(float(i))), 2.0);
    float by = mod(floor(p.y / exp2(float(i))), 2.0);
    v += (2.0 * abs(bx - by) + by) * pow(4.0, levels - 1.0 - float(i));
  }
  return (v + 0.5) / pow(4.0, levels);
}

vec3 nearestPal(vec3 c) {
  float best = 1e9;
  vec3 r = c;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= u_palN) break;
    vec3 d = u_pal[i] - c;
    float dd = dot(d * d, vec3(0.299, 0.587, 0.114));
    if (dd < best) { best = dd; r = u_pal[i]; }
  }
  return r;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 idx = floor(px / u_cell);
  vec2 center = (idx + 0.5) * u_cell;
  vec2 grid = ceil(u_res / u_cell);
  vec2 uvc = (idx + 0.5) / grid;
  float lod = lodForCell();

  // Parpadeo: algunas celdas vibran de brillo (y, con paleta, saltan a un color vecino).
  float jit = 1.0;
  if (u_flicker > 0.0) {
    float tick = floor(u_time * u_flickerRate);
    if (hash(idx + tick * 17.3) < u_flicker) jit = 0.8 + 0.5 * hash(idx + tick * 2.7 + 3.0);
  }

  vec3 col;
  if (u_quantMode > 0.5) {
    col = clamp(texelFetch(u_quant, ivec2(idx), 0).rgb * jit, 0.0, 1.0);
  } else {
    col = fetch(center, lod) * jit;
    if (u_palN > 0.5) {
      if (u_bayer > 0.5) col += (bayer(idx, u_bayer) - 0.5) * u_spread;
      col = nearestPal(clamp(col, 0.0, 1.0));
    }
  }

  if (u_edgeStrength > 0.0) {
    if (length(sobel(center, lod)) * u_edgeStrength > u_edgeThreshold) col = u_outline;
  }

  vec4 rv = revealFx(idx, grid, uvc);
  if (rv.x > 0.5 && rv.x < 1.5) col = u_bg;
  else if (rv.x > 1.5 && rv.x < 2.5) col = mix(col, vec3(1.0), 0.85 * rv.y);
  else if (rv.x > 2.5) col = rv.z > 0.5 ? vec3(0.85, 1.0, 0.9) : vec3(0.1, 0.95, 0.35) * rv.y * rv.y;

  outColor = vec4(col, 1.0);
}`;

// Pasada 2: bloom (mipmaps desenfocados) + scanlines.
export const FRAG_POST = `#version 300 es
precision highp float;

uniform sampler2D u_tex;
uniform vec2  u_res;
uniform float u_bloom;
uniform float u_scan;
uniform float u_scanPeriod;
uniform float u_time;
uniform float u_scanSpeed; // px/s de desplazamiento de las scanlines
uniform float u_bar;       // intensidad de la barra de brillo que barre la pantalla
uniform float u_flash;     // destellos / parpadeo CRT

out vec4 outColor;

float h1(float x) { return fract(sin(x * 91.3458) * 47453.5453); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 base = textureLod(u_tex, uv, 0.0).rgb;
  vec3 glow = textureLod(u_tex, uv, 3.0).rgb * 0.40
            + textureLod(u_tex, uv, 4.0).rgb * 0.35
            + textureLod(u_tex, uv, 5.0).rgb * 0.25;
  vec3 c = base + glow * u_bloom;

  float line = 0.5 + 0.5 * cos(6.2831853 * (gl_FragCoord.y + u_time * u_scanSpeed) / u_scanPeriod);
  c *= 1.0 - u_scan * (1.0 - line);

  // Barra que baja por la pantalla
  float yy = 1.0 - uv.y;
  float d = fract(yy - fract(u_time * 0.18) + 0.5) - 0.5;
  c *= 1.0 + u_bar * 1.6 * exp(-pow(d / 0.07, 2.0));

  // Destellos CRT: vibración rápida + latido lento + chispazos ocasionales
  float tick = floor(u_time * 24.0);
  float spark = step(0.93, h1(floor(u_time * 6.0))) * (0.5 + 0.5 * h1(tick));
  c *= 1.0 + u_flash * ((h1(tick) - 0.5) * 0.25 + 0.06 * sin(u_time * 7.0) + 0.6 * spark);

  outColor = vec4(c, 1.0);
}`;

// Suavizado temporal: media exponencial entre el fotograma nuevo y el acumulado.
export const FRAG_BLEND = `#version 300 es
precision highp float;

uniform sampler2D u_new;
uniform sampler2D u_prev;
uniform vec2  u_size;
uniform float u_k;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec3 n = textureLod(u_new, uv, 0.0).rgb;
  vec3 p = textureLod(u_prev, uv, 0.0).rgb;
  outColor = vec4(mix(n, p, u_k), 1.0);
}`;
