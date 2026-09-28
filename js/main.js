/* =========================================================
   main.js — точка входа: темы, курсор, анимации, 3D, игра
   ========================================================= */
import { Stage3D } from './scene3d.js';
import { DanceGame } from './game.js';
import { music } from './audio.js';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* =========================================================
   1. ПРЕЛОАДЕР
   ========================================================= */
function preloader(done) {
  const el = $('#preloader');
  const bar = $('#preloadBar');
  let p = 0;
  const tick = () => {
    p = Math.min(100, p + Math.random() * 22 + 8);
    bar.style.width = p + '%';
    if (p < 100) setTimeout(tick, 130 + Math.random() * 160);
    else {
      setTimeout(() => {
        el.classList.add('is-done');
        document.body.classList.add('is-loaded');
        done && done();
      }, 260);
    }
  };
  setTimeout(tick, 380);
}

/* =========================================================
   2. КУРСОР
   ========================================================= */
function cursor() {
  if (window.matchMedia('(hover:none)').matches) return;
  const dot = $('#cursorDot'), ring = $('#cursorRing');
  let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
  window.addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; }, { passive: true });
  window.addEventListener('pointerdown', () => ring.classList.add('is-press'));
  window.addEventListener('pointerup', () => ring.classList.remove('is-press'));

  const hoverSel = 'a,button,.mini-card,.stat,.chip,.player,.sw,.kbtn,.cursor-hover';
  document.addEventListener('pointerover', (e) => {
    if (e.target.closest(hoverSel)) ring.classList.add('is-hover');
  });
  document.addEventListener('pointerout', (e) => {
    if (e.target.closest(hoverSel)) ring.classList.remove('is-hover');
  });

  const loop = () => {
    rx += (x - rx) * 0.16;
    ry += (y - ry) * 0.16;
    dot.style.transform = `translate(${x}px,${y}px)`;
    ring.style.transform = `translate(${rx}px,${ry}px)`;
    requestAnimationFrame(loop);
  };
  loop();
  document.addEventListener('pointerleave', () => { dot.classList.add('is-hide'); ring.classList.add('is-hide'); });
  document.addEventListener('pointerenter', () => { dot.classList.remove('is-hide'); ring.classList.remove('is-hide'); });
}

/* =========================================================
   3. ТЕМЫ
   ========================================================= */
const THEMES = {
  pink:  { label: 'Розовая',   css: ['#ff4fa3', '#c86bff', '#ffd36e'] },
  dark:  { label: 'Тёмная',    css: ['#ff5fae', '#b06bff', '#5fe0ff'] },
  light: { label: 'Белая',     css: ['#ff4fa3', '#9b6bff', '#59c9ff'] }
};
let stage = null;

function setTheme(name, save = true) {
  if (!THEMES[name]) name = 'pink';
  document.documentElement.dataset.theme = name;
  $$('.theme-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.setTheme === name));
  const meta = $('meta[name="theme-color"]') || Object.assign(document.createElement('meta'), { name: 'theme-color' });
  meta.content = THEMES[name].css[0];
  document.head.appendChild(meta);
  if (save) try { localStorage.setItem('sh-theme', name); } catch (e) {}
  if (stage) stage.setTheme(name);
  fireTheme(name);
}

function fireTheme(name) { document.dispatchEvent(new CustomEvent('theme', { detail: name })); }

function themeInit() {
  let saved = 'pink';
  try { saved = localStorage.getItem('sh-theme') || 'pink'; } catch (e) {}
  setTheme(saved, false);
  $('#themes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-set-theme]');
    if (!b) return;
    music.resume(); music.sfx('click');
    setTheme(b.dataset.setTheme);
    b.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' }
    );
  });
}

/* =========================================================
   4. НАВИГАЦИЯ
   ========================================================= */
