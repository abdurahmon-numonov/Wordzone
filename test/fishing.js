// «Клёв» (v2.35): the pure rules of the fishing game.
const assert = require('node:assert/strict');
const F = require('../fishing');

// a deterministic generator that returns the given values in turn
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

assert.equal(F.SPECIES.length, 13, '13 species in the journal');
assert.deepEqual([...new Set(F.SPECIES.map(s => s.r))].sort(), [0, 1, 2, 3, 4], 'every rarity tier has fish');
assert.equal(new Set(F.SPECIES.map(s => s.id)).size, F.SPECIES.length, 'species ids are unique');

// speed: the faster the answer, the better the odds
assert.equal(F.speedScore(900), 3); assert.equal(F.speedScore(2000), 2); assert.equal(F.speedScore(3500), 1); assert.equal(F.speedScore(5000), 0);
const slow = F.tierWeights(0), fast = F.tierWeights(5);
const share = (w, i) => w[i] / w.reduce((a, b) => a + b, 0);
assert(share(fast, 4) > share(slow, 4) * 10, 'a high score makes legendary fish far more likely');
assert(share(fast, 0) < share(slow, 0), 'and common fish less likely');

// rollCatch: junk on a very slow answer, never a legendary fish after 3 s, weights inside the range
assert.equal(F.rollCatch(7000, { rand: seq(0.1) }).id, 'boot', 'a very slow answer can pull out an old boot');
for (let i = 0; i < 400; i++) {
  const c = F.rollCatch(3200 + Math.random() * 3000, { combo: 9, bait: 4, hard: true });
  assert(c.tier !== 4, 'no legendary fish on a slow answer');
}
let legend = 0, chests = 0;
for (let i = 0; i < 4000; i++) {
  const c = F.rollCatch(800, { combo: 6, bait: 4, hard: true });
  if (c.id === 'chest') { chests++; assert(c.pearls >= 20 && c.pearls <= 50); continue; }
  const sp = F.SPECIES.find(s => s.id === c.id);
  assert(sp, 'a known species: ' + c.id);
  assert(c.kg >= Math.max(0.1, Math.round(sp.kg[0] * 10) / 10) && c.kg <= Math.round(sp.kg[1] * 10) / 10 + 0.05, c.id + ' weight in range: ' + c.kg);
  if (c.tier === 4) legend++;
}
assert(legend > 40, 'quick answers with good tackle do land legends: ' + legend);
assert(chests > 100 && chests < 400, 'chests come up about 6% of the time: ' + chests);
// tackle and golden hour scale the weight
const base = F.rollCatch(1000, { rand: seq(0.5, 0.5, 0.0, 0.0, 0.5) });
const boosted = F.rollCatch(1000, { rod: 4, golden: true, rand: seq(0.5, 0.5, 0.0, 0.0, 0.5) });
assert.equal(boosted.id, base.id);
assert(Math.abs(boosted.kg - base.kg * 1.6 * 2) <= 0.11, 'rod +15% per level and golden hour ×2');

// tackle shop: costs grow, never below zero pearls, maxed upgrades stop
let s = F.defaults();
assert.equal(F.buy(s, 'rod'), null, 'no pearls, no purchase');
s.pearls = 1000;
const s1 = F.buy(s, 'rod');
assert.equal(s1.rod, 1); assert.equal(s1.pearls, 960); assert.equal(s.rod, 0, 'buy never mutates');
let r = s;
for (let i = 0; i < 3; i++) r = F.buy(r, 'reel');
assert.equal(r.reel, 3); assert.equal(F.cost(r, 'reel'), null); assert.equal(F.buy(r, 'reel'), null, 'maxed out');
assert.equal(F.roundSeconds(r), 120, '90 s + 10 s per reel level');
assert.equal(F.pearlsFor(37.6), 38);

// journal: new species are reported once, best weights kept
const j = F.defaults();
assert.equal(F.log(j, { id: 'perch', kg: 1.2 }), true);
assert.equal(F.log(j, { id: 'perch', kg: 2.1 }), false);
assert.deepEqual(j.seen.perch, { n: 2, best: 2.1 });
assert.deepEqual(j.biggest, { id: 'perch', kg: 2.1 });
assert.equal(F.log(j, { id: 'boot', kg: 0.5 }), false, 'junk is not a species');

// saved state is cleaned: bad numbers, out-of-range levels
const c = F.clean({ pearls: -5, rod: 99, bait: 'x', seen: null });
assert.equal(c.pearls, 0); assert.equal(c.rod, 4); assert.equal(c.bait, 0); assert.deepEqual(c.seen, {});

// hard words lure rare fish
assert.equal(F.hardWord({ fails: 1 }), true); assert.equal(F.hardWord({ ease: 2.1 }), true); assert.equal(F.hardWord({ ease: 2.5 }), false);

console.log('✓ fishing: species, odds, catches, tackle shop, journal, saved state');
