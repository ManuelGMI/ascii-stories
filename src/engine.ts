import { buildAtlas, type Atlas } from './atlas';
import { FRAG_ASCII, FRAG_POST, VERT } from './shaders';

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
};

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
  private srcTex: WebGLTexture;
  private atlasTex: WebGLTexture;
  private fboTex: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private vao: WebGLVertexArrayObject;
  private atlas: Atlas | null = null;
  private atlasCharset = '';
  private srcW = 1;
  private srcH = 1;
  hasImage = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = OUT_W;
    canvas.height = OUT_H;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 no disponible en este navegador');
    this.gl = gl;
    this.ascii = new Program(gl, FRAG_ASCII);
    this.post = new Program(gl, FRAG_POST);
    this.vao = gl.createVertexArray()!;

    this.srcTex = this.makeTex();
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

  setImage(src: TexImageSource & { width: number; height: number }) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.setFilter(this.srcTex, true);
    this.srcW = src.width;
    this.srcH = src.height;
    this.hasImage = true;
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

  render(p: Params) {
    if (!this.hasImage) return;
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
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    a.i('u_src', 0);
    a.i('u_atlas', 1);
    a.v2('u_res', OUT_W, OUT_H);
    a.v2('u_srcSize', this.srcW, this.srcH);
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
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  exportPNG(p: Params): Promise<Blob> {
    this.render(p);
    return new Promise((res, rej) => this.canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
  }
}
