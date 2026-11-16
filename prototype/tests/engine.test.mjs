import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTIFACTS, CONFIG, action, createGame, getBoardCells, getVisitorTarget,
  getWeekMultiplier, legalArtifactPlacement, legalPiecePlacement,
  previewSubmission, resolveSubmission, restoreGame, getArtifactDefinition,
} from '../dist/engine.js';

// Deliberately constructed rule fixtures are separate from balance/autoplay runs.
const points = coordinates => coordinates.map(([x, y]) => ({x, y}));
const line = (length, x = 0, y = 0) => Array.from({length}, (_, i) => ({x: x + i, y}));
const piece = (id, face, level, cells) => ({id, face, level, cells});
const relic = (kind, id, x, y, extra = {}) => ({kind, id, x, y, rotation: 0, ...extra});
const effect = kind => ARTIFACTS[kind].value;

function fixture(pieces, artifacts, values = [3, 3, 1, 2, 5], seed = 123) {
  const state = createGame(seed);
  state.pieces = structuredClone(pieces);
  state.artifacts = structuredClone(artifacts);
  state.dice.forEach((die, i) => { die.value = values[i]; die.held = false; });
  return state;
}

function constantDice(state, value = 3) {
  for (const die of state.dice) {
    die.faces = Array(6).fill(value);
    die.value = value;
    die.held = false;
  }
}

function act(state, command) {
  const result = action(state, command);
  assert.equal(result.ok, true, result.error || JSON.stringify(command));
  return result;
}

function close(actual, expected, message = '') {
  assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-10,
    `${message} expected ${expected}, received ${actual}`);
}

function shopFixture() {
  const state = fixture([piece('p', 3, 1, line(4))], [relic('coin', 'coin', 0, 0)]);
  state.phase = 'shop';
  state.visitor = CONFIG.visitorsPerWeek;
  state.lastVisitor = {evaluator:true, passed:true, week:state.week, visitor:state.visitor};
  state.shop = {
    freePieces: [{id: 'free-p', face: 2, cells: line(2), price: 10}],
    freeArtifacts: [{id: 'free-a', kind: 'coin', price: ARTIFACTS.coin.price}],
    pieces: [{id: 'shop-p', face: 2, cells: line(2), price: 10}],
    artifacts: [{id: 'shop-a', kind: 'coin', price: ARTIFACTS.coin.price}],
    freePieceClaimed: false, freeArtifactClaimed: false,
  };
  return state;
}

function rejectAtomically(state, command) {
  const before = structuredClone({
    money: state.money, shop: state.shop, pieces: state.pieces,
    artifacts: state.artifacts, dice: state.dice, nextId: state.nextId,
  });
  assert.equal(action(state, command).ok, false, JSON.stringify(command));
  assert.deepEqual({
    money: state.money, shop: state.shop, pieces: state.pieces,
    artifacts: state.artifacts, dice: state.dice, nextId: state.nextId,
  }, before, 'Rejected actions must not charge money, consume offers, or mutate ownership.');
}

function submitVisit(state) {
  assert.equal(state.phase, 'visit');
  for (let i = 0; i < CONFIG.submissionsPerVisitor; i++) act(state, {type: 'SUBMIT'});
  return state.lastVisitor;
}

test('cell repetitions sum individual piece levels without pattern coefficients', () => {
  const state = fixture([
    piece('a', 3, 4, line(2)), piece('b', 3, 1, line(1)),
  ], [relic('mirror', 'source', 0, 0)]);
  const board = getBoardCells(state);
  assert.equal(board.find(c => c.x === 0).levelSum, 5);
  assert.equal(board.find(c => c.x === 1).levelSum, 4);
  const result = resolveSubmission(state);
  assert.equal(result.counts.source, 5);
  close(result.multiplier, (1 + (effect('mirror') - 1) * 5));
  assert.equal(result.score, 0, 'Multipliers alone produce no additive score.');
});