function navInit() {
  const nav = $('#nav');
  const links = $('#navLinks');
  const burger = $('#burger');

  const onScroll = () => {
    nav.classList.toggle('is-stuck', scrollY > 24);
    const mid = scrollY + innerHeight * 0.42;
    let active = '';
    $$('.section').forEach((s) => { if (s.offsetTop <= mid) active = s.id; });
    $$('#navLinks a').forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === '#' + active));
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  burger.addEventListener('click', () => {
    const open = links.classList.toggle('is-open');
    burger.classList.toggle('is-open', open);
    document.body.classList.toggle('no-scroll', open);
  });
  $$('#navLinks a').forEach((a) => a.addEventListener('click', () => {
    links.classList.remove('is-open');
    burger.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
  }));

  /* активная секция подсвечивает 3D-объект */
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (e.isIntersecting && stage) {
        const id = e.target.id;
        if (id === 'dance' || id === 'home') stage.setEnergy?.(0.85);
        else if (id === 'music' || id === 'volley') stage.setEnergy?.(0.6);
        else stage.setEnergy?.(0.35);
      }
    });
  }, { threshold: 0.35 });
  $$('.section').forEach((s) => io.observe(s));

  $('.footer__top').addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
}

/* =========================================================
   5. REVEAL / СЧЁТЧИКИ / ЭФФЕКТЫ КНОПОК
   ========================================================= */
function revealInit() {
  const els = $$('.reveal, .hero__badge, .hero__sub, .hero__btns, .hero__stats .stat');
  const io = new IntersectionObserver((es) => {
    es.forEach((e, i) => {
      if (e.isIntersecting) {
        setTimeout(() => e.target.classList.add('is-in'), i * 70);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  els.forEach((el) => io.observe(el));
}

function counters() {
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const to = +el.dataset.count;
      const dur = 1400;
      const t0 = performance.now();
      const step = (t) => {
        const k = clamp((t - t0) / dur, 0, 1);
        const e2 = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(to * e2) + (k === 1 && to === 999 ? '+' : '');
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      io.unobserve(el);
    });
  }, { threshold: 0.4 });
  $$('[data-count]').forEach((el) => io.observe(el));
}

function effects() {
  /* рябь при клике */
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-ripple],.btn,.player__btn,.theme-btn');
    if (!b) return;
    const r = b.getBoundingClientRect();
    const s = Math.max(r.width, r.height) * 1.1;
    const rip = document.createElement('span');
    rip.className = 'ripple';
    rip.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;width:${s}px;height:${s}px`;
    b.appendChild(rip);
    setTimeout(() => rip.remove(), 640);
    music.resume(); music.sfx('click');
  });

  /* магнитные кнопки */
  if (!window.matchMedia('(hover:none)').matches) {
    $$('[data-magnetic]').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - r.left - r.width / 2) * 0.32;
        const dy = (e.clientY - r.top - r.height / 2) * 0.42;
        el.style.transform = `translate(${dx}px,${dy}px) scale(1.05)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* наклон карточек */
  if (!window.matchMedia('(hover:none)').matches) {
    $$('.tilt').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(700px) rotateY(${px * 16}deg) rotateX(${-py * 16}deg) translateY(-5px) scale(1.03)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* плавная прокрутка для всех якорей */
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const t = document.querySelector(id);
    if (!t) return;
    e.preventDefault();
    scrollTo({ top: t.getBoundingClientRect().top + scrollY - 60, behavior: 'smooth' });
  });
}

/* =========================================================
   6. ПЛЕЕР (демо-трек на WebAudio)
   ========================================================= */
