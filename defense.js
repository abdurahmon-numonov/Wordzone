/* «Оборона» (v2.37): a tower defense over the user's own words, after Blooket's Tower Defense, in a 3D valley.
   Ink Blots crawled out of an old cave and smear words so people forget them; Bakhrom the stork asks Ota to guard
   the road to Grandma Zuhra's tea house. Every right answer brings coins; coins build towers on stone pads by the
   road: archers, Grandma's samovar (splashes hot tea) and a Samarkand tile tower (slows). Five places, the last
   one with the Blot King, whose shield of muddled words cracks after three right answers in a row. Scrolls from
   won levels buy lasting perks; after the finale there is an endless defense. The simulation is pure and tested
   in Node (test/defense.js); mount() renders it through a three.js scene (vendor/defense3d.js, loaded on first
   open) or a flat canvas fallback, with the HUD, word panel, pad buttons and panels as DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VMDefense = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* ---------------- rules ---------------- */

  // cost, range (board units), damage, cooldown (s); `up` are levels 2 and 3: [cost, changes].
  var TOWERS = {
    archer: { cost: 50, range: 3.6, dmg: 10, cd: 0.8, up: [[60, { dmg: 17 }], [90, { dmg: 26, range: 4.3 }]] },
    samovar: { cost: 90, range: 3.0, dmg: 24, cd: 2.0, splash: 1.3, up: [[90, { dmg: 40 }], [130, { dmg: 60, splash: 1.7 }]] },
    tile: { cost: 70, range: 3.0, dmg: 4, cd: 1.3, slow: 0.45, slowT: 1.6, up: [[70, { slow: 0.55, dmg: 7 }], [100, { slow: 0.62, range: 3.7, dmg: 10 }]] }
  };
  var ENEMIES = {
    blot: { hp: 40, speed: 1.45, reward: 3, lives: 1 },
    runner: { hp: 24, speed: 2.5, reward: 2, lives: 1 },
    fat: { hp: 160, speed: 0.85, reward: 8, lives: 2 },
    king: { hp: 1100, speed: 0.5, reward: 0, lives: 5, boss: true }
  };
  var GAPS = { blot: 0.9, runner: 0.55, fat: 1.8, king: 2 };
  var P1 = [[-11, -4], [-6, -4], [-6, 1.5], [-1, 1.5], [-1, -3], [4, -3], [4, 2.5], [11, 2.5]];
  var S1 = [[-8.2, -1.6], [-3.8, -0.6], [-3.6, 3.8], [1.4, -0.4], [1.6, -5.4], [6.4, 0], [6.4, 5], [-8.4, 3.2]];
  var P2 = [[-11, 3], [-5, 3], [-5, -3], [5, -3], [5, 3], [11, 3]];
  var S2 = [[-7.6, 0.4], [-2.4, 0], [2.6, 0], [7.6, 0.4], [-2.6, -5.4], [2.6, -5.4], [-7.6, 5.4], [7.6, 5.4]];
  function flipZ(a) { return a.map(function (p) { return [p[0], -p[1]]; }); }
  var W = function (s) { return s.split(' ').map(function (g) { var m = g.split('x'); return [m[0], Number(m[1])]; }); };
  var LEVELS = [
    { id: 'valley', theme: 'day', path: P1, slots: S1, towers: ['archer'], waves: [W('blot6'), W('blot8'), W('blot6 runner3')].map(fix) },
    { id: 'bridge', theme: 'day', river: true, path: P2, slots: S2, towers: ['archer', 'samovar'], waves: [W('blot8'), W('blot6 runner4'), W('blot10'), W('blot6 runner6')].map(fix) },
    { id: 'cotton', theme: 'golden', path: flipZ(P1), slots: flipZ(S1), towers: ['archer', 'samovar', 'tile'], waves: [W('blot8 runner4'), W('runner10'), W('blot10 fat1'), W('blot8 runner6'), W('fat2 blot10')].map(fix) },
    { id: 'night', theme: 'night', river: true, path: flipZ(P2), slots: flipZ(S2), towers: ['archer', 'samovar', 'tile'], waves: [W('blot10 fat1'), W('runner10'), W('fat2 blot6'), W('blot10 runner6'), W('fat3 runner6')].map(fix) },
    { id: 'lair', theme: 'lair', path: P1, slots: S1, towers: ['archer', 'samovar', 'tile'], waves: [W('blot10'), W('runner8 blot6'), W('fat2 blot8'), W('blot10 runner6'), W('fat3 runner6'), W('king1 blot6')].map(fix) }
  ];
  function fix(groups) { return groups.map(function (g) { return { type: g[0].replace(/\d+$/, ''), n: g[1] || Number(g[0].match(/\d+$/)[0]) }; }); }
  var ENDLESS = { id: 'endless', theme: 'golden', path: P1, slots: S1, towers: ['archer', 'samovar', 'tile'], endless: true };
  // Lasting perks, paid with scrolls from won levels.
  var PERKS = { treasury: { cost: 30 }, arrows: { cost: 40 }, walls: { cost: 40 }, mud: { cost: 50 }, wisdom: { cost: 60 } };
  var START_COINS = 120, LIVES = 10, WAVE_BONUS = 20, SHIELD_HITS = 3, SHIELD_OPEN = 7, AUTO_WAVE = 20;

  function makePath(points) {
    var segs = [], total = 0;
    for (var i = 1; i < points.length; i++) { var a = points[i - 1], b = points[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push({ a: a, b: b, len: len, from: total }); total += len; }
    return { points: points, segs: segs, total: total, at: function (d) {
      d = Math.max(0, Math.min(total, d));
      for (var k = 0; k < segs.length; k++) { var s = segs[k]; if (d <= s.from + s.len || k === segs.length - 1) { var f = s.len ? (d - s.from) / s.len : 0; return { x: s.a[0] + (s.b[0] - s.a[0]) * f, z: s.a[1] + (s.b[1] - s.a[1]) * f, angle: Math.atan2(s.b[0] - s.a[0], s.b[1] - s.a[1]) }; } }
      return { x: points[0][0], z: points[0][1], angle: 0 };
    } };
  }
  function towerStats(type, lv) { var t = TOWERS[type], s = { range: t.range, dmg: t.dmg, cd: t.cd, splash: t.splash, slow: t.slow, slowT: t.slowT }; for (var i = 0; i < lv - 1; i++) Object.assign(s, t.up[i][1]); return s; }
  function upgradeCost(type, lv) { var u = TOWERS[type].up[lv - 1]; return u ? u[0] : null; }
  function spent(type, lv) { var c = TOWERS[type].cost; for (var i = 0; i < lv - 1; i++) c += TOWERS[type].up[i][0]; return c; }
  function endlessWave(n) { var g = [{ type: 'blot', n: 6 + n * 2 }]; if (n >= 2) g.push({ type: 'runner', n: 2 + n }); if (n >= 4) g.push({ type: 'fat', n: Math.floor(n / 2) }); if (n > 0 && n % 8 === 0) g.push({ type: 'king', n: 1 }); return g; }
  function hpScale(levelIndex, wave, endless) { return endless ? 1 + 0.16 * wave : 1 + 0.15 * levelIndex + 0.07 * wave; }

  // A new game. perks: { treasury, arrows, walls, mud, wisdom } (true when owned).
  function createGame(levelIndex, perks) {
    var cfg = levelIndex < 0 ? ENDLESS : LEVELS[levelIndex]; perks = perks || {};
    return { level: levelIndex, cfg: cfg, perks: perks, path: makePath(cfg.path), slots: cfg.slots.map(function (p, i) { return { i: i, x: p[0], z: p[1], tower: null }; }),
      enemies: [], shots: [], events: [], coins: START_COINS + (perks.treasury ? 60 : 0), lives: LIVES + (perks.walls ? 3 : 0), maxLives: LIVES + (perks.walls ? 3 : 0),
      wave: 0, waves: cfg.endless ? Infinity : cfg.waves.length, phase: 'build', queue: [], waveT: 0, buildT: 0, t: 0, nextId: 1, kills: 0, leaks: 0, over: null };
  }
  function startWave(g) {
    if (g.phase !== 'build' || g.over) return false;
    var groups = g.cfg.endless ? endlessWave(g.wave) : g.cfg.waves[g.wave], at = 0.4;
    g.queue = [];
    groups.forEach(function (gr) { for (var k = 0; k < gr.n; k++) { g.queue.push({ type: gr.type, at: at }); at += GAPS[gr.type]; } at += 0.8; });
    g.phase = 'wave'; g.waveT = 0; g.events.push({ e: 'wave', n: g.wave + 1 });
    return true;
  }
  function spawn(g, type) {
    var b = ENEMIES[type], hp = Math.round(b.hp * hpScale(g.level, g.wave, g.cfg.endless)), p = g.path.at(0);
    var e = { id: g.nextId++, type: type, d: 0, hp: hp, max: hp, speed: b.speed * (g.perks.mud ? 0.9 : 1), slowT: 0, slowK: 0, x: p.x, z: p.z, angle: p.angle, boss: !!b.boss };
    if (e.boss) { e.shield = true; e.shieldHits = 0; e.shieldT = 0; g.events.push({ e: 'boss', id: e.id }); }
    g.enemies.push(e); return e;
  }
  function hurt(g, e, dmg) {
    if (e.dead) return;
    var k = e.boss && e.shield ? 0.15 : 1;
    e.hp -= dmg * k;
    if (e.hp <= 0) { e.dead = true; g.kills++; g.coins += ENEMIES[e.type].reward; g.events.push({ e: 'die', id: e.id, x: e.x, z: e.z, type: e.type, boss: e.boss }); }
  }
  function target(g, x, z, range) {
    var best = null;
    g.enemies.forEach(function (e) { if (!e.dead && Math.hypot(e.x - x, e.z - z) <= range && (!best || e.d > best.d)) best = e; });
    return best;
  }
  // Advances the game by dt seconds. Returns 'win', 'lose' or null.
  function stepGame(g, dt) {
    if (g.over) return g.over;
    g.t += dt;
    if (g.phase === 'build') { g.buildT += dt; if (g.wave > 0 && g.buildT >= AUTO_WAVE) startWave(g); }
    if (g.phase === 'wave') {
      g.waveT += dt;
      while (g.queue.length && g.queue[0].at <= g.waveT) spawn(g, g.queue.shift().type);
    }
    // enemies walk
    g.enemies.forEach(function (e) {
      if (e.dead) return;
      if (e.slowT > 0) e.slowT -= dt;
      if (e.boss && !e.shield) { e.shieldT -= dt; if (e.shieldT <= 0) { e.shield = true; e.shieldHits = 0; g.events.push({ e: 'shieldUp', id: e.id }); } }
      e.d += e.speed * (e.slowT > 0 ? 1 - e.slowK : 1) * dt;
      var p = g.path.at(e.d); e.x = p.x; e.z = p.z; e.angle = p.angle;
      if (e.d >= g.path.total) { e.dead = true; e.leaked = true; g.leaks++; g.lives -= ENEMIES[e.type].lives; g.events.push({ e: 'leak', id: e.id }); }
    });
    // towers fire
    g.slots.forEach(function (s) {
      var t = s.tower; if (!t) return;
      t.cd -= dt; t.flash = Math.max(0, (t.flash || 0) - dt);
      var st = towerStats(t.type, t.lv), dmgK = t.type === 'archer' && g.perks.arrows ? 1.25 : 1;
      if (t.type === 'tile') {
        if (t.cd > 0) return;
        var hit = false;
        g.enemies.forEach(function (e) { if (!e.dead && Math.hypot(e.x - s.x, e.z - s.z) <= st.range) { hit = true; e.slowT = st.slowT; e.slowK = Math.max(e.boss ? st.slow * 0.5 : st.slow, e.slowT > 0 ? e.slowK : 0); hurt(g, e, st.dmg); } });
        if (hit) { t.cd = st.cd; t.flash = 0.4; g.events.push({ e: 'pulse', slot: s.i, r: st.range }); }
        return;
      }
      var e = target(g, s.x, s.z, st.range); if (!e) return;
      t.aim = Math.atan2(e.x - s.x, e.z - s.z);
      if (t.cd > 0) return;
      t.cd = st.cd; t.flash = 0.25;
      if (t.type === 'archer') g.shots.push({ id: g.nextId++, kind: 'arrow', x: s.x, z: s.z, y: 1.6, to: e.id, dmg: st.dmg * dmgK, speed: 14 });
      else { var lead = g.path.at(e.d + e.speed * 0.6); g.shots.push({ id: g.nextId++, kind: 'tea', sx: s.x, sz: s.z, tx: lead.x, tz: lead.z, x: s.x, z: s.z, y: 1.3, t: 0, dur: 0.6, dmg: st.dmg, r: st.splash }); }
    });
    // shots fly
    g.shots = g.shots.filter(function (sh) {
      if (sh.kind === 'arrow') {
        var e = g.enemies.filter(function (x) { return x.id === sh.to; })[0];
        if (!e || e.dead) return false;
        var dx = e.x - sh.x, dz = e.z - sh.z, dist = Math.hypot(dx, dz), stp = sh.speed * dt;
        if (dist <= stp) { hurt(g, e, sh.dmg); g.events.push({ e: 'hit', x: e.x, z: e.z }); return false; }
        sh.x += dx / dist * stp; sh.z += dz / dist * stp; sh.y = 0.7 + 0.9 * Math.min(1, dist / 4); sh.angle = Math.atan2(dx, dz); return true;
      }
      sh.t += dt; var f = Math.min(1, sh.t / sh.dur);
      sh.x = sh.sx + (sh.tx - sh.sx) * f; sh.z = sh.sz + (sh.tz - sh.sz) * f; sh.y = 1.3 + Math.sin(Math.PI * f) * 1.8 - f * 0.9;
      if (f >= 1) { g.enemies.forEach(function (e) { if (!e.dead && Math.hypot(e.x - sh.tx, e.z - sh.tz) <= sh.r) hurt(g, e, sh.dmg); }); g.events.push({ e: 'splash', x: sh.tx, z: sh.tz, r: sh.r }); return false; }
      return true;
    });
    g.enemies = g.enemies.filter(function (e) { return !e.dead; });
    if (g.lives <= 0) { g.lives = 0; g.over = 'lose'; return g.over; }
    if (g.phase === 'wave' && !g.queue.length && !g.enemies.length) {
      g.wave++; g.phase = 'build'; g.buildT = 0; g.coins += WAVE_BONUS; g.events.push({ e: 'cleared', n: g.wave });
      if (g.wave >= g.waves) { g.over = 'win'; return g.over; }
    }
    return null;
  }
  function build(g, slot, type) {
    var s = g.slots[slot]; if (!s || s.tower || g.cfg.towers.indexOf(type) < 0 || g.coins < TOWERS[type].cost) return false;
    g.coins -= TOWERS[type].cost; s.tower = { type: type, lv: 1, cd: 0.2, aim: 0, flash: 0 }; g.events.push({ e: 'build', slot: slot }); return true;
  }
  function upgrade(g, slot) {
    var s = g.slots[slot], t = s && s.tower; if (!t) return false;
    var c = upgradeCost(t.type, t.lv); if (c == null || g.coins < c) return false;
    g.coins -= c; t.lv++; g.events.push({ e: 'build', slot: slot }); return true;
  }
  function sell(g, slot) { var s = g.slots[slot], t = s && s.tower; if (!t) return false; g.coins += Math.floor(spent(t.type, t.lv) * 0.6); s.tower = null; g.events.push({ e: 'sell', slot: slot }); return true; }
  // Coins for a right answer after `ms`: 15, up to +10 when quick, +5 with the Wisdom perk.
  function answerCoins(ms, perks) { return 15 + Math.round(10 * Math.max(0, 1 - ms / 4000)) + (perks && perks.wisdom ? 5 : 0); }
  // A right answer also chips the boss shield; three in a row open it for a while.
  function chipShield(g) {
    var boss = g.enemies.filter(function (e) { return e.boss && !e.dead; })[0]; if (!boss || !boss.shield) return false;
    boss.shieldHits++;
    if (boss.shieldHits >= SHIELD_HITS) { boss.shield = false; boss.shieldT = SHIELD_OPEN; g.events.push({ e: 'shieldDown', id: boss.id }); return 'open'; }
    return true;
  }
  function missShield(g) { var boss = g.enemies.filter(function (e) { return e.boss && !e.dead && e.shield; })[0]; if (boss) boss.shieldHits = 0; }
  function stars(lives, max) { return lives <= 0 ? 0 : lives >= max ? 3 : lives >= max * 0.6 ? 2 : 1; }
  function scrollsFor(starsN) { return starsN ? 10 + 5 * starsN : 0; }

  function defaults() { return { scrolls: 0, perks: {}, levels: [0, 0, 0, 0, 0], best: 0, intro: false, seen: [], ending: false }; }
  function clean(s) {
    var o = Object.assign(defaults(), s && typeof s === 'object' ? s : {});
    o.scrolls = Math.max(0, Math.floor(Number(o.scrolls) || 0));
    var p = {}; Object.keys(PERKS).forEach(function (k) { if (o.perks && o.perks[k] === true) p[k] = true; }); o.perks = p;
    o.levels = LEVELS.map(function (x, i) { return Math.min(3, Math.max(0, Math.floor(Number(o.levels && o.levels[i]) || 0))); });
    o.best = Math.max(0, Math.floor(Number(o.best) || 0));
    o.seen = Array.isArray(o.seen) ? o.seen.filter(function (n) { return typeof n === 'number'; }) : [];
    return o;
  }
  function levelOpen(s, i) { return i === 0 || s.levels[i - 1] > 0; }
  function nextLevel(s) { for (var i = 0; i < LEVELS.length; i++) if (!s.levels[i]) return levelOpen(s, i) ? i : -1; return -1; }
  function buyPerk(s, id) { var p = PERKS[id]; if (!p || s.perks[id] || s.scrolls < p.cost) return null; var n = JSON.parse(JSON.stringify(s)); n.scrolls -= p.cost; n.perks[id] = true; return n; }

  function shuffle(a, r) { r = r || Math.random; for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  // A word to translate with four choices: one right, three other translations from the deck.
  function makeQuestion(cards, avoid, r) {
    r = r || Math.random;
    var byT = {}; (cards || []).forEach(function (c) { if (c && c.original && c.translation) { var k = String(c.translation).toLowerCase(); if (!byT[k]) byT[k] = c; } });
    var uniq = Object.keys(byT).map(function (k) { return byT[k]; });
    if (uniq.length < 4) return null;
    var fresh = uniq.filter(function (c) { return !avoid || avoid.indexOf(c.original) < 0; });
    var card = (fresh.length ? fresh : uniq)[Math.floor(r() * (fresh.length ? fresh.length : uniq.length))];
    var others = shuffle(uniq.filter(function (c) { return c !== card; }), r).slice(0, 3);
    return { card: card, word: card.original, answer: card.translation, options: shuffle([card].concat(others), r).map(function (c) { return { text: c.translation, right: c === card }; }) };
  }

  /* ---------------- the game on screen ---------------- */
  var TOWER_ORDER = ['archer', 'samovar', 'tile'];
  var STORY = [
    [{ who: 'bahrom', key: 'def.story.l1' }],
    [{ who: 'zuhra', key: 'def.story.l2' }],
    [{ who: 'bahrom', key: 'def.story.l3' }],
    [{ who: 'ota', key: 'def.story.l4a' }, { who: 'bahrom', key: 'def.story.l4b' }],
    [{ who: 'king', key: 'def.story.l5a' }, { who: 'bahrom', key: 'def.story.l5b' }]
  ];
  var INTRO = [{ who: 'bahrom', key: 'def.story.intro1' }, { who: 'ota', key: 'def.story.intro2' }, { who: 'bahrom', key: 'def.story.intro3' }];
  var ENDING = [{ who: 'king', key: 'def.story.end1' }, { who: 'zuhra', key: 'def.story.end2' }, { who: 'bahrom', key: 'def.story.end3' }];
  var ICON = {
    archer: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="9" y="16" width="3" height="20" fill="#8a5a34"/><rect x="28" y="16" width="3" height="20" fill="#8a5a34"/><rect x="7" y="14" width="26" height="4" rx="1" fill="#b07a46"/><circle cx="20" cy="8.5" r="5.5" fill="#b5794a"/><path d="M14.5 8 a5.5 5.5 0 0 1 11 0z" fill="#e8a33a"/><path d="M27 4 q6 6 0 12" stroke="#ffcf5a" stroke-width="1.6" fill="none"/></svg>',
    samovar: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="10" y="30" width="20" height="6" rx="2" fill="#a89a84"/><path d="M13 30 L12 16 Q20 8 28 16 L27 30Z" fill="#d9a441"/><rect x="17" y="5" width="6" height="6" rx="1" fill="#d9a441"/><path d="M27 22 L34 18" stroke="#d9a441" stroke-width="3" stroke-linecap="round"/><path d="M33 12 q-2 -3 0 -6" stroke="#fff" stroke-opacity=".8" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
    tile: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="12" y="14" width="16" height="22" fill="#1f6fb2"/><rect x="12" y="20" width="16" height="2.5" fill="#2bb3c0"/><rect x="12" y="28" width="16" height="2.5" fill="#2bb3c0"/><path d="M11 14 a9 9 0 0 1 18 0z" fill="#5ed8e6"/><rect x="19" y="1" width="2" height="5" fill="#2bb3c0"/></svg>'
  };

  function mount(api) {
    var doc = document, $ = function (id) { return doc.getElementById(id); };
    var stage = $('defenseStage'), hub = $('arcadeHub');
    if (!stage) return { refresh: function () {}, leave: function () {}, active: function () { return false; } };
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var tr = api.tr;
    function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; if (fn) b.onclick = fn; return b; }
    function load() { try { return clean(JSON.parse(localStorage.getItem('vm.def') || 'null')); } catch (e) { return defaults(); } }
    function save(s) { try { localStorage.setItem('vm.def', JSON.stringify(s)); } catch (e) {} }
    function fx(k) { if (api.fx) api.fx(k); }

    /* ----- DOM ----- */
    stage.innerHTML = '';
    var canvas = el('canvas', 'cf-canvas'); canvas.setAttribute('aria-hidden', 'true');
    var flatCv = el('canvas', 'cf-canvas td-flat'); flatCv.hidden = true; flatCv.setAttribute('aria-hidden', 'true');
    var hud = el('div', 'cf-hud td-hud');
    var lvChip = el('div', 'cf-chip td-lives'), lvLabel = el('span'), lvVal = el('strong'), lvHearts = el('b'), lvWave = el('em'), lvBar = el('div', 'cf-bar'), lvFill = el('i');
    lvVal.appendChild(lvHearts); lvVal.appendChild(lvWave);
    lvBar.appendChild(lvFill); lvChip.appendChild(lvLabel); lvChip.appendChild(lvVal); lvChip.appendChild(lvBar);
    var coinChip = el('div', 'cf-chip td-coins'), coinLabel = el('span', null, tr('def.coins')), coinVal = el('strong');
    coinChip.appendChild(coinLabel); coinChip.appendChild(coinVal);
    var right = el('div', 'cf-hud-right'), combo = el('span', 'cf-combo'); combo.hidden = true;
    var speedBtn = btn('cf-quit td-speed', '1×', function () { speed = speed === 1 ? 2 : 1; paintSpeed(); });
    var quit = btn('cf-quit', tr('def.retreat'), function () { if (game && !game.over) endLevel('quit'); });
    right.appendChild(combo); right.appendChild(speedBtn); right.appendChild(quit);
    [lvChip, coinChip, right].forEach(function (n) { hud.appendChild(n); });
    var boss = el('div', 'td-boss'); boss.hidden = true;
    var bossName = el('span', 'td-boss-name', tr('def.king')), bossBar = el('div', 'td-boss-bar'), bossFill = el('i'), bossShield = el('div', 'td-boss-shield');
    bossBar.appendChild(bossFill); boss.appendChild(bossName); boss.appendChild(bossBar); boss.appendChild(bossShield);
    var padsLayer = el('div', 'td-pads');
    var pop = el('div', 'td-pop'); pop.hidden = true; pop.setAttribute('role', 'dialog');
    var waveBtn = btn('td-wave', null, function () { if (game && startWave(game)) { closePop(); fx('cast'); } });
    var tray = el('div', 'cf-tray td-tray'); tray.setAttribute('aria-label', tr('def.tray'));
    var trayHead = el('div', 'cf-tray-head'), trayWho = el('span', 'cf-tray-who', tr('def.translate')), trayWord = el('strong', 'cf-tray-word');
    var speakBtn = btn('cf-speak', null, function () { if (q && api.speak) api.speak(q.word); }); speakBtn.setAttribute('aria-label', tr('cafe.listen'));
    speakBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
    var reward = el('span', 'td-reward');
    trayHead.appendChild(trayWho); trayHead.appendChild(trayWord); trayHead.appendChild(reward); trayHead.appendChild(speakBtn);
    var opts = el('div', 'cf-dishes td-opts');
    var feedback = el('p', 'cf-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    tray.appendChild(trayHead); tray.appendChild(opts); tray.appendChild(feedback);
    var banner = el('div', 'cf-banner'); banner.setAttribute('aria-hidden', 'true');
    var loading = el('div', 'cf-loading', tr('def.loading'));
    var overlay = el('div', 'cf-overlay'); overlay.hidden = true;
    [canvas, flatCv, padsLayer, hud, boss, waveBtn, tray, pop, banner, loading, overlay].forEach(function (n) { stage.appendChild(n); });

    /* ----- scene: three.js or a flat canvas ----- */
    var scene3 = null, anchorList = [], visible = false;
    function flatScene() {
      flatCv.hidden = false; canvas.hidden = true;
      var c = flatCv.getContext('2d'), cfg = null, W = 1, H = 1, ins = { top: 0, bottom: 0 }, view = null, g = null, rings = [], hl = null, paused = false;
      function fitView() {
        var portrait = W / H < 0.95, availH = Math.max(120, H - ins.top - ins.bottom), bw = portrait ? 15 : 25, bh = portrait ? 25 : 15;
        var k = Math.min(W * 0.96 / bw, availH * 0.96 / bh);
        view = { k: k, portrait: portrait, cx: W / 2, cy: ins.top + availH / 2 };
      }
      function P(x, z) { return view.portrait ? { x: view.cx - z * view.k, y: view.cy + x * view.k } : { x: view.cx + x * view.k, y: view.cy + z * view.k }; }
      function draw() {
        if (!view || !cfg) return;
        var r = window.devicePixelRatio || 1; c.setTransform(r, 0, 0, r, 0, 0);
        var th = { day: ['#9cc46e', '#d8b27a'], golden: ['#c8c26a', '#dcb27e'], night: ['#3f6a54', '#8f8466'], lair: ['#5e4a6e', '#8a7a8a'] }[cfg.theme] || ['#9cc46e', '#d8b27a'];
        c.fillStyle = th[0]; c.fillRect(0, 0, W, H);
        if (cfg.river) { var a = P(0, -9), b = P(0, 9); c.strokeStyle = '#3a9ad0'; c.lineWidth = 2.4 * view.k; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
        c.strokeStyle = th[1]; c.lineWidth = 1.7 * view.k; c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath();
        cfg.path.forEach(function (p, i) { var q2 = P(p[0], p[1]); if (i) c.lineTo(q2.x, q2.y); else c.moveTo(q2.x, q2.y); }); c.stroke();
        var s0 = P(cfg.path[0][0], cfg.path[0][1]); c.fillStyle = '#2a1a4a'; c.beginPath(); c.arc(s0.x, s0.y, view.k * 1.2, 0, 6.283); c.fill();
        var e0 = P(cfg.path[cfg.path.length - 1][0], cfg.path[cfg.path.length - 1][1]); c.fillStyle = '#1f6fb2'; c.fillRect(e0.x - view.k, e0.y - view.k, view.k * 2, view.k * 2);
        if (hl) { var hp = P(hl.x, hl.z); c.fillStyle = 'rgba(255,224,138,.18)'; c.strokeStyle = 'rgba(255,224,138,.8)'; c.lineWidth = 2; c.beginPath(); c.arc(hp.x, hp.y, hl.r * view.k, 0, 6.283); c.fill(); c.stroke(); }
        if (g) {
          g.slots.forEach(function (s) {
            var p = P(s.x, s.z); c.fillStyle = '#d8cbb4'; c.beginPath(); c.arc(p.x, p.y, view.k * 0.8, 0, 6.283); c.fill();
            if (s.tower) { c.fillStyle = { archer: '#8a5a34', samovar: '#d9a441', tile: '#1f6fb2' }[s.tower.type]; c.beginPath(); c.arc(p.x, p.y, view.k * (0.45 + s.tower.lv * 0.08), 0, 6.283); c.fill(); }
          });
          g.enemies.forEach(function (e) {
            var p = P(e.x, e.z), rr = view.k * (e.type === 'fat' ? 0.6 : e.type === 'runner' ? 0.32 : e.boss ? 1.0 : 0.42);
            c.fillStyle = e.slowT > 0 ? '#6ab8d8' : { blot: '#3a2a7a', runner: '#2a7a9a', fat: '#6a2a5a', king: '#2a1a4a' }[e.type]; c.beginPath(); c.arc(p.x, p.y, rr, 0, 6.283); c.fill();
            if (e.boss && e.shield) { c.strokeStyle = '#8fe8ff'; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y, rr * 1.5, 0, 6.283); c.stroke(); }
            c.fillStyle = '#fff'; c.beginPath(); c.arc(p.x - rr * 0.35, p.y - rr * 0.2, rr * 0.28, 0, 6.283); c.arc(p.x + rr * 0.35, p.y - rr * 0.2, rr * 0.28, 0, 6.283); c.fill();
            c.fillStyle = '#141a2e'; c.fillRect(p.x - rr, p.y - rr - 8, rr * 2, 4); c.fillStyle = e.boss ? '#ff7a5a' : '#7ee0a1'; c.fillRect(p.x - rr, p.y - rr - 8, rr * 2 * Math.max(0, e.hp / e.max), 4);
          });
          g.shots.forEach(function (sh) { var p = P(sh.x, sh.z); c.fillStyle = sh.kind === 'arrow' ? '#3a2410' : '#c8682a'; c.beginPath(); c.arc(p.x, p.y, sh.kind === 'arrow' ? 2.5 : 5, 0, 6.283); c.fill(); });
        }
        var now = performance.now();
        rings = rings.filter(function (o) { var q3 = (now - o.t) / 500; if (q3 >= 1) return false; var p = P(o.x, o.z); c.strokeStyle = o.color; c.globalAlpha = 1 - q3; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y, o.r * view.k * q3, 0, 6.283); c.stroke(); c.globalAlpha = 1; return true; });
      }
      function anchors() { return g ? g.slots.map(function (s) { var p = P(s.x, s.z); return { x: p.x, y: p.y }; }) : []; }
      (function loop() { if (!paused) { draw(); if (view) { anchorList = anchors(); placePads(); } } requestAnimationFrame(loop); })();
      return {
        setLevel: function (x) { cfg = x; }, resize: function (w, h, i) { W = w; H = h; if (i) ins = i; var r = window.devicePixelRatio || 1; flatCv.width = w * r; flatCv.height = h * r; fitView(); },
        sync: function (x) { g = x; x.events.forEach(function (ev) { if (ev.e === 'splash') rings.push({ x: ev.x, z: ev.z, r: ev.r, color: '#ffa04a', t: performance.now() }); else if (ev.e === 'pulse') { var s = x.slots[ev.slot]; rings.push({ x: s.x, z: s.z, r: ev.r, color: '#8fe8ff', t: performance.now() }); } }); },
        highlight: function (i, r) { hl = i != null && g && g.slots[i] ? { x: g.slots[i].x, z: g.slots[i].z, r: r } : null; },
        setPaused: function (p) { paused = !!p; }, dispose: function () {}, three: false
      };
    }
    function ensureScene(done) {
      if (scene3) return done();
      var useFlat = function () { scene3 = flatScene(); loading.hidden = true; sizeScene(); done(); };
      var make = function () {
        try {
          if (!window.VMDefense3D || !window.VMDefense3D.supported()) return useFlat();
          scene3 = window.VMDefense3D.create(canvas, { reduced: reduced, onFrame: function (a) { anchorList = a; placePads(); } });
          loading.hidden = true; sizeScene(); done();
        } catch (e) { useFlat(); }
      };
      if (window.VMDefense3D) return make();
      loading.hidden = false;
      var s = doc.createElement('script'); s.src = 'vendor/defense3d.js?v=2.37'; s.onload = make; s.onerror = useFlat; doc.head.appendChild(s);
    }
    function sizeScene() {
      if (!scene3) return;
      var r = stage.getBoundingClientRect(), playing = stage.classList.contains('playing');
      var top = playing ? hud.getBoundingClientRect().bottom - r.top + 6 : 0, bottom = playing ? r.bottom - tray.getBoundingClientRect().top + 8 : 0;
      stage.style.setProperty('--td-tray', (Math.max(0, bottom) + 4) + 'px');
      scene3.resize(r.width, r.height, { top: Math.max(0, top), bottom: Math.max(0, bottom) });
    }

    /* ----- a level ----- */
    var game = null, speed = 1, q = null, qStart = 0, lock = false, recent = [], streak = 0, stats = null, sel = null, deck = null, last = 0;
    function begin(levelIndex) {
      var d = api.deck();
      if (!d || !makeQuestion(d.cards)) { api.toast(tr('toast.needMatch'), 'err', 5000); return; }
      var s = load();
      deck = d; game = createGame(levelIndex, s.perks); stats = { right: 0, wrong: 0, best: 0 }; streak = 0; recent = []; speed = 1; sel = null;
      overlay.hidden = true; overlay.innerHTML = ''; closePop();
      stage.classList.add('playing');
      scene3.setLevel(game.cfg); scene3.sync(game); game.events = [];
      buildPads();
      lvLabel.textContent = levelIndex < 0 ? tr('def.endless') : tr('def.placeN', { n: levelIndex + 1 }) + ' · ' + tr('def.level.' + game.cfg.id);
      feedback.textContent = ''; combo.hidden = true; paintSpeed();
      nextQuestion(); updateHud(); sizeScene();
      doc.addEventListener('keydown', onKey);
      say(levelIndex < 0 ? tr('def.endless') : tr('def.level.' + game.cfg.id), 'gold');
      last = 0; requestAnimationFrame(tick);
    }
    function tick(now) {
      if (!game || game.over) return;
      var dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
      if (!doc.hidden && overlay.hidden) {
        var n = speed === 2 ? 2 : 1, res = null;
        for (var k = 0; k < n && !res; k++) res = stepGame(game, dt);
        scene3.sync(game); handleEvents(); updateHud();
        if (res) { endLevel(res); return; }
      }
      requestAnimationFrame(tick);
    }
    function handleEvents() {
      var splashed = false;
      game.events.forEach(function (ev) {
        if (ev.e === 'wave') say(tr('def.waveN', { n: ev.n }), '');
        else if (ev.e === 'cleared') { if (game.wave < game.waves) { say(tr('def.cleared', { n: 20 }), 'gold'); fx('chest'); } }
        else if (ev.e === 'leak') { fx('bad'); lvChip.classList.remove('hurt'); void lvChip.offsetWidth; lvChip.classList.add('hurt'); }
        else if (ev.e === 'boss') { say(tr('def.kingComes'), 'bad'); fx('crit'); paintShield(); }
        else if (ev.e === 'shieldDown') { say(tr('def.shieldDown'), 'gold'); fx('crit'); }
        else if (ev.e === 'shieldUp') { feedback.textContent = tr('def.shieldUp'); feedback.className = 'cf-feedback bad'; }
        else if (ev.e === 'die' && ev.boss) { say(tr('def.kingDown'), 'gold'); fx('win'); }
        else if (ev.e === 'splash' && !splashed) { splashed = true; fx('splash'); }
      });
      game.events = [];
    }
    function updateHud() {
      if (!game) return;
      var waveText = game.cfg.endless ? tr('def.waveOnly', { n: game.wave + (game.phase === 'wave' ? 1 : 0) || 1 }) : tr('def.waveOf', { n: Math.min(game.waves, game.wave + (game.phase === 'wave' ? 1 : 0)) || 1, t: game.waves });
      lvHearts.textContent = '♥ ' + game.lives; if (lvWave.textContent !== waveText) lvWave.textContent = waveText;
      lvVal.setAttribute('aria-label', tr('def.livesLeft') + ': ' + game.lives + ', ' + waveText);
      lvFill.style.transform = 'scaleX(' + (game.lives / game.maxLives).toFixed(3) + ')';
      lvChip.classList.toggle('low', game.lives <= 3);
      var c = String(game.coins); if (coinVal.textContent !== c) { coinVal.textContent = c; }
      // the wave button: before the first wave it waits; later it counts down to the next one
      if (game.phase === 'build' && !game.over) {
        waveBtn.hidden = false;
        var left = Math.max(0, Math.ceil(20 - game.buildT));
        var label = game.wave === 0 ? tr('def.startWave', { n: 1 }) : tr('def.nextWave', { n: game.wave + 1, s: left });
        if (waveBtn.textContent !== label) waveBtn.textContent = label;
        waveBtn.classList.toggle('first', game.wave === 0);
      } else waveBtn.hidden = true;
      var b = game.enemies.filter(function (e) { return e.boss; })[0];
      boss.hidden = !b; stage.classList.toggle('bossing', !!b);
      if (b) { bossFill.style.transform = 'scaleX(' + Math.max(0, b.hp / b.max).toFixed(3) + ')'; boss.classList.toggle('open', !b.shield); paintShield(b); }
      // pads glow when the player can afford something there
      padEls.forEach(function (p, i) {
        var s = game.slots[i], afford = false;
        if (!s.tower) afford = game.cfg.towers.some(function (t) { return game.coins >= TOWERS[t].cost; });
        else { var uc = upgradeCost(s.tower.type, s.tower.lv); afford = uc != null && game.coins >= uc; }
        p.classList.toggle('afford', afford);
        var key = s.tower ? s.tower.type + s.tower.lv : '';
        if (p.dataset.key !== key) paintPad(p, i);
      });
    }
    function paintShield(b) {
      b = b || game.enemies.filter(function (e) { return e.boss; })[0]; if (!b) return;
      bossShield.textContent = '';
      if (b.shield) {
        bossShield.appendChild(el('span', null, tr('def.shieldHint')));
        var pips = el('span', 'td-pips'); for (var k = 0; k < SHIELD_HITS; k++) pips.appendChild(el('i', k < b.shieldHits ? 'on' : null)); bossShield.appendChild(pips);
      } else bossShield.appendChild(el('span', 'open', tr('def.shieldOpen', { s: Math.ceil(b.shieldT) })));
    }
    function paintSpeed() { speedBtn.textContent = speed + '×'; speedBtn.setAttribute('aria-pressed', speed === 2 ? 'true' : 'false'); speedBtn.setAttribute('aria-label', tr('def.speed', { n: speed })); }

    /* ----- pads and the build menu ----- */
    var padEls = [];
    function buildPads() {
      padsLayer.innerHTML = ''; padEls = game.slots.map(function (s, i) {
        var b = btn('td-pad', null, function () { openPop(i); }); b.dataset.slot = i; paintPad(b, i); padsLayer.appendChild(b); return b;
      });
    }
    function paintPad(b, i) {
      var s = game.slots[i]; b.dataset.key = s.tower ? s.tower.type + s.tower.lv : ''; b.innerHTML = '';
      b.classList.toggle('built', !!s.tower);
      if (s.tower) {
        var pips = el('span', 'td-lv'); for (var k = 0; k < 3; k++) pips.appendChild(el('i', k < s.tower.lv ? 'on' : null)); b.appendChild(pips);
        b.setAttribute('aria-label', tr('def.padBuilt', { n: i + 1, t: tr('def.tower.' + s.tower.type), l: s.tower.lv }));
      } else { b.appendChild(el('span', 'td-plus', '+')); b.setAttribute('aria-label', tr('def.padEmpty', { n: i + 1 })); }
    }
    function placePads() {
      if (!game || !visible) return;
      for (var i = 0; i < padEls.length; i++) { var a = anchorList[i]; if (!a) continue; padEls[i].style.transform = 'translate(' + a.x.toFixed(1) + 'px,' + a.y.toFixed(1) + 'px)'; }
      if (sel != null) placePop();
    }
    function openPop(i) {
      if (!game || game.over) return;
      if (sel === i) return closePop();
      sel = i; renderPop(); pop.hidden = false; placePop();
      padEls.forEach(function (p, k) { p.classList.toggle('sel', k === i); p.setAttribute('aria-expanded', k === i ? 'true' : 'false'); });
      var f = pop.querySelector('button:not(:disabled)'); if (f) f.focus({ preventScroll: true });
    }
    function closePop() {
      if (sel == null) return; var was = sel; sel = null; pop.hidden = true; if (scene3) scene3.highlight(null);
      padEls.forEach(function (p) { p.classList.remove('sel'); p.setAttribute('aria-expanded', 'false'); });
      if (padEls[was] && pop.contains(doc.activeElement)) padEls[was].focus({ preventScroll: true });
    }
    function renderPop() {
      var s = game.slots[sel]; pop.innerHTML = '';
      var head = el('div', 'td-pop-head'), close = btn('td-pop-x', '×', closePop); close.setAttribute('aria-label', tr('def.close'));
      if (!s.tower) {
        head.appendChild(el('strong', null, tr('def.build'))); head.appendChild(close); pop.appendChild(head);
        pop.setAttribute('aria-label', tr('def.build'));
        TOWER_ORDER.forEach(function (type) {
          var t = TOWERS[type], open = game.cfg.towers.indexOf(type) >= 0, can = open && game.coins >= t.cost;
          var b = btn('td-opt-tower', null, function () { if (build(game, sel, type)) { fx('reel'); var k = sel; closePop(); updateHud(); padEls[k].focus({ preventScroll: true }); } });
          var ic = el('span', 'td-ic'); ic.innerHTML = ICON[type]; b.appendChild(ic);
          var tx = el('span', 'td-opt-text'); tx.appendChild(el('strong', null, tr('def.tower.' + type))); tx.appendChild(el('span', null, open ? tr('def.tower.' + type + 'Sub') : tr('def.lockedTower'))); b.appendChild(tx);
          b.appendChild(el('span', 'td-cost', open ? t.cost + ' ◉' : '🔒'));
          b.disabled = !can; if (open && !can) b.title = tr('def.needMore', { n: t.cost - game.coins });
          b.addEventListener('mouseenter', function () { if (scene3 && open) scene3.highlight(sel, towerStats(type, 1).range); });
          b.addEventListener('focus', function () { if (scene3 && open) scene3.highlight(sel, towerStats(type, 1).range); });
          pop.appendChild(b);
        });
        scene3.highlight(null);
      } else {
        var tw = s.tower, st = towerStats(tw.type, tw.lv), uc = upgradeCost(tw.type, tw.lv);
        head.appendChild(el('strong', null, tr('def.tower.' + tw.type) + ' · ' + tr('def.lvN', { n: tw.lv }))); head.appendChild(close); pop.appendChild(head);
        pop.setAttribute('aria-label', tr('def.tower.' + tw.type));
        var info = el('p', 'td-pop-info', tr('def.tower.' + tw.type + 'Sub')); pop.appendChild(info);
        var ub = btn('td-opt-tower up', null, function () { if (upgrade(game, sel)) { fx('chest'); renderPop(); updateHud(); var f = pop.querySelector('button.up:not(:disabled)') || pop.querySelector('button.sell'); if (f) f.focus({ preventScroll: true }); } });
        var uic = el('span', 'td-ic'); uic.innerHTML = ICON[tw.type]; ub.appendChild(uic);
        var utx = el('span', 'td-opt-text'); utx.appendChild(el('strong', null, uc == null ? tr('def.maxed') : tr('def.upgradeTo', { n: tw.lv + 1 }))); utx.appendChild(el('span', null, uc == null ? tr('def.maxedSub') : tr('def.upSub.' + tw.type))); ub.appendChild(utx);
        ub.appendChild(el('span', 'td-cost', uc == null ? '★' : uc + ' ◉')); ub.disabled = uc == null || game.coins < uc; pop.appendChild(ub);
        var sb = btn('td-opt-tower sell', null, function () { var k = sel; if (sell(game, sel)) { fx('cast'); closePop(); updateHud(); padEls[k].focus({ preventScroll: true }); } });
        var refund = 0; (function () { var c = TOWERS[tw.type].cost; for (var k = 0; k < tw.lv - 1; k++) c += TOWERS[tw.type].up[k][0]; refund = Math.floor(c * 0.6); })();
        sb.appendChild(el('span', 'td-opt-text', tr('def.sell'))); sb.appendChild(el('span', 'td-cost', '+' + refund + ' ◉')); pop.appendChild(sb);
        scene3.highlight(sel, st.range);
      }
    }
    function placePop() {
      var a = anchorList[sel]; if (!a) return;
      var r = stage.getBoundingClientRect(), pw = pop.offsetWidth || 260, ph = pop.offsetHeight || 200, trayTop = tray.getBoundingClientRect().top - r.top;
      var x = Math.max(10, Math.min(r.width - pw - 10, a.x - pw / 2)), y = a.y - ph - 30;
      if (y < 70) y = a.y + 30;
      y = Math.max(10, Math.min(trayTop - ph - 8, y));
      pop.style.transform = 'translate(' + x.toFixed(0) + 'px,' + y.toFixed(0) + 'px)';
    }

    /* ----- words ----- */
    function nextQuestion() {
      q = makeQuestion(deck.cards, recent); if (!q) return;
      recent.push(q.word); if (recent.length > Math.min(6, deck.cards.length - 2)) recent.shift();
      qStart = performance.now(); lock = false; q.missed = false;
      trayWord.textContent = q.word; trayWord.lang = deck.source;
      opts.innerHTML = '';
      q.options.forEach(function (op, k) {
        var b = btn('cf-dish td-opt', null, function () { answer(op, b); });
        b.dataset.right = op.right ? '1' : '';
        b.appendChild(el('kbd', null, String(k + 1)));
        var tx = el('span', 'cf-dish-text', op.text); tx.lang = deck.target; b.appendChild(tx);
        opts.appendChild(b);
      });
      if (api.autoSpeak && api.autoSpeak() && api.speak) api.speak(q.word);
    }
    function answer(op, b) {
      if (!game || game.over || lock || !q) return;
      if (op.right) {
        lock = true;
        var coins = answerCoins(performance.now() - qStart, game.perks); game.coins += coins;
        if (!q.missed) api.answer(q.card, true, true);
        stats.right++; streak++; stats.best = Math.max(stats.best, streak);
        b.classList.add('right'); fx('ok');
        reward.textContent = '+' + coins + ' ◉'; reward.classList.remove('on'); void reward.offsetWidth; reward.classList.add('on');
        coinVal.classList.remove('bump'); void coinVal.offsetWidth; coinVal.classList.add('bump');
        feedback.textContent = tr('def.right', { n: coins }); feedback.className = 'cf-feedback ok';
        if (streak >= 3) { combo.hidden = false; combo.textContent = tr('def.streak', { n: streak }); combo.classList.remove('bump'); void combo.offsetWidth; combo.classList.add('bump'); }
        chipShield(game); updateHud();
        setTimeout(function () { if (game && !game.over) nextQuestion(); }, 380);
      } else {
        if (!q.missed) { api.answer(q.card, false, true); q.missed = true; stats.wrong++; }
        streak = 0; combo.hidden = true; missShield(game);
        b.classList.add('wrong'); b.disabled = true; fx('bad');
        var rb = opts.querySelector('[data-right="1"]'); if (rb) rb.classList.add('hint');
        feedback.textContent = tr('def.wrong', { w: q.word, t: q.answer }); feedback.className = 'cf-feedback bad';
        lock = true; setTimeout(function () { lock = false; }, 700);
      }
    }
    function onKey(e) {
      if (!game || game.over || !overlay.hidden) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'Escape' && sel != null) { closePop(); e.preventDefault(); return; }
      var n = Number(e.key);
      if (n >= 1 && n <= 4 && !e.altKey && !e.ctrlKey && !e.metaKey) { var b = opts.querySelectorAll('button')[n - 1]; if (b && !b.disabled) { b.click(); e.preventDefault(); } return; }
      if ((e.key === 'Enter' || e.key === ' ') && game.phase === 'build' && doc.activeElement === doc.body) { waveBtn.click(); e.preventDefault(); }
    }
    function say(text, cls) { banner.textContent = text; banner.className = 'cf-banner'; void banner.offsetWidth; banner.className = 'cf-banner on ' + (cls || ''); clearTimeout(say.t); say.t = setTimeout(function () { banner.className = 'cf-banner'; }, 2400); }

    /* ----- the end of a level ----- */
    function stopRun() { doc.removeEventListener('keydown', onKey); closePop(); stage.classList.remove('playing', 'bossing'); boss.hidden = true; waveBtn.hidden = true; }
    function endLevel(res) {
      var g = game; g.over = g.over || (res === 'quit' ? 'lose' : res); game = null; stopRun(); api.complete();
      var s = load(), endless = g.level < 0, won = res === 'win', starsN = won ? stars(g.lives, g.maxLives) : 0, gained = 0, first = false, finale = false;
      if (endless) { gained = Math.min(30, g.wave * 2); s.best = Math.max(s.best, g.wave); }
      else if (won) { first = !s.levels[g.level]; gained = Math.max(0, scrollsFor(starsN) - scrollsFor(s.levels[g.level])); s.levels[g.level] = Math.max(s.levels[g.level], starsN); finale = g.level === LEVELS.length - 1 && !s.ending; }
      s.scrolls += gained; if (finale) s.ending = true; save(s);
      fx(won || (endless && g.wave > 0) ? 'win' : 'lose');
      var show = function () {
        var p = panel('cf-result td-result');
        heading(p, endless ? tr('def.endless') : tr('def.placeN', { n: g.level + 1 }) + ' · ' + tr('def.level.' + g.cfg.id), endless ? tr('def.endlessOver', { n: g.wave }) : won ? tr('def.won') : res === 'quit' ? tr('def.retreated') : tr('def.lost'));
        if (won) { var row = el('div', 'cf-stars'); row.setAttribute('aria-label', tr('fish.starsN', { n: starsN })); for (var k = 0; k < 3; k++) row.appendChild(el('i', k < starsN ? 'on' : null)); p.appendChild(row); }
        var meta = el('div', 'cf-meta');
        meta.appendChild(metaItem(tr('def.livesLeft'), g.lives + ' / ' + g.maxLives));
        meta.appendChild(metaItem(tr('def.blots'), String(g.kills)));
        meta.appendChild(metaItem(tr('def.words'), stats.right + ' / ' + (stats.right + stats.wrong)));
        p.appendChild(meta);
        if (gained) p.appendChild(el('p', 'cf-record', tr('def.scrollsGot', { n: gained })));
        if (endless && g.wave >= s.best && g.wave > 0) p.appendChild(el('p', 'cf-record', tr('game.record')));
        if (!won && !endless) p.appendChild(hostLine('bahrom', res === 'quit' ? 'def.tipQuit' : 'def.tipLost'));
        var a = el('div', 'cf-actions'), nl = nextLevel(load()), primary;
        if (won && nl >= 0) primary = btn('cf-btn primary', tr('def.nextPlace', { n: nl + 1 }), function () { startLevel(nl); });
        else primary = btn('cf-btn primary', tr(endless ? 'fish.again' : won ? 'def.toMap' : 'fish.retry'), function () { if (endless) begin(-1); else if (won) showMap(); else startLevel(g.level); });
        a.appendChild(primary);
        a.appendChild(btn('cf-btn', tr('def.perks'), function () { showPerks(showMap); }));
        a.appendChild(btn('cf-btn', tr('def.toMap'), showMap));
        p.appendChild(a); primary.focus({ preventScroll: true });
      };
      setTimeout(function () { if (finale) dialog(ENDING, show); else show(); }, won ? 900 : 500);
    }

    /* ----- panels ----- */
    function panel(cls) { overlay.innerHTML = ''; overlay.hidden = false; var p = el('div', 'cf-panel ' + (cls || '')); p.setAttribute('role', 'dialog'); overlay.appendChild(p); return p; }
    function heading(p, eyebrow, title) { if (eyebrow) p.appendChild(el('span', 'cf-eyebrow', eyebrow)); var h = el('h2', 'cf-title', title); h.id = 'tdT' + Math.random().toString(36).slice(2, 7); p.appendChild(h); p.setAttribute('aria-labelledby', h.id); }
    function metaItem(label, value) { var m = el('div', 'cf-meta-item'); m.appendChild(el('span', null, label)); m.appendChild(el('strong', null, value)); return m; }
    function hostLine(who, key) { var row = el('div', 'cf-hostline'); row.appendChild(portrait(who, 56)); var t = el('p'); t.appendChild(el('b', null, tr('def.who.' + who) + ': ')); t.appendChild(doc.createTextNode(tr(key))); row.appendChild(t); return row; }
    function dialog(lines, then) {
      var i = 0;
      (function show() {
        var line = lines[i], p = panel('cf-dialog' + (line.who === 'king' ? ' td-villain' : ''));
        var row = el('div', 'cf-dialog-row'); row.appendChild(portrait(line.who, 110));
        var box = el('div', 'cf-dialog-box'); box.appendChild(el('span', 'cf-eyebrow', tr('def.who.' + line.who))); box.appendChild(el('p', 'cf-dialog-text', tr(line.key))); row.appendChild(box); p.appendChild(row);
        var nb = btn('cf-btn primary', i < lines.length - 1 ? tr('fish.next') : tr('fish.letsGo'), function () { i++; if (i < lines.length) show(); else then(); });
        var a = el('div', 'cf-actions'); a.appendChild(nb); p.appendChild(a); p.setAttribute('aria-label', tr('def.who.' + line.who)); nb.focus({ preventScroll: true });
      })();
    }
    function startLevel(i) {
      var s = load(); preview(i);
      if (s.seen.indexOf(i) < 0) { s.seen.push(i); save(s); dialog(STORY[i], function () { levelIntro(i); }); }
      else levelIntro(i);
    }
    function preview(i) { if (scene3) { var cfg = i < 0 ? { theme: 'golden', path: LEVELS[0].path, slots: LEVELS[0].slots } : LEVELS[i]; scene3.setLevel(cfg); scene3.sync(createGame(i, {})); sizeScene(); } padsLayer.innerHTML = ''; padEls = []; }
    function levelIntro(i) {
      var cfg = LEVELS[i], s = load(), p = panel('cf-intro');
      heading(p, tr('def.placeN', { n: i + 1 }), tr('def.level.' + cfg.id));
      var rules = el('ul', 'cf-rules'), lives = LIVES + (s.perks.walls ? 3 : 0);
      var lines = [tr('def.ruleWaves', { n: cfg.waves.length, l: lives }), tr('def.ruleWords'), tr('def.ruleTowers', { t: cfg.towers.map(function (t) { return tr('def.tower.' + t); }).join(', ') }), i === LEVELS.length - 1 ? tr('def.ruleKing', { n: SHIELD_HITS }) : null];
      ['≋', '◉', '♜', '♛'].forEach(function (ic, k) { if (!lines[k]) return; var li = el('li'); li.appendChild(el('b', null, ic)); li.appendChild(el('span', null, lines[k])); rules.appendChild(li); });
      p.appendChild(rules);
      var a = el('div', 'cf-actions'), go = btn('cf-btn primary', tr('def.defend'), function () { begin(i); });
      a.appendChild(go); a.appendChild(btn('cf-btn', tr('def.toMap'), showMap)); p.appendChild(a); go.focus({ preventScroll: true });
    }
    function showMap() {
      var s = load(), p = panel('cf-book');
      preview(nextLevel(s) >= 0 ? nextLevel(s) : -1);
      var head = el('div', 'cf-book-head'), ht = el('div'); heading(ht, tr('def.mapEyebrow'), tr('def.mapTitle')); ht.removeAttribute('aria-labelledby'); head.appendChild(ht);
      p.setAttribute('aria-labelledby', ht.querySelector('h2').id);
      var wallet = el('span', 'cf-wallet', s.scrolls + ' ✉'); wallet.setAttribute('aria-label', tr('def.scrolls') + ': ' + s.scrolls); head.appendChild(wallet); p.appendChild(head);
      var nl = nextLevel(s), grid = el('ol', 'cf-days td-places');
      LEVELS.forEach(function (lv, i) {
        var open = levelOpen(s, i), done = s.levels[i] > 0;
        var b = btn('cf-day td-place t-' + lv.theme + (done ? ' done' : '') + (i === nl ? ' next' : '') + (i === LEVELS.length - 1 ? ' finale' : ''), null, function () { startLevel(i); });
        b.disabled = !open;
        b.appendChild(el('span', 'cf-day-n', tr('def.placeN', { n: i + 1 })));
        b.appendChild(el('strong', null, tr('def.level.' + lv.id)));
        var st = el('span', 'cf-day-stars'); for (var k = 0; k < 3; k++) st.appendChild(el('i', k < s.levels[i] ? 'on' : null)); b.appendChild(st);
        b.setAttribute('aria-label', tr('def.placeN', { n: i + 1 }) + '. ' + tr('def.level.' + lv.id) + (done ? '. ' + tr('fish.starsN', { n: s.levels[i] }) : open ? '' : '. ' + tr('cafe.locked')));
        var li = el('li'); li.appendChild(b); grid.appendChild(li);
      });
      var eb = btn('cf-day td-place t-endless' + (s.ending ? '' : ''), null, function () { begin(-1); }); eb.disabled = !s.ending;
      eb.appendChild(el('span', 'cf-day-n', '∞')); eb.appendChild(el('strong', null, tr('def.endless')));
      eb.appendChild(el('span', 'td-best', s.ending ? tr('def.bestWave', { n: s.best }) : tr('def.endlessLocked')));
      var eli = el('li'); eli.appendChild(eb); grid.appendChild(eli);
      p.appendChild(grid);
      var a = el('div', 'cf-actions');
      var cont = nl >= 0 ? btn('cf-btn primary', tr('def.playPlace', { n: nl + 1 }), function () { startLevel(nl); }) : btn('cf-btn primary', tr('def.endless'), function () { begin(-1); });
      a.appendChild(cont); a.appendChild(btn('cf-btn', tr('def.perks'), function () { showPerks(showMap); }));
      p.appendChild(a);
      p.appendChild(btn('cf-link', tr('fish.backHub'), close));
      cont.focus({ preventScroll: true });
    }
    function showPerks(back) {
      var s = load(), p = panel('cf-shop');
      heading(p, tr('def.perksEyebrow'), tr('def.perks'));
      p.appendChild(hostLine('bahrom', 'def.perksLead'));
      var w = el('p', 'cf-walletline'); w.appendChild(el('span', null, tr('def.scrolls'))); w.appendChild(el('strong', null, s.scrolls + ' ✉')); p.appendChild(w);
      var list = el('div', 'cf-upgrades');
      Object.keys(PERKS).forEach(function (id) {
        var u = PERKS[id], owned = !!s.perks[id], item = el('div', 'cf-upgrade' + (owned ? ' owned' : ''));
        var ic = el('span', 'cf-up-icon pk-' + id); ic.setAttribute('aria-hidden', 'true'); item.appendChild(ic);
        var tx = el('div', 'cf-up-text'); tx.appendChild(el('strong', null, tr('def.perk.' + id))); tx.appendChild(el('span', null, tr('def.perk.' + id + 'Sub'))); item.appendChild(tx);
        var b = btn('cf-btn small', owned ? tr('cafe.owned') : tr('def.buyScrolls', { n: u.cost }), function () { var n = buyPerk(load(), id); if (!n) return; save(n); fx('chest'); showPerks(back); var f = overlay.querySelector('[data-perk="' + id + '"]'); if (f) f.focus(); });
        b.dataset.perk = id; b.disabled = owned || s.scrolls < u.cost; item.appendChild(b); list.appendChild(item);
      });
      p.appendChild(list);
      p.appendChild(btn('cf-btn', tr('fish.back'), back));
    }
    function portrait(who, size) {
      var cv = el('canvas', 'cf-portrait'); cv.setAttribute('aria-hidden', 'true');
      var r = Math.min(2, window.devicePixelRatio || 1); cv.width = size * r; cv.height = size * r; cv.style.width = size + 'px'; cv.style.height = size + 'px';
      var c = cv.getContext('2d'); c.setTransform(r * size / 100, 0, 0, r * size / 100, 0, 0);
      var bg = { bahrom: ['#cfe8ff', '#3a7ac0'], ota: ['#ffd98a', '#e8a33a'], zuhra: ['#ffd9b0', '#c8602a'], king: ['#c8a0ff', '#2a1238'] }[who];
      var g = c.createRadialGradient(40, 35, 5, 50, 50, 55); g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
      c.fillStyle = g; c.beginPath(); c.arc(50, 50, 50, 0, 6.283); c.fill();
      c.save(); c.beginPath(); c.arc(50, 50, 50, 0, 6.283); c.clip();
      if (who === 'bahrom') {
        c.fillStyle = '#7a5a3a'; c.beginPath(); c.ellipse(50, 104, 40, 18, 0, 0, 6.283); c.fill();
        c.fillStyle = '#f4f1ea'; c.beginPath(); c.ellipse(46, 92, 22, 18, -0.2, 0, 6.283); c.fill();
        c.fillStyle = '#141a2e'; c.beginPath(); c.ellipse(30, 94, 14, 9, 0.5, 0, 6.283); c.fill();
        c.strokeStyle = '#f4f1ea'; c.lineWidth = 9; c.lineCap = 'round'; c.beginPath(); c.moveTo(50, 80); c.quadraticCurveTo(44, 58, 50, 42); c.stroke();
        c.fillStyle = '#f4f1ea'; c.beginPath(); c.arc(52, 38, 12, 0, 6.283); c.fill();
        c.fillStyle = '#c8402a'; c.beginPath(); c.moveTo(60, 34); c.lineTo(94, 44); c.lineTo(60, 42); c.closePath(); c.fill();
        c.fillStyle = '#141a2e'; c.beginPath(); c.arc(54, 35, 2.6, 0, 6.283); c.fill();
        c.fillStyle = '#1f6fb2'; c.beginPath(); c.arc(50, 30, 12, Math.PI, 0); c.fill(); c.fillStyle = '#2bb3c0'; c.fillRect(38, 29, 24, 3);
      } else if (who === 'ota') {
        c.fillStyle = '#1c2a52'; c.beginPath(); c.ellipse(50, 104, 34, 26, 0, 0, 6.283); c.fill();
        c.fillStyle = '#b5794a'; c.beginPath(); c.arc(50, 52, 26, 0, 6.283); c.arc(30, 32, 8, 0, 6.283); c.arc(70, 32, 8, 0, 6.283); c.fill();
        c.fillStyle = '#ecd2ac'; c.beginPath(); c.ellipse(52, 62, 15, 11, 0, 0, 6.283); c.fill();
        c.fillStyle = '#2a1a12'; c.beginPath(); c.ellipse(53, 57, 4.5, 3.4, 0, 0, 6.283); c.fill();
        c.fillStyle = '#141a2e'; c.beginPath(); c.arc(41, 48, 3.4, 0, 6.283); c.arc(62, 47, 3.4, 0, 6.283); c.fill();
        c.fillStyle = '#e8a33a'; c.beginPath(); c.arc(50, 40, 25, Math.PI * 1.05, Math.PI * 1.95); c.fill();
        c.strokeStyle = '#8a5a34'; c.lineWidth = 3; c.beginPath(); c.arc(84, 62, 22, Math.PI * 0.6, Math.PI * 1.4); c.stroke();
      } else if (who === 'zuhra') {
        c.fillStyle = '#5f8f4a'; c.beginPath(); c.ellipse(50, 104, 44, 30, 0, Math.PI, 0); c.fill();
        c.fillStyle = '#9bbf6a'; c.beginPath(); c.arc(50, 54, 25, 0, 6.283); c.fill();
        c.fillStyle = '#c8402a'; c.beginPath(); c.arc(50, 50, 28, Math.PI * 1.02, Math.PI * 1.98); c.lineTo(80, 60); c.lineTo(20, 60); c.closePath(); c.fill();
        c.fillStyle = '#e8b04a'; for (var k = 0; k < 5; k++) { c.beginPath(); c.arc(30 + k * 10, 36 + Math.abs(k - 2) * 2, 2.2, 0, 6.283); c.fill(); }
        c.strokeStyle = '#3a2a1a'; c.lineWidth = 2; c.beginPath(); c.arc(41, 56, 6, 0, 6.283); c.stroke(); c.beginPath(); c.arc(59, 56, 6, 0, 6.283); c.stroke(); c.beginPath(); c.moveTo(47, 56); c.lineTo(53, 56); c.stroke();
        c.fillStyle = '#141a2e'; c.beginPath(); c.arc(41, 56, 2.2, 0, 6.283); c.arc(59, 56, 2.2, 0, 6.283); c.fill();
        c.strokeStyle = '#3a2a1a'; c.beginPath(); c.arc(50, 66, 6, 0.2, Math.PI - 0.2); c.stroke();
      } else {
        c.fillStyle = '#2a1a4a'; c.beginPath(); c.arc(50, 66, 34, 0, 6.283); c.arc(22, 84, 12, 0, 6.283); c.arc(80, 86, 12, 0, 6.283); c.fill();
        c.fillStyle = '#fff'; c.beginPath(); c.arc(38, 60, 10, 0, 6.283); c.arc(62, 60, 10, 0, 6.283); c.fill();
        c.fillStyle = '#141a2e'; c.beginPath(); c.arc(40, 62, 4.6, 0, 6.283); c.arc(60, 62, 4.6, 0, 6.283); c.fill();
        c.strokeStyle = '#141a2e'; c.lineWidth = 3; c.beginPath(); c.moveTo(28, 48); c.lineTo(44, 53); c.moveTo(72, 48); c.lineTo(56, 53); c.stroke();
        c.beginPath(); c.arc(50, 84, 9, Math.PI + 0.3, -0.3); c.stroke();
        c.fillStyle = '#e8b04a'; c.beginPath(); c.moveTo(28, 36); c.lineTo(32, 16); c.lineTo(41, 28); c.lineTo(50, 12); c.lineTo(59, 28); c.lineTo(68, 16); c.lineTo(72, 36); c.closePath(); c.fill();
      }
      c.restore(); return cv;
    }

    /* ----- lifecycle ----- */
    function open() {
      var d = api.deck();
      if (!d || !makeQuestion(d.cards)) { api.toast(tr('toast.needMatch'), 'err', 5000); return; }
      hub.hidden = true; stage.hidden = false; visible = true;
      var host = stage.closest('.screen'); if (host) host.classList.add('arcade-on');
      stage.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      ensureScene(function () {
        if (scene3) scene3.setPaused(false); sizeScene();
        var s = load();
        if (!s.intro) { s.intro = true; save(s); preview(0); dialog(INTRO, showMap); }
        else showMap();
      });
    }
    function close() {
      if (game) { game = null; stopRun(); }
      visible = false; if (scene3) scene3.setPaused(true);
      stage.hidden = true; hub.hidden = false; overlay.hidden = true;
      var host = stage.closest('.screen'); if (host) host.classList.remove('arcade-on');
      refreshHub();
      var tile = hub.querySelector('[data-arcade="defense"]'); if (tile) tile.focus({ preventScroll: true });
    }
    function refreshHub() {
      var s = load(), m = hub.querySelector('[data-defense-meta]'), done = s.levels.filter(Boolean).length;
      if (m) m.textContent = tr('def.hubMeta', { d: done, t: LEVELS.length, c: s.scrolls });
    }
    if (window.ResizeObserver) new ResizeObserver(function () { if (visible) sizeScene(); }).observe(stage);
    doc.addEventListener('visibilitychange', function () { if (scene3) scene3.setPaused(doc.hidden || !visible); });
    doc.addEventListener('pointerdown', function (e) { if (sel != null && !pop.contains(e.target) && !e.target.closest('.td-pad')) closePop(); });
    hub.addEventListener('click', function (e) { if (e.target.closest('[data-arcade="defense"]')) open(); });
    // test hooks
    window.defState = function () { return game ? { phase: game.phase, wave: game.wave, waves: game.waves, coins: game.coins, lives: game.lives, enemies: game.enemies.length, towers: game.slots.filter(function (s) { return s.tower; }).length, three: !!(scene3 && scene3.three), pads: padEls.length, sel: sel } : null; };
    window.defAnswer = function (right) { var b = opts.querySelector(right ? '[data-right="1"]' : '[data-right=""]:not(:disabled)'); if (!game || !b || lock) return false; b.click(); return true; };
    window.defFast = function (sec) { if (!game) return null; var r = null; for (var t = 0; t < sec && !r; t += 0.05) r = stepGame(game, 0.05); scene3.sync(game); handleEvents(); updateHud(); if (r) endLevel(r); return r; };
    refreshHub();
    return { refresh: refreshHub, leave: function () { if (!stage.hidden) close(); }, active: function () { return !!game; } };
  }

  return { TOWERS: TOWERS, ENEMIES: ENEMIES, LEVELS: LEVELS, PERKS: PERKS, START_COINS: START_COINS, LIVES: LIVES, SHIELD_HITS: SHIELD_HITS,
    makePath: makePath, towerStats: towerStats, upgradeCost: upgradeCost, createGame: createGame, startWave: startWave, stepGame: stepGame,
    build: build, upgrade: upgrade, sell: sell, answerCoins: answerCoins, chipShield: chipShield, missShield: missShield, stars: stars,
    scrollsFor: scrollsFor, makeQuestion: makeQuestion, endlessWave: endlessWave, defaults: defaults, clean: clean, levelOpen: levelOpen, nextLevel: nextLevel, buyPerk: buyPerk,
    mount: mount };
});