test('multi-cell artifacts use the largest active cell count and fall back when its condition fails', () => {
  const state = fixture([
    piece('a', 3, 2, line(2)), piece('b', 3, 2, line(1)),
  ], [relic('mirror', 'wide', 0, 0, {cells: line(2)})]);
  const result = resolveSubmission(state);
  assert.equal(result.counts.wide, 4);
  assert.equal(result.chainCount, 4);
  close(result.multiplier, (1 + (effect('mirror') - 1) * 4));
  const fallback = previewSubmission(state, [3, 1, 2, 4, 5]);
  assert.equal(fallback.counts.wide, 2);
  assert.equal(fallback.chainCount, 2);
  const failed = previewSubmission(state, [1, 1, 2, 4, 5]);
  assert.equal(failed.counts.wide || 0, 0);
  assert.equal(failed.chainCount, 0);
});

test('fixed multiset requirements need duplicates, while extra complete sets add no repetition', () => {
  const state = fixture([
    piece('a', 3, 2, line(1)), piece('b', 3, 2, line(1)),
  ], [relic('mirror', 'source', 0, 0)]);
  assert.equal(previewSubmission(state, [3, 1, 2, 4, 5]).chainCount, 0);
  assert.equal(previewSubmission(state, [3, 3, 1, 2, 5]).chainCount, 4);
  assert.equal(previewSubmission(state, [3, 3, 3, 3, 5]).chainCount, 4);
});

test('the same rolled dice can satisfy multiple artifacts without consumption', () => {
  const state = fixture([piece('a', 3, 2, line(2))], [
    relic('mirror', 'left', 0, 0), relic('mirror', 'right', 1, 0),
  ], [3, 1, 2, 4, 5]);
  const result = resolveSubmission(state);
  assert.deepEqual(result.counts, {left: 2, right: 2});
  close(result.multiplier, (1 + (effect('mirror') - 1) * 4));
});

test('different fixed eye bundles with the same level sum repeat equally', () => {
  const repeated = fixture([
    piece('a', 1, 2, line(1)), piece('b', 1, 3, line(1)),
  ], [relic('mirror', 'source', 0, 0)], [1, 1, 3, 4, 5]);
  const distinct = fixture([
    piece('a', 1, 2, line(1)), piece('b', 2, 3, line(1)),
  ], [relic('mirror', 'source', 0, 0)], [1, 2, 3, 4, 5]);
  assert.equal(resolveSubmission(repeated).counts.source, resolveSubmission(distinct).counts.source);
});

test('preview is pure even when upgrades, charge depletion, and tie-breaking are involved', () => {
  const state = fixture([
    piece('a', 3, 1, line(1)), piece('b', 3, 1, line(1)),
  ], [relic('brush', 'brush', 0, 0, {charges: 1})]);
  const before = structuredClone(state);
  const first = previewSubmission(state);
  const second = previewSubmission(state);
  assert.deepEqual(state, before);
  assert.deepEqual(first, second);
  assert.equal(first.upgrades.length, 1);
  assert.deepEqual(first.despawn, ['brush']);
});

test('each upgraded piece consumes one charge, while one reaction upgrades each piece at most once', () => {
  const state = fixture([
    piece('a', 3, 1, line(2)), piece('b', 3, 1, line(2)),
  ], [relic('brush', 'brush', 0, 0, {charges: 2, cells: line(2)})]);
  const result = resolveSubmission(state);
  assert.deepEqual(state.pieces.map(p => p.level), [2, 2]);
  assert.equal(result.upgrades.length, 2);
  assert.equal(result.upgrades.reduce((n, upgrade) => n + upgrade.chargesSpent, 0), 2);
  assert.equal(result.counts.brush, 1);
  assert.equal(result.chainCount, 1);
  assert.deepEqual(result.despawn, ['brush']);
  assert.equal(state.artifacts.length, 0);
});

test('insufficient charge prioritizes lower level, then larger original piece area', () => {
  const specs = [ ['a', 1, 4], ['b', 1, 6], ['c', 1, 3], ['d', 2, 5], ['e', 2, 4] ];
  const state = fixture(specs.map(([id, level, area]) => piece(id, 1, level, line(area))),
    [relic('brush', 'brush', 0, 0, {charges: 2})], [1, 1, 1, 1, 1]);
  const result = resolveSubmission(state);
  assert.deepEqual(result.upgrades.map(u => u.pieceId), ['b', 'a']);
  assert.deepEqual(state.pieces.map(p => p.level), [2, 2, 1, 2, 2]);
  assert.equal(getBoardCells(state).find(c => c.x === 0).levelSum, 9);
});

