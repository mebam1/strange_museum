'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const Core = require('../core.js');

function visitor() {
  const g = G.newGame(101);
  G.startViewing(g);
  return g;
}

function bossGame(type, week, dice = 10, before = () => {}) {
  const g = G.newGame(101);
  g.week = week;
  g.visitor = 3;
  g.schedule[week-1] = G.bossEntry(week, type);
  while (g.dice.length < dice) g.dice.push(Core.newDie(g));
  g.dice.length = dice;
  // Its two-different-faces trigger never fires in the single-die penalty tests.
  g.board.relics = {'0,0': Core.instance('scribe')};
  before(g);
  G.startViewing(g);
  return g;
}

function takeFirst(g, n = 1) {
  return G.submit(g, g.view.remaining.slice(0, n).map(entry => entry.id));
}

function memoryStorage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
}

test('new run and each visitor use the configured setup and reveal their rewards', () => {
  const g = G.newGame('박물관');
  assert.deepEqual(g, G.newGame('박물관'));
  assert.equal(g.phase, 'intro');
  assert.equal(g.money, 24);
  assert.deepEqual(g.board.cells, ['0,0','2,0','1,1']);
  assert.deepEqual(g.dice.map(die => die.faces), Array(6).fill([1,2,3,4,5,6]));
  assert.equal(g.schedule.length, 8);
  assert.deepEqual(g.schedule.map(boss => boss.strength), ['약','약','중','중','중','중','강','강']);
  for (let i=1; i<8; i++) assert.notEqual(g.schedule[i].type, g.schedule[i-1].type);
  assert.ok(G.startViewing(g));
  assert.equal(g.view.remaining.length, 6);
  assert.equal(g.view.rerollsLeft, 8);
  assert.equal(g.view.target, 20);
  assert.equal(g.view.rewards.length, 3);
  assert.equal(new Set(g.view.rewards).size, 3);
  const revealed = [...g.view.rewards];
  G.endViewing(g);
  assert.equal(g.phase, 'shop');
  assert.deepEqual(g.view.rewards, revealed);
  assert.equal(g.money, 28);
  assert.equal(g.shop.stock.length, 3);
  assert.ok(G.startViewing(g));
  assert.equal(g.visitor, 2);
  assert.equal(g.view.rerollsLeft, 8);
  assert.equal(g.view.submitted.length, 0);
});

test('a partial selection consumes only selected dice, rerolls only selected survivors, and rejects stale input atomically', () => {
  const g = visitor(), unchanged = structuredClone(g.view.remaining.slice(1));
  g.board.relics['1,1'] = Core.instance('fidget');
  takeFirst(g);
  assert.deepEqual(g.view.remaining, unchanged);
  const first = unchanged[0].id;
  for (const ids of [[], [first, first], [1], [first, 999]]) {
    const old = structuredClone(g);
    assert.deepEqual(G.reroll(g, ids), []);
    assert.deepEqual(G.submit(g, ids), []);
    assert.deepEqual(g, old);
  }
  const oldSum = g.view.sum;
  for (let i=0; i<8; i++) G.reroll(g, [first]);
  assert.deepEqual(g.view.remaining.slice(1), unchanged.slice(1));
  assert.equal(g.view.rerollsLeft, 0);
  assert.equal(g.view.sum, oldSum + 16);
  assert.deepEqual(G.reroll(g, [first]), []);
  G.endViewing(g);
  assert.equal(g.phase, 'shop');
  G.startViewing(g);
  assert.equal(g.view.remaining.length, 6);
});

for (const [week, cap, permanent] of [[1,1,false], [3,2,true], [7,4,true]]) {
  test(`꾸준함 week ${week} applies the correct capped or uncapped loss`, () => {
    const g = bossGame('steady', week);
    for (let i=0; i<4; i++) takeFirst(g);
    assert.equal(g.view.penaltyCount, cap);
    assert.equal(g.view.damage.length, cap);
    assert.equal(g.view.remaining.length, 10 - 4 - cap);
    assert.equal(g.dice.length, permanent ? 10-cap : 10);
  });
}

test('꾸준함 tests the individual submission, including multiplier gain. Loss uses the whole pool after the last submission and preserves the final die', () => {
  const g = bossGame('steady', 3);
  g.board.relics = {'0,0': Core.instance('guide'), '2,0': Core.instance('lamp')};
  for (const entry of g.view.remaining) entry.face = 5;
  takeFirst(g);
  takeFirst(g, 2);
  assert.equal(g.view.penaltyCount, 0);
  g.view.remaining[0].face = 0;
  takeFirst(g);
  assert.equal(g.view.penaltyCount, 1);
  const one = bossGame('steady', 7, 1);
  takeFirst(one);
  assert.equal(one.dice.length, 1);
  const two = bossGame('steady', 7, 2);
  two.view.remaining[1].face = two.view.remaining[0].face;
  takeFirst(two, 2);
  assert.equal(two.dice.length, 1);
  assert.equal(two.view.penaltyCount, 1);
  assert.equal(two.phase, 'lost');
});

