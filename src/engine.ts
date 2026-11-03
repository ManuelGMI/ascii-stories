import { buildAtlas, type Atlas } from './atlas';
import { FRAG_ASCII, FRAG_BLEND, FRAG_POST, VERT } from './shaders';

export interface Params {
  cell: number; // ancho de celda en px (a 1080 de ancho)
  charset: string;
  edgeStrength: number;
  edgeThreshold: number;
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  invert: boolean;
  mono: boolean;
  monoColor: string;
  bgColor: string;
  bgMix: number;
  glyphBoost: number;
  scanlines: number;
  scanPeriod: number;
  bloom: number;
  smooth: number; // suavizado temporal (0 = off, hasta ~0.9)
  // Animación
  reveal: number; // 0 off, 1 aleatorio, 2 escritura, 3 barrido →, 4 barrido ↓, 5 radial, 6 lluvia
  revealDuration: number; // s
  revealHold: number; // s que se mantiene la imagen completa antes de repetir
  revealLoop: boolean;
  flicker: number;
  flickerRate: number;
  scanSpeed: number;
  scanBar: number;
  crtFlash: number;
}

export interface Anim {
  time: number; // s
  progress: number; // 0..1 del revelado
}

export const OUT_W = 1080;
export const OUT_H = 1920;
export const CELL_ASPECT = 2; // alto de celda = 2 × ancho (proporción de un carácter monoespaciado)

export const DEFAULTS: Params = {
  cell: 12,
  charset: ' .-=os#%',
  edgeStrength: 3,
  edgeThreshold: 0.35,
  brightness: 0,
  contrast: 1.1,
  saturation: 1.25,
  gamma: 1,
  invert: false,
  mono: false,
  monoColor: '#33ff66',
  bgColor: '#05060a',
  bgMix: 0.08,
  glyphBoost: 1.15,
  scanlines: 0.25,
  scanPeriod: 4,
  bloom: 0.6,
  smooth: 0.5,
  reveal: 0,
  revealDuration: 4,
  revealHold: 2,
  revealLoop: true,
  flicker: 0,
  flickerRate: 8,
  scanSpeed: 0,
  scanBar: 0,
  crtFlash: 0,
};

