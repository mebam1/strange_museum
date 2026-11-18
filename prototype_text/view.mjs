import Core from '../prototype/core.js';
import Game from '../prototype/game.js';
import { command as originalCommand } from '../prototype/cli.mjs';

const { RELICS, TOKENS, CONFIG } = Core;
const RELIC_MARKS = Object.fromEntries(Object.keys(RELICS).map((id, i) => [id, 'R' + (i + 1)]));
const TOKEN_MARKS = Object.fromEntries(Object.keys(TOKENS).map((id, i) => [id, 't' + (i + 1)]));
const DIRECTIONS = ['↑', '→', '↓', '←'];
const PHASES = { intro: '개관 준비', viewing: '관람', shop: '상점', won: '클리어', lost: '평가 탈락' };

function offers(ids, priced) {
  return ids.map((id, i) => {
    if (!id) return `  ${i + 1}. 판매 완료`;
    const item = RELICS[id];
    return `  ${i + 1}. ${item.name}${priced ? ' ' + item.price + '원' : ''} · ${item.description}`;
  }).join('\n');
}

function counts(names) {
  const tally = new Map();
  for (const name of names) tally.set(name, (tally.get(name) ?? 0) + 1);
  return [...tally].map(([name, count]) => count === 1 ? name : name + '×' + count).join(', ') || '없음';
}

export function renderState(game) {
  const { phase, view, board } = game;
  const lines = [
    `[${PHASES[phase]}] ${game.week}주 · 관객 ${game.visitor}/${CONFIG.visitorsPerWeek} · ${game.money}원 · 주사위 ${game.dice.length}개`,
    '전시 유물 ' + counts(Object.values(board.relics).map(item => RELICS[item.id].name)) +
      ' | 토큰 ' + counts(Object.values(board.tokens).map(id => TOKENS[id].name))
  ];
  if (phase === 'intro') {
    lines.push(originalCommand(game, 'schedule'));
  } else if (phase === 'viewing') {
    const projection = Game.projected(game);
    const rolled = view.remaining.map(die => `#${die.id}=${Core.valueOf(game, die)}`);
    const submitted = view.submitted.map(die => `#${die.id}=${die.value}`);
    lines.push(
      `주사위 번호=눈   ${rolled.join('  ') || '없음'}`,
      `제출 ${view.submissions}회 · 사용한 주사위 ${submitted.join(' ') || '없음'} · 리롤 ${view.rerollsLeft}회 남음`,
      `합 ${view.sum} · 배율 +${view.mult} · 종료 토큰 합 +${projection.tokenSum} · 지금 종료 시 감동 ${projection.score} / 기준 ${view.target}`
    );
    if (view.boss) {
      lines.push(`${view.boss.name} (${view.boss.strength}) · ${view.boss.rule}`);
      if (view.sealedFace != null) lines.push('봉인된 눈 ' + view.sealedFace);
      lines.push(`지금 종료 시 평가 ${projection.score >= view.target ? '통과' : '탈락'} | 누적 피해 ${view.damage.join(' / ') || '없음'}`);
    }
    lines.push('관람 뒤 무료 후보 ' + view.rewards.map(id => RELICS[id].name).join(', '));
  } else {
    const r = game.lastResult;
    lines.push(`정산 감동 ${r.score} / 기준 ${r.target} · ${r.grade} · 팁 ${r.tip}원`);
    if (view.boss) lines.push('평가 피해 ' + (r.damage.join(' / ') || '없음'));
    if (phase === 'shop') {
      const empty = board.cells.filter(pos => !board.tokens[pos] && !board.relics[pos]);
      lines.push('새 칸 ' + Game.cellPrice(game) + '원 · 배치 가능한 칸 ' + (empty.map(pos => '(' + pos + ')').join(' ') || '없음'));
      lines.push(game.shop.rewardDone ? '무료 선택 완료' : '무료 보상\n' + offers(view.rewards, false));
      lines.push('유료 진열\n' + offers(game.shop.stock, true));
    }
  }
  return lines.join('\n');
}

function relicStatus(board, pos) {
  const item = board.relics[pos];
  const def = RELICS[item.id];
  const parts = [];
  if (def.facing) parts.push('방향 ' + DIRECTIONS[item.facing]);
  if (item.charges != null) parts.push('충전 ' + item.charges);
  if (def.kind === 'dice') {
    const destroy = def.effects.find(effect => effect.type === 'destroyTokens');
    const grant = def.effects.find(effect => effect.type === 'grantDieIfDestroyed');
    const nearby = Core.targets(board, pos, destroy.scope, item.facing);
    const count = nearby.filter(p => board.tokens[p] === destroy.token).length;
    parts.push(`인접 ${TOKENS[destroy.token].name} ${count}/${grant.required}`);
  }
  return parts.join(' · ');
}

function boardMark(board, owned, pos) {
  if (board.relics[pos]) return RELIC_MARKS[board.relics[pos].id];
  if (board.tokens[pos]) return (owned.has(pos) ? '+' : '') + TOKEN_MARKS[board.tokens[pos]];
  return owned.has(pos) ? '+' : '.';
}