for (const [week, expectedSum, expectedMult, dust] of [[1,44,5,0],[3,35,2,2],[7,26,2,3]]) {
  test(`한 방 week ${week} applies the score penalty each time, and the appropriate dust cap`, () => {
    const g = bossGame('burst', week);
    g.view.sum = 50; g.view.mult = 5;
    for (let i=0; i<5; i++) takeFirst(g);
    assert.equal(g.view.sum, expectedSum);
    assert.equal(g.view.mult, expectedMult);
    assert.equal(Object.values(g.board.tokens).filter(id => id === 'dust').length, dust);
    G.endViewing(g);
    assert.equal(Object.values(g.board.tokens).length, dust);
  });
}

test('한 방 score clamps to zero and boss dust triggers token creation listeners', () => {
  const g = bossGame('burst', 3);
  g.board.relics['2,0'] = Core.instance('collector');
  for (let i=0; i<3; i++) takeFirst(g);
  assert.equal(g.view.sum, 2);
  assert.equal(g.view.mult, 0);
  assert.equal(g.view.dustCount, 1);
});

for (const [week, changes] of [[1,0],[3,2],[7,4]]) {
  test(`눈의 다양성 week ${week} rejects the entire submission and changes only actual sealed faces`, () => {
    const g = bossGame('diversity', week);
    g.board.relics['0,0'] = Core.instance('guide');
    assert.equal(g.view.sealedFace, 6);
    for (const entry of g.view.remaining) entry.face = 5;
    for (let i=0; i<4; i++) {
      const trace = takeFirst(g);
      assert.equal(trace.some(e => e.type === 'pattern'), false);
    }
    assert.equal(g.view.sum, 0);
    assert.equal(g.view.submitted.length, 4);
    assert.equal(g.dice.filter(die => die.faces[5] !== 6).length, changes);
    assert.ok(g.dice.every(die => die.faces.slice(0,-1).join(',') === '1,2,3,4,5'));
    assert.equal(g.view.sealedFace, 6);
    g.view.remaining[0].face = 2;
    takeFirst(g);
    assert.equal(g.view.sum, 3);
  });
}

test('the sealed value counts every physical face and one blocked die suppresses a mixed pattern', () => {
  const g = bossGame('diversity', 3, 6, g => { g.dice[0].faces[0] = 2; });
  assert.equal(g.view.sealedFace, 2);
  g.view.remaining[0].face = 1;
  g.view.remaining[1].face = 5;
  const trace = takeFirst(g, 2);
  assert.equal(trace.some(e => e.type === 'pattern' || e.type === 'fire'), false);
  assert.equal(g.dice[0].faces[0], 2);
  assert.notEqual(g.dice[0].faces[1], 2);
  assert.equal(g.dice[1].faces[5], 6);
});

test('preview uses the exact action and random penalty without consuming live state, including the final die', () => {
  const g = bossGame('steady', 3, 2);
  g.board.tokens['1,0'] = 'coin';
  const ids = g.view.remaining.map(entry => entry.id);
  g.view.remaining.forEach(entry => { entry.face = 0; });
  const before = JSON.stringify(g);
  const preview = G.preview(g, ids);
  assert.equal(JSON.stringify(g), before);
  assert.equal(preview.permanentLosses, 1);
  assert.equal(preview.damage.length, 1);
  assert.equal(preview.score, 5);
  assert.deepEqual(G.submit(g, ids), preview.trace);
  assert.equal(g.lastResult.score, preview.score);
  assert.deepEqual(g.lastResult.damage, preview.damage);
});

