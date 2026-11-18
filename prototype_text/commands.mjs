import Game from '../prototype/game.js';
import Policy from '../prototype/policy.js';
import { command as museumInfo } from '../prototype/cli.mjs';
import { renderState, renderBoard, inspect, formatTrace } from './view.mjs';

export const help = [
  'view / board / inspect X Y   현재 상태, 공간 배치, 자리의 효과와 인접 관계',
  'schedule / catalog / dice    주간 평가 일정, 유물 목록, 영구 주사위 면',
  'start / next                관람 시작. 상점에서 next를 쓰면 남은 무료 보상은 만료',
  'preview ID ...              이 주사위들을 함께 냈을 때의 효과와 예상 감동',
  'compare 1 2 / 3 | 3 / 1 2  두 계획을 같은 상태에서 비교. /는 다음 제출',
  'submit ID ... / roll ID ... 선택한 번호를 제출하거나 다시 굴리기',
  'end / auto                  조기 정산 또는 이번 관람을 자동 정책으로 진행',
  'cell X Y                    칸 구매',
  'artifact free|shop N X Y [방향]   무료 보상 또는 진열 N번을 해당 칸에 배치',
  'move X Y 새X 새Y [방향] / rotate X Y / sell X Y / skip',
  'note 메모 / review / quit    판단 근거 기록, 관객별 정산과 메모 확인, 저장 후 종료',
  'ID는 주사위 번호, 방향은 위 0 · 오른쪽 1 · 아래 2 · 왼쪽 3입니다.'
].join('\n');

const read = (text, evidence) => ({ ok: true, changed: false, text, evidence });
const fail = text => ({ ok: false, changed: false, text });
const whole = input => /^-?\d+$/.test(input) && Number.isSafeInteger(Number(input));
const hasDice = (game, ids) => ids.length && new Set(ids).size === ids.length &&
  ids.every(id => game.view.remaining.some(d => d.id === id));
const coords = (args, i) => [Number(args[i]), Number(args[i + 1])].join(',');

function advanced(game, trace = []) {
  const messages = trace.length ? formatTrace(trace) + '\n' : '';
  return { ok: true, changed: true, text: messages + renderState(game) };
}

function compare(game, input) {
  const alternatives = input.split('|');
  if (alternatives.length < 2) return fail('두 계획을 | 로 나누세요. 한 계획의 연속 제출은 / 로 구분합니다.');
  const outcomes = [];
  for (const plan of alternatives) {
    const trial = structuredClone(game);
    const steps = [];
    for (const group of plan.split('/')) {
      const args = group.trim().split(/\s+/);
      const ids = args.map(Number);
      if (!args.every(whole) || trial.phase !== 'viewing' || !hasDice(trial, ids)) {
        return fail('비교할 수 없는 제출입니다. 각 계획에서 아직 남은 주사위 번호를 사용하세요.');
      }
      const trace = Game.submit(trial, ids);
      steps.push({ ids, score: Game.projected(trial).score,
        events: trace.filter(e => ['pattern','fire','create','transform','destroy','grantDie','boss','warning'].includes(e.type)) });
    }
    outcomes.push({ steps, score: Game.projected(trial).score,
      remaining: trial.view.remaining.map(e => e.id), diceCount: trial.dice.length });
  }
  const text = outcomes.map((o, i) => {
    const chain = o.steps.map(s => '#' + s.ids.join('+#') + ' → ' + s.score).join('  /  ');
    const impacts = o.steps.flatMap(s => s.events.filter(e => ['grantDie','warning','boss'].includes(e.type)).map(e => e.text));
    const tokens = new Map();
    for (const step of o.steps) {
      for (const event of step.events) {
        if (!['create','destroy','transform'].includes(event.type)) continue;
        tokens.set(event.text, (tokens.get(event.text) || 0) + 1);
      }
    }
    const changes = [...tokens].map(([label, count]) => label + ' ×' + count).join(' / ');
    return '안 ' + (i + 1) + '   ' + chain + '\n  지금 마감 시 감동 ' + o.score + ' · 남은 주사위 ' +
      (o.remaining.map(id=>'#' + id).join(' ') || '없음') + ' · 보유 ' + o.diceCount + '개' +
      (changes ? '\n  제출 중 ' + changes : '') +
      (impacts.length ? '\n  ' + impacts.join(' / ') : '');
  }).join('\n');
  return read(text, { plans: outcomes });
}

