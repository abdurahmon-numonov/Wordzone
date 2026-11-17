// «Чайхана» (v2.36): the pure rules of the café game.
const assert = require('node:assert/strict');
const C = require('../cafe');
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const cards = ['journey:путешествие', 'brave:храбрый', 'deep:глубокий', 'weather:погода', 'quiet:тихий', 'narrow:узкий']
  .map(s => { const [original, translation] = s.split(':'); return { original, translation }; });

assert.equal(C.DAYS.length, 6, 'six days up to Navruz');
assert.equal(C.DAYS[5].critic, 5, 'Mister Owl orders five dishes on the last day');
assert(C.DAYS.every((d, i) => i === 0 || d.patience <= C.DAYS[i - 1].patience), 'guests grow less patient day by day');

// orders: four distinct translations, exactly one right, the dish art cycles
for (let k = 0; k < 200; k++) {
  const o = C.makeOrder(cards);
  assert.equal(o.options.length, 4);
  assert.equal(o.options.filter(x => x.right).length, 1, 'one right dish');
  assert.equal(o.options.find(x => x.right).text, o.card.translation);
  assert.equal(new Set(o.options.map(x => x.text)).size, 4, 'four different translations');
  assert.equal(o.word, o.card.original);
}
assert.equal(C.makeOrder(cards.slice(0, 3)), null, 'a deck needs four words');
assert.equal(C.makeOrder([...cards.slice(0, 2), { original: 'calm', translation: 'тихий' }, { original: 'still', translation: 'Тихий' }]), null, 'duplicate translations do not count twice');
const recent = ['journey', 'brave', 'deep', 'weather', 'quiet'];
for (let k = 0; k < 50; k++) assert.equal(C.makeOrder(cards, recent).word, 'narrow', 'recent words are not ordered again while others remain');

// coins: speed, streak and the carpet
assert.equal(C.coinsFor(1, 0), 20); assert.equal(C.coinsFor(0, 0), 10);
assert.equal(C.coinsFor(1, 5), 30); assert.equal(C.coinsFor(1, 9), 30, 'the streak bonus caps at ×1.5');
assert.equal(C.coinsFor(1, 0, true), 25, 'suzani adds 25%');
assert.equal(C.patienceFor(C.DAYS[0], { lanterns: true }), 24, 'lanterns: +20% patience');

// tea: the band, spills and the samovar
const band = C.teaBand({});
assert.equal(C.teaResult(0.8, band), 'perfect'); assert.equal(C.teaResult(0.6, band), 'ok'); assert.equal(C.teaResult(0.3, band), 'low'); assert.equal(C.teaResult(1, band), 'spill');
assert(C.teaBand({ samovar: true })[1] - C.teaBand({ samovar: true })[0] > band[1] - band[0], 'the big samovar widens the band');
assert(C.pourRate({ samovar: true }) < C.pourRate({}), 'and pours slower');
assert.equal(C.teaCoins('perfect'), 22); assert.equal(C.teaCoins('spill'), 0);

// stars, seats, arrivals
assert.deepEqual([90, 100, 135, 170].map(c => C.stars(c, 100)), [0, 1, 2, 3]);
assert.equal(C.seatCount(C.DAYS[0], { tapchan: true }), 2, 'day one stays small');
assert.equal(C.seatCount(C.DAYS[2], { tapchan: true }), 4, 'the fourth tapchan seats one more');
assert(C.spawnDelay({ vines: true }, seq(0.5)) < C.spawnDelay({}, seq(0.5)), 'vines bring guests sooner');

// days unlock in order; the shop never goes below zero
let s = C.defaults();
assert.equal(C.nextDay(s), 0); assert.equal(C.dayOpen(s, 1), false);
s.days[0] = 2; assert.equal(C.dayOpen(s, 1), true); assert.equal(C.nextDay(s), 1);
s.days = [1, 1, 1, 1, 1, 3]; assert.equal(C.nextDay(s), -1, 'all six days done');
s = C.defaults(); assert.equal(C.buy(s, 'lanterns'), null);
s.coins = 150; const s1 = C.buy(s, 'lanterns');
assert.equal(s1.coins, 50); assert.equal(s1.up.lanterns, true); assert.equal(s.up.lanterns, undefined, 'buy never mutates');
assert.equal(C.buy(s1, 'lanterns'), null, 'each decoration is bought once');
const c = C.clean({ coins: -3, up: { lanterns: true, rocket: true }, days: [9, 'x'], seen: [0, 'a'] });
assert.equal(c.coins, 0); assert.deepEqual(c.up, { lanterns: true }); assert.deepEqual(c.days, [3, 0, 0, 0, 0, 0]); assert.deepEqual(c.seen, [0]);

console.log('✓ cafe: days, orders, coins, tea, stars, seats, unlocks, shop, saved state');
