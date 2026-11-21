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

  console.log('✓ Teachers: homework meta in deck links (strict), deadlines, check-table rows, saved homework list');
})().catch(e => { console.error(e); process.exit(1); });
