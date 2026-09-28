/* =========================================================
   game.js — «Танцевальный чек»: ритм-игра со стрелками
   ========================================================= */
import { music } from './audio.js';

const LANES = [
  { key: 'ArrowLeft', sym: '←', color: '#ff5fae' },
  { key: 'ArrowUp', sym: '↑', color: '#c86bff' },
  { key: 'ArrowDown', sym: '↓', color: '#7ce0ff' },
  { key: 'ArrowRight', sym: '→', color: '#ffc94d' }
];

const W = 900, H = 520;
const HIT_Y = 424;
const TOP_Y = -70;
const PERFECT = 0.075, GOOD = 0.145, LATE = 0.16;
const FALL = (HIT_Y - TOP_Y) / 1.85; // px в секунду (1.85 c до удара)

const STAGES = [
  { name: 'Разминка', bpm: 108, bars: 8, dens: 0.55, lives: 6 },
  { name: 'Танго-волна', bpm: 126, bars: 10, dens: 0.78, lives: 5 },
  { name: 'Финальный бит', bpm: 142, bars: 12, dens: 0.95, lives: 5 }
];

/* детерминированный «генератор» нот */
function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildChart(stage) {
  const rnd = mulberry(1337 + stage.bpm);
  const spb = 60 / stage.bpm / 4;
  const notes = [];
  let last = -1;
  for (let bar = 0; bar < stage.bars; bar++) {
    const barT = (bar * 16) * spb;
    for (let p = 0; p < 16; p++) {
      const onBeat = p % 4 === 0;
      const offBeat = p % 2 === 1;
      let hit = false;
      if (onBeat) hit = rnd() < 0.92 * stage.dens + 0.08;
      else if (offBeat) hit = rnd() < 0.4 * stage.dens;
      else hit = rnd() < 0.12 * stage.dens;
      if (!hit) continue;
      let lane = Math.floor(rnd() * 4);
      if (lane === last && rnd() < 0.7) lane = (lane + 1 + Math.floor(rnd() * 3)) % 4;
      last = lane;
      notes.push({ t: barT + p * spb, lane, state: 0, judge: '', judgeT: -1, hx: 0, hy: 0 });
    }
    /* аккорд-блиц в конце секции */
    if (bar % 4 === 3) {
      notes.push({ t: barT + 14 * spb, lane: 0, state: 0, judge: '', judgeT: -1, hx: 0, hy: 0 });
      notes.push({ t: barT + 14 * spb, lane: 3, state: 0, judge: '', judgeT: -1, hx: 0, hy: 0 });
    }
  }
  notes.sort((a, b) => a.t - b.t);
  return { notes, spb, total: stage.bars * 16 * spb };
}

export class DanceGame {
  constructor(canvas, overlay, hooks = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.overlay = overlay;
    this.hooks = hooks;              // { onJudge, onStage, onEnd, onEnergy }
    this.state = 'idle';             // idle | play | pause | over
    this.stageIdx = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.perfect = 0;
    this.good = 0;
    this.miss = 0;
    this.lives = 3;
    this.lifeFlash = 0;
    this.startAt = 0;
    this.judgeTxt = '';
    this.judgeT = -1;
    this.judgeColor = '#fff';
    this.flash = 0;
    this.particles = [];
    this.laneGlow = [0, 0, 0, 0];
    this.lane = 0;
    this.energy = 0.3;
    this.time = 0;
    this.pauseStart = 0;
    this.kbd = {};
    document.querySelectorAll('.game__keys kbd').forEach((k) => { this.kbd[k.textContent] = k; });

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bind();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width = W * dpr;
    this.cv.height = H * dpr;
    this.cv.style.aspectRatio = `${W} / ${H}`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  laneX(i) { return 150 + i * 200; }

  bind() {
    window.addEventListener('keydown', (e) => {
      const i = LANES.findIndex((l) => l.key === e.key);
      if (i >= 0) {
        if (this.state === 'play' || this.state === 'pause') e.preventDefault();
        if (this.state === 'play') { this.hit(i); this.pulseKbd(i); }
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.state === 'play') this.pause();
        else if (this.state === 'pause') this.resume();
        else this.start();
      }
      if (e.key === 'Escape' && this.state !== 'idle' && this.state !== 'over') this.finish(false);
    });

    /* тач / мышь по дорожкам */
    const pos = (e) => {
      const r = this.cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      const y = ((e.clientY - r.top) / r.height) * H;
      return { x, y };
    };
    this.cv.addEventListener('pointerdown', (e) => {
      if (this.state !== 'play') return;
      const { x, y } = pos(e);
      if (y < 330) return;
      let best = 0, bd = 1e9;
      for (let i = 0; i < 4; i++) { const d = Math.abs(this.laneX(i) - x); if (d < bd) { bd = d; best = i; } }
      this.hit(best);
      this.pulseKbd(best);
    });
  }

