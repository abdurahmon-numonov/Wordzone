/* «Разрежь слово» (v2.54): the second fast game of the Games screen.
   The top line names a meaning. Word tiles are tossed up from below; swipe through the one that means it.
   A tap or a number key also cuts a tile, so it works with a mouse and a keyboard too. Cutting a wrong tile, or
   letting the right one fall, costs a heart and shows the right pair. Three hearts, a combo multiplier, a pace that
   grows with every right cut, a best score and a one-tap restart. Every answer goes to the repetition schedule.
   The rules are pure and tested in Node (test/slice.js); the shared word rules come from «Взлёт» (soar.js).
   One canvas for the tiles, real DOM for the prompt, HUD and panels. No images, no libraries. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./soar.js').rules);
  else root.VMSlice = factory(root.VMSoar && root.VMSoar.rules);
})(typeof window !== 'undefined' ? window : this, function (S) {
  'use strict';

  /* ---------------- pure rules ---------------- */
  var HEARTS = 3, short = S.short, usable = S.usable, multiplier = S.multiplier, points = S.points;
  // Pace by the number of right cuts in this run: stronger gravity (a faster toss), a 4th tile later, tighter timing.
  function tuning(passed, slow) {
    var t = Math.min(1, passed / 25) * (slow ? 0.6 : 1);
    return {
      gravity: 1.15 + 0.75 * t,           // field heights per second²
      tiles: !slow && passed >= 8 ? 4 : 3, // tiles in one toss
      stagger: 0.42 - 0.2 * t              // seconds between tiles of one toss
    };
  }
  // One toss: the meaning to look for and the tiles (the right word plus different wrong ones), shuffled.
  function makeVolley(cards, recent, count, rng) {
    rng = rng || Math.random;
    var card = S.pickCard(cards, recent, rng), words = [short(card.original)], picked = [card];
    for (var tries = 0; words.length < count && tries < 40; tries++) {
      var d = S.pickDistractor(cards, card, rng);
      if (!d || picked.indexOf(d) >= 0) continue;
      var w = short(d.original);
      if (words.some(function (x) { return x.toLowerCase() === w.toLowerCase(); })) continue;
      picked.push(d); words.push(w);
    }
    if (words.length < 2) return null;
    var tiles = words.map(function (w, i) { return { word: w, right: i === 0 }; });
    for (var i = tiles.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = tiles[i]; tiles[i] = tiles[j]; tiles[j] = t; }
    tiles.forEach(function (t, k) { t.key = k + 1; });
    return { card: card, prompt: short(card.translation, 40), tiles: tiles };
  }
  // A launch from below the field: start x, horizontal and vertical speed so the top of the arc lands at `apex`.
  function launch(gravity, rng, slot, count) {
    rng = rng || Math.random;
    var lane = (slot + 0.5) / count, x = 0.12 + 0.76 * lane + (rng() - 0.5) * 0.08;
    var apex = 0.16 + (slot % 2 ? 0.2 : 0) + rng() * 0.08, y = 1.1; // neighbours top out at different heights
    var vy = -Math.sqrt(2 * gravity * (y - apex));
    var flight = 2 * -vy / gravity, drift = (0.5 - x) * 0.2 + (rng() - 0.5) * 0.1;
    return { x: x, y: y, vx: drift / flight, vy: vy, apex: apex };
  }
  // Does the blade segment (a→b) cross a box {x, y, w, h} (centre and size, pixels)? Sampled every few pixels.
  function segmentHits(a, b, box, pad) {
    pad = pad || 0;
    var dx = b.x - a.x, dy = b.y - a.y, n = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / 5));
    for (var i = 0; i <= n; i++) {
      var x = a.x + dx * i / n, y = a.y + dy * i / n;
      if (Math.abs(x - box.x) <= box.w / 2 + pad && Math.abs(y - box.y) <= box.h / 2 + pad) return true;
    }
    return false;
  }

  var rules = { HEARTS: HEARTS, tuning: tuning, makeVolley: makeVolley, launch: launch, segmentHits: segmentHits };

  /* ---------------- the game on the page ---------------- */
  function mount(api) {
    var host = document.getElementById('sliceStage');
    if (!host) return null;
    var tr = api.tr;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    var motionOff = function () { return (reduced && reduced.matches) || document.documentElement.dataset.motion === 'off'; };
    var store = (function () { try { return JSON.parse(localStorage.getItem('vm.slice') || '{}') || {}; } catch (e) { return {}; } })();
    var saveStore = function () { try { localStorage.setItem('vm.slice', JSON.stringify(store)); } catch (e) {} };

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function btn(cls, text) { var b = el('button', cls, text); b.type = 'button'; return b; }

    // ---- DOM (the HUD, prompt and panels share the look of «Взлёт»)
    host.textContent = '';
    var canvas = el('canvas', 'so-canvas sl-canvas'); canvas.setAttribute('role', 'img');
    var hud = el('div', 'so-hud');
    var hearts = el('span', 'so-hearts'), scoreEl = el('strong', 'so-score', '0'), comboEl = el('span', 'so-combo');
    var pauseBtn = btn('so-icon', '❚❚');
    var scoreWrap = el('span', 'so-score-wrap'); scoreWrap.append(scoreEl);
    hud.append(hearts, scoreWrap, comboEl, pauseBtn);
    var prompt = el('div', 'so-prompt'); prompt.setAttribute('aria-live', 'polite');
    var promptLabel = el('span', 'so-prompt-label'), promptWord = el('strong', 'so-prompt-word');
    prompt.append(promptLabel, promptWord);
    var banner = el('div', 'so-banner'); banner.setAttribute('aria-live', 'assertive'); banner.hidden = true;
    var hint = el('p', 'so-tap-hint'); hint.hidden = true;
    var keysLive = el('p', 'sl-sr'); keysLive.setAttribute('aria-live', 'polite'); // the words of a toss for screen readers
    var panel = el('div', 'so-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false');
    host.append(canvas, hud, prompt, banner, hint, keysLive, panel);
    var ctx = canvas.getContext('2d');

    // ---- state
    var W = 0, H = 0, FT = 0, dpr = 1, raf = 0, last = 0, visible = false;
    var g, parts = [], floats = [], halves = [], blade = [], shake = 0, dots = [];
    function resetRun() {
      var d = api.deck();
      g = { cards: usable(d && d.cards), mode: 'ready', hearts: HEARTS, score: 0, combo: 0, best: store.best || 0, passed: 0,
        right: 0, wrong: 0, missed: [], graded: [], recent: [], volley: null, tiles: [], queue: [], wait: 0, t: 0, slow: 0, newBest: false };
      parts = []; floats = []; halves = []; blade = []; shake = 0;
    }
    function size() {
      var r = host.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(280, Math.round(r.width)); H = Math.max(320, Math.round(r.height));
      FT = W < 600 ? 140 : 126; // the band under the prompt
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!dots.length) for (var i = 0; i < 40; i++) dots.push({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.4, p: Math.random() * 6 });
    }
    function fx(x) { return x * W; }
    function fy(y) { return FT + y * (H - FT); }

    // ---- HUD and panels
    function renderHud() {
      hearts.textContent = '';
      for (var i = 0; i < HEARTS; i++) hearts.appendChild(el('i', i < g.hearts ? 'on' : ''));
      hearts.setAttribute('aria-label', tr('soar.hearts', { n: g.hearts }));
      scoreEl.textContent = String(g.score);
      var m = multiplier(g.combo);
      comboEl.textContent = m > 1 ? '×' + m : ''; comboEl.classList.toggle('on', m > 1);
      pauseBtn.setAttribute('aria-label', tr(g.mode === 'paused' ? 'soar.resume' : 'soar.pause'));
      pauseBtn.title = pauseBtn.getAttribute('aria-label');
      hud.hidden = g.mode === 'ready' || g.mode === 'over';
      pauseBtn.hidden = !(g.mode === 'play' || g.mode === 'paused');
    }
    function setPrompt() {
      var v = g.volley;
      promptLabel.textContent = tr('slice.find');
      promptWord.textContent = v ? v.prompt : '';
      prompt.hidden = !v || g.mode === 'ready' || g.mode === 'over';
    }
    var bannerTimer = 0;
    function showBanner(text, kind) {
      banner.textContent = text; banner.className = 'so-banner ' + (kind || ''); banner.hidden = false;
      clearTimeout(bannerTimer); bannerTimer = setTimeout(function () { banner.hidden = true; }, kind === 'bad' ? 1700 : 700);
    }
    function panelReady() {
      panel.textContent = ''; panel.hidden = false; panel.className = 'so-panel ready';
      var h = el('h2', 'so-title', tr('slice.title')); h.id = 'slTitle'; panel.setAttribute('aria-labelledby', 'slTitle');
      var how = el('p', 'so-how', tr('slice.how'));
      var stats = el('p', 'so-best', g.best ? tr('soar.bestIs', { n: g.best }) : '');
      var play = btn('so-btn primary', tr('soar.play')); play.addEventListener('click', start);
      var row = el('div', 'so-row'); row.append(play);
      var slowWrap = el('label', 'so-slow'), slow = el('input'); slow.type = 'checkbox'; slow.checked = !!store.slow;
      slow.addEventListener('change', function () { store.slow = slow.checked; saveStore(); });
      slowWrap.append(slow, document.createTextNode(' ' + tr('soar.slow')));
      panel.append(h, how, row, slowWrap, stats);
      if (!g.cards || g.cards.length < 4) { play.disabled = true; how.textContent = tr('soar.need'); }
    }
    function panelPaused() {
      panel.textContent = ''; panel.hidden = false; panel.className = 'so-panel paused';
      var h = el('h2', 'so-title', tr('soar.paused')); h.id = 'slTitle'; panel.setAttribute('aria-labelledby', 'slTitle');
      var go = btn('so-btn primary', tr('soar.resume')); go.addEventListener('click', resume);
      var quit = btn('so-btn', tr('slice.end')); quit.addEventListener('click', function () { finish(); });
      var row = el('div', 'so-row'); row.append(go, quit);
      if (api.exit) { var out = btn('so-btn so-exit', tr('arcade.back')); out.addEventListener('click', api.exit); row.append(out); }
      panel.append(h, row); go.focus({ preventScroll: true });
    }
    function panelOver() {
      panel.textContent = ''; panel.hidden = false; panel.className = 'so-panel over' + (g.newBest ? ' record' : '');
      var h = el('h2', 'so-title', tr(g.newBest ? 'soar.newBest' : 'slice.over')); h.id = 'slTitle'; panel.setAttribute('aria-labelledby', 'slTitle');
      var big = el('p', 'so-final'); big.append(el('strong', '', String(g.score)), el('span', '', tr('soar.points')));
      panel.append(h, big, el('p', 'so-sum', tr('soar.summary', { r: g.right, w: g.wrong, b: Math.max(g.best, g.score) })));
      if (g.missed.length) {
        var list = el('ul', 'so-missed'); list.setAttribute('aria-label', tr('soar.review'));
        g.missed.slice(-5).forEach(function (c) { var li = el('li'); li.append(el('strong', '', short(c.original)), el('span', '', ' — ' + short(c.translation, 40))); list.appendChild(li); });
        panel.append(el('p', 'so-review', tr('soar.review')), list);
      }
      var again = btn('so-btn primary', tr('soar.again')); again.addEventListener('click', start);
      var row = el('div', 'so-row'); row.append(again);
      if (api.exit) { var out = btn('so-btn so-exit', tr('arcade.back')); out.addEventListener('click', api.exit); row.append(out); } // back to the game cards
      panel.append(row, el('p', 'so-keys', tr('soar.keys')));
      again.focus({ preventScroll: true });
    }

    // ---- flow
    function start() {
      resetRun();
      if (g.cards.length < 4) { panelReady(); return; }
      g.slow = store.slow ? 1 : 0;
      g.mode = 'play'; panel.hidden = true; banner.hidden = true;
      hint.textContent = tr('slice.tap'); hint.hidden = false;
      g.wait = 0.9; // a breath before the first toss
      renderHud(); setPrompt();
      store.plays = (store.plays || 0) + 1; saveStore();
      host.focus({ preventScroll: true });
      setTimeout(function () { // the whole field on screen, under the top bar and above the phone nav
        var rect = host.getBoundingClientRect();
        if (visible && (rect.top < 70 || rect.bottom > window.innerHeight - 70)) host.scrollIntoView({ block: 'center', behavior: 'instant' });
      }, 80);
      loop();
    }
    function pause() { if (g.mode !== 'play') return; g.mode = 'paused'; blade = []; renderHud(); panelPaused(); }
    function resume() { if (g.mode !== 'paused') return; g.mode = 'play'; panel.hidden = true; renderHud(); host.focus({ preventScroll: true }); last = 0; loop(); }
    function finish() {
      if (g.mode === 'over') return;
      g.mode = 'over'; g.overAt = Date.now(); blade = [];
      if (g.score > (store.best || 0)) { store.best = g.score; g.newBest = g.score > 0; }
      saveStore();
      if (g.right + g.wrong > 0 && api.complete) api.complete();
      if (api.fx) api.fx(g.newBest ? 'win' : 'lose');
      if (g.newBest) burst(W / 2, H * 0.35, 60, ['#ffd166', '#5ee6a8', '#ff8fab', '#8ecbff']);
      hint.hidden = true; g.volley = null; g.tiles = []; g.queue = []; setPrompt(); renderHud(); panelOver();
    }

    // ---- tosses
    function nextVolley() {
      var tune = tuning(g.passed, g.slow);
      var v = S && makeVolley(g.cards, g.recent, tune.tiles, Math.random);
      if (!v) { finish(); return; }
      g.volley = v; g.resolved = false;
      g.recent.push(v.card); if (g.recent.length > Math.min(4, g.cards.length - 2)) g.recent.shift();
      g.queue = v.tiles.map(function (t, i) { return { tile: t, at: i * tune.stagger }; });
      g.tiles = []; g.vt = 0;
      setPrompt();
      keysLive.textContent = v.tiles.map(function (t) { return t.key + ' ' + t.word; }).join(', ');
    }
    function tileBox(t) {
      var w = Math.max(96, t.tw + 52), h = 46;
      return { x: fx(t.x), y: fy(t.y), w: w, h: h };
    }
    function grade(card, ok) {
      if (!api.answer) return;
      var first = g.graded.indexOf(card) < 0;
      if (first) g.graded.push(card);
      api.answer(card, ok, first);
    }
    function cut(t, angle) {
      if (t.state !== 'fly' || g.mode !== 'play' || g.resolved) return;
      var v = g.volley, b = tileBox(t);
      t.state = 'cut';
      hint.hidden = true;
      halves.push({ word: t.word, x: b.x, y: b.y, w: b.w, h: b.h, vx: fx(t.vx), vy: (fy(t.y + t.vy * 0.1) - b.y) * 10, a: angle || 0, life: 1, ok: t.right });
      g.resolved = true;
      if (t.right) {
        g.combo++; g.passed++; g.right++;
        var pts = points(g.combo); g.score += pts;
        floats.push({ x: b.x, y: b.y - 30, text: '+' + pts + (multiplier(g.combo) > 1 ? ' ×' + multiplier(g.combo) : ''), life: 0.9 });
        burst(b.x, b.y, motionOff() ? 8 : 22, ['#5ee6a8', '#ffd166', '#ffffff']);
        if (api.fx) api.fx(g.combo % 5 === 0 ? 'crit' : 'ok');
        if (g.combo % 5 === 0) showBanner(tr('soar.streak', { n: g.combo }), 'ok');
        grade(v.card, true);
        scoreEl.classList.remove('bump'); void scoreEl.offsetWidth; scoreEl.classList.add('bump');
      } else {
        miss(t);
      }
      g.tiles.forEach(function (o) { if (o.state === 'fly') o.state = o.right && !t.right ? 'reveal' : 'fade'; });
      g.queue = [];
      renderHud();
    }
    function miss(t) {
      var v = g.volley;
      g.combo = 0; g.wrong++; g.hearts--;
      if (g.missed.indexOf(v.card) < 0) g.missed.push(v.card);
      if (!motionOff()) shake = 0.35;
      if (navigator.vibrate && !motionOff()) { try { navigator.vibrate(40); } catch (e) {} }
      if (api.fx) api.fx('bad');
      showBanner(tr('soar.wrong', { a: v.prompt, b: short(v.card.original) }), 'bad');
      if (t) burst(fx(t.x), fy(t.y), motionOff() ? 6 : 14, ['#ff6b6b', '#ffd9de']);
      grade(v.card, false);
      if (g.hearts <= 0) setTimeout(finish, 450);
    }

    // ---- particles
    function burst(x, y, n, colors) {
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, s = 80 + Math.random() * 220;
        parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.7, max: 0.7, c: colors[i % colors.length], r: 3 + Math.random() * 3, g: 1 });
      }
    }

    // ---- simulation
    function step(dt) {
      g.t += dt;
      if (g.mode !== 'play') return;
      if (!g.volley) { g.wait -= dt; if (g.wait <= 0) nextVolley(); return; }
      var tune = tuning(g.passed, g.slow), grav = tune.gravity;
      g.vt += dt;
      while (g.queue.length && g.queue[0].at <= g.vt) {
        var q = g.queue.shift(), L = launch(grav, Math.random, g.tiles.length, g.volley.tiles.length);
        ctx.font = fontFor();
        g.tiles.push({ word: q.tile.word, right: q.tile.right, key: q.tile.key, x: L.x, y: L.y, vx: L.vx, vy: L.vy, rot: (Math.random() - 0.5) * 0.2, spin: (Math.random() - 0.5) * 0.6, state: 'fly', alpha: 1, tw: ctx.measureText(q.tile.word).width });
      }
      g.tiles.forEach(function (t) {
        var k = t.state === 'fade' ? 1.6 : 1;
        t.vy += grav * k * dt; t.x += t.vx * dt; t.y += t.vy * dt; t.rot += t.spin * dt;
        if (t.state === 'fade' || t.state === 'reveal') t.alpha = Math.max(0, t.alpha - dt * (t.state === 'fade' ? 2.2 : 0.7));
        if (t.y > 1.15 && t.state === 'fly') { // fell back down uncut
          t.state = 'gone';
          if (t.right && !g.resolved) {
            g.resolved = true; miss(null);
            g.tiles.forEach(function (o) { if (o.state === 'fly') o.state = 'fade'; });
            g.queue = []; renderHud();
          }
        }
      });
      g.tiles = g.tiles.filter(function (t) { return t.state !== 'gone' && t.state !== 'cut' && t.alpha > 0.02 && t.y < 1.4; });
      if (!g.queue.length && !g.tiles.length && g.mode === 'play') { g.volley = null; g.wait = g.resolved ? 0.35 : 0.1; } // the prompt stays until the next toss
    }
    function stepFx(dt) {
      parts.forEach(function (q) { q.x += q.vx * dt; q.y += q.vy * dt; if (q.g) q.vy += 520 * dt; q.life -= dt; });
      parts = parts.filter(function (q) { return q.life > 0; });
      floats.forEach(function (f) { f.y -= 40 * dt; f.life -= dt; });
      floats = floats.filter(function (f) { return f.life > 0; });
      halves.forEach(function (h) { h.life -= dt * 1.4; h.vy += 900 * dt; h.y += h.vy * dt; h.x += h.vx * dt; h.sep = (h.sep || 0) + dt * 140; });
      halves = halves.filter(function (h) { return h.life > 0; });
      var now = performance.now();
      blade = blade.filter(function (p) { return now - p.t < 160; });
      shake = Math.max(0, shake - dt);
    }

    // ---- drawing
    function fontFor() { return '700 ' + Math.round(Math.max(15, Math.min(19, W / 40))) + 'px Inter, system-ui, sans-serif'; }
    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function drawTile(word, key, w, h, ok, alpha) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; roundRect(-w / 2 + 2, -h / 2 + 5, w, h, h / 2); ctx.fill();
      ctx.fillStyle = ok === true ? '#5ee6a8' : ok === false ? '#ffb3bd' : '#fff8e7'; roundRect(-w / 2, -h / 2, w, h, h / 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,209,102,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#1c2233'; ctx.font = fontFor(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(word, key ? 12 : 0, 1);
      if (key) { // the key badge, for the keyboard and for screen magnifier users
        ctx.fillStyle = '#1c2233'; ctx.beginPath(); ctx.arc(-w / 2 + 18, 0, 10, 0, 7); ctx.fill();
        ctx.fillStyle = '#ffd166'; ctx.font = '800 12px Inter, system-ui, sans-serif'; ctx.fillText(String(key), -w / 2 + 18, 1);
      }
      ctx.globalAlpha = 1;
    }
    function draw() {
      ctx.save();
      if (shake > 0) ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 10 * shake);
      var grd = ctx.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#1b2147'); grd.addColorStop(1, '#3a2f6b');
      ctx.fillStyle = grd; ctx.fillRect(-10, -10, W + 20, H + 20);
      var glow = ctx.createRadialGradient(W / 2, H * 1.05, 10, W / 2, H * 1.05, H * 0.7);
      glow.addColorStop(0, 'rgba(255,170,90,0.35)'); glow.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
      dots.forEach(function (d) { ctx.globalAlpha = 0.35 + 0.35 * Math.sin(g.t * 1.5 + d.p); ctx.fillStyle = '#ffffff'; ctx.fillRect(d.x * W, d.y * H, d.r, d.r); });
      ctx.globalAlpha = 1;
      // tiles in the air
      g.tiles.forEach(function (t) {
        var b = tileBox(t);
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(t.rot);
        drawTile(t.word, t.state === 'fly' ? t.key : 0, b.w, b.h, t.state === 'reveal' ? true : null, t.alpha);
        ctx.restore();
      });
      // cut halves: the tile splits along the blade and falls apart
      halves.forEach(function (h) {
        [-1, 1].forEach(function (side) {
          ctx.save(); ctx.translate(h.x + side * h.sep * 0.5, h.y + side * h.sep * 0.15); ctx.rotate(h.a + side * h.sep * 0.004);
          ctx.beginPath(); ctx.rect(side < 0 ? -h.w : 0, -h.h, h.w, h.h * 2); ctx.clip();
          drawTile(h.word, 0, h.w, h.h, h.ok, Math.max(0, h.life));
          ctx.restore();
        });
      });
      // the blade
      if (blade.length > 1) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (var i = 1; i < blade.length; i++) {
          var k = i / blade.length;
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 + 0.7 * k) + ')'; ctx.lineWidth = 2 + 6 * k;
          ctx.beginPath(); ctx.moveTo(blade[i - 1].x, blade[i - 1].y); ctx.lineTo(blade[i].x, blade[i].y); ctx.stroke();
        }
      }
      parts.forEach(function (q) { ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.c; ctx.fillRect(q.x, q.y, q.r, q.r); });
      ctx.globalAlpha = 1;
      floats.forEach(function (f) {
        ctx.globalAlpha = Math.min(1, f.life * 1.6); ctx.font = '800 20px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(28,34,51,0.6)'; ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = '#ffd166'; ctx.fillText(f.text, f.x, f.y);
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ---- loop: only while the Games screen shows this game and the tab is visible
    function frame(ts) {
      raf = 0;
      if (!visible || document.hidden) return;
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016; last = ts;
      if (g.mode !== 'paused') { step(dt); stepFx(dt); }
      draw();
      raf = requestAnimationFrame(frame);
    }
    function loop() { if (!raf && visible) { last = 0; raf = requestAnimationFrame(frame); } }

    // ---- input: a swipe cuts what it crosses; a tap cuts what it touches; keys 1–4 cut by the badge
    host.tabIndex = -1;
    var down = false;
    function at(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() }; }
    function sweep(a, b) {
      var hit = null;
      g.tiles.forEach(function (t) { if (!hit && t.state === 'fly' && segmentHits(a, b, tileBox(t), 6)) hit = t; });
      if (hit) cut(hit, Math.atan2(b.y - a.y, b.x - a.x) * 0.3);
    }
    host.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button, input, label, .so-panel')) return;
      if (g.mode !== 'play') return;
      e.preventDefault(); down = true;
      try { host.setPointerCapture(e.pointerId); } catch (err) {}
      var p = at(e); blade = [p]; sweep(p, p);
    });
    host.addEventListener('pointermove', function (e) {
      if (!down || g.mode !== 'play') return;
      var p = at(e), prev = blade[blade.length - 1] || p;
      blade.push(p); if (blade.length > 14) blade.shift();
      sweep(prev, p);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) { host.addEventListener(ev, function () { down = false; }); });
    document.addEventListener('keydown', function (e) {
      if (!visible) return;
      var t = e.target, typing = t && (t.tagName === 'INPUT' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (typing) return;
      if (g.mode === 'over' && (e.key === ' ' || e.key === 'Enter') && !(t && t.closest && t.closest('.so-exit'))) { e.preventDefault(); if (Date.now() - (g.overAt || 0) > 500) start(); return; }
      if (g.mode === 'play' && /^[1-4]$/.test(e.key)) {
        var n = +e.key, tile = null;
        g.tiles.forEach(function (o) { if (o.state === 'fly' && o.key === n) tile = o; });
        e.preventDefault();
        if (tile) cut(tile, 0.2);
        return;
      }
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (g.mode === 'play') { e.preventDefault(); e.stopPropagation(); pause(); }
        else if (g.mode === 'paused' && e.key !== 'Escape') { e.preventDefault(); resume(); }
      }
    });
    pauseBtn.addEventListener('click', function () { if (g.mode === 'play') pause(); else resume(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); else loop(); });
    window.addEventListener('blur', function () { pause(); });
    window.addEventListener('resize', function () { if (visible) size(); });

    resetRun(); size(); renderHud(); setPrompt(); panelReady();

    return {
      show: function () {
        visible = true; size();
        if (g.mode === 'ready') { resetRun(); panelReady(); }
        canvas.setAttribute('aria-label', tr('slice.canvas'));
        loop();
      },
      hide: function () { if (g.mode === 'play') pause(); visible = false; },
      start: start,
      // for tests: the run as plain data, and a way to cut the right (or a wrong) tile of the current toss
      _state: function () {
        return { mode: g.mode, score: g.score, hearts: g.hearts, combo: g.combo, right: g.right, wrong: g.wrong,
          prompt: g.volley && g.volley.prompt, inAir: g.tiles.filter(function (t) { return t.state === 'fly'; }).length,
          tiles: g.tiles.filter(function (t) { return t.state === 'fly'; }).map(function (t) { var b = tileBox(t); return { word: t.word, key: t.key, right: t.right, x: b.x, y: b.y }; }) };
      },
      _answer: function (ok) {
        if (g.mode !== 'play') return false;
        if (!g.volley || g.resolved) { g.tiles = []; g.queue = []; nextVolley(); } // a fresh toss
        var v = g.volley; if (!v) return false;
        while (g.queue.length) { // launch the rest of the toss at once
          var q = g.queue.shift(), L = launch(tuning(g.passed, g.slow).gravity, Math.random, g.tiles.length, v.tiles.length);
          ctx.font = fontFor();
          g.tiles.push({ word: q.tile.word, right: q.tile.right, key: q.tile.key, x: L.x, y: 0.5, vx: 0, vy: 0, rot: 0, spin: 0, state: 'fly', alpha: 1, tw: ctx.measureText(q.tile.word).width });
        }
        var tile = null;
        g.tiles.forEach(function (t) { if (!tile && t.state === 'fly' && t.right === !!ok) tile = t; });
        if (!tile) return false;
        cut(tile, 0);
        g.volley = null; g.tiles = []; g.queue = []; g.wait = 0.35;
        return true;
      }
    };
  }

  return { rules: rules, mount: mount };
});
