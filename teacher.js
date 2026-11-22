/* For teachers (v2.55): make a homework deck and hand it out as a link, like Kahoot or Zoom.
   1 · title & languages → 2 · words (with or without translations) → 3 · optional name, deadline, note.
   Words without a translation are translated (AI, else the free translator), the teacher checks them in a
   table, then gets a #deck=… link (share.js, with homework meta) to send to the class.
   Nothing goes to a server: the words live in the link, the teacher's list of homework lives in localStorage.
   v2.56: a teacher who is signed in keeps homework in the account (supabase/teacher.sql) and sees each student's results;
   a student who opens such a link gives a name, and every practice on that deck adds to the totals the teacher sees.
   The pure helpers are tested in Node (test/teacher.js); mount() wires the "For teachers" screen. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VMTeacher = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var KEY = 'vm.teacher';
  var MAX_LIST = 40;       // homework kept in "My homework"
  var MAX_WORDS = 300;     // more would not fit in one link anyway
  var DAY = 86400000;

  /* ---------- pure helpers ---------- */
  function str(s, n) { return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : ''; }
  function validDay(d) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    var t = new Date(d + 'T00:00:00Z');
    return !isNaN(t) && t.toISOString().slice(0, 10) === d;
  }
  // Whatever is in storage, the screen only ever sees well-formed entries.
  function normalizeStore(raw, codes) {
    var ok = Object.create(null);
    (codes || []).forEach(function (c) { ok[c] = true; });
    var out = { list: [], last: {} };
    if (!raw || typeof raw !== 'object') return out;
    var last = raw.last && typeof raw.last === 'object' ? raw.last : {};
    if (ok[last.source]) out.last.source = last.source;
    if (ok[last.target]) out.last.target = last.target;
    if (str(last.by, 40)) out.last.by = str(last.by, 40);
    (Array.isArray(raw.list) ? raw.list : []).forEach(function (it) {
      if (!it || typeof it !== 'object' || out.list.length >= MAX_LIST) return;
      var link = typeof it.link === 'string' ? it.link : '';
      if (!LINK_RE.test(link) || !ok[it.source] || !ok[it.target]) return;
      out.list.push({
        id: str(it.id, 40) || String(it.created || out.list.length),
        title: str(it.title, 60) || '—',
        source: it.source, target: it.target,
        n: Math.max(0, Math.min(MAX_WORDS, Math.floor(Number(it.n) || 0))),
        due: validDay(it.due) ? it.due : '',
        created: Number(it.created) > 0 ? Number(it.created) : 0,
        link: link
      });
      if (it.cloud === true && isId(it.id)) out.list[out.list.length - 1].cloud = true; // tracked in the account: its results can be opened
    });
    return out;
  }
  function addToList(store, item) {
    var list = [item].concat(store.list.filter(function (x) { return x.id !== item.id; }));
    return { list: list.slice(0, MAX_LIST), last: store.last };
  }
  // Days from today (local) to the deadline: 0 = today, negative = passed, null = no deadline.
  function daysLeft(due, now) {
    if (!validDay(due)) return null;
    var n = new Date(now || Date.now()), today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.round((Date.parse(due + 'T00:00:00Z') - today) / DAY);
  }
  function formatDay(due, locale) {
    if (!validDay(due)) return '';
    var p = due.split('-');
    try { return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(locale || 'ru', { day: 'numeric', month: 'long' }); }
    catch (e) { return p[2] + '.' + p[1] + '.' + p[0]; }
  }
  function todayISO(now) {
    var d = new Date(now || Date.now());
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // The rows the teacher checks: pairs keep their translation, single words wait for one.
  function rowsFrom(items) {
    return items.slice(0, MAX_WORDS).map(function (it) {
      return { original: it.original, translation: it.pretranslated ? it.translation : '', examples: [], auto: !it.pretranslated };
    });
  }
  var EXAMPLES = {
    en: ['travel', 'luggage', 'passport', 'departure', 'arrival', 'to book', 'delay', 'souvenir'],
    de: ['die Reise', 'der Koffer', 'der Reisepass', 'die Abfahrt', 'die Ankunft', 'buchen', 'die Verspätung'],
    fr: ['le voyage', 'la valise', 'le passeport', 'le départ', "l'arrivée", 'réserver', 'le retard'],
    es: ['el viaje', 'la maleta', 'el pasaporte', 'la salida', 'la llegada', 'reservar', 'el retraso'],
    it: ['il viaggio', 'la valigia', 'il passaporto', 'la partenza', "l'arrivo", 'prenotare', 'il ritardo'],
    ja: ['旅行', '荷物', 'パスポート', '出発', '到着', '予約する'],
    ko: ['여행', '짐', '여권', '출발', '도착', '예약하다'],
    zh: ['旅行', '行李', '护照', '出发', '到达', '预订']
  };
  function exampleWords(source) { return (EXAMPLES[source] || EXAMPLES.en).join('\n'); }


  /* ---------- v2.56: homework in the account, the students' results ---------- */
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var LINK_RE = /^https?:\/\/[^\s#]+#deck=\d+\.[A-Za-z0-9_-]+$/;
  var MAX_LINK = 9000;      // the database refuses longer links
  var MAX_SEND = 2000;      // answers in one result sent to the teacher (the database function's limit)
  var MAX_LINKS = 60;       // decks remembered as homework on a student's device
  var STUDENT_KEY = 'vm.student', LINKS_KEY = 'vm.hw-links', PENDING_KEY = 'vm.hw-pending';

  function isId(s) { return typeof s === 'string' && UUID.test(s); }
  function int(n, lo, hi) { n = Math.floor(Number(n)); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; }
  // A random id (version 4). Throws when the browser has no secure random numbers: the caller then makes a plain link.
  function newId(c) {
    c = c || (typeof crypto !== 'undefined' ? crypto : null);
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    if (!c || typeof c.getRandomValues !== 'function') throw new Error('no-crypto');
    var b = c.getRandomValues(new Uint8Array(16)), hex = [];
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    for (var i = 0; i < 16; i++) hex.push((b[i] + 256).toString(16).slice(1));
    return hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10).join('');
  }

  // Student side. The device key tells the teacher it is the same student next time; the name is what the teacher reads.
  function normalizeStudent(raw) {
    var out = { key: '', name: '' };
    if (raw && typeof raw === 'object') {
      if (isId(raw.key)) out.key = raw.key;
      out.name = str(raw.name, 40);
    }
    return out;
  }
  // deck key → { id } for decks that came from a tracked homework link.
  function normalizeLinks(raw) {
    var out = {}, n = 0;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach(function (k) {
      var v = raw[k];
      if (n >= MAX_LINKS || !k || k.length > 120 || !v || typeof v !== 'object' || !isId(v.id)) return;
      out[k] = { id: v.id }; n++;
    });
    return out;
  }
  function rememberLink(links, deckKey, id) {
    var out = {};
    Object.keys(links).forEach(function (k) { if (k !== deckKey) out[k] = links[k]; });
    var keys = Object.keys(out);
    while (keys.length >= MAX_LINKS) delete out[keys.shift()]; // the oldest go first
    out[deckKey] = { id: id };
    return out;
  }
  // Answers not yet sent: { homeworkId: { a: answers, c: correct, w: most words in one practice } }.
  function normalizePending(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach(function (id) {
      var v = raw[id];
      if (!isId(id) || !v || typeof v !== 'object') return;
      var a = int(v.a, 0, 1e6), c = int(v.c, 0, a), w = int(v.w, 0, MAX_WORDS);
      if (a > 0) out[id] = { a: a, c: c, w: w };
    });
    return out;
  }
  function addTally(pending, id, ok, words) {
    var out = normalizePending(pending);
    if (!isId(id)) return out;
    var t = out[id] || { a: 0, c: 0, w: 0 };
    t.a = Math.min(t.a + 1, 1e6); if (ok) t.c = Math.min(t.c + 1, t.a);
    t.w = Math.max(t.w, int(words, 0, MAX_WORDS));
    out[id] = t;
    return out;
  }
  // Takes up to MAX_SEND answers of one homework out of the pending ones; what does not fit stays for the next send.
  function takeTally(pending, id) {
    var rest = normalizePending(pending), t = rest[id];
    if (!t) return { take: null, rest: rest };
    var a = Math.min(t.a, MAX_SEND), c = Math.min(t.c, a), take = { answered: a, correct: c, words: t.w };
    if (t.a > a) rest[id] = { a: t.a - a, c: t.c - c, w: t.w }; else delete rest[id];
    return { take: take, rest: rest };
  }
  function giveBack(pending, id, take) {
    var out = normalizePending(pending), t = out[id] || { a: 0, c: 0, w: 0 };
    out[id] = { a: Math.min(t.a + take.answered, 1e6), c: Math.min(t.c + take.correct, Math.min(t.a + take.answered, 1e6)), w: Math.max(t.w, take.words) };
    return out;
  }

  // Teacher side: what the database returns is checked before the screen draws it.
  function normalizeCloud(raw, codes) {
    var ok = Object.create(null), out = [];
    (codes || []).forEach(function (c) { ok[c] = true; });
    (Array.isArray(raw) ? raw : []).forEach(function (it) {
      if (!it || typeof it !== 'object' || !isId(it.id) || !LINK_RE.test(String(it.link)) || !ok[it.source] || !ok[it.target] || out.length >= 100) return;
      var created = Date.parse(it.created_at);
      out.push({ id: it.id, title: str(it.title, 60) || '—', source: it.source, target: it.target, n: int(it.n, 0, MAX_WORDS), due: validDay(it.due) ? it.due : '',
        created: created > 0 ? created : 0, link: it.link, cloud: true });
    });
    return out;
  }
  // The account's homework first-class; devices' own list adds what was made before signing in. When the account list
  // was read, a homework that used to be tracked but is gone (deleted on another device) is not shown any more.
  function mergeLists(local, cloud, cloudRead) {
    var seen = Object.create(null), out = [];
    cloud.forEach(function (it) { seen[it.id] = true; out.push(it); });
    local.forEach(function (it) { if (!seen[it.id] && !(cloudRead && it.cloud)) out.push(it); });
    return out.sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
  }
  function normalizeResults(raw) {
    var out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (r) {
      if (!r || typeof r !== 'object' || typeof r.student_key !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(r.student_key)) return;
      var a = int(r.answered, 0, 1e7);
      var first = Date.parse(r.first_at), last = Date.parse(r.last_at);
      out.push({ key: r.student_key, name: str(r.student_name, 40) || '—', answered: a, correct: int(r.correct, 0, a), words: int(r.words, 0, MAX_WORDS),
        attempts: Math.max(1, int(r.attempts, 1, 1e7)), first: first > 0 ? first : 0, last: last > 0 ? last : 0 });
    });
    return out;
  }
  function accuracy(r) { return r.answered > 0 ? Math.round(r.correct / r.answered * 100) : 0; }
  function summarize(rows) {
    var a = 0, c = 0;
    rows.forEach(function (r) { a += r.answered; c += r.correct; });
    return { students: rows.length, answered: a, correct: c, accuracy: a > 0 ? Math.round(c / a * 100) : 0 };
  }
  // by: 'recent' (default) | 'name' | 'accuracy' (weakest first) | 'practice' (most practice first)
  function sortRows(rows, by) {
    var cmp = { recent: function (x, y) { return y.last - x.last; },
      name: function (x, y) { return x.name.localeCompare(y.name); },
      accuracy: function (x, y) { return accuracy(x) - accuracy(y) || y.answered - x.answered; },
      practice: function (x, y) { return y.answered - x.answered || y.attempts - x.attempts; } }[by] || function (x, y) { return y.last - x.last; };
    return rows.slice().sort(cmp);
  }

  /* ---------- the screen ---------- */
  function mount(d) {
    var $ = function (id) { return document.getElementById(id); };
    var tr = d.tr, h = d.h, codes = d.LANGUAGES.KNOWN_CODES;
    var store = load(), rows = [], busy = false, made = null, token = 0;
    var cloudList = [], cloudRead = false, cloudToken = 0, lastOn = false, viewing = null;

    function load() { try { return normalizeStore(JSON.parse(localStorage.getItem(KEY) || 'null'), codes); } catch (e) { return normalizeStore(null, codes); } }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { d.toast(tr('teach.errStore'), 'err', 5000); } }
    function locale() { var l = d.uiLang(); return l === 'uz' ? 'uz-Latn' : l; }
    function label(code) { return d.langLabel(code); }
    // v2.56: the account (Supabase) is optional: without it everything works as in v2.55, on this device only.
    function cloud() { var c = d.cloud && d.cloud(); return c && c.client ? c : null; }
    function signedIn() { var c = cloud(); return Boolean(c && c.signedIn()); }
    function renderTrack() {
      var c = cloud();
      $('tTrack').hidden = !c;
      if (c) { var on = c.signedIn(); $('tTrackOn').hidden = !on; $('tTrackOff').hidden = on; }
    }
    async function loadCloud() {
      var c = cloud(), my = ++cloudToken;
      if (!c || !c.signedIn()) { cloudList = []; cloudRead = false; renderList(); return; }
      try { var got = normalizeCloud(await c.client.hwList(), codes); if (my !== cloudToken) return; cloudList = got; cloudRead = true; }
      catch (e) { if (my !== cloudToken) return; cloudRead = false; } // offline or not set up yet: the device's own list stays
      renderList();
    }

    function fillLangs() {
      var L = d.LANGUAGES, s = $('tSource').value || store.last.source || d.defaultSource(), t = $('tTarget').value || store.last.target || d.defaultTarget();
      if (!L.canLearn(s)) s = 'en';
      if (!L.canBeNative(t) || t === s) t = s === 'ru' ? 'en' : 'ru';
      d.fillLangSelect($('tSource'), L.LEARN_CODES, s);
      d.fillLangSelect($('tTarget'), L.NATIVE_CODES, t);
    }
    function onLangChange(e) {
      var s = $('tSource'), t = $('tTarget');
      if (s.value === t.value) { // same language twice: move the other side away
        if (e && e.target === s) t.value = s.value === 'ru' ? 'en' : 'ru';
        else s.value = t.value === 'en' ? 'de' : 'en';
      }
      updateCount();
    }
    function updateCount() {
      var items = d.parse($('tWords').value).items, auto = items.filter(function (it) { return !it.pretranslated; }).length;
      $('tCount').textContent = !items.length ? '' : d.trn('words.count', items.length) + (auto ? ' · ' + tr('teach.countAuto', { n: auto }) : '');
      $('tMake').classList.toggle('ready', items.length > 0);
      $('tForm').classList.toggle('has-words', items.length > 0);
      if (items.length) $('tError').textContent = '';
    }
    function error(msg, el) { $('tError').textContent = msg; if (el) el.focus(); }
    function showOnly(which) {
      $('tForm').hidden = which !== 'form'; $('tReview').hidden = which !== 'review'; $('tDone').hidden = which !== 'done'; $('tResults').hidden = which !== 'results';
      if (which !== 'form') { var sec = $({ review: 'tReview', done: 'tDone', results: 'tResults' }[which]); sec.focus({ preventScroll: true }); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* step 1 → review */
    function submit(e) {
      e.preventDefault();
      var src = $('tSource').value, tgt = $('tTarget').value;
      if (src === tgt) { error(tr('deck.sameLang'), $('tSource')); return; }
      var items = d.parse($('tWords').value).items;
      if (!items.length) { error(tr('teach.errNoWords'), $('tWords')); return; }
      if (items.length > MAX_WORDS) { error(tr('teach.errTooMany', { n: MAX_WORDS }), $('tWords')); return; }
      $('tError').textContent = '';
      rows = rowsFrom(items);
      $('tColWord').textContent = label(src); $('tColTr').textContent = label(tgt);
      showOnly('review');
      renderRows();
      translateMissing(src, tgt);
    }
    async function translateMissing(src, tgt) {
      var todo = rows.filter(function (r) { return r.auto && !r.translation; });
      var my = ++token;
      $('tReviewInfo').textContent = tr(todo.length ? 'teach.reviewAuto' : 'teach.reviewPairs');
      if (!todo.length) { setBusy(false); return; }
      setBusy(true, tr('teach.translating', { a: 0, b: todo.length }));
      var done = 0;
      try {
        await d.translate(todo.map(function (r) { return r.original; }), src, tgt, function (got) {
          if (my !== token) return;
          got.forEach(function (c) {
            var row = rows.find(function (r) { return r.auto && !r.translation && r.original.toLocaleLowerCase() === String(c.original || '').toLocaleLowerCase(); });
            if (!row || !c.translation || c.translation === '—') return;
            row.translation = str(c.translation, 300);
            row.examples = (Array.isArray(c.examples) ? c.examples : []).filter(function (x) { return typeof x === 'string'; }).slice(0, 2);
            done++;
          });
          if (my === token) { syncRows(); $('tBusyText').textContent = tr('teach.translating', { a: Math.min(done, todo.length), b: todo.length }); }
        });
      } catch (e) { /* rows that stayed empty are typed in by the teacher */ }
      if (my !== token) return;
      setBusy(false);
      var missing = rows.filter(function (r) { return !r.translation; }).length;
      if (missing) $('tReviewInfo').textContent = tr('teach.reviewMissing', { n: missing });
      var first = document.querySelector('#tRows input.t-tr:placeholder-shown');
      if (first) first.focus();
    }
    function setBusy(on, text) {
      busy = on; $('tBusy').hidden = !on; $('tPublish').disabled = on;
      if (text) $('tBusyText').textContent = text;
    }
    function renderRows() {
      var body = $('tRows'), src = $('tSource').value, tgt = $('tTarget').value;
      body.textContent = '';
      rows.forEach(function (r, i) {
        var o = h('input', { type: 'text', class: 't-orig', value: r.original, maxlength: '200', lang: src, 'aria-label': tr('teach.rowWord', { n: i + 1 }) });
        var t = h('input', { type: 'text', class: 't-tr', value: r.translation, maxlength: '300', lang: tgt, placeholder: r.auto ? tr('teach.rowWait') : tr('teach.rowType'), 'aria-label': tr('teach.rowTr', { w: r.original }) });
        o.oninput = function () { r.original = o.value; };
        t.oninput = function () { r.translation = t.value; t.classList.remove('bad'); };
        var del = h('button', { type: 'button', class: 'icon-btn t-del', 'aria-label': tr('teach.rowDel', { w: r.original }), title: tr('teach.remove') }, ['×']);
        del.onclick = function () { rows.splice(rows.indexOf(r), 1); renderRows(); };
        body.appendChild(h('tr', { 'data-auto': r.auto ? '1' : '0' }, [h('td', {}, [o]), h('td', {}, [t]), h('td', {}, [del])]));
      });
      if (!rows.length) { body.appendChild(h('tr', {}, [h('td', { colspan: '3', class: 'mini' }, [tr('teach.errNoWords')])])); }
    }
    function syncRows() { // fills translations in place, keeps what the teacher already typed and the focus
      var inputs = document.querySelectorAll('#tRows input.t-tr');
      rows.forEach(function (r, i) { var el = inputs[i]; if (el && !el.value && r.translation) { el.value = r.translation; el.classList.add('filled'); } });
    }

    /* review → link */
    async function publish() {
      if (busy) return;
      var good = [], bad = null, seen = Object.create(null);
      var inputs = document.querySelectorAll('#tRows input.t-tr');
      rows.forEach(function (r, i) {
        var o = str(r.original, 200), t = str(r.translation, 300);
        if (!o) return;
        if (!t) { if (inputs[i]) inputs[i].classList.add('bad'); if (!bad) bad = inputs[i]; return; }
        if (seen[o.toLowerCase()]) return;
        seen[o.toLowerCase()] = true;
        good.push({ original: o, translation: t, examples: r.examples || [] });
      });
      if (bad) { d.toast(tr('teach.errEmptyTr'), 'err', 4000); bad.focus(); return; }
      if (!good.length) { d.toast(tr('teach.errNoWords'), 'err', 3000); return; }
      var title = str($('tTitle').value, 60) || tr('teach.defaultTitle', { d: formatDay(todayISO(), locale()) });
      var hw = { by: str($('tBy').value, 40), due: validDay($('tDue').value) ? $('tDue').value : '', note: str($('tNote').value, 200) };
      var id = '';
      if (signedIn()) { try { id = newId(); hw.id = id; } catch (e) { id = ''; } } // signed in: the results of this homework come to the teacher
      var deck = { name: title, source: $('tSource').value, target: $('tTarget').value, cards: good, hw: hw };
      var link;
      try {
        link = await makeLink(deck);
        if (link.length > d.share.LIMITS.linkChars) { // examples are a bonus: drop them before giving up
          deck.cards = good.map(function (c) { return { original: c.original, translation: c.translation, examples: [] }; });
          link = await makeLink(deck);
        }
      } catch (e) { d.toast(tr('shareErr.encode'), 'err', 5000); return; }
      if (link.length > d.share.LIMITS.linkChars) { d.toast(tr('teach.errLong'), 'err', 7000); return; }
      var tracked = false;
      if (id) {
        setBusy(true);
        if (link.length <= MAX_LINK) {
          try { await cloud().client.hwCreate({ id: id, title: title, source: deck.source, target: deck.target, n: good.length, due: hw.due || null, link: link }); tracked = true; }
          catch (e) { /* the link below still works, just without results */ }
        }
        setBusy(false);
        if (!tracked) {
          delete hw.id;
          try { link = await makeLink(deck); } catch (e) { d.toast(tr('shareErr.encode'), 'err', 5000); return; }
          d.toast(tr('teach.errCloud'), 'err', 8000);
        }
      }
      made = { id: tracked ? id : 'hw' + Date.now().toString(36), title: title, source: deck.source, target: deck.target, n: good.length, due: hw.due, created: Date.now(), link: link };
      if (tracked) { made.cloud = true; cloudList = [made].concat(cloudList.filter(function (x) { return x.id !== made.id; })); } // the account list already knows it
      store = addToList(store, made);
      store.last = { source: deck.source, target: deck.target, by: hw.by };
      save();
      showDone(made);
      renderList();
    }
    async function makeLink(deck) { return d.linkBase() + '#deck=' + await d.share.encodeDeck(deck); }

    function metaLine(it) {
      var parts = [d.trn('words.count', it.n), label(it.source) + ' → ' + label(it.target)];
      if (it.due) parts.push(tr('teach.until', { d: formatDay(it.due, locale()) }));
      return parts.join(' · ');
    }
    async function showDone(it) {
      made = it;
      $('tDoneName').textContent = it.title + ' · ' + metaLine(it);
      $('tLink').value = it.link;
      $('tShareNative').hidden = typeof navigator.share !== 'function';
      $('tDoneTrack').textContent = it.cloud ? tr('teach.doneTracked') : cloud() && !signedIn() ? tr('teach.doneNotTracked') : '';
      showOnly('done');
    }
    async function copy(link) {
      try { await navigator.clipboard.writeText(link); d.toast(tr('teach.copied'), 'ok', 3000); }
      catch (e) { if (!$('tDone').hidden) $('tLink').select(); d.toast(tr('share.copyManual'), 'err', 4000); }
    }
    async function tryIt(it) {
      try { d.preview(await d.share.decodeDeck(it.link.split('#deck=')[1], codes), true); }
      catch (e) { d.toast(tr('shareErr.' + (e.code || 'bad-link')), 'err', 5000); }
    }
    function another() {
      token++; setBusy(false); rows = [];
      ['tTitle', 'tWords', 'tNote', 'tDue'].forEach(function (id) { $(id).value = ''; });
      $('tDue').classList.add('is-empty');
      updateCount(); showOnly('form'); $('tTitle').focus();
    }

    /* My homework */
    function renderList() {
      var list = $('tList'), all = mergeLists(store.list, cloudList, cloudRead); list.textContent = '';
      $('tMine').hidden = !all.length;
      $('tMineCount').textContent = all.length ? String(all.length) : '';
      $('tMineNote').textContent = tr(signedIn() ? 'teach.mineNoteCloud' : 'teach.mineNote');
      all.forEach(function (it) {
        var left = daysLeft(it.due);
        var due = it.due ? h('span', { class: 't-due' + (left !== null && left < 0 ? ' past' : left !== null && left <= 1 ? ' soon' : ''), text: left < 0 ? tr('teach.duePast') : left === 0 ? tr('teach.dueToday') : left === 1 ? tr('teach.dueTomorrow') : tr('teach.until', { d: formatDay(it.due, locale()) }) }) : null;
        var bCopy = h('button', { type: 'button', class: 'chip-btn' }, [tr('teach.copyLink')]);
        var bDel = h('button', { type: 'button', class: 'chip-btn t-del-hw', 'aria-label': tr('teach.delete') + ': ' + it.title }, [tr('teach.delete')]);
        var bRes = it.cloud ? h('button', { type: 'button', class: 'chip-btn t-res-btn' }, [tr('teach.results')]) : null;
        if (bRes) bRes.onclick = function () { openResults(it); };
        bCopy.onclick = function () { copy(it.link); };
        bDel.onclick = async function () {
          if (it.cloud) { // tracked: the students' results go with it, so it cannot be undone
            if (!window.confirm(tr('teach.deleteConfirm', { t: it.title }))) return;
            try { await cloud().client.hwDelete(it.id); } catch (e) { d.toast(tr('teach.errCloudDel'), 'err', 5000); return; }
            store.list = store.list.filter(function (x) { return x.id !== it.id; }); save();
            cloudList = cloudList.filter(function (x) { return x.id !== it.id; });
            if (viewing && viewing.id === it.id) closeResults();
            renderList(); d.toast(tr('teach.deletedCloud'), 'ok', 5000);
            return;
          }
          var before = store.list.slice();
          store.list = store.list.filter(function (x) { return x !== it; }); save(); renderList();
          d.toast(tr('teach.deleted'), 'ok', 7000, { label: tr('undo.action'), run: function () { store.list = before; save(); renderList(); } });
        };
        list.appendChild(h('li', { class: 't-item' }, [
          h('div', { class: 't-item-copy' }, [h('strong', { text: it.title }), h('span', { class: 'mini', text: metaLine(Object.assign({}, it, { due: '' })) }), due]),
          h('div', { class: 't-item-actions' }, [bRes, bCopy, bDel])
        ]));
      });
    }


    /* Results: who practised, how accurately, when (v2.56) */
    function dayLabel(ts) {
      if (!ts) return '—';
      var iso = todayISO(ts), left = daysLeft(iso);
      return left === 0 ? tr('teach.resToday') : left === -1 ? tr('teach.resYesterday') : formatDay(iso, locale());
    }
    async function openResults(it) {
      viewing = { id: it.id, rows: [] };
      $('tResTitle').textContent = it.title;
      $('tResMeta').textContent = metaLine(it);
      renderResults();
      showOnly('results');
      await loadResults();
    }
    function closeResults() { viewing = null; showOnly('form'); }
    async function loadResults() {
      var c = cloud(), v = viewing;
      if (!c || !v) return;
      $('tResState').textContent = tr('teach.resLoading');
      try { var got = normalizeResults(await c.client.hwResults(v.id)); if (viewing !== v) return; v.rows = got; }
      catch (e) { if (viewing === v) $('tResState').textContent = tr(e.code === 'signed-out' ? 'teach.resSignedOut' : 'teach.resError'); return; }
      $('tResState').textContent = '';
      renderResults();
    }
    function renderResults() {
      var v = viewing; if (!v) return;
      var sum = summarize(v.rows), body = $('tResBody');
      $('tResStudents').textContent = String(sum.students);
      $('tResAccuracy').textContent = sum.students ? sum.accuracy + '%' : '—';
      $('tResAnswers').textContent = String(sum.answered);
      $('tResEmpty').hidden = v.rows.length > 0; $('tResWrap').hidden = !v.rows.length;
      body.textContent = '';
      sortRows(v.rows, $('tSort').value).forEach(function (r) {
        var acc = accuracy(r);
        var del = h('button', { type: 'button', class: 'icon-btn t-del', 'aria-label': tr('teach.resRemove', { n: r.name }), title: tr('teach.remove') }, ['×']);
        del.onclick = async function () {
          if (!window.confirm(tr('teach.resRemoveConfirm', { n: r.name }))) return;
          try { await cloud().client.hwDeleteResult(v.id, r.key); } catch (e) { d.toast(tr('teach.resError'), 'err', 4000); return; }
          v.rows = v.rows.filter(function (x) { return x !== r; }); renderResults();
        };
        body.appendChild(h('tr', {}, [
          h('th', { scope: 'row', class: 't-res-name' }, [r.name]),
          h('td', { class: 't-res-acc' + (r.answered >= 10 && acc < 60 ? ' low' : '') }, [h('strong', { text: acc + '%' }), h('span', { class: 'mini', text: r.correct + ' / ' + r.answered })]),
          h('td', {}, [String(r.words)]), h('td', {}, [String(r.attempts)]), h('td', {}, [dayLabel(r.last)]), h('td', {}, [del])
        ]));
      });
    }

    /* wiring */
    fillLangs();
    $('tSource').onchange = onLangChange; $('tTarget').onchange = onLangChange;
    $('tWords').addEventListener('input', updateCount);
    $('tExample').onclick = function () {
      if (!$('tTitle').value) $('tTitle').value = tr('teach.exampleTitle');
      $('tWords').value = exampleWords($('tSource').value); updateCount(); $('tWords').focus();
    };
    if (store.last.by) $('tBy').value = store.last.by;
    $('tDue').min = todayISO();
    function syncDue() { $('tDue').classList.toggle('is-empty', !$('tDue').value); }
    $('tDue').addEventListener('input', syncDue); $('tDue').addEventListener('change', syncDue); syncDue();
    $('tForm').onsubmit = submit;
    $('tBack').onclick = function () { token++; setBusy(false); showOnly('form'); $('tWords').focus(); };
    $('tPublish').onclick = publish;
    $('tCopy').onclick = function () { if (made) copy(made.link); };
    $('tShareNative').onclick = function () { if (made) navigator.share({ title: made.title, text: tr('teach.shareText', { t: made.title }), url: made.link }).catch(function () {}); };
    $('tTry').onclick = function () { if (made) tryIt(made); };
    $('tAnother').onclick = another;
    $('tTrackSignIn').onclick = function () { var c = cloud(); if (c) c.signIn(); };
    $('tResBack').onclick = closeResults;
    $('tResRefresh').onclick = loadResults;
    $('tSort').onchange = renderResults;
    document.addEventListener('vm-account', function (e) { // signing in or out changes what the teacher sees
      var on = Boolean(e.detail && e.detail.signedIn);
      renderTrack();
      if (on === lastOn) return;
      lastOn = on;
      if (!on) { if (viewing) closeResults(); loadCloud(); }
      else if ($('screen-teacher').classList.contains('active')) loadCloud();
    });
    updateCount(); renderList(); renderTrack();

    return {
      open: function () { store = load(); fillLangs(); renderList(); renderTrack(); lastOn = signedIn(); loadCloud(); },
      relabel: function () { fillLangs(); updateCount(); renderList(); renderTrack(); renderResults(); if (!$('tReview').hidden) renderRows(); if (made && !$('tDone').hidden) $('tDoneName').textContent = made.title + ' · ' + metaLine(made); }
    };
  }

  return { KEY: KEY, MAX_WORDS: MAX_WORDS, normalizeStore: normalizeStore, addToList: addToList, daysLeft: daysLeft, formatDay: formatDay, todayISO: todayISO, rowsFrom: rowsFrom, exampleWords: exampleWords, validDay: validDay, mount: mount,
    MAX_LINK: MAX_LINK, MAX_SEND: MAX_SEND, STUDENT_KEY: STUDENT_KEY, LINKS_KEY: LINKS_KEY, PENDING_KEY: PENDING_KEY,
    isId: isId, newId: newId, normalizeStudent: normalizeStudent, normalizeLinks: normalizeLinks, rememberLink: rememberLink,
    normalizePending: normalizePending, addTally: addTally, takeTally: takeTally, giveBack: giveBack,
    normalizeCloud: normalizeCloud, mergeLists: mergeLists, normalizeResults: normalizeResults, accuracy: accuracy, summarize: summarize, sortRows: sortRows };
});