test('a single remaining charge upgrades the lower-level piece and preserves the other level', () => {
  const state = fixture([
    piece('a', 3, 2, line(2)), piece('b', 3, 1, line(1)),
  ], [relic('brush', 'brush', 0, 0, {charges: 1})]);
  const result = resolveSubmission(state);
  assert.deepEqual(result.upgrades.map(u => u.pieceId), ['b']);
  assert.deepEqual(state.pieces.map(p => p.level), [2, 2]);
  assert.equal(getBoardCells(state).find(c => c.x === 0).levelSum, 4);
});

test('exact level-and-area upgrade ties use reproducible seeded randomness', () => {
  function selected(seed) {
    const state = fixture([
      piece('a', 3, 1, line(1)), piece('b', 3, 1, line(1)),
    ], [relic('brush', 'brush', 0, 0, {charges: 1})], [3, 3, 1, 2, 5], seed);
    return resolveSubmission(state).upgrades[0].pieceId;
  }
  assert.equal(selected('repeatable'), selected('repeatable'));
  const choices = new Set(Array.from({length: 40}, (_, i) => selected(`tie-${i}`)));
  assert.deepEqual(choices, new Set(['a', 'b']));
});

test('later upgrade reactions rank the actual new levels, while scoring keeps its submission snapshot', () => {
  const state = fixture([
    piece('a', 3, 1, line(3)), piece('b', 3, 1, line(3)),
  ], [
    relic('brush', 'first', 0, 0, {charges: 1}),
    relic('brush', 'second', 1, 0, {charges: 1}),
    relic('mirror', 'source', 2, 0),
  ]);
  const result = resolveSubmission(state);
  assert.deepEqual(state.pieces.map(p => p.level), [2, 2]);
  assert.equal(new Set(result.upgrades.map(u => u.pieceId)).size, 2);
  assert.equal(result.counts.source, 2);
  close(result.multiplier, (1 + (effect('mirror') - 1) * 2));
  close(resolveSubmission(state).multiplier, (1 + (effect('mirror') - 1) * 4));
});

test('level rises immediately but root repetitions grow only on the next submission', () => {
  const state = fixture([piece('a', 3, 1, line(2))], [
    relic('brush', 'brush', 0, 0, {charges: 2}), relic('mirror', 'source', 1, 0),
  ]);
  const first = resolveSubmission(state);
  assert.equal(state.pieces[0].level, 2);
  assert.equal(state.artifacts.find(a => a.id === 'brush').charges, 1);
  assert.equal(first.counts.brush, 1);
  assert.equal(first.counts.source, 1);
  close(first.multiplier, effect('mirror'));
  const second = resolveSubmission(state);
  assert.equal(state.pieces[0].level, 2);
  assert.equal(second.counts.brush || 0, 0);
  assert.equal(state.artifacts.find(a => a.id === 'brush').charges, 1);
  assert.equal(second.counts.source, 2);
  close(second.multiplier, (1 + (effect('mirror') - 1) * 2));
});

test('a piece cannot be upgraded again in later submissions or by a replacement brush', () => {
  const state=fixture([piece('p',3,1,line(1))],[relic('brush','first',0,0,{charges:4})]);
  assert.equal(resolveSubmission(state).upgrades.length,1);
  const saved=structuredClone(state), rngBefore=state.rng;
  for(let i=0;i<6;i++) {
    const result=resolveSubmission(state);
    assert.equal(result.upgrades.length,0);
    assert.equal(result.chainCount,0);
    assert.deepEqual(result.events,[]);
  }
  assert.deepEqual(state,saved);
  assert.equal(state.rng,rngBefore);
  state.artifacts=[relic('brush','replacement',0,0,{charges:4})];
  const result=resolveSubmission(state);
  assert.equal(result.upgrades.length,0);
  assert.equal(state.pieces[0].level,2);
  assert.equal(state.artifacts[0].charges,4);
});

