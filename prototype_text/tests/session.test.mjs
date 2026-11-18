import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Game from '../../prototype/game.js';
import { openSession } from '../session.mjs';

function tempFile(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'museum-text-session-'));
  t.after(() => rmSync(dir, { recursive: true }));
  return path.join(dir, 'session.jsonl');
}
function applyCommand(game, command) {
  const [name, value] = command.split(' ');
  const ids = [Number(value)];
  switch (name) {
    case 'view': return { ok: true, changed: false, text: game.phase };
    case 'start': return { ok: Game.startViewing(game), changed: true, text: '관람 시작' };
    case 'preview': {
      const preview = Game.preview(game, ids);
      return { ok: true, changed: false, text: '예상 ' + preview.score, evidence: { score: preview.score } };
    }
    case 'submit': {
      const trace = Game.submit(game, ids);
      return { ok: trace.length > 0, changed: true, text: trace.map(e => e.text).join('\n') };
    }
    default: return { ok: false, changed: false, text: '알 수 없는 명령' };
  }
}

test('기록이 있는 세션을 이어서 쓰고 모두 재생한다', t => {
  const file = tempFile(t);
  const create = openSession(file, { seed: 700, applyCommand });
  create.act('view');
  create.act('wrong');
  create.act('start');
  const choice = create.act('preview 1');
  create.note('주사위 한 개의 합을 먼저 확인');
  create.close();
  const prefix = readFileSync(file, 'utf8');
  const resumed = openSession(file, { resume: true, applyCommand });
  assert.deepEqual(resumed.game, create.game);
  assert.equal(resumed.entries.length, 4);
  assert.equal(resumed.entries[2].output, choice.text);
  assert.equal(resumed.entries[3].phase, 'viewing');
  assert.equal(resumed.act('submit 1').ok, true);
  assert.ok(readFileSync(file, 'utf8').startsWith(prefix));
  const replay = openSession(file, { readOnly: true, applyCommand });
  assert.deepEqual(replay.game, resumed.game);
  assert.equal(replay.act('view').text, 'viewing');
  assert.throws(() => replay.act('submit 2'), /읽기 전용/);
  assert.throws(() => replay.note('메모'));
  assert.equal(replay.entries.length, 5);
});

test('다른 쓰기 세션이 진행하면 나중 제출과 메모가 기존 기록과 메모리 상태를 덮어쓰지 않는다', t => {
  const file = tempFile(t);
  const a = openSession(file, { seed: 2, applyCommand });
  const b = openSession(file, { resume: true, applyCommand });
  a.act('start');
  assert.throws(() => b.act('start'), /다른 세션/);
  assert.equal(b.game.phase, 'intro');
  assert.equal(b.entries.length, 1);
  assert.throws(() => b.note('늦은 메모'), /다른 세션/);
  assert.equal(openSession(file, { readOnly: true, applyCommand }).entries.length, 2);
  assert.throws(() => openSession(file, { seed: 4, applyCommand }), /EEXIST/);
});

test('화면 문구만 바뀌어도 재생되며 변한 결과 또는 미리보기 수치를 식별한다', t => {
  const file = tempFile(t);
  const base = openSession(file, { seed: 3, applyCommand });
  base.act('start');
  base.act('preview 1');
  function revised(game, cmd) { return { ...applyCommand(game, cmd), text: '새로운 문구' }; }
  assert.deepEqual(openSession(file, { readOnly: true, applyCommand: revised }).game, base.game);
  function drift(game, cmd) {
    const result = revised(game, cmd);
    if (result.evidence) result.evidence.score++;
    return result;
  }
  assert.throws(() => openSession(file, { readOnly: true, applyCommand: drift }), /3행.*근거/);
  assert.throws(() => openSession(file, { resume: true, seed: 10, applyCommand }), /시드/);
  const old = readFileSync(file, 'utf8');
  writeFileSync(file, old.replace(/"rulesVersion":\d+/, '"rulesVersion":0'));
  assert.throws(() => openSession(file, { resume: true, applyCommand }), /호환/);
  writeFileSync(file, old.replace(/"hash":"[a-f0-9]+"/, '"hash":"wrong"'));
  assert.throws(() => openSession(file, { resume: true, applyCommand }), /1행.*상태/);
  writeFileSync(file, old + '{"type":');
  assert.throws(() => openSession(file, { resume: true, applyCommand }), /불완전/);
  writeFileSync(file, old + '\n');
  assert.throws(() => openSession(file, { resume: true, applyCommand }), /4행/);
});

test('파일 없는 런도 명령과 근거를 같은 순서로 기록한다', () => {
  const a = openSession(null, { seed: 3, applyCommand });
  assert.equal(a.seed, 3);
  a.act('start');
  const memo = a.note('첫 관람');
  assert.equal(memo.seq, 2);
  assert.throws(() => a.note(' '));
  a.close();
  assert.throws(() => a.act('view'), /닫혔/);
});