test('shop placement, distant cells, persistent tokens, rotation, stock and fractional sale prices are atomic', () => {
  const g = visitor();
  assert.equal(G.buyCell(g, '99,-52'), false);
  G.endViewing(g);
  g.view.rewards = ['scribe','banker','sweeper'];
  g.shop.stock = ['carver','die_scroll','guide'];
  g.board.tokens['-99,51'] = 'dust';
  assert.equal(G.cellPrice(g), 4);
  assert.ok(G.buyCell(g, '-99,51'));
  const old = structuredClone(g);
  for (const occupied of ['-99,51', '0,0', '0,12']) {
    assert.equal(G.acquire(g, 'reward', 0, occupied), false);
    assert.equal(G.acquire(g, 'stock', 0, occupied), false);
    assert.equal(G.moveRelic(g, '2,0', occupied), false);
  }
  assert.equal(G.buyCell(g, '-99,51'), false);
  assert.deepEqual(g, old);
  assert.ok(G.acquire(g, 'reward', 0, '1,1', 2));
  assert.equal(g.board.relics['1,1'].facing, 2);
  assert.ok(G.rotateRelic(g, '1,1'));
  assert.equal(g.board.relics['1,1'].facing, 3);
  assert.equal(G.cellPrice(g), 6);
  assert.ok(G.buyCell(g, '50,-50'));
  assert.ok(G.moveRelic(g,'1,1','50,-50',1));
  assert.equal(g.board.relics['50,-50'].facing, 1);
  assert.equal(G.acquire(g, 'reward', 1, '1,1'), false);
  assert.equal(G.acquire(g, 'stock', 0, '1,1'), false);
  g.money = 24;
  assert.ok(G.acquire(g, 'stock', 0, '1,1'));
  assert.equal(g.shop.stock[0], null);
  assert.equal(g.board.relics['1,1'].charges, 6);
  assert.equal(g.money, 0);
  assert.ok(G.sellRelic(g, '1,1'));
  assert.equal(g.money, 2.4);
  assert.equal(G.sellRelic(g, '1,1'), false);
  assert.equal(G.acquire(g, 'stock', 0, '1,1'), false);
  G.startViewing(g);
  G.endViewing(g);
  assert.ok(G.declineReward(g));
  assert.equal(G.declineReward(g), false);
});

test('tip boundaries and target use the current visitor only', () => {
  for (const [score, expectedTip] of [[0,4],[4,4],[5,8],[11,8],[12,14],[19,14],[20,22],[31,22],[32,32]]) {
    const g = visitor();
    g.view.sum = score;
    G.endViewing(g);
    assert.equal(g.lastResult.tip, expectedTip);
    assert.equal(g.money, 24+expectedTip);
  }
});

test('24 scripted visits open exactly 23 shops; an ordinary miss continues and a failed boss ends immediately', () => {
  const g = G.newGame(12);
  let shops = 0;
  for (let i=0; i<24; i++) {
    assert.ok(G.startViewing(g));
    assert.equal(g.week, Math.floor(i/3)+1);
    assert.equal(g.visitor, i%3+1);
    if (g.visitor === 3) g.view.sum = g.view.target;
    G.endViewing(g);
    if (g.phase === 'shop') shops++;
  }
  assert.equal(g.history.length, 24);
  assert.equal(shops, 23);
  assert.equal(g.phase, 'won');
  assert.equal(g.shop, null);
  assert.equal(G.startViewing(g), false);
  const failed = bossGame('burst', 7);
  failed.view.sum = failed.view.target - 1;
  G.endViewing(failed);
  assert.equal(failed.phase, 'lost');
  assert.equal(failed.shop, null);
  assert.equal(G.startViewing(failed), false);
});

test('mid-visit and shop saves recreate the next actions, preview, die faces and store offers', () => {
  const g = visitor(), store = memoryStorage();
  takeFirst(g);
  G.reroll(g, [g.view.remaining[0].id]);
  g.board.tokens['-4,2'] = 'dust';
  assert.ok(G.save(store, g));
  const restored = G.load(store, 700);
  assert.deepEqual(g, restored);
  const ids = g.view.remaining.map(d => d.id);
  assert.deepEqual(G.preview(g, ids), G.preview(restored, ids));
  assert.deepEqual(G.submit(g, ids), G.submit(restored, ids));
  assert.deepEqual(g, restored);
  assert.ok(G.save(store, g));
  const shop = G.load(store);
  G.startViewing(shop); G.startViewing(g);
  assert.deepEqual(g, shop);
});

test('older keys survive and incompatible content in the current slot is archived before writing', () => {
  const s = memoryStorage();
  s.setItem('strange-museum-run-v5', '{"rulesVersion":5,"board":"legacy polyomino"}');
  const old = '{"rulesVersion":4,"data":"history"}';
  s.setItem(G.SAVE_KEY, old);
  const g = G.load(s, 22);
  assert.equal(g.phase, 'intro');
  assert.equal(s.getItem(G.SAVE_KEY), old);
  assert.ok(G.save(s, g));
  assert.equal(s.getItem(G.SAVE_KEY+'-backup-1'), old);
  assert.equal(s.getItem('strange-museum-run-v5'), '{"rulesVersion":5,"board":"legacy polyomino"}');
  assert.deepEqual(G.load(s), g);
  assert.equal(G.save({getItem(){ throw Error('denied'); }}, g), false);
});