test('legacy restoration preserves finished records and only caps unfinished runs', () => {
  const legacy=createGame(42);delete legacy.rulesVersion;
  legacy.artifacts[2].kind='echo';
  legacy.artifacts.push(relic('bell','old-bell',2,0));
  legacy.pieces[0].level=8;legacy.visit.score=90000;legacy.phase='won';
  legacy.history=[{score:90000}];
  const original=structuredClone(legacy);
  assert.deepEqual(restoreGame(legacy),original);
  assert.equal(getArtifactDefinition('echo').name,'메아리석');
  assert.equal(getArtifactDefinition('bell').name,'공명 종');
  legacy.phase='shop';
  legacy.shop={freeArtifacts:[{kind:'echo',price:18},{kind:'bell',price:30}],artifacts:[{kind:'bell',price:30}]};
  const migrated=restoreGame(legacy);
  assert.equal(migrated.pieces[0].level,2);
  assert.equal(migrated.rulesVersion,5);
  assert.equal(migrated.visit.score,90000);
  assert.deepEqual(migrated.history,legacy.history);
  assert.deepEqual(migrated.artifacts.map(a=>a.kind),['coin','brush','conduit','mirror','prism']);
  assert.deepEqual(migrated.shop.freeArtifacts.map(a=>[a.kind,a.price]),[['conduit',ARTIFACTS.conduit.price],['prism',ARTIFACTS.prism.price]]);
  assert.deepEqual(migrated.shop.artifacts.map(a=>[a.kind,a.price]),[['prism',ARTIFACTS.prism.price]]);
  assert.equal(legacy.pieces[0].level,8,'Loading must not mutate the legacy backup.');
  assert.deepEqual(restoreGame(migrated),migrated);
});

test('multiple brushes sharing one piece do not spend charges or create empty chains', () => {
  const state=fixture([piece('p',3,1,line(3))],[
    relic('brush','first',0,0,{charges:4}),relic('brush','second',1,0,{charges:4}),
    relic('seal','seal',2,0),
  ]);
  const result=resolveSubmission(state);
  assert.deepEqual(result.upgrades.map(u=>u.artifactId),['first']);
  assert.equal(state.pieces[0].level,2);
  assert.deepEqual(state.artifacts.slice(0,2).map(a=>a.charges),[3,4]);
  assert.deepEqual(result.counts,{first:1});
  assert.equal(result.chainCount,1);
  assert.equal(result.counts.seal||0,0,'A skipped brush cannot satisfy the two-source prerequisite.');
});

test('a capped brush neither starts a chain nor activates an adjacent conduit', () => {
  const state=fixture([piece('p',3,2,line(2))],[
    relic('brush','brush',0,0,{charges:3}),relic('conduit','relay',1,0),
  ]);
  const result=resolveSubmission(state);
  assert.equal(result.counts.relay||0,0);
  assert.equal(result.counts.brush||0,0);
  assert.equal(result.chainCount,0);
  assert.equal(state.artifacts[0].charges,3);
});

test('overlap upgrades only unfinished pieces and retains unused charges for a new piece', () => {
  const state=fixture([
    piece('done',3,2,line(1)),piece('fresh',3,1,line(1)),piece('next',3,1,line(1,1)),
  ],[relic('brush','brush',0,0,{charges:4})]);
  const first=resolveSubmission(state);
  assert.deepEqual(first.upgrades.map(u=>u.pieceId),['fresh']);
  assert.equal(state.artifacts[0].charges,3);
  state.phase='shop';
  act(state,{type:'MOVE_ARTIFACT',artifactId:'brush',x:1,y:0});
  state.phase='visit';
  const second=resolveSubmission(state);
  assert.deepEqual(second.upgrades.map(u=>u.pieceId),['next']);
  assert.equal(state.artifacts[0].charges,2);
  assert.deepEqual(state.pieces.map(p=>p.level),[2,2,2]);
  assert.equal(resolveSubmission(state).chainCount,0);
});

