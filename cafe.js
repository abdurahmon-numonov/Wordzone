/* «Чайхана» (v2.36): a café game over the user's own words, after Blooket's Café, in a 3D Samarkand courtyard.
   Grandma Zuhra's tea house has lost its guests; Ota helps her bring them back over six days, up to the Navruz
   festival and the visit of Mister Owl, the strictest critic of the Silk Road. Guests order a dish by its word
   (in the language being learned); the player taps the dish card with the right translation and Ota carries it
   over. Tea orders are a pouring game: hold, and let go inside the green band. Coins buy decorations that also
   help (patience, tips, an easier samovar, a fourth tapchan, more guests). The rules are pure and tested in Node
   (test/cafe.js); mount() draws the HUD, order bubbles, dish tray and panels as DOM over a three.js scene
   (vendor/cafe3d.js, loaded on first open) or over a flat fallback when WebGL is missing. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VMCafe = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* ---------------- rules ---------------- */

  // seats: tapchans in use; patience: seconds a guest waits; tea: share of tea orders; critic: Mister Owl's five orders.
  var DAYS = [
    { target: 100, seats: 2, patience: 20, tea: 0 },
    { target: 150, seats: 3, patience: 18, tea: 0.25 },
    { target: 200, seats: 3, patience: 16, tea: 0.25 },
    { target: 250, seats: 3, patience: 15, tea: 0.3 },
    { target: 300, seats: 3, patience: 14, tea: 0.3 },
    { target: 260, seats: 3, patience: 14, tea: 0.25, critic: 5 }
  ];
  var FREE = { target: 0, seats: 3, patience: 14, tea: 0.3 };
  var DAY_SECONDS = 90, CRITIC_PATIENCE = 11, CRITIC_AT = 25;
  var UPGRADES = {
    lanterns: { cost: 100 }, // +20% patience
    samovar: { cost: 120 },  // slower pour, wider green band
    carpet: { cost: 140 },   // +25% coins
    vines: { cost: 160 },    // guests arrive sooner
    tapchan: { cost: 220 }   // a fourth seat
  };
  var DISHES = ['plov', 'somsa', 'lagmon', 'non'];

  function shuffle(a, r) { r = r || Math.random; for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; }
  // An order: the guest says `word` (original); four dish cards carry translations, one of them right.
  function makeOrder(cards, avoid, r) {
    r = r || Math.random;
    var pool = cards.filter(function (c) { return c && c.original && c.translation; });
    var byT = {}; pool.forEach(function (c) { var k = String(c.translation).toLowerCase(); if (!byT[k]) byT[k] = c; });
    var uniq = Object.keys(byT).map(function (k) { return byT[k]; });
    if (uniq.length < 4) return null;
    var fresh = uniq.filter(function (c) { return !avoid || avoid.indexOf(c.original) < 0; });
    var card = (fresh.length ? fresh : uniq)[Math.floor(r() * (fresh.length ? fresh.length : uniq.length))];
    var others = shuffle(uniq.filter(function (c) { return c !== card; }), r).slice(0, 3);
    var opts = shuffle([card].concat(others), r).map(function (c, i) { return { text: c.translation, right: c === card, dish: DISHES[i % 4] }; });
    return { card: card, word: card.original, answer: card.translation, options: opts };
  }
  // Coins for a served order: 10, up to +10 for patience left, ×(1 + 0.1 per combo step, up to 5), +25% with the carpet.
  function coinsFor(left, combo, carpet) {
    var c = (10 + Math.round(10 * Math.max(0, Math.min(1, left)))) * (1 + 0.1 * Math.min(5, combo || 0));
    if (carpet) c *= 1.25;
    return Math.round(c);
  }
  function patienceFor(day, up) { return (day.patience || 14) * (up && up.lanterns ? 1.2 : 1); }
  function pourRate(up) { return up && up.samovar ? 0.36 : 0.5; } // of a cup per second
  function teaBand(up) { return up && up.samovar ? [0.64, 0.94] : [0.72, 0.9]; }
  // Tea: inside the band is perfect, a little under is fine, over the brim spills.
  function teaResult(level, band) { return level >= 1 ? 'spill' : level >= band[0] && level <= band[1] ? 'perfect' : level >= 0.45 ? 'ok' : 'low'; }
  function teaCoins(result, carpet) { var c = result === 'perfect' ? 22 : result === 'ok' ? 10 : 0; return Math.round(c * (carpet ? 1.25 : 1)); }
  function stars(coins, target) { if (!target || coins < target) return 0; return coins >= target * 1.7 ? 3 : coins >= target * 1.35 ? 2 : 1; }
  function spawnDelay(up, r) { return (2.2 + (r || Math.random)() * 1.8) * (up && up.vines ? 0.7 : 1); }
  function seatCount(day, up) { return Math.min(4, day.seats + (up && up.tapchan && day.seats >= 3 ? 1 : 0)); }

  function defaults() { return { coins: 0, up: {}, days: [0, 0, 0, 0, 0, 0], best: 0, intro: false, seen: [], ending: false }; }
  function clean(s) {
    var d = defaults(), o = Object.assign(d, s && typeof s === 'object' ? s : {});
    o.coins = Math.max(0, Math.floor(Number(o.coins) || 0));
    var up = {}; Object.keys(UPGRADES).forEach(function (k) { if (o.up && o.up[k] === true) up[k] = true; }); o.up = up;
    o.days = DAYS.map(function (x, i) { return Math.min(3, Math.max(0, Math.floor(Number(o.days && o.days[i]) || 0))); });
    o.best = Math.max(0, Math.floor(Number(o.best) || 0));
    o.seen = Array.isArray(o.seen) ? o.seen.filter(function (n) { return typeof n === 'number'; }) : [];
    return o;
  }
  function dayOpen(s, i) { return i === 0 || s.days[i - 1] > 0; }
  function nextDay(s) { for (var i = 0; i < DAYS.length; i++) if (!s.days[i]) return dayOpen(s, i) ? i : -1; return -1; }
  function buy(s, id) {
    var u = UPGRADES[id]; if (!u || s.up[id] || s.coins < u.cost) return null;
    var n = JSON.parse(JSON.stringify(s)); n.coins -= u.cost; n.up[id] = true; return n;
  }

  /* ---------------- screen ---------------- */

  var DISH_SVG = {
    plov: '<svg viewBox="0 0 48 32"><ellipse cx="24" cy="22" rx="21" ry="8" fill="#f4ede2"/><path d="M8 20 Q24 2 40 20Z" fill="#e0a24a"/><circle cx="18" cy="15" r="2" fill="#e86a2a"/><circle cx="26" cy="12" r="2" fill="#e86a2a"/><circle cx="30" cy="17" r="2" fill="#e86a2a"/><circle cx="22" cy="18" r="1.6" fill="#7a4a2a"/></svg>',
    somsa: '<svg viewBox="0 0 48 32"><ellipse cx="24" cy="24" rx="21" ry="7" fill="#f4ede2"/><path d="M8 22 L17 8 L26 22Z" fill="#d98a3a"/><path d="M22 22 L31 8 L40 22Z" fill="#c8782a"/><circle cx="17" cy="15" r="1" fill="#3a2a1a"/><circle cx="31" cy="15" r="1" fill="#3a2a1a"/></svg>',
    lagmon: '<svg viewBox="0 0 48 32"><path d="M5 14 H43 Q41 30 24 30 Q7 30 5 14Z" fill="#2a8fc4"/><ellipse cx="24" cy="14" rx="19" ry="5" fill="#c8402a"/><path d="M12 13 q4 -3 8 0 t8 0 t8 0" stroke="#ffe0a0" stroke-width="2" fill="none"/><circle cx="30" cy="12" r="2" fill="#5a9a4a"/></svg>',
    non: '<svg viewBox="0 0 48 32"><ellipse cx="24" cy="18" rx="20" ry="11" fill="#d9a05a"/><ellipse cx="24" cy="18" rx="10" ry="5.5" fill="#b8803a"/><g fill="#7a4a2a"><circle cx="21" cy="17" r="1"/><circle cx="27" cy="17" r="1"/><circle cx="24" cy="20" r="1"/><circle cx="24" cy="15" r="1"/></g></svg>'
  };
  var FLAT_SEATS = [[0.3, 0.42], [0.62, 0.42], [0.42, 0.62], [0.78, 0.62]];

  function mount(api) {
    var doc = document, $ = function (id) { return doc.getElementById(id); };
    var stage = $('cafeStage'), hub = $('arcadeHub');
    if (!stage) return { refresh: function () {}, leave: function () {}, active: function () { return false; } };
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var tr = api.tr;
    function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; if (fn) b.onclick = fn; return b; }
    function load() { try { return clean(JSON.parse(localStorage.getItem('vm.cafe') || 'null')); } catch (e) { return defaults(); } }
    function save(s) { try { localStorage.setItem('vm.cafe', JSON.stringify(s)); } catch (e) {} }
    function fx(k) { if (api.fx) api.fx(k); }

    /* ----- DOM ----- */
    stage.innerHTML = '';
    var canvas = el('canvas', 'cf-canvas'); canvas.setAttribute('aria-hidden', 'true');
    var flat = el('div', 'cf-flat'); flat.hidden = true; flat.setAttribute('aria-hidden', 'true');
    var hud = el('div', 'cf-hud');
    var dayChip = el('div', 'cf-chip'), dayLabel = el('span'), dayCoins = el('strong'), dayBar = el('div', 'cf-bar'), dayFill = el('i');
    dayBar.appendChild(dayFill); dayChip.appendChild(dayLabel); dayChip.appendChild(dayCoins); dayChip.appendChild(dayBar);
    var timer = el('div', 'cf-timer'), timerV = el('strong', null, '90'); timer.appendChild(timerV); timer.appendChild(el('span', null, tr('fish.sec')));
    var right = el('div', 'cf-hud-right'), combo = el('span', 'cf-combo'); combo.hidden = true;
    var quit = btn('cf-quit', tr('cafe.finish'), function () { if (run) endDay(true); });
    right.appendChild(combo); right.appendChild(quit);
    hud.appendChild(dayChip); hud.appendChild(timer); hud.appendChild(right);
    var bubbles = el('div', 'cf-bubbles');
    var tray = el('div', 'cf-tray'); tray.setAttribute('aria-label', tr('cafe.tray'));
    var trayHead = el('div', 'cf-tray-head'), trayWho = el('span', 'cf-tray-who'), trayWord = el('strong', 'cf-tray-word');
    var speakBtn = btn('cf-speak', null, function () { if (sel != null && orders[sel] && orders[sel].order) api.speak(orders[sel].order.word); }); speakBtn.setAttribute('aria-label', tr('cafe.listen')); speakBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
    trayHead.appendChild(trayWho); trayHead.appendChild(trayWord); trayHead.appendChild(speakBtn);
    var dishes = el('div', 'cf-dishes');
    var pourBox = el('div', 'cf-pour'); pourBox.hidden = true;
    var cupEl = el('div', 'cf-cup'), cupFill = el('i'), cupBand = el('b'); cupEl.appendChild(cupBand); cupEl.appendChild(cupFill);
    cupEl.setAttribute('role', 'meter'); cupEl.setAttribute('aria-label', tr('cafe.cup')); cupEl.setAttribute('aria-valuemin', '0'); cupEl.setAttribute('aria-valuemax', '100');
    var pourHint = el('span', 'cf-pour-hint', tr('cafe.pourHint'));
    var pourBtn = btn('cf-pourbtn', tr('cafe.pour')); pourBtn.setAttribute('aria-pressed', 'false');
    pourBox.appendChild(cupEl); pourBox.appendChild(pourHint); pourBox.appendChild(pourBtn);
    var feedback = el('p', 'cf-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
    tray.appendChild(trayHead); tray.appendChild(dishes); tray.appendChild(pourBox); tray.appendChild(feedback);
    var banner = el('div', 'cf-banner'); banner.setAttribute('aria-hidden', 'true');
    var loading = el('div', 'cf-loading', tr('cafe.loading'));
    var overlay = el('div', 'cf-overlay'); overlay.hidden = true;
    [canvas, flat, hud, bubbles, tray, banner, loading, overlay].forEach(function (n) { stage.appendChild(n); });

    /* ----- scene: three.js or the flat fallback ----- */
    var scene3 = null, anchorList = [], visible = false;
    function flatScene() {
      flat.hidden = false; canvas.hidden = true;
      var seated = [], seatsEls = FLAT_SEATS.map(function (p) { var d = el('i', 'cf-flat-seat'); d.style.left = (p[0] * 100) + '%'; d.style.top = (p[1] * 100) + '%'; flat.appendChild(d); return d; });
      function pos() { var r = stage.getBoundingClientRect(); return FLAT_SEATS.map(function (p, i) { return seated[i] ? { x: p[0] * r.width, y: p[1] * r.height - 40 } : null; }); }
      var loop = function () { if (visible) { anchorList = pos(); placeBubbles(); } requestAnimationFrame(loop); }; requestAnimationFrame(loop);
      return {
        resize: function () {}, setDecor: function (d) { seatsEls[3].hidden = !(d && d.tapchan); },
        spawn: function (i, kind, cb) { seatsEls[i].className = 'cf-flat-seat on k-' + (kind || 'fox'); setTimeout(function () { seated[i] = true; if (cb) cb(); }, 500); },
        setMood: function (i, m) { seatsEls[i].dataset.mood = m; }, leave: function (i) { seated[i] = false; seatsEls[i].className = 'cf-flat-seat'; },
        serve: function (i, k, cb) { setTimeout(cb, 250); }, pour: function () {}, setPaused: function () {}, dispose: function () {}, three: false
      };
    }
    function ensureScene(done) {
      if (scene3) return done();
      var useFlat = function () { scene3 = flatScene(); loading.hidden = true; done(); };
      var make = function () {
        try {
          if (!window.VMCafe3D || !window.VMCafe3D.supported()) return useFlat();
          scene3 = window.VMCafe3D.create(canvas, { reduced: reduced, onFrame: function (a) { anchorList = a; placeBubbles(); } });
          loading.hidden = true; sizeScene(); done();
        } catch (e) { useFlat(); }
      };
      if (window.VMCafe3D) return make();
      loading.hidden = false;
      var s = doc.createElement('script'); s.src = 'vendor/cafe3d.js?v=2.36'; s.onload = make; s.onerror = useFlat; doc.head.appendChild(s);
    }
    function sizeScene() { if (scene3) { var r = stage.getBoundingClientRect(); scene3.resize(r.width, r.height); } }
    function decorate() { if (scene3) scene3.setDecor(load().up); }

    /* ----- a day ----- */
    var run = null, orders = [], sel = null, holding = false;
    function begin(dayIndex) {
      var d = api.deck();
      if (!d || !makeOrder(d.cards)) { api.toast(tr('toast.needMatch'), 'err', 5000); return; }
      var s = load(), cfg = dayIndex < 0 ? FREE : DAYS[dayIndex];
      run = { day: dayIndex, cfg: cfg, s: s, deck: d, elapsed: 0, coins: 0, served: 0, lost: 0, wrong: 0, combo: 0, bestCombo: 0,
        seats: seatCount(cfg, s.up), nextSpawn: 0.6, recent: [], critic: cfg.critic ? { left: cfg.critic, mistakes: 0, done: false, failed: false, seat: -1 } : null, over: false };
      orders = [null, null, null, null]; sel = null; bubbles.innerHTML = '';
      overlay.hidden = true; overlay.innerHTML = '';
      decorate();
      stage.classList.add('playing');
      dayLabel.textContent = dayIndex < 0 ? tr('cafe.freeShift') : tr('cafe.dayN', { n: dayIndex + 1 });
      combo.hidden = true; feedback.textContent = '';
      updateHud(); renderTray();
      doc.addEventListener('keydown', onKey); doc.addEventListener('keyup', onKeyUp);
      last = 0; requestAnimationFrame(tick);
    }
    var last = 0;
    function tick(now) {
      if (!run || run.over) return;
      var dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
      if (!doc.hidden) step(dt);
      requestAnimationFrame(tick);
    }
    function freeSeat() { for (var i = 0; i < run.seats; i++) if (!orders[i]) return i; return -1; }
    function step(dt) {
      run.elapsed += dt;
      var left = Math.max(0, DAY_SECONDS - run.elapsed);
      if (Math.ceil(left) !== run.lastSec) { run.lastSec = Math.ceil(left); timerV.textContent = String(run.lastSec); timer.classList.toggle('low', left <= 10); if (left <= 5 && left > 0) fx('tick'); }
      // the critic arrives, taking the first free seat
      var c = run.critic;
      if (c && !c.done && !c.failed && c.seat < 0 && run.elapsed >= CRITIC_AT) { var cs = freeSeat(); if (cs >= 0) seatGuest(cs, 'owl'); }
      run.nextSpawn -= dt;
      if (run.nextSpawn <= 0 && left > 6) { var fs = freeSeat(); if (fs >= 0 && !(c && !c.done && !c.failed && c.seat < 0 && run.elapsed >= CRITIC_AT - 4)) seatGuest(fs); run.nextSpawn = spawnDelay(run.s.up); }
      // patience
      orders.forEach(function (o, i) {
        if (!o || !o.seated || o.serving) return;
        o.left -= dt / o.patience;
        if (scene3) scene3.setMood(i, o.left < 0.2 ? 'angry' : o.left < 0.45 ? 'impatient' : 'calm');
        if (o.left <= 0) guestLeaves(i);
      });
      if (sel == null || !orders[sel] || !orders[sel].seated || orders[sel].serving) autoSelect();
      if (holding) pourStep(dt);
      paintBubbles();
      if (left <= 0) endDay(false);
    }
    function seatGuest(i, kind) {
      var o = { kind: kind || null, seated: false, serving: false, left: 1, patience: patienceFor(run.cfg, run.s.up), tea: false, order: null, el: null };
      if (kind === 'owl') { o.patience = CRITIC_PATIENCE * (run.s.up.lanterns ? 1.2 : 1); run.critic.seat = i; }
      else if (Math.random() < (run.cfg.tea || 0)) o.tea = true;
      if (!o.tea) { o.order = makeOrder(run.deck.cards, run.recent); run.recent.push(o.order.word); if (run.recent.length > 4) run.recent.shift(); }
      orders[i] = o;
      var spawnKind = kind || ['fox', 'rabbit', 'bear', 'cat', 'panda'][Math.floor(Math.random() * 5)];
      scene3.spawn(i, spawnKind, function () {
        if (orders[i] !== o) return;
        o.seated = true; makeBubble(i, o); fx('bite');
        if (kind === 'owl') say(tr('cafe.criticHere'), 'gold');
        if (!o.tea && api.autoSpeak && api.autoSpeak()) api.speak(o.order.word);
      });
    }
    function makeBubble(i, o) {
      var b = btn('cf-bubble' + (o.tea ? ' tea' : '') + (o.kind === 'owl' ? ' critic' : ''), null, function () { select(i); });
      if (o.tea) { b.appendChild(el('span', 'cf-bubble-kind', tr('cafe.teaOrder'))); b.appendChild(el('strong', null, tr('cafe.tea'))); }
      else { if (o.kind === 'owl') b.appendChild(el('span', 'cf-bubble-kind', tr('cafe.criticOrder', { n: run.critic.left }))); var w = el('strong', null, o.order.word); w.lang = run.deck.source; b.appendChild(w); }
      b.setAttribute('aria-label', o.tea ? tr('cafe.teaOrder') : tr('cafe.guestWants', { w: o.order.word }));
      o.el = b; bubbles.appendChild(b);
    }
    function paintBubbles() {
      orders.forEach(function (o, i) {
        if (!o || !o.el) return;
        o.el.style.setProperty('--p', Math.max(0, o.left).toFixed(3));
        o.el.classList.toggle('urgent', o.left < 0.3);
        o.el.classList.toggle('sel', sel === i);
        o.el.setAttribute('aria-pressed', sel === i ? 'true' : 'false');
      });
    }
    function placeBubbles() {
      orders.forEach(function (o, i) {
        if (!o || !o.el) return;
        var a = anchorList[i];
        if (!a) { o.el.style.visibility = 'hidden'; return; }
        o.el.style.visibility = ''; o.el.style.transform = 'translate(' + Math.round(a.x) + 'px,' + Math.round(a.y) + 'px) translate(-50%,-100%)';
      });
    }
    function autoSelect() {
      var best = null, bl = 2;
      orders.forEach(function (o, i) { if (o && o.seated && !o.serving && o.left < bl) { bl = o.left; best = i; } });
      if (best !== sel) { sel = best; renderTray(); }
    }
    function select(i) { var o = orders[i]; if (!o || !o.seated || o.serving) return; sel = i; renderTray(); paintBubbles(); var first = dishes.querySelector('button'); if (first) first.focus({ preventScroll: true }); }
    function renderTray() {
      var o = sel != null ? orders[sel] : null;
      dishes.innerHTML = ''; pourBox.hidden = true; holdOff();
      tray.classList.toggle('idle', !o);
      if (!o) { trayWho.textContent = tr('cafe.waitGuests'); trayWord.textContent = ''; speakBtn.hidden = true; return; }
      speakBtn.hidden = o.tea;
      if (o.tea) {
        trayWho.textContent = tr('cafe.teaFor'); trayWord.textContent = tr('cafe.tea'); trayWord.removeAttribute('lang');
        pourBox.hidden = false; o.level = o.level || 0; var band = teaBand(run.s.up);
        cupBand.style.bottom = (band[0] * 100) + '%'; cupBand.style.height = ((band[1] - band[0]) * 100) + '%';
        paintCup(o.level); return;
      }
      trayWho.textContent = o.kind === 'owl' ? tr('cafe.criticWants') : tr('cafe.guestSays'); trayWord.textContent = o.order.word; trayWord.lang = run.deck.source;
      o.order.options.forEach(function (op, k) {
        var b = btn('cf-dish', null, function () { serveDish(op, b); });
        b.appendChild(el('kbd', null, String(k + 1)));
        var art = el('span', 'cf-dish-art'); art.innerHTML = DISH_SVG[op.dish]; art.setAttribute('aria-hidden', 'true'); b.appendChild(art);
        var tx = el('span', 'cf-dish-text', op.text); tx.lang = run.deck.target; b.appendChild(tx);
        b.dataset.right = op.right ? '1' : ''; dishes.appendChild(b);
      });
    }
    function serveDish(op, b) {
      if (!run || sel == null) return;
      var i = sel, o = orders[i]; if (!o || o.serving || o.tea) return;
      if (!op.right) {
        run.wrong++; run.combo = 0; combo.hidden = true;
        api.answer(o.order.card, false, !o.missed); o.missed = true;
        o.left = Math.max(0.05, o.left - 0.3);
        b.classList.add('wrong'); b.disabled = true;
        var rb = dishes.querySelector('[data-right="1"]'); if (rb) rb.classList.add('hint');
        feedback.textContent = tr('cafe.wrong', { w: o.order.word, t: o.order.answer }); feedback.className = 'cf-feedback bad';
        fx('bad');
        if (o.kind === 'owl') { run.critic.mistakes++; if (run.critic.mistakes >= 3) { criticFails(i); } }
        return;
      }
      if (!o.missed) api.answer(o.order.card, true, true);
      var coins = o.missed ? 4 : coinsFor(o.left, run.combo, run.s.up.carpet);
      if (!o.missed) { run.combo++; run.bestCombo = Math.max(run.bestCombo, run.combo); }
      deliver(i, op.dish, coins, o.missed ? tr('cafe.servedLate') : run.combo >= 3 ? tr('cafe.comboN', { n: run.combo }) : tr('cafe.served'));
    }
    function deliver(i, dish, coins, msg) {
      var o = orders[i]; o.serving = true; if (o.el) o.el.classList.add('served');
      sel = null; renderTray();
      feedback.textContent = msg; feedback.className = 'cf-feedback ok';
      fx('cast');
      scene3.serve(i, dish, function () {
        if (orders[i] !== o) return;
        run.coins += coins; run.served++; updateHud();
        fx(coins >= 20 ? 'chest' : 'ok');
        if (o.el) { var pop = el('span', 'cf-pop', '+' + coins); o.el.appendChild(pop); }
        scene3.setMood(i, 'happy');
        if (o.kind === 'owl') criticNext(i);
        else setTimeout(function () { clearSeat(i, true); }, 900);
      });
      if (run.combo >= 2) { combo.hidden = false; combo.textContent = tr('cafe.comboN', { n: run.combo }); combo.classList.remove('bump'); void combo.offsetWidth; combo.classList.add('bump'); }
    }
    function clearSeat(i, happy) {
      var o = orders[i]; if (!o) return;
      if (o.el) { var e = o.el; e.classList.add('gone'); setTimeout(function () { e.remove(); }, 300); }
      orders[i] = null; if (sel === i) sel = null;
      if (scene3) scene3.leave(i, happy);
      if (run) run.nextSpawn = Math.max(run.nextSpawn, 0.9);
      renderTray();
    }
    function guestLeaves(i) {
      var o = orders[i];
      run.lost++; run.combo = 0; combo.hidden = true;
      feedback.textContent = o.tea ? tr('cafe.leftTea') : tr('cafe.left', { w: o.order.word, t: o.order.answer }); feedback.className = 'cf-feedback bad';
      fx('bad');
      if (o.kind === 'owl') return criticFails(i);
      clearSeat(i, false);
    }
    // Mister Owl orders again until his five dishes are served.
    function criticNext(i) {
      var c = run.critic, o = orders[i]; c.left--;
      if (c.left <= 0) { c.done = true; say(tr('cafe.criticHappy'), 'gold'); fx('win'); setTimeout(function () { clearSeat(i, true); }, 1100); return; }
      setTimeout(function () {
        if (!run || orders[i] !== o) return;
        o.order = makeOrder(run.deck.cards, run.recent); run.recent.push(o.order.word); o.missed = false;
        o.serving = false; o.left = 1;
        if (o.el) o.el.remove(); makeBubble(i, o);
        if (api.autoSpeak && api.autoSpeak()) api.speak(o.order.word);
      }, 900);
    }
    function criticFails(i) { run.critic.failed = true; say(tr('cafe.criticGone'), 'bad'); clearSeat(i, false); }

    /* ----- tea ----- */
    function holdOn(e) { var o = sel != null && orders[sel]; if (!run || !o || !o.tea || o.serving) return; if (e && e.cancelable) e.preventDefault(); holding = true; pourBtn.classList.add('on'); pourBtn.setAttribute('aria-pressed', 'true'); if (scene3) scene3.pour(true, o.level); }
    function holdOff() {
      if (!holding) return; holding = false; pourBtn.classList.remove('on'); pourBtn.setAttribute('aria-pressed', 'false');
      var o = sel != null && orders[sel]; if (scene3) scene3.pour(false, o && o.level || 0);
      if (!run || !o || !o.tea || o.serving) return;
      var res = teaResult(o.level, teaBand(run.s.up));
      if (res === 'low') { pourHint.textContent = tr('cafe.pourMore'); return; }
      finishTea(sel, o, res);
    }
    function pourStep(dt) {
      var o = sel != null && orders[sel]; if (!o || !o.tea) { holdOff(); return; }
      o.level += dt * pourRate(run.s.up); paintCup(o.level); if (scene3) scene3.pour(true, o.level);
      if (o.level >= 1) { holdOff(); }
    }
    function paintCup(level) { cupFill.style.transform = 'scaleY(' + Math.min(1, level).toFixed(3) + ')'; cupEl.setAttribute('aria-valuenow', String(Math.round(Math.min(1, level) * 100))); cupEl.classList.toggle('over', level >= 1); }
    function finishTea(i, o, res) {
      if (res === 'spill') {
        feedback.textContent = tr('cafe.spill'); feedback.className = 'cf-feedback bad'; fx('bad');
        o.left = Math.max(0.05, o.left - 0.25); run.combo = 0; combo.hidden = true;
        setTimeout(function () { if (orders[i] === o && !o.serving) { o.level = 0; if (sel === i) { paintCup(0); pourHint.textContent = tr('cafe.pourHint'); } if (scene3) scene3.pour(false, 0); } }, 500);
        return;
      }
      if (res === 'perfect') { run.combo++; run.bestCombo = Math.max(run.bestCombo, run.combo); }
      deliver(i, 'tea', teaCoins(res, run.s.up.carpet), tr(res === 'perfect' ? 'cafe.teaPerfect' : 'cafe.teaOk'));
    }
    pourBtn.addEventListener('pointerdown', holdOn);
    window.addEventListener('pointerup', holdOff); window.addEventListener('pointercancel', holdOff); window.addEventListener('blur', holdOff);

    function onKey(e) {
      if (!run || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'Escape') { e.preventDefault(); endDay(true); return; }
      if (e.key === ' ') { var o = sel != null && orders[sel]; if (o && o.tea) { e.preventDefault(); if (!holding && !e.repeat) holdOn(); return; } }
      if (/^[1-4]$/.test(e.key)) { var b = dishes.querySelectorAll('button')[Number(e.key) - 1]; if (b && !b.disabled) { e.preventDefault(); b.click(); } return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        var list = []; orders.forEach(function (x, k) { if (x && x.seated && !x.serving) list.push(k); });
        if (!list.length) return; e.preventDefault();
        var pos = list.indexOf(sel), nx = list[(pos + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]; select(nx);
      }
    }
    function onKeyUp(e) { if (e.key === ' ') holdOff(); }

    function updateHud() {
      if (!run) return;
      var target = run.cfg.target;
      dayCoins.textContent = target ? run.coins + ' / ' + target : String(run.coins);
      dayFill.style.transform = 'scaleX(' + (target ? Math.min(1, run.coins / target) : 0).toFixed(3) + ')';
      dayChip.classList.toggle('met', !!target && run.coins >= target);
      dayCoins.classList.remove('bump'); void dayCoins.offsetWidth; dayCoins.classList.add('bump');
    }
    function say(text, cls) { banner.textContent = text; banner.className = 'cf-banner'; void banner.offsetWidth; banner.className = 'cf-banner on ' + (cls || ''); clearTimeout(say.t); say.t = setTimeout(function () { banner.className = 'cf-banner'; }, 2400); }

    /* ----- the end of a day ----- */
    function stopRun() {
      doc.removeEventListener('keydown', onKey); doc.removeEventListener('keyup', onKeyUp);
      holdOff();
      orders.forEach(function (o, i) { if (o) { if (o.el) o.el.remove(); if (scene3) scene3.leave(i, true); } });
      orders = [null, null, null, null]; sel = null; bubbles.innerHTML = '';
      stage.classList.remove('playing');
      var g = run; g.over = true; run = null; api.complete(); return g;
    }
    function endDay(early) {
      if (!run || run.over) return;
      var g = stopRun(), s = load(), free = g.day < 0;
      var criticOk = !g.critic || g.critic.done;
      var starsN = free ? 0 : criticOk && !early ? stars(g.coins, g.cfg.target) : 0, passed = free ? true : starsN > 0;
      s.coins += g.coins;
      if (free) { var record = g.coins > s.best; if (record) s.best = g.coins; }
      else if (passed) s.days[g.day] = Math.max(s.days[g.day], starsN);
      save(s); fx(passed && !early ? 'win' : 'ok');
      var showResult = function () {
        var p = panel('cf-result');
        heading(p, free ? tr('cafe.freeShift') : tr('cafe.dayN', { n: g.day + 1 }), tr(free ? 'cafe.shiftOver' : passed ? 'cafe.dayDone' : early ? 'cafe.closedEarly' : g.critic && !criticOk ? 'cafe.criticFailTitle' : 'cafe.dayFail'));
        if (!free && passed) { var row = el('div', 'cf-stars'); row.setAttribute('aria-label', tr('fish.starsN', { n: starsN })); for (var k = 0; k < 3; k++) row.appendChild(el('i', k < starsN ? 'on' : null)); p.appendChild(row); }
        if (!free) p.appendChild(hostLine('zuhra', passed ? 'cafe.thanks' : g.critic && !criticOk ? 'cafe.criticFailLine' : early ? 'cafe.earlyLine' : 'cafe.tryLine'));
        var meta = el('div', 'cf-meta');
        meta.appendChild(metaItem(tr('cafe.earned'), '+' + g.coins));
        meta.appendChild(metaItem(tr('cafe.servedN'), String(g.served)));
        meta.appendChild(metaItem(tr('cafe.lostN'), String(g.lost)));
        p.appendChild(meta);
        if (!free && g.cfg.target) p.appendChild(el('p', 'cf-lead', tr('cafe.targetWas', { n: g.cfg.target })));
        if (free && g.coins >= s.best && g.coins > 0) p.appendChild(el('p', 'cf-record', tr('game.record')));
        var actions = el('div', 'cf-actions'), nd = nextDay(load()), primary;
        if (!free && passed && nd >= 0) primary = btn('cf-btn primary', tr('cafe.nextDay', { n: nd + 1 }), function () { startDay(nd); });
        else primary = btn('cf-btn primary', tr(free ? 'fish.again' : passed ? 'cafe.toBook' : 'fish.retry'), function () { if (free) begin(-1); else if (passed) showBook(); else startDay(g.day); });
        actions.appendChild(primary);
        actions.appendChild(btn('cf-btn', tr('cafe.shop'), function () { showShop(showBook); }));
        actions.appendChild(btn('cf-btn', tr('cafe.toBook'), showBook));
        p.appendChild(actions); primary.focus({ preventScroll: true });
      };
      if (!free && passed && g.day === DAYS.length - 1 && !s.ending) { s.ending = true; save(s); dialog([{ who: 'sova', key: 'cafe.story.end1' }, { who: 'zuhra', key: 'cafe.story.end2' }], showResult); }
      else showResult();
    }

    /* ----- book of days, shop, dialogs ----- */
    function panel(cls) { overlay.innerHTML = ''; overlay.hidden = false; var p = el('div', 'cf-panel ' + (cls || '')); p.setAttribute('role', 'dialog'); overlay.appendChild(p); return p; }
    function heading(p, eyebrow, title) { if (eyebrow) p.appendChild(el('span', 'cf-eyebrow', eyebrow)); var h = el('h2', 'cf-title', title); h.id = 'cfT' + Math.random().toString(36).slice(2, 7); p.appendChild(h); p.setAttribute('aria-labelledby', h.id); }
    function metaItem(label, value) { var m = el('div', 'cf-meta-item'); m.appendChild(el('span', null, label)); m.appendChild(el('strong', null, value)); return m; }
    function hostLine(who, key) { var row = el('div', 'cf-hostline'); row.appendChild(portrait(who, 56)); var t = el('p'); t.appendChild(el('b', null, tr('cafe.who.' + who) + ': ')); t.appendChild(doc.createTextNode(tr(key))); row.appendChild(t); return row; }
    function dialog(lines, then) {
      var i = 0;
      (function show() {
        var line = lines[i], p = panel('cf-dialog');
        var row = el('div', 'cf-dialog-row'); row.appendChild(portrait(line.who, 110));
        var box = el('div', 'cf-dialog-box'); box.appendChild(el('span', 'cf-eyebrow', tr('cafe.who.' + line.who))); box.appendChild(el('p', 'cf-dialog-text', tr(line.key))); row.appendChild(box); p.appendChild(row);
        var nb = btn('cf-btn primary', i < lines.length - 1 ? tr('fish.next') : tr('fish.letsGo'), function () { i++; if (i < lines.length) show(); else then(); });
        var a = el('div', 'cf-actions'); a.appendChild(nb); p.appendChild(a); p.setAttribute('aria-label', tr('cafe.who.' + line.who)); nb.focus({ preventScroll: true });
      })();
    }
    var STORY = [
      [{ who: 'zuhra', key: 'cafe.story.d1' }],
      [{ who: 'zuhra', key: 'cafe.story.d2' }],
      [{ who: 'ota', key: 'cafe.story.d3a' }, { who: 'zuhra', key: 'cafe.story.d3b' }],
      [{ who: 'zuhra', key: 'cafe.story.d4' }],
      [{ who: 'zuhra', key: 'cafe.story.d5' }],
      [{ who: 'sova', key: 'cafe.story.d6a' }, { who: 'zuhra', key: 'cafe.story.d6b' }]
    ];
    function startDay(i) {
      var s = load();
      if (s.seen.indexOf(i) < 0) { s.seen.push(i); save(s); dialog(STORY[i], function () { dayIntro(i); }); }
      else dayIntro(i);
    }
    function dayIntro(i) {
      var cfg = DAYS[i], s = load(), p = panel('cf-intro');
      heading(p, tr('cafe.dayN', { n: i + 1 }), tr('cafe.dayTitle.' + (i + 1)));
      var rules = el('ul', 'cf-rules');
      var lines = [tr('cafe.ruleTarget', { n: cfg.target, s: DAY_SECONDS }), tr('cafe.ruleTap'), cfg.tea ? tr('cafe.ruleTea') : null, cfg.critic ? tr('cafe.ruleCritic', { n: cfg.critic }) : null, tr('cafe.ruleSeats', { n: seatCount(cfg, s.up) })];
      ['◎', '⇄', '☕', '♛', '▦'].forEach(function (ic, k) { if (!lines[k]) return; var li = el('li'); li.appendChild(el('b', null, ic)); li.appendChild(el('span', null, lines[k])); rules.appendChild(li); });
      p.appendChild(rules);
      var a = el('div', 'cf-actions'), go = btn('cf-btn primary', tr('cafe.open'), function () { begin(i); });
      a.appendChild(go); a.appendChild(btn('cf-btn', tr('cafe.toBook'), showBook)); p.appendChild(a); go.focus({ preventScroll: true });
    }
    function showBook() {
      var s = load(), p = panel('cf-book');
      var head = el('div', 'cf-book-head'), ht = el('div'); heading(ht, tr('cafe.bookEyebrow'), tr('cafe.bookTitle')); ht.removeAttribute('aria-labelledby'); head.appendChild(ht);
      p.setAttribute('aria-labelledby', ht.querySelector('h2').id);
      var wallet = el('span', 'cf-wallet', s.coins + ' ◉'); wallet.setAttribute('aria-label', tr('cafe.coins') + ': ' + s.coins); head.appendChild(wallet); p.appendChild(head);
      var nd = nextDay(s), grid = el('ol', 'cf-days');
      DAYS.forEach(function (d, i) {
        var open = dayOpen(s, i), done = s.days[i] > 0;
        var b = btn('cf-day' + (done ? ' done' : '') + (i === nd ? ' next' : '') + (i === DAYS.length - 1 ? ' finale' : ''), null, function () { startDay(i); });
        b.disabled = !open;
        b.appendChild(el('span', 'cf-day-n', i === DAYS.length - 1 ? tr('cafe.navruz') : tr('cafe.dayN', { n: i + 1 })));
        b.appendChild(el('strong', null, tr('cafe.dayTitle.' + (i + 1))));
        var st = el('span', 'cf-day-stars'); for (var k = 0; k < 3; k++) st.appendChild(el('i', k < s.days[i] ? 'on' : null)); b.appendChild(st);
        b.setAttribute('aria-label', tr('cafe.dayN', { n: i + 1 }) + '. ' + tr('cafe.dayTitle.' + (i + 1)) + (done ? '. ' + tr('fish.starsN', { n: s.days[i] }) : open ? '' : '. ' + tr('cafe.locked')));
        var li = el('li'); li.appendChild(b); grid.appendChild(li);
      });
      p.appendChild(grid);
      var a = el('div', 'cf-actions');
      var cont = nd >= 0 ? btn('cf-btn primary', tr('cafe.playDay', { n: nd + 1 }), function () { startDay(nd); }) : btn('cf-btn primary', tr('cafe.freeShift'), function () { begin(-1); });
      a.appendChild(cont); a.appendChild(btn('cf-btn', tr('cafe.shop'), function () { showShop(showBook); }));
      if (nd >= 0 && s.days[0] > 0) a.appendChild(btn('cf-btn', tr('cafe.freeShift'), function () { begin(-1); }));
      p.appendChild(a);
      p.appendChild(btn('cf-link', tr('fish.backHub'), close));
      cont.focus({ preventScroll: true });
    }
    function showShop(back) {
      var s = load(), p = panel('cf-shop');
      heading(p, tr('cafe.shopEyebrow'), tr('cafe.shop'));
      var w = el('p', 'cf-walletline'); w.appendChild(el('span', null, tr('cafe.coins'))); w.appendChild(el('strong', null, s.coins + ' ◉')); p.appendChild(w);
      var list = el('div', 'cf-upgrades');
      Object.keys(UPGRADES).forEach(function (id) {
        var u = UPGRADES[id], owned = !!s.up[id], item = el('div', 'cf-upgrade' + (owned ? ' owned' : ''));
        var ic = el('span', 'cf-up-icon up-' + id); ic.setAttribute('aria-hidden', 'true'); item.appendChild(ic);
        var tx = el('div', 'cf-up-text'); tx.appendChild(el('strong', null, tr('cafe.up.' + id))); tx.appendChild(el('span', null, tr('cafe.up.' + id + 'Sub'))); item.appendChild(tx);
        var b = btn('cf-btn small', owned ? tr('cafe.owned') : tr('cafe.buy', { n: u.cost }), function () { var n = buy(load(), id); if (!n) return; save(n); decorate(); fx('chest'); showShop(back); var f = overlay.querySelector('[data-up="' + id + '"]'); if (f) f.focus(); });
        b.dataset.up = id; b.disabled = owned || s.coins < u.cost; item.appendChild(b); list.appendChild(item);
      });
      p.appendChild(list);
      p.appendChild(btn('cf-btn', tr('fish.back'), back));
    }
    function portrait(who, size) {
      var cv = el('canvas', 'cf-portrait'); cv.setAttribute('aria-hidden', 'true');
      var r = Math.min(2, window.devicePixelRatio || 1); cv.width = size * r; cv.height = size * r; cv.style.width = size + 'px'; cv.style.height = size + 'px';
      var c = cv.getContext('2d'); c.setTransform(r * size / 100, 0, 0, r * size / 100, 0, 0);
      var bg = { zuhra: ['#ffd9b0', '#c8602a'], ota: ['#ffd98a', '#e8a33a'], sova: ['#d8c8ff', '#4a3a7a'] }[who];
      var g = c.createRadialGradient(40, 35, 5, 50, 50, 55); g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
      c.fillStyle = g; c.beginPath(); c.arc(50, 50, 50, 0, 6.283); c.fill();
      c.save(); c.beginPath(); c.arc(50, 50, 50, 0, 6.283); c.clip();
      if (who === 'zuhra') {
        c.fillStyle = '#5f8f4a'; c.beginPath(); c.ellipse(50, 104, 44, 30, 0, Math.PI, 0); c.fill();
        c.fillStyle = '#9bbf6a'; c.beginPath(); c.arc(50, 54, 25, 0, 6.283); c.fill();
        c.fillStyle = '#c8402a'; c.beginPath(); c.arc(50, 50, 28, Math.PI * 1.02, Math.PI * 1.98); c.lineTo(80, 60); c.lineTo(20, 60); c.closePath(); c.fill();
        c.fillStyle = '#e8b04a'; for (var k = 0; k < 5; k++) { c.beginPath(); c.arc(30 + k * 10, 36 + Math.abs(k - 2) * 2, 2.2, 0, 6.283); c.fill(); }
        c.strokeStyle = '#3a2a1a'; c.lineWidth = 2; c.beginPath(); c.arc(41, 56, 6, 0, 6.283); c.stroke(); c.beginPath(); c.arc(59, 56, 6, 0, 6.283); c.stroke(); c.beginPath(); c.moveTo(47, 56); c.lineTo(53, 56); c.stroke();
        c.fillStyle = '#141a2e'; c.beginPath(); c.arc(41, 56, 2.2, 0, 6.283); c.arc(59, 56, 2.2, 0, 6.283); c.fill();
        c.strokeStyle = '#3a2a1a'; c.beginPath(); c.arc(50, 66, 6, 0.2, Math.PI - 0.2); c.stroke();
        c.fillStyle = 'rgba(255,120,120,.4)'; c.beginPath(); c.arc(33, 65, 4, 0, 6.283); c.arc(67, 65, 4, 0, 6.283); c.fill();
      } else if (who === 'ota') {
        c.fillStyle = '#1c2a52'; c.beginPath(); c.ellipse(50, 104, 34, 26, 0, 0, 6.283); c.fill();
        c.fillStyle = '#f4ede2'; c.fillRect(38, 82, 24, 20);
        c.fillStyle = '#b5794a'; c.beginPath(); c.arc(50, 52, 26, 0, 6.283); c.arc(30, 32, 8, 0, 6.283); c.arc(70, 32, 8, 0, 6.283); c.fill();
        c.fillStyle = '#ecd2ac'; c.beginPath(); c.ellipse(52, 62, 15, 11, 0, 0, 6.283); c.fill();
        c.fillStyle = '#2a1a12'; c.beginPath(); c.ellipse(53, 57, 4.5, 3.4, 0, 0, 6.283); c.fill();
        c.fillStyle = '#141a2e'; c.beginPath(); c.arc(41, 48, 3.4, 0, 6.283); c.arc(62, 47, 3.4, 0, 6.283); c.fill();
        c.fillStyle = '#e8a33a'; c.beginPath(); c.arc(50, 40, 25, Math.PI * 1.05, Math.PI * 1.95); c.fill();
        c.fillStyle = '#ffd27a'; c.beginPath(); c.arc(50, 13, 6, 0, 6.283); c.fill();
      } else {
        c.fillStyle = '#8a6a4a'; c.beginPath(); c.ellipse(50, 100, 34, 30, 0, 0, 6.283); c.fill(); c.beginPath(); c.arc(50, 58, 28, 0, 6.283); c.fill();
        c.fillStyle = '#fff6e2'; c.beginPath(); c.arc(38, 56, 11, 0, 6.283); c.arc(62, 56, 11, 0, 6.283); c.fill();
        c.fillStyle = '#141a2e'; c.beginPath(); c.arc(39, 57, 5, 0, 6.283); c.arc(61, 57, 5, 0, 6.283); c.fill();
        c.strokeStyle = '#e8b04a'; c.lineWidth = 2.4; c.beginPath(); c.arc(62, 56, 13, 0, 6.283); c.stroke();
        c.fillStyle = '#e8a33a'; c.beginPath(); c.moveTo(46, 66); c.lineTo(54, 66); c.lineTo(50, 75); c.fill();
        c.fillStyle = '#1a1a24'; c.fillRect(34, 14, 32, 18); c.fillRect(26, 30, 48, 4); c.fillStyle = '#c8402a'; c.fillRect(34, 26, 32, 4);
      }
      c.restore(); return cv;
    }

    /* ----- lifecycle ----- */
    function open() {
      var d = api.deck();
      if (!d || !makeOrder(d.cards)) { api.toast(tr('toast.needMatch'), 'err', 5000); return; }
      hub.hidden = true; stage.hidden = false; visible = true;
      var host = stage.closest('.screen'); if (host) host.classList.add('arcade-on');
      stage.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      ensureScene(function () {
        decorate(); if (scene3) scene3.setPaused(false); sizeScene();
        var s = load();
        if (!s.intro) { s.intro = true; save(s); dialog([{ who: 'zuhra', key: 'cafe.story.intro1' }, { who: 'ota', key: 'cafe.story.intro2' }, { who: 'zuhra', key: 'cafe.story.intro3' }], showBook); }
        else showBook();
      });
    }
    function close() {
      if (run) stopRun();
      visible = false; if (scene3) scene3.setPaused(true);
      stage.hidden = true; hub.hidden = false; overlay.hidden = true;
      var host = stage.closest('.screen'); if (host) host.classList.remove('arcade-on');
      refreshHub();
      var tile = hub.querySelector('[data-arcade="cafe"]'); if (tile) tile.focus({ preventScroll: true });
    }
    function refreshHub() {
      var s = load(), m = hub.querySelector('[data-cafe-meta]'), done = s.days.filter(Boolean).length;
      if (m) m.textContent = tr('cafe.hubMeta', { d: done, t: DAYS.length, c: s.coins });
    }
    if (window.ResizeObserver) new ResizeObserver(function () { if (visible) sizeScene(); }).observe(stage);
    doc.addEventListener('visibilitychange', function () { if (doc.hidden) holdOff(); if (scene3) scene3.setPaused(doc.hidden || !visible); });
    hub.addEventListener('click', function (e) { if (e.target.closest('[data-arcade="cafe"]')) open(); });
    // test hooks: serve the selected guest right (true) or wrong (false); finish a tea order perfectly
    window.cafeServe = function (right) { if (!run || sel == null || !orders[sel] || orders[sel].tea || orders[sel].serving) return false; var b = dishes.querySelector(right ? '[data-right="1"]' : '[data-right=""]:not(:disabled)'); if (!b) return false; b.click(); return true; };
    window.cafeTea = function () { if (!run || sel == null || !orders[sel] || !orders[sel].tea) return false; var o = orders[sel]; o.level = (teaBand(run.s.up)[0] + teaBand(run.s.up)[1]) / 2; finishTea(sel, o, 'perfect'); return true; };
    window.cafeState = function () { return run ? { seated: orders.filter(function (o) { return o && o.seated; }).length, sel: sel, tea: !!(sel != null && orders[sel] && orders[sel].tea), coins: run.coins, three: !!(scene3 && scene3.three) } : null; };
    refreshHub();
    return { refresh: refreshHub, leave: function () { if (!stage.hidden) close(); }, active: function () { return !!run; } };
  }

  return { DAYS: DAYS, FREE: FREE, UPGRADES: UPGRADES, DAY_SECONDS: DAY_SECONDS, makeOrder: makeOrder, coinsFor: coinsFor, patienceFor: patienceFor,
    pourRate: pourRate, teaBand: teaBand, teaResult: teaResult, teaCoins: teaCoins, stars: stars, spawnDelay: spawnDelay, seatCount: seatCount,
    defaults: defaults, clean: clean, dayOpen: dayOpen, nextDay: nextDay, buy: buy, mount: mount };
});
