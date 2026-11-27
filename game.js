/* Ball Crash — rotate the tower, drop the ball, crash through everything.
 * Look: 3D cel-shaded world with ink outlines, halftone shading and hand-drawn 2D effects.
 * Gameplay (ball, camera) animates "on ones"; effects animate "on twos/threes" for a punchy stepped feel. */
(() => {
  'use strict';

  // Treat colour codes as sRGB so on-screen colours match the hex values (r149 defaults to legacy mode).
  if (THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;

  // ---------- Tunables ----------
  const TAU = Math.PI * 2;
  const SEGMENTS = 12;
  const SEG_A = TAU / SEGMENTS;
  const R_IN = 0.9;            // platform inner radius (hidden by the pole)
  const R_OUT = 3.0;           // platform outer radius
  const PLAT_H = 0.34;         // platform thickness
  const SPACING = 3.4;         // vertical distance between platforms
  const BALL_R = 0.3;
  const BALL_Z = 1.95;         // ball's distance from the tower axis
  const GRAVITY = 32;
  const BOUNCE_V = 11.5;
  const MAX_FALL = 20;
  const FIRE_STREAK = 3;       // gaps in a row (no bounce) needed for fireball
  const FIRE_TIME = 1.25;      // seconds of fireball fuel
  const FIRE_REFILL = 0.35;    // fuel gained per gap passed while on fire
  const STEP = 1 / 120;        // physics timestep
  const DRAG_SPEED = 0.011;    // radians per pixel
  const KEY_SPEED = 3.4;       // radians per second
  const STAGE_LEN = 50;        // endless: platforms per stage
  const STARS_PER_LEVEL = 3;
  const STAR_TOL = 0.36;       // radians either side of a star that still collects it
  const BASE_FOV = 50;
  const ON_TWOS = 1 / 12;      // effects update rate ("on twos" at 24fps)
  const ON_THREES = 1 / 8;     // slower stepped rate for boiling lines/pulses
  const INK = 0x150a22;        // outline colour
  const OUTLINE = 0.035;       // outline thickness for platforms (world units)

  const SAFE = 0, GAP = 1, HAZ = 2;

  const THEMES = [
    { bg: ['#1b1340', '#3b1f6b'], safe: 0x8a6bff, pole: 0xf1eaff, ball: 0xffd23f },
    { bg: ['#05263b', '#0b5470'], safe: 0x1fd1c1, pole: 0xe8fbff, ball: 0xfff275 },
    { bg: ['#2a1205', '#6b2f0b'], safe: 0x4fbaff, pole: 0xfff4e0, ball: 0xffffff },
    { bg: ['#0b2b12', '#1d6b34'], safe: 0x93ea70, pole: 0xf0ffe8, ball: 0xff7ad9 },
    { bg: ['#2b0b2e', '#5e1a63'], safe: 0xff85dc, pole: 0xfff0fd, ball: 0x8cf5ff },
    { bg: ['#101a2e', '#2a3f66'], safe: 0xe4ecfa, pole: 0x8fb3ff, ball: 0xffb347 },
  ];

  // HDR colours (values above 1 glow through the bloom pass).
  const hdr = (r, g, b) => new THREE.Color().setRGB(r, g, b);
  const SPARK_COLORS = [hdr(3, 2.2, 0.7), hdr(3, 1.2, 0.25), hdr(2.4, 2.4, 2.2)];
  const GOLD_COLORS = [hdr(2.8, 2.2, 0.5), hdr(2.4, 2.4, 2.3), hdr(2.6, 1.6, 0.3)];

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ui = {
    hud: $('hud'), lvCur: $('lvCur'), lvNext: $('lvNext'), prog: $('prog'), barLabel: $('barLabel'),
    score: $('score'), best: $('best'), hudStars: $('hudStars'), fire: $('fire'), fuel: $('fuel'),
    popups: $('popups'), mute: $('mute'), homeBtn: $('homeBtn'), overlay: $('overlay'),
    flash: $('flash'), heat: $('heat'), ink: $('ink'),
    levelsSub: $('levelsSub'), endlessSub: $('endlessSub'), btnLevels: $('btnLevels'), btnEndless: $('btnEndless'),
    grid: $('grid'), starTotal: $('starTotal'), levelsBack: $('levelsBack'),
    rTitle: $('rTitle'), rStars: $('rStars'), rBig: $('rBig'), rText: $('rText'), rStats: $('rStats'), rButtons: $('rButtons'),
  };
  const panels = { home: $('pHome'), levels: $('pLevels'), result: $('pResult') };

  const store = {
    get(k, d) { try { const v = localStorage.getItem('ballcrash.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ballcrash.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  const FX_PARAM = new URLSearchParams(location.search).get('fx');   // 'high' forces effects on, 'low' forces off

  const rand = (n) => Math.floor(Math.random() * n);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const wrap = (a) => ((a % TAU) + TAU) % TAU;

  // ---------- Renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const maxDpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(maxDpr);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.NoToneMapping;   // flat cel colours; HDR highlights are handled in post
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 14, 34);
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 140);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2a5a, 0.3));
  const sun = new THREE.DirectionalLight(0xffffff, 0.72);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 24 });
  sun.shadow.bias = -0.002;
  scene.add(sun, sun.target);
  const fireLight = new THREE.PointLight(0xff7a2a, 0, 7, 2);   // warms the tower while on fire
  scene.add(fireLight);

  const tower = new THREE.Group();
  scene.add(tower);

  // ---------- Shared GLSL ----------
  const NOISE_GLSL = `
    float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 x) {
      vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
                     mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
                     mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
    }`;
  const OUTPUT_GLSL = `
    #include <tonemapping_fragment>
    #include <encodings_fragment>`;

  // ---------- Textures (drawn with canvas so everything stays in two files) ----------
  function canvasTex(size, draw, srgb = true) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.encoding = THREE.sRGBEncoding;
    return t;
  }
  const stripeTex = canvasTex(64, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#c9cad8';
    for (let x = -64; x < 128; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 14, 0); g.lineTo(x + 78, 64); g.lineTo(x + 64, 64); g.fill(); }
  });
  stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
  stripeTex.anisotropy = 4;
  const dotTex = canvasTex(64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  }, false);
  // Four-point anime sparkle.
  const sparkleTex = canvasTex(64, (g) => {
    g.translate(32, 32); g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      g.quadraticCurveTo(Math.cos(a + TAU / 8) * 5, Math.sin(a + TAU / 8) * 5, Math.cos(a + TAU / 4) * 30, Math.sin(a + TAU / 4) * 30);
    }
    g.fill();
  }, false);
  // Jagged comic impact bursts; three variants so they "boil" between frames.
  const burstTex = [0, 1, 2].map(() => canvasTex(128, (g) => {
    const pts = [];
    const n = 14 + rand(5);
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * TAU + rnd(-0.08, 0.08);
      const r = i % 2 ? rnd(26, 36) : rnd(50, 62);
      pts.push([64 + Math.cos(a) * r, 64 + Math.sin(a) * r]);
    }
    const path = () => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
    path(); g.lineJoin = 'round'; g.lineWidth = 9; g.strokeStyle = '#150a22'; g.stroke();
    g.fillStyle = '#ffffff'; g.fill();
    g.save(); g.translate(64, 64); g.scale(0.55, 0.55); g.translate(-64, -64); path(); g.fillStyle = '#ffe98a'; g.fill(); g.restore();
  }));
  // Three-step light ramp for cel shading.
  const ramp = (() => {
    const levels = [72, 150, 255];
    const data = new Uint8Array(levels.length * 4);
    levels.forEach((v, i) => data.set([v, v, v, 255], i * 4));
    const t = new THREE.DataTexture(data, levels.length, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  })();

  // ---------- Materials / geometry ----------
  const toon = (o = {}) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...o });
  const mats = {
    safe: toon(),
    haz: toon({ color: 0x2a0610, emissive: 0xff1030, emissiveIntensity: 0.6 }),
    spike: toon({ color: 0x300810, emissive: 0xff3050, emissiveIntensity: 0.9 }),
    finishA: toon({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.12 }),
    finishB: toon({ emissiveIntensity: 0.25 }),
    pole: toon({ map: stripeTex }),
    ball: toon({ emissive: 0xff5a00, emissiveIntensity: 0 }),
    star: toon({ color: 0xffd23f, emissive: 0xffb000, emissiveIntensity: 1.3 }),
    ink: new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }),
    glint: new THREE.MeshBasicMaterial({ color: hdr(1.4, 1.4, 1.4) }),
    splat: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    sparkle: new THREE.SpriteMaterial({ map: sparkleTex, color: hdr(2.2, 1.8, 0.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  };

  // Annular wedge. `grow` > 0 builds a slightly larger copy used as the ink outline.
  function makeSegmentGeometry(grow = 0) {
    const bevel = 0.06;
    const pad = 0.014;
    const rIn = R_IN + bevel - grow, rOut = R_OUT - bevel + grow;
    const a0 = pad + (bevel - grow) / R_OUT, a1 = SEG_A - pad - (bevel - grow) / R_OUT;
    const steps = 8;
    const pts = [];
    // Shape (sx, sy) maps to world (x, z) after rotateX; world angle = atan2(x, z).
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      pts.push(new THREE.Vector2(Math.sin(a) * rOut, Math.cos(a) * rOut));
    }
    for (let i = steps; i >= 0; i--) {
      const a = a0 + (a1 - a0) * (i / steps);
      pts.push(new THREE.Vector2(Math.sin(a) * rIn, Math.cos(a) * rIn));
    }
    const depth = PLAT_H - bevel * 2 + grow * 2;
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
      depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1,
    });
    geo.rotateX(Math.PI / 2);           // extrusion now points down (-y)
    geo.translate(0, depth / 2, 0);     // center vertically
    return geo;
  }

  function makeStarGeometry() {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.19 : 0.44, a = (i / 10) * TAU;
      if (i) shape.lineTo(Math.sin(a) * r, Math.cos(a) * r);
      else shape.moveTo(Math.sin(a) * r, Math.cos(a) * r);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
    geo.center();
    return geo;
  }

  const geos = {
    seg: makeSegmentGeometry(),
    segInk: makeSegmentGeometry(OUTLINE),
    star: makeStarGeometry(),
    spike: new THREE.ConeGeometry(0.17, 0.55, 10),
    ball: new THREE.SphereGeometry(BALL_R, 36, 22),
    splat: new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2),
    chip: new THREE.IcosahedronGeometry(0.1, 0),
    confetti: new THREE.BoxGeometry(0.14, 0.04, 0.22),
    ring: new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2),
    glint: new THREE.CircleGeometry(1, 16),
    smear: new THREE.CapsuleGeometry(BALL_R * 0.9, 1, 4, 18).translate(0, 0.5, 0),
  };

  // Ink outline: a slightly bigger back-face copy drawn in INK behind the mesh.
  function inked(mesh, geo, scale = 1) {
    const o = new THREE.Mesh(geo || mesh.geometry, mats.ink);
    o.scale.setScalar(scale);
    o.userData.ink = true;
    mesh.add(o);
    return mesh;
  }

  // ---------- Sky: flat cel bands, halftone dots and stepped twinkling stars ----------
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() }, uTime: { value: 0 },
      uScroll: { value: 0 }, uHeat: { value: 0 }, uAspect: { value: 1 }, uDot: { value: 7 },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
    fragmentShader: NOISE_GLSL + `
      uniform vec3 uTop, uBot; uniform float uTime, uScroll, uHeat, uAspect, uDot; varying vec2 vUv;
      float stars(vec2 uv, float scale, float seed) {
        vec2 g = uv * scale; vec2 id = floor(g); vec2 f = fract(g) - 0.5;
        float h = hash(vec3(id, seed));
        if (h < 0.94) return 0.0;
        vec2 o = vec2(hash(vec3(id, seed + 1.0)), hash(vec3(id, seed + 2.0))) - 0.5;
        vec2 d = abs(f - o * 0.5);
        float cross = max(step(d.x, 0.03) * step(d.y, 0.16), step(d.y, 0.03) * step(d.x, 0.16));   // four-point star
        return cross * step(0.5, fract(h * 13.0 + uTime * 0.5));                                      // blinks on/off
      }
      void main() {
        vec2 uv = vUv;
        float t = smoothstep(-0.15, 1.1, uv.y);
        vec3 c = mix(uBot, uTop, floor(t * 5.0) / 4.0);                       // banded gradient
        vec2 p = vec2(uv.x * uAspect, uv.y + uScroll);
        float cloud = noise(vec3(p * vec2(1.8, 2.6), uTime * 0.02)) * 0.7 + noise(vec3(p * vec2(4.5, 6.0) + 7.0, 0.0)) * 0.3;
        c = mix(c, c * 1.15 + uTop * 0.06, step(0.64, cloud));               // flat cloud shapes
        c = mix(c, c * 0.9, step(0.54, cloud) * step(cloud, 0.64));
        // halftone dots, bigger toward the bottom
        vec2 g = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / uDot;
        float r = (1.0 - uv.y) * 0.42;
        c *= 1.0 - (1.0 - step(r, length(fract(g) - 0.5))) * 0.28;
        vec2 sp = vec2(uv.x * uAspect, uv.y + uScroll * 0.6);
        c += vec3(1.0) * stars(sp, 46.0, 1.0) * 0.8 + vec3(1.0, 0.9, 0.6) * stars(sp + 3.7, 22.0, 9.0);
        c += vec3(1.0, 0.35, 0.05) * uHeat * step(uv.y, 0.35 + noise(vec3(uv.x * 9.0, uTime * 3.0, 0.0)) * 0.15) * 0.45;
        gl_FragColor = vec4(c, 1.0);` + OUTPUT_GLSL + `
      }`,
    depthTest: false, depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  // ---------- Floating dust motes for depth ----------
  const MOTES = 180;
  const moteData = Array.from({ length: MOTES }, () => ({ a: Math.random() * TAU, r: 3.6 + Math.random() * 9, y: Math.random() * 44, s: 0.2 + Math.random() * 0.5 }));
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
  const moteMat = new THREE.PointsMaterial({ size: 0.11, map: dotTex, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  scene.add(motes);

  // ---------- Ball: cel ball, ink outline, anime glint, smear frame, fire aura ----------
  const ballMesh = inked(new THREE.Mesh(geos.ball, mats.ball), null, 1.11);
  ballMesh.castShadow = true;
  scene.add(ballMesh);
  {
    const glint = new THREE.Mesh(geos.glint, mats.glint);
    const n = new THREE.Vector3(-0.42, 0.55, 0.72).normalize();
    glint.position.copy(n).multiplyScalar(BALL_R * 1.005);
    glint.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    glint.scale.set(0.075, 0.045, 1);
    glint.rotateZ(0.6);
    ballMesh.add(glint);
  }
  const ballColor = new THREE.Color();
  const fireColor = new THREE.Color(0xff6a1a);

  // Smear frame: a dry-brush streak stretched along the ball's motion.
  const smearMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uSeed: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: NOISE_GLSL + `
      uniform vec3 uColor; uniform float uSeed; varying vec2 vUv;
      void main() {
        float s = noise(vec3(vUv.x * 26.0, uSeed * 7.0, 0.0));
        if (vUv.y > 0.3 + s * 0.8) discard;              // ragged brush tail
        gl_FragColor = vec4(uColor, 1.0);` + OUTPUT_GLSL + `
      }`,
    side: THREE.DoubleSide,
  });
  const smear = new THREE.Mesh(geos.smear, smearMat);
  smear.visible = false;
  scene.add(smear);

  // Fire aura: cel-banded flames drawn from the back faces so they sit behind the ball, with a tail streaming up.
  function makeFlameMaterial(stretch, size) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uStretch: { value: stretch },
        uCore: { value: hdr(1.7, 1.5, 0.75) }, uMid: { value: hdr(1.45, 0.55, 0.08) }, uOut: { value: hdr(0.95, 0.12, 0.04) }, uInk: { value: new THREE.Color(INK) } },
      vertexShader: NOISE_GLSL + `
        uniform float uTime, uStretch, uAmt; varying float vH; varying vec3 vP; varying vec3 vN; varying vec3 vV;
        void main() {
          vec3 nrm = normalize(position); vec3 p = position; float r = length(position);
          float n = noise(p * 4.0 + vec3(0.0, uTime * 9.0, 0.0));
          float up = max(nrm.y, 0.0);
          p += nrm * (n - 0.3) * 0.45 * r;
          p.y += up * up * uStretch * (0.4 + n * 1.2) * uAmt;
          vH = up; vP = p;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); vV = -mv.xyz; vN = normalize(normalMatrix * nrm);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: NOISE_GLSL + `
        uniform float uTime, uAmt; uniform vec3 uCore, uMid, uOut, uInk; varying float vH; varying vec3 vP; varying vec3 vN; varying vec3 vV;
        void main() {
          float n = noise(vP * 6.0 + vec3(0.0, uTime * 12.0, 0.0));
          float f = abs(dot(normalize(vN), normalize(vV)));
          float heat = (1.0 - vH * 0.85) * (0.45 + f * 0.55) + (n - 0.5) * 0.55 - (1.0 - uAmt) * 0.6;
          if (heat < 0.18) discard;
          vec3 col = heat > 0.66 ? uCore : heat > 0.44 ? uMid : heat > 0.24 ? uOut : uInk;   // cel bands + ink rim
          gl_FragColor = vec4(col, 1.0);` + OUTPUT_GLSL + `
        }`,
      side: THREE.BackSide,
    });
  }
  const flameInner = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.35, 32, 22), makeFlameMaterial(0.9));
  const flameOuter = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.8, 32, 22), makeFlameMaterial(1.9));
  const flames = new THREE.Group();
  flames.add(flameOuter, flameInner);
  flames.visible = false;
  scene.add(flames);

  // Speed lines that streak past while on fire.
  const LINES = 36;
  const speedLines = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.035, 1, 0.035),
    new THREE.MeshBasicMaterial({ color: hdr(1.3, 1.2, 1), transparent: true, opacity: 0, depthWrite: false }),
    LINES
  );
  speedLines.frustumCulled = false;
  speedLines.visible = false;
  scene.add(speedLines);
  const lineData = Array.from({ length: LINES }, () => ({ a: Math.random() * TAU, r: 3.4 + Math.random() * 3.4, y: Math.random() * 18 - 10, len: 1.2 + Math.random() * 2.6, v: 22 + Math.random() * 22 }));

  const ball = { y: 0, vy: 0, squash: 0, visible: true };

  // ---------- Post: bloom, soft highlight roll-off, halftone shadows, colour misregistration ----------
  function createPost() {
    if (!renderer.capabilities.isWebGL2) return null;
    const floatOk = !!renderer.getContext().getExtension('EXT_color_buffer_float');
    const type = floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const rt = (samples) => new THREE.WebGLRenderTarget(1, 1, { type, samples: samples || 0, depthBuffer: !!samples });
    const sceneRT = rt(4);
    const bright = rt();
    const levels = [0, 1, 2, 3].map(() => ({ a: rt(), b: rt(), w: 1, h: 1 }));
    const quadScene = new THREE.Scene();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    quadScene.add(quad);
    const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const mat = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, toneMapped: false });

    const brightMat = mat(`
      uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb; float l = max(c.r, max(c.g, c.b));
        float knee = threshold * 0.5; float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
        soft = soft * soft / (4.0 * knee + 1e-4);
        gl_FragColor = vec4(c * (max(soft, l - threshold) / max(l, 1e-4)), 1.0);
      }`, { tDiffuse: { value: null }, threshold: { value: 1.3 } });

    const blurMat = mat(`
      uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
        c += texture2D(tDiffuse, vUv + dir * 1.384615).rgb * 0.316216;
        c += texture2D(tDiffuse, vUv - dir * 1.384615).rgb * 0.316216;
        c += texture2D(tDiffuse, vUv + dir * 3.230769).rgb * 0.070270;
        c += texture2D(tDiffuse, vUv - dir * 3.230769).rgb * 0.070270;
        gl_FragColor = vec4(c, 1.0);
      }`, { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } });

    const compMat = mat(`
      uniform sampler2D tScene, tB0, tB1, tB2, tB3; uniform float strength, ca, dotSize, halftone; varying vec2 vUv;
      vec3 rolloff(vec3 c) { return mix(c, 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2)), step(0.8, c)); }   // keeps cel colours, tames HDR
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() {
        vec2 off = (vUv - 0.5) * ca * 0.012 + vec2(0.0012, 0.0) * (0.35 + ca);            // print misregistration
        vec3 c = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);
        vec3 b = texture2D(tB0, vUv).rgb * 0.5 + texture2D(tB1, vUv).rgb * 0.7 + texture2D(tB2, vUv).rgb * 0.9 + texture2D(tB3, vUv).rgb * 1.1;
        c = toSRGB(clamp(rolloff(c + b * strength), 0.0, 1.0));
        // halftone dots in the shadows
        float lum = dot(c, vec3(0.299, 0.587, 0.114));
        vec2 g = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / dotSize;
        float r = clamp((0.42 - lum) * 1.6, 0.0, 0.6);
        float dotMask = 1.0 - smoothstep(r - 0.06, r, length(fract(g) - 0.5));
        c = mix(c, c * 0.45, dotMask * halftone);
        gl_FragColor = vec4(c, 1.0);
      }`, {
      tScene: { value: sceneRT.texture }, tB0: { value: levels[0].b.texture }, tB1: { value: levels[1].b.texture },
      tB2: { value: levels[2].b.texture }, tB3: { value: levels[3].b.texture },
      strength: { value: 0.7 }, ca: { value: 0 }, dotSize: { value: 5 }, halftone: { value: 0.8 },
    });

    const pass = (material, target) => { quad.material = material; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); };
    return {
      uniforms: compMat.uniforms,
      setSize(w, h, pr) {
        sceneRT.setSize(w, h);
        const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
        bright.setSize(bw, bh);
        levels.forEach((L, i) => { L.w = Math.max(1, bw >> i); L.h = Math.max(1, bh >> i); L.a.setSize(L.w, L.h); L.b.setSize(L.w, L.h); });
        compMat.uniforms.dotSize.value = 4.5 * pr;
      },
      render() {
        renderer.setRenderTarget(sceneRT);
        renderer.render(scene, camera);
        brightMat.uniforms.tDiffuse.value = sceneRT.texture;
        pass(brightMat, bright);
        let src = bright.texture;
        for (const L of levels) {
          blurMat.uniforms.tDiffuse.value = src; blurMat.uniforms.dir.value.set(1 / L.w, 0); pass(blurMat, L.a);
          blurMat.uniforms.tDiffuse.value = L.a.texture; blurMat.uniforms.dir.value.set(0, 1 / L.h); pass(blurMat, L.b);
          src = L.b.texture;
        }
        pass(compMat, null);
      },
    };
  }
  const post = FX_PARAM === 'low' ? null : createPost();
  let fxOn = !!post;

  // ---------- Game state ----------
  let state = 'menu';          // menu | play | dead | clear
  let mode = 'levels';         // levels | endless
  let unlocked = Math.max(1, store.get('level', 1));   // highest level you can play
  let level = unlocked;        // level being played
  const starsByLevel = store.get('stars', {});
  let bestDepth = store.get('bestDepth', 0);
  let score = 0;
  let starsGot = 0;
  let depth = 0;               // endless: platforms passed
  let stage = 1;               // endless: current stage
  let newBest = false;
  let genIndex = 0;            // endless: index of the next platform to generate
  let runId = 0;               // bumps on every new run so stale timers do nothing
  let streak = 0;
  let fire = false;
  let fuel = 0;
  let towerRot = 0;
  let platforms = [];
  let nextIdx = 0;
  let pole = null;
  let theme = THEMES[0];
  let camY = 0;
  let time = 0;                // gameplay clock (reset each run)
  let fxTime = 0;              // effects clock (never resets)
  // Cinematic effect state
  let fireAmt = 0;             // smoothed 0..1 fireball intensity
  let timeScale = 1, slowT = 0, slowScale = 1;
  let fovKick = 0, rollKick = 0, caPulse = 0, flashV = 0, shake = 0, focusV = 0;
  let lastFlashAt = -10;
  const splats = [];
  const debris = [];

  const platformRot = (p) => p.baseRot + p.spin * time;
  const totalStars = () => Object.values(starsByLevel).reduce((a, b) => a + b, 0);

  // ---------- Difficulty ----------
  // One smooth curve drives everything: 0 at level 1, ~0.5 at level 10, ~0.75 at level 20, then levels off.
  const difficulty = (n) => 1 - Math.exp(-(n - 1) / 14);
  // Rounds x up or down at random so the average is exactly x (2.3 -> 2 most of the time, 3 sometimes).
  const roundRandom = (x) => Math.floor(x) + (Math.random() < x - Math.floor(x) ? 1 : 0);

  function levelSettings(n) {
    const d = difficulty(n);
    return {
      platforms: Math.min(12 + n, 40),
      hazards: 0.5 + d * 3.5,                         // average red segments per platform (out of 12)
      narrowGap: n < 6 ? 0 : Math.min(0.35, d * 0.45), // chance a gap is only one segment wide
      spin: n < 6 ? 0 : Math.min(0.3, d * 0.4),        // chance a platform spins on its own
      spinSpeed: 0.25 + d * 0.45,
    };
  }
  // Endless stages step up like levels 2, 6, 10, 14, ... so each stage is a clear jump.
  const endlessSettings = (s) => levelSettings(2 + (s - 1) * 4);

  // ---------- Platform generation ----------
  // Segments of a new platform that sit directly under the gaps of the platform above it.
  // These never get hazards, so dropping through a gap can't land you straight on spikes.
  function segmentsUnderGaps(prev, rot) {
    const out = new Set();
    if (!prev || prev.spin) return out;
    prev.types.forEach((type, g) => {
      if (type !== GAP) return;
      for (const f of [0.02, 0.5, 0.98]) {
        out.add(Math.floor(wrap((g + f) * SEG_A + prev.baseRot - rot) / SEG_A) % SEGMENTS);
      }
    });
    return out;
  }

  function genTypes(i, cfg, ramp01, protect, allowHaz) {
    const t = new Array(SEGMENTS).fill(SAFE);
    let gapSize = Math.random() < cfg.narrowGap ? 1 : 2;
    if (Math.random() < 0.12) gapSize = 3;              // occasional wide gap for combos
    const gapStart = i === 0 ? 3 + rand(6) : rand(SEGMENTS);
    for (let k = 0; k < gapSize; k++) t[(gapStart + k) % SEGMENTS] = GAP;

    if (allowHaz) {
      // Ease in: 70% of the difficulty at the top of a level/stage, 100% near the bottom.
      let x = cfg.hazards * (0.7 + 0.3 * ramp01);
      if (Math.random() < 0.12) x *= 0.4;               // the odd breather platform
      const open = [];
      for (let s = 0; s < SEGMENTS; s++) if (t[s] === SAFE && !protect.has(s)) open.push(s);
      for (let h = Math.min(6, roundRandom(x), open.length - 1); h > 0; h--) {
        t[open.splice(rand(open.length), 1)[0]] = HAZ;
      }
    }
    return t;
  }

  function makeSegment(type, checkerIdx) {
    let mat = mats.safe;
    if (type === HAZ) mat = mats.haz;
    if (checkerIdx !== undefined) mat = checkerIdx % 2 ? mats.finishB : mats.finishA;
    const m = inked(new THREE.Mesh(geos.seg, mat), geos.segInk);
    m.receiveShadow = true;
    if (type === HAZ) {
      for (const r of [1.45, 2.05, 2.65]) {
        const s = inked(new THREE.Mesh(geos.spike, mats.spike), null, 1.18);
        s.position.set(Math.sin(SEG_A / 2) * r, PLAT_H / 2 + 0.27, Math.cos(SEG_A / 2) * r);
        m.add(s);
      }
    }
    return m;
  }

  function addPlatform(y, types, baseRot, spin, opts = {}) {
    const group = new THREE.Group();
    group.position.y = y;
    group.rotation.y = baseRot;
    for (let s = 0; s < SEGMENTS; s++) {
      if (types[s] === GAP) continue;
      const m = makeSegment(types[s], opts.checker ? s : undefined);
      m.rotation.y = s * SEG_A;
      m.userData.seg = s;
      group.add(m);
    }
    tower.add(group);
    const p = { y, types, baseRot, spin, finish: !!opts.finish, group, smashed: false, star: null };
    platforms.push(p);
    return p;
  }

  function makeNextPlatform(i, cfg, ramp01, allowHaz, checker) {
    const prev = platforms.length ? platforms[platforms.length - 1] : null;
    const spin = allowHaz && Math.random() < cfg.spin
      ? (Math.random() < 0.5 ? -1 : 1) * cfg.spinSpeed * (0.8 + Math.random() * 0.4) : 0;
    const rot = i === 0 ? 0 : Math.random() * TAU;
    const protect = spin ? new Set() : segmentsUnderGaps(prev, rot);
    return addPlatform(-i * SPACING, genTypes(i, cfg, ramp01, protect, allowHaz), rot, spin, { checker });
  }

  // A star floats in the middle of the platform's gap, with a sparkle behind it.
  function addStar(p) {
    let sx = 0, cz = 0;
    p.types.forEach((t, s) => {
      if (t !== GAP) return;
      const a = (s + 0.5) * SEG_A;
      sx += Math.sin(a);
      cz += Math.cos(a);
    });
    const angle = wrap(Math.atan2(sx, cz));
    const mesh = inked(new THREE.Mesh(geos.star, mats.star), null, 1.16);
    const glow = new THREE.Sprite(mats.sparkle);
    glow.scale.setScalar(1.5);
    glow.position.z = -0.1;
    mesh.add(glow);
    mesh.position.set(Math.sin(angle) * BALL_Z, PLAT_H / 2 + 0.6, Math.cos(angle) * BALL_Z);
    p.group.add(mesh);
    p.star = { angle, mesh };
  }

  // Endless: keep platforms generated ahead of the ball and drop the ones far above it.
  function endlessFill() {
    while (!platforms.length || platforms[platforms.length - 1].y > camY - 60) {
      const i = genIndex++;
      const s = Math.floor(i / STAGE_LEN) + 1;
      const stageStart = i > 0 && i % STAGE_LEN === 0;   // checkered ring, no hazards: welcome to the next stage
      makeNextPlatform(i, endlessSettings(s), (i % STAGE_LEN) / STAGE_LEN, i >= 2 && !stageStart, stageStart);
    }
    while (nextIdx > 0 && platforms[0].y > camY + 16) {
      const p = platforms.shift();
      nextIdx--;
      tower.remove(p.group);
    }
  }

  // ---------- Themes ----------
  const themeTarget = { safe: new THREE.Color(), pole: new THREE.Color(), ball: new THREE.Color(), top: new THREE.Color(), bot: new THREE.Color() };

  function applyTheme(idx, instant) {
    theme = THEMES[idx % THEMES.length];
    const root = document.documentElement.style;
    root.setProperty('--bg-top', theme.bg[0]);
    root.setProperty('--bg-bot', theme.bg[1]);
    root.setProperty('--accent', '#' + new THREE.Color(theme.ball).getHexString());
    themeTarget.safe.setHex(theme.safe);
    themeTarget.pole.setHex(theme.pole);
    themeTarget.ball.setHex(theme.ball);
    themeTarget.top.set(theme.bg[0]);
    themeTarget.bot.set(theme.bg[1]);
    if (instant) blendTheme(1);
  }

  function blendTheme(k) {
    mats.safe.color.lerp(themeTarget.safe, k);
    mats.pole.color.lerp(themeTarget.pole, k);
    ballColor.lerp(themeTarget.ball, k);
    mats.finishB.color.copy(ballColor);
    mats.finishB.emissive.copy(ballColor);
    mats.splat.color.copy(ballColor);
    smearMat.uniforms.uColor.value.copy(ballColor);
    skyMat.uniforms.uTop.value.lerp(themeTarget.top, k);
    skyMat.uniforms.uBot.value.lerp(themeTarget.bot, k);
    scene.fog.color.copy(skyMat.uniforms.uBot.value).lerp(skyMat.uniforms.uTop.value, 0.35);
    moteMat.color.copy(themeTarget.ball).lerp(themeTarget.pole, 0.5);
  }

  // ---------- Building a run ----------
  function clearTower() {
    while (tower.children.length) tower.remove(tower.children[0]);
    if (pole) pole.geometry.dispose();
    for (const d of debris) scene.remove(d.obj);
    debris.length = 0;
    splats.length = 0;
    platforms = [];
    ui.popups.innerHTML = '';
  }

  function makePole(height) {
    pole = new THREE.Mesh(new THREE.CylinderGeometry(R_IN + 0.02, R_IN + 0.02, height, 40), mats.pole);
    pole.add(new THREE.Mesh(new THREE.CylinderGeometry(R_IN + 0.07, R_IN + 0.07, height, 40), mats.ink));
    pole.receiveShadow = true;
    stripeTex.repeat.set(4, height / 1.45);
    tower.add(pole);
  }

  function build() {
    runId++;
    clearTower();
    towerRot = 0;
    nextIdx = 0;
    streak = 0;
    score = 0;
    starsGot = 0;
    depth = 0;
    stage = 1;
    genIndex = 0;
    newBest = false;
    camY = 0;
    time = 0;
    fireAmt = 0;
    timeScale = 1; slowT = 0; fovKick = 0; rollKick = 0; caPulse = 0; flashV = 0; shake = 0; focusV = 0;
    setFire(false);
    ball.y = PLAT_H / 2 + BALL_R + 2.2;
    ball.vy = 0;
    ball.visible = true;
    ballMesh.visible = true;

    if (mode === 'levels') {
      applyTheme(level - 1, true);
      const cfg = levelSettings(level);
      const count = cfg.platforms;
      const starAt = new Set([0.25, 0.55, 0.85].map((f) => Math.max(2, Math.round(count * f))));
      for (let i = 0; i < count; i++) {
        const p = makeNextPlatform(i, cfg, i / count, i >= 2, false);
        if (starAt.has(i)) addStar(p);
      }
      addPlatform(-count * SPACING, new Array(SEGMENTS).fill(SAFE), 0, 0, { finish: true, checker: true });
      makePole(count * SPACING + 14);
      pole.position.y = -count * SPACING / 2 + 3;
    } else {
      applyTheme(0, true);
      makePole(140);
      endlessFill();
    }
    updateHud(true);
  }

  // ---------- Collision helpers ----------
  function ballLocalAngle(p) {
    // Ball sits at world angle 0; convert to the platform's local angle.
    return wrap(-(towerRot + platformRot(p)));
  }
  const segmentUnderBall = (p) => Math.min(SEGMENTS - 1, Math.floor(ballLocalAngle(p) / SEG_A));

  // ---------- Effects toolkit ----------
  const _v = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const ballPos = () => new THREE.Vector3(0, ball.y, BALL_Z);

  // Comic text pop-ups. Animations use CSS steps() so they move "on twos" like hand-drawn frames.
  function popup(text, cls, centered) {
    const el = document.createElement('div');
    el.className = 'pop' + (cls ? ' ' + cls : '');
    if (cls && cls.includes('fireban')) {
      el.innerHTML = `<i class="burst-ink"></i><i class="burst-fill"></i><span>${text}</span>`;
    } else {
      el.textContent = text;
    }
    el.style.setProperty('--tilt', rnd(-9, 9).toFixed(1) + 'deg');
    if (centered) {
      el.style.left = '50%';
      el.style.top = '38%';
    } else {
      _v.set(0, ball.y + 0.6, BALL_Z).project(camera);
      el.style.left = ((_v.x + 1) / 2 * innerWidth + rnd(-30, 30)) + 'px';
      el.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px';
    }
    ui.popups.appendChild(el);
    setTimeout(() => el.remove(), centered ? 1700 : 900);
  }
  const SFX_WORDS = { smash: ['CRASH!', 'SMASH!', 'KRAK!', 'BOOM!'], bounce: ['boing', 'bop', 'boing!'] };
  const pick = (list) => list[rand(list.length)];

  // Every short-lived effect object goes through here. Effects animate on twos (see stepEffects).
  function addFx(obj, o) {
    debris.push({
      obj, vel: o.vel || new THREE.Vector3(), spin: o.spin || null, life: o.life, max: o.life,
      gravity: o.gravity || 0, drag: o.drag || 0, mats: o.mats || null, opacity: o.opacity === undefined ? 1 : o.opacity,
      shrink: !!o.shrink, grow: o.grow || null, hot: !!o.hot, hold: !!o.hold, boil: o.boil || null, s0: obj.scale.x,
    });
  }

  function fadeable(obj) {
    const list = [];
    obj.traverse((o) => {
      if (o.material) {
        o.material = o.material.clone();
        o.material.transparent = true;
        list.push(o.material);
      }
    });
    return list;
  }

  // Flat ink-edged ring (shockwaves, ripples).
  function ring(center, color, from, to, life) {
    const fill = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const edge = new THREE.MeshBasicMaterial({ color: INK, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geos.ring, fill);
    const e = new THREE.Mesh(geos.ring, edge);
    e.scale.set(1.06, 1, 1.06);
    e.position.y = -0.01;
    m.add(e);
    m.position.copy(center);
    m.scale.setScalar(from);
    scene.add(m);
    addFx(m, { life, mats: [fill, edge], grow: [from, to] });
  }

  // Hand-drawn impact star: holds full strength, boils between drawings, then cuts out.
  function impact(at, color, size, life = 0.2) {
    const mat = new THREE.SpriteMaterial({ map: burstTex[rand(3)], color, transparent: true, depthTest: false, depthWrite: false });
    mat.rotation = Math.random() * TAU;
    const s = new THREE.Sprite(mat);
    s.position.copy(at);
    s.scale.setScalar(size * 0.6);
    s.renderOrder = 20;
    scene.add(s);
    addFx(s, { life, mats: [mat], grow: [size * 0.6, size], hold: true, boil: burstTex });
  }

  // Particle spray of sparkles (sprite) or solid bits (mesh).
  function spray(o) {
    for (let i = 0; i < o.count; i++) {
      const color = o.colors[i % o.colors.length];
      let m, mat;
      if (o.sprite) {
        mat = new THREE.SpriteMaterial({ map: o.sprite, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        mat.rotation = Math.random() * TAU;
        m = new THREE.Sprite(mat);
      } else {
        mat = toon({ color, transparent: true });
        m = new THREE.Mesh(o.geo, mat);
        m.rotation.set(Math.random() * TAU, Math.random() * TAU, 0);
      }
      m.position.copy(o.at);
      m.scale.setScalar(rnd(o.scale[0], o.scale[1]));
      scene.add(m);
      // Random direction; `up` biases it upward (0..1), `flat` squashes it into a horizontal disc.
      const a = Math.random() * TAU;
      const vy = o.up === undefined ? rnd(-0.7, 1) : rnd(o.up, 1);
      const sp = o.speed * rnd(0.4, 1);
      const h = Math.sqrt(Math.max(0, 1 - vy * vy));
      addFx(m, {
        vel: new THREE.Vector3(Math.cos(a) * h * sp, vy * sp * (o.flat ? 0.25 : 1), Math.sin(a) * h * sp),
        spin: o.sprite ? null : new THREE.Vector3(rnd(-10, 10), rnd(-10, 10), 0),
        life: o.life * rnd(0.6, 1.2), gravity: o.gravity === undefined ? 14 : o.gravity, drag: o.drag || 0,
        mats: [mat], shrink: !!o.shrink,
      });
    }
  }

  // Screen flash, limited to about three per second so it stays comfortable for sensitive eyes.
  function flash(color, amount) {
    if (fxTime - lastFlashAt < 0.33 && amount < 0.5) return;
    lastFlashAt = fxTime;
    ui.flash.style.background = color;
    flashV = Math.max(flashV, amount);
  }
  // Anime impact frame: one held drawing in inverted black & white (or red), then back to colour.
  function impactFrame(red) {
    canvas.style.filter = red
      ? 'grayscale(1) contrast(9) invert(1) sepia(1) saturate(9) hue-rotate(-35deg)'
      : 'grayscale(1) contrast(9) invert(1)';
    setTimeout(() => { canvas.style.filter = ''; }, 95);
  }
  function slowMo(scale, seconds) { slowScale = scale; slowT = seconds; timeScale = scale; }

  // Anime focus lines drawn on a 2D canvas over the scene, redrawn on twos so they flicker by hand.
  const inkCtx = ui.ink.getContext('2d');
  let inkDrawn = false;
  function drawFocusLines(strength, color) {
    const w = ui.ink.width, h = ui.ink.height;
    inkCtx.clearRect(0, 0, w, h);
    inkDrawn = strength > 0.02;
    if (!inkDrawn) return;
    const cx = w / 2, cy = h * 0.55, R = Math.hypot(w, h) * 0.62;
    inkCtx.fillStyle = color;
    const n = Math.floor(60 + 90 * strength);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const spread = rnd(0.003, 0.016);
      const inner = R * rnd(0.5, 0.85) * (1.2 - strength * 0.45);
      inkCtx.beginPath();
      inkCtx.moveTo(cx + Math.cos(a - spread) * R * 1.3, cy + Math.sin(a - spread) * R * 1.3);
      inkCtx.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      inkCtx.lineTo(cx + Math.cos(a + spread) * R * 1.3, cy + Math.sin(a + spread) * R * 1.3);
      inkCtx.fill();
    }
  }

  function addSplat(p) {
    const local = ballLocalAngle(p);
    const m = new THREE.Mesh(geos.splat, mats.splat);
    const s = 0.3 + Math.random() * 0.12;
    m.scale.set(s, 1, s * (0.8 + Math.random() * 0.4));
    m.rotation.y = Math.random() * TAU;
    m.position.set(Math.sin(local) * BALL_Z, PLAT_H / 2 + 0.006, Math.cos(local) * BALL_Z);
    p.group.add(m);
    splats.push(m);
    if (splats.length > 24) {
      const old = splats.shift();
      if (old.parent) old.parent.remove(old);
    }
  }

  function smashPlatform(p) {
    p.smashed = true;
    const rot = towerRot + platformRot(p);
    tower.rotation.y = towerRot;          // sync transforms so pieces detach in place
    p.group.rotation.y = platformRot(p);
    for (const m of p.group.children.slice()) {
      if (m.userData.seg === undefined) { p.group.remove(m); continue; } // splats, stars
      const mid = m.userData.seg * SEG_A + SEG_A / 2 + rot;
      scene.attach(m);
      const speed = rnd(5, 9);
      const list = fadeable(m);
      for (const mt of list) if (mt.emissive) mt.emissive.set(0xff5a10);   // shards glow hot, then cool
      addFx(m, {
        vel: new THREE.Vector3(Math.sin(mid) * speed, rnd(2, 7), Math.cos(mid) * speed),
        spin: new THREE.Vector3(rnd(-6, 6), rnd(-3, 3), rnd(-6, 6)),
        life: rnd(0.9, 1.3), gravity: 22, mats: list, hot: true,
      });
    }
    tower.remove(p.group);
  }

  // Flame puffs and embers, spawned on twos so the trail reads like drawn frames.
  function fireTrail() {
    const at = new THREE.Vector3(rnd(-0.12, 0.12), ball.y + 0.25, BALL_Z + rnd(-0.12, 0.12));
    const puff = new THREE.Mesh(geos.chip, new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? hdr(2.6, 1.1, 0.15) : hdr(3, 2.4, 1), transparent: true }));
    inked(puff, null, 1.3);
    puff.position.copy(at);
    puff.scale.setScalar(rnd(1.4, 2.6));
    scene.add(puff);
    addFx(puff, { vel: new THREE.Vector3(rnd(-0.6, 0.6), rnd(3, 5), rnd(-0.6, 0.6)), spin: new THREE.Vector3(rnd(-6, 6), rnd(-6, 6), 0), life: 0.33, mats: [puff.material], shrink: true });
    spray({ sprite: sparkleTex, colors: SPARK_COLORS, count: 1, at, speed: 5, life: 0.5, gravity: 2, drag: 1.5, scale: [0.2, 0.4], up: 0.3 });
  }

  // "Multiples": held ghost copies of the ball left behind on twos while falling fast.
  function multiples() {
    const g = new THREE.Mesh(geos.ball, new THREE.MeshBasicMaterial({ color: ballColor.clone(), transparent: true, opacity: 0.45, depthWrite: false }));
    g.position.copy(ballMesh.position);
    g.scale.copy(ballMesh.scale);
    scene.add(g);
    addFx(g, { life: 0.2, mats: [g.material], opacity: 0.45 });
  }

  // ---------- Audio ----------
  let actx = null;
  let muted = store.get('muted', false);
  function ensureAudio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; }
    }
    if (actx && actx.state === 'suspended') actx.resume();
  }
  function tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
    if (muted || !actx) return;
    const t = actx.currentTime + delay;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, freq, freqTo, type = 'lowpass') {
    if (muted || !actx) return;
    const len = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    src.buffer = buf;
    f.type = type;
    f.frequency.setValueAtTime(freq, actx.currentTime);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, actx.currentTime + dur);
    g.gain.value = vol;
    src.connect(f).connect(g).connect(actx.destination);
    src.start();
  }
  const sfx = {
    bounce: () => tone(480, 0.13, 'sine', 0.22, 240),
    pass: (s) => tone(380 + Math.min(s, 10) * 70, 0.09, 'triangle', 0.13),
    fire: () => {
      tone(110, 0.7, 'sine', 0.35, 38);
      noise(0.9, 0.35, 300, 5000, 'bandpass');
      tone(220, 0.5, 'sawtooth', 0.07, 880);
      noise(0.5, 0.15, 6000, 2000, 'highpass');
    },
    smash: () => { noise(0.35, 0.5, 1800, 300); tone(150, 0.25, 'square', 0.1, 50); },
    fireOut: () => noise(0.45, 0.12, 7000, 2500, 'highpass'),
    die: () => { noise(0.6, 0.45, 900, 120); tone(330, 0.7, 'sawtooth', 0.14, 40); tone(70, 0.6, 'sine', 0.3, 30); },
    star: () => [1320, 1760, 2093].forEach((f, i) => tone(f, 0.18, 'sine', 0.13, null, i * 0.05)),
    stage: () => { noise(0.8, 0.2, 400, 4000, 'bandpass'); [392, 523, 659, 784].forEach((f, i) => tone(f, 0.3, 'triangle', 0.15, null, i * 0.07)); },
    clear: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.18, null, i * 0.09)),
    pop: () => noise(0.25, 0.25, 2500, 600),
  };
  function setMuted(m) {
    muted = m;
    store.set('muted', m);
    ui.mute.textContent = m ? '🔇' : '🔊';
  }
  setMuted(muted);

  // ---------- Game events ----------
  function setFire(on) {
    fire = on;
    fuel = on ? FIRE_TIME : 0;
    ui.fire.classList.toggle('hidden', !on);
  }

  // The big power-up moment: impact frame, freeze, snap zoom, focus lines, burst, title slam.
  function igniteFireball() {
    setFire(true);
    const at = ballPos();
    impactFrame(false);
    slowMo(0.2, 0.34);
    fovKick = 12;
    rollKick = 0.14;
    caPulse = 1.4;
    shake = Math.max(shake, 0.45);
    focusV = 1;
    flash('radial-gradient(circle at 50% 55%, #fff6cc, #ff8a2a 45%, #ff3d00)', 0.55);
    impact(at, 0xffe14d, 3.2, 0.3);
    ring(at, hdr(1.7, 0.8, 0.2), 0.3, 3.8, 0.45);
    spray({ sprite: sparkleTex, colors: SPARK_COLORS, count: 34, at, speed: 11, life: 0.7, gravity: 6, drag: 2, scale: [0.3, 0.7] });
    sfx.fire();
    popup('FIREBALL!', 'fireban', true);
  }

  function extinguish() {
    setFire(false);
    streak = 0;
    sfx.fireOut();
    const at = ballPos();
    for (let i = 0; i < 6; i++) {
      const puff = inked(new THREE.Mesh(geos.chip, toon({ color: 0x8a8a9c, transparent: true })), null, 1.25);
      puff.position.set(at.x + rnd(-0.3, 0.3), at.y + rnd(0, 0.5), at.z + rnd(-0.3, 0.3));
      puff.scale.setScalar(rnd(2, 3.2));
      scene.add(puff);
      addFx(puff, { vel: new THREE.Vector3(rnd(-0.8, 0.8), rnd(1.5, 3), rnd(-0.8, 0.8)), life: rnd(0.5, 0.8), mats: [puff.material], shrink: true });
    }
    popup('fzzt', 'small');
  }

  function collectStar(p) {
    p.group.remove(p.star.mesh);
    p.star = null;
    starsGot++;
    const at = ballPos();
    spray({ sprite: sparkleTex, colors: GOLD_COLORS, count: 22, at, speed: 6, life: 0.6, gravity: 2, drag: 2.5, scale: [0.3, 0.6] });
    ring(at, hdr(1.5, 1.25, 0.35), 0.2, 1.8, 0.4);
    impact(at, 0xfff2a0, 1.6, 0.16);
    flash('#ffd23f', 0.12);
    caPulse = Math.max(caPulse, 0.4);
    sfx.star();
    popup('★', 'star');
  }

  function checkStar(p) {
    if (!p.star) return;
    let d = Math.abs(ballLocalAngle(p) - p.star.angle);
    d = Math.min(d, TAU - d);
    if (d <= STAR_TOL) collectStar(p);
  }

  function advanceDepth() {
    depth++;
    const s = Math.floor(depth / STAGE_LEN) + 1;
    if (s !== stage) {
      stage = s;
      applyTheme(stage - 1, false);
      popup('STAGE ' + stage + '!', 'stage', true);
      flash('#' + new THREE.Color(theme.ball).getHexString(), 0.35);
      ring(new THREE.Vector3(0, ball.y, 0), hdr(1.3, 1.3, 1.3), 1, 9, 0.8);
      focusV = Math.max(focusV, 0.7);
      caPulse = Math.max(caPulse, 0.8);
      sfx.stage();
    }
  }

  function passPlatform(p) {
    streak++;
    checkStar(p);
    const pts = 10 * streak;
    if (mode === 'endless') advanceDepth(); else score += pts;
    sfx.pass(streak);
    if (fire) {
      fuel = Math.min(FIRE_TIME, fuel + FIRE_REFILL);
      if (mode === 'levels') popup('+' + pts, 'big');
    } else if (streak >= FIRE_STREAK) {
      igniteFireball();
    } else if (mode === 'levels') {
      popup('+' + pts, streak > 1 ? 'gold' : '');
    }
  }

  function smash(p) {
    if (p.star) collectStar(p);             // crashing through a platform grabs its star too
    smashPlatform(p);
    streak++;
    if (mode === 'endless') advanceDepth(); else score += 25;
    ball.vy *= 0.5;
    const at = ballPos();
    ring(new THREE.Vector3(0, p.y, 0), hdr(1.7, 0.8, 0.2), 1, 5.2, 0.45);
    impact(at, 0xffa040, 2.4, 0.18);
    spray({ sprite: sparkleTex, colors: SPARK_COLORS, count: 22, at, speed: 12, life: 0.6, gravity: 10, drag: 1.5, scale: [0.3, 0.6], flat: true });
    flash('#ff8a2a', 0.18);
    caPulse = Math.max(caPulse, 0.6);
    fovKick = Math.max(fovKick, 3);
    shake = Math.max(shake, 0.4);
    sfx.smash();
    popup(pick(SFX_WORDS.smash) + (mode === 'levels' ? ' +25' : ''), 'big');
  }

  function bounce(p) {
    const top = p.y + PLAT_H / 2;
    ball.y = top + BALL_R;
    ball.vy = BOUNCE_V;
    ball.squash = 1;
    streak = 0;
    addSplat(p);
    const at = new THREE.Vector3(0, top + 0.03, BALL_Z);
    ring(at, ballColor.clone().multiplyScalar(1.3), 0.25, 1.1, 0.3);
    if (state === 'play') {
      impact(at.clone().setY(top + 0.15), 0xffffff, 0.9, 0.1);
      spray({ geo: geos.chip, colors: [ballColor.clone()], count: 5, at, speed: 3.5, life: 0.4, gravity: 18, scale: [0.4, 0.8], up: 0.6 });
      if (Math.random() < 0.3) popup(pick(SFX_WORDS.bounce), 'small');
    }
    sfx.bounce();
  }

  function die() {
    state = 'dead';
    setFire(false);
    ball.visible = false;
    ballMesh.visible = false;
    const at = ballPos();
    impactFrame(true);
    spray({ geo: geos.chip, colors: [ballColor.clone()], count: 24, at, speed: 7, life: 1.1, gravity: 16, scale: [0.6, 1.4] });
    spray({ sprite: sparkleTex, colors: [hdr(3, 0.5, 0.4), hdr(2.6, 2, 1.6)], count: 20, at, speed: 9, life: 0.6, gravity: 4, drag: 2, scale: [0.3, 0.6] });
    impact(at, 0xff5060, 3, 0.25);
    ring(at, hdr(1.6, 0.25, 0.25), 0.2, 4.5, 0.55);
    flash('#ff2040', 0.4);
    slowMo(0.25, 0.5);
    caPulse = 1.6;
    fovKick = -4;
    rollKick = -0.1;
    focusV = 0.8;
    shake = 0.7;
    sfx.die();
    popup('OUCH!', 'ouch', true);
    if (mode === 'endless' && depth > bestDepth) {
      bestDepth = depth;
      newBest = true;
      store.set('bestDepth', bestDepth);
    }
    const id = runId;
    setTimeout(() => { if (id === runId) showResult('dead'); }, 1000);
  }

  function fireworks(id) {
    const palette = [[hdr(3, 0.8, 1.6), hdr(2.8, 2.6, 2.4)], [hdr(0.8, 2.2, 3.2), hdr(2.6, 2.8, 3)], [hdr(3.2, 2.6, 0.5), hdr(3, 1.2, 0.3)], [hdr(1, 3, 1.2), hdr(2.6, 3, 2.4)]];
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        if (id !== runId) return;
        const at = new THREE.Vector3(rnd(-3.2, 3.2), ball.y + rnd(2.5, 5), rnd(-1, 2.5));
        spray({ sprite: sparkleTex, colors: palette[i % palette.length], count: 30, at, speed: 7, life: 1.1, gravity: 4, drag: 1.2, scale: [0.3, 0.55] });
        impact(at, 0xffffff, 1.2, 0.12);
        sfx.pop();
      }, 150 + i * 220);
    }
  }

  function finishLevel(p) {
    bounce(p);
    if (state !== 'play') return;
    setFire(false);
    state = 'clear';
    const bonus = 50 * level;
    score += bonus;
    popup('CLEAR! +' + bonus, 'gold');
    spray({ geo: geos.confetti, colors: [0xffffff, theme.ball, theme.safe, 0xff5f8f], count: 50, at: ballPos().setY(ball.y + 0.2), speed: 8, life: 1.8, gravity: 9, scale: [0.8, 1.2] });
    ring(new THREE.Vector3(0, p.y + PLAT_H, 0), hdr(1.3, 1.3, 1.3), 1, 7, 0.8);
    flash('#ffffff', 0.3);
    focusV = 0.8;
    fireworks(runId);
    sfx.clear();
    if (starsGot > (starsByLevel[level] || 0)) {
      starsByLevel[level] = starsGot;
      store.set('stars', starsByLevel);
    }
    if (level + 1 > unlocked) {
      unlocked = level + 1;
      store.set('level', unlocked);
    }
    const id = runId;
    setTimeout(() => { if (id === runId) showResult('clear'); }, 1300);
  }

  // ---------- Physics ----------
  function step(dt) {
    time += dt;
    ball.vy = Math.max(ball.vy - GRAVITY * dt, -MAX_FALL);
    ball.y += ball.vy * dt;

    if (fire) {
      fuel -= dt;
      if (fuel <= 0) extinguish();
    }

    while (nextIdx < platforms.length) {
      const p = platforms[nextIdx];
      const top = p.y + PLAT_H / 2;
      if (ball.y - BALL_R > top) break;

      if (p.finish) { finishLevel(p); break; }
      if (state !== 'play') { bounce(p); break; }   // menu backdrop: just bounce

      const type = p.types[segmentUnderBall(p)];
      if (type === GAP) { nextIdx++; passPlatform(p); continue; }
      if (fire) { nextIdx++; smash(p); continue; }
      if (type === HAZ) { die(); return; }
      bounce(p);
      break;
    }
  }

  // ---------- HUD ----------
  const starRow = (n, of = STARS_PER_LEVEL) => {
    let s = '';
    for (let i = 0; i < of; i++) s += `<span class="st${i < n ? ' on' : ''}">★</span>`;
    return s;
  };

  const hudCache = {};
  function setText(el, key, value, html) {
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    if (html) el.innerHTML = value; else el.textContent = value;
  }

  function updateHud(force) {
    if (force) for (const k in hudCache) delete hudCache[k];
    if (mode === 'levels') {
      setText(ui.lvCur, 'cur', level);
      setText(ui.lvNext, 'next', level + 1);
      setText(ui.barLabel, 'label', '');
      setText(ui.score, 'score', score);
      setText(ui.best, 'best', '');
      setText(ui.hudStars, 'stars', starRow(starsGot), true);
      ui.prog.style.width = Math.min(100, (nextIdx / Math.max(1, platforms.length - 1)) * 100) + '%';
    } else {
      setText(ui.lvCur, 'cur', stage);
      setText(ui.lvNext, 'next', stage + 1);
      setText(ui.barLabel, 'label', 'STAGE ' + stage + '  ·  ' + (STAGE_LEN - (depth % STAGE_LEN)) + ' TO NEXT');
      setText(ui.score, 'score', depth);
      setText(ui.best, 'best', 'BEST ' + Math.max(bestDepth, depth));
      setText(ui.hudStars, 'stars', '', true);
      ui.prog.style.width = ((depth % STAGE_LEN) / STAGE_LEN) * 100 + '%';
    }
  }

  function setHudVisible(on) {
    ui.hud.classList.toggle('off', !on);
    ui.homeBtn.classList.toggle('off', !on);
  }

  // ---------- Screens ----------
  let primaryAction = null;

  function showPanel(name) {
    for (const [k, el] of Object.entries(panels)) el.classList.toggle('hidden', k !== name);
    ui.overlay.dataset.panel = name;
    ui.overlay.classList.remove('hidden');
  }

  function goHome() {
    mode = 'levels';
    level = unlocked;
    build();
    state = 'menu';
    setHudVisible(false);
    const stars = totalStars();
    ui.levelsSub.textContent = 'Level ' + unlocked + (stars ? '  ·  ★ ' + stars : '');
    ui.endlessSub.textContent = bestDepth ? 'Best depth ' + bestDepth : 'How deep can you go?';
    primaryAction = () => startLevel(unlocked);
    showPanel('home');
  }

  function openLevels() {
    const shown = Math.max(20, Math.ceil((unlocked + 1) / 10) * 10);
    ui.grid.innerHTML = '';
    let current = null;
    for (let n = 1; n <= shown; n++) {
      const tile = document.createElement('button');
      const locked = n > unlocked;
      tile.className = 'tile' + (locked ? ' locked' : '') + (n === unlocked ? ' next' : '');
      tile.innerHTML = locked
        ? `<span class="n">🔒</span><span class="ts">${n}</span>`
        : `<span class="n">${n}</span><span class="ts">${starRow(starsByLevel[n] || 0)}</span>`;
      if (!locked) tile.addEventListener('click', () => startLevel(n));
      else tile.disabled = true;
      if (n === unlocked) current = tile;
      ui.grid.appendChild(tile);
    }
    ui.starTotal.textContent = '★ ' + totalStars();
    primaryAction = () => startLevel(unlocked);
    showPanel('levels');
    if (current) current.scrollIntoView({ block: 'center' });
  }

  function startRun(newMode, n) {
    ensureAudio();
    mode = newMode;
    if (n) level = n;
    build();
    state = 'play';
    ui.overlay.classList.add('hidden');
    setHudVisible(true);
  }
  const startLevel = (n) => startRun('levels', n);
  const startEndless = () => startRun('endless');

  function setButtons(list) {
    ui.rButtons.innerHTML = '';
    list.forEach((b, i) => {
      const el = document.createElement('button');
      el.className = 'btn ' + (i === 0 ? 'primary' : 'ghost');
      el.textContent = b.label;
      el.addEventListener('click', () => { ensureAudio(); b.fn(); });
      ui.rButtons.appendChild(el);
      if (i === 0) ui.rButtons.appendChild(Object.assign(document.createElement('div'), { className: 'row-break' }));
    });
    primaryAction = list[0].fn;
  }

  function showResult(kind) {
    ui.rStars.innerHTML = '';
    ui.rBig.textContent = '';
    ui.rStats.className = '';
    if (kind === 'dead' && mode === 'endless') {
      ui.rTitle.innerHTML = '<span class="crash">CRASHED</span>';
      ui.rBig.textContent = depth;
      ui.rText.textContent = 'platforms deep  ·  stage ' + stage;
      ui.rStats.textContent = newBest ? 'NEW BEST!' : 'Best ' + bestDepth;
      if (newBest) ui.rStats.className = 'newbest';
      setButtons([{ label: 'RETRY', fn: startEndless }, { label: 'HOME', fn: goHome }]);
    } else if (kind === 'dead') {
      ui.rTitle.innerHTML = '<span class="crash">CRASHED</span>';
      ui.rText.textContent = 'Reach the bottom of level ' + level + ' without crashing to pass it.';
      ui.rStats.textContent = '';
      setButtons([
        { label: 'RETRY', fn: () => startLevel(level) },
        { label: 'LEVELS', fn: openLevels },
        { label: 'HOME', fn: goHome },
      ]);
    } else {
      ui.rTitle.innerHTML = 'LEVEL ' + level + '<br><span class="crash">CLEARED</span>';
      ui.rStars.innerHTML = starRow(starsGot);
      ui.rText.textContent = starsGot === STARS_PER_LEVEL
        ? 'Perfect! You got every star.'
        : 'Grab all ' + STARS_PER_LEVEL + ' stars for a perfect clear. Fireball smashes collect them too.';
      ui.rStats.textContent = 'Score ' + score;
      setButtons([
        { label: 'NEXT', fn: () => startLevel(level + 1) },
        { label: 'RETRY', fn: () => startLevel(level) },
        { label: 'LEVELS', fn: openLevels },
      ]);
    }
    showPanel('result');
  }

  ui.btnLevels.addEventListener('click', () => { ensureAudio(); openLevels(); });
  ui.btnEndless.addEventListener('click', () => startEndless());
  ui.levelsBack.addEventListener('click', () => goHome());
  ui.homeBtn.addEventListener('click', () => goHome());
  ui.mute.addEventListener('click', () => { ensureAudio(); setMuted(!muted); });

  // ---------- Input ----------
  const keys = new Set();
  let dragging = false, lastX = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    canvas.setPointerCapture(e.pointerId);
    ensureAudio();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    if (state === 'play') towerRot += dx * DRAG_SPEED;
  });
  const endDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  addEventListener('keydown', (e) => {
    keys.add(e.code);
    const menuOpen = !ui.overlay.classList.contains('hidden');
    if ((e.code === 'Space' || e.code === 'Enter') && menuOpen && primaryAction) {
      e.preventDefault();
      ensureAudio();
      primaryAction();
    }
    if (e.code === 'Escape' && (state === 'play' || ui.overlay.dataset.panel !== 'home')) goHome();
    if (e.code === 'KeyM') { ensureAudio(); setMuted(!muted); }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // ---------- Resize ----------
  let camDist = 9.5, camHeight = 5.2;
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Pull back on narrow (portrait) screens so the full tower stays in view.
    const narrow = Math.max(0, Math.min(1, (1.1 - camera.aspect) / 0.6));
    camDist = 9.5 + narrow * 4.5;
    camHeight = 5.2 + narrow * 2.5;
    camera.updateProjectionMatrix();
    const pr = renderer.getPixelRatio();
    skyMat.uniforms.uAspect.value = camera.aspect;
    skyMat.uniforms.uDot.value = 7 * pr;
    const inkScale = Math.min(pr, 1.5);
    ui.ink.width = Math.floor(w * inkScale);
    ui.ink.height = Math.floor(h * inkScale);
    inkDrawn = true;
    if (post) post.setSize(Math.floor(w * pr), Math.floor(h * pr), pr);
  }
  addEventListener('resize', resize);
  resize();

  // Drop to the light renderer if the device can't keep up (unless ?fx=high).
  let perfSum = 0, perfN = 0;
  function watchPerformance(frameSeconds) {
    if (!fxOn || FX_PARAM === 'high' || state !== 'play') return;
    perfSum += frameSeconds;
    if (++perfN < 120) return;
    if (perfSum / perfN > 1 / 32) {
      fxOn = false;
      renderer.setPixelRatio(Math.min(maxDpr, 1.5));
      resize();
    }
    perfSum = 0;
    perfN = 0;
  }

  // ---------- Effects on twos ----------
  function stepEffects(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        scene.remove(d.obj);
        if (d.mats) for (const m of d.mats) m.dispose();
        debris.splice(i, 1);
        continue;
      }
      if (d.drag) d.vel.multiplyScalar(Math.max(0, 1 - d.drag * dt));
      d.vel.y -= d.gravity * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      if (d.spin) {
        d.obj.rotation.x += d.spin.x * dt;
        d.obj.rotation.y += d.spin.y * dt;
        d.obj.rotation.z += d.spin.z * dt;
      }
      const k = d.life / d.max;
      if (d.mats) for (const m of d.mats) {
        if (!d.hold) m.opacity = d.grow ? d.opacity * Math.min(1, k * 1.5) : d.opacity * Math.min(1, k * 1.6);
        if (d.hot && m.emissive) m.emissiveIntensity = 3 * k * k;
        if (d.boil && m.map) { m.map = d.boil[rand(d.boil.length)]; m.rotation += rnd(-0.25, 0.25); }
      }
      if (d.shrink) d.obj.scale.setScalar(d.s0 * k);
      if (d.grow) d.obj.scale.setScalar(d.grow[0] + (d.grow[1] - d.grow[0]) * (1 - Math.pow(k, 3)));
    }
  }

  // ---------- Main loop ----------
  let last = performance.now();
  let acc = 0;
  let twosAcc = 0, threesAcc = 0;
  let shakeX = 0, shakeY = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const frameSeconds = (now - last) / 1000;
    const rawDt = Math.min(0.05, frameSeconds);
    last = now;
    watchPerformance(frameSeconds);

    // Slow-motion: hold, then ease back to full speed.
    if (slowT > 0) { slowT -= rawDt; timeScale = slowScale; } else timeScale += (1 - timeScale) * Math.min(1, rawDt * 6);
    const dt = rawDt * timeScale;
    fxTime += dt;

    // Stepped clocks: effects tick on twos, line boil and pulses on threes.
    twosAcc += dt;
    const twos = twosAcc >= ON_TWOS;
    const twosDt = twosAcc;
    if (twos) twosAcc = 0;
    threesAcc += rawDt;
    const threes = threesAcc >= ON_THREES;
    if (threes) threesAcc = 0;

    if (state === 'play') {
      if (keys.has('ArrowLeft') || keys.has('KeyA')) towerRot -= KEY_SPEED * rawDt;
      if (keys.has('ArrowRight') || keys.has('KeyD')) towerRot += KEY_SPEED * rawDt;
    } else if (state === 'menu') {
      towerRot += rawDt * 0.35;                    // slow showcase spin behind the menus
    }

    // Gameplay on ones.
    if (state !== 'dead') {
      acc += dt;
      while (acc >= STEP) { step(STEP); acc -= STEP; if (state === 'dead') break; }
    } else {
      time += dt;
    }

    if (mode === 'endless') {
      endlessFill();
      pole.position.y = camY - 40;
    }
    blendTheme(1 - Math.exp(-rawDt * 3));

    // Tower, spinning platforms, stars (stars turn on twos)
    tower.rotation.y = towerRot;
    for (const p of platforms) {
      if (p.spin && !p.smashed) p.group.rotation.y = platformRot(p);
      if (p.star && twos) {
        p.star.mesh.rotation.y = Math.floor(fxTime * 12) / 12 * 3;
        p.star.mesh.position.y = PLAT_H / 2 + 0.6 + Math.sin(Math.floor(fxTime * 12) / 12 * 4) * 0.08;
      }
    }
    if (threes) mats.sparkle.rotation += 0.4;

    // Fireball intensity (with a warm-up aura when one gap away)
    const heatTarget = fire ? 1 : (state === 'play' && streak === FIRE_STREAK - 1 ? 0.35 : 0);
    fireAmt += (heatTarget - fireAmt) * Math.min(1, rawDt * (heatTarget > fireAmt ? 12 : 5));
    if (!ball.visible) fireAmt = 0;

    // Ball on ones: squash on bounce, stretch when falling fast
    ball.squash = Math.max(0, ball.squash - dt * 7);
    const sq = Math.sin(ball.squash * Math.PI) * 0.3;
    const stretch = Math.min(0.22, Math.max(0, -ball.vy - 8) * 0.018);
    ballMesh.position.set(0, ball.y - sq * BALL_R * 0.5, BALL_Z);
    ballMesh.scale.set((1 + sq * 0.6) * (1 - stretch * 0.4), (1 - sq) * (1 + stretch), (1 + sq * 0.6) * (1 - stretch * 0.4));
    mats.ball.emissiveIntensity = fireAmt * 1.6;
    mats.ball.color.copy(ballColor).lerp(fireColor, Math.min(1, fireAmt * 1.2));

    // Smear frame behind the ball when it moves fast.
    const falling = Math.max(0, -ball.vy - 9) * 0.1, rising = Math.max(0, ball.vy - 9) * 0.06;
    const smearLen = ball.visible && state !== 'menu' ? Math.min(1.6, falling || rising) : 0;
    smear.visible = smearLen > 0.05;
    if (smear.visible) {
      smear.position.copy(ballMesh.position);
      smear.scale.set(1, falling ? smearLen : -smearLen, 1);
      if (twos) smearMat.uniforms.uSeed.value = Math.random();
    }

    if (twos && ball.visible && state === 'play') {
      if (fire) fireTrail();
      else if (ball.vy < -13) multiples();
    }
    if (fire) ui.fuel.style.width = Math.max(0, (fuel / FIRE_TIME) * 100) + '%';

    // Fire aura (flicker on twos), fire light, speed lines
    flames.visible = fireAmt > 0.03;
    if (flames.visible) {
      flames.position.copy(ballMesh.position);
      const steppedTime = Math.floor(fxTime * 12) / 12;
      for (const f of [flameInner, flameOuter]) {
        f.material.uniforms.uTime.value = steppedTime;
        f.material.uniforms.uAmt.value = fireAmt;
      }
    }
    fireLight.position.set(0, ball.y + 0.2, BALL_Z + 0.4);
    if (twos) fireLight.intensity = fireAmt * (0.8 + Math.random() * 0.4);
    speedLines.visible = fire && fireAmt > 0.05;
    if (speedLines.visible && twos) {
      speedLines.material.opacity = fireAmt * 0.7;
      lineData.forEach((d, i) => {
        d.y += d.v * twosDt;
        if (d.y > 8) { d.y -= 18; d.a = Math.random() * TAU; }
        _v.set(Math.sin(d.a) * d.r, ball.y + d.y, Math.cos(d.a) * d.r);
        _s.set(1, d.len, 1);
        speedLines.setMatrixAt(i, _m.compose(_v, _q.identity(), _s));
      });
      speedLines.instanceMatrix.needsUpdate = true;
    }

    // Hazard pulse on threes
    if (threes) {
      const pulse = Math.floor(fxTime * 8) % 2;
      mats.haz.emissiveIntensity = 0.45 + pulse * 0.45;
      mats.spike.emissiveIntensity = 0.8 + pulse * 0.7;
    }

    // Effects and hand-drawn overlays on twos
    if (twos) {
      stepEffects(twosDt);
      const focus = Math.max(focusV, fire ? 0.35 * fireAmt : 0);
      if (focus > 0.02 || inkDrawn) drawFocusLines(focus, fire && focusV < 0.4 ? 'rgba(255,245,215,0.75)' : 'rgba(21,10,34,0.85)');
    }
    focusV = Math.max(0, focusV - rawDt * 1.6);

    // Dust motes drift up through the world and wrap around the camera.
    const mp = moteGeo.attributes.position.array;
    for (let i = 0; i < MOTES; i++) {
      const m = moteData[i];
      m.y += m.s * dt;
      const y = camY + 16 - ((((camY + 16 - m.y) % 44) + 44) % 44);
      const a = m.a + fxTime * 0.02;
      mp[i * 3] = Math.sin(a) * m.r;
      mp[i * 3 + 1] = y;
      mp[i * 3 + 2] = Math.cos(a) * m.r;
    }
    moteGeo.attributes.position.needsUpdate = true;

    // Camera on ones; shake and Dutch tilt are held on twos for a hand-keyed feel.
    if (ball.y < camY) camY += (ball.y - camY) * (1 - Math.exp(-rawDt * 9));
    shake = Math.max(0, shake - rawDt * 1.6);
    if (twos) {
      const sh = shake + (fire ? fireAmt * 0.06 : 0);
      shakeX = (Math.random() - 0.5) * sh * 0.5;
      shakeY = (Math.random() - 0.5) * sh * 0.5;
    }
    camera.position.set(shakeX, camY + camHeight + shakeY, camDist);
    camera.lookAt(0, camY - 1.4, 0);
    rollKick *= Math.exp(-rawDt * 4);
    camera.rotateZ(rollKick + (fire ? fireAmt * 0.045 : 0));
    fovKick *= Math.exp(-rawDt * 5);
    const fov = BASE_FOV + fovKick + (fire ? fireAmt * 6 : 0);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }

    sun.position.set(2.5, ball.y + 9, BALL_Z + 3);
    sun.target.position.set(0, ball.y - 2, BALL_Z);

    // Screen-space: flash, heat glow, sky
    flashV = Math.max(0, flashV - rawDt * 2.6);
    ui.flash.style.opacity = flashV.toFixed(3);
    ui.heat.style.opacity = (fire ? fireAmt * (0.4 + 0.15 * (Math.floor(fxTime * 12) % 2)) : 0).toFixed(3);
    skyMat.uniforms.uTime.value = Math.floor(fxTime * 8) / 8;
    skyMat.uniforms.uScroll.value = camY * 0.004;
    skyMat.uniforms.uHeat.value = fire ? fireAmt : 0;

    if (state === 'play') updateHud();

    caPulse = Math.max(0, caPulse - rawDt * 3);
    if (fxOn) {
      post.uniforms.ca.value = caPulse + (fire ? fireAmt * 0.3 : 0);
      post.uniforms.strength.value = 0.45 + fireAmt * 0.2 + flashV * 0.3;
      post.render();
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  }

  // ---------- Debug hook (only with ?debug in the URL) ----------
  if (/[?&]debug\b/.test(location.search)) {
    window.ballCrash = {
      get state() {
        return { state, mode, level, unlocked, score, starsGot, depth, stage, streak, fire, fuel, nextIdx,
          total: platforms.length, ballY: ball.y, towerRot, panel: ui.overlay.dataset.panel, fxOn, fireAmt, timeScale,
          drawCalls: renderer.info.render.calls };
      },
      setRot(r) { towerRot = r; },
      platform(i) {
        const p = platforms[i];
        return p && { types: p.types, rot: platformRot(p), baseRot: p.baseRot, spin: p.spin, finish: p.finish,
          smashed: p.smashed, star: p.star ? p.star.angle : null };
      },
      settings: levelSettings,
      startLevel, startEndless, goHome, openLevels,
    };
  }

  // ---------- Boot ----------
  goHome();
  requestAnimationFrame(frame);
})();