test('[prototype topology freeze] last-charge upgrade still starts one chain before disappearing', () => {
  const state = fixture([piece('p', 3, 1, points([[0, 0], [1, 0], [0, 1]]))], [
    relic('brush', 'brush', 0, 0, {charges: 1}),
    relic('mirror', 'source', 1, 0), relic('seal', 'seal', 0, 1),
  ]);
  const result = resolveSubmission(state);
  assert.equal(state.pieces[0].level, 2);
  assert.equal(state.artifacts.some(a => a.id === 'brush'), false);
  assert.equal(result.counts.brush, 1);
  assert.equal(result.chainCount, 2);
  assert.equal(result.counts.seal, 2);
  const brushChain = result.chains.find(chain => chain.rootId === 'brush');
  assert.equal(brushChain.repeat, 1);
  assert.ok(brushChain.steps.some(step => step.artifactId === 'seal'));
  close(result.score, 2 * effect('seal') * effect('mirror'));
  const next = resolveSubmission(state);
  assert.equal(next.counts.seal || 0, 0);
  assert.equal(next.counts.source, 2);
  assert.equal(next.score, 0);
});

test('BFS diamond merging and cycles fire once per chain, then reset for each root repetition', () => {
  const state = fixture([piece('p', 3, 4, points([[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]]))], [
    relic('mirror', 'a', 0, 0), relic('conduit', 'b', 1, 0),
    relic('conduit', 'c', 0, 1), relic('conduit', 'd', 1, 1), relic('conduit', 'e', 2, 1),
  ]);
  const result = resolveSubmission(state);
  assert.equal(result.chainCount, 4);
  assert.deepEqual(result.counts, {a: 4, b: 4, c: 4, d: 4, e: 4});
  assert.equal(result.chains[0].repeat, 4);
  assert.deepEqual(result.chains[0].steps.map(step => [step.artifactId, step.layer]),
    [['a', 0], ['b', 1], ['c', 1], ['d', 2], ['e', 3]]);
  assert.equal(new Set(result.chains[0].steps.map(step => step.artifactId)).size, 5);
  close(result.score, 16 * effect('conduit') * (1 + (effect('mirror') - 1) * 4));
});

test('separate tile roots can each activate a shared relay in their own chain', () => {
  const state = fixture([piece('p', 3, 1, line(3))], [
    relic('mirror', 'a', 0, 0), relic('conduit', 'relay', 1, 0), relic('mirror', 'b', 2, 0),
  ]);
  const result = resolveSubmission(state);
  assert.equal(result.chainCount, 2);
  assert.equal(result.counts.relay, 2);
  close(result.score, 2 * effect('conduit') * (1 + (effect('mirror') - 1) * 2));
});

test('all additive effects are collected before multipliers regardless of root order', () => {
  const state = fixture([piece('p', 3, 1, line(2))], [
    relic('mirror', 'first', 0, 0), relic('coin', 'later', 1, 0),
  ]);
  close(resolveSubmission(state).score, effect('coin') * effect('mirror'));
  state.artifacts = [relic('mirror', 'alone', 0, 0)];
  assert.equal(resolveSubmission(state).score, 0);
});

test('static modifiers support chain additions without starting a chain', () => {
  const state = fixture([piece('p', 3, 1, line(4))], [
    relic('mirror', 'source', 0, 0), relic('coin', 'coin', 1, 0),
    relic('pedestal', 'stand', 2, 0), relic('observer', 'observer', 3, 0),
  ]);
  const result = resolveSubmission(state);
  assert.equal(result.chainCount, 1);
  assert.equal(result.counts.stand || 0, 0);
  assert.equal(result.counts.coin, 1);
  assert.equal(result.counts.observer, 1);
  close(result.score, (effect('coin') + effect('observer') + 2 * effect('pedestal')) * effect('mirror'));
  state.dice.forEach(die => { die.value = 6; });
  assert.equal(resolveSubmission(state).score, 0);
});

test('row observer accepts tile roots only, not additions from another relay', () => {
  const state = fixture([piece('p', 3, 1, points([[0, 0], [0, 1], [1, 1]]))], [
    relic('mirror', 'source', 0, 0), relic('conduit', 'conduit', 0, 1),
    relic('observer', 'observer', 1, 1),
  ]);
  const result = resolveSubmission(state);
  assert.equal(result.counts.conduit, 1);
  assert.equal(result.counts.observer || 0, 0);
  close(result.score, effect('conduit') * effect('mirror'));
});

