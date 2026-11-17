/* «Оборона» 3D scene (v2.37): a low-poly valley with the road, stone pads, towers, Ink Blots and effects.
   It only renders the simulation in defense.js (sync(game) every frame). Bundled into vendor/defense3d.js:
     esbuild tools/defense3d.src.js --bundle --minify --format=iife --global-name=VMDefense3D \
       --alias:three=<three.js r187>/build/three.module.js --outfile=vendor/defense3d.js */
import * as THREE from 'three';

const THEMES = {
  day: { sky: ['#77b3ea', '#e8f3d8'], grass: 0x86b85e, grass2: 0x76a852, road: 0xd2ad72, sun: 0xfff0d0, sunI: 2.6, hemi: 1.4, fog: 0xdcedd2 },
  golden: { sky: ['#e88a5a', '#ffe0a8'], grass: 0xb9b65e, grass2: 0xa8a64e, road: 0xd8b07a, sun: 0xffc890, sunI: 2.7, hemi: 1.3, fog: 0xffdcb0 },
  night: { sky: ['#0e1638', '#34407a'], grass: 0x3d6a52, grass2: 0x355e48, road: 0x8f8466, sun: 0x9fb4ff, sunI: 1.1, hemi: 0.75, fog: 0x1e2850 },
  lair: { sky: ['#2a1238', '#7a3a6a'], grass: 0x5e4a6e, grass2: 0x54425f, road: 0x8a7a8a, sun: 0xffa0c8, sunI: 1.6, hemi: 0.9, fog: 0x3a1e4a }
};
const mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, flatShading: true }, o || {}));
const mesh = (geo, m, cast) => { const x = new THREE.Mesh(geo, m); x.castShadow = cast !== false; x.receiveShadow = true; return x; };

export function supported() { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; } }

