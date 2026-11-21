/* For teachers (v2.55): homework meta travels in a deck link, strict decoding, and the teacher's saved list. */
const assert = require('node:assert/strict');
const S = require('../share');
const T = require('../teacher');
const { LANGS } = require('../ai-core');
const CODES = Object.keys(LANGS);

async function rawLink(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return '1.' + Buffer.from(new Uint8Array(await new Response(stream).arrayBuffer())).toString('base64url');
}
const rejects = async (obj, why) => assert.rejects(S.decodeDeck(await rawLink(obj), CODES), e => e.code === 'bad-deck', why);

(async () => {
  // round trip with homework meta
  const deck = { name: 'Unit 5 — Travel', source: 'en', target: 'ru', hw: { by: '  Ms.   Karimova ', due: '2026-11-28', note: 'Выучите к пятнице' },
    cards: [{ original: 'travel', translation: 'путешествие', examples: ['We travel a lot.'] }, { original: 'luggage', translation: 'багаж' }] };
  const back = await S.decodeDeck(await S.encodeDeck(deck), CODES);
  assert.deepEqual(back.hw, { by: 'Ms. Karimova', due: '2026-11-28', note: 'Выучите к пятнице' });
  assert.equal(back.name, 'Unit 5 — Travel');
  assert.equal(back.cards.length, 2);

  // homework without any detail is still homework; a bad date is dropped when encoding
  const bare = await S.decodeDeck(await S.encodeDeck(Object.assign({}, deck, { hw: { due: '2026-02-30' } })), CODES);
  assert.deepEqual(bare.hw, { by: '', due: '', note: '' });
  // an ordinary shared deck has no homework
  const plain = await S.decodeDeck(await S.encodeDeck(Object.assign({}, deck, { hw: undefined })), CODES);
  assert.equal(plain.hw, undefined);
  assert.equal(S.payloadOf({ source: 'en', target: 'ru', cards: deck.cards }).h, undefined);

  // strict decoding of hand-made links
  const ok = { v: 1, s: 'en', t: 'ru', c: [['a', 'b']] };
  await rejects(Object.assign({}, ok, { h: 'x' }), 'homework must be an object');
  await rejects(Object.assign({}, ok, { h: [] }), 'not an array');
  await rejects(Object.assign({}, ok, { h: { b: 'x'.repeat(41) } }), 'teacher name too long');
  await rejects(Object.assign({}, ok, { h: { m: 'x'.repeat(201) } }), 'note too long');
  await rejects(Object.assign({}, ok, { h: { d: '28.11.2026' } }), 'date format');
  await rejects(Object.assign({}, ok, { h: { d: '2026-13-01' } }), 'impossible date');
  await rejects(Object.assign({}, ok, { h: { b: 5 } }), 'name must be text');
  const ctl = await S.decodeDeck(await rawLink(Object.assign({}, ok, { h: { b: 'A\u0000B', m: 'x y' } })), CODES);
  assert.deepEqual(ctl.hw, { by: 'A B', due: '', note: 'x y' }, 'control characters become spaces');

  // dates
  assert.equal(T.validDay('2024-02-29'), true);
  assert.equal(T.validDay('2025-02-29'), false);
  const now = new Date(2026, 10, 21, 13, 0).getTime();
  assert.equal(T.daysLeft('2026-11-21', now), 0);
  assert.equal(T.daysLeft('2026-11-22', now), 1);
  assert.equal(T.daysLeft('2026-11-20', now), -1);
  assert.equal(T.daysLeft('', now), null);
  assert.equal(T.todayISO(now), '2026-11-21');
  assert.match(T.formatDay('2026-11-28', 'en'), /28/);
  assert.equal(T.formatDay('nope', 'en'), '');

  // check-table rows: pairs keep their translation, single words wait for one
  const rows = T.rowsFrom([{ original: 'apple', translation: 'яблоко', pretranslated: true }, { original: 'pear', translation: '', pretranslated: false }]);
  assert.deepEqual(rows, [{ original: 'apple', translation: 'яблоко', examples: [], auto: false }, { original: 'pear', translation: '', examples: [], auto: true }]);
  assert.equal(T.rowsFrom(Array.from({ length: 400 }, (_, i) => ({ original: 'w' + i, pretranslated: false }))).length, T.MAX_WORDS);
  assert.match(T.exampleWords('de'), /Koffer/);
  assert.match(T.exampleWords('xx'), /luggage/);

  // the saved list keeps only well-formed homework
  const link = 'https://wordzone.app/#deck=' + await S.encodeDeck(deck);
  const store = T.normalizeStore({ last: { source: 'en', target: 'zz', by: 'Ms. K' }, list: [
    { id: 'a', title: 'Unit 5', source: 'en', target: 'ru', n: 2, due: '2026-11-28', created: 1, link },
    { id: 'b', title: 'Evil', source: 'en', target: 'ru', n: 2, created: 1, link: 'javascript:alert(1)#deck=1.x' },
    { id: 'c', title: 'Bad lang', source: 'xx', target: 'ru', n: 2, created: 1, link },
    { id: 'd', title: 'x'.repeat(99), source: 'en', target: 'ru', n: 9999, due: 'soon', created: -4, link },
    null, 'text'
  ] }, CODES);
  assert.deepEqual(store.last, { source: 'en', by: 'Ms. K' });
  assert.deepEqual(store.list.map(x => x.id), ['a', 'd']);
  assert.equal(store.list[1].title.length, 60);
  assert.equal(store.list[1].n, T.MAX_WORDS);
  assert.equal(store.list[1].due, '');
  assert.equal(store.list[1].created, 0);
  assert.deepEqual(T.normalizeStore('garbage', CODES), { list: [], last: {} });
  const added = T.addToList(store, { id: 'a', title: 'Unit 5 v2', source: 'en', target: 'ru', n: 3, due: '', created: 2, link });
  assert.deepEqual(added.list.map(x => x.title), ['Unit 5 v2', 'x'.repeat(60)], 'the same homework is replaced, newest first');
  let big = { list: [], last: {} };
  for (let i = 0; i < 50; i++) big = T.addToList(big, { id: 'h' + i, link });
  assert.equal(big.list.length, 40);


  // ---------- v2.56: cloud homework and student results ----------
  const id = T.newId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  let seed = 1; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  assert.match(T.newId(rand), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'fallback without crypto.randomUUID');

  // the homework id rides in the link; a broken one is refused
  const withId = await S.decodeDeck(await S.encodeDeck(Object.assign({}, deck, { hw: { by: 'T', id: id.toUpperCase() } })), CODES);
  assert.equal(withId.hw.id, id, 'id kept, lower-cased');
  assert.equal((await S.decodeDeck(await S.encodeDeck(Object.assign({}, deck, { hw: { id: 'not-a-uuid' } })), CODES)).hw.id, undefined);
  await rejects(Object.assign({}, ok, { h: { i: 'x' } }), 'bad homework id');
  await rejects(Object.assign({}, ok, { h: { i: 5 } }), 'id must be text');

  // rows from Supabase → list items (with the results count); bad rows dropped
  const cl = T.fromCloud([
    { id, title: 'Unit 5', source: 'en', target: 'ru', n: 6, due: '2026-11-28', link, created_at: '2026-11-21T09:00:00Z', homework_results: [{ count: 3 }] },
    { id: 'nope', title: 'x', source: 'en', target: 'ru', link, created_at: '2026-11-21T09:00:00Z' },
    { id: T.newId(), title: 'Evil', source: 'en', target: 'ru', link: 'javascript:1', created_at: 'x' }, null
  ], CODES);
  assert.equal(cl.length, 1);
  assert.deepEqual([cl[0].cloud, cl[0].count, cl[0].due, cl[0].created], [true, 3, '2026-11-28', Date.parse('2026-11-21T09:00:00Z')]);
  assert.deepEqual(T.cloudRow(cl[0]), { id, title: 'Unit 5', source: 'en', target: 'ru', n: 6, due: '2026-11-28', link });
  assert.equal(T.cloudRow(Object.assign({}, cl[0], { due: '' })).due, null);
  // the list: account homework + device-only older homework; a cloud item deleted elsewhere disappears
  const local = [{ id: 'hwold', created: 5, cloud: false }, { id: 'gone-id', created: 9, cloud: true }, { id, created: 1, cloud: true }];
  assert.deepEqual(T.mergeLists(local, cl).map(x => x.id), [id, 'hwold']);
  assert.equal(T.mergeLists(local, null), local, 'signed out: the device list as it is');
  assert.equal(T.normalizeStore({ list: [{ id: 'hwx', title: 't', source: 'en', target: 'ru', link, cloud: true }] }, CODES).list[0].cloud, false, 'cloud only with a real id');

  // results table
  const res = T.summarize([
    { student_name: 'Ali', answered: 20, correct: 18, words: 6, attempts: 2, first_at: '2026-11-22T10:00:00Z', last_at: '2026-11-23T10:00:00Z' },
    { student_name: 'Madina', answered: 10, correct: 99, words: 6, attempts: 1, first_at: '2026-11-30T10:00:00Z', last_at: '2026-11-30T10:00:00Z' },
    { student_name: 5 }, null
  ], '2026-11-28');
  assert.deepEqual(res.map(r => [r.name, r.acc, r.late, r.attempts]), [['Madina', 100, true, 1], ['Ali', 90, false, 2]]);
  assert.equal(T.summarize([{ student_name: 'A', answered: 0 }], '')[0].acc, 0);

  // the student's outbox adds practices up until they are sent
  let box = T.addReport([], { hw: id, key: 'k1234567', name: 'Ali', answered: 10, correct: 8, words: 6 });
  box = T.addReport(box, { hw: id, key: 'k1234567', name: 'Ali K', answered: 5, correct: 9, words: 4 });
  box = T.addReport(box, { hw: 'bad', key: 'k', answered: 3 });
  box = T.addReport(box, { hw: id, key: 'k1234567', answered: 0 });
  assert.deepEqual(box, [{ hw: id, key: 'k1234567', name: 'Ali K', answered: 15, correct: 13, words: 6 }]);
  assert.deepEqual(T.rpcBody(box[0]), { p_homework: id, p_student: 'k1234567', p_name: 'Ali K', p_answered: 15, p_correct: 13, p_words: 6 });

  // student(): link a deck, report, send through the account's REST (fake), keep when offline
  const mem = {}; global.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const calls = []; let mode = 'ok';
  const rest = async (path, o) => { calls.push([path, o.body]); if (mode === 'offline') { const e = new Error('offline'); e.code = 'offline'; throw e; } if (mode === 'gone') { const e = new Error('server'); e.code = 'server'; e.status = 404; throw e; } return null; };
  const st = T.student({ rest: () => rest });
  st.link('deck-1', id, '  Ali   Karimov ');
  assert.equal(st.name(), 'Ali Karimov');
  assert.equal(st.linked('deck-1'), id); assert.equal(st.linked('other'), null);
  assert.equal(await st.report('other', { answered: 5, correct: 5, words: 5 }), 0, 'a normal deck reports nothing');
  mode = 'offline';
  assert.equal(await st.report('deck-1', { answered: 10, correct: 7, words: 6 }), 0);
  assert.equal(JSON.parse(mem[T.OUTBOX]).length, 1, 'kept for later');
  mode = 'ok';
  assert.equal(await st.report('deck-1', { answered: 4, correct: 4, words: 6 }), 1);
  assert.equal(JSON.parse(mem[T.OUTBOX]).length, 0);
  const last = calls[calls.length - 1];
  assert.equal(last[0], 'rpc/submit_homework_result');
  assert.deepEqual([last[1].p_homework, last[1].p_name, last[1].p_answered, last[1].p_correct], [id, 'Ali Karimov', 14, 11], 'offline practice added to the next one');
  assert.match(last[1].p_student, /^[0-9a-f-]{36}$/);
  mode = 'gone'; await st.report('deck-1', { answered: 3, correct: 1, words: 2 });
  assert.equal(JSON.parse(mem[T.OUTBOX]).length, 0, 'homework deleted / not set up: dropped, not retried forever');
  assert.equal(await T.student({ rest: () => null }).flush(), 0, 'no account config: nothing sent');

  // account.client().rest(): the public key alone for a student, the user's token for a teacher
  const A = require('../account');
  const seen = []; const amem = {};
  const fakeFetch = async (url, o) => { seen.push([url, o.method, o.headers.Authorization || '']); return { ok: true, status: 200, text: async () => '[]' }; };
  const c = A.client({ url: 'https://p.supabase.co/', key: 'anon' }, { fetch: fakeFetch, storage: { getItem: k => amem[k] || null, setItem: (k, v) => { amem[k] = v; }, removeItem: k => { delete amem[k]; } } });
  await c.rest('rpc/submit_homework_result', { method: 'POST', body: {} });
  assert.deepEqual(seen[0], ['https://p.supabase.co/rest/v1/rpc/submit_homework_result', 'POST', '']);
  await assert.rejects(c.rest('homework', { auth: 'need' }), e => e.code === 'signed-out');
  amem[A.STORE] = JSON.stringify({ access: 'TOKEN', refresh: 'R', expires: Date.now() + 3600e3, user: { id: 'u', email: 'e' } });
  await c.rest('homework?select=id', { auth: 'need' });
  assert.deepEqual(seen[1], ['https://p.supabase.co/rest/v1/homework?select=id', 'GET', 'Bearer TOKEN']);

  console.log('✓ Teachers v2.56: homework id in links, cloud list, results table, student outbox and sending');
  console.log('✓ Teachers: homework meta in deck links (strict), deadlines, check-table rows, saved homework list');
})().catch(e => { console.error(e); process.exit(1); });