test('prism accepts adjacent multiplicative and actual upgrade roots', () => {
  const state = fixture([piece('t', 3, 1, points([[0, 0], [-1, 0], [1, 0], [0, -1]]))], [
    relic('prism', 'prism', 0, 0), relic('mirror', 'source', -1, 0),
    relic('mirror', 'mirror', 1, 0), relic('brush', 'brush', 0, -1, {charges: 2}),
  ]);
  const result = resolveSubmission(state);
  assert.equal(result.counts.prism, 3);
  assert.equal(result.chainCount, 3);
  close(result.score, 3 * effect('prism') * (1 + (effect('mirror') - 1) * 2));
});

test('a relay must not count multiple touching cells of one source as multiple eligible neighbors', () => {
  const state = fixture([piece('p', 3, 1, points([[0, 0], [-1, 0], [-1, -1], [0, -1], [1, 0]]))], [
    relic('prism', 'prism', 0, 0),
    relic('mirror', 'wide', -1, -1, {cells: points([[0, 0], [1, 0], [0, 1]])}),
    relic('mirror', 'mirror', 1, 0),
  ]);
  const result = resolveSubmission(state);
  assert.equal(result.counts.prism, 2);
  close(result.score, 2 * effect('prism') * (1 + (effect('mirror') - 1) * 2));
});

test('seal eligibility requires both roots and the seal to share one exact piece ID', () => {
  const artifacts = [relic('seal', 'seal', 0, 0), relic('mirror', 'source', 1, 0), relic('mirror', 'mirror', 0, 1)];
  const same = fixture([piece('one', 3, 1, points([[0, 0], [1, 0], [0, 1]]))], artifacts);
  const positive = resolveSubmission(same);
  assert.equal(positive.counts.seal, 2);
  close(positive.score, 2 * effect('seal') * (1 + (effect('mirror') - 1) * 2));
  const different = fixture([
    piece('one', 3, 1, points([[0, 0], [1, 0]])),
    piece('two', 3, 1, points([[0, 0], [0, 1]])),
  ], artifacts, [3, 1, 2, 4, 5]);
  const negative = resolveSubmission(different);
  assert.equal(negative.counts.seal || 0, 0);
  assert.equal(negative.score, 0);
});

test('three submissions share one reroll budget and nonfinal submissions freely reroll the full hand', () => {
  const state = fixture([piece('p', 3, 1, line(2))], [relic('mirror', 'source', 0, 0), relic('coin', 'coin', 1, 0)]);
  constantDice(state, 3);
  act(state, {type: 'HOLD', die: 0});
  act(state, {type: 'REROLL'});
  assert.equal(state.visit.rerollsLeft, 2);
  act(state, {type: 'SUBMIT'});
  assert.equal(state.visit.submissionsLeft, 2);
  assert.equal(state.visit.rerollsLeft, 2);
  assert.ok(state.dice.every(die => !die.held && die.value === 3));
  act(state, {type: 'REROLL'});
  act(state, {type: 'REROLL'});
  assert.equal(state.visit.rerollsLeft, 0);
  const values = state.dice.map(die => die.value);
  assert.equal(action(state, {type: 'REROLL'}).ok, false);
  assert.deepEqual(state.dice.map(die => die.value), values);
  act(state, {type: 'SUBMIT'});
  assert.equal(state.visit.submissionsLeft, 1);
  assert.equal(state.visit.rerollsLeft, 0);
  assert.equal(state.phase, 'visit');
  const finalDice = structuredClone(state.dice);
  act(state, {type: 'SUBMIT'});
  assert.equal(state.phase, 'shop');
  assert.deepEqual(state.dice, finalDice, 'The last submission must not roll a new hand.');
  close(state.lastVisitor.score, 3 * effect('coin') * effect('mirror'));
});

