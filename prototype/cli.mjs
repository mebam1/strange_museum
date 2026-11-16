import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createGame, action, previewSubmission, getVisitorTarget, getArtifactFootprint } from './dist/engine.js';
import { ARTIFACTS, getArtifactDefinition } from './dist/catalog.js';

const money = n => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
const entryName = (item,state) => item?.kind ? (getArtifactDefinition(item,state)?.name || item.kind) : `눈 ${item?.face ?? '?'} 조각`;
const cellKey = (x, y) => `${x},${y}`;
const allCells = state => state.pieces.flatMap(p => p.cells || []);

export function describe(state) {
  const target = getVisitorTarget(state);
  const lines = [`\n══ 이상한 박물관 · 텍스트 프로토타입 ══`,
    `${state.week} / 8주 · ${state.visitor === 3 ? '평가 담당자' : `일반 관객 ${state.visitor}`} · ${state.phase} · 보유 ${money(state.money)}원`,
    `감동 ${money(state.visit?.score)} / 기준 ${money(target)} · 제출 ${state.visit?.submissionsLeft ?? 0}회 · 리롤 ${state.visit?.rerollsLeft ?? 0}회`,
    `주사위 ${state.dice.map((d, i) => `${i + 1}:${d.value}${d.held ? '[보관]' : ''}`).join('  ')}`,
    `조각 ${state.pieces.map(p => `${p.id}(눈${p.face},Lv.${p.level},${p.cells.length}칸)`).join(' ')}`,
    `유물 ${state.artifacts.map(a => `${a.id}:${entryName(a,state)}@${a.x},${a.y} ${getArtifactFootprint(state,a).length}칸${a.charges == null ? '' : ` 충전${a.charges}`}`).join(' / ')}`];
  if (state.phase === 'won') lines.push('8주 평가 통과! 클리어했습니다.');
  if (state.phase === 'lost') lines.push('평가 기준에 도달하지 못했습니다. 이번 런이 종료됐습니다.');
  return lines.join('\n');
}

export function boardText(state) {
  const cells = allCells(state);
  if (!cells.length) return '(빈 박물관)';
  const x0 = Math.min(...cells.map(c => c.x)) - 1, x1 = Math.max(...cells.map(c => c.x)) + 1;
  const y0 = Math.min(...cells.map(c => c.y)) - 1, y1 = Math.max(...cells.map(c => c.y)) + 1;
  const grid = new Map();
  for (const p of state.pieces) for (const c of p.cells) {
    const key = cellKey(c.x, c.y); const faces = grid.get(key) || [];
    faces.push(p.face); grid.set(key, faces);
  }
  const artifactCells=new Set(state.artifacts.flatMap(a=>getArtifactFootprint(state,a)).map(c=>cellKey(c.x,c.y)));
  const rows = ['좌표별 요구 눈 (유물 점유 칸은 *)', '    ' + Array.from({ length: Math.min(x1 - x0 + 1, 25) }, (_, i) => String(x0 + i).padStart(5)).join('')];
  for (let y = y0; y <= Math.min(y1, y0 + 24); y++) {
    let line = String(y).padStart(3) + ' ';
    for (let x = x0; x <= Math.min(x1, x0 + 24); x++) {
      const faces = grid.get(cellKey(x, y));
      const occupied = artifactCells.has(cellKey(x,y));
      line += (faces ? faces.sort().join('') + (occupied ? '*' : '') : '.').padStart(5);
    }
    rows.push(line);
  }
  return rows.join('\n');
}

export function shopText(state) {
  if (!state.shop) return '상점은 관람이 끝나면 열립니다.';
  const s = state.shop;
  const pieceReward=(s.freePieces||[]).length>0;
  const lines = [`\n[무료 보상!!] 유물 3개 중 1개${pieceReward?' / 평가 통과 조각 3개 중 1개':''}. 받으면 즉시 배치합니다.`];
  const groups=[['freeArtifacts','무료 유물'],...(pieceReward?[['freePieces','평가 통과 조각']]:[]),['artifacts','판매 유물']];
  for (const [key, title] of groups) {
    lines.push(title + ':');
    (s[key] || []).forEach((item, i) => lines.push(`  ${i + 1}. ${entryName(item,state)} ${item.shape || item.shapeId || ''} ${key.startsWith('free') ? '무료' : `${money(item.price)}원`}${item.kind ? ` · ${getArtifactDefinition(item,state).cells.length}칸 · ${getArtifactDefinition(item,state).description}` : ` · 모양 ${JSON.stringify(item.cells)}`}`));
  }
  lines.push(`무료 유물 선택: ${s.freeArtifactClaimed ? '완료' : '가능'} · ${pieceReward?`주간 조각 선택: ${s.freePieceClaimed ? '완료' : '가능'}`:'조각은 주간 평가 통과 후 선택 가능'}`);
  lines.push('상점에서는 조각을 판매하지 않습니다.');
  lines.push(`명령 예: ${pieceReward?'piece free 1 2 0 0 / ':''}artifact free 1 2 0 / edit 1 6 1 / sell a1 / next`);
  return lines.join('\n');
}