  pulseKbd(i) {
    const k = this.kbd[LANES[i].sym];
    if (!k) return;
    k.classList.add('is-hit');
    setTimeout(() => k.classList.remove('is-hit'), 110);
  }

  /* ============ УПРАВЛЕНИЕ ============ */
  start() {
    this.stageIdx = 0;
    this.score = 0; this.combo = 0; this.maxCombo = 0;
    this.perfect = 0; this.good = 0; this.miss = 0;
    this.lives = STAGES[0].lives;
    this.state = 'play';
    this.startStage();
  }

  startStage() {
    const st = STAGES[this.stageIdx];
    this.chart = buildChart(st);
    this.stage = st;
    this.lives = st.lives;
    this.overlay.classList.add('is-hidden');
    music.resume();
    music.sfx('start');
    music.startMusic({
      bpm: st.bpm,
      pattern: 'dance',
      loopSteps: 16,
      volume: 0.7,
      onStep: ({ absStep }) => {
        if (absStep % 4 === 0) { this.hooks.onBeat && this.hooks.onBeat(absStep / 4); }
      }
    });
    this.startAt = music.ctx.currentTime + 0.55;
    this.elapsed = 0;
    this.progress = 0;
    this.banner = st.name;
    this.bannerT = this.time;
    this.hooks.onStage && this.hooks.onStage(st, this.stageIdx);
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.elapsed = music.ctx.currentTime - this.startAt;
    music.stop();
    this.showPanel('Пауза', 'Нажми <b>Space</b> или кнопку ниже, чтобы продолжить танец', 'Продолжить', 'Музыка на паузе');
  }

  resume() {
    if (this.state !== 'pause') return;
    this.overlay.classList.add('is-hidden');
    this.state = 'play';
    music.resume();
    music.startMusic({
      bpm: this.stage.bpm, pattern: 'dance', loopSteps: 16, volume: 0.7,
      onStep: ({ absStep }) => { if (absStep % 4 === 0) this.hooks.onBeat && this.hooks.onBeat(absStep / 4); }
    });
    this.startAt = music.ctx.currentTime + 0.35 - (this.elapsed || 0);
  }

  showPanel(title, text, btn, hint) {
    const o = this.overlay;
    o.querySelector('#gameTitle').innerHTML = title;
    o.querySelector('#gameText').innerHTML = text;
    o.querySelector('#gameStart').textContent = btn;
    o.querySelector('#gameHint').innerHTML = hint || '';
    o.classList.remove('is-hidden');
  }

  /* ============ СУДЬЯ ============ */
  hit(i) {
    const now = music.ctx.currentTime - this.startAt;
    let best = null, bd = 1e9;
    for (const n of this.chart.notes) {
      if (n.state || n.lane !== i) continue;
      const d = Math.abs(n.t - now);
      if (d < bd) { bd = d; best = n; }
      if (n.t - now > GOOD) break;
    }
    this.laneGlow[i] = 1;
    if (!best || bd > GOOD) { this.hitEmpty(i, now); return; }
    best.state = 1;
    best.judgeT = now;
    if (bd <= PERFECT) {
      best.judge = 'ИДЕАЛЬНО';
      this.perfect++; this.score += 300 + this.combo * 12;
      this.combo++;
      this.energy = Math.min(1, this.energy + 0.075);
      this.setJudge('ИДЕАЛЬНО', '#ff5fae');
      music.sfx('perfect');
    } else {
      best.judge = 'ХОРОШО';
      this.good++; this.score += 140 + this.combo * 6;
      this.combo++;
      this.energy = Math.min(1, this.energy + 0.035);
      this.setJudge('ХОРОШО', '#7ce0ff');
      music.sfx('good');
    }
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    /* каждые 20 комбо — возвращаем жизнь */
    if (this.combo > 0 && this.combo % 20 === 0 && this.lives < this.stage.lives) {
      this.lives++;
      this.setJudge('+ЖИЗНЬ', '#7dffb0');
    }
    this.burst(this.laneX(i), HIT_Y, best.judge === 'ИДЕАЛЬНО' ? 26 : 14, best.judge === 'ИДЕАЛЬНО' ? '#ff5fae' : '#7ce0ff');
    this.flash = Math.min(1, this.flash + 0.35);
    this.hooks.onJudge && this.hooks.onJudge(best.judge, this.combo);
    this.hooks.onEnergy && this.hooks.onEnergy(this.energy);
  }

