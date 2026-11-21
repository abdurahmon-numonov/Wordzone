// «Взлёт» (v2.53): the pure rules of the Games screen's game.
const assert = require('node:assert/strict');
const { rules: R } = require('../soar.js');

// a tiny seeded generator, so every run of this test sees the same walls
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const card = (o, t, extra) => Object.assign({ original: o, translation: t }, extra || {});
const deck = [card('apple', 'яблоко'), card('pear', 'груша'), card('plum', 'слива'), card('to give up', 'сдаваться; бросать'), card('cherry', 'вишня')];

// short forms on the gates
assert.equal(R.short('сдаваться; бросать'), 'сдаваться', 'only the first meaning goes on a gate');
assert.equal(R.short('a very long phrase that never ends at all', 12), 'a very long…');
assert.equal(R.usable([card('x', ''), card('', 'y'), card('ok', 'да')]).length, 1, 'cards without a word or a translation are skipped');

// pace: starts calm, gets faster and tighter, is capped, and the calm option keeps it slower
const t0 = R.tuning(0), t30 = R.tuning(30), t99 = R.tuning(99), calm = R.tuning(30, true);
assert(t30.speed > t0.speed && t30.gap < t0.gap && t30.spacing < t0.spacing, 'the flight speeds up as you answer');
assert.deepEqual(t99, t30, 'the pace has a ceiling');
assert(calm.speed < t30.speed && calm.gap > t30.gap, 'the calm pace stays slower');
assert(t30.gap >= 0.18, 'gates never get too narrow to read and fly through');

// combo multiplier and points
assert.deepEqual([0, 2, 3, 5, 6, 9, 10, 40].map(R.multiplier), [1, 1, 2, 2, 3, 3, 4, 4]);
assert.equal(R.points(6), 30);

// walls: one right and one wrong gate, the right word for the prompt, the wrong one from the same deck
const r = rng(7);
for (let i = 0; i < 200; i++) {
  const w = R.makeWall(deck, [], r);
  assert.equal(w.prompt, R.short(w.card.translation, 40));
  const right = w[w.right], wrong = w[w.right === 'top' ? 'bottom' : 'top'];
  assert.equal(right, R.short(w.card.original));
  assert.notEqual(wrong.toLowerCase(), right.toLowerCase(), 'the two gates never read the same');
  assert(deck.some(c => R.short(c.original) === wrong), 'the wrong word comes from the deck');
}
// both gate positions are used
const sides = new Set(); for (let i = 0; i < 50; i++) sides.add(R.makeWall(deck, [], r).right);
assert.deepEqual([...sides].sort(), ['bottom', 'top']);
// a deck of one usable word cannot make a wall
assert.equal(R.makeWall([card('a', 'б')], [], r), null);

// recent words are not repeated at once; hard and due words come up more often
const counts = new Map();
const hard = card('lemon', 'лимон', { fails: 3 }), due = card('lime', 'лайм', { due: 1 });
const pool = [card('a', '1'), card('b', '2'), card('c', '3'), hard, due];
const r2 = rng(11);
for (let i = 0; i < 4000; i++) { const c = R.pickCard(pool, [pool[0]], r2, 1000); counts.set(c, (counts.get(c) || 0) + 1); }
assert.equal(counts.get(pool[0]) || 0, 0, 'a word just shown is skipped');
assert(counts.get(hard) > counts.get(pool[1]) * 2, 'hard words come up more often');
assert(counts.get(due) > counts.get(pool[1]) * 1.4, 'due words come up more often');

// gate layout: two gates inside the field, apart, and the plane height maps to the right gate
const r3 = rng(3);
for (let i = 0; i < 300; i++) {
  const gap = R.tuning(i % 40).gap, L = R.gateLayout(gap, r3);
  assert(L.top - gap / 2 >= 0.06 && L.bottom + gap / 2 <= 0.94, 'gates stay inside the field');
  assert(L.bottom - L.top >= gap + 0.13, 'a solid divider between the gates');
  assert.equal(R.gateAt(L.top, L), 'top'); assert.equal(R.gateAt(L.bottom, L), 'bottom');
  assert.equal(R.gateAt((L.top + L.bottom) / 2, L), null, 'the divider is a wall');
}
assert.equal(R.HEARTS, 3);
console.log('✓ Soar: short gate words, rising but capped pace, calm option, combo points, fair walls, weighted words, gate layout');
