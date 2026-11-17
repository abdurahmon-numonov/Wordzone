// «Оборона» (v2.37): the pure rules of the tower defense, including a balance simulation.
const assert = require('node:assert/strict');
const D = require('../defense');
const cards = ['journey:путешествие', 'brave:храбрый', 'deep:глубокий', 'weather:погода', 'quiet:тихий', 'narrow:узкий']
  .map(s => { const [original, translation] = s.split(':'); return { original, translation }; });
const rng = seed => () => (seed = (seed * 9301 + 49297) % 233280) / 233280;

// levels: five places, the last with the King; towers unlock along the way
assert.equal(D.LEVELS.length, 5, 'five places');
assert.deepEqual(D.LEVELS[0].towers, ['archer'], 'the valley starts with archers only');
assert(D.LEVELS[1].towers.includes('samovar') && !D.LEVELS[1].towers.includes('tile'), 'the bridge adds the samovar');
assert.deepEqual(D.LEVELS[2].towers, ['archer', 'samovar', 'tile']);
assert(D.LEVELS[4].waves.at(-1).some(g => g.type === 'king'), 'the King comes in the last wave of the lair');
assert(D.LEVELS.slice(0, 4).every(l => l.waves.every(w => w.every(g => g.type !== 'king'))), 'no King before the lair');
D.LEVELS.forEach(l => {
  assert.equal(l.slots.length, 8, 'eight pads');
  const path = D.makePath(l.path);
  l.slots.forEach(([x, z]) => {
    let near = 99; for (let d = 0; d <= path.total; d += 0.1) { const p = path.at(d); near = Math.min(near, Math.hypot(p.x - x, p.z - z)); }
    assert(near > 1.2 && near < 3.4, `${l.id}: a pad sits beside the road, not on it and not far from it (${near.toFixed(2)})`);
  });
});

// the path: length, ends and interpolation
const p = D.makePath([[0, 0], [3, 0], [3, 4]]);
assert.equal(p.total, 7);
assert.deepEqual([p.at(0).x, p.at(0).z], [0, 0]);
assert.deepEqual([p.at(5).x, p.at(5).z], [3, 2]);
assert.deepEqual([p.at(99).x, p.at(99).z], [3, 4], 'clamped at the end');

// questions: four distinct translations, one right, recent words wait
for (let k = 0; k < 200; k++) {
  const q = D.makeQuestion(cards);
  assert.equal(q.options.length, 4);
  assert.equal(q.options.filter(o => o.right).length, 1);
  assert.equal(q.options.find(o => o.right).text, q.card.translation);
  assert.equal(new Set(q.options.map(o => o.text)).size, 4);
}
assert.equal(D.makeQuestion(cards.slice(0, 3)), null, 'a deck needs four words');
for (let k = 0; k < 30; k++) assert.equal(D.makeQuestion(cards, ['journey', 'brave', 'deep', 'weather', 'quiet']).word, 'narrow');

// coins for answers
assert.equal(D.answerCoins(0), 25, 'an instant answer: 15 + 10');
assert.equal(D.answerCoins(2000), 20);
assert.equal(D.answerCoins(9000), 15, 'a slow answer still pays the base');
assert.equal(D.answerCoins(9000, { wisdom: true }), 20, 'Wisdom adds 5');

// building, upgrading and selling
let g = D.createGame(0, {});
assert.equal(g.coins, D.START_COINS); assert.equal(g.lives, D.LIVES);
assert.equal(D.build(g, 0, 'samovar'), false, 'the samovar is not available in the valley');
assert.equal(D.build(g, 0, 'archer'), true); assert.equal(g.coins, D.START_COINS - 50);
assert.equal(D.build(g, 0, 'archer'), false, 'one tower per pad');
assert.equal(D.upgrade(g, 0), true); assert.equal(g.slots[0].tower.lv, 2); assert.equal(g.coins, D.START_COINS - 110);
assert.equal(D.upgrade(g, 0), false, 'not enough coins for level 3');
g.coins = 1000; assert.equal(D.upgrade(g, 0), true); assert.equal(D.upgrade(g, 0), false, 'level 3 is the top');
assert.equal(D.towerStats('archer', 3).dmg, 26); assert.equal(D.towerStats('archer', 3).range, 4.3);
const before = g.coins; assert.equal(D.sell(g, 0), true); assert.equal(g.coins - before, Math.floor((50 + 60 + 90) * 0.6), 'selling returns 60%');
assert.equal(g.slots[0].tower, null);
g = D.createGame(0, { treasury: true, walls: true });
assert.equal(g.coins, D.START_COINS + 60); assert.equal(g.lives, D.LIVES + 3);

// waves: nothing comes before the player starts the first one; later waves start on their own
g = D.createGame(0, {});
for (let t = 0; t < 60; t++) D.stepGame(g, 1);
assert.equal(g.phase, 'build'); assert.equal(g.enemies.length, 0, 'the first wave waits for the player');
assert.equal(D.startWave(g), true); assert.equal(D.startWave(g), false, 'one wave at a time');
// an undefended road: every Blot leaks
let res = null; for (let t = 0; t < 400 && !res; t += 0.1) res = D.stepGame(g, 0.1);
assert.equal(res, 'lose', 'without towers the Blots reach the gate');
assert.equal(g.lives, 0);

