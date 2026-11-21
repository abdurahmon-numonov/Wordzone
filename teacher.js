/* For teachers (v2.55): make a homework deck and hand it out as a link or a QR code, like Kahoot or Zoom.
   1 · title & languages → 2 · words (with or without translations) → 3 · optional name, deadline, note.
   Words without a translation are translated (AI, else the free translator), the teacher checks them in a
   table, then gets a #deck=… link (share.js, with homework meta) and a QR code to show the class.
   The words always live in the link. Without an account the teacher's list lives in localStorage only.
   v2.56 — a signed-in teacher (the site's Supabase login) also keeps the homework in the cloud
   (supabase/teacher.sql: homework + homework_results, RLS) and sees each student's results: the link carries
   the homework id, the student types a name, and every finished practice adds to their row.
   The pure helpers are tested in Node (test/teacher.js); mount() wires the "For teachers" screen. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VMTeacher = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var KEY = 'vm.teacher';
  var MAX_LIST = 40;       // homework kept in "My homework"
  var MAX_WORDS = 300;     // more would not fit in one link anyway
  var CLASS_QR = 2300;     // a projected QR can be denser than the one in the dialog
  var DAY = 86400000;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var OUTBOX = 'vm.hw-outbox', LINKS = 'vm.hw-links', STUDENT = 'vm.student';

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
      if (!it || typeof it !== 'object' || out.list.length >= (raw.max || MAX_LIST)) return;
      var link = typeof it.link === 'string' ? it.link : '';
      if (!/^https?:\/\/[^\s#]+#deck=\d+\.[A-Za-z0-9_-]+$/.test(link) || !ok[it.source] || !ok[it.target]) return;
      out.list.push({
        id: str(it.id, 40) || String(it.created || out.list.length),
        title: str(it.title, 60) || '—',
        source: it.source, target: it.target,
        n: Math.max(0, Math.min(MAX_WORDS, Math.floor(Number(it.n) || 0))),
        due: validDay(it.due) ? it.due : '',
        created: Number(it.created) > 0 ? Number(it.created) : 0,
        link: link,
        cloud: it.cloud === true && UUID.test(String(it.id)),
        count: Math.max(0, Math.floor(Number(it.count) || 0))
      });
    });
    return out;
  }
  /* ---------- cloud (v2.56) ---------- */
  function newId(rand) {
    var c = typeof crypto !== 'undefined' ? crypto : null;
    if (!rand && c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16);
    if (rand) for (var i = 0; i < 16; i++) b[i] = rand() * 256 & 255; else c.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var hx = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return hx.slice(0, 8) + '-' + hx.slice(8, 12) + '-' + hx.slice(12, 16) + '-' + hx.slice(16, 20) + '-' + hx.slice(20);
  }
  function cloudRow(it) { return { id: it.id, title: it.title, source: it.source, target: it.target, n: it.n, due: it.due || null, link: it.link }; }
  // Rows from GET homework?select=…,homework_results(count) → the same shape as the local list.
  function fromCloud(rows, codes) {
    return normalizeStore({ max: 200, list: (Array.isArray(rows) ? rows : []).map(function (r) {
      r = r || {};
      var cnt = Array.isArray(r.homework_results) && r.homework_results[0] ? r.homework_results[0].count : 0;
      return { id: r.id, title: r.title, source: r.source, target: r.target, n: r.n, due: r.due || '', created: Date.parse(r.created_at) || 0, link: r.link, cloud: true, count: cnt };
    }) }, codes).list.filter(function (x) { return x.cloud; });
  }
  // What "My homework" shows: the account's homework, plus older device-only homework (never saved to the cloud).
  function mergeLists(local, cloud) {
    if (!cloud) return local;
    var ids = Object.create(null);
    cloud.forEach(function (x) { ids[x.id] = true; });
    return cloud.concat(local.filter(function (x) { return !x.cloud && !ids[x.id]; }))
      .sort(function (a, b) { return b.created - a.created; });
  }
  function localDay(t) { var d = new Date(t); return isNaN(d) ? '' : todayISO(d.getTime()); }
  // Results table rows, most recent first. late: first practice after the deadline day.
  function summarize(rows, due) {
    return (Array.isArray(rows) ? rows : []).filter(function (r) { return r && typeof r.student_name === 'string'; }).map(function (r) {
      var answered = Math.max(0, Number(r.answered) || 0), correct = Math.min(answered, Math.max(0, Number(r.correct) || 0));
      return {
        name: str(r.student_name, 40) || '—', answered: answered, correct: correct,
        acc: answered ? Math.round(correct / answered * 100) : 0,
        words: Math.max(0, Number(r.words) || 0), attempts: Math.max(1, Number(r.attempts) || 1),
        first: Date.parse(r.first_at) || 0, last: Date.parse(r.last_at) || 0,
        late: Boolean(validDay(due) && r.first_at && localDay(r.first_at) > due)
      };
    }).sort(function (a, b) { return b.last - a.last; });
  }
  /* ---------- the student side: results waiting to be sent ---------- */
  // One entry per homework and student; practices made offline add up until they are sent.
  function addReport(box, e) {
    var list = Array.isArray(box) ? box.filter(function (x) { return x && UUID.test(String(x.hw)); }) : [];
    if (!e || !UUID.test(String(e.hw)) || !(e.answered > 0)) return list;
    var same = list.find(function (x) { return x.hw === e.hw && x.key === e.key; });
    var answered = Math.min(2000, Math.floor(e.answered)), correct = Math.max(0, Math.min(answered, Math.floor(e.correct) || 0)), words = Math.max(0, Math.min(MAX_WORDS, Math.floor(e.words) || 0));
    if (same) {
      same.answered = Math.min(2000, same.answered + answered);
      same.correct = Math.min(same.answered, same.correct + correct);
      same.words = Math.max(same.words, words);
      same.name = str(e.name, 40) || same.name;
    } else list.push({ hw: e.hw, key: e.key, name: str(e.name, 40), answered: answered, correct: correct, words: words });
    return list.slice(-50);
  }
  function rpcBody(e) { return { p_homework: e.hw, p_student: e.key, p_name: e.name, p_answered: e.answered, p_correct: e.correct, p_words: e.words }; }
  function readJSON(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function writeJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  // The browser side of a student: remembers which deck belongs to which homework and sends finished practices.
  function student(deps) {
    function me() {
      var s = readJSON(STUDENT, {}) || {};
      if (typeof s.key !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(s.key)) { s.key = newId(); writeJSON(STUDENT, s); }
      return s;
    }
    var sending = null;
    async function flush() {
      if (sending) return sending;
      sending = (async function () {
        var box = readJSON(OUTBOX, []), sent = 0;
        if (!Array.isArray(box) || !box.length || !deps.rest()) return 0;
        for (var i = 0; i < box.length; i++) {
          var e = box[i];
          try { await deps.rest()('rpc/submit_homework_result', { method: 'POST', body: rpcBody(e) }); e.done = true; sent++; }
          catch (err) {
            if (err && err.code === 'offline') break;           // try again later
            if (err && err.status >= 400 && err.status < 500 && err.status !== 429) e.done = true; // homework deleted / not set up: drop it
            else break;
          }
        }
        writeJSON(OUTBOX, box.filter(function (x) { return !x.done; }));
        return sent;
      })().finally(function () { sending = null; });
      return sending;
    }
    return {
      name: function () { return str((readJSON(STUDENT, {}) || {}).name, 40); },
      link: function (deckKey, hwId, name) {
        if (!deckKey || !UUID.test(String(hwId))) return;
        var s = me(); s.name = str(name, 40); writeJSON(STUDENT, s);
        var links = readJSON(LINKS, {}) || {}; links[deckKey] = { hw: hwId.toLowerCase() }; writeJSON(LINKS, links);
      },
      linked: function (deckKey) { var l = (readJSON(LINKS, {}) || {})[deckKey]; return l && UUID.test(String(l.hw)) ? l.hw : null; },
      // A practice ended: queue its numbers for the teacher and try to send them. Resolves to the number sent.
      report: function (deckKey, stats) {
        var hw = this.linked(deckKey);
        if (!hw || !stats || !(stats.answered > 0)) return Promise.resolve(0);
        var s = me();
        writeJSON(OUTBOX, addReport(readJSON(OUTBOX, []), { hw: hw, key: s.key, name: s.name || '—', answered: stats.answered, correct: stats.correct, words: stats.words }));
        return flush();
      },
      flush: flush
    };
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

  /* ---------- the screen ---------- */
  function mount(d) {
    var $ = function (id) { return document.getElementById(id); };
    var tr = d.tr, h = d.h, codes = d.LANGUAGES.KNOWN_CODES;
    var store = load(), rows = [], busy = false, made = null, token = 0, cloudList = null, cloudState = '';
    var cloud = d.cloud || { ready: function () { return false; }, user: function () { return null; } };
    function signedIn() { return Boolean(cloud.ready() && cloud.user()); }

    function load() { try { return normalizeStore(JSON.parse(localStorage.getItem(KEY) || 'null'), codes); } catch (e) { return normalizeStore(null, codes); } }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { d.toast(tr('teach.errStore'), 'err', 5000); } }
    function locale() { var l = d.uiLang(); return l === 'uz' ? 'uz-Latn' : l; }
    function label(code) { return d.langLabel(code); }

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
      $('tForm').hidden = which !== 'form'; $('tReview').hidden = which !== 'review'; $('tDone').hidden = which !== 'done';
      if (which !== 'form') { var sec = $(which === 'review' ? 'tReview' : 'tDone'); sec.focus({ preventScroll: true }); }
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
      var inCloud = signedIn();
      if (inCloud) hw.id = newId(); // results come back to this id
      var deck = { name: title, source: $('tSource').value, target: $('tTarget').value, cards: good, hw: hw };
      var link;
      $('tPublish').disabled = true;
      try { link = await buildLink(deck, good); }
      catch (e) { d.toast(tr(e.code === 'too-long' ? 'teach.errLong' : 'shareErr.encode'), 'err', 7000); $('tPublish').disabled = false; return; }
      made = { id: hw.id || 'hw' + Date.now().toString(36), title: title, source: deck.source, target: deck.target, n: good.length, due: hw.due, created: Date.now(), link: link, cloud: false, count: 0 };
      if (inCloud) {
        try { await cloud.rest('homework', { method: 'POST', auth: 'need', body: cloudRow(made), headers: { Prefer: 'return=minimal' } }); made.cloud = true; }
        catch (e) { // not set up yet / offline / signed out: the homework still works, only without results
          delete hw.id;
          try { made.link = await buildLink(deck, good); made.id = 'hw' + Date.now().toString(36); } catch (e2) {}
          d.toast(tr(e && e.code === 'offline' ? 'teach.cloudOffline' : 'teach.cloudFail'), 'err', 8000);
        }
      }
      $('tPublish').disabled = false;
      store = addToList(store, made);
      store.last = { source: deck.source, target: deck.target, by: hw.by };
      save();
      if (made.cloud && cloudList) cloudList.unshift(made);
      showDone(made);
      renderList();
    }
    async function buildLink(deck, good) {
      var link = await makeLink(deck);
      if (link.length > d.share.LIMITS.linkChars) { // examples are a bonus: drop them before giving up
        deck.cards = good.map(function (c) { return { original: c.original, translation: c.translation, examples: [] }; });
        link = await makeLink(deck);
      }
      if (link.length > d.share.LIMITS.linkChars) { var e = new Error('too-long'); e.code = 'too-long'; throw e; }
      return link;
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
      $('tDoneCloud').hidden = !it.cloud;
      $('tShareNative').hidden = typeof navigator.share !== 'function';
      $('tShowClass').disabled = it.link.length > CLASS_QR;
      $('tShowClass').title = it.link.length > CLASS_QR ? tr('teach.qrTooLong') : '';
      showOnly('done');
      var host = $('tQr'); host.textContent = '';
      if (it.link.length > CLASS_QR) { host.appendChild(h('figcaption', { class: 'mini', text: tr('teach.qrTooLong') })); return; }
      try { host.appendChild(await d.qr(it.link)); host.appendChild(h('figcaption', { class: 'mini', text: tr('teach.qrHint') })); }
      catch (e) { host.appendChild(h('figcaption', { class: 'mini', text: tr('share.qrFailed') })); }
    }
    async function copy(link) {
      try { await navigator.clipboard.writeText(link); d.toast(tr('teach.copied'), 'ok', 3000); }
      catch (e) { if (!$('tDone').hidden) $('tLink').select(); d.toast(tr('share.copyManual'), 'err', 4000); }
    }
    var classOpener = null;
    async function showClass(it) {
      if (it.link.length > CLASS_QR) { d.toast(tr('teach.qrTooLong'), 'err', 4000); return; }
      classOpener = document.activeElement;
      $('tClassTitle').textContent = it.title;
      $('tClassSub').textContent = metaLine(it);
      var host = $('tClassQr'); host.textContent = '';
      $('tClass').hidden = false;
      $('tClassClose').focus();
      try { host.appendChild(await d.qr(it.link)); } catch (e) { host.appendChild(h('figcaption', { text: tr('share.qrFailed') })); }
      try { if ($('tClass').requestFullscreen && !document.fullscreenElement) await $('tClass').requestFullscreen(); } catch (e) {}
    }
    function closeClass() {
      if ($('tClass').hidden) return;
      $('tClass').hidden = true;
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
      if (classOpener && classOpener.focus && document.contains(classOpener)) classOpener.focus();
    }
    async function tryIt(it) {
      try { d.preview(await d.share.decodeDeck(it.link.split('#deck=')[1], codes), true); }
      catch (e) { d.toast(tr('shareErr.' + (e.code || 'bad-link')), 'err', 5000); }
    }
    function another() {
      token++; setBusy(false); rows = [];
      ['tTitle', 'tWords', 'tNote', 'tDue'].forEach(function (id) { $(id).value = ''; });
      updateCount(); showOnly('form'); $('tTitle').focus();
    }

    /* My homework */
    function shown() { return mergeLists(store.list, signedIn() ? cloudList : null); }
    function renderList() {
      var list = $('tList'); list.textContent = '';
      var items = shown();
      $('tMine').hidden = !items.length && !signedIn();
      $('tMineCount').textContent = items.length ? String(items.length) : '';
      $('tMineEmpty').hidden = items.length > 0;
      $('tMineNote').textContent = tr(signedIn() ? 'teach.mineCloud' : 'teach.mineNote');
      items.forEach(function (it) {
        var left = daysLeft(it.due);
        var due = it.due ? h('span', { class: 't-due' + (left !== null && left < 0 ? ' past' : left !== null && left <= 1 ? ' soon' : ''), text: left < 0 ? tr('teach.duePast') : left === 0 ? tr('teach.dueToday') : left === 1 ? tr('teach.dueTomorrow') : tr('teach.until', { d: formatDay(it.due, locale()) }) }) : null;
        var bCopy = h('button', { type: 'button', class: 'chip-btn' }, [tr('teach.copyLink')]);
        var bQr = h('button', { type: 'button', class: 'chip-btn' }, [tr('teach.qr')]);
        var bDel = h('button', { type: 'button', class: 'chip-btn t-del-hw', 'aria-label': tr('teach.delete') + ': ' + it.title }, [tr('teach.delete')]);
        var bRes = it.cloud ? h('button', { type: 'button', class: 'chip-btn t-res-btn' }, [tr('teach.results'), h('span', { class: 't-res-n', text: String(it.count || 0) })]) : null;
        if (bRes) { bRes.setAttribute('aria-label', tr('teach.resultsOf', { t: it.title }) + ' · ' + d.trn('teach.students', it.count || 0)); bRes.onclick = function () { openResults(it); }; }
        bCopy.onclick = function () { copy(it.link); };
        bQr.onclick = function () { showClass(it); };
        if (it.cloud) bDel.onclick = function () { // results go with it: ask once, right on the button
          if (bDel.dataset.sure !== '1') { bDel.dataset.sure = '1'; bDel.textContent = tr('teach.deleteSure'); bDel.classList.add('sure'); setTimeout(function () { if (document.contains(bDel)) { bDel.dataset.sure = ''; bDel.textContent = tr('teach.delete'); bDel.classList.remove('sure'); } }, 5000); return; }
          bDel.disabled = true;
          cloud.rest('homework?id=eq.' + encodeURIComponent(it.id), { method: 'DELETE', auth: 'need' }).then(function () {
            store.list = store.list.filter(function (x) { return x.id !== it.id; }); save();
            if (cloudList) cloudList = cloudList.filter(function (x) { return x.id !== it.id; });
            renderList(); d.toast(tr('teach.deletedCloud'), 'ok', 4000);
          }, function (e) { bDel.disabled = false; d.toast(tr(e && e.code === 'offline' ? 'teach.cloudOffline' : 'teach.cloudErr'), 'err', 5000); });
        };
        else bDel.onclick = function () {
          var before = store.list.slice();
          store.list = store.list.filter(function (x) { return x !== it; }); save(); renderList();
          d.toast(tr('teach.deleted'), 'ok', 7000, { label: tr('undo.action'), run: function () { store.list = before; save(); renderList(); } });
        };
        list.appendChild(h('li', { class: 't-item' }, [
          h('div', { class: 't-item-copy' }, [h('strong', { text: it.title }), h('span', { class: 'mini', text: metaLine(Object.assign({}, it, { due: '' })) }), due]),
          h('div', { class: 't-item-actions' }, [bRes, bCopy, bQr, bDel])
        ]));
      });
    }

    /* account: sign-in card, homework from the cloud, results */
    function renderCloud() {
      var box = $('tCloud');
      if (!cloud.ready()) { box.hidden = true; return; }
      var u = cloud.user();
      box.hidden = false;
      box.classList.toggle('on', Boolean(u));
      $('tCloudTitle').textContent = tr(u ? 'teach.cloudOnTitle' : 'teach.cloudOffTitle');
      $('tCloudText').textContent = u ? tr('teach.cloudOn', { e: u.email || '' }) : tr('teach.cloudOff');
      $('tCloudBtn').hidden = Boolean(u);
      $('tCloudState').textContent = u && cloudState ? tr(cloudState) : '';
      $('tCloudState').hidden = !(u && cloudState);
    }
    var loading = null;
    function refreshCloud() {
      if (!signedIn()) { cloudList = null; cloudState = ''; renderCloud(); renderList(); return Promise.resolve(); }
      if (loading) return loading;
      loading = cloud.rest('homework?select=id,title,source,target,n,due,link,created_at,homework_results(count)&order=created_at.desc&limit=200', { auth: 'need' })
        .then(function (rows) { cloudList = fromCloud(rows, codes); cloudState = ''; },
          function (e) { cloudState = e && e.code === 'offline' ? 'teach.cloudOffline' : e && e.status === 404 ? 'teach.cloudNotSetUp' : 'teach.cloudErr'; })
        .then(function () { loading = null; renderCloud(); renderList(); });
      return loading;
    }
    var resultsOf = null, resultsOpener = null;
    async function openResults(it) {
      resultsOf = it; resultsOpener = document.activeElement;
      $('tResTitle').textContent = it.title;
      $('tResMeta').textContent = metaLine(it);
      $('tResults').hidden = false;
      $('tResClose').focus();
      await loadResults();
    }
    async function loadResults() {
      var it = resultsOf; if (!it) return;
      var body = $('tResRows'); body.textContent = '';
      $('tResSummary').textContent = tr('teach.resLoading'); $('tResEmpty').hidden = true; $('tResTable').hidden = true;
      var rows;
      try { rows = summarize(await cloud.rest('homework_results?select=student_name,answered,correct,words,attempts,first_at,last_at&homework_id=eq.' + encodeURIComponent(it.id) + '&order=last_at.desc&limit=500', { auth: 'need' }), it.due); }
      catch (e) { $('tResSummary').textContent = tr(e && e.code === 'offline' ? 'teach.cloudOffline' : 'teach.cloudErr'); return; }
      if (resultsOf !== it) return;
      it.count = rows.length; renderList();
      if (!rows.length) { $('tResSummary').textContent = ''; $('tResEmpty').hidden = false; return; }
      var avg = Math.round(rows.reduce(function (a, r) { return a + r.acc; }, 0) / rows.length);
      $('tResSummary').textContent = d.trn('teach.students', rows.length) + ' · ' + tr('teach.resAvg', { p: avg });
      var fmt = function (t) { try { return new Date(t).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
      rows.forEach(function (r) {
        var accCls = r.acc >= 85 ? 'good' : r.acc >= 60 ? 'ok' : 'low';
        body.appendChild(h('tr', {}, [
          h('th', { scope: 'row' }, [h('span', { class: 't-res-name', text: r.name }), r.late ? h('span', { class: 't-late', text: tr('teach.late') }) : null]),
          h('td', { text: d.trn('teach.times', r.attempts) }),
          h('td', { text: String(r.answered) }),
          h('td', {}, [h('span', { class: 't-acc ' + accCls, text: r.acc + '%' })]),
          h('td', { class: 't-when', text: fmt(r.last) })
        ]));
      });
      $('tResTable').hidden = false;
    }
    function closeResults() {
      if ($('tResults').hidden) return;
      $('tResults').hidden = true; resultsOf = null;
      if (resultsOpener && resultsOpener.focus && document.contains(resultsOpener)) resultsOpener.focus();
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
    $('tForm').onsubmit = submit;
    $('tBack').onclick = function () { token++; setBusy(false); showOnly('form'); $('tWords').focus(); };
    $('tPublish').onclick = publish;
    $('tCopy').onclick = function () { if (made) copy(made.link); };
    $('tShareNative').onclick = function () { if (made) navigator.share({ title: made.title, text: tr('teach.shareText', { t: made.title }), url: made.link }).catch(function () {}); };
    $('tShowClass').onclick = function () { if (made) showClass(made); };
    $('tTry').onclick = function () { if (made) tryIt(made); };
    $('tAnother').onclick = another;
    $('tClassClose').onclick = closeClass;
    $('tClass').addEventListener('click', function (e) { if (e.target === this) closeClass(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('tClass').hidden) closeClass();
      else if (e.key === 'Escape' && !$('tResults').hidden) { e.preventDefault(); closeResults(); }
    });
    $('tResClose').onclick = closeResults;
    $('tResRefresh').onclick = loadResults;
    $('tResults').addEventListener('click', function (e) { if (e.target === this) closeResults(); });
    $('tCloudBtn').onclick = function () { if (cloud.open) cloud.open(); };
    document.addEventListener('vm-account', function () { renderCloud(); refreshCloud(); });
    document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && !$('tClass').hidden) closeClass(); });
    updateCount(); renderCloud(); renderList();

    return {
      open: function () { store = load(); fillLangs(); renderCloud(); renderList(); refreshCloud(); },
      cloudChanged: function () { renderCloud(); refreshCloud(); },
      relabel: function () { fillLangs(); updateCount(); renderCloud(); renderList(); if (resultsOf) loadResults(); if (!$('tReview').hidden) renderRows(); if (made && !$('tDone').hidden) $('tDoneName').textContent = made.title + ' · ' + metaLine(made); }
    };
  }

  return { OUTBOX: OUTBOX, LINKS: LINKS, STUDENT: STUDENT, newId: newId, cloudRow: cloudRow, fromCloud: fromCloud, mergeLists: mergeLists, summarize: summarize, addReport: addReport, rpcBody: rpcBody, student: student, KEY: KEY, MAX_WORDS: MAX_WORDS, CLASS_QR: CLASS_QR, normalizeStore: normalizeStore, addToList: addToList, daysLeft: daysLeft, formatDay: formatDay, todayISO: todayISO, rowsFrom: rowsFrom, exampleWords: exampleWords, validDay: validDay, mount: mount };
});
