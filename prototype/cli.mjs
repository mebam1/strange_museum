import readline from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Core from './core.js';
import Game from './game.js';
import Policy from './policy.js';

const help = [
  'view · board · schedule · catalog · dice · help · quit',
  'start / next                 첫 관람 또는 상점 뒤 다음 관람',
  'preview 1 3 / submit 1 3     지정한 주사위 번호로 미리보기 또는 제출',
  'roll 2 4 / end / auto        지정 주사위 리롤 / 조기 종료 / 이번 관람 자동 진행',
  'cell x y                     지정한 칸 구매',
  'artifact free|shop 번호 x y [방향]     보상 또는 진열 유물 선택 및 배치',
  'move x y 새x 새y [방향] / rotate x y / sell x y / skip',
  '방향은 위 0, 오른쪽 1, 아래 2, 왼쪽 3입니다. 좌표는 음수도 가능합니다.'
].join('\n');

function schedule(game) {
  return game.schedule.map(b => b.week + '주 · ' + b.name + ' (' + b.strength + ') · ' + b.rule).join('\n');
}

function offers(ids, withPrice) {
  return ids.map((id, i) => {
    if (!id) return (i + 1) + '. 판매 완료';
    const item = Core.RELICS[id];
    return (i + 1) + '. ' + item.name + (withPrice ? ' ' + item.price + '원' : '') + ' · ' + item.description;
  }).join('\n');
}

export function describe(game) {
  const v = game.view;
  const lines = ['이상한 박물관 · ' + game.week + '주 · ' + game.visitor + '번째 관객 · ' + game.money + '원'];
  if (game.phase === 'intro') return lines.concat(schedule(game), 'start로 첫 관람을 엽니다.').join('\n');
  if (game.phase === 'viewing') {
    if (v.boss) lines.push(v.boss.name + ' (' + v.boss.strength + ') · ' + v.boss.rule);
    if (v.sealedFace) lines.push('봉인된 눈 ' + v.sealedFace);
    const p = Game.projected(game);
    lines.push('남은 주사위 ' + v.remaining.map(d => '#' + d.id + '=' + Core.valueOf(game, d)).join('  '),
      '제출한 눈 ' + (v.submitted.map(d => d.value).join(' · ') || '없음') + ' / 남은 리롤 ' + v.rerollsLeft,
      '합 ' + v.sum + ' · 배율 +' + v.mult + ' · 종료 토큰 합 +' + p.tokenSum + ' · 예상 감동 ' + p.score + ' / ' + v.target,
      '관람 뒤 받을 유물\n' + offers(v.rewards, false));
    if (v.damage.length) lines.push('평가 피해\n' + v.damage.join('\n'));
  } else {
    const r = game.lastResult;
    lines.push('감동 ' + r.score + ' / ' + r.target + ' · ' + r.grade + ' · 팁 ' + r.tip + '원');
    if (r.damage.length) lines.push('평가 피해\n' + r.damage.join('\n'));
    if (game.phase === 'shop') {
      lines.push('상점 · 새 칸 ' + Game.cellPrice(game) + '원',
        game.shop.rewardDone ? '무료 선택 완료' : '무료 보상\n' + offers(v.rewards, false),
        '진열\n' + offers(game.shop.stock, true));
    } else lines.push(game.phase === 'won' ? '8주차 평가 통과 · 클리어' : '평가 미달 · 런 종료');
  }
  return lines.join('\n');
}

function board(game) {
  const positions = new Set([...game.board.cells, ...Object.keys(game.board.tokens)]);
  return [...positions].sort(Core.comparePos).map(pos => {
    const relic = game.board.relics[pos], token = game.board.tokens[pos];
    const content = relic ? Core.RELICS[relic.id].name : token ? Core.TOKENS[token].name : '빈칸';
    const direction = relic && Core.RELICS[relic.id].facing ? ' ' + ['↑', '→', '↓', '←'][relic.facing] : '';
    const charges = relic?.charges != null ? ' · 충전 ' + relic.charges : '';
    return '(' + pos + ') ' + content + direction + charges + (game.board.cells.includes(pos) ? ' · 소유' : ' · 미구매');
  }).join('\n');
}

function messages(trace) { return trace.map(event => event.text).filter(Boolean).join('\n'); }

export function command(game, line) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  if (cmd === '') return '';
  if (cmd === 'help') return help;
  if (cmd === 'schedule') return schedule(game);
  if (cmd === 'view' || cmd === 'shop') return describe(game);
  if (cmd === 'board') return board(game);
  if (cmd === 'catalog') return offers(Object.keys(Core.RELICS), true);
  if (cmd === 'dice') return game.dice.map(d => '#' + d.id + ' · ' + d.faces.join(' ')).join('\n');
  if (cmd === 'preview' || cmd === 'submit' || cmd === 'roll' || cmd === 'reroll') {
    const ids = args.map(Number);
    if (game.phase !== 'viewing' || !ids.length || new Set(ids).size !== ids.length ||
      ids.some(id => !game.view.remaining.some(entry => entry.id === id))) return '남은 주사위 번호를 골라 주세요.';
    if (cmd === 'preview') {
      const p = Game.preview(game, ids);
      return messages(p.trace) + '\n제출 후 예상 감동 ' + p.score;
    }
    const trace = cmd === 'submit' ? Game.submit(game, ids) : Game.reroll(game, ids);
    if (!trace.length) return '리롤 횟수를 확인해 주세요.';
    return messages(trace) + '\n' + describe(game);
  }
  if (cmd === 'auto' && game.phase === 'viewing') {
    const trace = [];
    while (game.phase === 'viewing') trace.push(...Policy.step(game).trace);
    return messages(trace) + '\n' + describe(game);
  }
  if (cmd === 'end' && game.phase === 'viewing') {
    Game.endViewing(game);
    return describe(game);
  }
  const pos = i => args[i] + ',' + args[i + 1];
  let ok;
  switch (cmd) {
    case 'start': case 'next': ok = Game.startViewing(game); break;
    case 'cell': ok = Game.buyCell(game, pos(0)); break;
    case 'skip': ok = Game.declineReward(game); break;
    case 'artifact': {
      const source = { free: 'reward', shop: 'stock' }[args[0]];
      ok = Game.acquire(game, source, Number(args[1]) - 1, pos(2), Number(args[4] ?? 0));
      break;
    }
    case 'move': ok = Game.moveRelic(game, pos(0), pos(2), args[4] === undefined ? undefined : Number(args[4])); break;
    case 'rotate': ok = Game.rotateRelic(game, pos(0)); break;
    case 'sell': ok = Game.sellRelic(game, pos(0)); break;
    default: return '현재 사용할 수 없는 명령입니다. help에서 조작법을 확인하세요.';
  }
  return ok ? describe(game) : '실행할 수 없습니다. 현재 단계, 자리, 보유 금액을 확인해 주세요.';
}

async function main() {
  const seedAt = process.argv.indexOf('--seed');
  const seed = seedAt < 0 ? Date.now() : Number(process.argv[seedAt + 1]);
  if (!Number.isSafeInteger(seed)) throw new Error('시드에는 정수를 입력해 주세요.');
  const game = Game.newGame(seed);
  console.log('시드 ' + seed + '\n' + help + '\n\n' + describe(game));
  const terminal = Boolean(process.stdin.isTTY);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal });
  rl.setPrompt('박물관> ');
  if (terminal) rl.prompt();
  for await (const line of rl) {
    if (['quit', 'exit'].includes(line.trim())) break;
    console.log(command(game, line));
    if (terminal) rl.prompt();
  }
  rl.close();
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