/** Progreso del revelado (0..1) para un instante t del reloj de animación. */
export function revealProgress(p: Params, t: number): number {
  const D = Math.max(p.revealDuration, 0.1);
  const tc = p.revealLoop ? t % (D + p.revealHold) : t;
  return Math.min(tc / D, 1);
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

class Program {
  prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  constructor(private gl: WebGL2RenderingContext, frag: string) {
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(this.prog, compile(gl, gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.prog) ?? 'link');
  }
  use() { this.gl.useProgram(this.prog); }
  loc(name: string) {
    if (!this.locs.has(name)) this.locs.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.locs.get(name)!;
  }
  f(name: string, v: number) { this.gl.uniform1f(this.loc(name), v); }
  v2(name: string, a: number, b: number) { this.gl.uniform2f(this.loc(name), a, b); }
  v3(name: string, c: [number, number, number]) { this.gl.uniform3f(this.loc(name), ...c); }
  i(name: string, v: number) { this.gl.uniform1i(this.loc(name), v); }
}

export class Engine {
  private gl: WebGL2RenderingContext;
  private ascii: Program;
  private post: Program;
  private blend: Program;
  private rawTex: WebGLTexture;
  private rawW = 0;
  private rawH = 0;
  // Acumulador temporal (ping-pong) a tamaño de la fuente; es lo que lee la pasada ASCII.
  private acc: WebGLTexture[] = [];
  private accFbo: WebGLFramebuffer[] = [];
  private cur = 0;
  private hasAcc = false;
  private atlasTex: WebGLTexture;
  private fboTex: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private vao: WebGLVertexArrayObject;
  private atlas: Atlas | null = null;
  private atlasCharset = '';

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 no disponible en este navegador');
    this.gl = gl;
    this.ascii = new Program(gl, FRAG_ASCII);
    this.post = new Program(gl, FRAG_POST);
    this.blend = new Program(gl, FRAG_BLEND);
    this.vao = gl.createVertexArray()!;

    this.rawTex = this.makeTex();
    this.setFilter(this.rawTex, false);
    this.acc = [this.makeTex(), this.makeTex()];
    this.accFbo = [gl.createFramebuffer()!, gl.createFramebuffer()!];
    this.atlasTex = this.makeTex();
    this.fboTex = this.makeTex();
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, OUT_W, OUT_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.setFilter(this.fboTex, true);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private makeTex() {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private setFilter(t: WebGLTexture, mips: boolean) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  setImage(src: TexImageSource, w: number, h: number) {
    this.ingest(src, w, h, 0, true);
  }

  /**
   * Sube un fotograma nuevo y lo mezcla con el anterior (suavizado temporal).
   * `reset` descarta la historia (cambio de medio, salto de tiempo, bucle).
   */
  ingest(src: TexImageSource, w: number, h: number, smooth: number, reset: boolean) {
    const gl = this.gl;
    if (w < 1 || h < 1) return;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    // Textura cruda
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.rawTex);
    if (w === this.rawW && h === this.rawH) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      this.rawW = w;
      this.rawH = h;
      for (let i = 0; i < 2; i++) {
        gl.bindTexture(gl.TEXTURE_2D, this.acc[i]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.setFilter(this.acc[i], true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.accFbo[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.acc[i], 0);
      }
      this.hasAcc = false;
    }

    // Mezcla con el acumulado anterior
    const next = 1 - this.cur;
    const k = reset || !this.hasAcc ? 0 : Math.min(Math.max(smooth, 0), 0.95);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accFbo[next]);
    gl.viewport(0, 0, w, h);
    const b = this.blend;
    b.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.rawTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.acc[this.cur]);
    b.i('u_new', 0);
    b.i('u_prev', 1);
    b.v2('u_size', w, h);
    b.f('u_k', k);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cur = next;
    this.hasAcc = true;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.acc[this.cur]);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private ensureAtlas(charset: string) {
    if (this.atlas && this.atlasCharset === charset) return;
    const gl = this.gl;
    this.atlas = buildAtlas(charset);
    this.atlasCharset = charset;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.setFilter(this.atlasTex, true);
  }

  render(p: Params, anim: Anim = { time: 0, progress: 1 }) {
    if (!this.hasAcc) return;
    const gl = this.gl;
    this.ensureAtlas(p.charset);
    const cw = p.cell;
    const ch = p.cell * CELL_ASPECT;

    gl.bindVertexArray(this.vao);

    // Pasada 1: ASCII → textura intermedia
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, OUT_W, OUT_H);
    const a = this.ascii;
    a.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.acc[this.cur]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    a.i('u_src', 0);
    a.i('u_atlas', 1);
    a.v2('u_res', OUT_W, OUT_H);
    a.v2('u_srcSize', this.rawW, this.rawH);
    a.v2('u_cell', cw, ch);
    a.f('u_n', this.atlas!.rampCount);
    a.f('u_edgeStrength', p.edgeStrength);
    a.f('u_edgeThreshold', p.edgeThreshold);
    a.f('u_brightness', p.brightness);
    a.f('u_contrast', p.contrast);
    a.f('u_saturation', p.saturation);
    a.f('u_gamma', p.gamma);
    a.f('u_invert', p.invert ? 1 : 0);
    a.f('u_mono', p.mono ? 1 : 0);
    a.f('u_bgMix', p.bgMix);
    a.f('u_glyphBoost', p.glyphBoost);
    a.f('u_time', anim.time);
    a.f('u_reveal', p.reveal);
    a.f('u_progress', anim.progress);
    a.f('u_flicker', p.flicker);
    a.f('u_flickerRate', p.flickerRate);
    a.v3('u_monoColor', hex(p.monoColor));
    a.v3('u_bg', hex(p.bgColor));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.generateMipmap(gl.TEXTURE_2D);

    // Pasada 2: bloom + scanlines → lienzo
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, OUT_W, OUT_H);
    const b = this.post;
    b.use();
    b.i('u_tex', 0);
    b.v2('u_res', OUT_W, OUT_H);
    b.f('u_bloom', p.bloom);
    b.f('u_scan', p.scanlines);
    b.f('u_scanPeriod', p.scanPeriod);
    b.f('u_time', anim.time);
    b.f('u_scanSpeed', p.scanSpeed);
    b.f('u_bar', p.scanBar);
    b.f('u_flash', p.crtFlash);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  exportPNG(p: Params, anim?: Anim): Promise<Blob> {
    this.render(p, anim);
    return new Promise((res, rej) => this.canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
  }
}