// slowing: a tile tower slows a Blot in range
g = D.createGame(2, {}); g.coins = 999;
D.build(g, 1, 'tile'); D.startWave(g);
let slowed = false; for (let t = 0; t < 30 && !slowed; t += 0.05) { D.stepGame(g, 0.05); slowed = g.enemies.some(e => e.slowT > 0); }
assert(slowed, 'the tile tower slows the Blots');

// the King's shield: damage is cut until three right answers in a row open it for a while
g = D.createGame(4, {});
const king = { id: 99, type: 'king', d: 1, hp: 1000, max: 1000, speed: 0, slowT: 0, x: 0, z: 0, boss: true, shield: true, shieldHits: 0, shieldT: 0 };
g.enemies.push(king); g.phase = 'wave';
g.slots[1].tower = { type: 'archer', lv: 3, cd: 0, aim: 0 }; king.x = g.slots[1].x; king.z = g.slots[1].z + 1;
const hpAt = () => king.hp;
D.chipShield(g); D.chipShield(g); D.missShield(g); assert.equal(king.shieldHits, 0, 'a mistake resets the shield');
D.chipShield(g); D.chipShield(g); assert.equal(D.chipShield(g), 'open'); assert.equal(king.shield, false);
for (let t = 0; t < 8; t += 0.1) D.stepGame(g, 0.1);
assert.equal(king.shield, true, 'the shield comes back after a while');
const shieldedHit = (() => { const h = hpAt(); g.shots.push({ id: 1000, kind: 'arrow', x: king.x, z: king.z, y: 1, to: 99, dmg: 100, speed: 99 }); D.stepGame(g, 0.01); return h - hpAt(); })();
assert(shieldedHit > 0 && shieldedHit <= 15 + 26 * 0.15 * 2, 'shielded: the King takes 15% damage');

// stars and scrolls
assert.equal(D.stars(10, 10), 3); assert.equal(D.stars(6, 10), 2); assert.equal(D.stars(5, 10), 1); assert.equal(D.stars(0, 10), 0);
assert.equal(D.scrollsFor(3), 25); assert.equal(D.scrollsFor(0), 0);
const s0 = D.defaults();
assert.equal(D.levelOpen(s0, 0), true); assert.equal(D.levelOpen(s0, 1), false); assert.equal(D.nextLevel(s0), 0);
assert.equal(D.buyPerk(s0, 'treasury'), null, 'perks cost scrolls');
const s1 = D.buyPerk(Object.assign(D.defaults(), { scrolls: 45 }), 'treasury');
assert.equal(s1.scrolls, 15); assert.equal(s1.perks.treasury, true); assert.equal(D.buyPerk(s1, 'treasury'), null, 'a perk is bought once');
const dirty = D.clean({ scrolls: -4, perks: { treasury: true, hack: true, walls: 'yes' }, levels: [3, 9, -1], best: 'x' });
assert.deepEqual(dirty.perks, { treasury: true }); assert.equal(dirty.scrolls, 0); assert.deepEqual(dirty.levels, [3, 3, 0, 0, 0]); assert.equal(dirty.best, 0);
assert(D.endlessWave(8).some(g2 => g2.type === 'king'), 'the King visits the endless defense every eighth wave');

// balance: a player who answers a word every 4 s with 80% accuracy and builds sensibly wins every place
function play(li, every, acc, seed) {
  const r = rng(seed), game = D.createGame(li, {}); let clock = 0, rot = 0;
  for (let t = 0; t < 900 && !game.over; t += 0.05) {
    clock += 0.05;
    if (clock >= every) { clock = 0; if (r() < acc) { game.coins += D.answerCoins(2500); D.chipShield(game); } else D.missShield(game); }
    const empty = game.slots.find(s => !s.tower);
    if (empty) { if (D.build(game, empty.i, game.cfg.towers[rot % game.cfg.towers.length])) rot++; }
    else { const s = game.slots.filter(x => D.upgradeCost(x.tower.type, x.tower.lv) != null).sort((a, b) => a.tower.lv - b.tower.lv)[0]; if (s) D.upgrade(game, s.i); }
    if (game.phase === 'build' && (game.wave === 0 ? t > 12 : game.buildT > 8)) D.startWave(game);
    D.stepGame(game, 0.05);
  }
  return game;
}
for (let li = 0; li < 5; li++) {
  const wins = [1, 2, 3, 4].filter(seed => play(li, 4, 0.8, seed).over === 'win').length;
  assert(wins >= 3, `place ${li + 1} is winnable for a steady player (${wins}/4)`);
}
// …and it is not free: a player who barely answers loses the later places
assert.equal(play(3, 12, 0.5, 1).over, 'lose', 'the night river needs words');
// the first place forgives a slow start
assert.equal(play(0, 8, 0.6, 2).over, 'win', 'the valley is gentle');

console.log('defense: ok');
