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


  // ---- v2.56: homework id in the link (results go to the teacher's account)
  const HID = '3f2b8c1e-5a47-4d0b-9c6e-0a1b2c3d4e5f';
  const tracked = await S.decodeDeck(await S.encodeDeck(Object.assign({}, deck, { hw: Object.assign({}, deck.hw, { id: HID.toUpperCase() }) })), CODES);
  assert.deepEqual(tracked.hw, { by: 'Ms. Karimova', due: '2026-11-28', note: 'Выучите к пятнице', id: HID }, 'the id travels in the link, in lower case');
  assert.equal((await S.decodeDeck(await S.encodeDeck(Object.assign({}, deck, { hw: { id: 'not-an-id' } })), CODES)).hw.id, undefined, 'a bad id is not put in a link');
  await rejects(Object.assign({}, ok, { h: { i: 'nope' } }), 'bad id');
  await rejects(Object.assign({}, ok, { h: { i: 5 } }), 'id must be text');
  await rejects(Object.assign({}, ok, { h: { i: HID + 'x' } }), 'id too long');
  assert.equal((await S.decodeDeck(await rawLink(Object.assign({}, ok, { h: { i: HID } })), CODES)).hw.id, HID);

  assert.equal(T.isId(HID), true); assert.equal(T.isId(HID.toUpperCase()), false, 'ids from the site are lower case'); assert.equal(T.isId('__proto__'), false);
  assert.match(T.newId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const noUuid = { getRandomValues: a => { a.forEach((_, i) => { a[i] = 255 - i; }); return a; } };
  assert.match(T.newId(noUuid), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'ids without randomUUID()');
  assert.throws(() => T.newId({}), /no-crypto/);

  // student: name and device key, decks that are homework, answers waiting to be sent
  assert.deepEqual(T.normalizeStudent({ key: HID, name: '  Ali   Valiyev ' }), { key: HID, name: 'Ali Valiyev' });
  assert.deepEqual(T.normalizeStudent({ key: 'x', name: 5 }), { key: '', name: '' });
  assert.deepEqual(T.normalizeStudent(null), { key: '', name: '' });
  let links = T.normalizeLinks({ 'en-ru#1': { id: HID }, bad: { id: 'x' }, '': { id: HID }, nope: 5 });
  assert.deepEqual(links, { 'en-ru#1': { id: HID } });
  links = T.rememberLink(links, 'en-ru#1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(links['en-ru#1'].id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a newer homework of the same deck replaces the old one');
  for (let i = 0; i < 80; i++) links = T.rememberLink(links, 'deck' + i, HID);
  assert.equal(Object.keys(links).length, 60); assert(links.deck79 && !links.deck0 && !links['en-ru#1'], 'the oldest are forgotten first');
  assert.deepEqual(T.normalizeLinks('x'), {}); assert.deepEqual(T.normalizeLinks([1]), {});

  let pending = {};
  pending = T.addTally(pending, HID, true, 6); pending = T.addTally(pending, HID, false, 6); pending = T.addTally(pending, HID, true, 9);
  assert.deepEqual(pending, { [HID]: { a: 3, c: 2, w: 9 } }, 'answers, correct answers, most words in one practice');
  assert.deepEqual(T.addTally(pending, 'bad id', true, 1), pending, 'an invalid id counts nothing');
  assert.deepEqual(T.normalizePending({ [HID]: { a: 2, c: 9, w: 999 }, x: { a: 1 }, [HID.replace('3f', '4f')]: { a: 0, c: 0 } }), { [HID]: { a: 2, c: 2, w: 300 } }, 'stored values are clamped, empty ones dropped');
  let taken = T.takeTally(pending, HID);
  assert.deepEqual(taken, { take: { answered: 3, correct: 2, words: 9 }, rest: {} });
  assert.equal(T.takeTally({}, HID).take, null);
  const chunk = T.takeTally({ [HID]: { a: 4500, c: 4000, w: 12 } }, HID);
  assert.deepEqual(chunk.take, { answered: 2000, correct: 2000, words: 12 }, 'one result never has more than 2000 answers');
  assert.deepEqual(chunk.rest, { [HID]: { a: 2500, c: 2000, w: 12 } }, 'the rest waits and still has correct ≤ answered');
  const again = T.takeTally(chunk.rest, HID);
  assert.deepEqual(again.take, { answered: 2000, correct: 2000, words: 12 });
  assert.deepEqual(T.takeTally(again.rest, HID).take, { answered: 500, correct: 0, words: 12 });
  assert.deepEqual(T.giveBack({}, HID, taken.take), { [HID]: { a: 3, c: 2, w: 9 } }, 'a send that failed is put back');
  assert.deepEqual(T.giveBack({ [HID]: { a: 1, c: 1, w: 12 } }, HID, taken.take), { [HID]: { a: 4, c: 3, w: 12 } });

  // teacher: what the database returns is checked, lists merge, results are summed and sorted
  const cloudRows = T.normalizeCloud([
    { id: HID, title: 'Unit 5', source: 'en', target: 'ru', n: 3, due: '2026-11-28', link, created_at: '2026-11-20T10:00:00Z' },
    { id: 'x', title: 'bad id', source: 'en', target: 'ru', n: 3, link },
    { id: HID.replace('3f', '4f'), title: 'bad link', source: 'en', target: 'ru', n: 3, link: 'javascript:alert(1)#deck=1.x' },
    { id: HID.replace('3f', '5f'), title: 'bad lang', source: 'xx', target: 'ru', n: 3, link },
    { id: HID.replace('3f', '6f'), title: null, source: 'de', target: 'ru', n: 9999, due: null, link, created_at: 'nope' }, null, 'text'
  ], CODES);
  assert.deepEqual(cloudRows.map(x => x.title), ['Unit 5', '—']);
  assert.deepEqual([cloudRows[0].cloud, cloudRows[0].due, cloudRows[0].created > 0, cloudRows[1].n, cloudRows[1].due, cloudRows[1].created], [true, '2026-11-28', true, T.MAX_WORDS, '', 0]);
  assert.deepEqual(T.normalizeCloud('x', CODES), []);
  const localList = [{ id: HID, title: 'old copy', created: 1, cloud: true }, { id: 'hw1', title: 'this device', created: 5 }, { id: 'gone', title: 'deleted elsewhere', created: 9, cloud: true }];
  assert.deepEqual(T.mergeLists(localList, cloudRows, true).map(x => x.title), ['Unit 5', 'this device', '—'], 'the account copy wins, a homework deleted elsewhere is hidden, newest first');
  assert.deepEqual(T.mergeLists(localList, [], false).map(x => x.id), ['gone', 'hw1', HID], 'account not read (offline): the device list stays as it is');
  assert.equal(T.normalizeStore({ list: [{ id: HID, title: 'a', source: 'en', target: 'ru', n: 1, link, cloud: true }, { id: 'hw2', title: 'b', source: 'en', target: 'ru', n: 1, link, cloud: true }] }, CODES).list.map(x => !!x.cloud).join(), 'true,false', 'only a real id can be marked as tracked');

  const rowsIn = T.normalizeResults([
    { student_key: 'aaaaaaaa-1', student_name: ' Ali ', answered: 50, correct: 45, words: 20, attempts: 3, first_at: '2026-11-20T08:00:00Z', last_at: '2026-11-21T08:00:00Z' },
    { student_key: 'bbbbbbbb-2', student_name: 'Vali', answered: 20, correct: 8, words: 20, attempts: 1, first_at: '2026-11-19T08:00:00Z', last_at: '2026-11-19T09:00:00Z' },
    { student_key: 'cccccccc-3', student_name: '', answered: 10, correct: 99, words: 999, attempts: 0 },
    { student_key: 'bad key!', student_name: 'x' }, null
  ]);
  assert.equal(rowsIn.length, 3);
  assert.deepEqual([rowsIn[0].name, rowsIn[2].name, rowsIn[2].correct, rowsIn[2].words, rowsIn[2].attempts, rowsIn[2].last], ['Ali', '—', 10, 300, 1, 0], 'odd values are clamped');
  assert.equal(T.accuracy(rowsIn[0]), 90); assert.equal(T.accuracy({ answered: 0, correct: 0 }), 0);
  assert.deepEqual(T.summarize(rowsIn), { students: 3, answered: 80, correct: 63, accuracy: 79 });
  assert.deepEqual(T.summarize([]), { students: 0, answered: 0, correct: 0, accuracy: 0 });
  assert.deepEqual(T.sortRows(rowsIn, 'recent').map(r => r.name), ['Ali', 'Vali', '—']);
  assert.deepEqual(T.sortRows(rowsIn, 'name').map(r => r.name), ['—', 'Ali', 'Vali']);
  assert.deepEqual(T.sortRows(rowsIn, 'accuracy').map(r => r.name), ['Vali', 'Ali', '—'], 'weakest first');
  assert.equal(T.sortRows(rowsIn, 'practice')[0].name, 'Ali');
  assert.equal(T.sortRows(rowsIn, 'unknown')[0].name, 'Ali', 'an unknown order falls back to recent');
  console.log('✓ Teachers: homework meta in deck links (strict), deadlines, check-table rows, saved homework list, homework id in links, student tracking, results');
})().catch(e => { console.error(e); process.exit(1); });