function trade(game, verb, args) {
  if (game.phase !== 'shop') return fail('상점에서 사용할 수 있습니다.');
  let ok = false;
  switch (verb) {
    case 'artifact': {
      if (!['free','shop'].includes(args[0]) || ![4,5].includes(args.length) || !args.slice(1).every(whole)) {
        return fail('artifact free|shop 번호 X Y [방향] 형식으로 입력하세요.');
      }
      ok = Game.acquire(game, args[0] === 'free' ? 'reward' : 'stock',
        Number(args[1]) - 1, coords(args, 2), Number(args[4] ?? 0));
      break;
    }
    case 'move':
      if (![4,5].includes(args.length) || !args.every(whole)) return fail('move X Y 새X 새Y [방향] 형식으로 입력하세요.');
      ok = Game.moveRelic(game, coords(args, 0), coords(args, 2), args[4] === undefined ? undefined : Number(args[4]));
      break;
    case 'skip':
      if (args.length) return fail('skip만 입력하세요.');
      ok = Game.declineReward(game);
      break;
    default: {
      if (args.length !== 2 || !args.every(whole)) return fail(verb + ' X Y 형식으로 입력하세요.');
      const transaction = { cell: Game.buyCell, sell: Game.sellRelic, rotate: Game.rotateRelic }[verb];
      ok = transaction(game, coords(args, 0));
    }
  }
  return ok ? advanced(game) : fail('거래가 성립하지 않았습니다. 잔액, 구매한 빈칸, 유물과 토큰, 선택 가능한 상품을 확인하세요.');
}

export function applyCommand(game, line) {
  const input = line.trim();
  const [verb, ...args] = input.split(/\s+/);
  if (['view','shop','help','board','catalog','dice','schedule'].includes(verb)) {
    if (args.length) return fail(verb + '에는 인수가 필요하지 않습니다.');
    if (verb === 'view' || verb === 'shop') return read(renderState(game));
    if (verb === 'board') return read(renderBoard(game));
    if (verb === 'help') return read(help);
    return read(museumInfo(game, verb));
  }
  if (verb === 'inspect') {
    if (args.length !== 2 || !args.every(whole)) return fail('inspect X Y 형식으로 입력하세요.');
    return read(inspect(game, ...args.map(Number)));
  }
  if (verb === 'start' || verb === 'next') {
    if (args.length || !Game.startViewing(game)) return fail('개관 전이나 상점에서 다음 관객을 맞을 수 있습니다.');
    return advanced(game);
  }
  if (['artifact','move','cell','rotate','sell','skip'].includes(verb)) return trade(game, verb, args);
  if (!['preview','compare','submit','roll','reroll','end','auto'].includes(verb)) return fail('알 수 없는 명령입니다. help로 조작법을 확인하세요.');
  if (game.phase !== 'viewing') return fail('관람 중에 사용할 수 있습니다.');
  if (verb === 'compare') return compare(game, input.slice(verb.length));
  if (verb === 'end' || verb === 'auto') {
    if (args.length) return fail(verb + '에는 인수가 필요하지 않습니다.');
    if (verb === 'end') return advanced(game, Game.endViewing(game));
    const trace = [];
    while (game.phase === 'viewing') trace.push(...Policy.step(game).trace);
    return advanced(game, trace);
  }
  const ids = args.map(Number);
  if (!args.every(whole) || !hasDice(game, ids)) return fail('남아 있는 주사위 번호를 중복 없이 입력하세요.');
  if (verb === 'preview') {
    const p = Game.preview(game, ids);
    return read(formatTrace(p.trace) + '\n제출 후 예상 감동 ' + p.score + ' / ' + game.view.target,
      { ids, score: p.score, trace: p.trace });
  }
  if (verb === 'submit') return advanced(game, Game.submit(game, ids));
  if (!game.view.rerollsLeft) return fail('이번 관람의 리롤을 모두 사용했습니다.');
  return advanced(game, Game.reroll(game, ids));
}