export function create(canvas, opts) {
  opts = opts || {};
  const reduced = !!opts.reduced;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
  const hemi = new THREE.HemisphereLight(0xdfeeff, 0xb08a5a, 1.4); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.6); sun.position.set(-8, 16, 9); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 11, bottom: -11, near: 1, far: 40 }); scene.add(sun);
  let world = new THREE.Group(); scene.add(world);

  // shared materials
  const M = {
    wood: mat(0x8a5a34), woodL: mat(0xb07a46), stone: mat(0xd8cbb4), stoneD: mat(0xa89a84), brass: mat(0xd9a441, { metalness: 0.6, roughness: 0.35 }),
    blue: mat(0x1f6fb2), turq: mat(0x2bb3c0), gold: mat(0xe8b04a, { metalness: 0.5, roughness: 0.4 }), navy: mat(0x1c2a52), fur: mat(0xb5794a),
    white: mat(0xf4f1ea), black: mat(0x141a2e), red: mat(0xc8402a), leaf: mat(0x5f9a4a), leaf2: mat(0x4c8a3e), bark: mat(0x7a5a3a), rock: mat(0x8c8478), cotton: mat(0xfbfaf4)
  };
  let level = null, pads = [], towers = [], theme = THEMES.day, lanternLights = [];
  const enemies = new Map(), shots = new Map(), fx = [];
  let w = 1, h = 1, raf = 0, last = 0, t = 0, paused = false, disposed = false, game = null;

  function skyTex(c1, c2) { const c = document.createElement('canvas'); c.width = 4; c.height = 256; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, 4, 256); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx; }
  function nearPath(x, z, pts, r) {
    for (let i = 1; i < pts.length; i++) { const [ax, az] = pts[i - 1], [bx, bz] = pts[i]; const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz; let f = L ? ((x - ax) * dx + (z - az) * dz) / L : 0; f = Math.max(0, Math.min(1, f)); if (Math.hypot(ax + dx * f - x, az + dz * f - z) < r) return true; }
    return false;
  }
  function tree(x, z, s) { const g = new THREE.Group(); const tr = mesh(new THREE.CylinderGeometry(0.1 * s, 0.14 * s, 0.7 * s, 6), M.bark); tr.position.y = 0.35 * s; g.add(tr); const c = mesh(new THREE.IcosahedronGeometry(0.62 * s, 0), (x * 7 + z) % 2 > 1 ? M.leaf : M.leaf2); c.position.y = 1.1 * s; g.add(c); const c2 = mesh(new THREE.IcosahedronGeometry(0.4 * s, 0), M.leaf); c2.position.set(0.25 * s, 1.55 * s, 0.1 * s); g.add(c2); g.position.set(x, 0, z); return g; }
  function poplar(x, z, s) { const g = new THREE.Group(); const tr = mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.6, 6), M.bark); tr.position.y = 0.3; g.add(tr); const c = mesh(new THREE.ConeGeometry(0.45 * s, 2.6 * s, 7), M.leaf2); c.position.y = 0.5 + 1.3 * s; g.add(c); g.position.set(x, 0, z); return g; }

  /* ---------- level ---------- */
  function setLevel(cfg) {
    scene.remove(world); world = new THREE.Group(); scene.add(world); pads = []; towers = []; lanternLights = [];
    enemies.forEach(m => scene.remove(m)); enemies.clear(); shots.forEach(m => scene.remove(m)); shots.clear();
    level = cfg; theme = THEMES[cfg.theme] || THEMES.day;
    scene.background = skyTex(theme.sky[0], theme.sky[1]); scene.fog = new THREE.Fog(theme.fog, 26, 60); if (typeof tuneFog === 'function') tuneFog();
    hemi.intensity = theme.hemi; sun.color.setHex(theme.sun); sun.intensity = theme.sunI;
    // ground with a little low-poly relief
    const gg = new THREE.PlaneGeometry(40, 30, 40, 30); gg.rotateX(-Math.PI / 2);
    const pos = gg.attributes.position, cols = [], c1 = new THREE.Color(theme.grass), c2 = new THREE.Color(theme.grass2);
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); const off = Math.abs(x) > 12 || Math.abs(z) > 8.5 ? 0.35 + Math.random() * 0.5 : Math.random() * 0.06; pos.setY(i, nearPath(x, z, cfg.path, 1.3) ? -0.02 : off); const c = c1.clone().lerp(c2, Math.random()); cols.push(c.r, c.g, c.b); }
    gg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); gg.computeVertexNormals();
    world.add(mesh(gg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), false));
    // the road: a ribbon per segment, a round stone at each bend
    const roadM = mat(theme.road), edgeM = mat(new THREE.Color(theme.road).multiplyScalar(0.8).getHex());
    for (let i = 1; i < cfg.path.length; i++) {
      const [ax, az] = cfg.path[i - 1], [bx, bz] = cfg.path[i], len = Math.hypot(bx - ax, bz - az);
      const seg = mesh(new THREE.BoxGeometry(1.7, 0.06, len), roadM, false); seg.position.set((ax + bx) / 2, 0.03, (az + bz) / 2); seg.rotation.y = Math.atan2(bx - ax, bz - az); world.add(seg);
      for (let k = 0; k < len; k += 1.1) for (const side of [-1, 1]) { const f = k / len, px = ax + (bx - ax) * f, pz = az + (bz - az) * f, nx = (bz - az) / len, nz = -(bx - ax) / len; const st = mesh(new THREE.DodecahedronGeometry(0.1 + ((k * 13 + i) % 3) * 0.03, 0), edgeM, false); st.position.set(px + nx * 0.95 * side, 0.06, pz + nz * 0.95 * side); world.add(st); }
      if (i < cfg.path.length - 1) { const j = mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.06, 16), roadM, false); j.position.set(bx, 0.031, bz); world.add(j); }
    }
    // river and bridge
    if (cfg.river) {
      const river = mesh(new THREE.PlaneGeometry(2.4, 30), new THREE.MeshStandardMaterial({ color: theme === THEMES.night ? 0x2a4a7a : 0x3a9ad0, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 }), false);
      river.rotation.x = -Math.PI / 2; river.position.set(0, 0.04, 0); river.userData.water = true; world.add(river);
      for (let i = 1; i < cfg.path.length; i++) { const [ax, az] = cfg.path[i - 1], [bx, bz] = cfg.path[i]; if ((ax < 0) !== (bx < 0) && az === bz) {
        const br = mesh(new THREE.BoxGeometry(3.2, 0.22, 2.0), M.woodL); br.position.set(0, 0.16, az); world.add(br);
        for (const s of [-0.95, 0.95]) { const rail = mesh(new THREE.BoxGeometry(3.2, 0.1, 0.1), M.wood); rail.position.set(0, 0.62, az + s); world.add(rail); for (const px of [-1.5, 0, 1.5]) { const post = mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), M.wood); post.position.set(px, 0.4, az + s); world.add(post); } }
      } }
    }
    // the cave the Blots crawl out of, and the tea-house gate at the end
    const [sx, sz] = cfg.path[0], [ex, ez] = cfg.path[cfg.path.length - 1];
    const cave = new THREE.Group(); cave.position.set(sx + 0.6, 0, sz);
    for (let k = 0; k < 7; k++) { const r = mesh(new THREE.DodecahedronGeometry(0.9 + (k % 3) * 0.35, 0), M.rock); const a = k / 6 * Math.PI; r.position.set(-0.6 - Math.sin(a) * 0.4, Math.sin(a) * 1.4, Math.cos(a) * 1.6); cave.add(r); }
    const hole = mesh(new THREE.CircleGeometry(1.0, 16), new THREE.MeshBasicMaterial({ color: 0x0a0614 }), false); hole.rotation.y = Math.PI / 2; hole.position.set(-0.2, 0.7, 0); cave.add(hole);
    const ink = mesh(new THREE.CircleGeometry(1.3, 14), new THREE.MeshStandardMaterial({ color: 0x2a1a4a, roughness: 0.2 }), false); ink.rotation.x = -Math.PI / 2; ink.position.set(0.6, 0.05, 0); cave.add(ink);
    world.add(cave);
    const gate = new THREE.Group(); gate.position.set(ex - 0.4, 0, ez);
    for (const s of [-1.3, 1.3]) { const p = mesh(new THREE.BoxGeometry(0.5, 2.4, 0.5), mat(0xe3b985)); p.position.set(0, 1.2, s); gate.add(p); const cap = mesh(new THREE.ConeGeometry(0.4, 0.5, 4), M.blue); cap.position.set(0, 2.65, s); gate.add(cap); }
    const beam = mesh(new THREE.BoxGeometry(0.55, 0.45, 3.1), M.blue); beam.position.y = 2.3; gate.add(beam);
    const band = mesh(new THREE.BoxGeometry(0.6, 0.12, 3.15), M.turq); band.position.y = 2.05; gate.add(band);
    const dome = mesh(new THREE.SphereGeometry(1.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2a8fc4, { roughness: 0.5 })); dome.position.set(1.6, 1.8, -1.6); dome.scale.y = 1.2; gate.add(dome);
    const drum = mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.8, 14), mat(0xe3b985)); drum.position.set(1.6, 0.9, -1.6); gate.add(drum);
    world.add(gate);
    // Bakhrom's minaret with a stork nest
    const mn = new THREE.Group(); mn.position.set(-2.5, 0, -7.6);
    const tower = mesh(new THREE.CylinderGeometry(0.5, 0.7, 6, 12), mat(0xe3b985)); tower.position.y = 3; mn.add(tower);
    for (const y of [1.6, 3.4, 5.2]) { const b = mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 12), M.turq); b.position.y = y; mn.add(b); }
    const nest = mesh(new THREE.TorusGeometry(0.45, 0.16, 6, 12), M.bark); nest.rotation.x = Math.PI / 2; nest.position.y = 6.15; mn.add(nest);
    const stork = new THREE.Group(); stork.position.set(0, 6.3, 0);
    const body = mesh(new THREE.SphereGeometry(0.3, 10, 8), M.white); body.scale.set(0.8, 0.8, 1.3); body.position.y = 0.3; stork.add(body);
    const wing = mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), M.black); wing.position.set(0, 0.38, -0.2); stork.add(wing);
    const neck = mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.45, 6), M.white); neck.position.set(0, 0.62, 0.28); neck.rotation.x = 0.35; stork.add(neck);
    const head = mesh(new THREE.SphereGeometry(0.12, 8, 6), M.white); head.position.set(0, 0.86, 0.36); stork.add(head);
    const beak = mesh(new THREE.ConeGeometry(0.04, 0.4, 6), M.red); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.84, 0.62); stork.add(beak);
    mn.add(stork); mn.userData.stork = stork; world.add(mn); world.userData.stork = stork;
    // pads
    cfg.slots.forEach(([x, z], i) => {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const pad = mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.24, 8), M.stone); pad.position.y = 0.12; g.add(pad);
      const ring = mesh(new THREE.TorusGeometry(0.72, 0.04, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.7 }), false); ring.rotation.x = Math.PI / 2; ring.position.y = 0.26; g.add(ring);
      world.add(g); pads.push({ group: g, ring, tower: null, key: '' });
    });
    // scenery away from the road and the pads
    const rnd = (() => { let s = 7; return () => (s = (s * 9301 + 49297) % 233280) / 233280; })();
    for (let k = 0; k < 70; k++) {
      const x = -13 + rnd() * 26, z = -9 + rnd() * 18;
      if (nearPath(x, z, cfg.path, 1.8) || cfg.slots.some(([sx2, sz2]) => Math.hypot(sx2 - x, sz2 - z) < 1.6) || (cfg.river && Math.abs(x) < 1.6) || Math.hypot(x + 2.5, z + 7.6) < 1.5) continue;
      if (Math.abs(x) < 11.5 && Math.abs(z) < 7.6 && rnd() < 0.55) continue;
      if (cfg.theme === 'golden' && rnd() < 0.5) { const b = new THREE.Group(); for (let q = 0; q < 3; q++) { const p = mesh(new THREE.IcosahedronGeometry(0.16, 0), M.cotton); p.position.set((q - 1) * 0.18, 0.35 + (q % 2) * 0.1, 0); b.add(p); } const st = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 4), M.leaf2); st.position.y = 0.17; b.add(st); b.position.set(x, 0, z); world.add(b); continue; }
      world.add(rnd() < 0.35 ? poplar(x, z, 0.8 + rnd() * 0.5) : rnd() < 0.8 ? tree(x, z, 0.8 + rnd() * 0.6) : (() => { const r = mesh(new THREE.DodecahedronGeometry(0.3 + rnd() * 0.3, 0), M.rock); r.position.set(x, 0.15, z); return r; })());
    }
    if (cfg.theme === 'night' || cfg.theme === 'lair') {
      const pts = cfg.path; [1, 3, pts.length - 2].forEach((k, n) => { if (!pts[k]) return; const [lx, lz] = pts[k]; const post = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), M.wood); post.position.set(lx + 1.2, 0.8, lz + 1.2); world.add(post); const lamp = mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffb04a, emissive: 0xff8a2a, emissiveIntensity: 1.6 }), false); lamp.position.set(lx + 1.2, 1.7, lz + 1.2); world.add(lamp); if (n < 3) { const l = new THREE.PointLight(0xffa84a, 7, 8, 1.6); l.position.copy(lamp.position); world.add(l); lanternLights.push(l); } });
    }
  }

  /* ---------- towers ---------- */
  function otterArcher() {
    const g = new THREE.Group();
    const b = mesh(new THREE.CapsuleGeometry(0.16, 0.2, 4, 8), M.navy); b.position.y = 0.3; g.add(b);
    const hd = mesh(new THREE.SphereGeometry(0.16, 10, 8), M.fur); hd.position.y = 0.62; g.add(hd);
    const hat = mesh(new THREE.SphereGeometry(0.165, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.45), mat(0xe8a33a)); hat.position.y = 0.64; g.add(hat);
    const mz = mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(0xecd2ac), false); mz.position.set(0, 0.58, 0.13); g.add(mz);
    const bow = mesh(new THREE.TorusGeometry(0.22, 0.02, 4, 12, Math.PI), M.wood); bow.position.set(0.12, 0.42, 0.2); bow.rotation.set(0, Math.PI / 2, Math.PI / 2); g.add(bow);
    return g;
  }
  function makeTower(type, lv) {
    const g = new THREE.Group(), aim = new THREE.Group(); g.userData.aim = aim;
    if (type === 'archer') {
      const H = 1.2 + (lv - 1) * 0.25;
      for (const [x, z] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) { const p = mesh(new THREE.BoxGeometry(0.12, H, 0.12), M.wood); p.position.set(x, 0.24 + H / 2, z); g.add(p); }
      const plat = mesh(new THREE.BoxGeometry(1.0, 0.12, 1.0), M.woodL); plat.position.y = 0.24 + H; g.add(plat);
      aim.position.y = 0.3 + H; aim.add(otterArcher()); g.add(aim);
      if (lv >= 2) { const pole = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 4), M.wood); pole.position.set(-0.42, 0.75 + H, -0.42); g.add(pole); const flag = mesh(new THREE.BoxGeometry(0.02, 0.22, 0.34), M.red); flag.position.set(-0.42, 1.08 + H, -0.25); g.add(flag); g.userData.flag = flag; }
      if (lv >= 3) { const roof = mesh(new THREE.ConeGeometry(0.75, 0.5, 4), M.gold); roof.position.y = 1.3 + H; roof.rotation.y = Math.PI / 4; g.add(roof); }
    } else if (type === 'samovar') {
      const base = mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.5, 8), M.stoneD); base.position.y = 0.45; g.add(base);
      const s = 1 + (lv - 1) * 0.15; aim.position.y = 0.7; aim.scale.setScalar(s); g.add(aim);
      const body = mesh(new THREE.CylinderGeometry(0.36, 0.3, 0.75, 14), M.brass); body.position.y = 0.38; aim.add(body);
      const top = mesh(new THREE.SphereGeometry(0.37, 14, 8), M.brass); top.position.y = 0.78; top.scale.y = 0.6; aim.add(top);
      const chim = mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.3, 8), M.brass); chim.position.y = 1.05; aim.add(chim);
      const spout = mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 8), M.brass); spout.position.set(0, 0.35, 0.42); spout.rotation.x = 1.2; aim.add(spout);
      for (const sx of [-0.4, 0.4]) { const hd = mesh(new THREE.TorusGeometry(0.1, 0.025, 4, 8), M.brass); hd.position.set(sx, 0.55, 0); hd.rotation.y = Math.PI / 2; aim.add(hd); }
      if (lv >= 3) { const crown = mesh(new THREE.TorusGeometry(0.3, 0.04, 6, 14), M.gold); crown.rotation.x = Math.PI / 2; crown.position.y = 0.95; aim.add(crown); }
    } else {
      const H = 1.3 + (lv - 1) * 0.3;
      const col = mesh(new THREE.CylinderGeometry(0.42, 0.5, H, 10), M.blue); col.position.y = 0.24 + H / 2; g.add(col);
      for (let k = 0; k < lv + 1; k++) { const b = mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.08, 10), M.turq); b.position.y = 0.4 + k * (H / (lv + 1)); g.add(b); }
      const dm = mesh(new THREE.SphereGeometry(0.46, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5ed8e6, emissive: 0x1a8a9a, emissiveIntensity: 0.4, roughness: 0.4, flatShading: true })); dm.position.y = 0.24 + H; g.add(dm); g.userData.glow = dm;
      const fin = mesh(new THREE.ConeGeometry(0.07, 0.35, 6), lv >= 3 ? M.gold : M.turq); fin.position.y = 0.24 + H + 0.6; g.add(fin);
    }
    return g;
  }

  /* ---------- enemies ---------- */
  const blotMats = { blot: mat(0x3a2a7a, { roughness: 0.3 }), runner: mat(0x2a7a9a, { roughness: 0.3 }), fat: mat(0x6a2a5a, { roughness: 0.3 }), king: mat(0x2a1a4a, { roughness: 0.25 }) };
  const hpBg = new THREE.SpriteMaterial({ color: 0x141a2e, depthTest: false }), hpFg = new THREE.SpriteMaterial({ color: 0x7ee0a1, depthTest: false }), hpBoss = new THREE.SpriteMaterial({ color: 0xff7a5a, depthTest: false });
  function makeEnemy(e) {
    const g = new THREE.Group(), size = e.type === 'fat' ? 0.62 : e.type === 'runner' ? 0.32 : e.type === 'king' ? 1.05 : 0.42, m = blotMats[e.type].clone();
    const body = mesh(new THREE.IcosahedronGeometry(size, 1), m); body.position.y = size * 0.9; body.scale.set(1, 0.82, e.type === 'runner' ? 1.25 : 1); g.add(body);
    for (let k = 0; k < 4; k++) { const d = mesh(new THREE.SphereGeometry(size * 0.28, 6, 4), m); const a = k * 1.7; d.position.set(Math.cos(a) * size * 0.85, size * 0.25, Math.sin(a) * size * 0.85); g.add(d); }
    for (const sx of [-0.35, 0.35]) { const eye = mesh(new THREE.SphereGeometry(size * 0.28, 10, 8), M.white, false); eye.position.set(sx * size, size * 1.15, size * 0.72); g.add(eye); const pu = mesh(new THREE.SphereGeometry(size * 0.13, 8, 6), M.black, false); pu.position.set(sx * size, size * 1.12, size * 0.97); g.add(pu); }
    for (const sx of [-0.3, 0.3]) { const st = mesh(new THREE.CylinderGeometry(0.02, 0.02, size * 0.7, 4), m, false); st.position.set(sx * size, size * 1.8, 0); st.rotation.z = -sx; g.add(st); const ball = mesh(new THREE.SphereGeometry(size * 0.12, 6, 4), m, false); ball.position.set(sx * size * 1.6, size * 2.1, 0); g.add(ball); }
    if (e.type === 'king') {
      const crown = mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.36, 8, 1, true), M.gold); crown.position.y = size * 1.9; g.add(crown);
      for (let k = 0; k < 6; k++) { const sp = mesh(new THREE.ConeGeometry(0.08, 0.28, 4), M.gold); const a = k / 6 * Math.PI * 2; sp.position.set(Math.cos(a) * 0.45, size * 1.9 + 0.3, Math.sin(a) * 0.45); g.add(sp); }
      const sh = new THREE.Mesh(new THREE.IcosahedronGeometry(size * 1.6, 2), new THREE.MeshStandardMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.28, emissive: 0x2a8a9a, emissiveIntensity: 0.6, roughness: 0.2, depthWrite: false })); sh.position.y = size; g.add(sh); g.userData.shield = sh;
    }
    const bg = new THREE.Sprite(hpBg), fg = new THREE.Sprite(e.boss ? hpBoss : hpFg); bg.center.set(0, 0.5); fg.center.set(0, 0.5);
    const bw = e.boss ? 2.2 : 0.9; bg.scale.set(bw + 0.08, 0.16, 1); fg.scale.set(bw, 0.1, 1); bg.position.set(-bw / 2 - 0.04, size * 2.4 + 0.15, 0); fg.position.set(-bw / 2, size * 2.4 + 0.15, 0.01); bg.renderOrder = 10; fg.renderOrder = 11; g.add(bg); g.add(fg);
    g.userData.body = body; g.userData.mat = m; g.userData.fg = fg; g.userData.bw = bw; g.userData.size = size; g.userData.seed = Math.random() * 6;
    scene.add(g); return g;
  }
  /* ---------- effects ---------- */
  const ringGeo = new THREE.RingGeometry(0.85, 1, 32); ringGeo.rotateX(-Math.PI / 2);
  const puffGeo = new THREE.SphereGeometry(0.1, 6, 4);
  function ring(x, z, r, color, dur) { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })); m.position.set(x, 0.12, z); scene.add(m); fx.push({ m, life: 0, dur: dur || 0.5, r, kind: 'ring' }); }
  function puffs(x, y, z, n, color, spread) { if (reduced) n = Math.min(n, 3); for (let k = 0; k < n; k++) { const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })); m.position.set(x, y, z); m.userData.v = new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * spread + 1, (Math.random() - 0.5) * spread); scene.add(m); fx.push({ m, life: 0, dur: 0.7, kind: 'puff' }); } }
  function splat(x, z, size) { const m = new THREE.Mesh(new THREE.CircleGeometry(size, 12), new THREE.MeshStandardMaterial({ color: 0x2a1a4a, transparent: true, opacity: 0.85, roughness: 0.2 })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.07, z); scene.add(m); fx.push({ m, life: 0, dur: 2.2, kind: 'splat' }); }

  /* ---------- sync with the simulation ---------- */
  function sync(g) {
    game = g; if (!level) return;
    // towers
    g.slots.forEach((s, i) => {
      const p = pads[i]; if (!p) return; const key = s.tower ? s.tower.type + s.tower.lv : '';
      if (p.key !== key) { if (p.tower) p.group.remove(p.tower); p.tower = key ? makeTower(s.tower.type, s.tower.lv) : null; if (p.tower) { p.group.add(p.tower); p.tower.scale.setScalar(0.3); p.pop = 0; puffs(s.x, 0.6, s.z, 8, 0xfff2d0, 2); } p.key = key; }
      p.ring.visible = !s.tower;
      if (p.tower && s.tower) {
        const aim = p.tower.userData.aim; if (aim && s.tower.type !== 'tile') aim.rotation.y = s.tower.aim || 0;
        if (p.tower.userData.glow) p.tower.userData.glow.material.emissiveIntensity = 0.4 + (s.tower.flash || 0) * 4;
        if (s.tower.type === 'samovar' && s.tower.flash > 0.2 && Math.random() < 0.5) puffs(s.x, 1.9, s.z, 1, 0xffffff, 0.4);
      }
    });
    // enemies
    const alive = new Set();
    g.enemies.forEach(e => {
      alive.add(e.id); let m = enemies.get(e.id); if (!m) { m = makeEnemy(e); enemies.set(e.id, m); }
      m.position.set(e.x, 0, e.z); m.rotation.y = e.angle;
      const ud = m.userData; ud.fg.scale.x = Math.max(0.001, ud.bw * e.hp / e.max);
      ud.mat.color.copy(blotMats[e.type].color); if (e.slowT > 0) ud.mat.color.lerp(new THREE.Color(0x8fe8ff), 0.55);
      if (ud.shield) ud.shield.visible = !!e.shield;
    });
    enemies.forEach((m, id) => { if (!alive.has(id)) { scene.remove(m); enemies.delete(id); } });
    // shots
    const live = new Set();
    g.shots.forEach(sh => {
      live.add(sh.id); let m = shots.get(sh.id);
      if (!m) {
        if (sh.kind === 'arrow') { m = new THREE.Group(); const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 4), M.wood); shaft.rotation.x = Math.PI / 2; m.add(shaft); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), M.stoneD); tip.rotation.x = Math.PI / 2; tip.position.z = 0.36; m.add(tip); }
        else m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc8682a, emissive: 0x8a3a10, emissiveIntensity: 0.6 }));
        scene.add(m); shots.set(sh.id, m);
      }
      m.position.set(sh.x, sh.y, sh.z); if (sh.kind === 'arrow') m.rotation.y = sh.angle || 0; else if (Math.random() < 0.4) puffs(sh.x, sh.y, sh.z, 1, 0xffffff, 0.2);
    });
    shots.forEach((m, id) => { if (!live.has(id)) { scene.remove(m); shots.delete(id); } });
    // one-off effects
    g.events.forEach(ev => {
      if (ev.e === 'hit') puffs(ev.x, 0.7, ev.z, 3, 0xfff2b0, 1.2);
      else if (ev.e === 'splash') { ring(ev.x, ev.z, ev.r, 0xffa04a, 0.5); puffs(ev.x, 0.4, ev.z, 8, 0xc8682a, 2.4); }
      else if (ev.e === 'pulse') { const s = g.slots[ev.slot]; ring(s.x, s.z, ev.r, 0x8fe8ff, 0.6); }
      else if (ev.e === 'die') { splat(ev.x, ev.z, ev.boss ? 1.8 : 0.5); puffs(ev.x, 0.6, ev.z, ev.boss ? 24 : 8, 0x3a2a7a, 2.6); }
      else if (ev.e === 'leak') { const [lx, lz] = level.path[level.path.length - 1]; puffs(lx, 1.2, lz, 10, 0xff6b5a, 2); }
      else if (ev.e === 'shieldDown') { const b = g.enemies.find(x => x.id === ev.id); if (b) puffs(b.x, 1.4, b.z, 20, 0x8fe8ff, 3); }
    });
  }
  function anchors() {
    const v = new THREE.Vector3();
    return pads.map(p => { v.copy(p.group.position); v.y = p.tower ? 0 : 0.5; v.project(camera); return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h }; });
  }
  // Fits the board into the part of the canvas the HUD and the word tray leave free. Wide screens look at
  // the valley from the south; tall ones from the east, so the long road runs down the screen.
  let insets = { top: 0, bottom: 0 }, viewD = 24;
  // the fog starts behind the board whatever the camera distance, so tall screens stay crisp
  function tuneFog() { if (scene.fog) { scene.fog.near = viewD * 1.15; scene.fog.far = viewD * 2.6; } }
  const CORNERS = [];
  for (const x of [-12, 12]) for (const z of [-6.6, 6.6]) for (const y of [0, 1.3]) CORNERS.push(new THREE.Vector3(x, y, z));
  function fit() {
    const aspect = w / h, portrait = aspect < 0.95, availH = Math.max(120, h - insets.top - insets.bottom);
    camera.aspect = aspect; camera.fov = portrait ? 34 : 36; camera.clearViewOffset();
    const dir = (portrait ? new THREE.Vector3(0.55, 0.84, 0) : new THREE.Vector3(0, 0.78, 0.63)).normalize(), target = new THREE.Vector3(0, 0, portrait ? 0 : 0.4);
    const sx = 0.96, sy = 0.94 * availH / h, v = new THREE.Vector3();
    let d = 30, cy = 0;
    for (let it = 0; it < 8; it++) {
      camera.position.copy(dir).multiplyScalar(d).add(target); camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      CORNERS.forEach(c => { v.copy(c).project(camera); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); });
      const m = Math.max((x1 - x0) / (2 * sx), (y1 - y0) / (2 * sy)); cy = (y0 + y1) / 2;
      d = Math.max(8, d * (0.35 + 0.65 * m));
    }
    viewD = d; tuneFog();
    const off = (h / 2 - cy * h / 2) - (insets.top + availH / 2);
    camera.setViewOffset(w, h, 0, off, w, h); camera.updateProjectionMatrix();
  }
  function resize(nw, nh, ins) {
    w = Math.max(1, nw); h = Math.max(1, nh); if (ins) insets = ins; renderer.setSize(w, h, false); fit();
  }
  const rangeDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.16, depthWrite: false }));
  const rangeEdge = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.7, depthWrite: false }));
  rangeDisc.rotation.x = rangeEdge.rotation.x = -Math.PI / 2; rangeDisc.visible = rangeEdge.visible = false; scene.add(rangeDisc); scene.add(rangeEdge);
  function highlight(i, r) {
    const on = i != null && pads[i] && r > 0; rangeDisc.visible = rangeEdge.visible = !!on; if (!on) return;
    const p = pads[i].group.position; rangeDisc.position.set(p.x, 0.1, p.z); rangeEdge.position.set(p.x, 0.11, p.z); rangeDisc.scale.set(r, r, 1); rangeEdge.scale.set(r, r, 1);
  }
  function frame(now) {
    raf = 0; if (disposed || paused) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now; t += dt;
    enemies.forEach(m => { const ud = m.userData, b = ud.body; const bounce = Math.abs(Math.sin(t * 7 + ud.seed)); b.position.y = ud.size * (0.85 + bounce * 0.25); b.scale.y = 0.75 + bounce * 0.15; b.scale.x = 1.05 - bounce * 0.08; if (ud.shield) { ud.shield.rotation.y += dt * 0.8; ud.shield.material.opacity = 0.22 + Math.sin(t * 4) * 0.06; } });
    pads.forEach(p => { if (p.tower && p.pop < 1) { p.pop = Math.min(1, p.pop + dt * 4); const s = p.pop < 0.7 ? 0.3 + p.pop : 1 + Math.sin((p.pop - 0.7) / 0.3 * Math.PI) * 0.12; p.tower.scale.setScalar(s); } p.ring.material.opacity = 0.45 + Math.sin(t * 3) * 0.25; if (p.tower && p.tower.userData.flag) p.tower.userData.flag.rotation.y = Math.sin(t * 5) * 0.3; });
    for (let k = fx.length - 1; k >= 0; k--) { const f = fx[k]; f.life += dt; const q = f.life / f.dur;
      if (f.kind === 'ring') { const s = 0.2 + q * f.r; f.m.scale.set(s, 1, s); f.m.material.opacity = 0.8 * (1 - q); }
      else if (f.kind === 'puff') { f.m.userData.v.y -= 4 * dt; f.m.position.addScaledVector(f.m.userData.v, dt); f.m.material.opacity = 0.9 * (1 - q); f.m.scale.setScalar(1 + q); }
      else if (f.kind === 'splat') f.m.material.opacity = 0.85 * (1 - Math.max(0, q - 0.5) * 2);
      if (q >= 1) { scene.remove(f.m); f.m.material.dispose(); fx.splice(k, 1); } }
    if (world.userData.stork) world.userData.stork.rotation.y = Math.sin(t * 0.4) * 0.8;
    world.children.forEach(c => { if (c.userData.water) c.material.opacity = 0.88 + Math.sin(t * 2) * 0.04; });
    lanternLights.forEach((l, k) => { l.intensity = 6.5 + Math.sin(t * 7 + k) * 0.8; });
    renderer.render(scene, camera);
    if (opts.onFrame) opts.onFrame(anchors());
    raf = requestAnimationFrame(frame);
  }
  function setPaused(p) { paused = !!p; if (!paused && !raf && !disposed) { last = 0; raf = requestAnimationFrame(frame); } }
  function dispose() { disposed = true; if (raf) cancelAnimationFrame(raf); renderer.dispose(); }
  resize(canvas.clientWidth || 800, canvas.clientHeight || 500);
  raf = requestAnimationFrame(frame);
  return { setLevel, sync, resize, highlight, setPaused, dispose, three: true };
}
