'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const Core = require('../core.js');
const Game = require('../game.js');
const Policy = require('../policy.js');

function viewing(faces) {
  const game = Game.newGame(1);
  Game.startViewing(game);
  game.view.remaining = faces.map((face, i) => ({ id: game.dice[i].id, face: face - 1 }));
  return game;
}

test('자동 제출은 감동 증가량을 최대화하고 동률이면 주사위를 아낀다', () => {
  const game = viewing([4, 4, 5]);
  game.view.sum = 7;
  const before = structuredClone(game);
  assert.deepEqual(Policy.chooseAction(game), { type: 'submit', ids: [1, 2] });
  assert.deepEqual(game, before);
  game.view.sum = 5;
  assert.deepEqual(Policy.chooseAction(game), { type: 'submit', ids: [3] });
});

test('점수가 늘지 않으면 남은 주사위 전부를 리롤하고 소진 후 종료한다', () => {
  const game = viewing([3, 5]);
  game.board.relics = {};
  const ids = game.view.remaining.map(d => d.id);
  assert.deepEqual(Policy.chooseAction(game), { type: 'reroll', ids });
  game.view.rerollsLeft = 0;
  assert.equal(Policy.step(game).type, 'end');
  assert.equal(game.phase, 'shop');
});

test('영구 주사위 소실과 토큰만 잃는 제출을 피한다', () => {
  const game = viewing([1, 1]);
  game.view.boss = Game.bossEntry(4, 'steady');
  game.week = 4;
  assert.equal(Policy.chooseAction(game).type, 'reroll');
  game.view.boss = null;
  game.view.sum = 8;
  game.board.relics['1,1'] = Core.instance('die_coin');
  game.board.tokens['1,0'] = 'coin';
  assert.equal(Game.preview(game, [1, 2]).warnings.length, 1);
  assert.equal(Policy.chooseAction(game).ids.length, 1);
});

test('13개부터 크기 6까지 모든 부분집합을 검사한다', t => {
  const game = viewing([1]);
  game.view.remaining = Array.from({ length: 13 }, (_, i) => ({ id: i + 1, face: 0 }));
  const sizes = Array(7).fill(0);
  t.mock.method(Game, 'preview', (_, ids) => {
    sizes[ids.length]++;
    return { score: 0, permanentLosses: 0, permanentFaceChanges: 0, newDust: 0, temporaryLosses: 0, warnings: [] };
  });
  Policy.chooseAction(game);
  assert.deepEqual(sizes, [0, 13, 78, 286, 715, 1287, 1716]);
});

test('같은 시드의 두 자동 런은 24관객과 최종 상태가 모두 일치한다', () => {
  const first = Policy.run(1);
  assert.deepEqual(Policy.run(1), first);
  assert.equal(first.phase, 'won');
  assert.equal(first.history.length, Core.CONFIG.weeks * Core.CONFIG.visitorsPerWeek);
  assert.deepEqual(first.history.map(v => v.week * 10 + v.visitor),
    Array.from({ length: 24 }, (_, i) => (1 + Math.floor(i / 3)) * 10 + 1 + i % 3));
  assert.equal(Policy.step(first).type, 'done');
});

test('패배 런도 자동으로 끝나며 미도달 주차는 표본 없음으로 기록한다', async () => {
  const { simulate } = await import('../simulate.mjs');
  const report = simulate(1, 6);
  const result = report.runs[0];
  assert.equal(result.outcome, 'lost');
  assert.ok(result.finalWeek < Core.CONFIG.weeks);
  const finalReached = report.weeks[result.finalWeek - 1];
  assert.equal(finalReached.diceAfterEvaluation.median, result.finalDice);
  assert.equal(finalReached.visitors.at(-1).impression.min, result.visits.at(-1).score);
  assert.equal(report.weeks[result.finalWeek].reachRate, 0);
  assert.equal(report.weeks[result.finalWeek].visitors[0].impression, null);
});

test('시뮬레이션 JSON은 기존 실험 파일을 덮어쓰지 않는다', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'museum-v5-sim-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dest = path.join(dir, 'report.json');
  const script = path.resolve(__dirname, '../simulate.mjs');
  const invoke = seed => spawnSync(process.execPath, [script, '--seeds', '1', '--start', String(seed), '--out', dest], { encoding: 'utf8' });
  const first = invoke(6);
  assert.equal(first.status, 0, first.stderr);
  const original = readFileSync(dest, 'utf8');
  assert.equal(JSON.parse(original).firstSeed, 6);
  assert.notEqual(invoke(1).status, 0);
  assert.equal(readFileSync(dest, 'utf8'), original);
});

test('텍스트 게임에서 관람 미리보기, 분할 제출, 상점, 다음 관람을 실행한다', async () => {
  const { command } = await import('../cli.mjs');
  const game = Game.newGame(42);
  assert.match(command(game, 'start'), /남은 주사위/);
  const before = structuredClone(game);
  assert.match(command(game, 'preview 1'), /예상 감동/);
  assert.deepEqual(game, before);
  command(game, 'submit 1');
  assert.equal(game.view.remaining.length, 5);
  command(game, 'auto');
  assert.equal(game.phase, 'shop');
  command(game, 'artifact free 1 1 1');
  assert.equal(game.shop.rewardDone, true);
  command(game, 'cell -7 15');
  assert.ok(game.board.cells.includes('-7,15'));
  command(game, 'next');
  assert.equal(game.visitor, 2);
});
