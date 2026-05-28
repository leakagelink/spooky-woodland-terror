// Synthesized sound engine using Web Audio API — no external assets needed.
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rainNode: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;

  init() {
    if (this.ctx) return;
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    this.startRain();
    this.startAmbient();
  }

  private startRain() {
    if (!this.ctx || !this.master) return;
    // Pink-ish noise buffer
    const sampleRate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, sampleRate * 2, sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 800;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.12;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.rainNode = src;
    this.rainGain = gain;
  }

  private startAmbient() {
    if (!this.ctx || !this.master) return;
    // Low drone — two detuned oscillators
    const o1 = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    o1.frequency.value = 55;
    o2.frequency.value = 55.7;
    o1.type = "sawtooth";
    o2.type = "sawtooth";
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 220;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.06;
    o1.connect(filter);
    o2.connect(filter);
    filter.connect(gain).connect(this.master);
    o1.start();
    o2.start();
    this.ambientGain = gain;
  }

  shoot() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    // Body: noise burst through bandpass
    const dur = 0.18;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);

    // Sub thump
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.12);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.6, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(og).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  knife() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2200, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  reload() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    [0, 0.12, 0.28].forEach((t, i) => {
      const osc = this.ctx!.createOscillator();
      osc.type = "square";
      osc.frequency.value = 200 + i * 60;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.001, now + t);
      g.gain.exponentialRampToValueAtTime(0.25, now + t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.06);
      osc.connect(g).connect(this.master!);
      osc.start(now + t);
      osc.stop(now + t + 0.07);
    });
  }

  hurt() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.25);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.31);
  }

  zombieGrowl() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(70 + Math.random() * 30, now);
    osc.frequency.linearRampToValueAtTime(50, now + 0.5);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 12;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 15;
    lfo.connect(lfoG).connect(osc.frequency);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.exponentialRampToValueAtTime(0.3, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(filter).connect(g).connect(this.master);
    osc.start(now); lfo.start(now);
    osc.stop(now + 0.61); lfo.stop(now + 0.61);
  }

  ghostWhisper() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const dur = 1.2;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.15, now + 0.3);
    g.gain.linearRampToValueAtTime(0.001, now + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);
  }

  thunder() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const dur = 1.5;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 200;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.9, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(now);
  }

  footstep() {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const dur = 0.08;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 350;
    const g = this.ctx.createGain();
    g.gain.value = 0.18;
    src.connect(filter).connect(g).connect(this.master);
    src.start(now);
  }

  dispose() {
    try { this.ctx?.close(); } catch {}
    this.ctx = null;
  }
}
