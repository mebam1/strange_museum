import assert from 'node:assert/strict';
import test from 'node:test';
import Game from '../../prototype/game.js';
import Core from '../../prototype/core.js';
import { renderState, renderBoard, inspect, formatTrace } from '../view.mjs';

test('멀리 떨어진 칸도 좌표 목록에 남고 토큰 아래의 소유 여부를 구분한다', () => {
  const game = Game.newGame(42);
  const far = Number.MAX_SAFE_INTEGER + ',' + Number.MIN_SAFE_INTEGER;
  game.board.cells.push(far);
  game.board.tokens[far] = 'dust';
  game.board.tokens['1,0'] = 'dust';
  const text = renderBoard(game);
  assert.ok(text.includes(far));
  assert.match(text, /표 밖 1자리/);
  assert.match(text, /\+t\d+ 먼지/);
  assert.match(text, /^t\d+ 먼지/m);
  assert.ok(text.length < 2000);
  assert.match(inspect(game, 1, 0), /미구매 자리\n먼지/);
});

test('유물 조사와 지도는 충전, 방향, 인접 토큰 진척을 실제 칸에서 읽는다', () => {
  const game = Game.newGame(42);
  game.board.relics['0,0'] = Core.instance('carver');
  game.board.relics['2,0'] = Core.instance('die_coin');
  game.board.relics['1,1'] = Core.instance('scribe', 1);
  game.board.tokens['1,0'] = 'coin';
  assert.match(inspect(game, 0, 0), /충전 6/);
  assert.match(inspect(game, 2, 0), /인접 동전 1\/2/);
  assert.match(inspect(game, '1', '1'), /방향 대상\s+\(2,1\) 빈자리/);
  assert.match(renderBoard(game), /인접 동전 1\/2/);
  assert.match(inspect(game, undefined, ''), /정수 좌표/);
});

test('텍스트 미리읽기는 상태를 보존하고 발동 좌표와 대입을 표시한다', () => {
  const game = Game.newGame(42);
  Game.startViewing(game);
  const first = game.view.remaining[0];
  const face = Core.valueOf(game, first);
  const before = structuredClone(game);
  assert.ok(renderState(game).includes('#' + first.id + '=' + face));
  const trace = formatTrace(Game.preview(game, [first.id]).trace);
  assert.ok(trace.includes('x=' + face));
  assert.ok(trace.includes('(0,0) 안내원 발동'));
  assert.deepEqual(game, before);
  Game.endViewing(game);
  assert.match(renderState(game), /무료 보상\n {2}1\./);
});
