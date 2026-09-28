/* =========================================================
   scene3d.js — 3D-сцена на ГОТОВЫХ моделях (glTF):
   танцующий персонаж, волейбольный мяч, микрофон,
   ноты и искорки. Три темы.
   ========================================================= */
import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import robotGLB from '../models/robot.glb';
import volleyGLB from '../models/volleyball.glb';
import micGLB from '../models/mic.glb';

const READY = { robot: robotGLB, volley: volleyGLB, mic: micGLB };
const GLTF = new GLTFLoader();

function glbBuffer(src) {
  if (src instanceof ArrayBuffer) return src;
  if (typeof src === 'string') {
    const raw = atob(src);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out.buffer;
  }
  return src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength);
}

function loadReady(key) {
  return new Promise((resolve, reject) => {
    GLTF.parse(glbBuffer(READY[key]), '', (gltf) => resolve(gltf), (e) => reject(e || new Error(key)));
  });
}

/* рост + опора на ноги (y=0) + центр по X/Z */
function normalizeModel(obj, height) {
  const holder = new THREE.Group();
  obj.updateMatrixWorld(true);
  const b0 = new THREE.Box3().setFromObject(obj);
  const s0 = new THREE.Vector3();
  b0.getSize(s0);
  holder.add(obj);
  holder.scale.setScalar(height / (s0.y || 1));
  holder.updateMatrixWorld(true);
  const b1 = new THREE.Box3().setFromObject(holder);
  obj.position.set(-(b1.min.x + b1.max.x) / 2, -b1.min.y, -(b1.min.z + b1.max.z) / 2);
  return holder;
}

function collectMaterials(obj) {
  const list = [];
  const seen = new Set();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const push = (m) => {
      if (!m || seen.has(m.uuid)) return;
      seen.add(m.uuid);
      if (m.color) m.userData.baseColor = m.color.clone();
      list.push(m);
    };
    if (Array.isArray(o.material)) o.material.forEach(push);
    else push(o.material);
  });
  return list;
}

const PALETTES = {
  pink:  { skin:0xffd9c4, skinDark:0xf0b795, hair:0x3a1226, cloth:0xff4fa3, cloth2:0xffd36e, shoe:0xffffff, ballA:0xffffff, ballB:0xff4fa3, ballC:0x7ce0ff, mic:0x2a2233, grille:0xe8e3f2, ring:0xff5fae, spark:0xff8ac9, bg:0xffeaf3 },
  dark:  { skin:0xf0cbb6, skinDark:0xd9a98c, hair:0x120a18, cloth:0xff5fae, cloth2:0x5fe0ff, shoe:0x1b1420, ballA:0xf2f2f7, ballB:0xb06bff, ballC:0x5fe0ff, mic:0x0e0a14, grille:0x8d7a90, ring:0xff5fae, spark:0x5fe0ff, bg:0x08060c },
  light: { skin:0xffe0cd, skinDark:0xf3c2a2, hair:0x2a1a22, cloth:0xff4fa3, cloth2:0x9b6bff, shoe:0xffffff, ballA:0xffffff, ballB:0xff4fa3, ballC:0x9b6bff, mic:0x2a2233, grille:0xcfc8dd, ring:0xff4fa3, spark:0xff4fa3, bg:0xf7f7fb }
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);

