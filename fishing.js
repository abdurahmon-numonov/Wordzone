/* «Клёв» (v2.35): a fishing adventure over the user's own words.
   Ota the otter travels lake → mountain river → sea bay. Each place has a host with three quests and a boss.
   Fish swim with words on them: the prompt names a meaning (or a sentence with a gap) and the player taps the
   fish carrying the right word, then fights it in: hold to reel, ease off when it surges or the line snaps.
   Bosses are long fights broken by word strikes. Hard words of the deck lure rare fish; pearls buy tackle;
   every species goes into the catch journal. The rules are pure and tested in Node (test/fishing.js);
   mount() draws the scene on a canvas, with the prompt, word tags, panels and HUD as real DOM controls. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VMFishing = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* ---------------- rules ---------------- */

  var RARITY = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  var RARITY_COLOR = { common: '#d6deec', uncommon: '#7ee0a1', rare: '#6ec3ff', epic: '#c79bff', legendary: '#ffcf5a', junk: '#c9b79a', chest: '#ffcf5a' };
  // body: [back, flank, belly]. kg: weight range before tackle bonuses. at: where the species lives.
  var SPECIES = [
    { id: 'silverfin', r: 0, at: ['lake', 'river', 'sea'], kg: [0.2, 0.9], body: ['#c9d8ec', '#9fb4cf', '#f4f8fc'], fin: '#7f97b8', shape: { h: 0.36, tail: 'fork' } },
    { id: 'stripey', r: 0, at: ['lake', 'sea'], kg: [0.3, 1.1], body: ['#ffcf6e', '#f2a33a', '#fff1cf'], fin: '#e0892a', shape: { h: 0.42, tail: 'fork' }, pattern: { type: 'bands', color: '#2b2f4a', n: 3 } },
    { id: 'lemon', r: 0, at: ['lake', 'river'], kg: [0.2, 1.0], body: ['#fff07a', '#f5cf2a', '#fffbe0'], fin: '#e8b51f', shape: { h: 0.5, tail: 'round' }, pattern: { type: 'spots', color: '#ffffff', n: 6 } },
    { id: 'perch', r: 1, at: ['lake', 'river'], kg: [0.8, 2.6], body: ['#b5cf5a', '#6f9a3a', '#f1f3c9'], fin: '#e65a3a', shape: { h: 0.4, tail: 'fork', spiky: true }, pattern: { type: 'bands', color: '#2f4a22', n: 5 } },
    { id: 'carp', r: 1, at: ['lake'], kg: [1.2, 3.4], body: ['#c9a25a', '#8a6a33', '#f3e1b5'], fin: '#a8743a', shape: { h: 0.44, tail: 'fork', whiskers: true }, pattern: { type: 'scales', color: '#5e4520' } },
    { id: 'rainbow', r: 1, at: ['river'], kg: [1.0, 3.0], body: ['#9fd7c9', '#5a9db5', '#f6efe6'], fin: '#7aa6b8', shape: { h: 0.34, tail: 'fork' }, pattern: { type: 'stripe', color: '#ff7aa8' } },
    { id: 'pike', r: 2, at: ['lake', 'river'], kg: [3, 8], body: ['#7f9a5a', '#4c6a3a', '#dfe6c4'], fin: '#a6763a', shape: { h: 0.24, tail: 'fork', snout: 'long' }, pattern: { type: 'spots', color: '#e9f0c2', n: 10 } },
    { id: 'catfish', r: 2, at: ['river'], kg: [4, 9], body: ['#6d6a7a', '#3f3c4d', '#b9b3c4'], fin: '#4a4658', shape: { h: 0.3, tail: 'round', whiskers: true, snout: 'blunt' }, pattern: { type: 'spots', color: '#2a2836', n: 8 } },
    { id: 'ruby', r: 2, at: ['sea'], kg: [2.5, 6], body: ['#ff7a6a', '#d6334a', '#ffd9cf'], fin: '#ff9f5a', shape: { h: 0.46, tail: 'fan' }, pattern: { type: 'scales', color: '#a8203a' } },
    { id: 'koi', r: 3, at: ['lake'], kg: [6, 13], body: ['#fff3e0', '#ffffff', '#fff8ee'], fin: '#ffd7b0', shape: { h: 0.38, tail: 'fan', whiskers: true }, pattern: { type: 'patches', color: '#ff6a2a' } },
    { id: 'angler', r: 3, at: ['river', 'sea'], kg: [5, 12], body: ['#454b80', '#262a55', '#7a80b0'], fin: '#2f3463', shape: { h: 0.55, tail: 'round', snout: 'blunt', lure: true, teeth: true }, pattern: { type: 'spots', color: '#8fe8ff', n: 5 }, glow: '#8fe8ff' },
    { id: 'moonfish', r: 4, at: ['sea'], kg: [15, 32], body: ['#e8ecff', '#aab6ff', '#ffffff'], fin: '#cfd6ff', shape: { h: 0.62, tail: 'fan' }, pattern: { type: 'crescent', color: '#ffffff' }, glow: '#dfe4ff' },
    { id: 'dragon', r: 4, at: ['river', 'sea'], kg: [18, 40], body: ['#ffb03a', '#e0402a', '#ffe2a8'], fin: '#ff6a2a', shape: { h: 0.3, tail: 'fan', spiky: true, snout: 'long', whiskers: true }, pattern: { type: 'scales', color: '#a8201a' }, glow: '#ffb03a' }
  ];
  var BY_ID = {};
  SPECIES.forEach(function (s) { BY_ID[s.id] = s; });

  // The journey: three places, each with three quests and a boss.
  // Quest types: count (fish), rarity (n fish of tier ≥ min), kg (total weight), streak (right picks in a row), clean (n fish, at most `miss` wrong picks).
  var LOCATIONS = [
    { id: 'lake', host: 'nura', speed: 1, current: 0, quests: [{ type: 'count', n: 5 }, { type: 'rarity', min: 1, n: 3 }, { type: 'kg', n: 12 }],
      boss: { id: 'lakeking', species: 'carp', strikes: 3, strength: 1.05, size: 2.4 } },
    { id: 'river', host: 'timur', speed: 1.45, current: 26, quests: [{ type: 'count', n: 6 }, { type: 'streak', n: 5 }, { type: 'rarity', min: 2, n: 2 }],
      boss: { id: 'riverdragon', species: 'dragon', strikes: 4, strength: 1.25, size: 2.2 } },
    { id: 'sea', host: 'lola', speed: 1.2, current: 0, quests: [{ type: 'kg', n: 25 }, { type: 'rarity', min: 3, n: 1 }, { type: 'clean', n: 8, miss: 2 }],
      boss: { id: 'moonking', species: 'moonfish', strikes: 5, strength: 1.4, size: 2.3 } }
  ];
  var LOC_BY_ID = {};
  LOCATIONS.forEach(function (l, i) { l.index = i; LOC_BY_ID[l.id] = l; });
  var QUEST_SECONDS = 120, FREE_SECONDS = 90, BOSS_SECONDS = 150, STRIKE_MS = 7000;

  function round1(x) { return Math.round(x * 10) / 10; }
  // Relative chance of each rarity tier; luck tilts the odds toward rare fish.
  function tierWeights(luck) {
    var base = [60, 26, 10, 3.4, 0.6];
    return base.map(function (w, i) { return w * Math.pow(1 + 0.55 * Math.max(0, luck), i); });
  }
  function luckOf(o) { return Math.min(2, Math.floor((o.combo || 0) / 3)) + 0.5 * (o.bait || 0) + (o.hard ? 1.5 : 0); }
  // A species for a fish swimming at `loc`. o: { combo, bait, hard, rand }.
  function rollSpecies(loc, o) {
    o = o || {};
    var r = o.rand || Math.random;
    var here = SPECIES.filter(function (s) { return s.at.indexOf(loc) >= 0; });
    var w = tierWeights(luckOf(o)).map(function (x, tier) { return here.some(function (s) { return s.r === tier; }) ? x : 0; });
    var total = w.reduce(function (a, b) { return a + b; }, 0), x = r() * total, tier = 0;
    while (tier < w.length - 1 && (x >= w[tier] || w[tier] === 0)) { x -= w[tier]; tier++; }
    var list = here.filter(function (s) { return s.r === tier; });
    while (!list.length && tier > 0) { tier--; list = here.filter(function (s) { return s.r === tier; }); }
    return list[Math.floor(r() * list.length) % list.length].id;
  }
  // Weight of a landed fish: a bigger rod, and a quick pick (under 2.5 s) add to it.
  function weigh(id, o) {
    o = o || {};
    var sp = BY_ID[id], r = o.rand || Math.random;
    var kg = sp.kg[0] + (sp.kg[1] - sp.kg[0]) * Math.pow(r(), 1.6);
    kg *= 1 + 0.1 * (o.rod || 0);
    if (o.fast) kg *= 1.25;
    return Math.max(0.1, round1(kg));
  }
  // How hard a fish fights: 0.55 for the smallest common fish, up to ~1.6 for a legend.
  function strength(id, kg) { var sp = BY_ID[id]; return 0.55 + sp.r * 0.22 + Math.min(0.25, (kg || 0) / 120); }

  /* The fight. f: { dist (1 = at the hook, 0 = at the boat), tension (0..cap), surge, phase (s left), str, floor } —
     hold to reel in (tension rises, much faster while the fish surges), let go to ease off (the fish pulls away).
     Returns 'landed' | 'snapped' | 'escaped' | null. `rand` drives the calm/surge rhythm. Mutates f. */
  function reelStep(f, dt, holding, gear, rand) {
    var r = rand || Math.random, g = gear || {};
    var cap = 1 + 0.15 * (g.line || 0), pull = 0.42 + 0.06 * (g.rod || 0), soft = 1 - 0.1 * (g.rod || 0);
    f.phase -= dt;
    if (f.phase <= 0) {
      if (f.stun > 0) { f.surge = false; f.phase = 0.4; }
      else { f.surge = !f.surge; f.phase = f.surge ? 0.45 + r() * 0.5 * f.str : Math.max(0.5, 1.9 - f.str * 0.7) + r() * 0.8; }
    }
    if (f.stun > 0) f.stun = Math.max(0, f.stun - dt);
    var surging = f.surge && !(f.stun > 0);
    if (holding) {
      f.dist -= dt * pull * (surging ? 0.2 : 1);
      f.tension += dt * (surging ? 1.3 : 0.3) * f.str * soft;
    } else {
      f.tension = Math.max(0, f.tension - dt * 0.95);
      f.dist += dt * (surging ? 0.24 : 0.05) * f.str;
    }
    if (f.floor != null) f.dist = Math.max(f.floor, f.dist); // a boss cannot be reeled past this until its strength is broken
    if (f.tension >= cap) return 'snapped';
    if (f.dist >= 1.25) return 'escaped';
    if (f.dist <= 0) return 'landed';
    return null;
  }
  function newFight(str, floor) { return { dist: 1, tension: 0.15, surge: false, phase: 0.9, str: str, floor: floor == null ? null : floor, stun: 0 }; }

  // Quest progress from the round's stats: { caught, kg, tiers: [n of tier ≥ 0..4], streak, misses }.
  function progress(q, st) {
    if (q.type === 'count') return { have: st.caught, need: q.n };
    if (q.type === 'rarity') return { have: st.tiers[q.min] || 0, need: q.n };
    if (q.type === 'kg') return { have: round1(st.kg), need: q.n };
    if (q.type === 'streak') return { have: st.bestStreak, need: q.n };
    return { have: st.caught, need: q.n }; // clean
  }
  function failed(q, st) { return q.type === 'clean' && st.misses > q.miss; }
  function done(q, st) { var p = progress(q, st); return !failed(q, st) && p.have >= p.need; }
  // 3 stars with no wrong picks, 2 with up to two, otherwise 1.
  function stars(misses) { return misses === 0 ? 3 : misses <= 2 ? 2 : 1; }

  // Saved progress (localStorage 'vm.fish').
  var UPGRADES = { rod: { max: 4, costs: [40, 90, 160, 260] }, line: { max: 4, costs: [50, 110, 190, 300] }, bait: { max: 4, costs: [60, 130, 220, 340] } };
  function defaults() {
    var story = {};
    LOCATIONS.forEach(function (l) { story[l.id] = { q: [0, 0, 0], boss: false }; });
    return { pearls: 0, rod: 0, line: 0, bait: 0, seen: {}, best: 0, biggest: null, rounds: 0, intro: false, story: story, trophies: {} };
  }
  function clean(s) {
    var d = defaults(), out = Object.assign(d, s && typeof s === 'object' ? s : {});
    out.pearls = Math.max(0, Math.floor(Number(out.pearls) || 0));
    Object.keys(UPGRADES).forEach(function (k) { out[k] = Math.min(UPGRADES[k].max, Math.max(0, Math.floor(Number(out[k]) || 0))); });
    if (!out.seen || typeof out.seen !== 'object') out.seen = {};
    if (!out.trophies || typeof out.trophies !== 'object') out.trophies = {};
    var story = {};
    LOCATIONS.forEach(function (l) {
      var x = out.story && out.story[l.id] || {};
      story[l.id] = { q: [0, 1, 2].map(function (i) { return Math.min(3, Math.max(0, Math.floor(Number(x.q && x.q[i]) || 0))); }), boss: x.boss === true, met: x.met === true, bossSeen: x.bossSeen === true };
    });
    out.story = story;
    return out;
  }
  function unlocked(s, locIndex) { return locIndex === 0 || !!(s.story[LOCATIONS[locIndex - 1].id] || {}).boss; }
  function questOpen(s, locId, qi) { var st = s.story[locId]; return unlocked(s, LOC_BY_ID[locId].index) && (qi === 0 || st.q[qi - 1] > 0); }
  function bossOpen(s, locId) { var st = s.story[locId]; return unlocked(s, LOC_BY_ID[locId].index) && st.q.every(function (n) { return n > 0; }); }
  // The next step of the journey, or null when everything is done.
  function nextStep(s) {
    for (var i = 0; i < LOCATIONS.length; i++) {
      var l = LOCATIONS[i], st = s.story[l.id];
      if (!unlocked(s, i)) return null;
      for (var q = 0; q < 3; q++) if (!st.q[q]) return { loc: l.id, kind: 'quest', qi: q };
      if (!st.boss) return { loc: l.id, kind: 'boss' };
    }
    return null;
  }
  function cost(s, id) { var u = UPGRADES[id]; return u && s[id] < u.max ? u.costs[s[id]] : null; }
  function buy(s, id) {
    var c = cost(s, id);
    if (c == null || s.pearls < c) return null;
    var n = JSON.parse(JSON.stringify(s)); n.pearls -= c; n[id] += 1;
    return n;
  }
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
  function questReward(st, starsN) { return 10 + 5 * starsN + Math.round(st.kg / 2); }

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

  var LOOK = {
    lake: { sky: ['#3f7fca', '#d4e9ee'], sun: [0.3, 0.38], sunCol: '#fff3cf', far: '#86aaa8', mid: '#55806f', shore: '#2f5b4b', surf: '#3ea5b4', mid2: '#17607e', deep: '#0b2240', wave: 1, kind: 'pines' },
    river: { sky: ['#4d86cc', '#e9f1df'], sun: [0.62, 0.22], sunCol: '#ffffff', far: '#93a7c6', mid: '#61799b', shore: '#3c5a4b', surf: '#4ab3a3', mid2: '#1b6a72', deep: '#0c2a3a', wave: 1.2, kind: 'mountains' },
    sea: { sky: ['#2a1e57', '#ff8a5c'], sun: [0.66, 0.74], sunCol: '#ffb070', far: '#6a3f6e', mid: '#43305e', shore: '#241c3f', surf: '#3b86a6', mid2: '#155a7a', deep: '#071530', wave: 2, kind: 'lighthouse' }
  };

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
    function fx(kind) { if (api.fx) api.fx(kind); }

    /* ----- DOM skeleton ----- */
    stage.innerHTML = '';
    var scene = el('div', 'fx-scene'), canvas = el('canvas', 'fx-canvas');
    canvas.setAttribute('aria-hidden', 'true');
    scene.appendChild(canvas);
    var timeBar = el('div', 'fx-timebar'), timeFill = el('i'); timeBar.appendChild(timeFill);
    var hudEl = el('div', 'fx-hud');
    var goalChip = el('div', 'fx-hud-stat fx-goal'), goalLabel = el('span'), goalValue = el('strong'); goalChip.appendChild(goalLabel); goalChip.appendChild(goalValue);
    var hudTime = el('div', 'fx-hud-time'), hudTimeV = el('strong', null, '0'); hudTime.appendChild(hudTimeV); hudTime.appendChild(el('span', null, tr('fish.sec')));
    var hudRight = el('div', 'fx-hud-right');
    var streakChip = el('span', 'fx-combo'); streakChip.hidden = true;
    var quit = btn('fx-quit', tr('fish.stop'), function () { if (run) abandon(); });
    quit.setAttribute('aria-label', tr('fish.stopAria'));
    hudRight.appendChild(streakChip); hudRight.appendChild(quit);
    hudEl.appendChild(goalChip); hudEl.appendChild(hudTime); hudEl.appendChild(hudRight);
    var promptCard = el('div', 'fx-promptcard'), promptKind = el('span', 'fx-ask-kind'), promptText = el('p', 'fx-prompt');
    var feedback = el('p', 'fx-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    promptCard.appendChild(promptKind); promptCard.appendChild(promptText); promptCard.appendChild(feedback);
    var tags = el('div', 'fx-tags');
    var reelUi = el('div', 'fx-reel'); reelUi.hidden = true;
    var reelHint = el('span', 'fx-reel-hint');
    var meter = el('div', 'fx-meter'), meterFill = el('i'), meterMark = el('b'); meter.appendChild(meterFill); meter.appendChild(meterMark);
    meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', tr('fish.tension')); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100');
    var dist = el('div', 'fx-dist'), distFill = el('i'); dist.appendChild(distFill);
    var reelBtn = btn('fx-reelbtn', tr('fish.reel')); reelBtn.setAttribute('aria-pressed', 'false');
    var reelRow = el('div', 'fx-reel-row'); reelRow.appendChild(meter); reelRow.appendChild(reelBtn);
    reelUi.appendChild(reelHint); reelUi.appendChild(reelRow); reelUi.appendChild(dist);
    var bossUi = el('div', 'fx-bossbar'); bossUi.hidden = true;
    var bossName = el('strong'), bossTrack = el('div', 'fx-boss-track'), bossFill = el('i'), spools = el('span', 'fx-spools');
    bossTrack.appendChild(bossFill); bossUi.appendChild(bossName); bossUi.appendChild(spools); bossUi.appendChild(bossTrack);
    var strike = el('div', 'fx-strike'); strike.hidden = true;
    var banner = el('div', 'fx-banner'); banner.setAttribute('aria-hidden', 'true');
    var catchCard = el('div', 'fx-catch'); catchCard.hidden = true;
    var overlay = el('div', 'fx-overlay'); overlay.hidden = true;
    [timeBar, hudEl, bossUi, promptCard, tags, reelUi, strike, banner, catchCard].forEach(function (n) { scene.appendChild(n); });
    stage.appendChild(scene); stage.appendChild(overlay);
    var ctx = canvas.getContext('2d');

    /* ----- scene state ----- */
    var W = 800, H = 500, DPR = 1, S = 1, waterY = 200, boatX = 100;
    var t = 0, last = 0, raf = 0, visible = false, shake = 0, holding = false;
    var particles = [], ripples = [], clouds = [], birds = [], ambient = [];
    var look = LOOK.lake, locId = 'lake';
    var run = null;

    function layout() {
      var r = scene.getBoundingClientRect();
      W = Math.max(280, r.width); H = Math.max(300, r.height);
      DPR = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      S = Math.max(0.6, Math.min(1.2, Math.min(W / 900, H / 620)));
      waterY = H * 0.4; boatX = Math.max(70 * S, W * (W < 600 ? 0.17 : 0.13));
      if (!clouds.length) for (var j = 0; j < 4; j++) clouds.push({ x: Math.random(), y: 0.08 + Math.random() * 0.22, s: 0.6 + Math.random() * 0.8, v: 0.004 + Math.random() * 0.006 });
      if (!ambient.length) for (var i = 0; i < 3; i++) ambient.push({ x: Math.random() * W, y: 0.6 + Math.random() * 0.35, L: 24 + Math.random() * 16, dir: i % 2 ? 1 : -1, v: 14 + Math.random() * 14, ph: Math.random() * 6 });
    }
    function setLoc(id) { locId = id; look = LOOK[id]; stage.dataset.loc = id; }
    function waveY(x) { var a = look.wave * S; return waterY + Math.sin(x * 0.018 + t * 1.6) * 3 * a + Math.sin(x * 0.041 - t * 2.3) * 1.6 * a; }
    function rodTip() {
      var bob = Math.sin(t * 1.6 + boatX * 0.018) * 3 * S * look.wave;
      var bend = run && run.phase === 'reel' ? Math.min(0.5, 0.15 + (run.fight ? run.fight.tension * 0.4 : 0)) : 0;
      return { x: boatX + (54 + 70 * (1 - bend)) * S, y: waterY - (118 - 50 * bend) * S + bob };
    }
    function minX() { return boatX + 120 * S; }
    function laneY(k) { var top = waterY + (H - waterY) * 0.2, bottom = H - 46 * S; return top + (bottom - top) * (k / 3); }

    /* ----- painting ----- */
    function paintSky() {
      var g = ctx.createLinearGradient(0, 0, 0, waterY);
      g.addColorStop(0, look.sky[0]); g.addColorStop(1, look.sky[1]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, waterY + 2);
      if (locId === 'sea') {
        var rnd = seeded(7);
        for (var i = 0; i < 36; i++) { var sx = rnd() * W, sy = rnd() * waterY * 0.5; ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + 0.6 * Math.abs(Math.sin(t * 1.3 + i))).toFixed(2) + ')'; ctx.fillRect(sx, sy, 1.6, 1.6); }
      }
      var sunX = W * look.sun[0], sunY = waterY * look.sun[1], sr = 30 * S;
      var glow = ctx.createRadialGradient(sunX, sunY, sr * 0.4, sunX, sunY, sr * 6);
      glow.addColorStop(0, rgba(look.sunCol, 0.55)); glow.addColorStop(1, rgba(look.sunCol, 0));
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, waterY);
      ctx.fillStyle = look.sunCol; ctx.beginPath(); ctx.arc(sunX, sunY, sr, 0, 6.283); ctx.fill();
      clouds.forEach(function (c) {
        c.x += c.v * (reduced ? 0.3 : 1) / 60; if (c.x > 1.2) c.x = -0.2;
        var cx = c.x * W, cy = c.y * waterY, cs = c.s * 44 * S;
        ctx.fillStyle = rgba(mixHex('#ffffff', look.sky[1], 0.3), locId === 'sea' ? 0.45 : 0.75);
        [[0, 0, 1], [0.9, 0.15, 0.75], [-0.9, 0.2, 0.7], [0.35, -0.35, 0.8]].forEach(function (b) { ctx.beginPath(); ctx.arc(cx + b[0] * cs, cy + b[1] * cs, b[2] * cs, 0, 6.283); ctx.fill(); });
      });
      if (!reduced && Math.random() < 0.002 && birds.length < 3) birds.push({ x: -20, y: waterY * (0.15 + Math.random() * 0.3), v: 40 + Math.random() * 30 });
      ctx.strokeStyle = 'rgba(28,35,64,.6)'; ctx.lineWidth = 1.6;
      birds = birds.filter(function (b) {
        b.x += b.v / 60; var f = Math.sin(t * 9 + b.y) * 4;
        ctx.beginPath(); ctx.moveTo(b.x - 7, b.y - f); ctx.quadraticCurveTo(b.x - 3, b.y - 2, b.x, b.y); ctx.quadraticCurveTo(b.x + 3, b.y - 2, b.x + 7, b.y - f); ctx.stroke();
        return b.x < W + 20;
      });
      if (look.kind === 'mountains') { peaks(look.far, 0.5, 74, 3); peaks(look.mid, 0.72, 52, 5); }
      else { hill(look.far, 0.74, 0.006, 26, 1); hill(look.mid, 0.86, 0.011, 18, 2); }
      if (look.kind === 'pines') shorePines();
      else if (look.kind === 'mountains') waterfall();
      else lighthouse();
    }
    function hill(col, base, freq, amp, seed) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, waterY);
      for (var x = 0; x <= W + 10; x += 10) ctx.lineTo(x, waterY * base - (Math.sin(x * freq + seed) * 0.6 + Math.sin(x * freq * 2.3 + seed * 3) * 0.4 + 0.6) * amp * S);
      ctx.lineTo(W, waterY); ctx.closePath(); ctx.fill();
    }
    function peaks(col, base, amp, seed) {
      var rnd = seeded(seed), n = Math.max(5, Math.round(W / 160)), step = W / n;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, waterY);
      var tops = [];
      for (var i = 0; i <= n; i++) { var px = i * step + (rnd() - 0.5) * step * 0.5, py = waterY * base - (0.4 + rnd() * 0.6) * amp * S * 2; tops.push([px, py]); ctx.lineTo(px, py); ctx.lineTo(px + step / 2, waterY * base + amp * S * 0.2); }
      ctx.lineTo(W, waterY); ctx.closePath(); ctx.fill();
      if (seed === 3) { ctx.fillStyle = 'rgba(255,255,255,.85)'; tops.forEach(function (p) { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + 14 * S, p[1] + 18 * S); ctx.lineTo(p[0] + 4 * S, p[1] + 14 * S); ctx.lineTo(p[0] - 6 * S, p[1] + 20 * S); ctx.lineTo(p[0] - 14 * S, p[1] + 16 * S); ctx.closePath(); ctx.fill(); }); }
    }
    function pine(x, y, h, col) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - h);
      for (var k = 0; k < 3; k++) { ctx.lineTo(x + h * (0.22 + k * 0.08), y - h * (0.62 - k * 0.3)); ctx.lineTo(x + h * 0.08, y - h * (0.62 - k * 0.3)); }
      ctx.lineTo(x + h * 0.08, y); ctx.lineTo(x - h * 0.08, y);
      for (var j = 2; j >= 0; j--) { ctx.lineTo(x - h * 0.08, y - h * (0.62 - j * 0.3)); ctx.lineTo(x - h * (0.22 + j * 0.08), y - h * (0.62 - j * 0.3)); }
      ctx.closePath(); ctx.fill();
    }
    function shorePines() {
      ctx.fillStyle = look.shore; ctx.beginPath(); ctx.moveTo(W * 0.62, waterY + 1);
      ctx.quadraticCurveTo(W * 0.78, waterY - 34 * S, W, waterY - 48 * S); ctx.lineTo(W, waterY + 1); ctx.closePath(); ctx.fill();
      for (var i = 0; i < 8; i++) pine(W * 0.74 + i * 26 * S + (i % 2) * 9, waterY - 18 * S - i * 4 * S, (34 + (i * 13) % 22) * S, look.shore);
    }
    function waterfall() {
      var x0 = W * 0.82;
      ctx.fillStyle = look.shore; ctx.beginPath(); ctx.moveTo(x0 - 40 * S, waterY + 1); ctx.lineTo(x0 - 10 * S, waterY - 110 * S); ctx.lineTo(W, waterY - 130 * S); ctx.lineTo(W, waterY + 1); ctx.closePath(); ctx.fill();
      var fx0 = x0 + 6 * S, fw = 34 * S, top = waterY - 118 * S;
      var g = ctx.createLinearGradient(0, top, 0, waterY); g.addColorStop(0, '#dff6ff'); g.addColorStop(1, '#9fd8e8');
      ctx.fillStyle = g; ctx.fillRect(fx0, top, fw, waterY - top);
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2;
      for (var i = 0; i < 6; i++) { var yy = top + ((t * 90 + i * 22) % (waterY - top)); ctx.beginPath(); ctx.moveTo(fx0 + 3 + i * 5 * S, yy); ctx.lineTo(fx0 + 3 + i * 5 * S, yy + 12 * S); ctx.stroke(); }
      for (var k = 0; k < 4; k++) pine(x0 + 50 * S + k * 24 * S, waterY - 120 * S - k * 3, (26 + k * 5) * S, mixHex(look.shore, '#000000', 0.15));
      if (Math.random() < 0.3) particles.push({ type: 'drop', x: fx0 + Math.random() * fw, y: waterY, vx: (Math.random() - 0.5) * 80, vy: -60 - Math.random() * 60, life: 0, max: 0.6, size: 1.2 + Math.random() * 1.5 });
    }
    function lighthouse() {
      var x = W * 0.86, base = waterY - 4 * S;
      ctx.fillStyle = look.shore; ctx.beginPath(); ctx.ellipse(x, waterY + 4, 90 * S, 18 * S, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#f1e6d6'; ctx.beginPath(); ctx.moveTo(x - 12 * S, base); ctx.lineTo(x - 8 * S, base - 80 * S); ctx.lineTo(x + 8 * S, base - 80 * S); ctx.lineTo(x + 12 * S, base); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c94a3a'; [0.25, 0.6].forEach(function (k) { ctx.fillRect(x - 11 * S + k * 2 * S, base - 80 * S * k - 8 * S, 22 * S - k * 4 * S, 9 * S); });
      ctx.fillStyle = '#2a2240'; ctx.fillRect(x - 10 * S, base - 92 * S, 20 * S, 12 * S);
      var a = t * 0.9, lx = x, ly = base - 86 * S;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var bg = ctx.createLinearGradient(lx, ly, lx + Math.cos(a) * 260 * S, ly);
      bg.addColorStop(0, 'rgba(255,230,160,.45)'); bg.addColorStop(1, 'rgba(255,230,160,0)');
      ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + Math.cos(a) * 260 * S, ly - 30 * S); ctx.lineTo(lx + Math.cos(a) * 260 * S, ly + 30 * S); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#ffe6a0'; ctx.beginPath(); ctx.arc(lx, ly, 4 * S, 0, 6.283); ctx.fill();
    }
    function paintWater() {
      var g = ctx.createLinearGradient(0, waterY, 0, H);
      g.addColorStop(0, look.surf); g.addColorStop(0.35, look.mid2); g.addColorStop(1, look.deep);
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, H);
      for (var x = 0; x <= W + 8; x += 8) ctx.lineTo(x, waveY(x));
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 5; i++) {
        var rx = (i * 0.23 + 0.08) * W + Math.sin(t * 0.3 + i) * 30, a = 0.05 + 0.035 * Math.sin(t * 0.8 + i * 1.7);
        var rg = ctx.createLinearGradient(0, waterY, 0, H * 0.95); rg.addColorStop(0, 'rgba(200,240,255,' + a.toFixed(3) + ')'); rg.addColorStop(1, 'rgba(200,240,255,0)');
        ctx.fillStyle = rg; ctx.beginPath(); ctx.moveTo(rx, waterY); ctx.lineTo(rx + 40 * S, waterY); ctx.lineTo(rx + 140 * S, H); ctx.lineTo(rx + 40 * S, H); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      var sunX = W * look.sun[0];
      ctx.fillStyle = rgba('#fff4d6', locId === 'sea' ? 0.7 : 0.5);
      for (var k = 0; k < 12; k++) { var gw = (16 - k) * 2.2 * S * (0.6 + 0.4 * Math.sin(t * 3 + k * 1.7)); ctx.fillRect(sunX - gw / 2 + Math.sin(t * 2 + k) * 6, waterY + 4 + k * 3.2 * S, Math.max(2, gw), 1.4); }
      if (LOC_BY_ID[locId].current) {
        ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.4;
        for (var c = 0; c < 14; c++) { var cx = ((c * 137 + t * LOC_BY_ID[locId].current * 2.4) % (W + 80)) - 40, cy = waterY + 10 * S + ((c * 53) % Math.max(40, (H - waterY) * 0.8)); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 22 * S, cy); ctx.stroke(); }
      }
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.4; ctx.beginPath();
      for (var x2 = 0; x2 <= W; x2 += 8) { var yy = waveY(x2); if (x2 === 0) ctx.moveTo(x2, yy); else ctx.lineTo(x2, yy); }
      ctx.stroke();
      var by = H - 16 * S;
      ctx.fillStyle = mixHex(look.deep, locId === 'sea' ? '#d8b878' : '#c8a86a', 0.35);
      ctx.beginPath(); ctx.moveTo(0, H);
      for (var x3 = 0; x3 <= W + 20; x3 += 20) ctx.lineTo(x3, by - Math.sin(x3 * 0.012) * 8 * S - 6 * S);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      for (var j = 0; j < 9; j++) {
        var kx = (j * 0.115 + 0.04) * W, kh = (40 + (j * 17) % 50) * S;
        ctx.strokeStyle = locId === 'sea' ? (j % 2 ? '#c4564a' : '#e08a5a') : (j % 2 ? '#1f7a5c' : '#2a9a6a'); ctx.lineWidth = 5 * S; ctx.lineCap = 'round';
        var sway = Math.sin(t * 1.2 + j) * 10 * S * (reduced ? 0.3 : 1);
        ctx.beginPath(); ctx.moveTo(kx, by); ctx.bezierCurveTo(kx + sway, by - kh * 0.4, kx - sway, by - kh * 0.7, kx + sway * 1.4, by - kh); ctx.stroke();
      }
      ambient.forEach(function (f) {
        f.x += f.dir * f.v / 60; if (f.x > W + 60) f.x = -60; if (f.x < -60) f.x = W + 60;
        drawFish(ctx, SPECIES[0], f.x, waterY + (H - waterY) * f.y + Math.sin(t + f.ph) * 5, f.L * S, f.dir, { t: t + f.ph, swim: 7, alpha: 0.28, glow: false });
      });
    }
    function paintBoat() {
      var bob = Math.sin(t * 1.6 + boatX * 0.018) * 3 * S * look.wave, tilt = Math.sin(t * 1.3) * 0.03 * look.wave;
      ctx.save(); ctx.translate(boatX, waterY + bob); ctx.rotate(tilt); ctx.scale(S, S);
      ctx.fillStyle = 'rgba(10,20,40,.22)'; ctx.beginPath(); ctx.ellipse(0, 10, 78, 9, 0, 0, 6.283); ctx.fill();
      otter(ctx, -4, -70, 1, run && run.phase === 'reel', run && run.streak >= 3);
      var hg = ctx.createLinearGradient(0, -14, 0, 12); hg.addColorStop(0, '#a8693a'); hg.addColorStop(1, '#6a3d1f');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.moveTo(-74, -14); ctx.lineTo(74, -14); ctx.quadraticCurveTo(64, 10, 40, 12); ctx.lineTo(-44, 12); ctx.quadraticCurveTo(-66, 8, -74, -14); ctx.fill();
      ctx.strokeStyle = 'rgba(40,20,10,.45)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-68, -4); ctx.lineTo(68, -4); ctx.stroke();
      ctx.fillStyle = '#d18a4a'; ctx.fillRect(-76, -18, 152, 5);
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-66, -46, 2.4, 30);
      if (locId === 'sea') { var lg = ctx.createRadialGradient(-62, -48, 1, -62, -48, 40); lg.addColorStop(0, 'rgba(255,200,110,.55)'); lg.addColorStop(1, 'rgba(255,200,110,0)'); ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(-62, -48, 40, 0, 6.283); ctx.fill(); }
      ctx.fillStyle = locId === 'sea' ? '#ffd27a' : '#c9b48a'; ctx.fillRect(-67, -54, 10, 10);
      ctx.restore();
      var tip = rodTip(), hx = boatX + 14 * S, hy = waterY + bob - 40 * S;
      ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 3.4 * S; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hx - 10 * S, hy + 12 * S); ctx.quadraticCurveTo((hx + tip.x) / 2, Math.min(hy, tip.y) - 4 * S + (run && run.phase === 'reel' ? 22 * S : 0), tip.x, tip.y); ctx.stroke();
      ctx.fillStyle = '#b5794a'; ctx.beginPath(); ctx.arc(hx, hy, 5 * S, 0, 6.283); ctx.fill();
    }
    // Ota the otter: head centered at (x, y), scale k. strain: squinting while reeling; blush on a streak.
    function otter(c, x, y, k, strain, blush) {
      c.save(); c.translate(x, y); c.scale(k, k);
      c.fillStyle = '#1c2a52'; c.beginPath(); c.ellipse(-2, 36, 22, 26, 0, 0, 6.283); c.fill();
      c.fillStyle = '#b5794a'; c.beginPath(); c.arc(0, 0, 19, 0, 6.283); c.fill();
      c.beginPath(); c.arc(-14, -14, 6, 0, 6.283); c.arc(14, -14, 6, 0, 6.283); c.fill();
      c.fillStyle = '#ecd2ac'; c.beginPath(); c.ellipse(6, 7, 12, 9, 0, 0, 6.283); c.fill();
      c.fillStyle = '#2a1a12'; c.beginPath(); c.ellipse(10, 3, 3.4, 2.6, 0, 0, 6.283); c.fill();
      c.fillStyle = '#141a2e';
      if (strain || (t % 4.2) < 0.12) { c.fillRect(-6, -4, 6, 1.8); c.fillRect(10, -5, 6, 1.8); }
      else { c.beginPath(); c.arc(-3, -4, 2.6, 0, 6.283); c.arc(13, -5, 2.6, 0, 6.283); c.fill(); c.fillStyle = '#fff'; c.fillRect(-2.4, -5.6, 1.2, 1.2); c.fillRect(13.6, -6.6, 1.2, 1.2); }
      if (blush) { c.fillStyle = 'rgba(255,120,120,.45)'; c.beginPath(); c.arc(-10, 6, 3.5, 0, 6.283); c.arc(22, 5, 3.5, 0, 6.283); c.fill(); }
      c.fillStyle = '#e8a33a'; c.beginPath(); c.arc(0, -10, 18, Math.PI * 1.05, Math.PI * 1.95); c.fill();
      c.fillStyle = '#c4822a'; c.fillRect(-18, -14, 36, 6);
      c.fillStyle = '#ffd27a'; c.beginPath(); c.arc(0, -30, 5, 0, 6.283); c.fill();
      c.restore();
    }
    function paintWave(dt) {
      var w = run && run.wave; if (!w) return;
      var speedK = reduced ? 0.6 : 1, cur = LOC_BY_ID[locId].current * S;
      w.fish.forEach(function (f) {
        if (f.hooked) return;
        if (f.flee) { f.x += f.dir * f.v * 3.2 * dt; }
        else if (!f.frozen) {
          f.x += (f.dir * f.v * speedK + cur) * dt;
          if (f.x < minX() && f.dir < 0) f.dir = 1;
          if (f.x > W - 60 * S && f.dir > 0) f.dir = -1;
        }
        f.y = f.baseY + Math.sin(t * 1.5 + f.ph) * 6 * S;
        drawFish(ctx, BY_ID[f.sp], f.x, f.y, f.L, f.dir, { t: t + f.ph, swim: f.flee ? 22 : 9 });
        if (f.tag) f.tag.style.transform = 'translate(' + Math.round(f.x) + 'px,' + Math.round(f.y - f.L * BY_ID[f.sp].shape.h * 0.62 - 10) + 'px) translate(-50%,-100%)';
      });
      w.fish = w.fish.filter(function (f) { var gone = f.flee && (f.x < -120 || f.x > W + 120); if (gone && f.tag) { f.tag.remove(); f.tag = null; } return !gone; });
    }
    function hookedPos() {
      var h = run.hooked, f = run.fight, e = 1 - Math.max(0, Math.min(1, f.dist));
      var lx = boatX + 70 * S, ly = waterY + 12 * S;
      var x = h.x0 + (lx - h.x0) * e, y = h.y0 + (ly - h.y0) * e;
      if (f.dist > 1) { x += (f.dist - 1) * 220 * S * (h.x0 > lx ? 1 : -1); y += (f.dist - 1) * 60 * S; }
      if (f.surge && !(f.stun > 0)) { x += Math.sin(t * 22) * 7 * S; y += Math.cos(t * 17) * 4 * S; }
      return { x: x, y: y };
    }
    function paintLineAndHooked() {
      var tip = rodTip(), ph = run ? run.phase : 'idle';
      ctx.lineCap = 'round';
      if (ph === 'cast' && run.hooked) {
        var k = Math.min(1, (t - run.since) / 0.45), h = run.hooked;
        var x = tip.x + (h.x0 - tip.x) * k, y = tip.y + (h.y0 - tip.y) * k - Math.sin(Math.PI * k) * 70 * S;
        ctx.strokeStyle = 'rgba(245,245,255,.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.quadraticCurveTo((tip.x + x) / 2, Math.min(tip.y, y) - 20 * S, x, y); ctx.stroke();
        ctx.fillStyle = '#ff4a3a'; ctx.beginPath(); ctx.arc(x, y, 4 * S, 0, 6.283); ctx.fill();
        return;
      }
      if ((ph === 'reel' || ph === 'strike' || ph === 'intro') && run.hooked) {
        var p = ph === 'intro' ? introPos() : hookedPos(), ten = run.fight.tension;
        ctx.strokeStyle = ten > 0.75 ? '#ff6b5a' : ten > 0.5 ? '#ffcf5a' : 'rgba(245,245,255,.85)'; ctx.lineWidth = 1.2 + ten * 1.6;
        ctx.beginPath(); ctx.moveTo(tip.x, tip.y);
        var sag = (1 - Math.min(1, ten)) * 40 * S;
        ctx.quadraticCurveTo((tip.x + p.x) / 2, (tip.y + p.y) / 2 + sag, p.x, p.y); ctx.stroke();
        var hk = run.hooked;
        if (hk.boss) bossFish(hk, p, hk.x0 > tip.x ? -1 : 1);
        else drawFish(ctx, BY_ID[hk.sp], p.x, p.y, hk.L, hk.x0 > tip.x ? -1 : 1, { t: t, swim: run.fight.surge ? 26 : 12, angle: run.fight.surge ? Math.sin(t * 20) * 0.35 : -0.15 });
        if (run.fight.surge && !reduced && Math.random() < 0.35 && Math.abs(p.y - waterY) < 50 * S) particles.push({ type: 'drop', x: p.x, y: waterY, vx: (Math.random() - 0.5) * 160, vy: -90 - Math.random() * 120, life: 0, max: 0.7, size: 1.5 + Math.random() * 2 });
        if (Math.random() < 0.15) particles.push({ type: 'bubble', x: p.x, y: p.y, vx: 0, vy: -30, life: 0, max: 1.4, size: 1.5 + Math.random() * 2.5 });
        return;
      }
      if (ph === 'show' && run.landed) {
        var sx = tip.x + 6 * S, sy = tip.y + 70 * S + Math.sin(t * 3) * 3;
        ctx.strokeStyle = 'rgba(245,245,255,.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(sx, sy - 8); ctx.stroke();
        drawFish(ctx, BY_ID[run.landed.id], sx, sy, run.landed.L, 1, { t: t, swim: 8, angle: -1.35 + Math.sin(t * 8) * 0.18 });
        return;
      }
      ctx.strokeStyle = 'rgba(245,245,255,.7)'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x + 2, tip.y + 34 * S); ctx.stroke();
    }
    // A boss: a dark aura, the fish itself and a golden crown that tilts with it.
    function bossFish(hk, p, dir) {
      var surging = run.fight && run.fight.surge && !(run.fight.stun > 0), ang = surging ? Math.sin(t * 14) * 0.18 : 0;
      var aura = ctx.createRadialGradient(p.x, p.y, hk.L * 0.1, p.x, p.y, hk.L * 0.9);
      aura.addColorStop(0, surging ? 'rgba(255,90,50,.35)' : 'rgba(255,207,90,.22)'); aura.addColorStop(1, 'rgba(255,207,90,0)');
      ctx.fillStyle = aura; ctx.beginPath(); ctx.arc(p.x, p.y, hk.L * 0.9, 0, 6.283); ctx.fill();
      drawFish(ctx, BY_ID[hk.sp], p.x, p.y, hk.L, dir, { t: t, swim: surging ? 20 : 7, angle: ang });
      var sp = BY_ID[hk.sp], h = hk.L * sp.shape.h, cx = hk.L * 0.12, cy = -h * 0.62, w = hk.L * 0.16;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(dir, 1); ctx.rotate(ang); ctx.translate(cx, cy);
      ctx.fillStyle = '#ffcf5a'; ctx.strokeStyle = '#8a5a12'; ctx.lineWidth = Math.max(1.5, hk.L * 0.01);
      ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(-w, -w * 0.7); ctx.lineTo(-w * 0.5, -w * 0.25); ctx.lineTo(0, -w); ctx.lineTo(w * 0.5, -w * 0.25); ctx.lineTo(w, -w * 0.7); ctx.lineTo(w, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff5a6a'; ctx.beginPath(); ctx.arc(0, -w * 0.32, w * 0.16, 0, 6.283); ctx.fill();
      ctx.restore();
    }
    function introPos() {
      var k = Math.min(1, (t - run.since) / 1.4), h = run.hooked, e = 1 - Math.pow(1 - k, 3);
      return { x: h.x0, y: H + h.L + (h.y0 - H - h.L) * e };
    }
    function splash(x, y, n) {
      for (var i = 0; i < n; i++) particles.push({ type: 'drop', x: x, y: y, vx: (Math.random() - 0.5) * 220, vy: -120 - Math.random() * 220, life: 0, max: 0.9, size: 1.5 + Math.random() * 2.5 });
      ripples.push({ x: x, y: y, r: 4, life: 0 });
    }
    function sparkle(x, y, n, color) {
      if (reduced) return;
      for (var i = 0; i < n; i++) { var a = Math.random() * 6.283, v = 60 + Math.random() * 220; particles.push({ type: 'spark', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0, max: 0.9 + Math.random() * 0.6, size: 2 + Math.random() * 3, color: color }); }
    }
    function floatText(text, x, y, color) { particles.push({ type: 'text', x: x, y: y, vx: 0, vy: -46, life: 0, max: 1.5, text: text, color: color || '#ffffff' }); }
    function paintParticles(dt) {
      ctx.lineWidth = 1.4;
      ripples = ripples.filter(function (r) {
        r.life += dt; r.r += 40 * dt;
        ctx.strokeStyle = 'rgba(255,255,255,' + Math.max(0, 0.55 - r.life * 0.45).toFixed(2) + ')';
        ctx.beginPath(); ctx.ellipse(r.x, r.y + 1, r.r * S, r.r * 0.32 * S, 0, 0, 6.283); ctx.stroke();
        return r.life < 1.2;
      });
      particles = particles.filter(function (p) {
        p.life += dt;
        if (p.type === 'drop') { p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; ctx.fillStyle = 'rgba(220,245,255,.85)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.fill(); return p.y < waterY + 6 || p.vy < 0; }
        if (p.type === 'bubble') { p.y += p.vy * dt; p.x += Math.sin(t * 4 + p.size) * 0.4; ctx.strokeStyle = 'rgba(220,245,255,.6)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.283); ctx.stroke(); return p.y > waterY && p.life < p.max; }
        if (p.type === 'spark') { p.vy += 200 * dt; p.x += p.vx * dt; p.y += p.vy * dt; var a = 1 - p.life / p.max; ctx.fillStyle = rgba(p.color || '#ffcf5a', Math.max(0, a).toFixed(2)); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 6); ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.6); ctx.restore(); return p.life < p.max; }
        if (p.type === 'text') {
          p.y += p.vy * dt; var al = Math.min(1, (p.max - p.life) * 2);
          ctx.font = '800 ' + Math.round(22 * S + 6) + 'px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(12,16,34,' + (0.7 * al).toFixed(2) + ')'; ctx.strokeText(p.text, p.x, p.y);
          ctx.fillStyle = rgba(p.color, al.toFixed(2)); ctx.fillText(p.text, p.x, p.y); return p.life < p.max;
        }
        return false;
      });
      if (Math.random() < 0.05) particles.push({ type: 'bubble', x: Math.random() * W, y: H - 20 * S, vx: 0, vy: -24 - Math.random() * 20, life: 0, max: 8, size: 1.5 + Math.random() * 2 });
    }
    function frame(now) {
      raf = 0;
      if (!visible) return;
      var dt = Math.min(0.05, (now - (last || now)) / 1000); last = now; t += dt;
      if (run && run.phase !== 'over') step(dt);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.save();
      if (shake > 0 && !reduced) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.88; if (shake < 0.4) shake = 0; }
      paintSky(); paintWater(); paintWave(dt); paintBoat(); paintLineAndHooked(); paintParticles(dt);
      ctx.restore();
      raf = requestAnimationFrame(frame);
    }
    function startLoop() { if (!raf && visible) { last = 0; raf = requestAnimationFrame(frame); } }

    /* ----- a round: quest, boss or free fishing ----- */
    function stats() { return { caught: 0, kg: 0, tiers: [0, 0, 0, 0, 0], streak: 0, bestStreak: 0, misses: 0, answered: 0, correct: 0, fresh: [], biggest: null }; }
    function begin(mode, loc, qi) {
      var d = api.deck();
      var items = d && window.VMGames ? window.VMGames.questions(d.cards, 400, null, api.moreSentences(d)) : [];
      if (items.length < 4) { api.toast(tr('toast.needMatch'), 'err', 5000); return; }
      setLoc(loc);
      var s = load(), L = LOC_BY_ID[loc];
      run = { mode: mode, loc: loc, qi: qi, quest: mode === 'quest' ? L.quests[qi] : null, deck: d, items: items, i: 0, s: s, st: stats(),
        duration: mode === 'quest' ? QUEST_SECONDS : mode === 'boss' ? BOSS_SECONDS : FREE_SECONDS, elapsed: 0, phase: 'wave', since: t, wave: null, hooked: null, fight: null };
      overlay.hidden = true; overlay.innerHTML = '';
      stage.classList.add('playing'); stage.classList.toggle('boss-mode', mode === 'boss');
      feedback.textContent = ''; streakChip.hidden = true;
      bossUi.hidden = mode !== 'boss'; promptCard.hidden = mode === 'boss';
      doc.addEventListener('keydown', onKey); doc.addEventListener('keyup', onKeyUp);
      if (mode === 'boss') startBoss(); else spawnWave();
      updateHud();
    }
    function nextItem() { var q = run.items[run.i % run.items.length]; run.i++; return q; }
    function setPhase(p) { run.phase = p; run.since = t; }
    function spawnWave() {
      clearTags();
      var q = nextItem(), lanes = [0, 1, 2, 3].sort(function () { return Math.random() - 0.5; });
      run.wave = { q: q, start: run.elapsed, fish: [] };
      promptKind.textContent = tr(q.type === 'context' ? 'fish.askContext' : 'fish.askMeaning');
      promptText.innerHTML = '';
      if (q.type === 'context') {
        promptText.lang = run.deck.source; promptText.appendChild(doc.createTextNode(q.before));
        var gap = el('span', 'fx-gap', '____'); gap.setAttribute('aria-label', tr('game.gap')); promptText.appendChild(gap); promptText.appendChild(doc.createTextNode(q.after));
      } else { promptText.lang = run.deck.target; promptText.textContent = '«' + q.prompt + '»'; }
      promptCard.classList.remove('pop'); void promptCard.offsetWidth; promptCard.classList.add('pop');
      var spd = LOC_BY_ID[run.loc].speed;
      q.options.forEach(function (o, i) {
        var right = o === q.answer, sp = rollSpecies(run.loc, { combo: run.st.streak, bait: run.s.bait, hard: right && hardWord(q.card) });
        var fromLeft = i % 2 === 0, L = (56 + BY_ID[sp].r * 9) * S;
        var f = { word: o, right: right, sp: sp, L: L, lane: lanes[i], baseY: laneY(lanes[i]), y: laneY(lanes[i]), x: fromLeft ? minX() + Math.random() * 90 * S : W - 70 * S - Math.random() * 90 * S, dir: fromLeft ? 1 : -1, v: (34 + Math.random() * 26) * spd * S, ph: Math.random() * 6 };
        var tag = btn('fx-tag r-' + RARITY[BY_ID[sp].r], null, function () { pick(f); });
        tag.appendChild(el('kbd', null, String(i + 1))); var w = el('span', null, o); w.lang = run.deck.source; tag.appendChild(w);
        tag.setAttribute('aria-label', (i + 1) + '. ' + o);
        f.tag = tag; tags.appendChild(tag);
        run.wave.fish.push(f);
      });
      setPhase('wave');
    }
    function clearTags() { tags.innerHTML = ''; if (run && run.wave) run.wave.fish.forEach(function (f) { f.tag = null; }); }
    function pick(f) {
      if (!run || run.phase !== 'wave' || !run.wave || f.flee) return;
      var w = run.wave, q = w.q, ms = (run.elapsed - w.start) * 1000, st = run.st;
      st.answered++;
      api.answer(q.card, f.right, true);
      if (!f.right) {
        st.misses++; st.streak = 0;
        f.flee = true; f.dir = f.x < W / 2 ? -1 : 1;
        if (f.tag) f.tag.classList.add('wrong');
        var right = w.fish.filter(function (x) { return x.right; })[0];
        if (right && right.tag) right.tag.classList.add('show-right');
        feedback.textContent = tr('fish.answerWas', { w: q.answer, t: q.card.translation }); feedback.className = 'fx-feedback bad';
        fx('bad'); shake = 6; splash(f.x, waterY, 6);
        setPhase('miss'); updateHud();
        if (run.quest && failed(run.quest, st)) setTimeout(function () { if (run && run.phase === 'miss') endQuest(false); }, 900);
        return;
      }
      st.correct++; st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak);
      var fast = ms < 2500, k = weigh(f.sp, { rod: run.s.rod, fast: fast });
      feedback.textContent = fast ? tr('fish.fastPick') : tr('fish.goodPick'); feedback.className = 'fx-feedback ok';
      w.fish.forEach(function (x) { if (x !== f) { x.flee = true; x.dir = x.x < W / 2 ? -1 : 1; } });
      f.frozen = true;
      run.hooked = { sp: f.sp, kg: k, x0: f.x, y0: Math.min(f.y, H - (W < 600 ? 175 : 140) * Math.max(0.8, S)), L: f.L, fish: f };
      Array.prototype.forEach.call(tags.children, function (x) { x.disabled = true; x.classList.add('gone'); });
      setPhase('cast'); fx('cast');
      if (st.streak >= 2) { streakChip.hidden = false; streakChip.textContent = tr('fish.combo', { n: st.streak }); streakChip.classList.toggle('hot', st.streak >= 3); streakChip.classList.remove('bump'); void streakChip.offsetWidth; streakChip.classList.add('bump'); }
      updateHud();
    }
    function startFight() {
      var h = run.hooked; h.fish.hooked = true; clearTags();
      run.fight = newFight(strength(h.sp, h.kg));
      splash(h.x0, waterY, 8); fx('bite');
      reelUi.hidden = false; promptCard.classList.add('dim');
      setPhase('reel'); updateReel();
    }
    function updateReel() {
      var f = run.fight; if (!f) return;
      var cap = 1 + 0.15 * run.s.line, pct = Math.min(1, f.tension / cap);
      meterFill.style.transform = 'scaleX(' + pct.toFixed(3) + ')';
      meter.className = 'fx-meter' + (pct > 0.78 ? ' hot' : pct > 0.5 ? ' warm' : '');
      meter.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
      distFill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, 1 - f.dist)).toFixed(3) + ')';
      var surging = f.surge && !(f.stun > 0);
      reelUi.classList.toggle('surge', surging);
      reelHint.textContent = f.stun > 0 ? tr('fish.stunned') : surging ? tr('fish.surge') : f.floor != null && f.dist <= f.floor + 0.02 ? tr('fish.tooStrong') : tr('fish.pull');
      reelBtn.setAttribute('aria-pressed', holding ? 'true' : 'false');
      reelBtn.classList.toggle('on', holding);
    }
    function step(dt) {
      if (run.phase !== 'strike') run.elapsed += dt;
      var left = Math.max(0, run.duration - run.elapsed);
      if (Math.ceil(left) !== run.lastSec) { run.lastSec = Math.ceil(left); if (left <= 5 && left > 0) fx('tick'); }
      hudTimeV.textContent = String(Math.ceil(left)); hudTime.classList.toggle('low', left <= 10);
      timeFill.style.transform = 'scaleX(' + (left / run.duration).toFixed(4) + ')';
      var since = t - run.since, ph = run.phase;
      if (ph === 'cast' && since >= 0.45) startFight();
      else if (ph === 'miss' && since >= 1.3) { if (left <= 0) return timeUp(); spawnWave(); }
      else if (ph === 'lost' && since >= 1.2) { if (left <= 0) return timeUp(); if (run.mode === 'boss') resumeBoss(); else spawnWave(); }
      else if (ph === 'show' && since >= run.showFor) { catchCard.hidden = true; afterCatch(); }
      else if (ph === 'intro' && since >= 1.4) { setPhase('reel'); reelUi.hidden = false; updateReel(); banner.className = 'fx-banner'; }
      else if (ph === 'reel') {
        var res = reelStep(run.fight, dt, holding, { rod: run.s.rod, line: run.s.line });
        if (run.mode === 'boss') bossTick(dt);
        if (run.phase === 'reel') { updateReel(); if (res) fightOver(res); }
      } else if (ph === 'strike') strikeTick();
      if (left <= 0 && (ph === 'wave' || ph === 'reel' || ph === 'cast')) timeUp();
    }
    function fightOver(res) {
      reelUi.hidden = true; holding = false; promptCard.classList.remove('dim');
      if (res === 'landed') return land();
      fx('bad'); shake = 8;
      say(tr(res === 'snapped' ? 'fish.snapped' : 'fish.escaped'));
      if (run.mode === 'boss') { run.boss.spools--; updateHud(); if (run.boss.spools <= 0) { setTimeout(function () { if (run && run.mode === 'boss') endBoss(false); }, 900); setPhase('over2'); return; } }
      else { var hk = run.hooked; if (hk) { hk.fish.hooked = false; } run.hooked = null; }
      setPhase('lost');
    }
    function say(text, cls) { banner.textContent = text; banner.className = 'fx-banner'; void banner.offsetWidth; banner.className = 'fx-banner on' + (cls ? ' ' + cls : ''); clearTimeout(say.t); say.t = setTimeout(function () { banner.className = 'fx-banner'; }, 2300); }
    function land() {
      var h = run.hooked, sp = BY_ID[h.sp], st = run.st;
      if (run.mode === 'boss') return endBoss(true);
      st.caught++; st.kg += h.kg; for (var k = 0; k <= sp.r; k++) st.tiers[k]++;
      var fresh = log(run.s, { id: h.sp, kg: h.kg }); if (fresh) st.fresh.push(h.sp);
      if (!st.biggest || h.kg > st.biggest.kg) st.biggest = { id: h.sp, kg: h.kg };
      save(run.s);
      run.landed = { id: h.sp, kg: h.kg, L: Math.min(110 * S, h.L * 1.15) }; run.hooked = null; run.fight = null;
      var rarity = RARITY[sp.r], color = RARITY_COLOR[rarity], tip = rodTip();
      splash(tip.x + 6 * S, waterY, 14); fx('splash');
      floatText('+' + kg(h.kg), Math.min(W - 60, tip.x + 120 * S), waterY - 20 * S, color);
      if (sp.r >= 3) { fx('crit'); sparkle(tip.x, tip.y + 60 * S, sp.r === 4 ? 60 : 34, color); shake = sp.r === 4 ? 14 : 8; } else fx('ok');
      catchCard.innerHTML = ''; catchCard.className = 'fx-catch r-' + rarity;
      var cv = el('canvas', 'fx-catch-art'); cv.setAttribute('aria-hidden', 'true'); paintMini(cv, h.sp, 150, 96);
      var info = el('div', 'fx-catch-info');
      info.appendChild(el('span', 'fx-rarity', tr('fish.rarity.' + rarity)));
      info.appendChild(el('strong', null, fishName(h.sp)));
      info.appendChild(el('span', 'fx-weight', kg(h.kg)));
      if (fresh) info.appendChild(el('span', 'fx-new', tr('fish.newSpecies')));
      catchCard.appendChild(cv); catchCard.appendChild(info); catchCard.hidden = false;
      feedback.textContent = tr('fish.caughtSr', { f: fishName(h.sp), w: kg(h.kg) }); feedback.className = 'fx-feedback ok';
      run.showFor = sp.r >= 3 || fresh ? 1.8 : 1.1;
      setPhase('show'); updateHud();
    }
    function afterCatch() {
      run.landed = null;
      if (run.quest && done(run.quest, run.st)) return endQuest(true);
      if (run.elapsed >= run.duration) return timeUp();
      spawnWave();
    }
    function timeUp() {
      if (!run || run.phase === 'over') return;
      if (run.mode === 'quest') endQuest(false);
      else if (run.mode === 'boss') endBoss(false);
      else endFree();
    }
    function updateHud() {
      if (!run) return;
      var st = run.st;
      if (run.mode === 'quest') {
        var p = progress(run.quest, st);
        goalLabel.textContent = tr('fish.goal.' + run.quest.type, { m: tr('fish.rarity.' + (RARITY[run.quest.min] || 'common')) });
        goalValue.textContent = (run.quest.type === 'kg' ? p.have.toFixed(1) : p.have) + ' / ' + p.need + (run.quest.type === 'clean' ? ' · ✗' + st.misses + '/' + run.quest.miss : '');
      } else if (run.mode === 'boss') {
        goalLabel.textContent = tr('fish.bossHits'); goalValue.textContent = run.boss.hits + ' / ' + run.boss.cfg.strikes;
        bossFill.style.transform = 'scaleX(' + (1 - run.boss.hits / run.boss.cfg.strikes).toFixed(3) + ')';
        spools.textContent = ''; for (var i = 0; i < 3; i++) spools.appendChild(el('i', i < run.boss.spools ? 'on' : null));
        spools.setAttribute('aria-label', tr('fish.spools', { n: run.boss.spools }));
      } else { goalLabel.textContent = tr('fish.hudCatch'); goalValue.textContent = st.kg.toFixed(1) + ' ' + tr('fish.kgUnit'); }
      goalValue.classList.remove('bump'); void goalValue.offsetWidth; goalValue.classList.add('bump');
    }

    /* ----- boss ----- */
    function startBoss() {
      var L = LOC_BY_ID[run.loc], cfg = L.boss;
      run.boss = { cfg: cfg, hits: 0, spools: 3, nextStrike: 3.2 };
      bossName.textContent = tr('fish.boss.' + cfg.id);
      var x0 = Math.min(W - 160 * S, Math.max(minX() + 180 * S, W * 0.62));
      run.hooked = { sp: cfg.species, kg: 0, x0: x0, y0: laneY(2), L: 90 * S * cfg.size, boss: true, fish: {} };
      run.fight = newFight(cfg.strength, 0.42);
      reelUi.hidden = true; say(tr('fish.bossAppears', { b: tr('fish.boss.' + cfg.id) }), 'boss');
      fx('crit'); shake = 10;
      setPhase('intro');
    }
    function bossTick(dt) {
      var b = run.boss, f = run.fight;
      if (b.hits >= b.cfg.strikes) return;
      b.nextStrike -= dt;
      if (b.nextStrike <= 0 || (holding && f.floor != null && f.dist <= f.floor + 0.01 && b.nextStrike < 2.5)) openStrike();
    }
    function openStrike() {
      var q = nextItem(), b = run.boss;
      holding = false; reelUi.hidden = true;
      run.strikeQ = q; run.strikeAt = performance.now();
      strike.innerHTML = '';
      strike.appendChild(el('span', 'fx-eyebrow', tr('fish.strikeEyebrow', { b: tr('fish.boss.' + b.cfg.id) })));
      var p = el('p', 'fx-prompt');
      if (q.type === 'context') { p.lang = run.deck.source; p.appendChild(doc.createTextNode(q.before)); var gap = el('span', 'fx-gap', '____'); gap.setAttribute('aria-label', tr('game.gap')); p.appendChild(gap); p.appendChild(doc.createTextNode(q.after)); }
      else { p.lang = run.deck.target; p.textContent = '«' + q.prompt + '»'; }
      strike.appendChild(p);
      var bar = el('div', 'fx-bite'), bf = el('i'); bar.appendChild(bf); strike.appendChild(bar); run.strikeBar = bf;
      var opts = el('div', 'fx-opts');
      q.options.forEach(function (o, i) {
        var b2 = btn('fx-opt', null, function () { answerStrike(o); });
        b2.appendChild(el('kbd', null, String(i + 1))); var sp = el('span', null, o); sp.lang = run.deck.source; b2.appendChild(sp);
        b2.dataset.value = o; opts.appendChild(b2);
      });
      strike.appendChild(opts); strike.hidden = false;
      setPhase('strike'); fx('bite');
      var first = opts.querySelector('button'); if (first && !('ontouchstart' in window)) first.focus({ preventScroll: true });
    }
    function strikeTick() {
      var used = performance.now() - run.strikeAt;
      if (run.strikeBar) run.strikeBar.style.transform = 'scaleX(' + Math.max(0, 1 - used / STRIKE_MS).toFixed(3) + ')';
      if (used >= STRIKE_MS) answerStrike(null);
    }
    function answerStrike(value) {
      if (!run || run.phase !== 'strike') return;
      var q = run.strikeQ, ok = value === q.answer, b = run.boss, f = run.fight;
      run.st.answered++; api.answer(q.card, ok, true);
      strike.querySelectorAll('.fx-opt').forEach(function (x) { x.disabled = true; if (x.dataset.value === q.answer) x.classList.add('correct'); else if (x.dataset.value === value) x.classList.add('wrong'); });
      setPhase('strikeDone');
      if (ok) {
        run.st.correct++; b.hits++; f.stun = 2.4; f.surge = false; f.dist = Math.max(f.floor == null ? 0 : f.floor, f.dist - 0.12); f.tension = Math.max(0, f.tension - 0.3);
        fx('crit'); shake = 9; var p = hookedPos(); sparkle(p.x, p.y, 30, '#ffcf5a');
        if (b.hits >= b.cfg.strikes) { f.floor = null; say(tr('fish.bossTired'), 'gold'); } else say(tr('fish.strikeHit'), 'gold');
        b.nextStrike = 5 + Math.random() * 2;
      } else {
        run.st.misses++; f.tension += 0.45; f.dist = Math.min(1.1, f.dist + 0.18); f.surge = true; f.phase = 0.8;
        fx('bad'); shake = 12; say(tr('fish.strikeMiss', { w: q.answer }));
        b.nextStrike = 4;
      }
      updateHud();
      setTimeout(function () { if (!run || run.phase !== 'strikeDone') return; strike.hidden = true; reelUi.hidden = false; setPhase('reel'); updateReel(); }, ok ? 700 : 1300);
    }
    function resumeBoss() {
      var f = run.fight; f.tension = 0.2; f.dist = Math.min(1, Math.max(f.dist, 0.6)); f.surge = false; f.phase = 1;
      reelUi.hidden = false; setPhase('reel'); updateReel();
    }

    /* ----- ends ----- */
    function stopRun() {
      doc.removeEventListener('keydown', onKey); doc.removeEventListener('keyup', onKeyUp);
      holding = false; clearTags(); reelUi.hidden = true; strike.hidden = true; catchCard.hidden = true; bossUi.hidden = true; promptCard.hidden = false; promptCard.classList.remove('dim');
      stage.classList.remove('playing', 'boss-mode');
      var g = run; g.phase = 'over'; run = null; api.complete();
      return g;
    }
    function endQuest(ok) {
      var g = stopRun(), s = g.s, st = g.st, starsN = ok ? stars(st.misses) : 0, reward = ok ? questReward(st, starsN) : Math.round(st.kg / 2);
      var story = s.story[g.loc], prev = story.q[g.qi];
      if (ok) story.q[g.qi] = Math.max(prev, starsN);
      s.pearls += reward; s.rounds++; save(s);
      fx(ok ? 'win' : 'lose'); if (ok) sparkle(W / 2, H * 0.3, 60, '#ffcf5a');
      var p = panel('fx-result');
      heading(p, tr('fish.questN', { n: g.qi + 1, place: tr('fish.loc.' + g.loc) }), tr(ok ? 'fish.questDone' : 'fish.questFail'));
      if (ok) { var row = el('div', 'fx-stars'); row.setAttribute('aria-label', tr('fish.starsN', { n: starsN })); for (var i = 0; i < 3; i++) row.appendChild(el('i', i < starsN ? 'on' : null)); p.appendChild(row); }
      p.appendChild(hostLine(LOC_BY_ID[g.loc].host, ok ? 'fish.thanks.' + LOC_BY_ID[g.loc].host : 'fish.tryAgain'));
      var meta = el('div', 'fx-meta');
      meta.appendChild(metaItem(tr('fish.correct'), st.correct + ' / ' + st.answered));
      meta.appendChild(metaItem(tr('fish.hudCatch'), kg(st.kg)));
      meta.appendChild(metaItem(tr('fish.earned'), '+' + reward + ' ◆'));
      p.appendChild(meta);
      if (st.fresh.length) p.appendChild(el('p', 'fx-fresh', tr('fish.freshN', { n: st.fresh.length, list: st.fresh.map(fishName).join(', ') })));
      var actions = el('div', 'fx-actions'), nx = nextStep(s), primary;
      if (ok && nx && nx.loc === g.loc) primary = btn('fx-btn primary', nx.kind === 'boss' ? tr('fish.toBoss') : tr('fish.nextQuest'), function () { go(nx); });
      else if (ok && nx) primary = btn('fx-btn primary', tr('fish.toMap'), showMap);
      else primary = btn('fx-btn primary', tr('fish.retry'), function () { questIntro(g.loc, g.qi); });
      actions.appendChild(primary);
      actions.appendChild(btn('fx-btn', tr('fish.toMap'), showMap));
      p.appendChild(actions); primary.focus({ preventScroll: true });
    }
    function endBoss(won) {
      var g = stopRun(), s = g.s, L = LOC_BY_ID[g.loc], first = won && !s.story[g.loc].boss;
      var reward = won ? (first ? 80 : 30) : 5;
      if (won) { s.story[g.loc].boss = true; s.trophies[L.boss.id] = (s.trophies[L.boss.id] || 0) + 1; }
      s.pearls += reward; s.rounds++; save(s);
      if (won) { fx('win'); sparkle(W / 2, H * 0.35, 90, '#ffcf5a'); shake = 16; } else fx('lose');
      var after = function () {
        var p = panel('fx-result');
        heading(p, tr('fish.boss.' + L.boss.id), tr(won ? 'fish.bossWon' : 'fish.bossLost'));
        if (won) { var cv = el('canvas', 'fx-trophy'); cv.setAttribute('aria-hidden', 'true'); paintMini(cv, L.boss.species, 220, 130); p.appendChild(cv); }
        p.appendChild(el('p', 'fx-lead', tr('fish.bossReward', { n: reward })));
        var actions = el('div', 'fx-actions'), primary = won ? btn('fx-btn primary', tr('fish.toMap'), showMap) : btn('fx-btn primary', tr('fish.retry'), function () { go({ loc: g.loc, kind: 'boss' }); });
        actions.appendChild(primary); if (!won) actions.appendChild(btn('fx-btn', tr('fish.toMap'), showMap));
        p.appendChild(actions); primary.focus({ preventScroll: true });
      };
      if (won && first) dialog(storyLines(g.loc, 'outro'), after); else after();
    }
    function endFree() {
      var g = stopRun(), s = g.s, st = g.st, earned = Math.round(st.kg), record = st.kg > (s.best || 0) && st.kg > 0;
      s.pearls += earned; s.rounds++; if (record) s.best = Math.round(st.kg * 10) / 10; save(s);
      fx(record ? 'win' : 'ok');
      var p = panel('fx-end');
      heading(p, tr('fish.over'), tr('fish.totalCatch'));
      var big = el('div', 'fx-total'); big.appendChild(el('strong', null, st.kg.toFixed(1))); big.appendChild(el('span', null, tr('fish.kgUnit'))); p.appendChild(big);
      if (record) p.appendChild(el('p', 'fx-record', tr('game.record')));
      var meta = el('div', 'fx-meta');
      meta.appendChild(metaItem(tr('fish.correct'), st.correct + ' / ' + st.answered));
      meta.appendChild(metaItem(tr('fish.bestCombo'), '×' + st.bestStreak));
      meta.appendChild(metaItem(tr('fish.earned'), '+' + earned + ' ◆'));
      p.appendChild(meta);
      if (st.fresh.length) p.appendChild(el('p', 'fx-fresh', tr('fish.freshN', { n: st.fresh.length, list: st.fresh.map(fishName).join(', ') })));
      var actions = el('div', 'fx-actions'), again = btn('fx-btn primary', tr('fish.again'), function () { begin('free', g.loc); });
      actions.appendChild(again); actions.appendChild(btn('fx-btn', tr('fish.toMap'), showMap));
      p.appendChild(actions); again.focus({ preventScroll: true });
    }
    function abandon() { if (!run) return; var g = run; if (g.mode === 'free') return endFree(); stopRun(); showMap(); }

    /* ----- story, map and panels ----- */
    function storyLines(loc, part) {
      var host = LOC_BY_ID[loc].host;
      if (part === 'intro') return [{ who: host, key: 'fish.story.' + loc + '.intro1' }, { who: host, key: 'fish.story.' + loc + '.intro2' }];
      if (part === 'boss') return [{ who: host, key: 'fish.story.' + loc + '.boss' }];
      return [{ who: loc === 'sea' ? 'ota' : host, key: 'fish.story.' + loc + '.outro' }];
    }
    function go(stepTo) {
      if (stepTo.kind === 'boss') { var s = load(); if (!s.story[stepTo.loc].bossSeen) { s.story[stepTo.loc].bossSeen = true; save(s); } dialog(storyLines(stepTo.loc, 'boss'), function () { begin('boss', stepTo.loc); }); }
      else questIntro(stepTo.loc, stepTo.qi);
    }
    function panel(cls) {
      overlay.innerHTML = ''; overlay.hidden = false;
      var p = el('div', 'fx-panel ' + (cls || '')); p.setAttribute('role', 'dialog');
      overlay.appendChild(p); return p;
    }
    function heading(p, eyebrow, title) {
      if (eyebrow) p.appendChild(el('span', 'fx-eyebrow', eyebrow));
      var h = el('h2', 'fx-title', title); h.id = 'fxT' + Math.random().toString(36).slice(2, 7); p.appendChild(h); p.setAttribute('aria-labelledby', h.id);
    }
    function metaItem(label, value) { var m = el('div', 'fx-meta-item'); m.appendChild(el('span', null, label)); m.appendChild(el('strong', null, value)); return m; }
    function portrait(who, size) { var cv = el('canvas', 'fx-portrait'); cv.setAttribute('aria-hidden', 'true'); paintPortrait(cv, who, size || 96); return cv; }
    function hostLine(who, key) {
      var row = el('div', 'fx-hostline'); row.appendChild(portrait(who, 56));
      var txt = el('p'); txt.appendChild(el('b', null, tr('fish.who.' + who) + ': ')); txt.appendChild(doc.createTextNode(tr(key))); row.appendChild(txt);
      return row;
    }
    function dialog(lines, then) {
      var i = 0;
      (function show() {
        var line = lines[i], p = panel('fx-dialog');
        var row = el('div', 'fx-dialog-row'); row.appendChild(portrait(line.who, 110));
        var box = el('div', 'fx-dialog-box'); box.appendChild(el('span', 'fx-eyebrow', tr('fish.who.' + line.who)));
        var text = el('p', 'fx-dialog-text', tr(line.key)); box.appendChild(text); row.appendChild(box); p.appendChild(row);
        var nextB = btn('fx-btn primary', i < lines.length - 1 ? tr('fish.next') : tr('fish.letsGo'), function () { i++; if (i < lines.length) show(); else then(); });
        var actions = el('div', 'fx-actions'); actions.appendChild(nextB); p.appendChild(actions);
        p.setAttribute('aria-label', tr('fish.who.' + line.who));
        nextB.focus({ preventScroll: true });
      })();
    }
    function questIntro(loc, qi) {
      setLoc(loc);
      var s = load(), L = LOC_BY_ID[loc], q = L.quests[qi];
      var start = function () {
        var p = panel('fx-quest');
        heading(p, tr('fish.questN', { n: qi + 1, place: tr('fish.loc.' + loc) }), tr('fish.questTitle.' + q.type, { n: q.n, m: tr('fish.rarity.' + (RARITY[q.min] || 'common')), x: q.miss }));
        p.appendChild(hostLine(L.host, 'fish.ask.' + loc + '.' + qi));
        var rules = el('ul', 'fx-rules');
        [['⏱', tr('fish.ruleTime', { s: QUEST_SECONDS })], ['◎', tr('fish.ruleTap')], ['⇅', tr('fish.ruleReel')], ['★', tr('fish.ruleStars')]].forEach(function (r) { var li = el('li'); li.appendChild(el('b', null, r[0])); li.appendChild(el('span', null, r[1])); rules.appendChild(li); });
        p.appendChild(rules);
        var actions = el('div', 'fx-actions'), go2 = btn('fx-btn primary', tr('fish.cast'), function () { begin('quest', loc, qi); });
        actions.appendChild(go2); actions.appendChild(btn('fx-btn', tr('fish.toMap'), showMap));
        p.appendChild(actions); go2.focus({ preventScroll: true });
      };
      if (qi === 0 && !s.story[loc].q[0] && !s.story[loc].met) { s.story[loc].met = true; save(s); dialog(storyLines(loc, 'intro'), start); }
      else start();
    }
    function showMap() {
      var s = load(), p = panel('fx-map');
      var head = el('div', 'fx-map-head');
      var ht = el('div'); heading(ht, tr('fish.mapEyebrow'), tr('fish.mapTitle')); ht.removeAttribute('aria-labelledby'); head.appendChild(ht);
      p.setAttribute('aria-labelledby', ht.querySelector('h2').id);
      var wallet = el('span', 'fx-wallet-chip', s.pearls + ' ◆'); wallet.setAttribute('aria-label', tr('fish.pearls') + ': ' + s.pearls); head.appendChild(wallet);
      p.appendChild(head);
      var nx = nextStep(s), list = el('ol', 'fx-places');
      LOCATIONS.forEach(function (L, i) {
        var open = unlocked(s, i), st = s.story[L.id], li = el('li', 'fx-place loc-' + L.id + (open ? '' : ' locked'));
        var art = el('div', 'fx-place-art'); art.appendChild(portrait(L.host, 64)); li.appendChild(art);
        var body = el('div', 'fx-place-body');
        body.appendChild(el('strong', null, tr('fish.loc.' + L.id)));
        body.appendChild(el('span', 'fx-place-sub', open ? tr('fish.hostIs', { h: tr('fish.who.' + L.host) }) : tr('fish.lockedAfter', { b: tr('fish.boss.' + LOCATIONS[i - 1].boss.id) })));
        var nodes = el('div', 'fx-nodes');
        L.quests.forEach(function (q, qi) {
          var can = questOpen(s, L.id, qi), n = st.q[qi];
          var b = btn('fx-node' + (n ? ' done' : '') + (nx && nx.loc === L.id && nx.kind === 'quest' && nx.qi === qi ? ' next' : ''), null, function () { questIntro(L.id, qi); });
          b.disabled = !can; b.appendChild(el('span', 'fx-node-n', String(qi + 1)));
          var stars3 = el('span', 'fx-node-stars'); for (var k = 0; k < 3; k++) stars3.appendChild(el('i', k < n ? 'on' : null)); b.appendChild(stars3);
          b.setAttribute('aria-label', tr('fish.questN', { n: qi + 1, place: tr('fish.loc.' + L.id) }) + '. ' + tr('fish.questTitle.' + q.type, { n: q.n, m: tr('fish.rarity.' + (RARITY[q.min] || 'common')), x: q.miss }) + (n ? '. ' + tr('fish.starsN', { n: n }) : ''));
          nodes.appendChild(b);
        });
        var bb = btn('fx-node boss' + (st.boss ? ' done' : '') + (nx && nx.loc === L.id && nx.kind === 'boss' ? ' next' : ''), null, function () { go({ loc: L.id, kind: 'boss' }); });
        bb.disabled = !bossOpen(s, L.id); bb.appendChild(el('span', 'fx-node-n', '♛'));
        bb.setAttribute('aria-label', tr('fish.boss.' + L.boss.id) + (st.boss ? ' — ' + tr('fish.bossBeaten') : ''));
        nodes.appendChild(bb);
        body.appendChild(nodes); li.appendChild(body);
        if (open) { var free = btn('fx-btn small ghost', tr('fish.free'), function () { begin('free', L.id); }); li.appendChild(free); }
        list.appendChild(li);
      });
      p.appendChild(list);
      var actions = el('div', 'fx-actions');
      var cont = nx ? btn('fx-btn primary', tr('fish.continue'), function () { go(nx); }) : btn('fx-btn primary', tr('fish.free'), function () { begin('free', 'sea'); });
      actions.appendChild(cont);
      actions.appendChild(btn('fx-btn', tr('fish.shop'), function () { showShop(showMap); }));
      actions.appendChild(btn('fx-btn', tr('fish.journal'), function () { showJournal(showMap); }));
      p.appendChild(actions);
      p.appendChild(btn('fx-link', tr('fish.backHub'), close));
      cont.focus({ preventScroll: true });
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
      var bk = btn('fx-btn', tr('fish.back'), back); p.appendChild(bk);
    }
    function showJournal(back) {
      var s = load(), p = panel('fx-journal');
      heading(p, tr('fish.journalEyebrow', { n: Object.keys(s.seen).length, m: SPECIES.length }), tr('fish.journal'));
      var grid = el('div', 'fx-species');
      SPECIES.forEach(function (sp) {
        var seen = s.seen[sp.id], cell = el('div', 'fx-sp r-' + RARITY[sp.r] + (seen ? '' : ' locked'));
        var cv = el('canvas'); cv.setAttribute('aria-hidden', 'true'); paintMini(cv, sp.id, 110, 64, !seen); cell.appendChild(cv);
        cell.appendChild(el('strong', null, seen ? fishName(sp.id) : '???'));
        cell.appendChild(el('span', 'fx-sp-meta', tr('fish.rarity.' + RARITY[sp.r]) + (seen ? ' · ' + kg(seen.best) : '')));
        cell.appendChild(el('span', 'fx-sp-where', sp.at.map(function (a) { return tr('fish.loc.' + a); }).join(' · ')));
        grid.appendChild(cell);
      });
      p.appendChild(grid);
      var bk = btn('fx-btn', tr('fish.back'), back); p.appendChild(bk); bk.focus({ preventScroll: true });
    }
    function paintMini(cv, id, w, h, locked) {
      var r = Math.min(2, window.devicePixelRatio || 1);
      cv.width = w * r; cv.height = h * r; cv.style.width = w + 'px'; cv.style.height = h + 'px';
      var c = cv.getContext('2d'); c.setTransform(r, 0, 0, r, 0, 0);
      if (locked) drawFish(c, BY_ID[id], w / 2 + 4, h / 2, w * 0.66, 1, { swim: 0, silhouette: 'rgba(20,28,56,.85)' });
      else drawCatch(c, id, w / 2 + 4, h / 2, w * 0.66, 1, { swim: 0, t: 0.7 });
    }
    function paintPortrait(cv, who, size) {
      var r = Math.min(2, window.devicePixelRatio || 1);
      cv.width = size * r; cv.height = size * r; cv.style.width = size + 'px'; cv.style.height = size + 'px';
      var c = cv.getContext('2d'); c.setTransform(r * size / 100, 0, 0, r * size / 100, 0, 0);
      var bg = { ota: ['#ffd98a', '#e8a33a'], nura: ['#bfe6e8', '#4f9aa8'], timur: ['#cfe3b5', '#5f8f5a'], lola: ['#ffc7a8', '#d9665a'] }[who] || ['#ccc', '#888'];
      var g = c.createRadialGradient(40, 35, 5, 50, 50, 55); g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
      c.fillStyle = g; c.beginPath(); c.arc(50, 50, 50, 0, 6.283); c.fill();
      c.save(); c.beginPath(); c.arc(50, 50, 50, 0, 6.283); c.clip();
      if (who === 'ota') { otter(c, 46, 50, 1.9, false, true); }
      else if (who === 'nura') { // a heron: long neck, crest, long yellow beak
        c.fillStyle = '#e8eef4'; c.beginPath(); c.moveTo(40, 110); c.quadraticCurveTo(34, 70, 46, 52); c.lineTo(58, 56); c.quadraticCurveTo(50, 76, 60, 110); c.fill();
        c.beginPath(); c.ellipse(52, 42, 15, 13, 0, 0, 6.283); c.fill();
        c.fillStyle = '#2a3346'; c.beginPath(); c.moveTo(42, 34); c.quadraticCurveTo(22, 30, 14, 40); c.quadraticCurveTo(28, 34, 44, 40); c.fill();
        c.fillStyle = '#f2b632'; c.beginPath(); c.moveTo(62, 40); c.lineTo(94, 46); c.lineTo(62, 47); c.fill();
        c.fillStyle = '#141a2e'; c.beginPath(); c.arc(56, 40, 2.6, 0, 6.283); c.fill(); c.fillStyle = '#fff'; c.fillRect(56.5, 38.6, 1.1, 1.1);
        c.fillStyle = '#9fb0c4'; c.beginPath(); c.ellipse(46, 96, 22, 14, -0.3, 0, 6.283); c.fill();
      } else if (who === 'timur') { // a beaver: round head, big teeth, small ears
        c.fillStyle = '#8a5a34'; c.beginPath(); c.ellipse(50, 98, 34, 24, 0, 0, 6.283); c.fill();
        c.beginPath(); c.arc(50, 52, 26, 0, 6.283); c.fill();
        c.beginPath(); c.arc(30, 32, 6, 0, 6.283); c.arc(70, 32, 6, 0, 6.283); c.fill();
        c.fillStyle = '#c99a6a'; c.beginPath(); c.ellipse(50, 62, 15, 11, 0, 0, 6.283); c.fill();
        c.fillStyle = '#2a1a12'; c.beginPath(); c.ellipse(50, 55, 5, 3.6, 0, 0, 6.283); c.fill();
        c.fillStyle = '#fff6e6'; c.fillRect(45, 64, 4.6, 8); c.fillRect(50.4, 64, 4.6, 8);
        c.fillStyle = '#141a2e'; c.beginPath(); c.arc(40, 46, 3, 0, 6.283); c.arc(60, 46, 3, 0, 6.283); c.fill();
        c.fillStyle = '#e8a33a'; c.fillRect(26, 28, 48, 7); c.fillStyle = '#c4822a'; c.fillRect(26, 33, 48, 3);
      } else { // a gull: white head, grey back, yellow beak with a red dot
        c.fillStyle = '#9aa6b8'; c.beginPath(); c.ellipse(46, 96, 34, 22, 0, 0, 6.283); c.fill();
        c.fillStyle = '#ffffff'; c.beginPath(); c.arc(50, 52, 24, 0, 6.283); c.fill();
        c.beginPath(); c.ellipse(48, 84, 18, 16, 0, 0, 6.283); c.fill();
        c.fillStyle = '#f5c242'; c.beginPath(); c.moveTo(68, 52); c.lineTo(92, 56); c.lineTo(68, 61); c.fill();
        c.fillStyle = '#e04a3a'; c.beginPath(); c.arc(84, 58, 2.2, 0, 6.283); c.fill();
        c.fillStyle = '#141a2e'; c.beginPath(); c.arc(58, 47, 2.8, 0, 6.283); c.fill(); c.fillStyle = '#fff'; c.fillRect(58.6, 45.6, 1.1, 1.1);
        c.fillStyle = '#1c2a52'; c.beginPath(); c.moveTo(30, 38); c.lineTo(70, 38); c.lineTo(64, 28); c.lineTo(36, 28); c.fill();
      }
      c.restore();
    }

    /* ----- input & lifecycle ----- */
    function holdOn(e) { if (run && run.phase === 'reel') { holding = true; if (e && e.cancelable) e.preventDefault(); updateReel(); } }
    function holdOff() { if (holding) { holding = false; if (run && run.phase === 'reel') updateReel(); } }
    scene.addEventListener('pointerdown', function (e) {
      if (!run) return;
      if (run.phase === 'reel') { holdOn(e); return; }
      if (run.phase !== 'wave' || e.target.closest('button')) return;
      var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, best = null, bd = 1e9;
      run.wave.fish.forEach(function (f) { if (f.flee) return; var d = Math.hypot(f.x - x, f.y - y); if (d < f.L * 0.8 && d < bd) { bd = d; best = f; } });
      if (best) pick(best);
    });
    reelBtn.addEventListener('pointerdown', holdOn);
    window.addEventListener('pointerup', holdOff); window.addEventListener('pointercancel', holdOff); window.addEventListener('blur', holdOff);
    function onKey(e) {
      if (!run || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Escape') { e.preventDefault(); abandon(); return; }
      if (e.key === ' ' || e.key === 'Enter') { if (run.phase === 'reel') { e.preventDefault(); holdOn(); return; } if (run.phase === 'show') { e.preventDefault(); run.showFor = 0; return; } }
      if (/^[1-4]$/.test(e.key)) {
        var n = Number(e.key) - 1;
        if (run.phase === 'wave') { var b = tags.children[n]; if (b && !b.disabled) { e.preventDefault(); b.click(); } }
        else if (run.phase === 'strike') { var o = strike.querySelectorAll('.fx-opt')[n]; if (o && !o.disabled) { e.preventDefault(); o.click(); } }
      }
    }
    function onKeyUp(e) { if (e.key === ' ' || e.key === 'Enter') holdOff(); }
    catchCard.addEventListener('click', function () { if (run && run.phase === 'show') run.showFor = 0; });
    function open() {
      var d = api.deck();
      if (!d || d.cards.length < 4) { api.toast(tr('toast.needMatch'), 'err', 5000); return; }
      hub.hidden = true; stage.hidden = false; visible = true;
      var host = stage.closest('.screen'); if (host) host.classList.add('arcade-on');
      var s = load(), nx = nextStep(s); setLoc(nx ? nx.loc : 'sea');
      layout(); startLoop();
      if (!s.intro) { s.intro = true; save(s); dialog([{ who: 'ota', key: 'fish.story.intro1' }, { who: 'ota', key: 'fish.story.intro2' }], showMap); }
      else showMap();
      stage.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    }
    function close() {
      if (run) stopRun();
      visible = false; if (raf) cancelAnimationFrame(raf); raf = 0;
      stage.hidden = true; hub.hidden = false; overlay.hidden = true;
      var host = stage.closest('.screen'); if (host) host.classList.remove('arcade-on');
      refreshHub();
      var tile = hub.querySelector('[data-arcade="fishing"]'); if (tile) tile.focus({ preventScroll: true });
    }
    function refreshHub() {
      var s = load(), m = hub.querySelector('[data-fish-meta]'), doneN = 0;
      LOCATIONS.forEach(function (L) { doneN += s.story[L.id].q.filter(Boolean).length + (s.story[L.id].boss ? 1 : 0); });
      if (m) m.textContent = tr('fish.hubMeta', { d: doneN, t: LOCATIONS.length * 4, n: Object.keys(s.seen).length, m: SPECIES.length, p: s.pearls });
    }
    if (window.ResizeObserver) new ResizeObserver(function () { if (visible) layout(); }).observe(stage);
    else window.addEventListener('resize', function () { if (visible) layout(); });
    doc.addEventListener('visibilitychange', function () { if (doc.hidden) { holdOff(); if (raf) cancelAnimationFrame(raf); raf = 0; } else startLoop(); });
    hub.addEventListener('click', function (e) { if (e.target.closest('[data-arcade="fishing"]')) open(); });
    // test hooks: pick the right (true) or a wrong (false) fish; land the hooked fish; answer a boss strike
    window.fishPick = function (right) { if (!run || run.phase !== 'wave') return false; var f = run.wave.fish.filter(function (x) { return x.right === !!right && !x.flee; })[0]; if (!f) return false; pick(f); return true; };
    window.fishLand = function () { if (!run || run.phase !== 'reel' || !run.fight) return false; if (run.boss) { run.boss.hits = run.boss.cfg.strikes; run.fight.floor = null; } run.fight.dist = -1; return true; };
    window.fishStrike = function (right) { if (!run || run.phase !== 'strike') return false; var q = run.strikeQ; answerStrike(right ? q.answer : q.options.filter(function (o) { return o !== q.answer; })[0]); return true; };
    refreshHub();
    return { refresh: refreshHub, leave: function () { if (!stage.hidden) close(); }, active: function () { return !!run; } };
  }

  return { RARITY: RARITY, SPECIES: SPECIES, LOCATIONS: LOCATIONS, UPGRADES: UPGRADES, tierWeights: tierWeights, rollSpecies: rollSpecies, weigh: weigh,
    strength: strength, reelStep: reelStep, newFight: newFight, progress: progress, done: done, failed: failed, stars: stars,
    defaults: defaults, clean: clean, unlocked: unlocked, questOpen: questOpen, bossOpen: bossOpen, nextStep: nextStep,
    cost: cost, buy: buy, log: log, hardWord: hardWord, questReward: questReward, mount: mount };
});
