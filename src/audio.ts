// Pista de audio propia: decodificación, recorte exacto y volumen (Web Audio API).
// Mientras suena, su reloj es el maestro de la línea de tiempo.

export class AudioTrack {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startedAt = 0; // currentTime del contexto que corresponde a t = 0 del proyecto
  private active = false;

  buffer: AudioBuffer | null = null;
  name = '';
  trimStart = 0;
  trimEnd = 0;
  volume = 1;

  async load(file: File) {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    await this.ctx.resume();
    this.stop();
    const buf = await this.ctx.decodeAudioData(await file.arrayBuffer());
    this.buffer = buf;
    this.name = file.name;
    this.trimStart = 0;
    this.trimEnd = buf.duration;
    this.gain!.gain.value = this.volume;
  }

  clear() {
    this.stop();
    this.buffer = null;
    this.name = '';
  }

  /** Duración del fragmento recortado (s). */
  get duration() { return this.trimEnd - this.trimStart; }

  setVolume(v: number) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  /** Empieza a sonar desde t segundos dentro del fragmento recortado. */
  playFrom(t: number) {
    this.stop();
    const ctx = this.ctx;
    if (!ctx || !this.buffer) return;
    void ctx.resume();
    const offset = this.trimStart + t;
    const dur = this.trimEnd - offset;
    if (dur <= 0.001) return;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain!);
    src.onended = () => { if (this.src === src) this.active = false; };
    src.start(0, offset, dur);
    this.src = src;
    this.startedAt = ctx.currentTime - t;
    this.active = true;
  }

  stop() {
    if (this.src) {
      const s = this.src;
      this.src = null;
      s.onended = null;
      try { s.stop(); } catch { /* ya parado */ }
      s.disconnect();
    }
    this.active = false;
  }

  /** true si está sonando de verdad (el contexto no está suspendido por el navegador). */
  get running() { return this.active && this.ctx?.state === 'running'; }
  get clockTime() { return this.ctx ? this.ctx.currentTime - this.startedAt : 0; }

  /** Picos (0..1) por columna para dibujar la onda. */
  peaks(n: number): Float32Array {
    const out = new Float32Array(n);
    const b = this.buffer;
    if (!b) return out;
    const chans = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
    const per = b.length / n;
    for (let i = 0; i < n; i++) {
      let max = 0;
      const a = Math.floor(i * per), e = Math.max(a + 1, Math.floor((i + 1) * per));
      const step = Math.max(1, Math.floor((e - a) / 64)); // muestreo para que sea rápido
      for (const d of chans) for (let j = a; j < e; j += step) max = Math.max(max, Math.abs(d[j]));
      out[i] = max;
    }
    return out;
  }
}