export class Stage3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    this.theme = 'pink';
    this.palette = { ...PALETTES.pink };
    this.target = { ...PALETTES.pink };
    this.beat = 0;
    this.beatVel = 0;
    this.energy = 0.35;
    this.targetEnergy = 0.35;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.isMobile = window.innerWidth < 900;
    this.micTopY = 2.1;
    this.clipTimer = 0;
    try {
      this.init();
      this.ok = true;
    } catch (e) {
      console.warn('3D недоступна:', (e && e.message) || e);
      return;
    }
    this.bind();
    this.tick();
  }

  init() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, alpha: true, antialias: true, powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 0.15, 7.4);
    this.camTarget = new THREE.Vector3(0, 0.15, 0);
    this.camPos = this.camera.position.clone();

    /* свет */
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffc0dc, 0.62);
    this.scene.add(hemi);

    this.key = new THREE.DirectionalLight(0xffffff, 1.5);
    this.key.position.set(3.2, 5, 5.4);
    this.scene.add(this.key);

    this.rimA = new THREE.PointLight(0xff4fa3, 26, 16, 2);
    this.rimA.position.set(-3.4, 1.4, 2.4);
    this.scene.add(this.rimA);

    this.rimB = new THREE.PointLight(0x7ce0ff, 18, 16, 2);
    this.rimB.position.set(3.6, -1.6, 2.2);
    this.scene.add(this.rimB);

    /* объекты */
    this.character = this.buildCharacter();
    this.volley = this.buildVolleyball();
    this.mic = this.buildMicrophone();
    this.fx = this.buildFX();

    this.scene.add(this.character.root, this.volley.root, this.mic.root, this.fx.group);

    this.items = [
      { obj: this.character.root, home: new THREE.Vector3(0.02, -0.95, 0), focus: new THREE.Vector3(2.75, -0.15, 0.3), section: 'home', scale: 1, spin: 0.16 },
      { obj: this.volley.root, home: new THREE.Vector3(-4.5, -1.9, -2.4), focus: new THREE.Vector3(2.65, -0.4, 0.2), section: 'volley', scale: 1, spin: 0.1 },
      { obj: this.mic.root, home: new THREE.Vector3(4.55, -1.85, -2.5), focus: new THREE.Vector3(-2.6, -0.45, 0.2), section: 'music', scale: 1, spin: 0.06 }
    ];
    this.items.forEach((it) => { it.pos = it.home.clone(); });
    this.applyPalette();
  }

  /* ============ ПЕРСОНАЖ (готовая модель + анимации) ============ */
  buildCharacter() {
    const P = this.palette;
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.position.y = -1.02;
    root.add(body);
    const hold = new THREE.Group();
    body.add(hold);

    /* тень и аура — только эффекты, не «самодельный» объект */
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.62, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    root.add(shadow);

    const aura = new THREE.Mesh(
      new THREE.TorusGeometry(0.78, 0.014, 8, 64),
      new THREE.MeshBasicMaterial({ color: P.ring, transparent: true, opacity: 0.5 })
    );
    aura.position.y = -1.0;
    aura.rotation.x = -Math.PI / 2;
    root.add(aura);

    const character = { root, body, hold, aura, shadow, mats: [], mixer: null, action: null };
    this.character = character;

    loadReady('robot').then((gltf) => {
      const model = gltf.scene;
      hold.add(normalizeModel(model, 2.3));
      character.model = model;
      character.mats = collectMaterials(model);
      this.showFace(model);
      this.danceClips = gltf.animations || [];
      this.mixer = new THREE.AnimationMixer(model);
      this.clipTimer = 0;
      this.playClip(this.danceClips.find((c) => c.name === 'Dance') || this.danceClips[0]);
      this.applyPalette();
    }).catch((e) => console.warn('3D: персонаж не загрузился —', e && e.message));

    return character;
  }

  /* мимика: у робота глаза и рот спрятаны в morph-таргет visibility */
  showFace(model) {
    model.traverse((o) => {
      if (!o.isMesh || !o.morphTargetDictionary) return;
      Object.keys(o.morphTargetDictionary).forEach((k) => {
        const i = o.morphTargetDictionary[k];
        if (o.morphTargetInfluences && o.morphTargetInfluences[i] !== undefined) {
          o.morphTargetInfluences[i] = /visib|eye|mouth|smile/i.test(k) ? 1 : 0;
        }
      });
      if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true;
    });
  }

  /* смена танцевального клипа: Dance → Wave → Yes → Jump … */
  pickClip() {
    const pool = ['Dance', 'Dance', 'Wave', 'Yes', 'Jump', 'ThumbsUp'];
    const choices = pool.filter((n) => n !== this.clipName);
    const name = choices[Math.floor(Math.random() * choices.length)];
    this.clipTimer = 4.2 + Math.random() * 3.4;
    return this.danceClips.find((c) => c.name === name) || this.danceClips[0];
  }

  playClip(clip) {
    if (!clip || !this.mixer) return;
    const next = this.mixer.clipAction(clip);
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (this.character.action) this.character.action.crossFadeTo(next, 0.6, false);
    this.character.action = next;
    this.clipName = clip.name;
  }

  /* ============ ВОЛЕЙБОЛЬНЫЙ МЯЧ (готовая модель) ============ */
  buildVolleyball() {
    const P = this.palette;
    const root = new THREE.Group();
    const spin = new THREE.Group();
    root.add(spin);
    const hold = new THREE.Group();
    spin.add(hold);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.74, 28, 22),
      new THREE.MeshBasicMaterial({ color: P.ring, transparent: true, opacity: 0.16, side: THREE.BackSide, depthWrite: false })
    );
    spin.add(glow);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.95, 0.016, 8, 72),
      new THREE.MeshBasicMaterial({ color: P.ring, transparent: true, opacity: 0.42 })
    );
    ring.rotation.x = -Math.PI / 2;
    root.add(ring);

    const volley = { root, spin, hold, ring, glow, mats: [] };
    this.volley = volley;

    loadReady('volley').then((gltf) => {
      hold.add(normalizeModel(gltf.scene, 1.24));
      volley.model = gltf.scene;
      volley.mats = collectMaterials(gltf.scene);
      this.applyPalette();
    }).catch((e) => console.warn('3D: мяч не загрузился —', e && e.message));

    return volley;
  }

  /* ============ МИКРОФОН (готовая модель) ============ */
  buildMicrophone() {
    const P = this.palette;
    const root = new THREE.Group();
    const pivot = new THREE.Group();
    root.add(pivot);
    const hold = new THREE.Group();
    pivot.add(hold);

    this.micRings = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(
        new THREE.TorusGeometry(0.42 + i * 0.16, 0.014, 8, 60),
        new THREE.MeshBasicMaterial({ color: P.ring, transparent: true, opacity: 0.34 })
      );
      r.position.y = this.micTopY;
      r.rotation.x = Math.PI / 2;
      pivot.add(r);
      this.micRings.push(r);
    }

    this.micBaseGlow = new THREE.Mesh(
      new THREE.RingGeometry(0.56, 0.78, 48),
      new THREE.MeshBasicMaterial({ color: P.ring, transparent: true, opacity: 0.32, side: THREE.DoubleSide })
    );
    this.micBaseGlow.position.y = -1.25; this.micBaseGlow.rotation.x = -Math.PI / 2;
    pivot.add(this.micBaseGlow);

    this.micBeam = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 2.4, 28, 1, true),
      new THREE.MeshBasicMaterial({ color: P.ring, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
    );
    this.micBeam.position.y = this.micTopY + 0.1;
    pivot.add(this.micBeam);

    const mic = { root, pivot, hold, mats: [] };
    this.mic = mic;

    loadReady('mic').then((gltf) => {
      const holder = normalizeModel(gltf.scene, 2.35);
      holder.position.y = 0.72;
      hold.add(holder);
      mic.model = gltf.scene;
      mic.mats = collectMaterials(gltf.scene);
      const box = new THREE.Box3().setFromObject(hold);
      this.micTopY = box.max.y * 0.92;
      this.micRings.forEach((r) => { r.position.y = this.micTopY; });
      this.micBeam.position.y = this.micTopY + 0.1;
      this.applyPalette();
    }).catch((e) => console.warn('3D: микрофон не загрузился —', e && e.message));

    pivot.rotation.z = -0.16;
    this.micPivot = pivot;
    return mic;
  }

  /* ============ НОТЫ / ИСКОРКИ ============ */
  buildFX() {
    const P = this.palette;
    const group = new THREE.Group();

    const noteTex = this.makeNoteTexture();
    this.sprites = [];
    const glyphs = ['♪', '♫', '♬', '♥', '✦'];
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: noteTex, transparent: true, opacity: 0.55, depthWrite: false,
        color: new THREE.Color([P.spark, P.ring, P.cloth2][i % 3])
      }));
      const sc = 0.24 + Math.random() * 0.34;
      s.scale.set(sc, sc, sc);
      s.userData = {
        a: Math.random() * Math.PI * 2,
        r: 3.2 + Math.random() * 3.4,
        y: -2.6 + Math.random() * 5.4,
        sp: 0.16 + Math.random() * 0.42,
        base: 0.3 + Math.random() * 0.5,
        glyph: glyphs[i % glyphs.length]
      };
      group.add(s);
      this.sprites.push(s);
    }

    /* искорки */
    const count = 420;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 18;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 11;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dot = this.makeDotTexture();
    this.sparkMat = new THREE.PointsMaterial({
      size: 0.11, map: dot, transparent: true, opacity: 0.75,
      color: new THREE.Color(P.spark), depthWrite: false, blending: THREE.AdditiveBlending
    });
    const points = new THREE.Points(g, this.sparkMat);
    group.add(points);
    this.points = points;

    /* сердечки-«пятна» света */
    this.halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 12, 10),
      new THREE.MeshBasicMaterial({ color: P.ring })
    );
    this.halo.visible = false;
    group.add(this.halo);

    return { group, points };
  }

  makeNoteTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.font = 'bold 92px "Unbounded", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,.95)';
    g.strokeText('♪', 64, 66);
    g.fillStyle = '#ffffff';
    g.fillText('♪', 64, 66);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  makeDotTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,.65)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  /* ============ ПАЛИТРЫ / ТЕМЫ ============ */
  setTheme(name) {
    if (!PALETTES[name]) return;
    this.theme = name;
    this.target = { ...PALETTES[name] };
    this.key.intensity = name === 'dark' ? 1.15 : 1.55;
    this.rimA.color.set(name === 'light' ? 0xff8ac9 : PALETTES[name].cloth);
    this.rimB.color.set(name === 'light' ? 0x9b6bff : PALETTES[name].ballC);
    this.renderer.toneMappingExposure = name === 'dark' ? 1.28 : 1.12;
    this.applyPalette();
  }

  /* лёгкая перекраска готовой модели под тему */
  tintModel(mats, colors, amount) {
    mats.forEach((m, i) => {
      if (!m.color || !m.userData.baseColor) return;
      m.color.copy(m.userData.baseColor).lerp(new THREE.Color(colors[i % colors.length]), amount);
    });
  }

  applyPalette() {
    const P = this.target;
    this.tintModel(this.character.mats, [P.cloth, P.ballC, P.cloth2, P.ring, P.mic], 0.2);
    this.tintModel(this.volley.mats, [P.ballA, P.cloth, P.ballC, P.ballB], 0.45);
    this.tintModel(this.mic.mats, [P.mic, P.grille, P.ring, P.mic], 0.6);
    this.micRings.forEach((r) => r.material.color.set(P.ring));
    this.micBaseGlow.material.color.set(P.ring);
    this.micBeam.material.color.set(P.ring);
    this.volley.ring.material.color.set(P.ring);
    this.volley.glow.material.color.set(P.ring);
    this.character.aura.material.color.set(P.ring);
    this.sparkMat.color.set(P.spark);
    this.sprites.forEach((s, i) => s.material.color.set([P.spark, P.ring, P.cloth2][i % 3]));
  }

  /* ============ ВЗАИМОДЕЙСТВИЕ ============ */
  setEnergy(v) { this.targetEnergy = v; }
  hit(strength = 1) { this.beatVel += strength; }

  bind() {
    this._onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.isMobile = w < 900;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    };
    window.addEventListener('resize', this._onResize, { passive: true });

    this._onMove = (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;
      this.mx = x; this.my = y;
    };
    window.addEventListener('pointermove', this._onMove, { passive: true });
  }

  /* фокус объекта по секции */
  focusOf(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const center = r.top + r.height / 2;
    const d = Math.abs(center - vh / 2) / (vh * 0.82);
    return smooth(clamp(1 - d, 0, 1));
  }

  tick() {
    requestAnimationFrame(() => this.tick());
    if (!this.ok) return;

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    const t = this.time;

    /* бит-пружина */
    this.beatVel *= Math.pow(0.0022, dt);
    this.beat += this.beatVel * dt * 9;
    this.beat = Math.min(this.beat, 1.6);
    const pulse = this.beat * this.energy;
    this.energy = lerp(this.energy, this.targetEnergy, 0.05);

    /* ---- персонаж: готовая модель + её собственные клипы ---- */
    const c = this.character;
    const e = this.energy;
    const spd = 3.4 + e * 3.4;
    const bounce = Math.abs(Math.sin(t * spd)) * (0.05 + e * 0.1);

    c.body.position.y = -1.02 + bounce + pulse * 0.09;
    c.body.position.x = Math.sin(t * spd * 0.5) * (0.04 + e * 0.05);
    c.body.rotation.y = Math.sin(t * spd * 0.5) * (0.14 + e * 0.24);
    c.body.rotation.z = Math.sin(t * spd * 0.5 + 1) * (0.03 + e * 0.06);

    if (this.mixer) {
      this.mixer.timeScale = 0.72 + e * 0.62;
      this.mixer.update(dt);
      this.clipTimer -= dt;
      if (this.clipTimer <= 0) this.playClip(this.pickClip());
    }

    c.aura.scale.setScalar(1 + pulse * 0.22 + e * 0.1);
    c.aura.material.opacity = 0.22 + pulse * 0.4 + e * 0.16;
    c.aura.rotation.z += dt * (0.5 + e);
    c.shadow.scale.setScalar(1 - bounce * 0.5 - pulse * 0.14);
    c.shadow.material.opacity = 0.16 - bounce * 0.16;

    /* ---- мяч ---- */
    const v = this.volley;
    v.spin.rotation.y += dt * (0.7 + e * 1.9);
    v.spin.rotation.x = Math.sin(t * 1.1) * 0.3;
    v.spin.position.y = Math.sin(t * 1.7) * 0.16 + pulse * 0.14;
    v.spin.scale.setScalar(1 + pulse * 0.12);
    v.glow.material.opacity = 0.1 + pulse * 0.22 + e * 0.1;
    v.ring.rotation.z += dt * 0.6;
    v.ring.scale.setScalar(1 + Math.sin(t * 1.3) * 0.05 + pulse * 0.12);
    v.ring.material.opacity = 0.28 + pulse * 0.35;

    /* ---- микрофон ---- */
    const m = this.mic;
    m.pivot.rotation.y = Math.sin(t * 0.8) * 0.35 + Math.sin(t * 2.1) * 0.05;
    m.pivot.rotation.z = -0.16 + Math.sin(t * 1.1) * 0.05;
    m.pivot.position.y = Math.sin(t * 1.5) * 0.05;
    this.micRings.forEach((r, i) => {
      const ph = (t * (0.8 + e) + i * 0.33) % 1;
      r.scale.setScalar(0.5 + ph * 1.5);
      r.material.opacity = (1 - ph) * (0.3 + e * 0.4);
      r.position.y = this.micTopY + Math.sin(t + i) * 0.02;
    });
    this.micBeam.material.opacity = 0.05 + e * 0.09 + pulse * 0.1;

    /* ---- ноты и искорки ---- */
    this.sprites.forEach((s) => {
      const d = s.userData;
      d.y += dt * d.sp;
      if (d.y > 3.2) d.y = -3.4;
      d.a += dt * 0.3;
      const r = d.r * (1 + e * 0.1);
      s.position.set(Math.cos(d.a) * r, d.y, Math.sin(d.a) * r * 0.6 - 1.4);
      s.material.opacity = d.base * (0.4 + e * 0.7) * (0.6 + Math.sin(t * 2 + d.a) * 0.4);
    });
    this.sparkMat.opacity = 0.4 + e * 0.55;
    this.sparkMat.size = 0.09 + e * 0.07;
    this.points.rotation.y += dt * 0.03;
    this.points.position.y = Math.sin(t * 0.4) * 0.2;

    /* ---- раскладка по секциям ---- */
    const wide = window.innerWidth >= 900;
    this.items.forEach((it) => {
      const f = this.focusOf(it.section);
      const targetPos = it.home.clone().lerp(it.focus, f);
      let s = it.scale * (0.86 + f * 0.2);
      if (!wide) {
        targetPos.x = it.home.x * 0.5;
        targetPos.y = it.home.y + f * 1.5;
        targetPos.z = -1.6 - (1 - f) * 1.6;
        s = it.scale * (0.6 + f * 0.16);
      }
      it.pos.lerp(targetPos, 0.08);
      it.obj.position.copy(it.pos);
      it.obj.scale.setScalar(s);
      it.obj.rotation.y = Math.sin(t * it.spin) * 0.4 * (0.4 + f);
      it.obj.visible = true;
    });

    /* ---- камера ---- */
    const px = (this.mx || 0) * 0.42, py = -(this.my || 0) * 0.28;
    this.camPos.x = lerp(this.camPos.x, px, 0.05);
    this.camPos.y = lerp(this.camPos.y, 0.15 + py, 0.05);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.camera.rotation.z = Math.sin(t * 0.5) * 0.006;

    this.renderer.render(this.scene, this.camera);
  }
}
