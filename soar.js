/* «Взлёт» (v2.53): one fast game over the learner's own words.
   A paper plane flies through walls with two gates. The top line names a meaning; one gate carries the word for it,
   the other a wrong one. Tap (or Space) to climb, fly through the right gate. The answer is the move itself, so
   there is no quiz screen between the playing and the learning. Three hearts, rising speed, a combo multiplier,
   a best score and a one-tap restart. A wrong gate costs a heart and shows the right pair for a moment; every
   answer goes to the learner's repetition schedule.
   The rules are pure and tested in Node (test/soar.js); mount() draws the flight on one canvas, with the prompt,
   HUD and panels as real DOM controls. No images, no libraries. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VMSoar = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  /* ---------------- pure rules ---------------- */
  var HEARTS = 3;
  // How fast and how tight the flight gets: by the number of right gates in this run (0…), eased, then capped.
  function tuning(passed, slow) {
    var t = Math.min(1, passed / 30) * (slow ? 0.7 : 1);
    return {
      speed: 0.19 + 0.13 * t,        // share of the field width per second
      gap: 0.25 - 0.06 * t,          // gate height, share of the field height
      spacing: 0.66 - 0.12 * t       // distance between walls, share of the field width
    };
  }
  function multiplier(combo) { return combo >= 10 ? 4 : combo >= 6 ? 3 : combo >= 3 ? 2 : 1; }
  function points(combo) { return 10 * multiplier(combo); }

  // The short form shown on a gate: the first meaning, trimmed.
  function short(text, max) {
    var s = String(text || '').split(/[;,(]/)[0].replace(/\s+/g, ' ').trim();
    max = max || 24;
    return s.length > max ? s.slice(0, max - 1).trim() + '…' : s;
  }
  function usable(cards) {
    return (cards || []).filter(function (c) { return c && c.original && c.translation && short(c.original) && short(c.translation); });
  }
  // Picks the next word: hard and due words come up more often, the last few words not at all.
  function pickCard(cards, recent, rng, now) {
    rng = rng || Math.random; now = now || Date.now();
    var pool = cards.filter(function (c) { return recent.indexOf(c) < 0; });
    if (!pool.length) pool = cards.slice();
    var weights = pool.map(function (c) { return 1 + ((c.fails || 0) > 0 ? 2 : 0) + (c.due && c.due <= now ? 1 : 0); });
    var sum = weights.reduce(function (a, b) { return a + b; }, 0), r = rng() * sum;
    for (var i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }
  // A wrong option that does not read like the right one; similar length looks less obvious.
  function pickDistractor(cards, card, rng) {
    rng = rng || Math.random;
    var right = short(card.original).toLowerCase();
    var others = cards.filter(function (c) { return c !== card && short(c.original).toLowerCase() !== right; });
    if (!others.length) return null;
    others.sort(function (a, b) { return Math.abs(short(a.original).length - right.length) - Math.abs(short(b.original).length - right.length); });
    var near = others.slice(0, Math.max(3, Math.ceil(others.length / 3)));
    return near[Math.floor(rng() * near.length)];
  }
  // One wall: the meaning to look for, two gates (top/bottom), which of them is right.
  function makeWall(cards, recent, rng) {
    rng = rng || Math.random;
    var card = pickCard(cards, recent, rng), wrong = pickDistractor(cards, card, rng);
    if (!wrong) return null;
    var rightTop = rng() < 0.5;
    return { card: card, prompt: short(card.translation, 40), top: short(rightTop ? card.original : wrong.original), bottom: short(rightTop ? wrong.original : card.original), right: rightTop ? 'top' : 'bottom', wrong: wrong };
  }
  // Where the two gates sit (shares of the field height): top gate centre, bottom gate centre, gate height.
  function gateLayout(gap, rng) {
    rng = rng || Math.random;
    var divider = 0.14, margin = 0.07;
    var span = 1 - 2 * margin - 2 * gap - divider; // free room to move the pair up and down
    var top = margin + gap / 2 + rng() * Math.max(0, span);
    return { top: top, bottom: top + gap + divider, gap: gap };
  }
  // Which gate a height (share of the field) is in, or null when it hits the wall.
  function gateAt(y, layout) {
    if (Math.abs(y - layout.top) <= layout.gap / 2) return 'top';
    if (Math.abs(y - layout.bottom) <= layout.gap / 2) return 'bottom';
    return null;
  }

  var rules = { HEARTS: HEARTS, tuning: tuning, multiplier: multiplier, points: points, short: short, usable: usable,
    pickCard: pickCard, pickDistractor: pickDistractor, makeWall: makeWall, gateLayout: gateLayout, gateAt: gateAt };

  /* ---------------- the game on the page ---------------- */
  function mount(api) {
    var host = document.getElementById('soarStage');
    if (!host) return null;
    var tr = api.tr;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    var motionOff = function () { return (reduced && reduced.matches) || document.documentElement.dataset.motion === 'off'; };
    var store = (function () { try { return JSON.parse(localStorage.getItem('vm.soar') || '{}') || {}; } catch (e) { return {}; } })();
    var saveStore = function () { try { localStorage.setItem('vm.soar', JSON.stringify(store)); } catch (e) {} };

    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function btn(cls, text) { var b = el('button', cls, text); b.type = 'button'; return b; }

    // ---- DOM: canvas, HUD, prompt, panels
    host.textContent = '';
    var canvas = el('canvas', 'so-canvas'); canvas.setAttribute('role', 'img');
    var hud = el('div', 'so-hud');
    var hearts = el('span', 'so-hearts'), scoreEl = el('strong', 'so-score', '0'), comboEl = el('span', 'so-combo');
    var pauseBtn = btn('so-icon so-pause', '❚❚');
    hud.append(hearts, el('span', 'so-score-wrap'), comboEl, pauseBtn);
    hud.children[1].append(scoreEl);
    var prompt = el('div', 'so-prompt'); prompt.setAttribute('aria-live', 'polite');
    var promptLabel = el('span', 'so-prompt-label'), promptWord = el('strong', 'so-prompt-word');
    prompt.append(promptLabel, promptWord);
    var banner = el('div', 'so-banner'); banner.setAttribute('aria-live', 'assertive'); banner.hidden = true;
    var panel = el('div', 'so-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false');
    var hint = el('p', 'so-tap-hint'); hint.hidden = true;
    host.append(canvas, hud, prompt, banner, hint, panel);
    var ctx = canvas.getContext('2d');

    // ---- state
    var W = 0, H = 0, FT = 0, dpr = 1, raf = 0, last = 0, running = false, visible = false;
    var g; // the current run
    var parts = [], floats = [], clouds = [], hills = [], shake = 0;
    function resetRun() {
      var d = api.deck(), cards = usable(d && d.cards);
      g = { cards: cards, deckKey: d, mode: 'ready', plane: { y: 0.45, vy: 0, inv: 0, tilt: 0 }, walls: [], recent: [], hearts: HEARTS,
        score: 0, combo: 0, best: store.best || 0, passed: 0, right: 0, wrong: 0, missed: [], graded: [], t: 0, slow: 0, newBest: false, trail: [] };
      parts = []; floats = []; shake = 0;
    }
    function size() {
      var r = host.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(280, Math.round(r.width)); H = Math.max(320, Math.round(r.height));
      FT = W < 600 ? 140 : 126; // the band under the prompt; the flight field starts below it so words never hide behind it
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!clouds.length) for (var i = 0; i < 6; i++) clouds.push({ x: Math.random(), y: 0.08 + Math.random() * 0.5, s: 0.6 + Math.random() * 0.9, v: 0.012 + Math.random() * 0.02 });
      if (!hills.length) for (var j = 0; j < 7; j++) hills.push({ x: j / 6, h: 0.08 + Math.random() * 0.07 });
    }

    function fy(y) { return FT + y * (H - FT); } // a height in the field (0–1) to canvas pixels

    // ---- HUD and panels
    function renderHud() {
      hearts.textContent = '';
      for (var i = 0; i < HEARTS; i++) hearts.appendChild(el('i', i < g.hearts ? 'on' : ''));
      hearts.setAttribute('aria-label', tr('soar.hearts', { n: g.hearts }));
      scoreEl.textContent = String(g.score);
      var m = multiplier(g.combo);
      comboEl.textContent = m > 1 ? '×' + m : '';
      comboEl.classList.toggle('on', m > 1);
      pauseBtn.setAttribute('aria-label', tr(g.mode === 'paused' ? 'soar.resume' : 'soar.pause'));
      pauseBtn.title = pauseBtn.getAttribute('aria-label');
      hud.hidden = g.mode === 'ready' || g.mode === 'over';
      pauseBtn.hidden = !(g.mode === 'play' || g.mode === 'paused');
    }
    function setPrompt(wall) {
      promptLabel.textContent = tr('soar.find');
      promptWord.textContent = wall ? wall.prompt : '';
      prompt.hidden = !wall || g.mode === 'ready' || g.mode === 'over';
    }
    var bannerTimer = 0;
    function showBanner(text, kind) {
      banner.textContent = text; banner.className = 'so-banner ' + (kind || ''); banner.hidden = false;
      clearTimeout(bannerTimer); bannerTimer = setTimeout(function () { banner.hidden = true; }, kind === 'bad' ? 1700 : 700);
    }
    function panelReady() {
      panel.textContent = ''; panel.hidden = false; panel.className = 'so-panel ready';
      panel.setAttribute('aria-labelledby', 'soTitle');
      var h = el('h2', 'so-title', tr('soar.title')); h.id = 'soTitle';
      var how = el('p', 'so-how', tr('soar.how'));
      var stats = el('p', 'so-best');
      stats.textContent = g.best ? tr('soar.bestIs', { n: g.best }) : '';
      var play = btn('so-btn primary', tr('soar.play'));
      play.addEventListener('click', start);
      var row = el('div', 'so-row'); row.append(play);
      var slowWrap = el('label', 'so-slow');
      var slow = el('input'); slow.type = 'checkbox'; slow.checked = !!store.slow;
      slow.addEventListener('change', function () { store.slow = slow.checked; saveStore(); });
      slowWrap.append(slow, document.createTextNode(' ' + tr('soar.slow')));
      panel.append(h, how, row, slowWrap, stats);
      if (!g.cards || g.cards.length < 4) { play.disabled = true; how.textContent = tr('soar.need'); }
      return play;
    }
    function panelPaused() {
      panel.textContent = ''; panel.hidden = false; panel.className = 'so-panel paused';
      var h = el('h2', 'so-title', tr('soar.paused')); h.id = 'soTitle'; panel.setAttribute('aria-labelledby', 'soTitle');
      var go = btn('so-btn primary', tr('soar.resume')); go.addEventListener('click', resume);
      var quit = btn('so-btn', tr('soar.end')); quit.addEventListener('click', function () { finish(); });
      var row = el('div', 'so-row'); row.append(go, quit);
      panel.append(h, row);
      go.focus({ preventScroll: true });
    }
    function panelOver() {
      panel.textContent = ''; panel.hidden = false; panel.className = 'so-panel over' + (g.newBest ? ' record' : '');
      var h = el('h2', 'so-title', tr(g.newBest ? 'soar.newBest' : 'soar.over')); h.id = 'soTitle'; panel.setAttribute('aria-labelledby', 'soTitle');
      var big = el('p', 'so-final'); big.append(el('strong', '', String(g.score)), el('span', '', tr('soar.points')));
      var sub = el('p', 'so-sum', tr('soar.summary', { r: g.right, w: g.wrong, b: Math.max(g.best, g.score) }));
      panel.append(h, big, sub);
      if (g.missed.length) {
        var list = el('ul', 'so-missed');
        list.setAttribute('aria-label', tr('soar.review'));
        g.missed.slice(-5).forEach(function (c) { var li = el('li'); li.append(el('strong', '', short(c.original)), el('span', '', ' — ' + short(c.translation, 40))); list.appendChild(li); });
        panel.append(el('p', 'so-review', tr('soar.review')), list);
      }
      var again = btn('so-btn primary', tr('soar.again')); again.addEventListener('click', start);
      var row = el('div', 'so-row'); row.append(again);
      panel.append(row, el('p', 'so-keys', tr('soar.keys')));
      again.focus({ preventScroll: true });
    }

    // ---- flow
    function start() {
      resetRun();
      if (g.cards.length < 4) { panelReady(); return; }
      g.slow = store.slow ? 1 : 0;
      g.mode = 'play'; panel.hidden = true; banner.hidden = true;
      hint.textContent = tr('soar.tap'); hint.hidden = false;
      g.waiting = true; // the plane hovers until the first tap
      g.walls = []; spawnWall(W + 30);
      renderHud(); setPrompt(nextWall());
      store.plays = (store.plays || 0) + 1; saveStore();
      host.focus({ preventScroll: true });
      setTimeout(function () { // bring the whole field on screen, under the top bar and above the phone nav (after the tap settles)
        var rect = host.getBoundingClientRect();
        if (visible && (rect.top < 70 || rect.bottom > window.innerHeight - 70)) host.scrollIntoView({ block: 'center', behavior: 'instant' });
      }, 80);
      loop();
    }
    function pause() { if (g.mode !== 'play') return; g.mode = 'paused'; renderHud(); panelPaused(); }
    function resume() { if (g.mode !== 'paused') return; g.mode = 'play'; panel.hidden = true; renderHud(); host.focus({ preventScroll: true }); last = 0; loop(); }
    function finish() {
      if (g.mode === 'over') return;
      g.mode = 'over';
      if (g.score > (store.best || 0)) { store.best = g.score; g.newBest = g.score > 0; }
      saveStore();
      if (g.right + g.wrong > 0 && api.complete) api.complete();
      if (api.fx) api.fx(g.newBest ? 'win' : 'lose');
      if (g.newBest) burst(W / 2, H * 0.3, 60, ['#ffd166', '#5ee6a8', '#ff8fab', '#8ecbff']);
      hint.hidden = true; setPrompt(null); renderHud(); panelOver();
    }
    function flap() {
      if (g.mode !== 'play') return;
      if (g.waiting) { g.waiting = false; hint.hidden = true; }
      g.plane.vy = -0.62;
      for (var i = 0; i < 4; i++) parts.push({ x: W * 0.28 - 14, y: fy(g.plane.y) + 4, vx: -60 - Math.random() * 60, vy: 30 + Math.random() * 40, life: 0.35, max: 0.35, c: '#ffffffaa', r: 2 });
    }

    // ---- walls
    function nextWall() { for (var i = 0; i < g.walls.length; i++) if (!g.walls[i].done) return g.walls[i]; return null; }
    function spawnWall(x) {
      var w = makeWall(g.cards, g.recent, Math.random);
      if (!w) return;
      var tune = tuning(g.passed, g.slow);
      w.x = x; w.layout = gateLayout(tune.gap, Math.random); w.done = false; w.flash = 0; w.result = '';
      g.walls.push(w);
      g.recent.push(w.card); if (g.recent.length > Math.min(4, g.cards.length - 2)) g.recent.shift();
    }
    function wallWidth() { return Math.max(46, Math.min(70, W * 0.07)); }

    // ---- judging a wall
    function grade(card, ok) {
      if (!api.answer) return;
      var first = g.graded.indexOf(card) < 0;
      if (first) g.graded.push(card);
      api.answer(card, ok, first); // the schedule moves once per word per run; every answer counts for the day
    }
    function judge(w) {
      w.done = true;
      var y = g.plane.y, at = gateAt(y, w.layout);
      if (at === w.right) {
        g.combo++; g.passed++; g.right++;
        var pts = points(g.combo); g.score += pts;
        w.result = 'ok'; w.flash = 1;
        floats.push({ x: W * 0.28 + 24, y: fy(y) - 18, text: '+' + pts + (multiplier(g.combo) > 1 ? ' ×' + multiplier(g.combo) : ''), life: 0.9 });
        burst(w.x + wallWidth() / 2, fy(at === 'top' ? w.layout.top : w.layout.bottom), motionOff() ? 6 : 16, ['#5ee6a8', '#ffd166', '#ffffff']);
        if (api.fx) api.fx(g.combo > 0 && g.combo % 5 === 0 ? 'crit' : 'ok');
        if (g.combo % 5 === 0) showBanner(tr('soar.streak', { n: g.combo }), 'ok');
        grade(w.card, true);
        scoreEl.classList.remove('bump'); void scoreEl.offsetWidth; scoreEl.classList.add('bump');
      } else {
        miss(w, at ? 'gate' : 'wall');
      }
      renderHud();
      setPrompt(nextWall());
    }
    function miss(w, how) {
      g.combo = 0; g.wrong++; g.hearts--;
      if (g.missed.indexOf(w.card) < 0) g.missed.push(w.card);
      w.result = 'bad'; w.flash = 1;
      g.passed = Math.max(0, g.passed - 3); // a mistake eases the pace a little
      g.plane.inv = 1.2;
      if (!motionOff()) shake = 0.35;
      if (navigator.vibrate && !motionOff()) { try { navigator.vibrate(40); } catch (e) {} }
      if (api.fx) api.fx('bad');
      showBanner(tr('soar.wrong', { a: w.prompt, b: short(w.card.original) }), 'bad');
      grade(w.card, false);
      if (g.hearts <= 0) setTimeout(finish, 450);
    }
    function crashGround() {
      if (g.plane.inv > 0) { g.plane.vy = -0.55; return; }
      g.combo = 0; g.hearts--; g.plane.inv = 1.2; g.plane.vy = -0.62;
      if (!motionOff()) shake = 0.3;
      if (api.fx) api.fx('hit');
      showBanner(tr('soar.ground'), 'bad');
      renderHud();
      if (g.hearts <= 0) setTimeout(finish, 450);
    }

    // ---- particles
    function burst(x, y, n, colors) {
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 220;
        parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.7 + Math.random() * 0.5, max: 1.2, c: colors[i % colors.length], r: 2 + Math.random() * 3, g: 1 });
      }
    }

    // ---- simulation step (dt in seconds)
    function step(dt) {
      g.t += dt;
      var tune = tuning(g.passed, g.slow), speed = tune.speed * W, ww = wallWidth(), px = W * 0.28;
      clouds.forEach(function (c) { c.x -= c.v * dt * (g.mode === 'play' ? 1.6 : 0.6); if (c.x < -0.2) { c.x = 1.15; c.y = 0.08 + Math.random() * 0.5; } });
      hills.forEach(function (h) { h.x -= dt * (g.mode === 'play' && !g.waiting ? tune.speed * 0.25 : 0.01); if (h.x < -0.2) h.x += 1.4; });
      if (g.mode !== 'play') { g.plane.y = 0.45 + Math.sin(g.t * 2) * 0.02; return; }
      var p = g.plane;
      if (g.waiting) { p.y = 0.45 + Math.sin(g.t * 3) * 0.02; p.vy = 0; }
      else {
        p.vy = Math.min(1.05, p.vy + 1.75 * dt); // gravity, in field heights per second²
        p.y += p.vy * dt;
        if (p.y < 0.04) { p.y = 0.04; p.vy = Math.max(0, p.vy); }
        if (p.y > 0.93) { p.y = 0.93; crashGround(); }
        g.walls.forEach(function (w) { w.x -= speed * dt; });
        // the wall at the plane: judge it once the plane is half way through
        g.walls.forEach(function (w) {
          if (w.done || g.mode !== 'play') return;
          if (px + 10 >= w.x && px - 10 <= w.x + ww) {
            if (!gateAt(p.y, w.layout) && p.inv <= 0) { judge(w); return; } // hit the wall itself
          }
          if (px >= w.x + ww / 2) judge(w);
        });
        g.walls = g.walls.filter(function (w) { return w.x + ww > -40; });
        var lastWall = g.walls[g.walls.length - 1];
        if (!lastWall || lastWall.x < W + 30 - tune.spacing * W) spawnWall(W + 30);
      }
      p.inv = Math.max(0, p.inv - dt);
      p.tilt += ((g.waiting ? 0 : Math.max(-0.5, Math.min(0.9, p.vy * 1.1))) - p.tilt) * Math.min(1, dt * 10);
      g.trail.push({ x: px - 16, y: fy(p.y) + 3 }); if (g.trail.length > 14) g.trail.shift();
      g.trail.forEach(function (t) { t.x -= speed * dt; });
    }
    function stepFx(dt) {
      parts.forEach(function (q) { q.x += q.vx * dt; q.y += q.vy * dt; if (q.g) q.vy += 420 * dt; q.life -= dt; });
      parts = parts.filter(function (q) { return q.life > 0; });
      floats.forEach(function (f) { f.y -= 40 * dt; f.life -= dt; });
      floats = floats.filter(function (f) { return f.life > 0; });
      g.walls.forEach(function (w) { w.flash = Math.max(0, w.flash - dt * 2.2); });
      shake = Math.max(0, shake - dt);
    }

    // ---- drawing
    function skyColors() {
      var phase = Math.min(1, g.score / 600); // day → evening as the score grows
      return phase < 0.5 ? ['#bfe3ff', '#eaf6ff'] : phase < 0.85 ? ['#ffb48a', '#ffe2c4'] : ['#2b2d5c', '#5a4a8a'];
    }
    function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function draw() {
      var sky = skyColors(), night = sky[0] === '#2b2d5c';
      ctx.save();
      if (shake > 0) ctx.translate((Math.random() - 0.5) * 10 * shake, (Math.random() - 0.5) * 10 * shake);
      var grd = ctx.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, sky[0]); grd.addColorStop(1, sky[1]);
      ctx.fillStyle = grd; ctx.fillRect(-10, -10, W + 20, H + 20);
      if (night) { ctx.fillStyle = '#ffffffaa'; for (var s = 0; s < 30; s++) ctx.fillRect((s * 97) % W, (s * 53) % (H * 0.6), 1.5, 1.5); }
      // clouds
      ctx.fillStyle = night ? '#ffffff22' : '#ffffffcc';
      clouds.forEach(function (c) { var x = c.x * W, y = c.y * H, r = 18 * c.s; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.arc(x + r, y - r * 0.4, r * 1.2, 0, 7); ctx.arc(x + r * 2.1, y, r * 0.9, 0, 7); ctx.fill(); });
      // hills
      ctx.fillStyle = night ? '#1d2048' : '#9fd3a8';
      ctx.beginPath(); ctx.moveTo(0, H);
      hills.slice().sort(function (a, b) { return a.x - b.x; }).forEach(function (h) { ctx.quadraticCurveTo(h.x * W, H - h.h * H * 2.2, h.x * W + W * 0.12, H - h.h * H * 0.6); });
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      ctx.fillStyle = night ? '#151838' : '#7cc08a'; ctx.fillRect(0, fy(0.955), W, H);
      // walls
      var ww = wallWidth();
      g.walls.forEach(function (w) {
        var L = w.layout, t1 = fy(L.top - L.gap / 2), b1 = fy(L.top + L.gap / 2), t2 = fy(L.bottom - L.gap / 2), b2 = fy(L.bottom + L.gap / 2);
        var col = night ? '#3c3f7a' : '#4a5a8c', edge = night ? '#585cb0' : '#6577b0';
        ctx.fillStyle = col;
        roundRect(w.x, -12, ww, t1 + 12, 10); ctx.fill();
        roundRect(w.x, b1, ww, t2 - b1, 10); ctx.fill();
        roundRect(w.x, b2, ww, H - b2 + 12, 10); ctx.fill();
        ctx.fillStyle = edge;
        [t1 - 10, b1, t2 - 10, b2].forEach(function (yy) { roundRect(w.x - 4, yy, ww + 8, 10, 5); ctx.fill(); });
        // the result flash on the chosen gate
        if (w.flash > 0 && w.result) {
          ctx.fillStyle = (w.result === 'ok' ? 'rgba(94,230,168,' : 'rgba(255,107,107,') + (0.45 * w.flash) + ')';
          ctx.fillRect(w.x - 4, 0, ww + 8, H);
        }
        // the two words
        [['top', L.top], ['bottom', L.bottom]].forEach(function (pair) {
          var text = w[pair[0]], y = fy(pair[1]);
          ctx.font = '600 ' + Math.round(Math.max(13, Math.min(17, W / 46))) + 'px Inter, system-ui, sans-serif';
          var tw = ctx.measureText(text).width, bw = tw + 22, bh = 30, bx = w.x + ww / 2 - bw / 2, by = y - bh / 2;
          var reveal = w.done && w.result === 'bad' && pair[0] === w.right;
          ctx.fillStyle = reveal ? '#5ee6a8' : 'rgba(255,255,255,0.94)';
          roundRect(bx, by, bw, bh, 15); ctx.fill();
          ctx.strokeStyle = 'rgba(28,34,51,0.12)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = '#1c2233'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(text, bx + bw / 2, by + bh / 2 + 1);
        });
      });
      // trail and plane
      var px = W * 0.28, py = fy(g.plane.y);
      g.trail.forEach(function (t, i) { ctx.fillStyle = 'rgba(255,255,255,' + (i / g.trail.length * 0.5) + ')'; ctx.beginPath(); ctx.arc(t.x, t.y, 2 + i / 6, 0, 7); ctx.fill(); });
      if (!(g.plane.inv > 0 && Math.floor(g.t * 12) % 2)) {
        ctx.save(); ctx.translate(px, py); ctx.rotate(g.plane.tilt * 0.6);
        ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1c2233'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-18, -13); ctx.lineTo(-10, 0); ctx.lineTo(-18, 13); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#dfe6f5'; ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(-10, 0); ctx.lineTo(-18, 13); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e8b04b'; ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-16, -4); ctx.lineTo(-16, 4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      // particles and floating points
      parts.forEach(function (q) { ctx.globalAlpha = Math.max(0, q.life / q.max); ctx.fillStyle = q.c; ctx.fillRect(q.x, q.y, q.r, q.r); });
      ctx.globalAlpha = 1;
      floats.forEach(function (f) {
        ctx.globalAlpha = Math.min(1, f.life * 1.6); ctx.font = '800 18px Inter, system-ui, sans-serif'; ctx.textAlign = 'left';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(28,34,51,0.55)'; ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = '#ffd166'; ctx.fillText(f.text, f.x, f.y);
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ---- loop: runs only while the Games screen is visible and the tab is shown
    function frame(ts) {
      raf = 0;
      if (!visible || document.hidden) { running = false; return; }
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016; last = ts;
      if (g.mode !== 'paused') { step(dt); stepFx(dt); }
      draw();
      running = true;
      raf = requestAnimationFrame(frame);
    }
    function loop() { if (!raf && visible) { last = 0; raf = requestAnimationFrame(frame); } }

    // ---- input
    host.tabIndex = -1;
    host.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button, input, label, .so-panel')) return;
      if (g.mode === 'play') { e.preventDefault(); flap(); }
    });
    document.addEventListener('keydown', function (e) {
      if (!visible) return;
      var t = e.target, typing = t && (t.tagName === 'INPUT' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (typing) return;
      if (g.mode === 'play' && (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W')) { e.preventDefault(); flap(); return; }
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (g.mode === 'play') { e.preventDefault(); e.stopPropagation(); pause(); }
        else if (g.mode === 'paused' && e.key !== 'Escape') { e.preventDefault(); resume(); }
      }
    });
    pauseBtn.addEventListener('click', function () { if (g.mode === 'play') pause(); else resume(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) pause(); else loop(); });
    window.addEventListener('blur', function () { pause(); });
    window.addEventListener('resize', function () { if (visible) size(); });

    resetRun(); size(); renderHud(); setPrompt(null); panelReady();
    canvas.setAttribute('aria-label', tr('soar.canvas'));

    return {
      // the Games screen opened or the deck changed
      show: function () {
        visible = true; size();
        if (g.mode === 'ready') { resetRun(); panelReady(); } // picks up a deck chosen meanwhile
        canvas.setAttribute('aria-label', tr('soar.canvas'));
        loop();
      },
      hide: function () { if (g.mode === 'play') pause(); visible = false; },
      refresh: function () { if (g.mode === 'ready') { resetRun(); panelReady(); } },
      start: start,
      // for tests: the run as plain data, and a way to answer the next wall
      _state: function () {
        var w = nextWall();
        return { mode: g.mode, score: g.score, hearts: g.hearts, combo: g.combo, right: g.right, wrong: g.wrong, prompt: w && w.prompt, rightGate: w && w.right,
          planeY: g.plane.y, targetY: w ? (w.right === 'top' ? w.layout.top : w.layout.bottom) : null, wallX: w ? w.x / W : null };
      },
      _answer: function (ok) {
        if (g.mode !== 'play') return false;
        var w = nextWall(); if (!w) { spawnWall(W * 0.3); w = nextWall(); } if (!w) return false;
        if (g.waiting) { g.waiting = false; hint.hidden = true; }
        var gate = ok ? w.right : (w.right === 'top' ? 'bottom' : 'top');
        g.plane.y = gate === 'top' ? w.layout.top : w.layout.bottom; g.plane.vy = 0; g.plane.inv = 0;
        judge(w); return true;
      }
    };
  }

  return { rules: rules, mount: mount };
});