  hitEmpty(i, now) {
    if (this.combo > 6) this.combo = Math.floor(this.combo * 0.7);
    this.setJudge('МИМО', '#b0a3b8');
    music.sfx('miss');
    this.energy = Math.max(0.1, this.energy - 0.05);
    this.hooks.onEnergy && this.hooks.onEnergy(this.energy);
  }

  missNote(n) {
    n.state = 2;
    n.judgeT = music.ctx.currentTime - this.startAt;
    n.judge = 'ПРОМАХ';
    this.miss++;
    this.combo = 0;
    this.lives--;
    this.lifeFlash = 1;
    this.energy = Math.max(0.1, this.energy - 0.09);
    this.setJudge('ПРОМАХ', '#ff4d6d');
    music.sfx('miss');
    this.hooks.onJudge && this.hooks.onJudge('ПРОМАХ', 0);
    this.hooks.onEnergy && this.hooks.onEnergy(this.energy);
    if (this.lives <= 0) this.finish(false);
  }

  setJudge(txt, color) {
    this.judgeTxt = txt;
    this.judgeColor = color;
    this.judgeT = this.time;
  }

  burst(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 5.5;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.4,
        life: 1, r: 2 + Math.random() * 4.5, color
      });
    }
  }

  finish(win) {
    this.state = 'over';
    music.stop();
    music.sfx(win ? 'win' : 'lose');
    const acc = this.accuracy();
    if (win) {
      this.showPanel('Танец сорван! 🎉',
        `Счёт: <b>${this.score}</b> · Комбо: <b>${this.maxCombo}</b><br>Точность: <b>${acc}%</b> · Идеальных: <b>${this.perfect}</b>`,
        'Сыграть ещё', 'Браво! 💖');
    } else {
      this.showPanel('Ой, LIFE кончились 💔',
        `Счёт: <b>${this.score}</b> · Точность: <b>${acc}%</b><br>Нажми и попробуй снова — в ритм можно попасть!`,
        'Попробовать снова', 'Не сдавайся 💪');
    }
    this.hooks.onEnd && this.hooks.onEnd(win, this.score, acc);
  }

  accuracy() {
    const tot = this.perfect + this.good + this.miss;
    if (!tot) return 100;
    return Math.round(((this.perfect + this.good * 0.6) / tot) * 100);
  }

  /* ============ ОБНОВЛЕНИЕ СОСТОЯНИЯ ============ */
  update() {
    if (this.state !== 'play') return;
    const now = music.ctx.currentTime - this.startAt;
    const end = this.chart.total;
    this.progress = Math.max(0, Math.min(1, now / end));
    for (const n of this.chart.notes) {
      if (!n.state && n.t < now - LATE) this.missNote(n);
    }
    if (now > end + 0.7) {
      if (this.stageIdx < STAGES.length - 1) {
        this.stageIdx++;
        this.startStage();
      } else {
        this.finish(true);
      }
    }
  }

  /* ============ ОТРИСОВКА ============ */
  loop() {
    requestAnimationFrame(this.loop);
    this.time += 1 / 60;
    this.update();
    const g = this.ctx;
    g.clearRect(0, 0, W, H);

    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--p1').trim() || '#ff4fa3';
    const ink = css.getPropertyValue('--ink').trim() || '#4a0f2c';
    const dark = document.documentElement.dataset.theme === 'dark';

    /* фон */
    const bg = g.createLinearGradient(0, 0, 0, H);
    if (dark) { bg.addColorStop(0, 'rgba(255,255,255,.05)'); bg.addColorStop(1, 'rgba(255,255,255,.01)'); }
    else { bg.addColorStop(0, 'rgba(255,255,255,.42)'); bg.addColorStop(1, 'rgba(255,255,255,.12)'); }
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    /* сетка */
    g.strokeStyle = dark ? 'rgba(255,255,255,.07)' : 'rgba(214,51,132,.10)';
    g.lineWidth = 1;
    for (let x = 0; x <= W; x += 60) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += 60) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

    /* дорожки */
    for (let i = 0; i < 4; i++) {
      const x = this.laneX(i);
      const lg = this.laneGlow[i];
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, `rgba(255,255,255,${0.02 + lg * 0.10})`);
      grad.addColorStop(1, `rgba(255,255,255,${0.05 + lg * 0.18})`);
      g.fillStyle = grad;
      g.fillRect(x - 84, 0, 168, H);
      g.strokeStyle = dark ? 'rgba(255,255,255,.08)' : 'rgba(214,51,132,.16)';
      g.strokeRect(x - 84, 0, 168, H);

      if (lg > 0) {
        g.save();
        g.globalAlpha = lg * 0.5;
        const rg = g.createRadialGradient(x, HIT_Y, 6, x, HIT_Y, 120);
        rg.addColorStop(0, LANES[i].color);
        rg.addColorStop(1, 'transparent');
        g.fillStyle = rg;
        g.fillRect(x - 130, HIT_Y - 130, 260, 260);
        g.restore();
      }
      this.laneGlow[i] = Math.max(0, lg - 0.055);
    }

    /* ноты */
    if (this.state === 'play' || this.state === 'pause') {
      const now = this.state === 'pause' ? (this.elapsed || 0) : music.ctx.currentTime - this.startAt;
      for (const n of this.chart.notes) {
        const dt = n.t - now;
        if (dt > 2.1 || dt < -0.4) continue;
        const x = this.laneX(n.lane);
        const y = HIT_Y - dt * FALL;
        if (n.state === 0) {
          const c = LANES[n.lane].color;
          const near = Math.max(0, 1 - Math.abs(dt) / 1.85);
          g.save();
          g.shadowColor = c; g.shadowBlur = 16 + near * 26;
          g.translate(x, y);
          g.rotate(Math.PI / 4);
          const s = 20 + near * 8;
          const grd = g.createLinearGradient(-s, -s, s, s);
          grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.5, c); grd.addColorStop(1, accent);
          g.fillStyle = grd;
          g.beginPath();
          g.roundRect(-s, -s, s * 2, s * 2, 7);
          g.fill();
          g.restore();
        } else {
          const age = now - n.judgeT;
          if (n.state === 1 && age >= 0) {
            g.save();
            g.globalAlpha = Math.max(0, 0.55 - age * 1.6);
            g.strokeStyle = LANES[n.lane].color;
            g.lineWidth = 3;
            g.shadowColor = LANES[n.lane].color;
            g.shadowBlur = 14;
            g.beginPath(); g.arc(x, HIT_Y, 24 + age * 90, 0, Math.PI * 2);
            g.stroke();
            g.restore();
          }
        }
      }
    }

    /* линия удара */
    const pulse = this.judgeT > -1 && this.time - this.judgeT < 0.14 ? 1 : 0;
    g.save();
    g.shadowColor = accent; g.shadowBlur = 18 + pulse * 40;
    g.strokeStyle = ink;
    g.globalAlpha = 0.55 + pulse * 0.45;
    g.lineWidth = 4 + pulse * 3;
    g.beginPath(); g.moveTo(56, HIT_Y); g.lineTo(W - 56, HIT_Y); g.stroke();
    g.restore();

    /* точки прицела */
    for (let i = 0; i < 4; i++) {
      const x = this.laneX(i);
      g.strokeStyle = ink; g.globalAlpha = 0.28;
      g.lineWidth = 2;
      g.beginPath(); g.roundRect(x - 22, HIT_Y - 22, 44, 44, 10); g.stroke();
      g.globalAlpha = 0.55;
      g.fillStyle = LANES[i].color;
      g.beginPath(); g.arc(x, HIT_Y, 4, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    /* частицы */
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.14; p.vx *= 0.985; p.life -= 0.022;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      g.globalAlpha = Math.max(0, p.life);
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;

    /* HUD */
    g.textAlign = 'left';
    g.fillStyle = ink;
    g.font = '800 26px Manrope, sans-serif';
    g.fillText(`${this.score}`, 22, 40);
    g.font = '600 13px Manrope, sans-serif';
    g.globalAlpha = 0.65;
    g.fillText('ОЧКИ', 22, 58);
    g.textAlign = 'center';
    g.font = '800 15px Manrope, sans-serif';
    g.fillStyle = this.combo > 8 ? '#ff5fae' : ink;
    g.fillText(`КОМБО ×${this.combo}`, W / 2, 40);
    g.globalAlpha = 0.65;
    g.font = '600 12px Manrope, sans-serif';
    g.fillText(this.stage ? this.stage.name.toUpperCase() : 'ТАНЦЕВАЛЬНЫЙ ЧЕК', W / 2, 58);
    g.globalAlpha = 1;

    /* жизни */
    for (let i = 0; i < 6; i++) {
      const x = W - 34 - i * 27;
      g.save();
      g.globalAlpha = i < this.lives ? 1 : 0.2;
      g.fillStyle = this.lifeFlash > 0.3 && i === this.lives ? '#ff4d6d' : '#ff5fae';
      g.shadowColor = '#ff5fae'; g.shadowBlur = 12;
      g.beginPath();
      const s = 9;
      g.moveTo(x, s + 4);
      g.bezierCurveTo(x - s * 1.4, s - 4, x - s, s - 12, x, s - 4);
      g.bezierCurveTo(x + s, s - 12, x + s * 1.4, s - 4, x, s + 4);
      g.fill();
      g.restore();
    }
    g.globalAlpha = 0.6;
    g.textAlign = 'right'; g.font = '600 12px Manrope, sans-serif'; g.fillStyle = ink;
    g.fillText('ЖИЗНИ', W - 22, 74);
    g.globalAlpha = 1;

    /* прогресс */
    g.fillStyle = dark ? 'rgba(255,255,255,.14)' : 'rgba(214,51,132,.16)';
    g.beginPath(); g.roundRect(22, H - 26, W - 44, 8, 8); g.fill();
    const pg = g.createLinearGradient(22, 0, W - 22, 0);
    pg.addColorStop(0, '#ff5fae'); pg.addColorStop(0.5, '#c86bff'); pg.addColorStop(1, '#7ce0ff');
    g.fillStyle = pg;
    g.beginPath(); g.roundRect(22, H - 26, (W - 44) * (this.progress || 0), 8, 8); g.fill();
    g.textAlign = 'left';
    g.globalAlpha = 0.6; g.font = '600 11px Manrope, sans-serif';
    g.fillText(`ЭТАП ${this.stageIdx + 1}/${STAGES.length} · ТОЧНОСТЬ ${this.accuracy()}%`, 22, H - 34);
    g.globalAlpha = 1;

    /* суждение */
    if (this.judgeT > -1) {
      const age = this.time - this.judgeT;
      if (age < 0.75) {
        g.save();
        g.globalAlpha = Math.max(0, 1 - age / 0.75);
        g.textAlign = 'center';
        g.font = '800 34px Unbounded, sans-serif';
        g.fillStyle = this.judgeColor;
        g.shadowColor = this.judgeColor; g.shadowBlur = 22;
        const y = 150 - age * 40;
        g.fillText(this.judgeTxt, W / 2, y);
        g.restore();
      }
    }

    /* баннер этапа */
    if (this.banner && this.time - this.bannerT < 1.8) {
      const age = this.time - this.bannerT;
      g.save();
      g.globalAlpha = Math.max(0, 1 - age / 1.8);
      g.textAlign = 'center';
      g.font = '800 40px Unbounded, sans-serif';
      g.fillStyle = ink;
      g.fillText(this.banner, W / 2, H / 2 - 30);
      g.font = '600 16px Manrope, sans-serif';
      g.globalAlpha *= 0.7;
      g.fillText('ПОЙМАЙ РИТМ', W / 2, H / 2 + 4);
      g.restore();
      if (age > 1.8) this.banner = null;
    }

    /* пауза */
    if (this.state === 'pause') {
      g.fillStyle = dark ? 'rgba(8,6,12,.55)' : 'rgba(255,255,255,.55)';
      g.fillRect(0, 0, W, H);
    }
    this.flash = Math.max(0, this.flash - 0.06);
    this.lifeFlash = Math.max(0, this.lifeFlash - 0.05);
  }
}

export { LANES, STAGES };
