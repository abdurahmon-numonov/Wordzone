/* Step-by-step introduction, the way games do it.
   1. Sections "open up" as the learner progresses: after the first finished practice, Progress and Games get a
      "new" dot and a short announcement; after the second, Grammar and Test. Nothing is ever locked.
   2. The first time someone enters a section, one or two small bubbles point at what matters there.
   Every bubble is shown once, never during typing or over a dialog, and can be switched off in Settings. */
(function () {
  'use strict';
  var KEY = 'vm.tips';
  var STAGES = [{ at: 1, items: ['progress', 'games'] }, { at: 2, items: ['grammar', 'test'] }];
  var ITEMS = {
    progress: { nav: 'navProgress', tab: 'tabProgress', screen: 'screen-progress' },
    games: { nav: 'navGames', tab: 'tabMore', screen: 'screen-games' },
    grammar: { nav: 'navGrammar', tab: 'tabMore', screen: 'screen-grammar' },
    test: { nav: 'navTest', tab: 'tabMore', screen: 'screen-test' }
  };
  // What to point at on the first visit of each screen (the first visible element of each list is used).
  var SCREENS = {
    'screen-library': [{ el: ['#libraryGrid .actions', '#libraryGrid > :first-child'], k: 'lib1' }, { el: ['#tabVault'], k: 'lib2' }],
    'screen-progress': [{ el: ['#progTiles'], k: 'prog1' }],
    'screen-grammar': [{ el: ['#tabCourse'], k: 'gram1' }, { el: ['#tabWords'], k: 'gram2' }],
    'screen-games': [{ el: ['#screen-games .deck-bar', '#arcadeHub > :first-child'], k: 'games1' }],
    'screen-test': [{ el: ['#btnQuizStart', '#btnMatchStart'], k: 'test1' }, { el: ['#trainers'], k: 'test2' }],
    'screen-train': [{ el: ['#card'], k: 'train1' }]
  };

  var I18N = window.VMI18n;
  function tr(k, v) { return I18N ? I18N.t(k, v) : k; }
  var st = load();
  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.v === 1) return s; } catch (e) {}
    return null;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function fresh(experienced) {
    var s = { v: 1, on: true, seen: {}, sessions: 0, announced: {}, visited: {} };
    if (experienced) { // someone who already practised: everything counts as open, no "new" dots, no announcements
      s.sessions = STAGES[STAGES.length - 1].at;
      STAGES.forEach(function (g) { s.announced[g.at] = 1; g.items.forEach(function (i) { s.visited[i] = 1; }); });
    }
    return s;
  }

  // Automated browsers (tests) never see bubbles unless a test asks for them.
  var auto = navigator.webdriver && (function () { try { return localStorage.getItem('vm.tips.force') !== '1'; } catch (e) { return true; } })();
  var reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function $(sel) { return document.querySelector(sel); }
  function visible(el) {
    if (!el) return false;
    var r = el.getClientRects();
    return r.length > 0 && r[0].width > 0 && r[0].height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }
  function firstVisible(list) { for (var i = 0; i < list.length; i++) { var el = $(list[i]); if (visible(el)) return el; } return null; }
  function blocked() {
    if (auto || !st || !st.on || document.hidden) return true;
    var onb = document.getElementById('onboarding');
    if (onb && !onb.hidden) return true;
    if (document.querySelector('dialog[open], .overlay:not([hidden]), #summary:not([hidden]), .theme-pop:not([hidden])')) return true;
    if (document.body.classList.contains('side-open')) return true;
    var a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /text|search|email|url|number/.test(a.type)))) return true; // never while typing
    return false;
  }
  function unlocked(item) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].items.indexOf(item) >= 0) return st.sessions >= STAGES[i].at;
    return true;
  }

  /* ---------- "new" dots on the navigation ---------- */
  function dot(host, on) {
    if (!host) return;
    var d = host.querySelector('.new-dot');
    if (on && !d) {
      d = document.createElement('span'); d.className = 'new-dot';
      d.appendChild(Object.assign(document.createElement('span'), { className: 'sr-only', textContent: ' · ' + tr('tips.newBadge') }));
      host.appendChild(d);
    } else if (!on && d) d.remove();
    if (d) d.querySelector('.sr-only').textContent = ' · ' + tr('tips.newBadge');
  }
  function refreshDots() {
    if (!st) return;
    var more = false;
    Object.keys(ITEMS).forEach(function (k) {
      var on = st.on !== false && unlocked(k) && !st.visited[k];
      dot(document.getElementById(ITEMS[k].nav), on);
      if (ITEMS[k].tab === 'tabProgress') dot(document.getElementById('tabProgress'), on);
      else if (on) more = true;
    });
    dot(document.getElementById('tabMore'), more);
  }

  /* ---------- the bubble ---------- */
  var tip = null, ring = null, queue = [], step = 0, anchor = null, back = null, timer = 0, kind = 'tip', doneKey = null;
  function build() {
    tip = document.createElement('div');
    tip.className = 'coach'; tip.hidden = true;
    tip.setAttribute('role', 'dialog'); tip.setAttribute('aria-modal', 'false');
    tip.setAttribute('aria-labelledby', 'coachTitle'); tip.setAttribute('aria-describedby', 'coachText');
    tip.innerHTML = '<p class="coach-kicker" id="coachKicker"></p><h2 class="coach-title" id="coachTitle"></h2><p class="coach-text" id="coachText"></p>' +
      '<div class="coach-foot"><span class="coach-dots" aria-hidden="true"></span><span class="sr-only" id="coachCount"></span>' +
      '<button type="button" class="coach-skip"></button><button type="button" class="coach-next"></button></div><span class="coach-arrow" aria-hidden="true"></span>';
    ring = document.createElement('div'); ring.className = 'coach-ring'; ring.hidden = true; ring.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ring); document.body.appendChild(tip);
    tip.querySelector('.coach-next').addEventListener('click', next);
    tip.querySelector('.coach-skip').addEventListener('click', function () { close(true); });
    tip.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); return; } // the button handles it, not the page's shortcuts
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') { // two buttons: keep Tab between them while the bubble is open
        var b = [].slice.call(tip.querySelectorAll('button')).filter(visible), i = b.indexOf(document.activeElement);
        if (b.length && (e.shiftKey ? i <= 0 : i === b.length - 1)) { e.preventDefault(); b[e.shiftKey ? b.length - 1 : 0].focus(); }
      }
    });
    document.addEventListener('pointerdown', function (e) { if (tip && !tip.hidden && !tip.contains(e.target)) close(true, true); }, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
  }
  function show(steps, k, key) {
    steps = steps.filter(function (s) { return s.target; });
    if (!steps.length) return false;
    if (!tip) build();
    queue = steps; step = 0; kind = k; doneKey = key;
    back = document.activeElement;
    render(true);
    return true;
  }
  function render(first) {
    var s = queue[step];
    anchor = s.target;
    tip.querySelector('#coachKicker').textContent = tr(kind === 'new' ? 'tips.kickerNew' : 'tips.kicker');
    tip.querySelector('#coachTitle').textContent = s.title;
    tip.querySelector('#coachText').textContent = s.text;
    var many = queue.length > 1, last = step === queue.length - 1;
    var dots = tip.querySelector('.coach-dots'); dots.textContent = '';
    if (many) queue.forEach(function (_, i) { var d = document.createElement('i'); if (i === step) d.className = 'on'; dots.appendChild(d); });
    tip.querySelector('#coachCount').textContent = many ? tr('tips.of', { n: step + 1, m: queue.length }) : '';
    var skip = tip.querySelector('.coach-skip'); skip.hidden = !many || last; skip.textContent = tr('tips.skip');
    tip.querySelector('.coach-next').textContent = tr(last ? 'tips.ok' : 'tips.next');
    var r = anchor.getBoundingClientRect();
    if (r.top < 70 || r.bottom > innerHeight - 90) anchor.scrollIntoView({ block: 'center', behavior: reduced.matches ? 'auto' : 'smooth' });
    tip.hidden = false; ring.hidden = false;
    tip.classList.remove('is-in'); void tip.offsetWidth; tip.classList.add('is-in');
    place();
    setTimeout(place, reduced.matches ? 0 : 380); // after a smooth scroll settles
    tip.querySelector('.coach-next').focus({ preventScroll: true });
  }
  function place() {
    if (!tip || tip.hidden || !anchor) return;
    if (!visible(anchor)) { close(false); return; }
    var z = tip.getBoundingClientRect().width / (tip.offsetWidth || 1) || 1; // large text sizes zoom the page
    var r = anchor.getBoundingClientRect(), pad = 6, gap = 14;
    ring.style.left = (r.left - pad) / z + 'px'; ring.style.top = (r.top - pad) / z + 'px';
    ring.style.width = (r.width + pad * 2) / z + 'px'; ring.style.height = (r.height + pad * 2) / z + 'px';
    var tw = tip.offsetWidth * z, th = tip.offsetHeight * z, vw = innerWidth, vh = innerHeight;
    var bottomBar = document.getElementById('tabbar'), barH = visible(bottomBar) ? bottomBar.getBoundingClientRect().height : 0;
    var below = r.bottom + gap + th <= vh - barH - 8, above = r.top - gap - th >= 8;
    var top, side;
    if (below || !above && (vh - r.bottom) >= r.top) { top = Math.min(r.bottom + gap, vh - barH - th - 8); side = 'below'; }
    else { top = Math.max(8, r.top - gap - th); side = 'above'; }
    if (r.height > vh * 0.6) { top = Math.max(72, Math.min(r.top + 16, vh - barH - th - 8)); side = 'inside'; } // a big area: sit on it, below the top bar
    var left = Math.max(12, Math.min(r.left + r.width / 2 - tw / 2, vw - tw - 12));
    tip.style.left = left / z + 'px'; tip.style.top = top / z + 'px';
    tip.dataset.side = side;
    var ax = Math.max(18, Math.min(r.left + r.width / 2 - left, tw - 18));
    tip.style.setProperty('--arrow-x', ax / z + 'px');
  }
  function next() {
    if (step < queue.length - 1) { step++; render(false); } else close(true);
  }
  function close(markSeen, byPointer) {
    if (!tip || tip.hidden) return;
    tip.hidden = true; ring.hidden = true;
    if (markSeen && doneKey) { doneKey(); save(); }
    var b = back; back = null; anchor = null;
    if (!byPointer && b && b !== document.body && document.contains(b) && visible(b)) { try { b.focus({ preventScroll: true }); } catch (e) {} }
  }

  /* ---------- when to show what ---------- */
  function sectionSteps(id) {
    var list = SCREENS[id]; if (!list) return [];
    var hover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    return list.map(function (s) {
      var key = s.k === 'train1' && hover ? 'train1Keys' : s.k;
      return { target: firstVisible(s.el), title: tr('tips.' + s.k + '.h'), text: tr('tips.' + key) };
    });
  }
  function announceSteps(stage) {
    var desk = !visible(document.getElementById('tabbar')); // fixed elements have no offsetParent: check the box
    return stage.items.map(function (k) {
      var it = ITEMS[k], el = desk ? document.getElementById(it.nav) : document.getElementById(it.tab);
      if (!visible(el)) el = document.getElementById(it.nav);
      return { target: visible(el) ? el : null, title: tr('nav.' + k), text: tr('tips.unlock.' + k) }; // the same name as in the menu
    });
  }
  function pendingStage() {
    for (var i = 0; i < STAGES.length; i++) if (st.sessions >= STAGES[i].at && !st.announced[STAGES[i].at]) return STAGES[i];
    return null;
  }
  function onScreen(id) {
    if (!st) return;
    Object.keys(ITEMS).forEach(function (k) { if (ITEMS[k].screen === id && unlocked(k)) st.visited[k] = 1; });
    save(); refreshDots();
    clearTimeout(timer);
    if (tip && !tip.hidden) close(false);
    if (id === 'screen-loading') return;
    timer = setTimeout(function () { attempt(id, 0); }, id === 'screen-train' ? 900 : 650);
  }
  function attempt(id, tries) {
    var cur = document.querySelector('.screen.active');
    if (!cur || cur.id !== id) return; // the learner already moved on
    if (blocked()) { if (tries < 6) timer = setTimeout(function () { attempt(id, tries + 1); }, 1500); return; }
    var stage = id !== 'screen-train' ? pendingStage() : null;
    if (stage && show(announceSteps(stage), 'new', function () { st.announced[stage.at] = 1; })) return;
    if (!st.seen[id] && SCREENS[id]) show(sectionSteps(id), 'tip', function () { st.seen[id] = 1; });
  }

  window.VMTips = {
    init: function (opts) {
      if (!st) { st = fresh(opts && opts.experienced); save(); }
      refreshDots();
      var b = document.getElementById('btnTips');
      if (b) {
        b.setAttribute('aria-pressed', String(st.on !== false));
        b.addEventListener('click', function () {
          st.on = st.on === false; // turning tips back on shows them again from the start
          if (st.on) st.seen = {};
          else close(false);
          b.setAttribute('aria-pressed', String(st.on));
          save(); refreshDots();
        });
      }
    },
    screen: onScreen,
    sessionDone: function () { if (!st) return; st.sessions = (st.sessions || 0) + 1; save(); refreshDots(); },
    refresh: refreshDots,
    close: function () { close(false); }
  };
})();
