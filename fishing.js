/* «Клёв» (v2.35): a fishing game over the user's own words, after Blooket's Fishing Frenzy.
   The line goes out by itself, a fish bites, a question appears: the faster the right answer, the heavier
   and rarer the catch. Hard words of the deck lure rare fish. Pearls buy better tackle; every species
   goes into the catch journal. The rules are pure and tested in Node (test/fishing.js); mount() draws
   the scene on a canvas and the questions, panels and HUD as real DOM controls. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VMFishing = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* ---------------- rules ---------------- */

  var RARITY = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  var RARITY_COLOR = { common: '#d6deec', uncommon: '#7ee0a1', rare: '#6ec3ff', epic: '#c79bff', legendary: '#ffcf5a', junk: '#c9b79a', chest: '#ffcf5a' };
  // body: [back, flank, belly]. kg: weight range before tackle and golden-hour bonuses.
  var SPECIES = [
    { id: 'silverfin', r: 0, kg: [0.2, 0.9], body: ['#c9d8ec', '#9fb4cf', '#f4f8fc'], fin: '#7f97b8', shape: { h: 0.36, tail: 'fork' } },
    { id: 'stripey', r: 0, kg: [0.3, 1.1], body: ['#ffcf6e', '#f2a33a', '#fff1cf'], fin: '#e0892a', shape: { h: 0.42, tail: 'fork' }, pattern: { type: 'bands', color: '#2b2f4a', n: 3 } },
    { id: 'lemon', r: 0, kg: [0.2, 1.0], body: ['#fff07a', '#f5cf2a', '#fffbe0'], fin: '#e8b51f', shape: { h: 0.5, tail: 'round' }, pattern: { type: 'spots', color: '#ffffff', n: 6 } },
    { id: 'perch', r: 1, kg: [0.8, 2.6], body: ['#b5cf5a', '#6f9a3a', '#f1f3c9'], fin: '#e65a3a', shape: { h: 0.4, tail: 'fork', spiky: true }, pattern: { type: 'bands', color: '#2f4a22', n: 5 } },
    { id: 'carp', r: 1, kg: [1.2, 3.4], body: ['#c9a25a', '#8a6a33', '#f3e1b5'], fin: '#a8743a', shape: { h: 0.44, tail: 'fork', whiskers: true }, pattern: { type: 'scales', color: '#5e4520' } },
    { id: 'rainbow', r: 1, kg: [1.0, 3.0], body: ['#9fd7c9', '#5a9db5', '#f6efe6'], fin: '#7aa6b8', shape: { h: 0.34, tail: 'fork' }, pattern: { type: 'stripe', color: '#ff7aa8' } },
    { id: 'pike', r: 2, kg: [3, 8], body: ['#7f9a5a', '#4c6a3a', '#dfe6c4'], fin: '#a6763a', shape: { h: 0.24, tail: 'fork', snout: 'long' }, pattern: { type: 'spots', color: '#e9f0c2', n: 10 } },
    { id: 'catfish', r: 2, kg: [4, 9], body: ['#6d6a7a', '#3f3c4d', '#b9b3c4'], fin: '#4a4658', shape: { h: 0.3, tail: 'round', whiskers: true, snout: 'blunt' }, pattern: { type: 'spots', color: '#2a2836', n: 8 } },
    { id: 'ruby', r: 2, kg: [2.5, 6], body: ['#ff7a6a', '#d6334a', '#ffd9cf'], fin: '#ff9f5a', shape: { h: 0.46, tail: 'fan' }, pattern: { type: 'scales', color: '#a8203a' } },
    { id: 'koi', r: 3, kg: [6, 13], body: ['#fff3e0', '#ffffff', '#fff8ee'], fin: '#ffd7b0', shape: { h: 0.38, tail: 'fan', whiskers: true }, pattern: { type: 'patches', color: '#ff6a2a' } },
    { id: 'angler', r: 3, kg: [5, 12], body: ['#454b80', '#262a55', '#7a80b0'], fin: '#2f3463', shape: { h: 0.55, tail: 'round', snout: 'blunt', lure: true, teeth: true }, pattern: { type: 'spots', color: '#8fe8ff', n: 5 }, glow: '#8fe8ff' },
    { id: 'moonfish', r: 4, kg: [15, 32], body: ['#e8ecff', '#aab6ff', '#ffffff'], fin: '#cfd6ff', shape: { h: 0.62, tail: 'fan' }, pattern: { type: 'crescent', color: '#ffffff' }, glow: '#dfe4ff' },
    { id: 'dragon', r: 4, kg: [18, 40], body: ['#ffb03a', '#e0402a', '#ffe2a8'], fin: '#ff6a2a', shape: { h: 0.3, tail: 'fan', spiky: true, snout: 'long', whiskers: true }, pattern: { type: 'scales', color: '#a8201a' }, glow: '#ffb03a' }
  ];
  var BY_ID = {};
  SPECIES.forEach(function (s) { BY_ID[s.id] = s; });

  function round1(x) { return Math.round(x * 10) / 10; }
  // 3 for an answer under 1.5 s, down to 0 after 4.2 s.
  function speedScore(ms) { return ms < 1500 ? 3 : ms < 2600 ? 2 : ms < 4200 ? 1 : 0; }
  // Relative chance of each rarity tier; a higher score tilts the odds toward rare fish.
  function tierWeights(score) {
    var base = [60, 26, 10, 3.4, 0.6];
    return base.map(function (w, i) { return w * Math.pow(1 + 0.55 * Math.max(0, score), i); });
  }
  function luck(ms, o) {
    return speedScore(ms) + Math.min(2, Math.floor((o.combo || 0) / 3)) + 0.5 * (o.bait || 0) + (o.hard ? 1 : 0);
  }
  // What comes up on a right answer after `ms` milliseconds. o: { combo, bait, rod, hard, golden, rand }.
  function rollCatch(ms, o) {
    o = o || {};
    var r = o.rand || Math.random;
    if (ms > 6500 && r() < 0.5) return { id: 'boot', kg: round1(0.4 + r() * 0.5), tier: -1 };
    if (ms < 4200 && r() < 0.06) return { id: 'chest', kg: 0, tier: -1, pearls: 20 + Math.floor(r() * 31) };
    var w = tierWeights(luck(ms, o));
    if (ms >= 3000) w[4] = 0; // legendary fish only bite on a quick answer
    var total = w.reduce(function (a, b) { return a + b; }, 0), x = r() * total, tier = 0;
    while (tier < w.length - 1 && x >= w[tier]) { x -= w[tier]; tier++; }
    var list = SPECIES.filter(function (s) { return s.r === tier; });
    var sp = list[Math.floor(r() * list.length) % list.length];
    var kg = sp.kg[0] + (sp.kg[1] - sp.kg[0]) * Math.pow(r(), 1.6);
    kg *= 1 + 0.15 * (o.rod || 0);
    if (o.golden) kg *= 2;
    return { id: sp.id, kg: Math.max(0.1, round1(kg)), tier: tier };
  }

  // Tackle: pearls buy permanent upgrades (saved in localStorage 'vm.fish').
  var UPGRADES = { rod: { max: 4, costs: [40, 90, 160, 260] }, bait: { max: 4, costs: [50, 110, 190, 300] }, reel: { max: 3, costs: [60, 140, 240] } };
  function defaults() { return { pearls: 0, rod: 0, bait: 0, reel: 0, seen: {}, best: 0, biggest: null, rounds: 0 }; }
  function clean(s) {
    var d = defaults(), out = Object.assign(d, s && typeof s === 'object' ? s : {});
    out.pearls = Math.max(0, Math.floor(Number(out.pearls) || 0));
    Object.keys(UPGRADES).forEach(function (k) { out[k] = Math.min(UPGRADES[k].max, Math.max(0, Math.floor(Number(out[k]) || 0))); });
    if (!out.seen || typeof out.seen !== 'object') out.seen = {};
    return out;
  }
  function cost(s, id) { var u = UPGRADES[id]; return u && s[id] < u.max ? u.costs[s[id]] : null; }
  // A new state, or null when maxed out or unaffordable. Never mutates.
  function buy(s, id) {
    var c = cost(s, id);
    if (c == null || s.pearls < c) return null;
    var n = JSON.parse(JSON.stringify(s)); n.pearls -= c; n[id] += 1;
    return n;
  }
  function roundSeconds(s) { return 90 + 10 * ((s && s.reel) || 0); }
  function pearlsFor(totalKg) { return Math.max(0, Math.round(totalKg)); }
  // Adds a catch to the journal (mutates `s`); true when the species is new.
  function log(s, c) {
    if (!BY_ID[c.id]) return false;
    var e = s.seen[c.id], fresh = !e;
    if (!e) e = s.seen[c.id] = { n: 0, best: 0 };
    e.n++; e.best = Math.max(e.best, c.kg);
    if (!s.biggest || c.kg > s.biggest.kg) s.biggest = { id: c.id, kg: c.kg };
    return fresh;
  }
  function hardWord(card) { return !!card && ((card.fails || 0) > 0 || (card.lapses || 0) > 0 || (card.ease != null && card.ease < 2.3)); }
  var BITE_MS = 9000, GOLDEN_MS = 12000;

  /* ---------------- drawing ---------------- */

  function hex(c) { var n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function mix(a, b, t) { var x = hex(a), y = hex(b); return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * t); }).join(',') + ')'; }
  function mixHex(a, b, t) { var x = hex(a), y = hex(b); return '#' + [0, 1, 2].map(function (i) { var v = Math.round(x[i] + (y[i] - x[i]) * t); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function rgba(c, a) { var x = hex(c); return 'rgba(' + x[0] + ',' + x[1] + ',' + x[2] + ',' + a + ')'; }
  // A tiny deterministic generator so patterns stay the same on every frame.
  function seeded(n) { var s = n * 9301 + 49297; return function () { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

  function bodyPath(c, L, h, sp) {
    var nose = sp.shape.snout === 'long' ? L * 0.56 : sp.shape.snout === 'blunt' ? L * 0.46 : L * 0.5, tb = -L * 0.38;
    c.beginPath();
    c.moveTo(nose, sp.shape.snout === 'blunt' ? -h * 0.08 : 0);
    c.bezierCurveTo(L * 0.36, -h * 0.64, -L * 0.1, -h * 0.6, tb, -h * 0.13);
    c.lineTo(tb, h * 0.13);
    c.bezierCurveTo(-L * 0.1, h * 0.6, L * 0.36, h * 0.6, nose, sp.shape.snout === 'blunt' ? h * 0.12 : 0);
    c.closePath();
  }
  function tailPath(c, L, h, type) {
    c.beginPath(); c.moveTo(0, 0);
    if (type === 'fan') {
      c.bezierCurveTo(-L * 0.08, -h * 0.25, -L * 0.3, -h * 0.85, -L * 0.27, -h * 0.28);
      c.quadraticCurveTo(-L * 0.31, 0, -L * 0.27, h * 0.28);
      c.bezierCurveTo(-L * 0.3, h * 0.85, -L * 0.08, h * 0.25, 0, 0);
    } else if (type === 'round') {
      c.bezierCurveTo(-L * 0.1, -h * 0.5, -L * 0.24, -h * 0.5, -L * 0.22, 0);
      c.bezierCurveTo(-L * 0.24, h * 0.5, -L * 0.1, h * 0.5, 0, 0);
    } else {
      c.quadraticCurveTo(-L * 0.1, -h * 0.22, -L * 0.21, -h * 0.66);
      c.quadraticCurveTo(-L * 0.13, 0, -L * 0.21, h * 0.66);
      c.quadraticCurveTo(-L * 0.1, h * 0.22, 0, 0);
    }
    c.closePath();
  }
  function pattern(c, L, h, sp, idx) {
    var p = sp.pattern; if (!p) return;
    var rnd = seeded(idx + 3), i;
    c.fillStyle = p.color; c.strokeStyle = p.color;
    if (p.type === 'bands') {
      c.globalAlpha = 0.5;
      for (i = 0; i < p.n; i++) {
        var bx = L * 0.28 - (i + 0.5) * (L * 0.62 / p.n);
        c.beginPath(); c.moveTo(bx + L * 0.03, -h); c.quadraticCurveTo(bx - L * 0.02, 0, bx + L * 0.03, h); c.lineTo(bx - L * 0.03, h); c.quadraticCurveTo(bx - L * 0.08, 0, bx - L * 0.03, -h); c.fill();
      }
    } else if (p.type === 'spots') {
      c.globalAlpha = 0.75;
      for (i = 0; i < p.n; i++) { c.beginPath(); c.arc(L * (0.3 - rnd() * 0.62), h * (rnd() - 0.6) * 0.7, L * (0.018 + rnd() * 0.025), 0, 6.283); c.fill(); }
    } else if (p.type === 'scales') {
      c.globalAlpha = 0.28; c.lineWidth = Math.max(1, L * 0.012);
      var step = L * 0.075;
      for (var y = -h / 2; y < h / 2; y += step * 0.7) for (var x = L * 0.25; x > -L * 0.4; x -= step) {
        c.beginPath(); c.arc(x + ((Math.round(y / step) & 1) ? step / 2 : 0), y, step * 0.55, -1.2, 1.2); c.stroke();
      }
    } else if (p.type === 'stripe') {
      var g = c.createLinearGradient(0, -h * 0.12, 0, h * 0.12);
      g.addColorStop(0, rgba(p.color, 0)); g.addColorStop(0.5, rgba(p.color, 0.85)); g.addColorStop(1, rgba(p.color, 0));
      c.fillStyle = g; c.fillRect(-L * 0.4, -h * 0.12, L * 0.9, h * 0.24);
    } else if (p.type === 'patches') {
      c.globalAlpha = 0.95;
      [[0.22, -0.2, 0.11], [-0.02, 0.05, 0.13], [-0.24, -0.18, 0.09]].forEach(function (b) { c.beginPath(); c.ellipse(L * b[0], h * b[1], L * b[2], L * b[2] * 0.75, 0.4, 0, 6.283); c.fill(); });
      c.fillStyle = '#20232f'; c.beginPath(); c.arc(L * 0.08, -h * 0.28, L * 0.03, 0, 6.283); c.fill();
    } else if (p.type === 'crescent') {
      c.globalAlpha = 0.55;
      for (i = 0; i < 3; i++) { c.beginPath(); c.arc(L * (0.15 - i * 0.2), 0, h * 0.28, -1.1, 1.1); c.lineWidth = L * 0.02; c.stroke(); }
    }
    c.globalAlpha = 1;
  }
  // A fish facing right (dir 1) or left (-1), length L, centered at x,y. o: { t, swim, silhouette, alpha, angle }.
  function drawFish(c, sp, x, y, L, dir, o) {
    o = o || {};
    var t = o.t || 0, h = L * sp.shape.h, wig = Math.sin(t * (o.swim || 9)) * (o.swim === 0 ? 0 : 1), sil = o.silhouette;
    var idx = SPECIES.indexOf(sp);
    c.save();
    c.translate(x, y); c.scale(dir, 1); if (o.angle) c.rotate(o.angle);
    c.globalAlpha = o.alpha == null ? 1 : o.alpha;
    if (sp.glow && !sil && o.glow !== false) { c.shadowColor = sp.glow; c.shadowBlur = L * 0.3; }
    var finColor = sil ? sil : sp.fin;
    // tail
    c.save(); c.translate(-L * 0.38, 0); c.rotate(wig * 0.32);
    tailPath(c, L, h, sp.shape.tail); c.fillStyle = finColor; c.fill(); c.restore();
    // dorsal fin
    c.beginPath(); c.moveTo(-L * 0.18, -h * 0.4);
    if (sp.shape.spiky) { for (var k = 0; k < 5; k++) { c.lineTo(-L * 0.14 + k * L * 0.07, -h * (0.78 + (k & 1 ? -0.12 : 0.05))); c.lineTo(-L * 0.11 + k * L * 0.07, -h * 0.5); } c.lineTo(L * 0.2, -h * 0.4); }
    else { c.quadraticCurveTo(-L * 0.02, -h * 0.86, L * 0.14, -h * 0.42); }
    c.closePath(); c.fillStyle = finColor; c.fill();
    // belly fin
    c.beginPath(); c.moveTo(-L * 0.12, h * 0.4); c.quadraticCurveTo(-L * 0.2, h * 0.72, -L * 0.02, h * 0.46); c.closePath(); c.fill();
    c.shadowBlur = 0;
    // body
    bodyPath(c, L, h, sp);
    if (sil) { c.fillStyle = sil; c.fill(); }
    else {
      var g = c.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, sp.body[0]); g.addColorStop(0.45, sp.body[1]); g.addColorStop(1, sp.body[2]);
      c.fillStyle = g; c.fill();
      c.save(); bodyPath(c, L, h, sp); c.clip();
      pattern(c, L, h, sp, idx);
      // sheen and a darker back line give the body volume
      var sh = c.createLinearGradient(0, -h / 2, 0, h * 0.1);
      sh.addColorStop(0, 'rgba(255,255,255,.0)'); sh.addColorStop(0.55, 'rgba(255,255,255,.32)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = sh; c.beginPath(); c.ellipse(L * 0.05, -h * 0.16, L * 0.36, h * 0.13, -0.05, 0, 6.283); c.fill();
      c.fillStyle = 'rgba(10,20,40,.18)'; c.beginPath(); c.ellipse(0, -h * 0.5, L * 0.5, h * 0.16, 0, 0, 6.283); c.fill();
      c.restore();
      c.lineWidth = Math.max(1, L * 0.014); c.strokeStyle = 'rgba(14,20,40,.35)'; bodyPath(c, L, h, sp); c.stroke();
      // gill
      c.beginPath(); c.arc(L * 0.2, 0, h * 0.34, -0.9, 0.9); c.strokeStyle = 'rgba(14,20,40,.22)'; c.stroke();
    }
    // pectoral fin
    c.save(); c.translate(L * 0.12, h * 0.1); c.rotate(0.5 + wig * 0.25);
    c.beginPath(); c.ellipse(-L * 0.06, 0, L * 0.08, h * 0.12, 0, 0, 6.283); c.fillStyle = sil ? sil : rgba(sp.fin, 0.9); c.fill(); c.restore();
    if (!sil) {
      // eye
      var ex = L * (sp.shape.snout === 'long' ? 0.36 : 0.31), ey = -h * 0.12, er = Math.max(2, L * 0.055);
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(ex, ey, er, 0, 6.283); c.fill();
      c.fillStyle = '#141a2e'; c.beginPath(); c.arc(ex + er * 0.2, ey, er * 0.62, 0, 6.283); c.fill();
      c.fillStyle = '#ffffff'; c.beginPath(); c.arc(ex + er * 0.42, ey - er * 0.3, er * 0.24, 0, 6.283); c.fill();
      // mouth, whiskers, teeth, lure
      c.strokeStyle = 'rgba(20,20,40,.55)'; c.lineWidth = Math.max(1, L * 0.012);
      var mx = sp.shape.snout === 'long' ? L * 0.54 : sp.shape.snout === 'blunt' ? L * 0.46 : L * 0.49;
      c.beginPath(); c.moveTo(mx, h * 0.04); c.lineTo(mx - L * 0.06, h * 0.08); c.stroke();
      if (sp.shape.whiskers) {
        c.strokeStyle = rgba(sp.fin, 0.9); c.lineWidth = Math.max(1, L * 0.01);
        c.beginPath(); c.moveTo(mx - L * 0.03, h * 0.07); c.quadraticCurveTo(mx + L * 0.08, h * 0.3 + wig * 3, mx + L * 0.02, h * 0.5); c.stroke();
        c.beginPath(); c.moveTo(mx - L * 0.04, h * 0.05); c.quadraticCurveTo(mx + L * 0.12, h * 0.15 - wig * 3, mx + L * 0.12, h * 0.36); c.stroke();
      }
      if (sp.shape.teeth) {
        c.fillStyle = '#f4f1ea';
        for (var tt = 0; tt < 4; tt++) { c.beginPath(); c.moveTo(mx - L * (0.02 + tt * 0.03), h * 0.08); c.lineTo(mx - L * (0.035 + tt * 0.03), h * 0.17); c.lineTo(mx - L * (0.05 + tt * 0.03), h * 0.08); c.fill(); }
      }
      if (sp.shape.lure) {
        c.strokeStyle = rgba(sp.fin, 1); c.lineWidth = Math.max(1.2, L * 0.016);
        var lx = L * 0.62, ly = -h * 0.72 + Math.sin(t * 3) * h * 0.06;
        c.beginPath(); c.moveTo(L * 0.22, -h * 0.42); c.quadraticCurveTo(L * 0.45, -h * 1.05, lx, ly); c.stroke();
        c.shadowColor = sp.glow; c.shadowBlur = L * 0.25; c.fillStyle = '#d8fbff';
        c.beginPath(); c.arc(lx, ly, L * 0.04, 0, 6.283); c.fill(); c.shadowBlur = 0;
      }
    }
    c.restore();
  }
  function drawBoot(c, x, y, L, angle) {
    c.save(); c.translate(x, y); c.rotate(angle || 0);
    var s = L / 100;
    c.fillStyle = '#6b4a2f'; c.beginPath();
    c.moveTo(-18 * s, -40 * s); c.lineTo(10 * s, -40 * s); c.lineTo(12 * s, 6 * s); c.quadraticCurveTo(44 * s, 8 * s, 46 * s, 22 * s); c.lineTo(46 * s, 30 * s); c.lineTo(-20 * s, 30 * s); c.closePath(); c.fill();
    c.fillStyle = '#3d2a1b'; c.fillRect(-21 * s, 26 * s, 68 * s, 8 * s);
    c.strokeStyle = '#a07a52'; c.lineWidth = 2 * s; for (var i = 0; i < 4; i++) { c.beginPath(); c.moveTo(-10 * s, (-30 + i * 9) * s); c.lineTo(4 * s, (-28 + i * 9) * s); c.stroke(); }
    c.fillStyle = '#4a8a5a'; c.beginPath(); c.ellipse(20 * s, -6 * s, 7 * s, 3 * s, 0.6, 0, 6.283); c.fill(); // weed
    c.restore();
  }
  function drawChest(c, x, y, L, t) {
    c.save(); c.translate(x, y);
    var s = L / 100;
    c.shadowColor = '#ffcf5a'; c.shadowBlur = 24 * s;
    c.fillStyle = '#7a4a24'; c.fillRect(-40 * s, -10 * s, 80 * s, 42 * s);
    c.beginPath(); c.moveTo(-40 * s, -10 * s); c.quadraticCurveTo(0, -46 * s, 40 * s, -10 * s); c.fill();
    c.shadowBlur = 0;
    c.fillStyle = '#ffcf5a'; c.fillRect(-42 * s, -12 * s, 84 * s, 6 * s); c.fillRect(-6 * s, -14 * s, 12 * s, 22 * s);
    c.fillStyle = '#5a3418'; c.fillRect(-2 * s, -4 * s, 4 * s, 6 * s);
    for (var i = 0; i < 3; i++) { var a = t * 2 + i * 2.1; c.fillStyle = 'rgba(255,240,180,' + (0.5 + 0.5 * Math.sin(a * 2)) + ')'; c.beginPath(); c.arc(Math.cos(a) * 46 * s, -20 * s + Math.sin(a) * 18 * s, 3 * s, 0, 6.283); c.fill(); }
    c.restore();
  }
  function drawCatch(c, id, x, y, L, dir, o) {
    if (id === 'boot') return drawBoot(c, x, y, L * 0.8, o && o.angle);
    if (id === 'chest') return drawChest(c, x, y, L * 0.75, (o && o.t) || 0);
    drawFish(c, BY_ID[id], x, y, L, dir, o);
  }

  /* ---------------- screen ---------------- */

  var SKY = [ // [phase, top, horizon]
    [0, '#26306a', '#f2a06c'], [0.33, '#3a76c2', '#bfe0ee'], [0.68, '#4b5ea6', '#ffd08a'], [1, '#2a1e57', '#ff7e5f']
  ];
  function skyAt(p) {
    for (var i = 1; i < SKY.length; i++) if (p <= SKY[i][0]) {
      var a = SKY[i - 1], b = SKY[i], t = (p - a[0]) / (b[0] - a[0]);
      return [mixHex(a[1], b[1], t), mixHex(a[2], b[2], t)];
    }
    return [SKY[SKY.length - 1][1], SKY[SKY.length - 1][2]];
  }

  function mount(api) {
    var doc = document, $ = function (id) { return doc.getElementById(id); };
    var stage = $('fishStage'), hub = $('arcadeHub');
    if (!stage) return { refresh: function () {}, leave: function () {}, active: function () { return false; } };
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var tr = api.tr;
    function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; if (fn) b.onclick = fn; return b; }
    function load() { try { return clean(JSON.parse(localStorage.getItem('vm.fish') || 'null')); } catch (e) { return defaults(); } }
    function save(s) { try { localStorage.setItem('vm.fish', JSON.stringify(s)); } catch (e) {} }
    function kg(n) { return tr('fish.kg', { n: (Math.round(n * 10) / 10).toFixed(1) }); }
    function fishName(id) { return tr('fish.sp.' + id); }

    /* ----- DOM skeleton ----- */
    stage.innerHTML = '';
    var scene = el('div', 'fx-scene'), canvas = el('canvas', 'fx-canvas');
    canvas.setAttribute('aria-hidden', 'true');
    scene.appendChild(canvas);
    var hudEl = el('div', 'fx-hud');
    var hudKg = el('div', 'fx-hud-stat fx-hud-kg'); hudKg.appendChild(el('span', null, tr('fish.hudCatch'))); var hudKgV = el('strong', null, '0.0'); hudKg.appendChild(hudKgV);
    var hudTime = el('div', 'fx-hud-time'); var hudTimeV = el('strong', null, '90'); hudTime.appendChild(hudTimeV); hudTime.appendChild(el('span', null, tr('fish.sec')));
    var hudPearl = el('div', 'fx-hud-stat fx-hud-pearl'); hudPearl.appendChild(el('span', null, tr('fish.pearls'))); var hudPearlV = el('strong', null, '0'); hudPearl.appendChild(hudPearlV);
    var quit = btn('fx-quit', tr('fish.stop'), function () { if (run) finish(); });
    quit.setAttribute('aria-label', tr('fish.stopAria'));
    hudEl.appendChild(hudKg); hudEl.appendChild(hudTime); hudEl.appendChild(hudPearl); hudEl.appendChild(quit);
    var timeBar = el('div', 'fx-timebar'); var timeFill = el('i'); timeBar.appendChild(timeFill);
    scene.appendChild(timeBar); scene.appendChild(hudEl);
    var banner = el('div', 'fx-banner'); banner.setAttribute('aria-hidden', 'true'); scene.appendChild(banner);
    var catchCard = el('div', 'fx-catch'); catchCard.hidden = true; scene.appendChild(catchCard);
    var ask = el('div', 'fx-ask');
    var askHead = el('div', 'fx-ask-head');
    var status = el('span', 'fx-status', tr('fish.waiting'));
    var combo = el('span', 'fx-combo'); combo.hidden = true;
    askHead.appendChild(status); askHead.appendChild(combo);
    var biteTrack = el('div', 'fx-bite'); var biteFill = el('i'); biteTrack.appendChild(biteFill);
    var prompt = el('p', 'fx-prompt');
    var opts = el('div', 'fx-opts');
    var feedback = el('p', 'fx-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    ask.appendChild(askHead); ask.appendChild(biteTrack); ask.appendChild(prompt); ask.appendChild(opts); ask.appendChild(feedback);
    var overlay = el('div', 'fx-overlay'); overlay.hidden = true;
    stage.appendChild(scene); stage.appendChild(ask); stage.appendChild(overlay);
    var ctx = canvas.getContext('2d');

    /* ----- scene state ----- */
    var W = 800, H = 500, DPR = 1, wide = true, L = {};
    var t = 0, last = 0, raf = 0, visible = false, shake = 0;
    var particles = [], ripples = [], ambient = [], clouds = [], birds = [];
    var run = null; // the round in progress
    var anim = { state: 'idle', since: 0, fish: null, from: null, catchId: null, catchDir: 1 };

    function layout() {
      var r = scene.getBoundingClientRect();
      W = Math.max(280, r.width); H = Math.max(240, r.height);
      DPR = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      wide = stage.getBoundingClientRect().width >= 860;
      stage.classList.toggle('wide', wide);
      var actW = wide ? W - 420 : W;
      var S = Math.max(0.62, Math.min(1.25, Math.min(actW / 760, H / 560)));
      L = { S: S, actW: actW, waterY: H * (wide ? 0.43 : 0.47), boatX: actW * (wide ? 0.24 : 0.22), hookX: actW * (wide ? 0.66 : 0.7) };
      L.hookY = L.waterY + (H - L.waterY) * 0.48;
      if (!ambient.length) seedAmbient();
    }
    function seedAmbient() {
      ambient = []; clouds = [];
      var pool = SPECIES.filter(function (s) { return s.r <= 1; });
      for (var i = 0; i < 7; i++) ambient.push({ sp: pool[i % pool.length], x: Math.random() * W, y: 0.55 + Math.random() * 0.4, L: 26 + Math.random() * 26, dir: Math.random() < 0.5 ? 1 : -1, v: 14 + Math.random() * 22, ph: Math.random() * 6 });
      for (var j = 0; j < 4; j++) clouds.push({ x: Math.random(), y: 0.06 + Math.random() * 0.2, s: 0.6 + Math.random() * 0.8, v: 0.004 + Math.random() * 0.006 });
    }
    function phase() { return run ? Math.min(1, run.elapsed / run.duration) : 0.62; }
    function golden() { return run && run.goldenUntil > run.elapsed && run.elapsed >= run.goldenAt; }
    function waveY(x) { return L.waterY + Math.sin(x * 0.018 + t * 1.6) * 3 * L.S + Math.sin(x * 0.041 - t * 2.3) * 1.6 * L.S; }
    function rodTip() {
      var bob = Math.sin(t * 1.6 + L.boatX * 0.018) * 3 * L.S;
      var bend = anim.state === 'reel' ? 0.35 : anim.state === 'bite' ? 0.18 + Math.sin(t * 18) * 0.05 : 0;
      return { x: L.boatX + (54 + 70 * (1 - bend)) * L.S, y: L.waterY - (118 - 50 * bend) * L.S + bob };
    }

    /* ----- painting ----- */
    function paintSky(p) {
      var s = skyAt(p), gold = golden();
      var top = gold ? mixHex(s[0], '#7a4a2a', 0.45) : s[0], hor = gold ? mixHex(s[1], '#ffc35a', 0.6) : s[1];
      var g = ctx.createLinearGradient(0, 0, 0, L.waterY);
      g.addColorStop(0, top); g.addColorStop(1, hor);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, L.waterY + 2);
      // stars at dusk
      if (p > 0.82) {
        var a = (p - 0.82) / 0.18, rnd = seeded(7);
        for (var i = 0; i < 40; i++) { var sx = rnd() * W, sy = rnd() * L.waterY * 0.6; ctx.fillStyle = 'rgba(255,255,255,' + (a * (0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + i)))).toFixed(2) + ')'; ctx.fillRect(sx, sy, 1.6, 1.6); }
      }
      // sun
      var sunX = L.actW * (0.12 + 0.76 * p), sunY = L.waterY * (0.78 - Math.sin(Math.PI * Math.min(1, p * 1.15)) * 0.55) + (p > 0.85 ? (p - 0.85) * L.waterY * 1.2 : 0);
      var sr = (26 + 14 * p) * L.S, sunCol = p > 0.75 ? '#ffb070' : '#fff1c4';
      var glow = ctx.createRadialGradient(sunX, sunY, sr * 0.4, sunX, sunY, sr * 5);
      glow.addColorStop(0, rgba(sunCol.length === 7 ? sunCol : '#fff1c4', 0.55)); glow.addColorStop(1, rgba('#fff1c4', 0));
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, L.waterY);
      ctx.fillStyle = sunCol; ctx.beginPath(); ctx.arc(sunX, sunY, sr, 0, 6.283); ctx.fill();
      L.sunX = sunX; L.sunCol = sunCol;
      // clouds
      clouds.forEach(function (c) {
        c.x += c.v * (reduced ? 0.3 : 1) / 60; if (c.x > 1.2) c.x = -0.2;
        var cx = c.x * W, cy = c.y * L.waterY, cs = c.s * 46 * L.S;
        ctx.fillStyle = rgba(mixHex('#ffffff', hor, 0.35), 0.7);
        [[0, 0, 1], [0.9, 0.15, 0.75], [-0.9, 0.2, 0.7], [0.35, -0.35, 0.8]].forEach(function (b) { ctx.beginPath(); ctx.arc(cx + b[0] * cs, cy + b[1] * cs, b[2] * cs, 0, 6.283); ctx.fill(); });
      });
      // birds
      if (!reduced && Math.random() < 0.002 && birds.length < 3) birds.push({ x: -20, y: L.waterY * (0.15 + Math.random() * 0.3), v: 40 + Math.random() * 30 });
      ctx.strokeStyle = rgba('#1c2340', 0.6); ctx.lineWidth = 1.6;
      birds = birds.filter(function (b) {
        b.x += b.v / 60; var f = Math.sin(t * 9 + b.y) * 4;
        ctx.beginPath(); ctx.moveTo(b.x - 7, b.y - f); ctx.quadraticCurveTo(b.x - 3, b.y - 2, b.x, b.y); ctx.quadraticCurveTo(b.x + 3, b.y - 2, b.x + 7, b.y - f); ctx.stroke();
        return b.x < W + 20;
      });
      // hills: far, mid, near shore with pines
      hill(mixHex(hor, '#3b4a7a', 0.5), 0.72, 0.006, 26, 1);
      hill(mixHex(hor, '#2a3560', 0.68), 0.84, 0.011, 18, 2);
      shore(mixHex(hor, '#18233f', 0.82));
      return hor;
    }
    function hill(col, base, freq, amp, seed) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, L.waterY);
      for (var x = 0; x <= W + 10; x += 10) ctx.lineTo(x, L.waterY * base - (Math.sin(x * freq + seed) * 0.6 + Math.sin(x * freq * 2.3 + seed * 3) * 0.4 + 0.6) * amp * L.S);
      ctx.lineTo(W, L.waterY); ctx.closePath(); ctx.fill();
    }
    function shore(col) {
      var right = W - (wide ? 380 : 0);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(right - 0.36 * L.actW, L.waterY + 1);
      ctx.quadraticCurveTo(right - 0.2 * L.actW, L.waterY - 34 * L.S, right + 30, L.waterY - 46 * L.S); ctx.lineTo(W, L.waterY - 50 * L.S); ctx.lineTo(W, L.waterY + 1); ctx.closePath(); ctx.fill();
      for (var i = 0; i < 6; i++) { var px = right - 0.22 * L.actW + i * 26 * L.S + (i % 2) * 9, ph = (34 + (i * 13) % 22) * L.S, py = L.waterY - 20 * L.S - i * 4 * L.S; pine(px, py, ph, col); }
    }
    function pine(x, y, h, col) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - h);
      for (var k = 0; k < 3; k++) { ctx.lineTo(x + h * (0.22 + k * 0.08), y - h * (0.62 - k * 0.3)); ctx.lineTo(x + h * 0.08, y - h * (0.62 - k * 0.3)); }
      ctx.lineTo(x - h * 0.08, y); ctx.lineTo(x - h * 0.08, y - h * 0.02);
      for (var j = 2; j >= 0; j--) { ctx.lineTo(x - h * 0.08, y - h * (0.62 - j * 0.3)); ctx.lineTo(x - h * (0.22 + j * 0.08), y - h * (0.62 - j * 0.3)); }
      ctx.closePath(); ctx.fill();
    }
    function paintWater(hor, p) {
      var surf = mixHex(hor, '#2b93a8', 0.62), mid = mixHex('#155a7a', hor, 0.12), deep = '#0a1b36';
      if (golden()) { surf = mixHex(surf, '#ffc35a', 0.35); }
      var g = ctx.createLinearGradient(0, L.waterY, 0, H);
      g.addColorStop(0, surf); g.addColorStop(0.35, mid); g.addColorStop(1, deep);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, H);
      for (var x = 0; x <= W + 8; x += 8) ctx.lineTo(x, waveY(x));
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      // light rays
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 5; i++) {
        var rx = ((i * 0.23 + 0.08) * W + Math.sin(t * 0.3 + i) * 30), a = 0.05 + 0.035 * Math.sin(t * 0.8 + i * 1.7);
        var rg = ctx.createLinearGradient(0, L.waterY, 0, H * 0.95); rg.addColorStop(0, 'rgba(200,240,255,' + a.toFixed(3) + ')'); rg.addColorStop(1, 'rgba(200,240,255,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.moveTo(rx, L.waterY); ctx.lineTo(rx + 40 * L.S, L.waterY); ctx.lineTo(rx + 140 * L.S, H); ctx.lineTo(rx + 40 * L.S, H); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // sun glitter on the surface
      ctx.fillStyle = rgba('#fff4d6', golden() ? 0.85 : 0.55);
      for (var k = 0; k < 14; k++) {
        var gy = L.waterY + 4 + k * 3.2 * L.S, gw = (18 - k) * 2.2 * L.S * (0.6 + 0.4 * Math.sin(t * 3 + k * 1.7));
        ctx.fillRect(L.sunX - gw / 2 + Math.sin(t * 2 + k) * 6, gy, Math.max(2, gw), 1.4);
      }
      // surface highlight line
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.4; ctx.beginPath();
      for (var x2 = 0; x2 <= W; x2 += 8) { var yy = waveY(x2); if (x2 === 0) ctx.moveTo(x2, yy); else ctx.lineTo(x2, yy); }
      ctx.stroke();
      // sandy bottom, rocks and kelp
      var by = H - 18 * L.S;
      ctx.fillStyle = mixHex('#3a5a6a', '#c8a86a', 0.35);
      ctx.beginPath(); ctx.moveTo(0, H);
      for (var x3 = 0; x3 <= W + 20; x3 += 20) ctx.lineTo(x3, by - Math.sin(x3 * 0.012) * 8 * L.S - 6 * L.S);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      for (var r = 0; r < 4; r++) { ctx.fillStyle = mixHex('#24384a', hor, 0.08); ctx.beginPath(); ctx.ellipse((r * 0.27 + 0.1) * W, by - 4 * L.S, (16 + r * 5) * L.S, (9 + r * 2) * L.S, 0, Math.PI, 0); ctx.fill(); }
      for (var j = 0; j < 9; j++) {
        var kx = (j * 0.115 + 0.04) * W, kh = (40 + (j * 17) % 50) * L.S;
        ctx.strokeStyle = j % 2 ? '#1f7a5c' : '#2a9a6a'; ctx.lineWidth = 5 * L.S; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(kx, by);
        var sway = Math.sin(t * 1.2 + j) * 10 * L.S * (reduced ? 0.3 : 1);
        ctx.bezierCurveTo(kx + sway, by - kh * 0.4, kx - sway, by - kh * 0.7, kx + sway * 1.4, by - kh); ctx.stroke();
      }
    }
    function paintAmbient(dt) {
      ambient.forEach(function (f) {
        f.x += f.dir * f.v * dt * (reduced ? 0.5 : 1);
        if (f.x > W + 60) f.x = -60; if (f.x < -60) f.x = W + 60;
        var y = L.waterY + (H - L.waterY) * f.y + Math.sin(t + f.ph) * 6;
        drawFish(ctx, f.sp, f.x, y, f.L * L.S, f.dir, { t: t + f.ph, swim: 7, alpha: 0.42, glow: false });
      });
    }
    function paintBoat() {
      var bob = Math.sin(t * 1.6 + L.boatX * 0.018) * 3 * L.S, tilt = Math.sin(t * 1.3) * 0.03;
      var x = L.boatX, y = L.waterY + bob, s = L.S;
      ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
      // reflection
      ctx.fillStyle = 'rgba(10,20,40,.22)'; ctx.beginPath(); ctx.ellipse(0, 10 * s, 78 * s, 9 * s, 0, 0, 6.283); ctx.fill();
      // otter: body, head, ears, beanie
      ctx.fillStyle = '#1c2a52'; ctx.beginPath(); ctx.ellipse(-6 * s, -34 * s, 22 * s, 26 * s, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#b5794a'; ctx.beginPath(); ctx.arc(-4 * s, -70 * s, 19 * s, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(-18 * s, -84 * s, 6 * s, 0, 6.283); ctx.arc(10 * s, -84 * s, 6 * s, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#ecd2ac'; ctx.beginPath(); ctx.ellipse(2 * s, -63 * s, 12 * s, 9 * s, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#2a1a12'; ctx.beginPath(); ctx.ellipse(6 * s, -67 * s, 3.4 * s, 2.6 * s, 0, 0, 6.283); ctx.fill();
      var blink = (t % 4.2) < 0.12;
      ctx.fillStyle = '#141a2e';
      if (blink) { ctx.fillRect(-10 * s, -74 * s, 6 * s, 1.6 * s); ctx.fillRect(6 * s, -75 * s, 6 * s, 1.6 * s); }
      else { ctx.beginPath(); ctx.arc(-7 * s, -74 * s, 2.6 * s, 0, 6.283); ctx.arc(9 * s, -75 * s, 2.6 * s, 0, 6.283); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillRect(-6.4 * s, -75.6 * s, 1.2 * s, 1.2 * s); ctx.fillRect(9.6 * s, -76.6 * s, 1.2 * s, 1.2 * s); }
      ctx.fillStyle = '#e8a33a'; ctx.beginPath(); ctx.arc(-4 * s, -80 * s, 18 * s, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
      ctx.fillStyle = '#c4822a'; ctx.fillRect(-22 * s, -84 * s, 36 * s, 6 * s);
      ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(-4 * s, -100 * s, 5 * s, 0, 6.283); ctx.fill();
      // cheeks
      if (run && run.combo >= 3) { ctx.fillStyle = 'rgba(255,120,120,.45)'; ctx.beginPath(); ctx.arc(-14 * s, -64 * s, 3.5 * s, 0, 6.283); ctx.arc(18 * s, -65 * s, 3.5 * s, 0, 6.283); ctx.fill(); }
      // hull
      var hg = ctx.createLinearGradient(0, -14 * s, 0, 12 * s); hg.addColorStop(0, '#a8693a'); hg.addColorStop(1, '#6a3d1f');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.moveTo(-74 * s, -14 * s); ctx.lineTo(74 * s, -14 * s); ctx.quadraticCurveTo(64 * s, 10 * s, 40 * s, 12 * s); ctx.lineTo(-44 * s, 12 * s); ctx.quadraticCurveTo(-66 * s, 8 * s, -74 * s, -14 * s); ctx.fill();
      ctx.strokeStyle = 'rgba(40,20,10,.45)'; ctx.lineWidth = 1.4 * s; ctx.beginPath(); ctx.moveTo(-68 * s, -4 * s); ctx.lineTo(68 * s, -4 * s); ctx.stroke();
      ctx.fillStyle = '#d18a4a'; ctx.fillRect(-76 * s, -18 * s, 152 * s, 5 * s);
      // lantern at the stern, lit toward dusk
      var lit = Math.max(0, (phase() - 0.55) / 0.45);
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-66 * s, -46 * s, 2.4 * s, 30 * s);
      if (lit > 0) { var lg = ctx.createRadialGradient(-62 * s, -48 * s, 1, -62 * s, -48 * s, 40 * s); lg.addColorStop(0, 'rgba(255,200,110,' + (0.6 * lit) + ')'); lg.addColorStop(1, 'rgba(255,200,110,0)'); ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(-62 * s, -48 * s, 40 * s, 0, 6.283); ctx.fill(); }
      ctx.fillStyle = lit > 0 ? '#ffd27a' : '#c9b48a'; ctx.fillRect(-67 * s, -54 * s, 10 * s, 10 * s);
      ctx.restore();
      // rod: from the paw to the tip
      var tip = rodTip(), hx = x + 14 * s, hy = y - 40 * s;
      ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 3.4 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx - 10 * s, hy + 12 * s); ctx.quadraticCurveTo((hx + tip.x) / 2, Math.min(hy, tip.y) - 4 * s + (anim.state === 'reel' ? 20 * s : 0), tip.x, tip.y); ctx.stroke();
      ctx.fillStyle = '#b5794a'; ctx.beginPath(); ctx.arc(hx, hy, 5 * s, 0, 6.283); ctx.fill();
    }
    function bobberPos() {
      var tip = rodTip(), st = anim.state, k;
      if (st === 'cast') { k = Math.min(1, (t - anim.since) / 0.65); var x = tip.x + (L.hookX - tip.x) * k, y = tip.y + (waveY(L.hookX) - tip.y) * k - Math.sin(Math.PI * k) * 90 * L.S; return { x: x, y: y, air: k < 1 }; }
      if (st === 'idle' || st === 'reel' || st === 'show') return null;
      var dip = st === 'bite' ? (Math.sin(t * 14) > 0.2 ? 7 : 1) * L.S : 0;
      return { x: L.hookX, y: waveY(L.hookX) + dip, air: false };
    }
    function paintLine() {
      var tip = rodTip(), b = bobberPos();
      ctx.strokeStyle = 'rgba(245,245,255,.75)'; ctx.lineWidth = 1.1;
      if (anim.state === 'reel' || anim.state === 'show') {
        var f = anim.fishPos; if (!f) return;
        ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(f.x, f.y - 6); ctx.stroke(); return;
      }
      if (!b) { ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x, tip.y + 40 * L.S); ctx.stroke(); return; }
      var slack = anim.state === 'escape' ? 40 * L.S : 18 * L.S;
      ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.quadraticCurveTo((tip.x + b.x) / 2, Math.max(tip.y, b.y) + slack - 20 * L.S, b.x, b.y); ctx.stroke();
      if (!b.air) {
        var hy = anim.state === 'escape' ? L.hookY - 30 * L.S : L.hookY;
        ctx.strokeStyle = 'rgba(230,240,255,.4)'; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x, hy); ctx.stroke();
        ctx.strokeStyle = '#d7dde8'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(b.x - 3, hy + 2, 4, 0, Math.PI); ctx.stroke();
      }
      // the float
      ctx.save(); ctx.translate(b.x, b.y);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 2, 6 * L.S, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#ff4a3a'; ctx.beginPath(); ctx.arc(0, 2, 6 * L.S, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#1c2a52'; ctx.fillRect(-1, -9 * L.S, 2, 7 * L.S);
      ctx.restore();
    }
    function paintTarget(dt) {
      var st = anim.state, f = anim.fish;
      if (!f) return;
      if (st === 'wait' || st === 'bite') {
        var k = st === 'wait' ? Math.min(1, (t - anim.since) / Math.max(0.2, anim.waitFor)) : 1;
        var ease = 1 - Math.pow(1 - k, 3);
        f.x = f.x0 + (L.hookX - f.dir * 34 * L.S - f.x0) * ease;
        f.y = L.hookY + 8 * L.S + Math.sin(t * 2) * 4;
        if (st === 'bite') f.x += Math.sin(t * 16) * 3;
        drawFish(ctx, SPECIES[0], f.x, f.y, 64 * L.S, f.dir, { t: t, swim: st === 'bite' ? 18 : 10, silhouette: 'rgba(6,16,34,.62)' });
      } else if (st === 'escape') {
        f.x += f.dir * -1 * 520 * dt; f.y -= 40 * dt;
        drawFish(ctx, SPECIES[0], f.x, f.y, 64 * L.S, -f.dir, { t: t, swim: 26, silhouette: 'rgba(6,16,34,.55)' });
        if (Math.random() < 0.5) particles.push({ type: 'bubble', x: f.x, y: f.y, vx: 0, vy: -30, life: 0, max: 1.4, size: 2 + Math.random() * 3 });
      }
    }
    function paintCatch() {
      var st = anim.state; if (st !== 'reel' && st !== 'show') return;
      var tip = rodTip(), k = st === 'reel' ? Math.min(1, (t - anim.since) / 0.9) : 1;
      var e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      var sx = L.hookX, sy = L.hookY, ex = tip.x + 6 * L.S, ey = tip.y + 70 * L.S;
      var x = sx + (ex - sx) * e, y = sy + (ey - sy) * e - Math.sin(Math.PI * e) * 60 * L.S;
      if (st === 'show') y += Math.sin(t * 3) * 3;
      anim.fishPos = { x: x, y: y };
      var flop = Math.sin(t * (st === 'reel' ? 20 : 8)) * (st === 'reel' ? 0.5 : 0.18);
      var Lc = (anim.catchId === 'boot' || anim.catchId === 'chest' ? 70 : 64 + Math.min(40, (anim.catchKg || 1) * 2.2)) * L.S;
      drawCatch(ctx, anim.catchId, x, y, Lc, anim.catchDir, { t: t, swim: 14, angle: -1.35 + flop });
      // crossing the surface throws water
      if (st === 'reel' && !anim.splashed && y < L.waterY) { anim.splashed = true; splash(x, L.waterY, 18); fx('splash'); }
    }
    function splash(x, y, n) {
      for (var i = 0; i < n; i++) particles.push({ type: 'drop', x: x, y: y, vx: (Math.random() - 0.5) * 220, vy: -120 - Math.random() * 220, life: 0, max: 0.9, size: 1.5 + Math.random() * 2.5 });
      ripples.push({ x: x, y: y, r: 4, life: 0 });
    }
    function sparkle(x, y, n, color) {
      if (reduced) return;
      for (var i = 0; i < n; i++) { var a = Math.random() * 6.283, v = 60 + Math.random() * 220; particles.push({ type: 'spark', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0, max: 0.9 + Math.random() * 0.6, size: 2 + Math.random() * 3, color: color }); }
    }
    function floatText(text, x, y, color) { particles.push({ type: 'text', x: x, y: y, vx: 0, vy: -46, life: 0, max: 1.5, text: text, color: color || '#fff' }); }
    function paintParticles(dt) {
      // ripples
      ctx.lineWidth = 1.4;
      ripples = ripples.filter(function (r) {
        r.life += dt; r.r += 40 * dt;
        ctx.strokeStyle = 'rgba(255,255,255,' + Math.max(0, 0.55 - r.life * 0.45).toFixed(2) + ')';
        ctx.beginPath(); ctx.ellipse(r.x, r.y + 1, r.r * L.S, r.r * 0.32 * L.S, 0, 0, 6.283); ctx.stroke();
        return r.life < 1.2;
      });
      particles = particles.filter(function (p) {
        p.life += dt;
        if (p.type === 'drop') { p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; ctx.fillStyle = 'rgba(220,245,255,.85)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.fill(); return p.y < L.waterY + 6 || p.vy < 0; }
        if (p.type === 'bubble') { p.y += p.vy * dt; p.x += Math.sin(t * 4 + p.size) * 0.4; ctx.strokeStyle = 'rgba(220,245,255,.6)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.stroke(); return p.y > L.waterY && p.life < p.max; }
        if (p.type === 'spark') { p.vy += 200 * dt; p.x += p.vx * dt; p.y += p.vy * dt; var a = 1 - p.life / p.max; ctx.fillStyle = rgba(p.color || '#ffcf5a', Math.max(0, a).toFixed(2)); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 6); ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.6); ctx.restore(); return p.life < p.max; }
        if (p.type === 'text') {
          p.y += p.vy * dt; var al = Math.min(1, (p.max - p.life) * 2);
          ctx.font = '800 ' + Math.round(22 * L.S + 6) + 'px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(12,16,34,' + (0.7 * al).toFixed(2) + ')'; ctx.strokeText(p.text, p.x, p.y);
          ctx.fillStyle = rgba(p.color, al.toFixed(2)); ctx.fillText(p.text, p.x, p.y); return p.life < p.max;
        }
        return false;
      });
      // occasional ambient bubbles from the bottom
      if (Math.random() < 0.06) particles.push({ type: 'bubble', x: Math.random() * W, y: H - 20 * L.S, vx: 0, vy: -24 - Math.random() * 20, life: 0, max: 8, size: 1.5 + Math.random() * 2 });
    }
    function frame(now) {
      raf = 0;
      if (!visible) return;
      var dt = Math.min(0.05, (now - (last || now)) / 1000); last = now; t += dt;
      if (run && !run.over) step(dt);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.save();
      if (shake > 0 && !reduced) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.88; if (shake < 0.4) shake = 0; }
      var p = phase(), hor = paintSky(p);
      paintWater(hor, p);
      paintAmbient(dt);
      paintTarget(dt);
      paintBoat();
      paintLine();
      paintCatch();
      paintParticles(dt);
      ctx.restore();
      raf = requestAnimationFrame(frame);
    }
    function startLoop() { if (!raf && visible) { last = 0; raf = requestAnimationFrame(frame); } }

    /* ----- the round ----- */
    function fx(kind) { if (api.fx) api.fx(kind); }
    function setState(s, extra) { anim.state = s; anim.since = t; if (extra) Object.assign(anim, extra); }
    function start() {
      var d = api.deck();
      var items = d && window.VMGames ? window.VMGames.questions(d.cards, 400, null, api.moreSentences(d)) : [];
      if (items.length < 4) { api.toast(tr('toast.needMatch'), 'err', 5000); return; }
      var s = load();
      run = { deck: d, items: items, i: 0, s: s, duration: roundSeconds(s), elapsed: 0, total: 0, caught: 0, answered: 0, correct: 0, combo: 0, bestCombo: 0,
        pearls: 0, biggest: null, fresh: [], goldenAt: 0, goldenUntil: 0, over: false };
      run.goldenAt = run.duration * (0.35 + Math.random() * 0.3); run.goldenUntil = run.goldenAt + GOLDEN_MS / 1000;
      overlay.hidden = true; overlay.innerHTML = '';
      stage.classList.add('playing');
      hudPearlV.textContent = String(s.pearls);
      updateHud();
      opts.innerHTML = ''; prompt.textContent = ''; feedback.textContent = ''; status.textContent = tr('fish.waiting');
      doc.addEventListener('keydown', onKey);
      cast();
      fx('cast');
    }
    function cast() { setState('cast'); askIdle(); }
    function askIdle() {
      ask.classList.remove('biting'); status.textContent = tr('fish.waiting');
      opts.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    }
    function step(dt) {
      var g = golden();
      run.elapsed += dt;
      if (golden() && !g) { banner.textContent = tr('fish.goldenHour'); banner.className = 'fx-banner on gold'; fx('chest'); setTimeout(function () { banner.className = 'fx-banner'; }, 2600); }
      var left = Math.max(0, run.duration - run.elapsed);
      if (Math.ceil(left) !== run.lastSec) { run.lastSec = Math.ceil(left); if (left <= 5 && left > 0) fx('tick'); }
      hudTimeV.textContent = String(Math.ceil(left));
      hudTime.classList.toggle('low', left <= 10);
      timeFill.style.transform = 'scaleX(' + (left / run.duration).toFixed(4) + ')';
      var st = anim.state, since = t - anim.since;
      if (st === 'cast' && since >= 0.65) { splash(L.hookX, L.waterY, 6); fx('splash'); setState('wait', { waitFor: 0.5 + Math.random() * 0.7, fish: { x0: Math.random() < 0.5 ? -60 : L.actW + 60, dir: 1 } }); anim.fish.dir = anim.fish.x0 < L.hookX ? 1 : -1; anim.fish.x = anim.fish.x0; }
      else if (st === 'wait' && since >= anim.waitFor) { if (left <= 0) return finish(); bite(); }
      else if (st === 'bite') {
        var used = (run.elapsed - run.qStart) * 1000;
        biteFill.style.transform = 'scaleX(' + Math.max(0, 1 - used / BITE_MS).toFixed(4) + ')';
        if (used >= BITE_MS) answer(null);
        if (Math.random() < 0.08) ripples.push({ x: L.hookX, y: waveY(L.hookX), r: 3, life: 0.2 });
      }
      else if (st === 'reel' && since >= 0.9) { setState('show'); showCatch(); }
      else if (st === 'show' && since >= anim.showFor) { catchCard.hidden = true; if (run.elapsed >= run.duration) return finish(); cast(); }
      else if (st === 'escape' && since >= 1.5) { if (run.elapsed >= run.duration) return finish(); cast(); }
      if (left <= 0 && (st === 'cast' || st === 'wait')) finish();
    }
    function bite() {
      var q = run.items[run.i % run.items.length];
      run.q = q; run.qStart = run.elapsed; run.done = false;
      setState('bite');
      fx('bite');
      ripples.push({ x: L.hookX, y: waveY(L.hookX), r: 2, life: 0 });
      ask.classList.add('biting');
      status.textContent = tr('fish.bite');
      prompt.innerHTML = '';
      if (q.type === 'context') {
        prompt.lang = run.deck.source; prompt.appendChild(doc.createTextNode(q.before));
        var gap = el('span', 'fx-gap', '____'); gap.setAttribute('aria-label', tr('game.gap')); prompt.appendChild(gap);
        prompt.appendChild(doc.createTextNode(q.after)); prompt.dataset.kind = 'context';
      } else { prompt.lang = run.deck.target; prompt.textContent = q.prompt; prompt.dataset.kind = 'meaning'; }
      var eyebrow = el('span', 'fx-ask-kind', tr(q.type === 'context' ? 'fish.askContext' : 'fish.askMeaning'));
      prompt.insertBefore(eyebrow, prompt.firstChild);
      opts.innerHTML = '';
      q.options.forEach(function (o, i) {
        var b = btn('fx-opt', null, function () { answer(o); });
        b.appendChild(el('kbd', null, String(i + 1))); var sp = el('span', null, o); sp.lang = run.deck.source; b.appendChild(sp);
        b.dataset.value = o; opts.appendChild(b);
      });
      feedback.textContent = ''; feedback.className = 'fx-feedback';
      biteFill.style.transform = 'scaleX(1)';
      var first = opts.querySelector('button'); if (first && !('ontouchstart' in window)) first.focus({ preventScroll: true });
    }
    function answer(value) {
      if (!run || run.done || anim.state !== 'bite') return;
      run.done = true;
      var q = run.q, ok = value === q.answer, ms = (run.elapsed - run.qStart) * 1000;
      run.answered++; run.i++;
      opts.querySelectorAll('button').forEach(function (b) { b.disabled = true; if (b.dataset.value === q.answer) b.classList.add('correct'); else if (b.dataset.value === value) b.classList.add('wrong'); });
      var gap = prompt.querySelector('.fx-gap'); if (gap) { gap.textContent = q.gap; gap.classList.add(ok ? 'ok' : 'bad'); }
      api.answer(q.card, ok, true);
      ask.classList.remove('biting');
      if (!ok) {
        run.combo = 0; combo.hidden = true; combo.classList.remove('hot');
        status.textContent = value === null ? tr('fish.tooSlow') : tr('fish.escaped');
        feedback.textContent = tr('fish.answerWas', { w: q.answer, t: q.card.translation }); feedback.className = 'fx-feedback bad';
        setState('escape'); splash(L.hookX, L.waterY, 8); fx('bad'); shake = 6;
        return;
      }
      run.correct++; run.combo++; run.bestCombo = Math.max(run.bestCombo, run.combo);
      var c = rollCatch(ms, { combo: run.combo, bait: run.s.bait, rod: run.s.rod, hard: hardWord(q.card), golden: golden() });
      run.last = c;
      status.textContent = tr('fish.hooked', { s: (ms / 1000).toFixed(1) });
      feedback.textContent = ''; feedback.className = 'fx-feedback ok';
      if (run.combo >= 2) { combo.hidden = false; combo.textContent = tr('fish.combo', { n: run.combo }); combo.classList.toggle('hot', run.combo >= 3); combo.classList.remove('bump'); void combo.offsetWidth; combo.classList.add('bump'); }
      setState('reel', { catchId: c.id, catchKg: c.kg, catchDir: anim.fish ? anim.fish.dir : 1, splashed: false, fishPos: null });
      anim.fish = null;
      fx('reel');
    }
    function showCatch() {
      var c = run.last, rarity = c.id === 'boot' ? 'junk' : c.id === 'chest' ? 'chest' : RARITY[c.tier];
      var tip = rodTip(), color = RARITY_COLOR[rarity], fresh = false;
      var fxX = L.hookX, fxY = L.waterY - 16 * L.S;
      if (c.id === 'chest') { run.pearls += c.pearls; floatText('+' + c.pearls + ' ◆', fxX, fxY, color); fx('chest'); sparkle(tip.x, tip.y + 60 * L.S, 30, '#ffcf5a'); }
      else {
        run.total += c.kg; run.caught++;
        if (c.id !== 'boot') { fresh = log(run.s, c); if (fresh) run.fresh.push(c.id); if (!run.biggest || c.kg > run.biggest.kg) run.biggest = { id: c.id, kg: c.kg }; }
        floatText('+' + kg(c.kg), fxX, fxY, color);
        if (c.tier >= 3) { fx('crit'); sparkle(tip.x, tip.y + 60 * L.S, c.tier === 4 ? 60 : 34, color); shake = c.tier === 4 ? 14 : 8; }
        else if (c.id === 'boot') fx('bad'); else fx('ok');
      }
      updateHud();
      // the card
      catchCard.innerHTML = ''; catchCard.className = 'fx-catch r-' + rarity;
      var cv = el('canvas', 'fx-catch-art'); cv.setAttribute('aria-hidden', 'true'); paintMini(cv, c.id, 150, 96);
      var info = el('div', 'fx-catch-info');
      info.appendChild(el('span', 'fx-rarity', tr('fish.rarity.' + rarity)));
      info.appendChild(el('strong', null, c.id === 'chest' ? tr('fish.sp.chest') : c.id === 'boot' ? tr('fish.sp.boot') : fishName(c.id)));
      info.appendChild(el('span', 'fx-weight', c.id === 'chest' ? tr('fish.pearlsN', { n: c.pearls }) : kg(c.kg)));
      if (fresh) info.appendChild(el('span', 'fx-new', tr('fish.newSpecies')));
      catchCard.appendChild(cv); catchCard.appendChild(info);
      catchCard.hidden = false;
      feedback.textContent = tr('fish.caughtSr', { f: info.querySelector('strong').textContent, w: info.querySelector('.fx-weight').textContent });
      anim.showFor = c.tier >= 3 || fresh ? 1.9 : 1.1;
    }
    function updateHud() {
      if (!run) return;
      hudKgV.textContent = (Math.round(run.total * 10) / 10).toFixed(1);
      hudKgV.classList.remove('bump'); void hudKgV.offsetWidth; hudKgV.classList.add('bump');
      hudPearlV.textContent = String(run.s.pearls + run.pearls);
    }
    function finish() {
      if (!run || run.over) return;
      run.over = true;
      doc.removeEventListener('keydown', onKey);
      var s = run.s, earned = pearlsFor(run.total) + run.pearls;
      s.pearls += earned; s.rounds = (s.rounds || 0) + 1;
      var record = run.total > (s.best || 0) && run.total > 0;
      if (record) s.best = Math.round(run.total * 10) / 10;
      save(s);
      api.complete();
      catchCard.hidden = true; stage.classList.remove('playing'); ask.classList.remove('biting');
      setState('idle'); anim.fish = null;
      fx(record ? 'win' : 'ok');
      if (record) sparkle(W / 2, H * 0.3, 70, '#ffcf5a');
      showEnd(run, earned, record);
      var g = run; run = null; g.done = true;
    }

    /* ----- panels ----- */
    function panel(cls) {
      overlay.innerHTML = ''; overlay.hidden = false;
      var p = el('div', 'fx-panel ' + (cls || '')); p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'false');
      overlay.appendChild(p); return p;
    }
    function heading(p, eyebrow, title) {
      if (eyebrow) p.appendChild(el('span', 'fx-eyebrow', eyebrow));
      var h = el('h2', 'fx-title', title); h.id = 'fxTitle' + Math.random().toString(36).slice(2, 7); p.appendChild(h); p.setAttribute('aria-labelledby', h.id);
    }
    function showStart() {
      var s = load(), p = panel('fx-start');
      heading(p, tr('fish.eyebrow'), tr('fish.title'));
      p.appendChild(el('p', 'fx-lead', tr('fish.lead')));
      var rules = el('ul', 'fx-rules');
      ['fish.rule1', 'fish.rule2', 'fish.rule3'].forEach(function (k, i) { var li = el('li'); li.appendChild(el('b', null, ['⚡', '◆', '★'][i])); li.appendChild(el('span', null, tr(k))); rules.appendChild(li); });
      p.appendChild(rules);
      var meta = el('div', 'fx-meta');
      meta.appendChild(metaItem(tr('fish.record'), s.best ? kg(s.best) : '—'));
      meta.appendChild(metaItem(tr('fish.journalShort'), Object.keys(s.seen).length + ' / ' + SPECIES.length));
      meta.appendChild(metaItem(tr('fish.pearls'), String(s.pearls)));
      p.appendChild(meta);
      var row = el('div', 'fx-actions');
      var go = btn('fx-btn primary', tr('fish.cast'), start);
      row.appendChild(go);
      row.appendChild(btn('fx-btn', tr('fish.shop'), function () { showShop(showStart); }));
      row.appendChild(btn('fx-btn', tr('fish.journal'), function () { showJournal(showStart); }));
      p.appendChild(row);
      p.appendChild(btn('fx-link', tr('fish.backHub'), close));
      go.focus({ preventScroll: true });
    }
    function metaItem(label, value) { var m = el('div', 'fx-meta-item'); m.appendChild(el('span', null, label)); m.appendChild(el('strong', null, value)); return m; }
    function showEnd(g, earned, record) {
      var p = panel('fx-end');
      heading(p, tr('fish.over'), tr('fish.totalCatch'));
      var big = el('div', 'fx-total'); big.appendChild(el('strong', null, (Math.round(g.total * 10) / 10).toFixed(1))); big.appendChild(el('span', null, tr('fish.kgUnit'))); p.appendChild(big);
      if (record) p.appendChild(el('p', 'fx-record', tr('game.record')));
      var meta = el('div', 'fx-meta');
      meta.appendChild(metaItem(tr('fish.correct'), g.correct + ' / ' + g.answered));
      meta.appendChild(metaItem(tr('fish.bestCombo'), '×' + g.bestCombo));
      meta.appendChild(metaItem(tr('fish.earned'), '+' + earned + ' ◆'));
      p.appendChild(meta);
      if (g.biggest) {
        var bf = el('div', 'fx-biggest r-' + RARITY[BY_ID[g.biggest.id].r]);
        var cv = el('canvas'); cv.setAttribute('aria-hidden', 'true'); paintMini(cv, g.biggest.id, 120, 76); bf.appendChild(cv);
        var bi = el('div'); bi.appendChild(el('span', 'fx-eyebrow', tr('fish.biggest'))); bi.appendChild(el('strong', null, fishName(g.biggest.id) + ' · ' + kg(g.biggest.kg))); bf.appendChild(bi);
        p.appendChild(bf);
      }
      if (g.fresh.length) p.appendChild(el('p', 'fx-fresh', tr('fish.freshN', { n: g.fresh.length, list: g.fresh.map(fishName).join(', ') })));
      var row = el('div', 'fx-actions');
      var again = btn('fx-btn primary', tr('fish.again'), start);
      row.appendChild(again);
      row.appendChild(btn('fx-btn', tr('fish.shop'), function () { showShop(function () { showEnd(g, earned, record); }); }));
      row.appendChild(btn('fx-btn', tr('fish.journal'), function () { showJournal(function () { showEnd(g, earned, record); }); }));
      p.appendChild(row);
      p.appendChild(btn('fx-link', tr('fish.backHub'), close));
      again.focus({ preventScroll: true });
    }
    function showShop(back) {
      var s = load(), p = panel('fx-shop');
      heading(p, tr('fish.shopEyebrow'), tr('fish.shop'));
      var wallet = el('p', 'fx-wallet'); wallet.appendChild(el('span', null, tr('fish.pearls'))); wallet.appendChild(el('strong', null, s.pearls + ' ◆')); p.appendChild(wallet);
      var list = el('div', 'fx-upgrades');
      Object.keys(UPGRADES).forEach(function (id) {
        var u = UPGRADES[id], c = cost(s, id), item = el('div', 'fx-upgrade');
        var ic = el('span', 'fx-up-icon up-' + id); ic.setAttribute('aria-hidden', 'true'); item.appendChild(ic);
        var txt = el('div', 'fx-up-text'); txt.appendChild(el('strong', null, tr('fish.up.' + id))); txt.appendChild(el('span', null, tr('fish.up.' + id + 'Sub')));
        var pips = el('span', 'fx-pips'); pips.setAttribute('aria-label', tr('fish.level', { n: s[id], m: u.max }));
        for (var i = 0; i < u.max; i++) pips.appendChild(el('i', i < s[id] ? 'on' : null));
        txt.appendChild(pips); item.appendChild(txt);
        var b = btn('fx-btn small', c == null ? tr('fish.maxed') : tr('fish.buy', { n: c }), function () {
          var n = buy(load(), id); if (!n) return;
          save(n); fx('chest'); showShop(back);
          var again = overlay.querySelector('[data-up="' + id + '"]'); if (again) again.focus();
        });
        b.dataset.up = id; b.disabled = c == null || s.pearls < c;
        item.appendChild(b); list.appendChild(item);
      });
      p.appendChild(list);
      p.appendChild(btn('fx-btn', tr('fish.back'), back));
    }
    function showJournal(back) {
      var s = load(), p = panel('fx-journal');
      heading(p, tr('fish.journalEyebrow', { n: Object.keys(s.seen).length, m: SPECIES.length }), tr('fish.journal'));
      var grid = el('div', 'fx-species');
      SPECIES.forEach(function (sp) {
        var seen = s.seen[sp.id], cell = el('div', 'fx-sp r-' + RARITY[sp.r] + (seen ? '' : ' locked'));
        var cv = el('canvas'); cv.setAttribute('aria-hidden', 'true'); paintMini(cv, sp.id, 110, 64, !seen); cell.appendChild(cv);
        cell.appendChild(el('strong', null, seen ? fishName(sp.id) : '???'));
        cell.appendChild(el('span', 'fx-sp-meta', seen ? tr('fish.rarity.' + RARITY[sp.r]) + ' · ' + kg(seen.best) : tr('fish.rarity.' + RARITY[sp.r])));
        grid.appendChild(cell);
      });
      p.appendChild(grid);
      var bk = btn('fx-btn', tr('fish.back'), back); p.appendChild(bk); bk.focus({ preventScroll: true });
    }
    function paintMini(cv, id, w, h, locked) {
      var r = Math.min(2, window.devicePixelRatio || 1);
      cv.width = w * r; cv.height = h * r; cv.style.width = w + 'px'; cv.style.height = h + 'px';
      var c = cv.getContext('2d'); c.setTransform(r, 0, 0, r, 0, 0);
      var Lm = w * (id === 'boot' || id === 'chest' ? 0.55 : 0.66);
      if (locked) drawFish(c, BY_ID[id], w / 2 + 4, h / 2, Lm, 1, { swim: 0, silhouette: 'rgba(20,28,56,.85)' });
      else drawCatch(c, id, w / 2 + 4, h / 2 + (id === 'boot' ? 4 : 0), Lm, 1, { swim: 0, t: 0.7 });
    }

    /* ----- input & lifecycle ----- */
    function onKey(e) {
      if (!run || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
      if (/^[1-4]$/.test(e.key) && anim.state === 'bite') { var b = opts.querySelectorAll('button')[Number(e.key) - 1]; if (b && !b.disabled) { e.preventDefault(); b.click(); } return; }
      if ((e.key === ' ' || e.key === 'Enter') && anim.state === 'show' && !e.target.matches('button')) { e.preventDefault(); anim.showFor = 0; }
    }
    catchCard.addEventListener('click', function () { if (anim.state === 'show') anim.showFor = 0; });
    function open() {
      if (!api.deck() || api.deck().cards.length < 4) { api.toast(tr('toast.needMatch'), 'err', 5000); return; }
      hub.hidden = true; stage.hidden = false; visible = true;
      var host = stage.closest('.screen'); if (host) host.classList.add('arcade-on');
      layout(); startLoop();
      showStart();
      stage.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    }
    function close() {
      if (run) { run.over = true; run = null; doc.removeEventListener('keydown', onKey); }
      visible = false; if (raf) cancelAnimationFrame(raf); raf = 0;
      stage.hidden = true; hub.hidden = false; overlay.hidden = true; catchCard.hidden = true; stage.classList.remove('playing');
      setState('idle'); anim.fish = null;
      var host = stage.closest('.screen'); if (host) host.classList.remove('arcade-on');
      refreshHub();
      var tile = hub.querySelector('[data-arcade="fishing"]'); if (tile) tile.focus({ preventScroll: true });
    }
    function refreshHub() {
      var s = load(), m = hub.querySelector('[data-fish-meta]');
      if (m) m.textContent = tr('fish.hubMeta', { b: s.best ? kg(s.best) : '—', n: Object.keys(s.seen).length, m: SPECIES.length, p: s.pearls });
    }
    if (window.ResizeObserver) new ResizeObserver(function () { if (visible) layout(); }).observe(stage);
    else window.addEventListener('resize', function () { if (visible) layout(); });
    doc.addEventListener('visibilitychange', function () { if (doc.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; } else startLoop(); });
    hub.addEventListener('click', function (e) { var b = e.target.closest('[data-arcade="fishing"]'); if (b) open(); });
    // test hook: answer the open bite right (true) or wrong (false)
    window.fishPick = function (right) { if (anim.state !== 'bite' || !run) return false; var q = run.q; answer(right ? q.answer : q.options.find(function (o) { return o !== q.answer; })); return true; };
    refreshHub();
    return {
      refresh: function () { refreshHub(); },
      leave: function () { if (!stage.hidden) close(); },
      active: function () { return !!run; }
    };
  }

  return { RARITY: RARITY, SPECIES: SPECIES, UPGRADES: UPGRADES, speedScore: speedScore, tierWeights: tierWeights, rollCatch: rollCatch,
    defaults: defaults, clean: clean, cost: cost, buy: buy, roundSeconds: roundSeconds, pearlsFor: pearlsFor, log: log, hardWord: hardWord,
    BITE_MS: BITE_MS, mount: mount };
});