// Bound the number of printed cells even when two purchased rooms are very far apart.
function axisWindow(values, limit) {
  let min = Infinity, max = -Infinity;
  for (const n of values) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  const size = Math.min(limit, max - min + 1);
  const start = Math.min(Math.max(min, -Math.floor(size / 2)), max - (size - 1));
  return Array.from({ length: size }, (_, i) => start + i);
}

export function renderBoard(game) {
  const board = game.board;
  const owned = new Set(board.cells);
  const keys = [...new Set([...owned, ...Object.keys(board.tokens)])].sort(Core.comparePos);
  if (!keys.length) return '전시판이 비어 있습니다.';
  const coords = keys.map(pos => pos.split(',').map(Number));
  const xs = axisWindow(coords.map(([x]) => x), 13);
  const ys = axisWindow(coords.map(([, y]) => y), 9);
  const columnWidth = Math.max(3, ...xs.map(x => String(x).length));
  const labelWidth = Math.max(3, ...ys.map(y => String(y).length));
  const lines = ['전시판   x →   y ↓', 'y/x'.padStart(labelWidth) + ' | ' +
    xs.map(x => String(x).padStart(columnWidth)).join(' ')];
  for (const y of ys) {
    const row = xs.map(x => boardMark(board, owned, x + ',' + y).padStart(columnWidth));
    lines.push(String(y).padStart(labelWidth) + ' | ' + row.join(' '));
  }
  const outside = coords.filter(([x, y]) => x < xs[0] || x > xs.at(-1) || y < ys[0] || y > ys.at(-1)).length;
  if (outside) lines.push('표 밖 ' + outside + '자리도 아래 좌표 목록에 포함합니다.');
  lines.push('R 유물 · t 토큰 · + 구매한 빈칸 · +t 구매한 칸의 토큰 · . 미구매 빈자리');
  const groups = new Map();
  for (const pos of keys) {
    const item = board.relics[pos];
    const token = board.tokens[pos];
    const name = item ? RELICS[item.id].name : token ? TOKENS[token].name : '빈칸';
    const label = boardMark(board, owned, pos) + ' ' + name;
    if (!groups.has(label)) groups.set(label, []);
    const status = item ? relicStatus(board, pos) : '';
    groups.get(label).push('(' + pos + ')' + (status ? ' [' + status + ']' : ''));
  }
  for (const [label, cells] of groups) lines.push(label + '   ' + cells.join(' '));
  return lines.join('\n');
}

export function inspect(game, x, y) {
  if (![x, y].every(value => typeof value === 'number' || (typeof value === 'string' && /^-?\d+$/.test(value)))) {
    return 'inspect x y에 정수 좌표 두 개를 입력하세요.';
  }
  const numbers = [Number(x), Number(y)];
  if (!numbers.every(Number.isSafeInteger)) return 'inspect x y에 표현 가능한 정수 좌표 두 개를 입력하세요.';
  const pos = numbers.join(',');
  const board = game.board;
  const item = board.relics[pos], token = board.tokens[pos];
  const owned = board.cells.includes(pos);
  const lines = ['(' + pos + ') ' + (owned ? '구매한 칸' : '미구매 자리')];
  if (item) {
    const def = RELICS[item.id];
    lines.push(def.name + ' · ' + def.description);
    const status = relicStatus(board, pos);
    if (status) lines.push(status);
    const scopes = new Set([def.trigger.where, ...def.effects.map(e => e.scope)].filter(Boolean));
    for (const scope of scopes) {
      const targets = Core.targets(board, pos, scope, item.facing).map(p => {
        const content = board.relics[p] ? RELICS[board.relics[p].id].name : TOKENS[board.tokens[p]]?.name;
        return '(' + p + ') ' + (content || '빈자리');
      });
      const region = { adjacent: '인접', facing: '방향', rowCol: '구매한 같은 행·열' }[scope];
      lines.push(region + ' 대상   ' + (targets.join(' | ') || '없음'));
    }
  } else if (token) {
    lines.push(TOKENS[token].name + ' · ' + TOKENS[token].description);
    lines.push('토큰이 차지한 자리입니다.');
  } else {
    lines.push(owned ? '유물을 놓을 수 있는 빈칸입니다.' : '유물을 놓으려면 이 자리를 먼저 구매하세요.');
  }
  return lines.join('\n');
}

export function formatTrace(trace) {
  return trace.map(event => {
    const coords = event.pos ? '(' + event.pos + ') ' : '';
    if (event.type === 'pattern') {
      const bindings = Object.entries(event.bindings ?? {}).map(([key, value]) => key + '=' + value);
      return '패턴 ' + event.text + (bindings.length ? ' (' + bindings.join(', ') + ')' : '');
    }
    const label = event.type === 'warning' ? '경고 · ' : event.type === 'boss' ? '평가 피해 · ' : '';
    const die = event.type === 'changeFace' ? '주사위 #' + event.die + ' · ' : '';
    return label + coords + die + event.text;
  }).join('\n');
}
