/* =========================================================
   audio.js — синтезатор музыки на WebAudio (без внешних файлов)
   ========================================================= */

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class MusicEngine {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.bpm = 120;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.onStep = null;
    this.loopSteps = 32;
    this.startTime = 0;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0001;

    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.85;
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.55;

    this.musicBus.connect(this.comp);
    this.sfxBus.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  resume() {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  volume(v, time = 0.25) {
    this.ensure();
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(Math.max(0.0001, v), this.ctx.currentTime, time / 3);
  }

  fadeIn() {
    this.ensure();
    this.master.gain.setTargetAtTime(0.75, this.ctx.currentTime, 0.5);
  }

  /* ---------- кик / снейр / хэт ---------- */
  kick(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.13);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.0, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.musicBus);
    o.start(t); o.stop(t + 0.34);
  }

  snare(t) {
    const c = this.ctx;
    const len = 0.19;
    const buf = c.createBuffer(1, c.sampleRate * len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.4);
    const src = c.createBufferSource();
    src.buffer = buf;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1500;
    const g = c.createGain(); g.gain.value = 0.5;
    src.connect(hp).connect(g).connect(this.musicBus);
    src.start(t);

    const o = c.createOscillator();
    const og = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(210, t);
    og.gain.setValueAtTime(0.28, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(this.musicBus);
    o.start(t); o.stop(t + 0.14);
  }

  hat(t, open = false) {
    const c = this.ctx;
    const len = open ? 0.24 : 0.05;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * len), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
    const src = c.createBufferSource();
    src.buffer = buf;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = c.createGain(); g.gain.value = open ? 0.2 : 0.13;
    src.connect(hp).connect(g).connect(this.musicBus);
    src.start(t);
  }

  /* ---------- бас ---------- */
  bass(t, midi, dur = 0.24) {
    const c = this.ctx;
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    o.type = 'sawtooth'; o2.type = 'sine';
    o.frequency.value = NOTE(midi);
    o2.frequency.value = NOTE(midi - 12);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1500, t);
    f.frequency.exponentialRampToValueAtTime(320, t + dur);
    f.Q.value = 6;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.014);
    g.gain.setValueAtTime(0.42, t + dur * 0.65);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); o2.connect(f);
    f.connect(g).connect(this.musicBus);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }

  /* ---------- мелодия / пад ---------- */
  pluck(t, midi, dur = 0.32, vol = 0.2, type = 'triangle') {
    const c = this.ctx;
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    const g = c.createGain();
    const f = c.createBiquadFilter();
    o.type = type; o2.type = 'sine';
    o.frequency.value = NOTE(midi);
    o2.frequency.value = NOTE(midi + 12);
    f.type = 'lowpass'; f.frequency.setValueAtTime(5200, t);
    f.frequency.exponentialRampToValueAtTime(900, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); o2.connect(g); g.connect(f);
    f.connect(g).connect(this.musicBus);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }

  pad(t, midis, dur) {
    midis.forEach((m, i) => {
      const c = this.ctx;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = NOTE(m);
      o.detune.value = (i - 1) * 7;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.055, t + 0.25);
      g.gain.setValueAtTime(0.055, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.musicBus);
      o.start(t); o.stop(t + dur + 0.02);
    });
  }

  /* ---------- SFX ---------- */
  sfx(name) {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const c = this.ctx, t = c.currentTime;
    const blip = (f0, f1, dur, vol, type = 'sine') => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.sfxBus);
      o.start(t); o.stop(t + dur + 0.02);
    };
    if (name === 'perfect') { blip(880, 1760, 0.16, 0.34, 'triangle'); blip(1320, 2640, 0.2, 0.14, 'sine'); }
    else if (name === 'good') blip(660, 1320, 0.14, 0.26, 'triangle');
    else if (name === 'miss') blip(320, 90, 0.26, 0.3, 'sawtooth');
    else if (name === 'click') blip(1400, 700, 0.07, 0.18, 'square');
    else if (name === 'start') { blip(440, 880, 0.12, 0.24); setTimeout(() => this.sfx('perfect'), 110); }
    else if (name === 'win') [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, f * 1.5, 0.3, 0.22), i * 130));
    else if (name === 'lose') [440, 370, 294, 220].forEach((f, i) => setTimeout(() => blip(f, f * 0.7, 0.34, 0.22, 'sawtooth'), i * 150));
  }

  /* ---------- секвенсор ---------- */
  startMusic({ bpm = 120, pattern = 'pop', loopSteps = 32, onStep = null, volume = 0.75 } = {}) {
    this.resume();
    this.stop();
    this.bpm = bpm;
    this.loopSteps = loopSteps;
    this.onStep = onStep;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.12;
    this.startTime = this.nextTime;
    this.playing = true;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(Math.max(0.0001, volume), this.ctx.currentTime);
    this.timer = setInterval(() => this.scheduler(), 25);
  }

  scheduler() {
    if (!this.playing) return;
    const spb = 60 / this.bpm / 4; // 16-е
    while (this.nextTime < this.ctx.currentTime + 0.14) {
      this.emit(this.step % this.loopSteps, this.nextTime, this.step);
      this.nextTime += spb;
      this.step++;
    }
  }

  emit(step, t, absStep) {
    const p = step % 16;
    if (this.pattern === 'pop') this.popStep(p, t, step);
    else this.danceStep(p, t, step);
    if (this.onStep) this.onStep({ step, t, absStep, bar: Math.floor(absStep / 16) });
  }

  popStep(p, t, step) {
    if (p % 4 === 0) this.kick(t);
    if (p === 4 || p === 12) this.snare(t);
    if (p % 2 === 1) this.hat(t, p === 14);
    const roots = [45, 45, 52, 50][Math.floor(step / 32) % 4];
    const scale = [0, 3, 5, 7, 10, 12, 7, 5];
    if (p % 4 === 0) this.bass(t, roots, 0.42);
    if (p % 2 === 0) this.bass(t, roots + (p === 10 ? 7 : 0), 0.2);
    if (p % 2 === 0) this.pluck(t, 72 + scale[(step * 2) % scale.length], 0.3, 0.16);
    if (p === 0) this.pad(t, [roots + 12, roots + 16, roots + 19], 1.6);
    if (p === 6 || p === 14) this.pluck(t, 79 + scale[(step + 3) % scale.length], 0.36, 0.14, 'sine');
  }

  danceStep(p, t, step) {
    if (p % 4 === 0) this.kick(t);
    if (p === 4 || p === 12) this.snare(t);
    if (p % 2 === 0) this.hat(t, p === 6);
    const roots = [43, 41, 48, 45][Math.floor(step / 32) % 4];
    if (p === 0 || p === 6 || p === 10) this.bass(t, roots, 0.3);
    const mel = [0, 7, 5, 3, 7, 10, 12, 10];
    if (p % 2 === 0) this.pluck(t, 72 + mel[(step / 2) % mel.length], 0.24, 0.17);
    if (p === 0) this.pad(t, [roots + 12, roots + 15, roots + 19], 1.2);
  }

  stop() {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.onStep) this.onStep = null;
    if (this.ctx && this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.12);
    }
  }

  get elapsed() {
    if (!this.ctx || !this.playing) return 0;
    return this.ctx.currentTime - this.startTime;
  }
}

export const music = new MusicEngine();
