// «Разрежь слово» (v2.54): the pure rules of the second game.
const assert = require('node:assert/strict');
const { rules: R } = require('../slice.js');
const { rules: S } = require('../soar.js');

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const card = (o, t) => ({ original: o, translation: t });
const deck = [card('apple', 'яблоко'), card('pear', 'груша'), card('plum', 'слива'), card('to give up', 'сдаваться; бросать'), card('cherry', 'вишня'), card('Apple', 'яблоко (2)')];

// pace: calm start, faster later, a 4th tile only after 8 right cuts and never in the calm pace, capped
const a = R.tuning(0), b = R.tuning(25), c = R.tuning(99), calm = R.tuning(25, true);
assert(b.gravity > a.gravity && b.stagger < a.stagger, 'the tosses get faster');
assert.deepEqual(c, b, 'the pace has a ceiling');
assert.equal(R.tuning(7).tiles, 3); assert.equal(R.tuning(8).tiles, 4); assert.equal(R.tuning(30, true).tiles, 3);
assert(calm.gravity < b.gravity, 'the calm pace stays slower');

// a toss: one right tile, different wrong ones from the deck, keys 1…n, the prompt is the meaning
const r = rng(5);
for (let i = 0; i < 300; i++) {
  const n = i % 2 ? 3 : 4, v = R.makeVolley(deck, [], n, r);
  assert.equal(v.tiles.filter(t => t.right).length, 1, 'exactly one right tile');
  const right = v.tiles.find(t => t.right);
  assert.equal(right.word, S.short(v.card.original));
  assert.equal(v.prompt, S.short(v.card.translation, 40));
  const low = v.tiles.map(t => t.word.toLowerCase());
  assert.equal(new Set(low).size, low.length, 'no two tiles read the same (apple / Apple)');
  assert.deepEqual(v.tiles.map(t => t.key), v.tiles.map((_, k) => k + 1));
  assert(v.tiles.length >= 3 && v.tiles.length <= n);
}
const spots = new Set(); for (let i = 0; i < 80; i++) spots.add(R.makeVolley(deck, [], 3, r).tiles.findIndex(t => t.right));
assert.equal(spots.size, 3, 'the right tile is not always in the same place');
assert.equal(R.makeVolley([card('a', 'б')], [], 3, r), null, 'one word cannot make a toss');

// launches: start below the field, reach the planned top inside the field, stay on screen sideways
for (let i = 0; i < 300; i++) {
  const gr = R.tuning(i % 30).gravity, L = R.launch(gr, r, i % 4, 4);
  assert(L.y > 1 && L.vy < 0);
  const top = L.y - (L.vy * L.vy) / (2 * gr);
  assert(Math.abs(top - L.apex) < 1e-9 && top >= 0.15 && top <= 0.45, 'the arc tops out inside the field, under the prompt');
  const flight = 2 * -L.vy / gr, xEnd = L.x + L.vx * flight;
  assert(L.x > 0.05 && L.x < 0.95 && xEnd > 0.02 && xEnd < 0.98, 'tiles stay on screen');
}

// the blade: crossing, touching and missing a tile
const box = { x: 100, y: 100, w: 80, h: 40 };
assert(R.segmentHits({ x: 0, y: 100 }, { x: 200, y: 100 }, box), 'a swipe across cuts');
assert(R.segmentHits({ x: 100, y: 100 }, { x: 100, y: 100 }, box), 'a tap on the tile cuts');
assert(!R.segmentHits({ x: 0, y: 0 }, { x: 200, y: 10 }, box), 'a swipe above misses');
assert(R.segmentHits({ x: 0, y: 124 }, { x: 200, y: 124 }, box, 6), 'a near miss within the padding still cuts');
assert.equal(R.HEARTS, 3);
console.log('✓ Slice: rising capped pace, calm option, fair tosses with one right tile, arcs inside the field, blade hits');