test('held dice preserve their result and seeded rolls are reproducible with broad fair-face frequencies', () => {
  const a = createGame('fair-rolls');
  const b = createGame('fair-rolls');
  assert.deepEqual(a.dice, b.dice);
  const held = a.dice[0].value;
  act(a, {type: 'HOLD', die: 0, held: true});
  act(a, {type: 'REROLL'});
  assert.equal(a.dice[0].value, held);
  const counts = Array(7).fill(0);
  for (let i = 0; i < 1200; i++) {
    a.visit.rerollsLeft = 1;
    act(a, {type: 'REROLL'});
    for (const die of a.dice.slice(1)) counts[die.value]++;
  }
  for (const count of counts.slice(1)) {
    assert.ok(count / 4800 > 0.12 && count / 4800 < 0.22,
      `Unexpected basic fair-die frequency: ${JSON.stringify(counts.slice(1))}`);
  }
});

test('illegal and over-budget placement never spends money or consumes free/shop offers', () => {
  const state = shopFixture();
  rejectAtomically(state, {type: 'PLACE_PIECE', source: 'free', index: 0, x: 100, y: 100});
  rejectAtomically(state, {type: 'PLACE_ARTIFACT', source: 'free', index: 0, x: 0, y: 0});
  rejectAtomically(state, {type: 'PLACE_ARTIFACT', source: 'shop', index: 0, x: 99, y: 99});
  state.money = 0;
  rejectAtomically(state, {type: 'PLACE_PIECE', source: 'shop', index: 0, x: 4, y: 0});
  rejectAtomically(state, {type: 'PLACE_ARTIFACT', source: 'shop', index: 0, x: 1, y: 0});
  assert.equal(legalPiecePlacement(state, state.shop.freePieces[0], 4, 0), true);
  assert.equal(legalArtifactPlacement(state, state.shop.freeArtifacts[0], 1, 0), true);
});

test('free rewards give at most one piece and one artifact, each placed immediately', () => {
  const state = shopFixture();
  const money = state.money;
  act(state, {type: 'PLACE_PIECE', source: 'free', index: 0, x: 4, y: 0});
  assert.equal(state.pieces.length, 2);
  assert.equal(state.money, money);
  assert.equal(state.shop.freePieceClaimed, true);
  assert.equal(state.shop.freeArtifactClaimed, false);
  rejectAtomically(state, {type: 'PLACE_PIECE', source: 'free', index: 0, x: 6, y: 0});
  act(state, {type: 'PLACE_ARTIFACT', source: 'free', index: 0, x: 1, y: 0});
  assert.equal(state.artifacts.length, 2);
  assert.equal(state.shop.freeArtifactClaimed, true);
  assert.equal(state.money, money);
});

test('selling an existing artifact pays a fixed tenth of its shop price, independent of week', () => {
  for (const week of [1, 8]) {
    const state = shopFixture();
    state.week = week;
    const before = state.money;
    const result = act(state, {type: 'SELL', artifactId: 'coin'});
    close(result.sale, ARTIFACTS.coin.price * CONFIG.saleRatio);
    close(state.money - before, ARTIFACTS.coin.price * 0.1);
    assert.equal(state.artifacts.length, 0);
    rejectAtomically(state, {type: 'SELL', artifactId: 'coin'});
  }
});

test('editing one die face preserves six faces, allows duplicates, costs a fixed amount, and persists', () => {
  const state = shopFixture();
  state.week = 7;
  state.money = 1000;
  const otherDice = structuredClone(state.dice.slice(1));
  act(state, {type: 'EDIT_DIE', die: 'd1', face: 0, value: 6});
  assert.deepEqual(state.dice[0].faces, [6, 2, 3, 4, 5, 6]);
  assert.equal(state.money, 1000 - CONFIG.editDieCost);
  assert.deepEqual(state.dice.slice(1), otherDice);
  act(state, {type: 'NEXT_VISITOR'});
  assert.deepEqual(state.dice[0].faces, [6, 2, 3, 4, 5, 6]);
  act(state, {type: 'SUBMIT'});
  assert.deepEqual(state.dice[0].faces, [6, 2, 3, 4, 5, 6]);
  assert.ok(state.dice[0].faces.includes(state.dice[0].value));
});