function playerInit() {
  const btn = $('#playBtn');
  const card = $('#player');
  const fill = $('#playerFill');
  const time = $('#trackTime');
  const DURATION = 24;
  let raf = null, t0 = 0, offset = 0, playing = false;

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const stopMusic = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  };

  btn.addEventListener('click', () => {
    playing = !playing;
    btn.classList.toggle('is-play', playing);
    card.classList.toggle('is-play', playing);
    if (playing) {
      if (offset >= DURATION) offset = 0;
      t0 = performance.now() / 1000 - offset;
      music.startMusic({ bpm: 118, pattern: 'pop', loopSteps: 32, volume: 0.62, onStep: ({ absStep }) => { if (absStep % 4 === 0) stage && stage.hit(0.5); } });
      const loop = () => {
        const t = performance.now() / 1000 - t0;
        if (t >= DURATION) { offset = 0; playing = false; btn.classList.remove('is-play'); card.classList.remove('is-play'); music.stop(); fill.style.width = '0%'; time.textContent = `0:00 / 0:24`; return; }
        fill.style.width = (t / DURATION) * 100 + '%';
        time.textContent = `${fmt(t)} / 0:24`;
        raf = requestAnimationFrame(loop);
      };
      loop();
    } else {
      offset = performance.now() / 1000 - t0;
      stopMusic(); music.stop();
    }
  });

  document.addEventListener('theme', () => { if (playing) { stopMusic(); music.stop(); playing = false; btn.classList.remove('is-play'); card.classList.remove('is-play'); } });
}

/* =========================================================
   7. 3D + ИГРА
   ========================================================= */
function sceneInit() {
  const canvas = $('#scene');
  try {
    stage = new Stage3D(canvas);
  } catch (e) {
    canvas.style.display = 'none';
    return;
  }
  if (!stage.ok) { canvas.style.display = 'none'; return; }
  canvas.classList.add('is-ready');
  setTimeout(() => stage.setTheme(document.documentElement.dataset.theme), 60);
  stage.setEnergy(0.5);
}

function gameInit() {
  const canvas = $('#gameCanvas');
  const overlay = $('#gameOverlay');
  const startBtn = $('#gameStart');
  const game = new DanceGame(canvas, overlay, {
    onBeat: (b) => { stage && stage.hit(0.85); },
    onEnergy: (e) => stage && stage.setEnergy(0.28 + e * 0.72),
    onJudge: (j) => { if (stage) stage.hit(j === 'ИДЕАЛЬНО' ? 1.15 : 0.7); },
    onStage: (st, i) => {
      $('#gameHint').textContent = `Этап ${i + 1}: ${st.name} · ${st.bpm} BPM`;
    },
    onEnd: (win, score, acc) => {
      if (stage) { stage.setEnergy(0.35); }
      console.log(`Игра ${win ? 'пройдена' : 'проиграна'}: ${score} очков, точность ${acc}%`);
    }
  });

  startBtn.addEventListener('click', () => {
    music.resume();
    const t = $('#gameTitle').textContent;
    if (t.includes('Пауза')) game.resume();
    else game.start();
  });

  /* удобная отладка из консоли браузера: __pink.game / __pink.stage */
  window.__pink = window.__pink || {};
  window.__pink.game = game;
  window.__pink.music = music;
  window.__pink.getStage = () => stage;

  /* остановка музыки, если пользователь ушёл с игры */
  new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (!e.isIntersecting && game.state === 'play') game.pause();
    });
  }, { threshold: 0.02 }).observe($('#game'));
}

/* =========================================================
   8. ПАРКУР / ПАРАЛЛАКС
   ========================================================= */
function parallax() {
  if (prefersReduced) return;
  let raf = null;
  const move = () => {
    $$('.card, .hero__inner').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > innerHeight + 200) { el.style.setProperty('--py', '0px'); return; }
      const off = (r.top + r.height / 2 - innerHeight / 2) * -0.05;
      el.style.setProperty('--py', off.toFixed(1) + 'px');
    });
    raf = null;
  };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(move); }, { passive: true });
  move();
}

/* =========================================================
   9. СТАРТ
   ========================================================= */
function boot() {
  themeInit();
  navInit();
  revealInit();
  counters();
  effects();
  playerInit();
  sceneInit();
  gameInit();
  parallax();
  setTimeout(() => parallax(), 400);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => preloader(boot));
} else {
  preloader(boot);
}

/* первый жест разблокирует звук */
const unlock = () => { music.resume(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);
