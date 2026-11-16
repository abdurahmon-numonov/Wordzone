// «Клёв» (v2.35): the pure rules of the fishing adventure.
const assert = require('node:assert/strict');
const F = require('../fishing');
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

assert.equal(F.SPECIES.length, 13, '13 species in the journal');
assert.equal(new Set(F.SPECIES.map(s => s.id)).size, 13, 'species ids are unique');
assert.deepEqual(F.LOCATIONS.map(l => l.id), ['lake', 'river', 'sea'], 'the journey: lake → river → sea');
for (const l of F.LOCATIONS) {
  assert.equal(l.quests.length, 3, l.id + ' has three quests');
  assert(F.SPECIES.some(s => s.id === l.boss.species), l.id + ' boss is drawn as a known species');
}

// species: only fish that live in the place, rarer with luck
for (let i = 0; i < 500; i++) {
  for (const l of F.LOCATIONS) { const id = F.rollSpecies(l.id, { combo: 9, bait: 4, hard: true }); assert(F.SPECIES.find(s => s.id === id).at.includes(l.id), id + ' lives in ' + l.id); }
}
const share = (w, i) => w[i] / w.reduce((a, b) => a + b, 0);
assert(share(F.tierWeights(4), 4) > share(F.tierWeights(0), 4) * 10, 'luck makes legendary fish far more likely');
let rareLucky = 0, rarePlain = 0;
for (let i = 0; i < 3000; i++) {
  const a = F.rollSpecies('river', { hard: true, bait: 2 }), b = F.rollSpecies('river', {});
  if (F.SPECIES.find(s => s.id === a).r >= 2) rareLucky++;
  if (F.SPECIES.find(s => s.id === b).r >= 2) rarePlain++;
}
assert(rareLucky > rarePlain * 1.6, 'hard words and bait lure rare fish: ' + rareLucky + ' vs ' + rarePlain);

// weight: a bigger rod and a quick pick add to it
const plain = F.weigh('carp', { rand: seq(0.5) }), better = F.weigh('carp', { rod: 4, fast: true, rand: seq(0.5) });
assert(Math.abs(better - plain * 1.4 * 1.25) <= 0.11, 'rod +10% per level, quick pick ×1.25');

// the fight: holding non-stop lands a small fish, snaps the line on a legend; easing off on surges lands it
const fight = (str, policy, gear) => { const f = F.newFight(str); let r = null, t = 0; while (!r && t < 60) { r = F.reelStep(f, 0.05, policy(f), gear || {}, seq(0.3, 0.7)); t += 0.05; } return { r, t }; };
assert.equal(fight(0.6, () => true).r, 'landed', 'a common fish comes in if you just hold');
assert.equal(fight(1.6, () => true).r, 'snapped', 'a legend snaps the line if you never let go');
assert.equal(fight(1.6, f => !f.surge && f.tension < 0.8).r, 'landed', 'easing off during surges lands a legend');
assert.equal(fight(0.8, () => false).r, 'escaped', 'never reeling lets the fish swim away');
const strong = fight(1.6, f => !f.surge && f.tension < 0.95, { line: 4 });
assert.equal(strong.r, 'landed', 'a stronger line forgives more');
// a boss cannot be reeled past its floor until its strength is broken
const boss = F.newFight(0.5, 0.4);
for (let i = 0; i < 400; i++) F.reelStep(boss, 0.05, boss.tension < 0.7, {}, seq(0.5));
assert(boss.dist >= 0.4, 'the boss stays out of reach');
boss.floor = null; let res = null;
for (let i = 0; i < 400 && !res; i++) res = F.reelStep(boss, 0.05, !boss.surge && boss.tension < 0.7, {}, seq(0.5));
assert.equal(res, 'landed', 'once tired, the boss can be landed');

// quests
const st = { caught: 4, kg: 11.6, tiers: [4, 2, 1, 0, 0], streak: 2, bestStreak: 3, misses: 1 };
assert.deepEqual(F.progress({ type: 'count', n: 5 }, st), { have: 4, need: 5 });
assert.equal(F.done({ type: 'rarity', min: 1, n: 2 }, st), true);
assert.equal(F.done({ type: 'kg', n: 12 }, st), false);
assert.equal(F.done({ type: 'streak', n: 3 }, st), true);
assert.equal(F.failed({ type: 'clean', n: 8, miss: 0 }, st), true, 'too many mistakes fail a clean quest');
assert.deepEqual([0, 1, 2, 3, 5].map(F.stars), [3, 2, 2, 1, 1]);

// the journey unlocks step by step
let s = F.defaults();
assert.deepEqual(F.nextStep(s), { loc: 'lake', kind: 'quest', qi: 0 });
assert.equal(F.questOpen(s, 'lake', 1), false); assert.equal(F.unlocked(s, 1), false);
s.story.lake.q = [3, 2, 1];
assert.equal(F.bossOpen(s, 'lake'), true);
assert.deepEqual(F.nextStep(s), { loc: 'lake', kind: 'boss' });
s.story.lake.boss = true;
assert.equal(F.unlocked(s, 1), true);
assert.deepEqual(F.nextStep(s), { loc: 'river', kind: 'quest', qi: 0 });
F.LOCATIONS.forEach(l => { s.story[l.id] = { q: [3, 3, 3], boss: true }; });
assert.equal(F.nextStep(s), null, 'the journey can be finished');

// tackle shop and saved state
s = F.defaults(); assert.equal(F.buy(s, 'rod'), null);
s.pearls = 1000; const s1 = F.buy(s, 'line');
assert.equal(s1.line, 1); assert.equal(s1.pearls, 950); assert.equal(s.line, 0, 'buy never mutates');
const c = F.clean({ pearls: -5, rod: 99, bait: 'x', seen: null, story: { lake: { q: [9, 'a', 2], boss: 'yes', met: true } } });
assert.equal(c.pearls, 0); assert.equal(c.rod, 4); assert.equal(c.bait, 0); assert.deepEqual(c.seen, {});
assert.deepEqual(c.story.lake, { q: [3, 0, 2], boss: false, met: true, bossSeen: false }, 'story progress is cleaned');
assert.deepEqual(c.story.sea.q, [0, 0, 0]);

// journal
const j = F.defaults();
assert.equal(F.log(j, { id: 'perch', kg: 1.2 }), true); assert.equal(F.log(j, { id: 'perch', kg: 2.1 }), false);
assert.deepEqual(j.seen.perch, { n: 2, best: 2.1 });
assert.equal(F.hardWord({ fails: 1 }), true); assert.equal(F.hardWord({ ease: 2.5 }), false);

console.log('✓ fishing: journey unlocks, species per place, luck, weights, the reel fight, boss floor, quests, stars, tackle, journal');
