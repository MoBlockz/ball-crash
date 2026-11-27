/* Ball skins for Ball Crash.
 * Each skin is drawn on a canvas as a wrap-around (equirectangular) texture for the ball sphere.
 * Animal skins get a kawaii face with three expressions (normal, happy, fire) and small 3D extras
 * (ears, gills, frog eyes, beak) that game.js gives ink outlines. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const D = Math.PI / 180;
  const W = 512, H = 256;                // texture size (2:1 wraps evenly around a sphere)
  const FACE_LAT = 24 * D;               // face sits a little above the equator, toward the camera
  const S = 86;                          // face size in texture pixels
  const R = 0.3;                         // ball radius (matches BALL_R in game.js)

  const SKINS = [
    { id: 'classic', name: 'Classic', group: 'sports', glint: true },
    { id: 'panda', name: 'Panda', group: 'animals', color: '#f5f3f7', extras: 'panda',
      face: { patches: '#231a2b', nose: '#231a2b', mouth: 'w', blush: '#ff8db5' } },
    { id: 'axolotl', name: 'Axolotl', group: 'animals', color: '#ffb3d0', spots: '#f48fbb', extras: 'axolotl',
      face: { eye: '#3b1430', mouth: 'smile', blush: '#ff5c9d' } },
    { id: 'kitty', name: 'Kitty', group: 'animals', color: '#ffb45e', stripes: '#e7832a', extras: 'kitty',
      face: { mouth: 'w', nose: '#ff7d9c', whiskers: true, blush: '#ff8f9f' } },
    { id: 'frog', name: 'Froggy', group: 'animals', color: '#7fd85a', belly: '#cdf5a0', spots: '#5cb93d', extras: 'frog',
      face: { noEyes: true, mouth: 'smile', blush: '#ff8fa3' } },
    { id: 'chick', name: 'Chick', group: 'animals', color: '#ffe04a', belly: '#fff2a8', extras: 'chick',
      face: { mouth: 'none', blush: '#ff9e6b' } },
    { id: 'bunny', name: 'Bunny', group: 'animals', color: '#fff4f8', extras: 'bunny',
      face: { mouth: 'w', nose: '#ff8fb5', blush: '#ffa3c4' } },
    { id: 'football', name: 'Football', group: 'sports', color: '#f7f7f7', draw: 'football', spin: true, glint: true },
    { id: 'basketball', name: 'Basketball', group: 'sports', color: '#ee8a2b', draw: 'basketball', spin: true, glint: true },
    { id: 'tennis', name: 'Tennis', group: 'sports', color: '#d5ee3b', draw: 'tennis', spin: true },
    { id: 'baseball', name: 'Baseball', group: 'sports', color: '#f6f2e8', draw: 'baseball', spin: true, glint: true },
  ];

  // ---------- Sphere <-> texture helpers ----------
  // Ball-local direction: +z faces the camera, +y is up, +x is screen-right. lon 0 = front.
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const toXY = (lon, lat) => [W * (0.25 + lon / TAU), H * (0.5 - lat / Math.PI)];
  const dirXY = (d) => toXY(Math.atan2(d[0], d[2]), Math.asin(Math.max(-1, Math.min(1, d[1]))));
  const fromLonLat = (lon, lat) => [Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat)];
  const rnd = (a, b) => a + Math.random() * (b - a);

  // Path through sphere directions; unwrapped so it can cross the texture seam, drawn three times to cover it.
  function spherePath(g, dirs, closed, fill) {
    const pts = dirs.map(dirXY);
    if (closed) pts.push(pts[0].slice());
    for (let i = 1; i < pts.length; i++) {
      while (pts[i][0] - pts[i - 1][0] > W / 2) pts[i][0] -= W;
      while (pts[i][0] - pts[i - 1][0] < -W / 2) pts[i][0] += W;
    }
    for (const shift of [-W, 0, W]) {
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x + shift, y) : g.moveTo(x + shift, y)));
      if (fill) g.fill(); else g.stroke();
    }
  }

  // Points on a circle of angular radius rho around direction c.
  function circle(c, rho, n = 160) {
    c = norm(c);
    const e1 = norm(cross(c, Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const e2 = cross(c, e1);
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      out.push(add(c.map((v) => v * Math.cos(rho)), add(e1.map((v) => v * Math.cos(t)), e2, Math.sin(t)), Math.sin(rho)));
    }
    return out;
  }

  // Tennis / baseball seam: a closed curve wiggling up and down around the ball.
  function seam(k = 0.3, n = 240) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      out.push(norm([(1 - k) * Math.cos(t) + k * Math.cos(3 * t), 2 * Math.sqrt(k * (1 - k)) * Math.sin(2 * t), (1 - k) * Math.sin(t) - k * Math.sin(3 * t)]));
    }
    return out;
  }

  function speckle(g, count, colors, size) {
    for (let i = 0; i < count; i++) {
      g.fillStyle = colors[i % colors.length];
      g.fillRect(Math.random() * W, Math.random() * H, size, size);
    }
  }

  // Blob drawn at a lon/lat spot, stretched sideways so it looks round on the sphere.
  function spot(g, lon, lat, r, color) {
    const [x, y] = toXY(lon, lat);
    g.fillStyle = color;
    for (const shift of [-W, 0, W]) {
      g.beginPath();
      g.ellipse(x + shift, y, Math.min(r / Math.max(0.25, Math.cos(lat)), W / 4), r, 0, 0, TAU);
      g.fill();
    }
  }

  // ---------- Painters: the ball pattern under the face ----------
  const painters = {
    animal(g, s) {
      if (s.belly) spot(g, 0, -30 * D, 46, s.belly);
      if (s.spots) for (let i = 0; i < 26; i++) spot(g, rnd(95, 265) * D, rnd(-45, 65) * D, rnd(4, 9), s.spots);
      if (s.stripes) {
        g.strokeStyle = s.stripes;
        g.lineWidth = 11;
        for (const lon of [115, 145, 180, 215, 245]) {
          const dirs = [];
          for (let lat = 78; lat >= -30; lat -= 6) dirs.push(fromLonLat((lon + Math.sin(lat * 0.15) * 6) * D, lat * D));
          spherePath(g, dirs);
        }
        g.lineWidth = 7;
        for (const lon of [-13, 0, 13]) spherePath(g, [fromLonLat(lon * D, 66 * D), fromLonLat(lon * 0.8 * D, 52 * D)]);
      }
    },
    football(g) {
      const phi = (1 + Math.sqrt(5)) / 2;
      const verts = [];
      for (const a of [-1, 1]) for (const b of [-phi, phi]) verts.push([0, a, b], [a, b, 0], [b, 0, a]);
      g.fillStyle = '#1c1622';
      for (const v of verts) {
        const c = norm(v);
        const corners = circle(c, 0.33, 5);
        const dirs = [];
        corners.forEach((p, i) => {                                  // subdivide edges so they curve with the ball
          const q = corners[(i + 1) % 5];
          for (let k = 0; k < 8; k++) dirs.push(norm(add(p.map((x) => x * (1 - k / 8)), q, k / 8)));
        });
        spherePath(g, dirs, true, true);
      }
      g.strokeStyle = 'rgba(40,30,50,0.35)';
      g.lineWidth = 2;
      for (const v of verts) for (const p of circle(norm(v), 0.33, 5)) spherePath(g, [p, norm(add(p, norm(v), -0.45))]);
    },
    basketball(g) {
      speckle(g, 2600, ['rgba(120,50,10,0.35)', 'rgba(255,200,140,0.25)'], 2);
      g.strokeStyle = '#2a1408';
      g.lineWidth = 6;
      spherePath(g, circle([0, 1, 0], Math.PI / 2), true);
      spherePath(g, circle([1, 0, 0], Math.PI / 2), true);
      spherePath(g, circle([0, 0, 1], 0.95), true);
      spherePath(g, circle([0, 0, -1], 0.95), true);
    },
    tennis(g) {
      speckle(g, 5000, ['rgba(255,255,200,0.35)', 'rgba(120,150,0,0.25)'], 2);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 11;
      spherePath(g, seam(), true);
    },
    baseball(g) {
      speckle(g, 1200, ['rgba(180,160,130,0.2)'], 2);
      const pts = seam(0.28);
      g.strokeStyle = '#d9d0bf';
      g.lineWidth = 3;
      spherePath(g, pts, true);
      g.strokeStyle = '#d8262b';
      g.lineWidth = 3;
      for (let i = 0; i < pts.length; i += 4) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        const tangent = norm(add(q, p, -1));
        const side = norm(cross(p, tangent));
        for (const s of [-1, 1]) spherePath(g, [norm(add(p, side, s * 0.03)), norm(add(add(p, side, s * 0.085), tangent, 0.035))]);
      }
    },
  };

  // ---------- Kawaii face ----------
  function drawFace(g, f, expr) {
    const [cx, cy] = toXY(0, FACE_LAT);
    const ink = f.eye || '#2a1830';
    g.save();
    g.translate(cx, cy);
    g.scale(1 / Math.cos(FACE_LAT), 1);
    g.lineCap = g.lineJoin = 'round';
    const el = (x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fill(); };

    if (f.patches) {
      g.fillStyle = f.patches;
      for (const side of [-1, 1]) el(side * 0.36 * S, 0.04 * S, 0.24 * S, 0.31 * S, side * 0.45);
    }
    const lineInk = f.patches ? '#ffffff' : ink;
    if (!f.noEyes) {
      for (const side of [-1, 1]) {
        const ex = side * 0.36 * S, ey = 0;
        g.strokeStyle = lineInk;
        g.lineWidth = 0.075 * S;
        if (expr === 'happy') {                                       // ^ ^
          g.beginPath(); g.moveTo(ex - 0.15 * S, ey + 0.06 * S); g.quadraticCurveTo(ex, ey - 0.16 * S, ex + 0.15 * S, ey + 0.06 * S); g.stroke();
        } else if (expr === 'fire') {                                 // > <
          g.beginPath();
          g.moveTo(ex + side * 0.13 * S, ey - 0.13 * S); g.lineTo(ex - side * 0.12 * S, ey); g.lineTo(ex + side * 0.13 * S, ey + 0.13 * S);
          g.stroke();
        } else {                                                      // big shiny eyes
          g.fillStyle = f.patches ? '#120a18' : ink;
          el(ex, ey, 0.13 * S, 0.17 * S);
          if (f.patches) { g.strokeStyle = '#ffffff'; g.lineWidth = 0.02 * S; g.beginPath(); g.ellipse(ex, ey, 0.14 * S, 0.18 * S, 0, 0, TAU); g.stroke(); }
          g.fillStyle = '#ffffff';
          el(ex - 0.045 * S, ey - 0.06 * S, 0.055 * S, 0.06 * S);
          el(ex + 0.05 * S, ey + 0.065 * S, 0.026 * S, 0.026 * S);
        }
      }
    }
    if (f.blush) {
      g.globalAlpha = 0.6;
      g.fillStyle = f.blush;
      for (const side of [-1, 1]) el(side * 0.56 * S, 0.2 * S, 0.12 * S, 0.07 * S);
      g.globalAlpha = 0.8;
      g.strokeStyle = f.blush;
      g.lineWidth = 0.022 * S;
      for (const side of [-1, 1]) for (let k = -1; k <= 1; k++) {
        const x = side * 0.56 * S + k * 0.055 * S;
        g.beginPath(); g.moveTo(x + 0.02 * S, 0.16 * S); g.lineTo(x - 0.02 * S, 0.24 * S); g.stroke();
      }
      g.globalAlpha = 1;
    }
    if (f.nose) { g.fillStyle = f.nose; el(0, 0.13 * S, 0.05 * S, 0.035 * S); }

    g.strokeStyle = ink;
    g.lineWidth = 0.04 * S;
    if (expr === 'fire' && f.mouth !== 'none') {                      // excited open mouth
      g.fillStyle = '#6a1a3a';
      g.beginPath(); g.moveTo(-0.12 * S, 0.19 * S); g.quadraticCurveTo(0, 0.46 * S, 0.12 * S, 0.19 * S); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ff7aa0';
      el(0, 0.31 * S, 0.055 * S, 0.035 * S);
    } else if (f.mouth === 'w') {                                     // ω
      g.beginPath(); g.arc(-0.05 * S, 0.2 * S, 0.05 * S, 0, Math.PI); g.stroke();
      g.beginPath(); g.arc(0.05 * S, 0.2 * S, 0.05 * S, 0, Math.PI); g.stroke();
    } else if (f.mouth === 'smile') {
      const r = expr === 'happy' ? 0.2 : 0.16;
      g.beginPath(); g.arc(0, 0.1 * S, r * S, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    }
    if (f.whiskers) {
      g.lineWidth = 0.025 * S;
      for (const side of [-1, 1]) for (let k = -1; k <= 1; k++) {
        g.beginPath(); g.moveTo(side * 0.5 * S, 0.12 * S + k * 0.05 * S); g.lineTo(side * 0.82 * S, 0.08 * S + k * 0.1 * S); g.stroke();
      }
    }
    g.restore();
  }

  // ---------- Textures ----------
  const cache = {};
  function textures(s) {
    if (!s.color) return null;                                        // Classic uses the level's colour
    if (cache[s.id]) return cache[s.id];
    const base = document.createElement('canvas');
    base.width = W; base.height = H;
    const g = base.getContext('2d');
    g.lineCap = g.lineJoin = 'round';
    g.fillStyle = s.color;
    g.fillRect(0, 0, W, H);
    painters[s.draw || 'animal'](g, s);
    const out = {};
    for (const expr of s.face ? ['normal', 'happy', 'fire'] : ['normal']) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const cg = c.getContext('2d');
      cg.drawImage(base, 0, 0);
      if (s.face) drawFace(cg, s.face, expr);
      const t = new THREE.CanvasTexture(c);
      t.encoding = THREE.sRGBEncoding;
      t.anisotropy = 4;
      out[expr] = t;
    }
    cache[s.id] = out;
    return out;
  }

  // ---------- 3D extras ----------
  // kit: { toon(colorHex) -> material, inked(mesh, scale) -> mesh with outline }
  function extras(s, kit) {
    const g = new THREE.Group();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = (lat, lon) => new THREE.Vector3(Math.sin(lon * D) * Math.cos(lat * D), Math.sin(lat * D), Math.cos(lon * D) * Math.cos(lat * D));
    const place = (mesh, lat, lon, out) => {
      const d = dir(lat, lon);
      mesh.position.copy(d).multiplyScalar(R * out);
      mesh.quaternion.setFromUnitVectors(up, d);
      g.add(kit.inked(mesh, 1.16));
      return mesh;
    };
    const M = (geo, color) => new THREE.Mesh(geo, kit.toon(color));
    switch (s.extras) {
      case 'panda':
        for (const side of [-1, 1]) place(M(new THREE.SphereGeometry(0.085, 16, 12), 0x231a2b), 54, side * 40, 0.97);
        break;
      case 'kitty':
        for (const side of [-1, 1]) place(M(new THREE.ConeGeometry(0.085, 0.17, 12), 0xffb45e), 56, side * 36, 1.05);
        break;
      case 'bunny':
        for (const side of [-1, 1]) {
          place(M(new THREE.CapsuleGeometry(0.05, 0.2, 4, 12), 0xfff4f8), 74, side * 26, 1.5);
          const inner = M(new THREE.CapsuleGeometry(0.028, 0.15, 4, 10), 0xff9fc2);
          place(inner, 74, side * 26, 1.5).position.z += 0.035;
        }
        break;
      case 'axolotl':
        for (const side of [-1, 1]) {
          for (const [lat, len] of [[50, 0.15], [24, 0.17], [-2, 0.14]]) {
            place(M(new THREE.ConeGeometry(0.032, len, 8), 0xff5fa2), lat, side * 80, (R + len / 2 - 0.02) / R);
          }
        }
        break;
      case 'frog':
        for (const side of [-1, 1]) {
          const eye = place(M(new THREE.SphereGeometry(0.085, 18, 14), 0xffffff), 48, side * 28, 0.92);
          const front = new THREE.Vector3(0, 0.35, 1).normalize();
          const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 10), kit.toon(0x1c1622));
          pupil.position.copy(eye.position).addScaledVector(front, 0.07);
          g.add(pupil);
          const shine = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
          shine.position.copy(pupil.position).add(new THREE.Vector3(-0.012, 0.016, 0.034));
          g.add(shine);
        }
        break;
      case 'chick':
        place(M(new THREE.ConeGeometry(0.05, 0.11, 12), 0xff9a1f), 12, 0, (R + 0.035) / R);
        for (const lon of [-28, 0, 28]) place(M(new THREE.ConeGeometry(0.022, 0.09, 8), 0xffe04a), 84, lon, 1.12);
        break;
      default:
        break;
    }
    return g;
  }

  window.BallSkins = { list: SKINS, textures, extras };
})();
