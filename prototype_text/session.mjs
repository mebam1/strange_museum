import { createHash } from 'node:crypto';
import {
  closeSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync,
  readFileSync, readSync, unlinkSync, writeFileSync, writeSync
} from 'node:fs';
import path from 'node:path';
import Game from '../prototype/game.js';

const FORMAT = 1;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const position = ({ week, visitor, phase }) => ({ week, visitor, phase });
const encode = record => JSON.stringify(record) + '\n';
const isPreview = command => /^(preview|compare)(?:\s|$)/i.test(command);
const validSeed = seed => Number.isSafeInteger(seed) || (typeof seed === 'string' && seed.length > 0);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

// Hold the writer guard for a single disk operation. An idle prompt never
// blocks a later invocation from recording a new command.
function withWriter(file, callback) {
  const guard = file + '.writing';
  let fd;
  try {
    fd = openSync(guard, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('다른 프로세스가 기록을 쓰고 있습니다. 잠금 파일 ' + guard);
    throw error;
  }
  try {
    writeFileSync(fd, String(process.pid) + '\n');
    return callback();
  } finally {
    closeSync(fd);
    unlinkSync(guard);
  }
}

function replay(source, applyCommand, requestedSeed, onReplay) {
  check(source.endsWith('\n'), '기록의 마지막 줄이 불완전합니다.');
  const lines = source.slice(0, -1).split('\n');
  let game;
  const entries = [];
  for (const [index, line] of lines.entries()) {
    try {
      const entry = JSON.parse(line);
      let result;
      check(entry.seq === index, '기록 순번이 일치하지 않습니다.');
      if (index === 0) {
        check(entry.type === 'session' && entry.format === FORMAT && entry.rulesVersion === Game.RULES_VERSION,
          '호환되지 않는 세션 형식 또는 규칙 버전입니다.');
        check(validSeed(entry.seed), '시드가 올바르지 않습니다.');
        check(requestedSeed === undefined || entry.seed === requestedSeed, '기록과 지정한 시드가 다릅니다.');
        game = Game.newGame(entry.seed);
      } else {
        check(entry.week === game.week && entry.visitor === game.visitor && entry.phase === game.phase,
          '관람 위치 또는 진행 단계가 다릅니다.');
        if (entry.type === 'command') {
          check(typeof entry.command === 'string' && typeof entry.changed === 'boolean', '명령 기록이 올바르지 않습니다.');
          result = applyCommand(game, entry.command);
          check(result.ok && result.changed === entry.changed, '명령 결과가 달라졌습니다.');
          if (Object.hasOwn(entry, 'evidence')) {
            check(result.evidence !== undefined && digest(result.evidence) === digest(entry.evidence),
              '미리보기 또는 실행 근거가 달라졌습니다.');
          }
        } else {
          check(entry.type === 'note' && typeof entry.text === 'string' && entry.text.trim(), '알 수 없는 기록입니다.');
        }
      }
      check(digest(game) === entry.hash, '재현된 게임 상태가 저장된 상태와 다릅니다.');
      entries.push(entry);
      onReplay?.(entry, result, position(game));
    } catch (error) {
      throw new Error('세션 ' + (index + 1) + '행 복원 실패 · ' + error.message, { cause: error });
    }
  }
  return { game, entries };
}

/** Start a new seeded run, or rebuild one from the recorded commands. */
export function openSession(file, { seed, resume = false, readOnly = false, applyCommand, onReplay } = {}) {
  check(typeof applyCommand === 'function', '명령 실행 함수가 필요합니다.');
  if (seed !== undefined) check(validSeed(seed), '시드에는 정수 또는 문자열을 사용하세요.');
  const filename = file ? path.resolve(file) : null;
  let game, entries, length = 0, lastLine = '', closed = false;
  if (resume || readOnly) {
    check(filename, '이어하기 또는 재생할 기록 경로가 필요합니다.');
    const source = readFileSync(filename, 'utf8');
    ({ game, entries } = replay(source, applyCommand, seed, onReplay));
    length = Buffer.byteLength(source);
    lastLine = source.slice(source.lastIndexOf('\n', source.length - 2) + 1);
  } else {
    game = Game.newGame(seed);
    const header = { type: 'session', seq: 0, format: FORMAT, rulesVersion: Game.RULES_VERSION,
      seed: game.seed, hash: digest(game) };
    entries = [header];
    lastLine = encode(header);
    length = Buffer.byteLength(lastLine);
    if (filename) {
      mkdirSync(path.dirname(filename), { recursive: true });
      withWriter(filename, () => {
        // Exclusive creation protects an existing playtest, including an empty file.
        const fd = openSync(filename, 'wx');
        let written = false;
        try {
          writeFileSync(fd, lastLine);
          fsyncSync(fd);
          written = true;
        } finally {
          closeSync(fd);
          if (!written) unlinkSync(filename);
        }
      });
    }
  }

  function append(entry) {
    const serialized = encode(entry);
    if (filename) {
      withWriter(filename, () => {
        const fd = openSync(filename, 'r+');
        try {
          const previous = Buffer.from(lastLine);
          const tail = Buffer.alloc(previous.length);
          check(fstatSync(fd).size === length &&
            readSync(fd, tail, 0, tail.length, length - previous.length) === tail.length && tail.equals(previous),
            '다른 세션에서 기록이 바뀌었습니다. 이어하기로 다시 열어 주세요.');
          try {
            const bytes = Buffer.from(serialized);
            for (let offset = 0; offset < bytes.length;) {
              const written = writeSync(fd, bytes, offset, bytes.length - offset, length + offset);
              check(written > 0, '세션 기록을 쓸 수 없습니다.');
              offset += written;
            }
            fsyncSync(fd);
          } catch (error) {
            ftruncateSync(fd, length);
            throw error;
          }
        } finally { closeSync(fd); }
      });
    }
    lastLine = serialized;
    length += Buffer.byteLength(serialized);
    entries.push(entry);
  }

  return {
    get game() { return game; },
    get seed() { return game.seed; },
    get entries() { return entries; },
    act(input) {
      check(!closed, '세션이 닫혔습니다.');
      const command = input.trim();
      // Keep memory in step with disk, even if a command fails or another
      // writer moves the game between preview and submit.
      const next = structuredClone(game);
      const result = applyCommand(next, command);
      if (!result.ok) return result;
      if (readOnly) {
        check(!result.changed, '읽기 전용 세션에서는 진행할 수 없습니다.');
        return result;
      }
      if (result.changed || isPreview(command)) {
        const hash = digest(next);
        if (!result.changed) check(hash === digest(game), '조회 명령이 게임 상태를 바꿨습니다.');
        const entry = { seq: entries.length, type: 'command', ...position(game), command,
          changed: result.changed, hash };
        if (isPreview(command)) entry.output = result.text;
        if (result.evidence !== undefined) entry.evidence = structuredClone(result.evidence);
        append(entry);
        game = next;
      }
      return result;
    },
    note(input) {
      check(!closed && !readOnly, '이 세션에 메모를 쓸 수 없습니다.');
      const text = input.trim();
      check(text, '기록할 메모를 입력하세요.');
      const entry = { seq: entries.length, type: 'note', ...position(game), text, hash: digest(game) };
      append(entry);
      return entry;
    },
    close() { closed = true; }
  };
}