const help = `\n명령 (번호는 1부터, 좌표는 보드 표시 기준):
  view / board / shop / dice / log       현재 상태·보드·상점·주사위 면·최근 연쇄
  preview / catalog                     현재 제출 예상 결과 / 모든 유물 설명
  hold 1 3                              지정 주사위 보관 전환
  release                               모든 보관 해제
  roll                                  보관하지 않은 주사위 리롤
  submit                                결과 제출, 감동과 강화 처리
  piece free 번호 x y [회전]              평가 통과 조각 배치 (회전 0·1·2·3)
  artifact free|shop 번호 x y [회전]      유물 선택 후 배치
  move 유물ID x y [회전]                 상점에서 유물 이동
  skip piece|artifact                    무료 보상 거절
  sell 유물ID                            상점에서 유물 판매
  edit 주사위번호 면번호 새눈              상점에서 면 하나 변경
  next                                  상점 종료, 다음 관람
  quit                                  종료
JSON 형식의 action도 한 줄로 입력할 수 있습니다.`;

export function command(state, text) {
  const raw = text.trim();
  if (!raw || raw.startsWith('#')) return { ok: true, quiet: true };
  if (raw.startsWith('{')) return action(state, JSON.parse(raw));
  const [cmd, ...a] = raw.split(/\s+/); const n = i => Number(a[i]);
  if (cmd === 'preview') {
    const r = previewSubmission(state);
    return {ok:true, message:`예상 감동 ${money(r.score)} = 합 ${money(r.additive)} × 배율 ${Number(r.multiplier.toPrecision(6))}\n발동 ${JSON.stringify(r.counts)}\n강화 ${JSON.stringify(r.upgrades)}`};
  }
  if (cmd === 'catalog') return {ok:true,message:Object.values(ARTIFACTS).map(d=>`${d.name} (${d.kind}) ${d.cells.length}칸 · ${d.price}원 · ${d.description}`).join('\n')};
  if (cmd === 'hold') {
    let result = { ok: true };
    for (const value of a) { result = action(state, { type: 'HOLD', die: Number(value) - 1 }); if (!result.ok) break; }
    return result;
  }
  if (cmd === 'release') { for (let i = 0; i < state.dice.length; i++) if (state.dice[i].held) action(state, { type: 'HOLD', die: i }); return { ok: true }; }
  if (cmd === 'roll') return action(state, { type: 'REROLL' });
  if (cmd === 'submit') return action(state, { type: 'SUBMIT' });
  if (cmd === 'next') return action(state, { type: 'NEXT_VISITOR' });
  if (cmd === 'skip') return action(state, { type: 'SKIP_FREE', category: a[0] });
  if (cmd === 'sell') return action(state, { type: 'SELL', artifactId: a[0] });
  if (cmd === 'edit') return action(state, { type: 'EDIT_DIE', die: n(0) - 1, face: n(1) - 1, value: n(2) });
  if (cmd === 'move') return action(state, { type: 'MOVE_ARTIFACT', artifactId: a[0], x: n(1), y: n(2), rotation: n(3) || 0 });
  if (cmd === 'piece' || cmd === 'artifact') return action(state, { type: cmd === 'piece' ? 'PLACE_PIECE' : 'PLACE_ARTIFACT', source: a[0], index: n(1) - 1, x: n(2), y: n(3), rotation: n(4) || 0 });
  return { ok: false, error: '알 수 없는 명령입니다. help를 입력하세요.' };
}

async function main() {
  const arg = process.argv.indexOf('--seed');
  const seed = arg >= 0 ? Number(process.argv[arg + 1]) : Date.now();
  const state = createGame(seed);
  console.log(`시드: ${seed}`); console.log(help); console.log(describe(state)); console.log(boardText(state));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  if (process.stdin.isTTY) { rl.setPrompt('\n박물관> '); rl.prompt(); }
  for await (const line of rl) {
    const cmd = line.trim();
    if (cmd === 'quit' || cmd === 'exit') break;
    try {
      if (cmd === 'help') console.log(help);
      else if (cmd === 'view') console.log(describe(state));
      else if (cmd === 'board') console.log(boardText(state));
      else if (cmd === 'shop') console.log(shopText(state));
      else if (cmd === 'dice') state.dice.forEach((d, i) => console.log(`${i + 1}. 현재 ${d.value} · 면 [${d.faces.join(', ')}]`));
      else if (cmd === 'log') console.log(JSON.stringify(state.lastResolution, null, 2));
      else {
        const result = command(state, cmd);
        if (!result.ok) console.log('실행 불가: ' + result.error);
        else if (result.message) console.log(result.message);
        else if (!result.quiet) {
          if (result.resolution) console.log(`이번 제출: ${money(result.resolution.score)} 감동`);
          console.log(describe(state));
          if (state.phase === 'shop') console.log(shopText(state));
        }
      }
    } catch (error) { console.log('입력 오류: ' + error.message); }
    if (process.stdin.isTTY) rl.prompt();
  }
  rl.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
