/* «Чайхана» 3D scene (v2.36): a Samarkand-style tea-house courtyard at golden hour, built from primitives.
   Bundled into vendor/cafe3d.js with only the parts of three.js it uses:
     esbuild tools/cafe3d.src.js --bundle --minify --format=iife --global-name=VMCafe3D \
       --alias:three=<three.js r187>/build/three.module.js --outfile=vendor/cafe3d.js
   cafe.js drives it through create(canvas, opts); every call is safe to make at any time. */
import * as THREE from 'three';

const SEATS = [[-1.9, -1.2], [2.3, -1.2], [0.2, 2.0], [4.4, 2.0]];
const KINDS = ['fox', 'rabbit', 'bear', 'cat', 'panda'];

function mat(color, o) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.82, metalness: 0, flatShading: true }, o || {})); }
function mesh(geo, m, shadow) { const x = new THREE.Mesh(geo, m); x.castShadow = shadow !== false; x.receiveShadow = true; return x; }
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }

export function supported() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
}

export function create(canvas, opts) {
  opts = opts || {};
  const reduced = !!opts.reduced;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = canvasTex(4, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#6fa6e0'); gr.addColorStop(0.55, '#ffd6a0'); gr.addColorStop(1, '#ffb27a'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  scene.fog = new THREE.Fog(0xffd9b0, 26, 52);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  const look = new THREE.Vector3(0.9, 0.2, 1.0);

  // light: warm low sun, sky/ground fill
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0xd9a878, 1.5));
  const sun = new THREE.DirectionalLight(0xffdcb0, 2.9);
  sun.position.set(-7, 11, 7); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 9, bottom: -9, near: 1, far: 30 });
  scene.add(sun);

  /* ---------- the courtyard ---------- */
  const groundTex = canvasTex(512, 512, (g, w) => {
    g.fillStyle = '#e8cfa3'; g.fillRect(0, 0, w, w);
    const n = 8, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? '#e2c497' : '#ecd5ad'; g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4); }
    g.strokeStyle = '#c9a676'; g.lineWidth = 3; for (let k = 0; k <= n; k++) { g.beginPath(); g.moveTo(k * s, 0); g.lineTo(k * s, w); g.stroke(); g.beginPath(); g.moveTo(0, k * s); g.lineTo(w, k * s); g.stroke(); }
  });
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping; groundTex.repeat.set(3, 2.2);
  const ground = mesh(new THREE.PlaneGeometry(26, 18), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }), false);
  ground.rotation.x = -Math.PI / 2; ground.position.set(1, 0, 0); scene.add(ground);

  // back wall with three arched iwans, a blue tile band and a dome behind
  const clay = mat(0xe3b985), blue = mat(0x1f6fb2), turq = mat(0x2bb3c0), deep = mat(0x173a66), gold = mat(0xe8b04a, { metalness: 0.5, roughness: 0.4 });
  const wall = mesh(new THREE.BoxGeometry(24, 5.2, 0.7), clay); wall.position.set(1, 2.6, -5.6); scene.add(wall);
  const band = mesh(new THREE.BoxGeometry(24, 0.45, 0.78), blue); band.position.set(1, 4.75, -5.6); scene.add(band);
  const band2 = mesh(new THREE.BoxGeometry(24, 0.12, 0.8), turq); band2.position.set(1, 4.45, -5.6); scene.add(band2);
  function arch(x, w, h) {
    const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(-w / 2, h - w / 2); sh.absarc(0, h - w / 2, w / 2, Math.PI, 0, true); sh.lineTo(w / 2, 0); sh.lineTo(-w / 2, 0);
    const frame = mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false }), turq); frame.scale.set(1.12, 1.06, 1); frame.position.set(x, 0, -5.24); scene.add(frame);
    const inner = mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: false }), deep); inner.position.set(x, 0, -5.16); scene.add(inner);
    for (let k = 0; k < 6; k++) { const star = mesh(new THREE.OctahedronGeometry(0.1), gold, false); star.position.set(x + (k % 3 - 1) * w * 0.25, h * 0.45 + Math.floor(k / 3) * 0.6, -5.02); star.scale.z = 0.3; scene.add(star); }
  }
  arch(-3.6, 2.2, 3.6); arch(1, 2.8, 4.1); arch(5.6, 2.2, 3.6);
  const drum = mesh(new THREE.CylinderGeometry(2.1, 2.1, 1.2, 20), blue); drum.position.set(1, 5.8, -7.6); scene.add(drum);
  const dome = mesh(new THREE.SphereGeometry(2.35, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2a8fc4, { roughness: 0.5 })); dome.position.set(1, 6.4, -7.6); dome.scale.y = 1.25; scene.add(dome);
  const finial = mesh(new THREE.ConeGeometry(0.16, 0.9, 8), gold); finial.position.set(1, 9.7, -7.6); scene.add(finial);
  for (const mx of [-9.5, 11.5]) { const minaret = mesh(new THREE.CylinderGeometry(0.55, 0.7, 7.5, 12), clay); minaret.position.set(mx, 3.75, -6.6); scene.add(minaret); const cap = mesh(new THREE.ConeGeometry(0.75, 1.1, 12), blue); cap.position.set(mx, 8.05, -6.6); scene.add(cap); const ring = mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.3, 12), turq); ring.position.set(mx, 6.6, -6.6); scene.add(ring); }
  // poplars and a plane tree
  const leaf = mat(0x5f9a4a), leaf2 = mat(0x4c8a3e), bark = mat(0x7a5a3a);
  for (const [x, z, h] of [[-8.5, -3.6, 4.6], [-9.6, 0.5, 5.2], [10.6, -3.4, 4.8], [11.2, 1.8, 4.2]]) {
    const tr = mesh(new THREE.CylinderGeometry(0.12, 0.16, 1.2, 6), bark); tr.position.set(x, 0.6, z); scene.add(tr);
    const cr = mesh(new THREE.ConeGeometry(0.75, h, 7), (x + z) % 2 ? leaf : leaf2); cr.position.set(x, 1.1 + h / 2, z); scene.add(cr);
  }

  /* ---------- counter, samovar, grandma ---------- */
  const wood = mat(0x8a5a34), woodL = mat(0xb07a46), brass = mat(0xd9a441, { metalness: 0.65, roughness: 0.35 }), red = mat(0xc8402a), cream = mat(0xf4ede2);
  const counter = mesh(new THREE.BoxGeometry(3.2, 1.05, 1.1), wood); counter.position.set(-5.4, 0.52, -1.6); scene.add(counter);
  const top = mesh(new THREE.BoxGeometry(3.4, 0.12, 1.25), woodL); top.position.set(-5.4, 1.1, -1.6); scene.add(top);
  for (let k = 0; k < 3; k++) { const tile = mesh(new THREE.BoxGeometry(0.8, 0.5, 0.04), k % 2 ? blue : turq, false); tile.position.set(-6.4 + k, 0.55, -1.03); scene.add(tile); }
  const samovar = new THREE.Group();
  const sb = mesh(new THREE.CylinderGeometry(0.32, 0.26, 0.7, 14), brass); sb.position.y = 0.35; samovar.add(sb);
  const st = mesh(new THREE.SphereGeometry(0.33, 14, 8), brass); st.position.y = 0.72; st.scale.y = 0.6; samovar.add(st);
  const sc = mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.25, 8), brass); sc.position.y = 0.95; samovar.add(sc);
  const spout = mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.3, 6), brass); spout.position.set(0.36, 0.3, 0); spout.rotation.z = -1.1; samovar.add(spout);
  samovar.position.set(-4.6, 1.16, -1.55); scene.add(samovar);
  const cup = mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.12, 10), cream); cup.position.set(-4.08, 1.22, -1.45); scene.add(cup);
  const teaFill = mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.01, 10), mat(0xb8642a), false); teaFill.position.set(-4.08, 1.17, -1.45); scene.add(teaFill);
  const stream = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 6), mat(0xc87a3a, { transparent: true, opacity: 0.85 }), false); stream.position.set(-4.08, 1.38, -1.45); stream.visible = false; scene.add(stream);
  const bread = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 12), mat(0xd9a05a)); bread.position.set(-6.3, 1.2, -1.5); scene.add(bread);

  function tortoise() {
    const g = new THREE.Group();
    const shell = mesh(new THREE.SphereGeometry(0.62, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x5f8f4a)); shell.scale.y = 0.9; shell.position.y = 0.55; g.add(shell);
    const rim = mesh(new THREE.TorusGeometry(0.62, 0.07, 6, 18), mat(0x46703a)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.56; g.add(rim);
    for (let k = 0; k < 5; k++) { const plate = mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 6), mat(0x7aa85a), false); const a = k / 5 * Math.PI * 2; plate.position.set(Math.cos(a) * 0.36, 0.86, Math.sin(a) * 0.36); plate.lookAt(0, 3, 0); g.add(plate); }
    const neck = mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.5, 8), mat(0x9bbf6a)); neck.position.set(0, 0.95, 0.45); neck.rotation.x = 0.5; g.add(neck);
    const head = new THREE.Group(); head.position.set(0, 1.28, 0.62); g.add(head);
    head.add(mesh(new THREE.SphereGeometry(0.27, 12, 10), mat(0x9bbf6a)));
    const scarf = mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), red); scarf.position.y = 0.04; scarf.rotation.x = -0.35; head.add(scarf);
    for (let k = 0; k < 5; k++) { const dot = mesh(new THREE.SphereGeometry(0.035, 6, 4), gold, false); const a = k / 4 * Math.PI - Math.PI / 2; dot.position.set(Math.sin(a) * 0.24, 0.18, Math.cos(a) * 0.14 - 0.05); head.add(dot); }
    for (const sx of [-0.1, 0.1]) {
      const eye = mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(0x141a2e), false); eye.position.set(sx, 0.02, 0.24); head.add(eye);
      const glass = mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 14), mat(0x3a2a1a), false); glass.position.set(sx, 0.02, 0.27); head.add(glass);
    }
    const smile = mesh(new THREE.TorusGeometry(0.07, 0.012, 4, 10, Math.PI), mat(0x3a2a1a), false); smile.position.set(0, -0.09, 0.25); smile.rotation.z = Math.PI; head.add(smile);
    g.userData.head = head; return g;
  }
  const grandma = tortoise(); grandma.position.set(-6.1, 0, -2.75); grandma.rotation.y = 0.35; scene.add(grandma);

  /* ---------- Ota the waiter ---------- */
  function otter() {
    const g = new THREE.Group();
    const body = mesh(new THREE.CapsuleGeometry(0.3, 0.42, 4, 10), mat(0x1c2a52)); body.position.y = 0.62; g.add(body);
    const apron = mesh(new THREE.BoxGeometry(0.42, 0.42, 0.05), cream, false); apron.position.set(0, 0.55, 0.28); g.add(apron);
    const head = new THREE.Group(); head.position.y = 1.2; g.add(head);
    head.add(mesh(new THREE.SphereGeometry(0.3, 14, 10), mat(0xb5794a)));
    const muzzle = mesh(new THREE.SphereGeometry(0.16, 10, 8), mat(0xecd2ac), false); muzzle.position.set(0, -0.06, 0.24); muzzle.scale.set(1.2, 0.85, 0.8); head.add(muzzle);
    const nose = mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(0x2a1a12), false); nose.position.set(0, -0.01, 0.37); head.add(nose);
    for (const sx of [-0.12, 0.12]) { const e = mesh(new THREE.SphereGeometry(0.04, 8, 6), mat(0x141a2e), false); e.position.set(sx, 0.08, 0.26); head.add(e); const ear = mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(0xb5794a)); ear.position.set(sx * 1.9, 0.22, 0); head.add(ear); }
    const hat = mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), mat(0xe8a33a)); hat.position.y = 0.04; head.add(hat);
    const pom = mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(0xffd27a)); pom.position.y = 0.33; head.add(pom);
    const trayG = new THREE.Group(); trayG.position.set(0.36, 0.95, 0.15); g.add(trayG);
    trayG.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 16), brass));
    g.userData = { head, tray: trayG }; return g;
  }
  const ota = otter(); const otaHome = new THREE.Vector3(-3.4, 0, -0.5); ota.position.copy(otaHome); scene.add(ota);

  /* ---------- tapchans (seats) ---------- */
  const suzani = canvasTex(256, 192, (g, w, h) => {
    g.fillStyle = '#f1e2c4'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a8322a'; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
    const dots = [[64, 64], [192, 64], [128, 128], [64, 160], [192, 160]];
    for (const [x, y] of dots) { g.fillStyle = '#c8402a'; g.beginPath(); g.arc(x, y, 30, 0, 7); g.fill(); g.fillStyle = '#e89a3a'; g.beginPath(); g.arc(x, y, 18, 0, 7); g.fill(); g.fillStyle = '#2a5a8a'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.fillStyle = '#3a7a4a'; g.beginPath(); g.ellipse(x + Math.cos(a) * 40, y + Math.sin(a) * 40, 8, 4, a, 0, 7); g.fill(); } }
  });
  const seats = SEATS.map(([x, z], i) => {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const plat = mesh(new THREE.BoxGeometry(2.5, 0.42, 1.9), wood); plat.position.y = 0.36; g.add(plat);
    for (const [lx, lz] of [[-1.1, -0.8], [1.1, -0.8], [-1.1, 0.8], [1.1, 0.8]]) { const leg = mesh(new THREE.BoxGeometry(0.18, 0.2, 0.18), wood); leg.position.set(lx, 0.1, lz); g.add(leg); }
    const rail = mesh(new THREE.BoxGeometry(2.5, 0.4, 0.1), woodL); rail.position.set(0, 0.75, -0.92); g.add(rail);
    const rug = mesh(new THREE.PlaneGeometry(2.3, 1.7), new THREE.MeshStandardMaterial({ color: 0xc9a47a, roughness: 1 }), false); rug.rotation.x = -Math.PI / 2; rug.position.y = 0.575; g.add(rug);
    const table = mesh(new THREE.BoxGeometry(1.0, 0.22, 0.7), woodL); table.position.set(0, 0.69, 0.15); g.add(table);
    const cush = mesh(new THREE.BoxGeometry(0.8, 0.14, 0.5), i % 2 ? blue : red); cush.position.set(0, 0.64, -0.5); g.add(cush);
    const dishSpot = new THREE.Group(); dishSpot.position.set(0, 0.82, 0.15); g.add(dishSpot);
    scene.add(g);
    return { group: g, rug, dishSpot, guest: null, hidden: false };
  });

  /* ---------- upgrades ---------- */
  const decor = {};
  // lanterns on a string over the yard
  decor.lanterns = new THREE.Group();
  const lanternLights = [];
  for (let k = 0; k < 7; k++) {
    const x = -4.2 + k * 1.6, y = 3.6 - Math.sin(k / 6 * Math.PI) * 0.5;
    const l = mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffb04a, emissive: 0xff8a2a, emissiveIntensity: 1.4, roughness: 0.6 }), false);
    l.scale.y = 1.3; l.position.set(x, y, 0.4); decor.lanterns.add(l);
    const capm = mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.08, 8), gold, false); capm.position.set(x, y + 0.22, 0.4); decor.lanterns.add(capm);
  }
  const cord = mesh(new THREE.CylinderGeometry(0.012, 0.012, 10, 4), mat(0x3a2a1a), false); cord.rotation.z = Math.PI / 2; cord.position.set(0.6, 3.75, 0.4); decor.lanterns.add(cord);
  for (const x of [-2.4, 3.6]) { const pl = new THREE.PointLight(0xffa84a, 0, 9, 1.6); pl.position.set(x, 3.2, 0.6); decor.lanterns.add(pl); lanternLights.push(pl); }
  scene.add(decor.lanterns);
  // vines over a pergola
  decor.vines = new THREE.Group();
  // a vine arbor along the back wall: it frames the arches without hiding the guests
  for (const x of [-4.2, -1.2, 1.8, 4.8, 7.4]) { const post = mesh(new THREE.BoxGeometry(0.2, 3.6, 0.2), wood); post.position.set(x, 1.8, -3.9); decor.vines.add(post); const arm = mesh(new THREE.BoxGeometry(0.14, 0.14, 1.4), wood); arm.position.set(x, 3.65, -4.55); decor.vines.add(arm); }
  const beamV = mesh(new THREE.BoxGeometry(12.2, 0.16, 0.16), wood); beamV.position.set(1.6, 3.65, -3.9); decor.vines.add(beamV);
  for (let k = 0; k < 14; k++) { const v = mesh(new THREE.IcosahedronGeometry(0.38 + (k % 3) * 0.1, 0), k % 2 ? leaf : leaf2); v.position.set(-4.4 + k * 0.92, 3.95 + (k % 3) * 0.08, -4.3 + (k % 2) * 0.45); decor.vines.add(v); if (k % 2 === 0) { const gr = mesh(new THREE.IcosahedronGeometry(0.15, 0), mat(0x6a3a8a)); gr.position.copy(v.position).add(new THREE.Vector3(0.1, -0.42, 0.25)); decor.vines.add(gr); } }
  for (let k = 0; k < 5; k++) { const hang = mesh(new THREE.IcosahedronGeometry(0.22, 0), leaf); hang.position.set(-4.2 + k * 3, 3.2, -3.85); decor.vines.add(hang); }
  scene.add(decor.vines);
  const bigSamovar = samovar.clone(); bigSamovar.scale.setScalar(1.55); bigSamovar.position.set(-6.0, 1.16, -1.5); decor.samovar = bigSamovar; scene.add(bigSamovar);

  /* ---------- guests ---------- */
  const PAL = { fox: [0xe8762a, 0xfff1e0], rabbit: [0xe8e2dc, 0xfff8f2], bear: [0x8a5a34, 0xd9b48a], cat: [0x8a8f9e, 0xe6e8ee], panda: [0xf4f4f0, 0x2a2a30], owl: [0x8a6a4a, 0xe8d6b4] };
  const SCARVES = [0x2bb3c0, 0xc8402a, 0xe8b04a, 0x6a3a8a, 0x3a8a5a];
  function makeGuest(kind, n) {
    const [c1, c2] = PAL[kind], g = new THREE.Group(), m1 = mat(c1), m2 = mat(c2), dark = mat(0x141a2e);
    const body = mesh(new THREE.CapsuleGeometry(0.3, 0.36, 4, 10), kind === 'panda' ? mat(0x2a2a30) : m1); body.position.y = 0.55; g.add(body);
    const belly = mesh(new THREE.SphereGeometry(0.24, 10, 8), kind === 'panda' ? m1 : m2, false); belly.position.set(0, 0.52, 0.14); belly.scale.z = 0.7; g.add(belly);
    const head = new THREE.Group(); head.position.y = 1.08; g.add(head);
    const skull = mesh(new THREE.SphereGeometry(0.3, 14, 10), kind === 'panda' ? m1 : m1); head.add(skull);
    const muzzle = mesh(new THREE.SphereGeometry(0.15, 10, 8), kind === 'panda' ? m1 : m2, false); muzzle.position.set(0, -0.07, 0.23); muzzle.scale.set(1.15, 0.8, 0.8); head.add(muzzle);
    const eyes = [];
    for (const sx of [-0.11, 0.11]) {
      if (kind === 'panda') { const patch = mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(0x2a2a30), false); patch.position.set(sx, 0.05, 0.24); patch.scale.set(1, 1.2, 0.5); head.add(patch); }
      if (kind === 'owl') { const disc = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 14), mat(0xfff6e2), false); disc.rotation.x = Math.PI / 2; disc.position.set(sx * 1.1, 0.06, 0.27); head.add(disc); }
      const e = mesh(new THREE.SphereGeometry(kind === 'owl' ? 0.06 : 0.042, 8, 6), kind === 'panda' ? mat(0xffffff) : dark, false); e.position.set(sx * (kind === 'owl' ? 1.1 : 1), 0.06, kind === 'owl' ? 0.3 : 0.27); head.add(e); eyes.push(e);
    }
    const nose = mesh(kind === 'owl' ? new THREE.ConeGeometry(0.05, 0.14, 6) : new THREE.SphereGeometry(0.045, 8, 6), kind === 'owl' ? mat(0xe8a33a) : dark, false);
    nose.position.set(0, kind === 'owl' ? -0.06 : -0.03, 0.37); if (kind === 'owl') nose.rotation.x = Math.PI / 2 + 0.3; head.add(nose);
    const earM = kind === 'panda' ? mat(0x2a2a30) : m1;
    if (kind === 'rabbit') for (const sx of [-0.1, 0.1]) { const ear = mesh(new THREE.CapsuleGeometry(0.06, 0.34, 4, 8), earM); ear.position.set(sx, 0.42, -0.02); ear.rotation.z = -sx * 1.2; head.add(ear); }
    else if (kind === 'fox' || kind === 'cat') for (const sx of [-0.16, 0.16]) { const ear = mesh(new THREE.ConeGeometry(0.1, 0.22, 4), earM); ear.position.set(sx, 0.3, 0); ear.rotation.z = -sx * 1.1; head.add(ear); }
    else if (kind === 'owl') for (const sx of [-0.15, 0.15]) { const tuft = mesh(new THREE.ConeGeometry(0.06, 0.2, 4), earM); tuft.position.set(sx, 0.3, 0); tuft.rotation.z = -sx * 1.6; head.add(tuft); }
    else for (const sx of [-0.2, 0.2]) { const ear = mesh(new THREE.SphereGeometry(0.09, 8, 6), earM); ear.position.set(sx, 0.24, 0); head.add(ear); }
    if (kind === 'owl') { // the critic: top hat and monocle
      const hat = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.32, 14), mat(0x1a1a24)); hat.position.y = 0.4; head.add(hat);
      const brim = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 14), mat(0x1a1a24)); brim.position.y = 0.25; head.add(brim);
      const band = mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.06, 14), mat(0xc8402a), false); band.position.y = 0.3; head.add(band);
      const mono = mesh(new THREE.TorusGeometry(0.12, 0.014, 6, 16), gold, false); mono.position.set(0.12, 0.06, 0.31); head.add(mono);
    } else {
      const scarf = mesh(new THREE.TorusGeometry(0.26, 0.07, 6, 14), mat(SCARVES[n % SCARVES.length])); scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.86; g.add(scarf);
    }
    if (kind === 'fox') { const tail = mesh(new THREE.ConeGeometry(0.14, 0.5, 6), m1); tail.position.set(0, 0.35, -0.35); tail.rotation.x = -2.1; g.add(tail); }
    g.userData = { head, skull, eyes, baseColor: skull.material.color.clone(), mats: [skull.material] };
    return g;
  }

  /* ---------- state & animation ---------- */
  const tmp = new THREE.Vector3();
  const gate = new THREE.Vector3(10.5, 0, 1.0);
  let w = 1, h = 1, raf = 0, last = 0, t = 0, paused = false, disposed = false, guestN = 0;
  const coins = [], steam = [];
  const coinGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.03, 12), coinMat = mat(0xffcf3a, { metalness: 0.7, roughness: 0.3, emissive: 0x7a5000, emissiveIntensity: 0.4 });
  const steamGeo = new THREE.SphereGeometry(0.08, 8, 6);
  let otaTask = null, pouring = 0, pourActive = false;

  function seatPos(i) { const s = seats[i].group.position; return new THREE.Vector3(s.x, 0.5, s.z - 0.45); }
  function frontOf(i) { const s = seats[i].group.position; return new THREE.Vector3(s.x + 0.2, 0, s.z + 1.5); }
  function walkTo(obj, pts, speed, done) { obj.userData.path = pts.map(p => p.clone()); obj.userData.speed = speed; obj.userData.onArrive = done; }
  function stepWalk(obj, dt) {
    const path = obj.userData.path; if (!path || !path.length) return false;
    // distance on the ground only: the walking bob must not keep anyone from arriving
    const target = path[0], d = tmp.set(target.x - obj.position.x, 0, target.z - obj.position.z), dist = d.length(), stepLen = obj.userData.speed * dt;
    if (dist <= stepLen) { obj.position.copy(target); path.shift(); if (!path.length) { const cb = obj.userData.onArrive; obj.userData.onArrive = null; if (cb) cb(); } }
    else { d.multiplyScalar(stepLen / dist); obj.position.x += d.x; obj.position.z += d.z; obj.rotation.y = Math.atan2(d.x, d.z); }
    return true;
  }

  function spawn(i, kind, onSeated) {
    const s = seats[i]; if (s.guest) leave(i, true, true);
    const g = makeGuest(kind || KINDS[guestN % KINDS.length], guestN++);
    g.position.copy(gate); scene.add(g);
    s.guest = { obj: g, mood: 'walk', moodT: 0, kind: kind };
    walkTo(g, [frontOf(i), seatPos(i)], 3.2, () => { if (s.guest && s.guest.obj === g) { s.guest.mood = 'calm'; g.rotation.y = 0; if (onSeated) onSeated(); } });
  }
  function setMood(i, mood) { const s = seats[i]; if (!s.guest || s.guest.mood === 'walk' || s.guest.mood === 'leave') return; if (s.guest.mood !== mood) { s.guest.mood = mood; s.guest.moodT = 0; } }
  function clearDish(i) { const sp = seats[i].dishSpot; while (sp.children.length) sp.remove(sp.children[0]); }
  function leave(i, happy, instant) {
    const s = seats[i], gst = s.guest; if (!gst) return;
    s.guest = null;
    if (instant) { scene.remove(gst.obj); clearDish(i); return; }
    gst.mood = 'leave'; gst.happy = happy;
    const g = gst.obj; leaving.push(gst);
    setTimeout(() => { if (!disposed) clearDish(i); }, happy ? 900 : 200);
    walkTo(g, [frontOf(i), gate], happy ? 3.0 : 4.2, () => { scene.remove(g); const k = leaving.indexOf(gst); if (k >= 0) leaving.splice(k, 1); });
  }
  const leaving = [];
  const DISH = { plov: 0xe0a24a, somsa: 0xd98a3a, lagmon: 0xc8402a, non: 0xd9a05a, tea: 0xb8642a };
  function dishMesh(kind) {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.05, 16), cream));
    if (kind === 'somsa') for (let k = 0; k < 3; k++) { const s = mesh(new THREE.TetrahedronGeometry(0.13), mat(DISH.somsa)); s.position.set((k - 1) * 0.15, 0.1, 0); s.rotation.set(0.6, k, 0.3); g.add(s); }
    else if (kind === 'non') { const n = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.07, 14), mat(DISH.non)); n.position.y = 0.06; g.add(n); const c = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.075, 12), mat(0xb8803a), false); c.position.y = 0.062; g.add(c); }
    else if (kind === 'tea') { const c = mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.12, 10), cream); c.position.y = 0.08; g.add(c); const p = mesh(new THREE.SphereGeometry(0.13, 10, 8), mat(0x2a8fc4)); p.position.set(0.18, 0.12, 0); g.add(p); }
    else { const f = mesh(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(DISH[kind] || DISH.plov)); f.position.y = 0.02; f.scale.y = 0.6; g.add(f); if (kind === 'plov') for (let k = 0; k < 4; k++) { const c = mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), mat(0xe86a2a), false); c.position.set(Math.cos(k) * 0.1, 0.12, Math.sin(k) * 0.1); g.add(c); } }
    return g;
  }
  // Ota carries a dish to seat i; `then` fires when it lands on the table.
  function serve(i, kind, then) {
    const s = seats[i], target = frontOf(i).add(new THREE.Vector3(-0.9, 0, -0.5));
    const plate = dishMesh(kind); plate.scale.setScalar(0.9);
    const tray = ota.userData.tray; while (tray.children.length > 1) tray.remove(tray.children[1]);
    plate.position.y = 0.04; tray.add(plate);
    otaTask = { i };
    walkTo(ota, [target], reduced ? 9 : 7.5, () => {
      tray.remove(plate); clearDish(i); plate.position.set(0, 0, 0); plate.scale.setScalar(1); s.dishSpot.add(plate);
      ota.rotation.y = Math.atan2(s.group.position.x - ota.position.x, s.group.position.z - ota.position.z);
      burst(i, 6);
      if (then) then();
      setTimeout(() => { if (!disposed) walkTo(ota, [otaHome], 6, () => { ota.rotation.y = 0; otaTask = null; }); }, 220);
    });
  }
  function burst(i, n) {
    if (reduced) n = Math.min(n, 3);
    const p = seats[i].dishSpot.getWorldPosition(new THREE.Vector3());
    for (let k = 0; k < n; k++) { const c = new THREE.Mesh(coinGeo, coinMat); c.position.copy(p).add(new THREE.Vector3(0, 0.2, 0)); c.userData.v = new THREE.Vector3((Math.random() - 0.5) * 2.2, 3 + Math.random() * 2, (Math.random() - 0.5) * 1.5); c.userData.life = 0; scene.add(c); coins.push(c); }
  }
  function puff(at, n) { for (let k = 0; k < n; k++) { const m = new THREE.Mesh(steamGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false })); m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.1, 0, (Math.random() - 0.5) * 0.1)); m.userData.life = 0; scene.add(m); steam.push(m); } }
  function pour(active, level) {
    pourActive = !!active; pouring = Math.max(0, Math.min(1.1, level || 0));
    stream.visible = pourActive;
    teaFill.position.y = 1.17 + Math.min(1, pouring) * 0.1; teaFill.scale.setScalar(0.8 + Math.min(1, pouring) * 0.25);
  }

  function setDecor(d) {
    d = d || {};
    decor.lanterns.visible = !!d.lanterns; lanternLights.forEach(l => { l.intensity = d.lanterns ? 6 : 0; });
    decor.vines.visible = !!d.vines; decor.samovar.visible = !!d.samovar; samovar.visible = !d.samovar;
    seats.forEach((s, i) => { s.rug.material = d.carpet ? new THREE.MeshStandardMaterial({ map: suzani, roughness: 1 }) : new THREE.MeshStandardMaterial({ color: 0xc9a47a, roughness: 1 }); });
    const four = !!d.tapchan; seats[3].group.visible = four; seats[3].hidden = !four;
  }

  function anchors() {
    const out = [];
    seats.forEach((s, i) => {
      if (!s.guest || s.guest.mood === 'walk' || s.guest.mood === 'leave') { out.push(null); return; }
      const hd = s.guest.obj.userData.head.getWorldPosition(tmp).add(new THREE.Vector3(0, 0.62, 0)).project(camera);
      out.push({ x: (hd.x + 1) / 2 * w, y: (1 - hd.y) / 2 * h });
    });
    return out;
  }
  function resize(nw, nh) {
    w = Math.max(1, nw); h = Math.max(1, nh);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // portrait screens: step back just enough to keep the tapchans in frame, and look a little further forward
    // so they sit above the dish tray
    const k = Math.max(1, Math.min(1.7, 0.76 / camera.aspect));
    camera.position.set(1.2, 10.4 + (k - 1) * 5, 11.6 * k);
    camera.fov = camera.aspect < 1 ? 46 : 40;
    camera.lookAt(look.x, look.y, look.z + (k - 1) * 3.2);
    camera.updateProjectionMatrix();
  }
  function frame(now) {
    raf = 0; if (disposed || paused) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now; t += dt;
    // Ota and guests
    if (!stepWalk(ota, dt)) { ota.position.y = Math.abs(Math.sin(t * 2)) * 0.02; }
    else ota.position.y = Math.abs(Math.sin(t * 16)) * 0.08;
    ota.userData.head.rotation.z = Math.sin(t * 1.3) * 0.06;
    seats.forEach(s => {
      const gst = s.guest; if (!gst) return; const g = gst.obj, ud = g.userData;
      if (gst.mood === 'walk') { stepWalk(g, dt); g.position.y = Math.abs(Math.sin(t * 14)) * 0.1; return; }
      gst.moodT += dt;
      const base = 0.5;
      if (gst.mood === 'happy') { g.position.y = base + Math.max(0, Math.sin(gst.moodT * 9)) * 0.35 * Math.max(0, 1 - gst.moodT); g.rotation.y = gst.moodT < 0.7 ? gst.moodT * 9 : 0; }
      else if (gst.mood === 'angry') { g.position.y = base; g.rotation.y = Math.sin(t * 30) * 0.15; }
      else { g.position.y = base + Math.sin(t * (gst.mood === 'impatient' ? 9 : 2.2) + g.id) * (gst.mood === 'impatient' ? 0.05 : 0.02); g.rotation.y = Math.sin(t * 0.8 + g.id) * 0.15; }
      ud.head.rotation.z = gst.mood === 'impatient' ? Math.sin(t * 6) * 0.12 : Math.sin(t * 1.1 + g.id) * 0.05;
      ud.skull.material.color.copy(ud.baseColor).lerp(new THREE.Color(0xff5a4a), gst.mood === 'angry' ? 0.55 : gst.mood === 'impatient' ? 0.18 : 0);
      const blink = ((t + g.id) % 3.6) < 0.1; ud.eyes.forEach(e => { e.scale.y = blink ? 0.15 : 1; });
    });
    leaving.forEach(gst => { stepWalk(gst.obj, dt); gst.obj.position.y = Math.abs(Math.sin(t * (gst.happy ? 14 : 20))) * 0.1; });
    // grandma nods, samovar steams, lanterns flicker
    grandma.userData.head.rotation.x = Math.sin(t * 1.4) * 0.08; grandma.userData.head.rotation.y = Math.sin(t * 0.5) * 0.25;
    const sv = decor.samovar.visible ? decor.samovar : samovar;
    if (Math.random() < (pourActive ? 0.5 : 0.08)) puff(sv.localToWorld(new THREE.Vector3(0, 1.05, 0)), 1);
    if (pourActive && Math.random() < 0.4) puff(cup.position.clone().add(new THREE.Vector3(0, 0.1, 0)), 1);
    lanternLights.forEach((l, k) => { if (l.intensity > 0) l.intensity = 5.5 + Math.sin(t * 7 + k * 2) * 0.6; });
    for (let k = coins.length - 1; k >= 0; k--) { const c = coins[k]; c.userData.life += dt; c.userData.v.y -= 9 * dt; c.position.addScaledVector(c.userData.v, dt); c.rotation.x += dt * 8; c.rotation.z += dt * 5; if (c.userData.life > 1.2) { scene.remove(c); coins.splice(k, 1); } }
    for (let k = steam.length - 1; k >= 0; k--) { const m = steam[k]; m.userData.life += dt; m.position.y += dt * 0.6; m.position.x += Math.sin(t * 3 + k) * dt * 0.1; m.scale.setScalar(1 + m.userData.life * 2); m.material.opacity = Math.max(0, 0.5 - m.userData.life * 0.35); if (m.userData.life > 1.4) { scene.remove(m); m.material.dispose(); steam.splice(k, 1); } }
    if (!reduced) { camera.position.x = 1.2 + Math.sin(t * 0.25) * 0.2; }
    renderer.render(scene, camera);
    if (opts.onFrame) opts.onFrame(anchors());
    raf = requestAnimationFrame(frame);
  }
  function setPaused(p) { paused = !!p; if (!paused && !raf && !disposed) { last = 0; raf = requestAnimationFrame(frame); } }
  function dispose() { disposed = true; if (raf) cancelAnimationFrame(raf); renderer.dispose(); }
  resize(canvas.clientWidth || 800, canvas.clientHeight || 500);
  setDecor({});
  raf = requestAnimationFrame(frame);
  return { resize, setDecor, spawn, setMood, leave, serve, pour, setPaused, dispose, seatCount: () => seats.filter(s => !s.hidden).length, three: true };
}
