import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Game from '../../prototype/game.js';
import { applyCommand } from '../commands.mjs';

const textRoot = fileURLToPath(new URL('../', import.meta.url));

function visit() {
  const game = Game.newGame(42);
  assert.ok(applyCommand(game, 'start').ok);
  return game;
}

test('여러 계획을 같은 굴림에서 비교하고 각 단계가 실제 제출과 일치한다', () => {
  const game = visit();
  game.view.remaining.forEach((die, index) => { die.face = [1, 1, 4, 4, 4, 5][index]; });
  const before = structuredClone(game);
  const compared = applyCommand(game, 'compare 1 2 / 3 / 4 / 5 | 3 4 / 1 / 2 / 5');
  assert.ok(compared.ok);
  assert.equal(compared.changed, false);
  const plans = compared.evidence.plans;
  assert.equal(plans.length, 2);
  assert.deepEqual(game, before);
  for (const plan of plans) {
    const actual = structuredClone(before);
    for (const step of plan.steps) {
      const expected = applyCommand(actual, 'preview ' + step.ids.join(' '));
      assert.equal(expected.changed, false);
      assert.equal(expected.evidence.score, step.score);
      assert.ok(applyCommand(actual, 'submit ' + step.ids.join(' ')).ok);
      assert.equal(Game.projected(actual).score, step.score);
    }
    assert.deepEqual(plan.remaining, actual.view.remaining.map(die => die.id));
  }
  assert.deepEqual(plans.map(plan => plan.score), [30, 18]);
});

test('봉인 면의 임의 영구 변경과 마지막 제출 정산도 비교가 재현한다', () => {
  const game = Game.newGame(1);
  game.week = 4;
  game.visitor = 3;
  game.schedule[3] = Game.bossEntry(4, 'diversity');
  assert.ok(applyCommand(game, 'start').ok);
  game.view.remaining.forEach((die, i) => { die.face = i; });
  assert.equal(game.view.sealedFace, 6);
  const before = structuredClone(game);
  const preview = applyCommand(game, 'preview 6');
  const compared = applyCommand(game, 'compare 6 / 1 2 3 4 5 | 1 2 3 4 5 / 6');
  assert.ok(compared.ok);
  assert.deepEqual(game, before);
  const first = compared.evidence.plans[0].steps[0];
  const damages = first.events.filter(e => e.type === 'boss');
  assert.deepEqual(damages.map(e => e.kind), ['sealed', 'faceChanged']);
  assert.deepEqual(damages, preview.evidence.trace.filter(e => e.type === 'boss'));
  for (const plan of compared.evidence.plans) {
    const branch = structuredClone(before);
    for (const step of plan.steps) assert.ok(applyCommand(branch, 'submit ' + step.ids.join(' ')).ok);
    assert.equal(branch.phase, 'lost');
    assert.deepEqual(plan.remaining, []);
    assert.equal(plan.score, branch.lastResult.score);
    assert.deepEqual(branch.lastResult.damage, plan.steps.flatMap(s => s.events.filter(e => e.type === 'boss').map(e => e.text)));
  }
});

test('이미 쓴 번호와 잘못된 번호, 정산 뒤의 추가 제출은 비교 전체를 거절한다', () => {
  const game = visit();
  assert.ok(applyCommand(game, 'submit 1').ok);
  const before = structuredClone(game);
  for (const line of [
    'preview 1', 'preview 2 2', 'preview 99', 'compare 2 | 2 / 2',
    'compare 2 | 1', 'compare 2 | 99', 'compare 2 | 2 3 4 5 6 / 3'
  ]) {
    const result = applyCommand(game, line);
    assert.equal(result.ok, false, line);
    assert.equal(result.changed, false, line);
    assert.deepEqual(game, before, line);
  }
});

test('잘못된 상점 거래가 돈과 무료 선택권과 상품을 유지한다', () => {
  const game = visit();
  assert.ok(applyCommand(game, 'end').ok);
  assert.equal(game.phase, 'shop');
  const before = structuredClone(game);
  for (const line of ['artifact free 1 0 0', 'artifact shop 1 -8 -8', 'artifact shop 1 1 1 4', 'move 0 0 2 0', 'cell 0 0']) {
    const result = applyCommand(game, line);
    assert.equal(result.ok, false, line);
    assert.deepEqual(game, before, line);
  }
  assert.ok(applyCommand(game, 'artifact free 1 1 1').ok);
  const after = structuredClone(game);
  assert.equal(game.money, before.money);
  assert.equal(game.shop.rewardDone, true);
  assert.equal(applyCommand(game, 'skip').ok, false);
  assert.deepEqual(game, after);
});

function runCli(args) {
  const result = spawnSync(process.execPath, [path.join(textRoot, 'cli.mjs'), ...args], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('시드 1120의 독립 플레이 명령을 CLI로 실행하고 같은 결과로 복원·재생한다', t => {
  const temp = mkdtempSync(path.join(tmpdir(), 'museum-text-play-'));
  const record = path.join(temp, 'run.jsonl');
  t.after(() => {
    try { unlinkSync(record); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    rmdirSync(temp);
  });
  const script = path.join(textRoot, 'playtests', 'independent.commands.txt');
  const played = runCli(['--seed', '1120', '--record', record, '--commands', script]);
  assert.match(played, /\[클리어\] 8주 · 관객 3\/3 · 570원 · 주사위 9개/);
  assert.match(played, /정산 감동 1040 \/ 기준 600/);
  const originalLog = readFileSync(record, 'utf8');
  const resumed = runCli(['--resume', record, '--do', 'review']);
  const replayed = runCli(['--replay', record]);
  for (const text of [resumed, replayed]) {
    assert.match(text, /8주 클리어 · 정산한 관객 24명/);
    assert.match(text, /자동 관람 0회/);
    assert.match(text, /8주 3번\s+감동 1040\/600/);
  }
  const finalVisit = runCli(['--replay', record, '--visit', '8.3']);
  assert.match(finalVisit, /> next\r?\n\[관람\] 8주 · 관객 3\/3/);
  assert.match(finalVisit, /메모  마지막 평가/);
  assert.match(finalVisit, /정산 감동 1040 \/ 기준 600/);
  assert.doesNotMatch(finalVisit, /\[관람\] 8주 · 관객 2\/3/);
  assert.equal(readFileSync(record, 'utf8'), originalLog);
});