test('invalid or unaffordable face edits do not alter dice or money', () => {
  const state = shopFixture();
  rejectAtomically(state, {type: 'EDIT_DIE', die: 0, face: 6, value: 3});
  rejectAtomically(state, {type: 'EDIT_DIE', die: 0, face: 0, value: 7});
  rejectAtomically(state, {type: 'EDIT_DIE', die: 'missing', face: 0, value: 6});
  state.money = 0;
  rejectAtomically(state, {type: 'EDIT_DIE', die: 0, face: 0, value: 6});
});

test('week multiplier affects targets but neither fixed tip amounts nor shop prices', () => {
  const cap = CONFIG.tipTiers.at(-1).tip;
  for (const week of [1, 7]) {
    const state = fixture([piece('p', 3, 1000, line(2))], [relic('mirror', 'source', 0, 0), relic('coin', 'coin', 1, 0)]);
    state.week = week;
    constantDice(state);
    close(getVisitorTarget(state), CONFIG.normalTarget * getWeekMultiplier(week));
    const record = submitVisit(state);
    assert.equal(record.tip, cap);
    for (const offer of state.shop.artifacts) assert.equal(offer.price, ARTIFACTS[offer.kind].price);
    assert.deepEqual(state.shop.pieces, []);
  }
});

test('the third visitor evaluates only their own three submissions, not earlier visitors or money', () => {
  const state = fixture([piece('p', 3, 1000, line(2))], [relic('mirror', 'source', 0, 0), relic('coin', 'coin', 1, 0)]);
  constantDice(state);
  for (let visitor = 1; visitor <= 2; visitor++) {
    assert.equal(state.visitor, visitor);
    assert.equal(submitVisit(state).evaluator, false);
    act(state, {type: 'NEXT_VISITOR'});
  }
  assert.equal(state.visitor, 3);
  assert.ok(state.history.slice(0, 2).every(record => record.score > CONFIG.evaluatorTarget));
  state.artifacts = [];
  state.money = 1_000_000;
  const record = submitVisit(state);
  assert.equal(record.score, 0);
  assert.equal(record.passed, false);
  assert.equal(state.phase, 'lost');
  assert.equal(state.week, 1);
});

test('[prototype choice] exactly meeting the evaluator target passes', t => {
  const target = CONFIG.evaluatorTarget;
  CONFIG.evaluatorTarget = effect('coin');
  t.after(() => { CONFIG.evaluatorTarget = target; });
  const state = fixture([piece('p', 3, 1, line(2))], [relic('brush', 'source', 0, 0, {charges:1}), relic('coin', 'coin', 1, 0)]);
  state.visitor = 3;
  constantDice(state);
  const record = submitVisit(state);
  assert.equal(record.score, record.target);
  assert.equal(record.passed, true);
  assert.equal(state.phase, 'shop');
});

test('eight successful weekly evaluations clear after exactly 24 visits and 72 submissions', () => {
  const state = fixture([piece('p', 3, 1000, line(2))], [relic('mirror', 'source', 0, 0), relic('coin', 'coin', 1, 0)]);
  constantDice(state);
  let submissions = 0;
  let visits = 0;
  while (state.phase === 'visit') {
    const week = state.week;
    const visitor = state.visitor;
    const multiplier = getWeekMultiplier(week);
    submitVisit(state);
    submissions += 3;
    visits++;
    if (state.phase === 'won') break;
    assert.equal(state.phase, 'shop');
    assert.equal(state.week, week, 'The weekend shop remains in the current week.');
    assert.equal(getWeekMultiplier(state.week), multiplier);
    act(state, {type: 'NEXT_VISITOR'});
    if (visitor === 3) {
      close(getWeekMultiplier(state.week), multiplier * CONFIG.weeklyRate * (CONFIG.bossWeeks.includes(week) ? CONFIG.bossJump : 1));
      assert.equal(state.visitor, 1);
    }
    assert.ok(visits <= 24, 'The run must terminate after eight weeks.');
  }
  assert.equal(state.phase, 'won');
  assert.equal(state.week, 8);
  assert.equal(visits, 24);
  assert.equal(submissions, 72);
  assert.equal(state.history.length, 24);
  assert.equal(state.history.filter(record => record.evaluator).length, 8);
  assert.equal(state.shop, null);
  assert.equal(action(state, {type: 'SUBMIT'}).ok, false);
});
