export const VERT = `#version 300 es
void main() {
  // Triángulo a pantalla completa sin buffers.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Pasada 1: conversión a ASCII. Cada celda elige un glifo por luminosidad o,
// si hay borde, por la orientación del borde (- \\ | /).
export const FRAG_ASCII = `#version 300 es
precision highp float;

uniform sampler2D u_src;
uniform sampler2D u_atlas;
uniform vec2  u_res;        // tamaño de salida (px)
uniform vec2  u_srcSize;    // tamaño de la imagen (px)
uniform vec2  u_cell;       // tamaño de celda en salida (px)
uniform float u_n;          // nº de glifos en la rampa
uniform float u_edgeStrength;
uniform float u_edgeThreshold;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_gamma;
uniform float u_invert;
uniform float u_mono;
uniform float u_bgMix;
uniform float u_glyphBoost;
uniform vec3  u_monoColor;
uniform vec3  u_bg;

out vec4 outColor;

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

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 idx = floor(px / u_cell);
  vec2 local = px / u_cell - idx;
  vec2 center = (idx + 0.5) * u_cell;
  float lod = lodForCell();

  vec3 col = fetch(center, lod);
  float lum = luma(col);

  // Sobel a escala de celda.
  vec2 o = u_cell;
  float tl = luma(fetch(center + vec2(-o.x, -o.y), lod));
  float t  = luma(fetch(center + vec2( 0.0, -o.y), lod));
  float tr = luma(fetch(center + vec2( o.x, -o.y), lod));
  float l  = luma(fetch(center + vec2(-o.x,  0.0), lod));
  float r  = luma(fetch(center + vec2( o.x,  0.0), lod));
  float bl = luma(fetch(center + vec2(-o.x,  o.y), lod));
  float b  = luma(fetch(center + vec2( 0.0,  o.y), lod));
  float br = luma(fetch(center + vec2( o.x,  o.y), lod));
  float gx = ((tr + 2.0 * r + br) - (tl + 2.0 * l + bl)) * 0.25;
  float gy = ((bl + 2.0 * b + br) - (tl + 2.0 * t + tr)) * 0.25;
  float mag = length(vec2(gx, gy)) * u_edgeStrength;

  float total = u_n + 4.0;
  float glyph;
  if (u_edgeStrength > 0.0 && mag > u_edgeThreshold) {
    // El borde es perpendicular al gradiente. Coordenadas con y hacia abajo.
    vec2 d = vec2(-gy, gx);
    float a = atan(d.y, d.x);
    if (a < 0.0) a += PI;
    float bin = mod(floor(a / (PI * 0.25) + 0.5), 4.0); // 0:- 1:\\ 2:| 3:/
    glyph = u_n + bin;
  } else {
    float v = mix(lum, 1.0 - lum, u_invert);
    glyph = min(floor(v * u_n), u_n - 1.0);
  }

  vec2 auv = vec2((glyph + local.x) / total, local.y);
  float cov = texture(u_atlas, auv).a;

  vec3 gcol = u_mono > 0.5 ? u_monoColor * mix(0.55, 1.0, lum) : col * u_glyphBoost;
  vec3 bg = u_bg + col * u_bgMix;
  outColor = vec4(mix(bg, gcol, clamp(cov, 0.0, 1.0)), 1.0);
}`;

// Pasada 2: bloom (mipmaps desenfocados) + scanlines.
export const FRAG_POST = `#version 300 es
precision highp float;

uniform sampler2D u_tex;
uniform vec2  u_res;
uniform float u_bloom;
uniform float u_scan;
uniform float u_scanPeriod;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 base = textureLod(u_tex, uv, 0.0).rgb;
  vec3 glow = textureLod(u_tex, uv, 3.0).rgb * 0.40
            + textureLod(u_tex, uv, 4.0).rgb * 0.35
            + textureLod(u_tex, uv, 5.0).rgb * 0.25;
  vec3 c = base + glow * u_bloom;
  float line = 0.5 + 0.5 * cos(6.2831853 * gl_FragCoord.y / u_scanPeriod);
  c *= 1.0 - u_scan * (1.0 - line);
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
