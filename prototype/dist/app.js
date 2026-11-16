import {
  CONFIG, getArtifactDefinition, action, createGame, getArtifactFootprint, getBoardCells,
  getVisitorTarget, getWeekMultiplier, legalArtifactPlacement,
  legalPiecePlacement, previewSubmission, restoreGame, rotatedCells,
} from './engine.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = (value, digits = 1) => Number.isFinite(value) ? value.toLocaleString('ko-KR', {maximumFractionDigits: digits}) : '아주 큰 감동';
const multiplier = value => number(value, 4);
const targetNumber = value => number(Math.ceil(value * 100) / 100, 2);
const key = (x, y) => `${x},${y}`;
const STORAGE_KEY = 'strange-museum-run-v4';
const PREVIOUS_STORAGE_KEYS = ['strange-museum-run-v3','strange-museum-run-v2','strange-museum-run-v1'];
let restoreNotice = '';
const TILE_GAP = 0;
const pieceColors = ['99 151 171','193 139 93','145 129 183','112 159 114','194 119 139','162 164 83','112 137 204','192 153 174'];
function pieceColor(piece) {
  // IDs also count shop offers; use placement order so consecutive pieces differ.
  const index=Math.max(0,shownState().pieces.findIndex(p=>p.id===piece.id));
  return pieceColors[index%pieceColors.length];
}
const triggers = {tile:'칸 반응',chain:'연쇄 반응',static:'상시 지원'};
const effects = {add:'합연산',multiply:'곱연산',upgrade:'조각 강화',addModifier:'효과 보정'};
const paths = {
  coin:'<circle cx="32" cy="31" r="22"/><circle cx="32" cy="31" r="16"/><path d="m32 19 3.5 7.5 8.5 1-6.2 5.7 1.7 8.3-7.5-4.2-7.5 4.2 1.7-8.3-6.2-5.7 8.5-1Z"/><path d="m15 49 4 4m26-4-4 4"/>',
  mirror:'<ellipse cx="29" cy="25" rx="18" ry="21" transform="rotate(22 29 25)"/><ellipse cx="29" cy="25" rx="13" ry="16" transform="rotate(22 29 25)"/><path d="m36 45 7 13 6-3-7-13M22 15l10-3m-12 9 17-6"/>',
  long_mirror:'<rect x="5" y="14" width="54" height="36" rx="8"/><rect x="10" y="19" width="44" height="26" rx="5"/><path d="M32 19v26M15 30l9-6m15 15 10-7M13 51v5m38-5v5"/>',
  brush:'<path d="m22 41 24-32c2-3 7 1 5 4L30 48ZM20 39l13 10M16 43l13 8c-5 12-17 8-20 10 1-5-3-13 7-18ZM16 48l-2 8m8-5-4 5"/>',
  observer:'<path d="m9 26 32-12 6 16-32 12ZM40 13l5-2 8 20-5 2M10 28l-4 2 4 11 5-2M29 37l-1 7m0 0-12 15m12-15 13 15m-13-15 1 15"/><circle cx="29" cy="42" r="3"/>',
  conduit:'<circle cx="10" cy="32" r="6"/><circle cx="54" cy="17" r="6"/><circle cx="54" cy="47" r="6"/><path d="M16 32h15m0 0V17h17M31 32v15h17"/><rect x="25" y="26" width="12" height="12" rx="3"/>',
  prism:'<path d="m32 6 25 47H7Z"/><path d="m32 6-9 47m9-47 9 47M12 44h40M3 27h20m18-3 20-8M41 31h20m-20 7 20 8"/>',
  bell:'<path d="M14 43h36l-6-9V25c0-8-5-14-12-14S20 17 20 25v9ZM12 47h40M27 51a5 5 0 0 0 10 0M29 9V5h6v4M25 25c0-5 2-7 5-8"/>',
  seal:'<path d="m20 40-3 20 11-7 6 6 4-20m3-1 7 17-10-4-4 6"/><path d="m32 5 6 5 8 1 2 8 5 6-4 7-1 8-8 2-6 5-7-4-8-1-2-8-5-6 4-7 1-8 8-2Z"/><circle cx="32" cy="26" r="12"/><path d="m26 26 4 4 8-9"/>',
  echo:'<path d="m22 8 22 3 12 18-13 25-25 1L7 34ZM22 8l7 24 15-21M7 34l22-2 14 22M29 32l27-3M18 55l11-23"/><path d="m5 13 4 3m45 34 5 1M39 3l1 4"/>',
  pedestal:'<path d="M12 51h40v8H12ZM17 43h30v8H17ZM21 25h22v18H21ZM15 18h34v7H15ZM20 11h24v7H20Z"/><path d="m26 30 0 8m12-8v8M29 5h6v6"/>',
  frame:'<rect x="5" y="11" width="54" height="42" rx="3"/><rect x="11" y="17" width="42" height="30" rx="1"/><path d="m12 41 12-12 12 13 7-9 10 11"/><circle cx="40" cy="25" r="4"/><path d="m7 8 4-3m46 3-4-3"/>',
  gift:'<path d="M10 27h44v11H10ZM15 38v21h34V38M31 27v32M9 27h46"/><path d="M31 27C9 24 13 6 23 12c5 3 8 15 8 15Zm0 0c22-3 18-21 8-15-5 3-8 15-8 15Z"/>',
  museum:'<path d="M6 21 32 5l26 16M10 24h44M15 28v24m11-24v24m12-24v24m11-24v24M9 56h46"/>',
};
function icon(kind, className = '') { return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" class="${className}">${paths[kind] || paths.museum}</svg>`; }
function pips(value) {
  const positions = {1:[[16,16]],2:[[7,7],[25,25]],3:[[7,7],[16,16],[25,25]],4:[[7,7],[25,7],[7,25],[25,25]],5:[[7,7],[25,7],[16,16],[7,25],[25,25]],6:[[7,6],[25,6],[7,16],[25,16],[7,26],[25,26]]};
  return `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">${(positions[value] || []).map(([cx,cy])=>`<circle cx="${cx}" cy="${cy}" r="2.5"/>`).join('')}</svg>`;
}
function shapeMini(offer) {
  const cells = offer.cells || [];
  const width = Math.max(...cells.map(c=>c.x),0)+1, height = Math.max(...cells.map(c=>c.y),0)+1;
  return `<svg viewBox="-2 -2 ${width*13+2} ${height*13+2}" aria-hidden="true" focusable="false">${cells.map(c=>`<rect x="${c.x*13}" y="${c.y*13}" width="10" height="10" rx="2" style="fill:#c6cfab;stroke:#71865d;stroke-width:1"/>`).join('')}</svg>`;
}
function randomSeed() { return crypto.getRandomValues(new Uint32Array(1))[0]; }
function loadState() {
  try {
    // Keep the old slot intact so a completed pre-cap run remains recoverable.
    const saved = JSON.parse([STORAGE_KEY,...PREVIOUS_STORAGE_KEYS].map(key=>localStorage.getItem(key)).find(Boolean) || 'null');
    const s = saved?.state;
    if (saved?.format !== 1 || s?.version !== 1 || !Array.isArray(s.pieces) || !Array.isArray(s.artifacts) || !Array.isArray(s.dice) || !s.dice.length || !['visit','shop','won','lost'].includes(s.phase)) return null;
    if (!s.dice.every(d=>Array.isArray(d.faces)&&d.faces.length===6&&d.faces.every(n=>Number.isInteger(n)&&n>=1&&n<=6))) return null;
    if((s.rulesVersion??1)<4)restoreNotice=['won','lost'].includes(s.phase)?'이전 규칙으로 마친 런의 기록입니다. 새 박물관에서는 관객마다 유물 보상, 평가 통과 뒤 조각 보상과 새로운 다칸 유물을 만나 보세요.':'새 보상·유물 규칙으로 이어갑니다. 유물은 관객마다, 조각은 주간 평가 통과 뒤에 받으며 상점은 유물만 판매합니다. 이전 저장도 별도로 보존합니다.';
    return restoreGame(s);
  } catch { return null; }
}
const restored = loadState();
let state = restored || createGame(randomSeed());
let selection = {x:0,y:0,artifactId:state.artifacts[0]?.id || null};
let selectedPiece = null;
let pending = null;
let giftOpen = false;
let animation = null;
let forecast = null;
let cellMap = new Map();
let countMap = new Map();
let bounds = null;
let tileSize = 68;
let hoverCell = null;
let editDraft = null;
let toastTimer;
let firstBoard = true;
let drag = null;
let dragScrollFrame = null;
let suppressClickUntil = 0;

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({format:1,state})); $('save-state').textContent='자동 저장됨'; }
  catch { $('save-state').textContent='저장 공간 부족'; }
}
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent=message; $('toast').classList.add('show');
  toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);
}
function shownState() { return animation?.before || state; }
function nameOf(id,s=shownState()) { const a=s.artifacts.find(item=>item.id===id); return a?getArtifactDefinition(a,s).name:'사용 완료 유물'; }
function currentCount(id) { return forecast?.counts[id] || 0; }
function effectText(def,artifact=null,s=shownState()) {
  if(def.kind==='prism'){const count=artifact?getBoardCells(s).find(c=>c.x===artifact.x&&c.y===artifact.y)?.pieceIds.length:0;return count?`감동 +${number(def.value*count)} · 겹친 조각 ${count}개`:`감동 +${number(def.value)} × 겹친 조각 수`;}
  if(def.effect==='add')return `감동 +${number(def.value)}`;
  if(def.effect==='multiply'){
    const applied=artifact?forecast?.effectValues?.[artifact.id]:null;
    const bonus=artifact&&forecast?.conditionBonuses?.[artifact.id];
    return `감동 ×${multiplier(applied??def.value)}${bonus?` · 조건 충족 (기본 ×${multiplier(def.value)})`:''}`;
  }
  if(def.effect==='upgrade')return '조각 레벨 +1';
  return `이웃 효과 +${number(def.value)}`;
}
function dialogOpen(id) { const dialog=$(id); if(!dialog.open)dialog.showModal(); }
function closeDialog(button) { button.closest('dialog')?.close(); }

function renderHeader(s) {
  document.querySelectorAll('[data-action="zoom-in"],[data-action="zoom-out"],[data-action="fit-board"]').forEach(button=>{button.disabled=!!animation;});
  $('money-total').textContent=number(s.money);
  $('seed-label').textContent=`시드 ${state.seed}${(state.rulesVersion??1)<4?' · 이전 규칙 기록':''}`;
  $('week-track').innerHTML=Array.from({length:CONFIG.weeks},(_,i)=>{
    const week=i+1, complete=week<s.week||(state.phase==='won'&&week===s.week), current=week===s.week;
    return `<div class="week-item ${complete?'completed':''} ${current?'current':''}" ${current?'aria-current="step"':''}><strong>${complete?'✓':String(week).padStart(2,'0')}</strong><span>${current?'이번 주':'주차'}</span>${CONFIG.bossWeeks.includes(week)?'<span class="boss-mark" title="보스 주간">✧</span>':''}</div>`;
  }).join('');
}
function visitorArt(evaluator) {
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M23 106c0-20 13-32 37-32s37 12 37 32" style="fill:#d8ddc6"/><path d="m42 82 18 16 18-16M59 98v12"/><path d="M37 43c0-17 9-26 24-26 17 0 24 11 24 27v12c0 18-11 28-24 28S37 73 37 56Z" style="fill:#f3ebd4"/><path d="M35 46c1-19 8-29 25-29s27 10 27 26c-10-1-20-10-25-15-5 9-15 14-27 18Z" style="fill:#6e805e"/><path d="M47 52h7m14 0h7m-16 4-1 9 5 1m-11 6c6 3 11 3 16-1"/>${evaluator?'<circle cx="50" cy="54" r="9"/><circle cx="72" cy="54" r="9"/><path d="M59 54h4M35 12h51v7H35Zm8-6h35v6H43Z"/>':'<path d="M39 35c-7 0-10-5-7-10 6-10 17-18 31-17 13 1 28 12 29 23-9-2-16-9-23-12"/>'}</svg>`;
}
function renderVisit(s) {
  const target=getVisitorTarget(s), evaluator=s.visitor===CONFIG.visitorsPerWeek;
  const completed=CONFIG.submissionsPerVisitor-s.visit.submissionsLeft;
  const score=s.visit.score;
  const ratio=score/target;
  const status=animation?'연출 중':s.phase==='shop'?'관람 완료':s.phase==='won'?'클리어':s.phase==='lost'?'운영 종료':evaluator?'주간 평가':'관람 중';
  $('visit-panel').innerHTML=`<div class="visitor-tag"><span>WEEK ${String(s.week).padStart(2,'0')} · ${s.visitor}/${CONFIG.visitorsPerWeek}</span><span class="tag ${evaluator?'gold':''}">${status}</span></div><div class="visitor-art">${visitorArt(evaluator)}</div><h2>${evaluator?'평가 담당자':s.visitor===1?'호기심 많은 관객':'전시를 찾은 관객'}</h2><p class="visitor-subtitle">${evaluator?'이번 주의 전시를 평가합니다.':'당신의 전시를 감상하고 있어요.'}</p><div class="score-label"><span>관람 누적 감동</span><span>${number(ratio*100,0)}%</span></div><strong class="score-number">${number(score)}</strong><div class="progress-track"><span style="width:${Math.min(100,Math.max(0,ratio*100))}%"></span></div><div class="target-line"><span>${evaluator?'통과 기준':'보상 기준'}</span><strong>${targetNumber(target)}</strong></div><div class="submissions">${Array.from({length:CONFIG.submissionsPerVisitor},(_,i)=>`<span class="submission-mark ${i<completed?'used':''}">${i<completed?'✓':`${i+1}차 제출`}</span>`).join('')}</div><p class="visit-note">${evaluator?'평가 담당자의 세 제출 감동만으로 통과를 결정합니다.':'매주 세 번째 관객은 평가 담당자입니다. 그 전에 전시를 준비하세요.'}</p>`;
}
function renderForecast(s) {
  if(animation){
    $('forecast-panel').innerHTML=`<span class="eyebrow">THE EXHIBITION IS ALIVE</span><h2>감동이 이어지는 중</h2><div class="forecast-score">${number(animation.resolution.score)}<small>감동</small></div><div class="forecast-equation"><span>합연산</span><strong>${number(animation.resolution.additive)}</strong><span>×</span><strong>${multiplier(animation.resolution.multiplier)}</strong></div><p class="forecast-note">독립 연쇄 ${number(animation.resolution.chainCount,0)}회 · 같은 연쇄는 대표 1회로 보여줍니다.</p>`;
    return;
  }
  if(s.phase==='shop'||s.phase==='won'||s.phase==='lost'){
    const record=s.lastVisitor;
    $('forecast-panel').innerHTML=`<span class="eyebrow">VISITOR'S IMPRESSION</span><h2>마지막 관객의 평가</h2><div class="forecast-score">${record?.tier||'관람 완료'}</div><div class="forecast-equation"><span>팁</span><strong>+${number(record?.tip||0)}원</strong><span>· 달성</span><strong>${number((record?.ratio||0)*100,0)}%</strong></div><p class="forecast-note">같은 등급의 팁은 모든 주차에서 같습니다. 받은 돈으로 다음 전시를 준비하세요.</p>`;
    return;
  }
  $('forecast-panel').innerHTML=`<span class="eyebrow">THIS HAND, YOUR MUSEUM</span><h2>지금 제출하면</h2><div class="forecast-score">${number(forecast.score)}<small>감동</small></div><div class="forecast-equation"><span>합연산</span><strong>${number(forecast.additive)}</strong><span>×</span><strong>${multiplier(forecast.multiplier)}</strong></div><p class="forecast-note">${forecast.upgrades.length?`조각 ${forecast.upgrades.length}개 강화 예정 · 새 횟수는 다음 제출부터`:`유물 ${Object.keys(forecast.counts).length}개 참여 · 독립 연쇄 ${forecast.chainCount}회`}</p>`;
}

function boardBounds(s) {
  const cells=s.pieces.flatMap(p=>p.cells);
  let minX=Math.min(0,...cells.map(c=>c.x))-3, maxX=Math.max(2,...cells.map(c=>c.x))+3;
  let minY=Math.min(0,...cells.map(c=>c.y))-2, maxY=Math.max(1,...cells.map(c=>c.y))+3;
  while(maxX-minX+1<10)maxX++;
  while(maxY-minY+1<7)maxY++;
  return {minX,maxX,minY,maxY,width:maxX-minX+1,height:maxY-minY+1};
}
function gridPosition(x,y,width=1,height=1) { return `grid-column:${x-bounds.minX+1}/span ${width};grid-row:${y-bounds.minY+1}/span ${height}`; }
function diceRequirement(cell) {
  // Every required face gets its own die, including duplicates and impossible bundles.
  const columns=Math.min(cell.faces.length,5), rows=Math.ceil(cell.faces.length/columns);
  const size=Math.max(5,Math.min(16,(tileSize-8-(columns-1)*2)/columns,(tileSize*.40-(rows-1)*2)/rows));
  return `<span class="cell-faces" style="--dice-size:${size}px;--dice-columns:${columns}" aria-hidden="true">${cell.faces.map(face=>`<span class="required-die" data-face="${face}">${pips(face)}</span>`).join('')}</span>`;
}
function renderBoard(s) {
  const viewport=$('board-viewport'), oldBounds=bounds;
  const scroll={left:viewport.scrollLeft,top:viewport.scrollTop};
  bounds=boardBounds(s);
  const board=getBoardCells(s); cellMap=new Map(board.map(c=>[key(c.x,c.y),c]));
  countMap=new Map((forecast?.tileCounts||[]).map(c=>[key(c.x,c.y),c.count]));
  const grid=$('board-grid');
  grid.style.setProperty('--tile-size',`${tileSize}px`);
  grid.style.setProperty('--tile-gap',`${TILE_GAP}px`);
  grid.classList.toggle('placing-piece',pending?.type==='piece');
  grid.classList.toggle('shop-board',s.phase==='shop'&&!animation);
  grid.style.gridTemplateColumns=`repeat(${bounds.width},${tileSize}px)`;
  grid.style.gridTemplateRows=`repeat(${bounds.height},${tileSize}px)`;
  grid.style.width=`${bounds.width*tileSize+(bounds.width-1)*TILE_GAP}px`;
  grid.style.height=`${bounds.height*tileSize+(bounds.height-1)*TILE_GAP}px`;
  let html='';
  for(let y=bounds.minY;y<=bounds.maxY;y++)for(let x=bounds.minX;x<=bounds.maxX;x++){
    const cell=cellMap.get(key(x,y)), count=countMap.get(key(x,y))||0;
    const isSelected=selection?.x===x&&selection?.y===y;
    const unreachable=cell&&cell.faces.length>s.dice.length;
    const highlighted=cell&&selectedPiece&&cell.pieceIds.includes(selectedPiece);
    const label=cell?`${x}, ${y} 칸. 조건 ${cell.faces.join(', ')}. 레벨 합 ${cell.levelSum}. 현재 ${count}회 발동${unreachable?'. 현재 주사위 수로 완성 불가':''}`:`${x}, ${y} 빈칸`;
    html+=`<button class="tile ${cell?'occupied':'empty'} ${cell?.faces.length>1?'overlap':''} ${count?'qualified':''} ${isSelected?'selected':''} ${highlighted?'piece-highlight':''} ${unreachable?'unreachable':''}" data-x="${x}" data-y="${y}" data-focus="tile-${x}-${y}" style="${gridPosition(x,y)}" aria-label="${esc(label)}">${cell?`${diceRequirement(cell)}<span class="cell-level">ΣLv ${cell.levelSum}</span><span class="cell-count">${unreachable?'불가':count?`×${count}`:'—'}</span>`:''}</button>`;
  }
  for(const piece of s.pieces){
    const occupied=new Set(piece.cells.map(c=>key(c.x,c.y)));
    for(const cell of piece.cells){
      const edges=[[0,-1,'top'],[1,0,'right'],[0,1,'bottom'],[-1,0,'left']].map(([dx,dy,side])=>`border-${side}-width:${occupied.has(key(cell.x+dx,cell.y+dy))?0:2}px`).join(';');
      html+=`<span class="piece-tint ${selectedPiece===piece.id?'is-selected':''}" data-piece-id="${esc(piece.id)}" aria-hidden="true" style="${gridPosition(cell.x,cell.y)};--piece-color:${pieceColor(piece)};${edges}"></span>`;
    }
  }
  for(const a of s.artifacts){
    const footprint=getArtifactFootprint(s,a), def=getArtifactDefinition(a,s);
    if(!footprint.length)continue;
    const x=Math.min(...footprint.map(c=>c.x)), y=Math.min(...footprint.map(c=>c.y));
    const width=Math.max(...footprint.map(c=>c.x))-x+1, height=Math.max(...footprint.map(c=>c.y))-y+1;
    html+=`<button class="artifact ${selection?.artifactId===a.id?'selected':''} ${pending?.artifactId===a.id?'moving':''}" data-artifact-id="${esc(a.id)}" data-x="${a.x}" data-y="${a.y}" data-effect="${def.effect}" data-required-count="${Math.max(...footprint.map(c=>cellMap.get(key(c.x,c.y))?.faces.length||0))}" data-focus="artifact-${esc(a.id)}" style="${gridPosition(x,y,width,height)}" aria-label="${esc(def.name)}. ${esc(def.description)}${a.charges==null?'':` 남은 충전 ${a.charges}`}" title="${esc(def.name)}">${icon(a.kind)}${a.charges==null?'':`<span class="charge-dot">${a.charges}</span>`}</button>`;
  }
  const width=bounds.width*tileSize+(bounds.width-1)*TILE_GAP,height=bounds.height*tileSize+(bounds.height-1)*TILE_GAP;
  html+=`<svg class="chain-lines" id="chain-lines" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"></svg>`;
  grid.innerHTML=html;
  if(oldBounds){viewport.scrollLeft=scroll.left+(oldBounds.minX-bounds.minX)*(tileSize+TILE_GAP);viewport.scrollTop=scroll.top+(oldBounds.minY-bounds.minY)*(tileSize+TILE_GAP);}
  $('zoom-label').textContent=`${Math.round(tileSize/68*100)}%`;
  $('board-caption').textContent=pending?'끌어서 놓거나 칸을 클릭하세요. 초록은 배치 가능, 빨강은 배치 불가입니다.':s.phase==='shop'?'유물은 드래그로 이동 · ΣLv 레벨 합 · × 현재 눈의 발동 횟수':'작은 주사위는 요구 눈 · ΣLv 레벨 합 · × 현재 발동 횟수';
  renderPlacement();
  renderEnd(s);
  if(firstBoard){firstBoard=false;requestAnimationFrame(fitBoard);}
}
function fitBoard() {
  if(!bounds)return;
  const viewport=$('board-viewport');
  tileSize=Math.max(42,Math.min(82,Math.floor((viewport.clientWidth-55-(bounds.width-1)*TILE_GAP)/bounds.width)));
  renderBoard(shownState()); centerBoard();
}
function centerBoard() {
  requestAnimationFrame(()=>{
    const cells=shownState().pieces.flatMap(p=>p.cells),viewport=$('board-viewport');
    const cx=(Math.min(...cells.map(c=>c.x))+Math.max(...cells.map(c=>c.x)))/2;
    const cy=(Math.min(...cells.map(c=>c.y))+Math.max(...cells.map(c=>c.y)))/2;
    viewport.scrollLeft=26+(cx-bounds.minX+.5)*(tileSize+TILE_GAP)-viewport.clientWidth/2;
    viewport.scrollTop=26+(cy-bounds.minY+.5)*(tileSize+TILE_GAP)-viewport.clientHeight/2;
  });
}
function renderPlacement() {
  const bar=$('placement-bar');bar.hidden=!pending||(drag?.active&&!drag.keepBar);
  if(!pending)return;
  const title=pending.type==='piece'?`눈 ${pending.offer.face} · ${pending.offer.name||pending.offer.shape||'폴리오미노'}`:getArtifactDefinition(pending.offer.kind).name;
  bar.innerHTML=`<button class="placement-handle" data-placement-handle aria-label="${esc(title)} 끌어서 배치" title="이 미리보기를 끌어서 놓으세요">${pending.type==='piece'?shapeMini({...pending.offer,cells:rotatedCells(pending.offer.cells,pending.rotation)}):icon(pending.offer.kind)}<span>끌어서 배치</span></button><div><strong>${esc(title)} 배치</strong><small>${pending.type==='move'?'기존 유물 이동':pending.source==='free'?'무료 보상':'구매'} · ${pending.rotation*90}° · ${pending.type==='piece'?'연결하거나 겹치세요.':'빈 박물관 칸에 놓으세요.'} 클릭도 가능</small></div><div class="placement-actions"><button class="quiet-button" data-action="rotate">↻ 회전 <kbd>R</kbd></button><button class="quiet-button" data-action="cancel-placement">취소 <kbd>Esc</kbd></button></div>`;
}
function pointFromEvent(event) {
  if(event.type==='click'&&event.detail===0&&event.target.closest('[data-x]')){
    const el=event.target.closest('[data-x]');return {x:Number(el.dataset.x),y:Number(el.dataset.y)};
  }
  const rect=$('board-grid').getBoundingClientRect();
  const viewport=$('board-viewport').getBoundingClientRect();
  if(event.clientX<viewport.left||event.clientX>=viewport.right||event.clientY<viewport.top||event.clientY>=viewport.bottom)return null;
  const x=Math.floor((event.clientX-rect.left)/(tileSize+TILE_GAP))+bounds.minX;
  const y=Math.floor((event.clientY-rect.top)/(tileSize+TILE_GAP))+bounds.minY;
  if(x<bounds.minX||x>bounds.maxX||y<bounds.minY||y>bounds.maxY)return null;
  return {x,y};
}
function placementValid(x,y) {
  if(!pending)return false;
  if(pending.type==='piece')return legalPiecePlacement(state,pending.offer,x,y,pending.rotation);
  return legalArtifactPlacement(state,pending.offer,x,y,pending.rotation,pending.artifactId||null);
}
function renderGhost(point) {
  $('board-grid').querySelectorAll('.placement-ghost').forEach(el=>el.remove());
  if(!pending||!point)return;
  const local=pending.type==='piece'?pending.offer.cells:pending.offer.cells||getArtifactDefinition(pending.offer.kind).cells;
  const valid=placementValid(point.x,point.y);
  for(const cell of rotatedCells(local,pending.rotation)){
    if(point.x+cell.x<bounds.minX||point.x+cell.x>bounds.maxX||point.y+cell.y<bounds.minY||point.y+cell.y>bounds.maxY)continue;
    const el=document.createElement('span');el.className=`placement-ghost ${valid?'':'invalid'}`;
    el.style.cssText=gridPosition(point.x+cell.x,point.y+cell.y);
    $('board-grid').appendChild(el);
  }
}
function selectAt(point,artifactId=null) {
  selection={...point,artifactId};selectedPiece=null;
  $('board-grid').querySelectorAll('.selected,.piece-highlight').forEach(el=>el.classList.remove('selected','piece-highlight'));
  $('board-grid').querySelectorAll('.piece-tint.is-selected').forEach(el=>el.classList.remove('is-selected'));
  const tile=$('board-grid').querySelector(`.tile[data-x="${point.x}"][data-y="${point.y}"]`);tile?.classList.add('selected');
  if(artifactId)$('board-grid').querySelector(`[data-artifact-id="${CSS.escape(artifactId)}"]`)?.classList.add('selected');
  renderInspector(shownState());
  $('inspector').scrollTop=0;
}

function renderInspector(s) {
  const cell=cellMap.get(key(selection?.x,selection?.y));
  let artifact=s.artifacts.find(a=>a.id===selection?.artifactId);
  if(!artifact&&cell)artifact=s.artifacts.find(a=>getArtifactFootprint(s,a).some(c=>c.x===cell.x&&c.y===cell.y));
  const pieces=cell?s.pieces.filter(p=>cell.pieceIds.includes(p.id)):[];
  const title=artifact?getArtifactDefinition(artifact,s).name:cell?'전시실의 한 칸':'아직 비어 있는 자리';
  const def=artifact?getArtifactDefinition(artifact,s):null;
  const upgradeTargets=def?.effect==='upgrade'?s.pieces.filter(p=>getArtifactFootprint(s,artifact).some(point=>p.cells.some(c=>c.x===point.x&&c.y===point.y))):[];
  const unfinished=upgradeTargets.filter(p=>p.level<CONFIG.maxPieceLevel);
  const requirements=cell?`[${cell.faces.join(', ')}]`:'조건 없음';
  const count=artifact?currentCount(artifact.id):(cell?countMap.get(key(cell.x,cell.y))||0:0);
  let body=`<div class="section-label"><span>전시 상세</span><span>${selection?.x??0}, ${selection?.y??0}</span></div>`;
  if(!cell){
    body+=`<div class="empty-detail">${icon('museum')}<p>이 자리에 조각을 이어 붙여<br>새로운 족보 조건을 만들어 보세요.</p></div>`;
    $('inspector').innerHTML=body;return;
  }
  body+=`<div class="detail-hero"><span class="detail-icon">${icon(artifact?.kind||'museum')}</span><div><h2>${title}</h2><div class="detail-type">${def?`${triggers[def.trigger]} · ${effects[def.effect]}`:'유물을 배치할 수 있어요'}</div></div></div>`;
  body+=`<p class="detail-description">${def?esc(def.description):'조각들의 눈 묶음이 조건이 됩니다. 그 조건을 만족하면 조각 레벨의 합만큼 발동합니다.'}</p>`;
  if(cell.faces.length>s.dice.length)body+=`<div class="warning-note">요구 눈이 ${cell.faces.length}개입니다. 현재 주사위 ${s.dice.length}개로는 이 칸의 조건을 완성할 수 없습니다.</div>`;
  body+=`<div class="detail-row"><span>이 칸의 요구 눈</span><strong>${requirements}</strong></div><div class="detail-row"><span>조각 레벨의 합</span><strong>${pieces.map(p=>p.level).join(' + ')} = ${cell.levelSum}</strong></div>`;
  if(artifact&&def.trigger==='tile'){
    const footprint=getArtifactFootprint(s,artifact);
    if(footprint.length>1)body+=`<div class="detail-row"><span>점유 칸의 현재 횟수</span><strong>${footprint.map(c=>countMap.get(key(c.x,c.y))||0).join(' / ')}</strong></div><p class="upgrade-status">${(s.rulesVersion??1)<4?'점유 칸의 최솟값':'가장 많이 발동하는 칸의 횟수'}을 적용합니다. 유물 전체가 하나의 원천이며 전체 외곽으로 연쇄를 전달합니다.</p>`;
  }
  if(artifact?.charges!=null)body+=`<div class="detail-row"><span>남은 강화 충전</span><strong>${artifact.charges} · 조각당 1 소모</strong></div>`;
  if(def?.effect==='upgrade')body+=`<div class="detail-row"><span>강화 가능한 조각</span><strong>${unfinished.length} / ${upgradeTargets.length}개</strong></div><p class="upgrade-status">${unfinished.length?'조각마다 런당 한 번 · Lv.1 → Lv.2': '강화 완료 · 이 자리에서는 충전을 쓰지 않습니다. 상점에서 아직 강화하지 않은 조각으로 옮겨 주세요.'}</p>`;
  body+=`<div class="detail-box"><small>${s.phase==='shop'?'현재 눈으로 보면':'이번 제출 예상'}</small><strong class="detail-number">${def?.trigger==='static'?'상시 효과':`${count}회 ${count?'발동':def?.effect==='upgrade'&&!unfinished.length?'· 강화 완료':'· 조건 대기'}`}</strong>${def?`<small>${effectText(def,artifact,s)}${def.effect==='upgrade'?' · 횟수 증가는 다음 제출부터':''}</small>`:''}</div>`;
  body+=`<h3 class="detail-subtitle">이 칸을 만드는 조각</h3><div class="piece-list">${pieces.map(p=>`<button class="piece-chip ${selectedPiece===p.id?'active':''}" data-action="highlight-piece" data-id="${esc(p.id)}" style="--piece-color:${pieceColor(p)}" aria-label="${esc(p.id)} 조각 ${p.face}눈 레벨 ${p.level}, ${p.cells.length}칸 강조"><span class="face-chip">${p.face}</span><span>${esc(p.id)} · ${p.cells.length}칸</span><span class="piece-lv">Lv.${p.level}${p.level>=CONFIG.maxPieceLevel?' · 완료':''}</span></button>`).join('')}</div>`;
  if(artifact){
    const incoming=(forecast?.chains||[]).filter(c=>c.rootId!==artifact.id&&c.steps.some(step=>step.artifactId===artifact.id));
    const outgoing=(forecast?.chains||[]).find(c=>c.rootId===artifact.id)?.steps.filter(step=>step.layer===1)||[];
    body+=`<h3 class="detail-subtitle">함께 반응하는 유물</h3><div class="detail-links">${incoming.length?incoming.map(c=>`<span class="link-pill">${esc(nameOf(c.rootId,s))}에서 ×${c.repeat}</span>`).join(''):outgoing.length?outgoing.map(step=>`<span class="link-pill">→ ${esc(nameOf(step.artifactId,s))}</span>`).join(''):def.trigger==='static'?'주변 배치에 따라 다른 유물의 효과를 지원합니다.':def.trigger==='chain'?'현재 결과에서는 전달 조건을 기다리고 있어요.':'현재 연결된 연쇄가 없어요. 주변 관계를 설계해 보세요.'}</div>`;
    if(s.phase==='shop'&&!animation)body+=`<div class="detail-actions"><button class="quiet-button" data-action="move-artifact" data-id="${esc(artifact.id)}">유물 이동</button><button class="danger-button" data-action="sell-artifact" data-id="${esc(artifact.id)}">판매 · ${number(def.price*CONFIG.saleRatio)}원</button></div>`;
  }
  $('inspector').innerHTML=body;
}
function renderRecent(s) {
  const r=s.lastResolution;
  const last=r?`<div class="last-result"><span>최근 제출</span><br><strong>${number(r.score)} 감동</strong><br>합 ${number(r.additive)} × ${multiplier(r.multiplier)} · 연쇄 ${r.chainCount}회${r.upgrades.length?`<br>조각 ${r.upgrades.length}개 강화${r.despawn.length?` · 유물 ${r.despawn.length}개 사용 완료`:''}`:''}</div>`:'';
  $('recent-panel').innerHTML=`<h3>관람 기록</h3>${last}${s.history?.length?s.history.slice(-5).reverse().map(record=>`<div class="history-line"><div>${record.week}주 · ${record.evaluator?'평가 담당자':`관객 ${record.visitor}`}<br><small>${record.tier} · 팁 ${number(record.tip)}원</small></div><strong>${number(record.score)}</strong></div>`).join(''):'<p class="history-empty">세 번의 제출을 마치면<br>첫 관객의 기록이 이곳에 남습니다.</p>'}`;
}
function renderDice(s) {
  const visiting=s.phase==='visit'&&!animation, shopping=s.phase==='shop'&&!animation;
  $('dice-dock').innerHTML=`<div class="dock-label"><span class="eyebrow">${shopping?'PREPARE NEXT EXHIBITION':'MAKE YOUR HAND'}</span><h2>${shopping?'다음 전시 준비':'이번 주사위'}</h2><p>${shopping?'주사위를 눌러 면을 개조하세요.':'주사위를 누르면 보관합니다.'}</p></div><div class="dice-tray">${s.dice.map((d,i)=>`<div class="die-wrapper"><button class="die ${d.held?'held':''}" data-action="die" data-die="${i}" data-focus="die-${i}" ${!visiting&&!shopping?'disabled':''} aria-label="${i+1}번 주사위 ${d.value}눈. ${shopping?'면 변경':d.held?'보관 해제':'보관'}" aria-pressed="${d.held}"><span class="die-index">${i+1}</span>${pips(d.value)}</button><div class="die-caption">${shopping?'면 개조':d.held?'보관 중':`${d.value}눈 · ${d.faces.filter(f=>f===d.value).length}/6`}</div></div>`).join('')}</div><div class="dock-actions">${shopping?`<button class="quiet-button" data-action="edit-open">주사위 개조</button><button class="primary-button submit-button" data-action="next-visitor" data-focus="next-visitor"><span>${s.visitor===CONFIG.visitorsPerWeek?'다음 주 개관':'다음 관객'}</span><span aria-hidden="true">→</span></button>`:s.phase==='won'||s.phase==='lost'?'<button class="primary-button" data-action="new-run">새 박물관 열기</button>':`<button class="icon-button" data-action="release-dice" aria-label="모든 주사위 보관 해제" ${!visiting?'disabled':''}>↺</button><button class="reroll-button" data-action="reroll" data-focus="reroll" ${!visiting||s.visit.rerollsLeft<=0||s.dice.every(d=>d.held)?'disabled':''}>다시 굴리기<small>공유 리롤 ${s.visit.rerollsLeft}/${CONFIG.rerollsPerVisitor}</small></button><button class="primary-button submit-button" data-action="submit" data-focus="submit" ${!visiting?'disabled':''}><span>${animation?'감동 전달 중':'결과 제출'}</span><small>${s.visit.submissionsLeft}회 남음</small></button>`}</div>`;
}
function offerCard(offer,index,type,source) {
  const def=offer.kind?getArtifactDefinition(offer.kind):null;
  const title=def?def.name:`${offer.face}눈 · ${offer.name||offer.shape||'조각'}`;
  const affordable=source==='free'||Math.round(state.money*10)>=Math.round(offer.price*10);
  const selected=pending?.type===type&&pending.source===source&&pending.index===index;
  return `<button class="offer-card ${selected?'selected':''}" data-action="pick-offer" data-type="${type}" data-source="${source}" data-index="${index}" ${!affordable?'disabled':''} aria-label="${esc(title)} ${source==='free'?'무료':`${number(offer.price)}원`}. ${def?`${def.cells.length}칸. ${esc(def.description)}. `:''}끌어서 놓거나 선택 후 칸 클릭" title="${def?esc(def.description):`${offer.cells.length}칸 조각 · 눈 ${offer.face}`}"><span class="offer-icon">${def?icon(offer.kind):shapeMini(offer)}</span><strong>${esc(title)}</strong><small>${def?`${def.cells.length}칸 · ${triggers[def.trigger]} · ${effects[def.effect]}`:`${offer.cells.length}칸 · Lv.${offer.level||1}`}</small><span class="offer-price">${source==='free'?'무료':`${number(offer.price)}원`}</span></button>`;
}
function renderShop(s) {
  const section=$('shop-section');section.hidden=s.phase!=='shop'||!!animation;
  if(section.hidden)return;
  const shop=s.shop;
  const pieceReward=(shop.freePieces||[]).length>0;
  const freeGroup=(type,label,offers,claimed)=>`<div class="offer-group"><div class="offer-heading"><strong>${label}</strong>${!claimed?`<button class="quiet-button" data-action="skip-free" data-category="${type}">거절</button>`:''}</div>${claimed?'<div class="claimed-reward">이번 보상 선택 완료</div>':`<div class="offer-grid">${offers.map((o,i)=>offerCard(o,i,type,'free')).join('')}</div>`}</div>`;
  section.innerHTML=`<div class="shop-heading"><div><span class="eyebrow">THE MUSEUM SHOP</span><h2>다음 감동을 준비하는 시간</h2><p>고른 보상과 유물은 바로 전시실에 놓습니다. 보관함은 없어요.</p></div><button class="quiet-button" data-action="next-visitor">${s.visitor===CONFIG.visitorsPerWeek?'다음 주 개관':'다음 관객'} →</button></div>
    <div class="shop-main"><div class="gift-area"><button class="gift-button" data-action="toggle-gift" aria-expanded="${giftOpen}" aria-label="무료 보상!! 선물상자 열기">${icon('gift')}<span><strong>무료 보상!!</strong><small>${pieceReward?'평가 통과! 조각 하나와 유물 하나.':'관객 보상으로 유물 하나.'}<br>당신의 전시에 필요한 선물을 고르세요.</small></span></button>
    <div class="gift-status">${shop.freeArtifactClaimed?'유물 선택 완료':'유물 선택 가능'} · ${pieceReward?(shop.freePieceClaimed?'주간 조각 선택 완료':'주간 조각 선택 가능'):'조각은 주간 평가 통과 후'}</div>
    ${giftOpen?`<div class="free-groups">${freeGroup('artifact','무료 유물 · 3개 중 1개',shop.freeArtifacts,shop.freeArtifactClaimed)}${pieceReward?freeGroup('piece','평가 통과 조각 · 3개 중 1개',shop.freePieces,shop.freePieceClaimed):'<p class="claimed-reward">이번 주 평가를 통과하면 조각 3개 중 1개를 고를 수 있어요.</p>'}</div>`:''}</div>
    <div class="store-area"><div class="offer-group"><div class="offer-heading"><strong>새로운 유물</strong><span class="eyebrow">BUILD YOUR SYNERGY</span></div><div class="offer-grid store-grid">${shop.artifacts.map((o,i)=>offerCard(o,i,'artifact','shop')).join('')}</div></div></div></div>
    <div class="shop-utilities"><p>조각은 주간 평가 통과 보상으로만 얻습니다.<br>유물은 이동하거나 현재 구매가의 ${number(CONFIG.saleRatio*100,0)}%에 판매할 수 있습니다. 구매가와 판매가, 주사위 개조 비용은 주차에 따라 오르지 않습니다.</p><button class="quiet-button" data-action="edit-open">주사위 한 면 바꾸기 · ${number(CONFIG.editDieCost)}원</button></div>`;
}
function renderEnd(s) {
  if(!['won','lost'].includes(s.phase)||animation){$('end-panel').innerHTML='';return;}
  const won=s.phase==='won';
  $('end-panel').innerHTML=`<div class="end-overlay"><div class="end-card"><div class="end-symbol">${won?'✧':'◇'}</div><span class="eyebrow">${won?'A MUSEUM TO REMEMBER':'THE NEXT COLLECTION AWAITS'}</span><h2>${won?'오래 기억될 박물관':'이번 전시는 여기까지'}</h2><p>${won?`${CONFIG.weeks}주 동안 모든 평가를 통과했습니다.<br>당신만의 족보표가 완성되었어요.`:`${s.week}주차 평가 담당자의 감동 기준에<br>조금 못 미쳤습니다. 새로운 전시를 설계해 보세요.`}</p><div class="end-stats"><div>완료한 관람<strong>${s.history.length}회</strong></div><div>가장 높은 조각<strong>Lv.${Math.max(...s.pieces.map(p=>p.level),1)}</strong></div></div><button class="primary-button full-width" data-action="new-run">새 박물관 열기</button></div></div>`;
}
function renderAll() {
  const focused=document.activeElement?.dataset?.focus;
  const s=shownState();
  forecast=animation?.resolution||previewSubmission(s);
  renderHeader(s);renderVisit(s);renderForecast(s);renderBoard(s);renderInspector(s);renderRecent(s);renderDice(s);renderShop(s);
  if(focused)document.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
}

function doAction(command,{message,keepPending=false}={}) {
  if(animation)return false;
  clearDrag();
  const result=action(state,command);
  if(!result.ok){toast(result.error);return false;}
  if(!keepPending)pending=null;
  save();renderAll();if(message)toast(message);return true;
}
function beginPlacement(type,source,index,{fromDrag=false}={}) {
  if(state.phase!=='shop'||animation)return;
  if(type==='piece'&&source!=='free')return;
  const list=state.shop[source==='free'?(type==='piece'?'freePieces':'freeArtifacts'):(type==='piece'?'pieces':'artifacts')];
  const offer=list?.[index];if(!offer)return;
  pending={type,source,index,offer,rotation:0};hoverCell=null;
  renderBoard(state);renderShop(state);
  if(!fromDrag){
    document.querySelector('.museum-panel').scrollIntoView({behavior:'smooth',block:'center'});
    toast(`${type==='piece'?`${offer.face}눈 조각`:getArtifactDefinition(offer.kind).name}을 놓을 자리를 고르세요. 미리보기를 끌어 놓을 수도 있어요.`);
  }
}
function cancelPlacement() { clearDrag();pending=null;hoverCell=null;renderBoard(shownState());renderInspector(shownState());renderShop(shownState()); }
function placeAt(point) {
  if(!pending||animation||state.phase!=='shop')return false;
  if(!placementValid(point.x,point.y)){toast(pending.type==='piece'?'기존 박물관에 연결되거나 겹치도록 놓아주세요.':'유물은 박물관의 비어 있는 칸에 놓아주세요.');return false;}
  const p=pending;
  const command=p.type==='move'?{type:'MOVE_ARTIFACT',artifactId:p.artifactId,x:point.x,y:point.y,rotation:p.rotation}:{type:p.type==='piece'?'PLACE_PIECE':'PLACE_ARTIFACT',source:p.source,index:p.index,x:point.x,y:point.y,rotation:p.rotation};
  const result=action(state,command);
  if(!result.ok){toast(result.error);return false;}
  selection={...point,artifactId:p.type==='piece'?null:p.type==='move'?p.artifactId:state.artifacts.at(-1)?.id};
  pending=null;hoverCell=null;selectedPiece=null;save();renderAll();$('inspector').scrollTop=0;toast(p.type==='piece'?'새로운 족보 조건이 박물관에 더해졌습니다.':p.type==='move'?'유물의 위치를 옮겼습니다.':'새 유물을 전시했습니다.');
  return true;
}
function beginMove(artifact,{fromDrag=false}={}) {
  pending={type:'move',artifactId:artifact.id,offer:artifact,rotation:artifact.rotation||0};
  hoverCell=null;renderBoard(state);renderInspector(state);
  if(!fromDrag)document.querySelector('.museum-panel').scrollIntoView({behavior:'smooth',block:'center'});
}

// Pointer dragging is shared by offers, the placement tray, and existing artifacts.
// Only a successful engine action on release commits a move or spends money.
function clearDrag() {
  const previous=drag;drag=null;
  if(dragScrollFrame!=null)cancelAnimationFrame(dragScrollFrame);
  dragScrollFrame=null;
  if(previous?.active){
    suppressClickUntil=performance.now()+400;
    if(document.body.hasPointerCapture(previous.pointerId))document.body.releasePointerCapture(previous.pointerId);
  }
  document.body.classList.remove('dragging-item');
  document.querySelector('.drag-preview')?.remove();
  return previous;
}
function dragPoint() {
  const point=drag&&pointFromEvent({clientX:drag.x,clientY:drag.y});
  return point?{x:point.x-drag.offset.x,y:point.y-drag.offset.y}:null;
}
function updateDragPreview() {
  if(!drag?.active||!pending)return;
  hoverCell=dragPoint();renderGhost(hoverCell);
  const preview=document.querySelector('.drag-preview');
  if(preview){
    preview.style.transform=`translate3d(${drag.x+16}px,${drag.y+16}px,0)`;
    preview.classList.toggle('over-board',!!hoverCell);
  }
}
function dragPreviewIcon() {
  return pending.type==='piece'?shapeMini({...pending.offer,cells:rotatedCells(pending.offer.cells,pending.rotation)}):icon(pending.offer.kind);
}
function scrollWhileDragging() {
  if(!drag?.active)return;
  const viewport=$('board-viewport'),r=viewport.getBoundingClientRect(),edge=28;
  const speed=(value,start,end)=>value<start+edge?-8:value>end-edge?8:0;
  if(drag.x>=r.left&&drag.x<=r.right&&drag.y>=r.top&&drag.y<=r.bottom){
    viewport.scrollLeft+=speed(drag.x,r.left,r.right);
    viewport.scrollTop+=speed(drag.y,r.top,r.bottom);
  }
  if(drag.y<36)window.scrollBy(0,-12);
  else if(drag.y>window.innerHeight-36)window.scrollBy(0,12);
  updateDragPreview();dragScrollFrame=requestAnimationFrame(scrollWhileDragging);
}
function rotatePlacement() {
  if(!pending)return;
  const cells=rotatedCells(pending.type==='piece'?pending.offer.cells:getArtifactDefinition(pending.offer.kind).cells,pending.rotation);
  if(drag?.active){const height=Math.max(...cells.map(c=>c.y))+1;drag.offset={x:height-1-drag.offset.y,y:drag.offset.x};}
  pending.rotation=(pending.rotation+1)%4;renderPlacement();
  const preview=document.querySelector('.drag-preview');if(preview)preview.innerHTML=dragPreviewIcon();
  if(drag?.active)updateDragPreview();else renderGhost(hoverCell);
}
document.addEventListener('pointerdown',event=>{
  if(event.button!==0||!event.isPrimary||animation||state.phase!=='shop'||document.querySelector('dialog[open]'))return;
  const source=event.target.closest('.artifact,[data-action="pick-offer"],[data-placement-handle]');
  if(!source||source.disabled)return;
  let candidate,offset={x:0,y:0};
  if(source.matches('.artifact')){
    if(pending&&pending.artifactId!==source.dataset.artifactId)return;
    const artifact=state.artifacts.find(a=>a.id===source.dataset.artifactId);if(!artifact)return;
    const point=pointFromEvent(event);if(!point)return;
    offset={x:point.x-artifact.x,y:point.y-artifact.y};candidate={artifact};
  }else if(source.matches('[data-placement-handle]')){if(!pending)return;candidate={handle:true};}
  else candidate={type:source.dataset.type,source:source.dataset.source,index:Number(source.dataset.index)};
  drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,offset,candidate,keepBar:!!pending,active:false};
});
window.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.pointerId)return;
  drag.x=event.clientX;drag.y=event.clientY;
  if(!drag.active){
    if(Math.hypot(drag.x-drag.startX,drag.y-drag.startY)<6)return;
    drag.active=true;
    const candidate=drag.candidate;
    if(candidate.artifact)beginMove(candidate.artifact,{fromDrag:true});
    else if(!candidate.handle)beginPlacement(candidate.type,candidate.source,candidate.index,{fromDrag:true});
    if(!pending){clearDrag();return;}
    document.body.setPointerCapture(event.pointerId);
    document.body.classList.add('dragging-item');
    const preview=document.createElement('div');preview.className='drag-preview';preview.setAttribute('aria-hidden','true');
    preview.innerHTML=dragPreviewIcon();
    document.body.appendChild(preview);
    dragScrollFrame=requestAnimationFrame(scrollWhileDragging);
  }
  event.preventDefault();updateDragPreview();
},{passive:false});
window.addEventListener('pointerup',event=>{
  if(!drag||event.pointerId!==drag.pointerId)return;
  drag.x=event.clientX;drag.y=event.clientY;
  const point=drag.active?dragPoint():null,previous=clearDrag();
  if(!previous.active)return;
  event.preventDefault();hoverCell=null;renderGhost(null);
  if(point){if(!placeAt(point))renderPlacement();}
  else{cancelPlacement();toast('배치를 취소했습니다. 유물과 보상은 그대로입니다.');}
});
window.addEventListener('pointercancel',()=>{if(drag?.active)cancelPlacement();else clearDrag();});
window.addEventListener('blur',()=>{if(drag?.active)cancelPlacement();else clearDrag();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&drag?.active)cancelPlacement();});
document.addEventListener('dragstart',event=>{if(event.target.closest('.artifact,.offer-card,.placement-handle'))event.preventDefault();});
document.addEventListener('click',event=>{
  if(performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}
},true);
function openEditor(die=0) {
  if(state.phase!=='shop'||animation){toast('주사위 면은 상점에서 바꿀 수 있습니다.');return;}
  editDraft={die,face:0,value:state.dice[die].faces[0]%6+1};renderEditor();dialogOpen('edit-dialog');
}
function renderEditor() {
  const draft=editDraft,die=state.dice[draft.die];
  const same=die.faces[draft.face]===draft.value, affordable=Math.round(state.money*10)>=Math.round(CONFIG.editDieCost*10);
  $('edit-content').innerHTML=`<div class="modal-heading"><div><span class="eyebrow">SHAPE YOUR ODDS</span><h2>주사위를 전시에 맞게</h2></div><button class="icon-button" data-action="close-dialog" aria-label="주사위 면 변경 닫기">×</button></div><p class="detail-description">주사위 하나의 한 면을 원하는 눈으로 바꿉니다. 같은 눈을 여러 면에 넣을 수 있고, 변경은 이번 런 동안 유지됩니다.</p><div class="edit-dice-tabs">${state.dice.map((d,i)=>`<button class="edit-die-tab ${draft.die===i?'active':''}" data-action="editor-die" data-die="${i}" aria-label="${i+1}번 주사위 선택">${pips(d.value)}${i+1}번 주사위</button>`).join('')}</div><p class="edit-label">1. 바꿀 면을 선택하세요</p><div class="edit-faces">${die.faces.map((value,i)=>`<button class="face-option ${draft.face===i?'active':''}" data-action="editor-face" data-face="${i}" aria-label="${i+1}번 면, 현재 ${value}눈 선택"><small>${i+1}번 면</small><strong>${value}</strong></button>`).join('')}</div><p class="edit-label">2. 새로 넣을 눈을 선택하세요</p><div class="new-eye-options">${Array.from({length:6},(_,i)=>i+1).map(value=>`<button class="eye-option ${draft.value===value?'active':''}" data-action="editor-value" data-value="${value}" aria-label="새 눈 ${value} 선택">${pips(value)}</button>`).join('')}</div><div class="edit-preview"><span>${draft.die+1}번 주사위 · ${draft.face+1}번 면<br><strong>${die.faces[draft.face]} → ${draft.value}</strong></span><span>변경 비용 <strong>${number(CONFIG.editDieCost)}원</strong></span></div><div class="modal-actions"><button class="quiet-button" data-action="close-dialog">취소</button><button class="primary-button" data-action="apply-edit" ${same||!affordable?'disabled':''}>${same?'새 눈을 골라주세요':!affordable?'보유 금액이 부족해요':'비용을 내고 변경'}</button></div>`;
}
function renderHelp() {
  $('help-content').innerHTML=`<div class="rule-section"><h3>박물관이 곧 나의 족보표</h3><p>폴리오미노 하나에는 눈 하나가 정해져 있습니다. 조각을 겹치면 그 칸이 요구하는 눈 묶음도 늘어납니다. 예를 들어 [1,1]은 최종 주사위에 1이 두 개 있어야 합니다.</p><div class="rule-highlight">조건을 만족한 칸의 발동 횟수 = 구성 조각의 레벨 합<br>여러 칸 칸 반응 유물의 발동 횟수 = 점유 칸 횟수의 최댓값</div></div><div class="rule-section"><h3>한 관객에게 세 번의 기회</h3><ol><li>주사위를 눌러 보관하고 나머지를 리롤합니다.</li><li>제출 ${CONFIG.submissionsPerVisitor}회가 리롤 ${CONFIG.rerollsPerVisitor}회를 함께 씁니다. 제출 사이의 전체 재굴림은 무료입니다.</li><li>매주 일반 관객 ${CONFIG.visitorsPerWeek-1}명 뒤 평가 담당자가 옵니다. 평가 담당자의 자기 세 제출 감동으로 통과 여부를 결정합니다.</li></ol><p>현재 프로토타입은 감동이 기준 이상이면 통과합니다. 총 ${CONFIG.weeks}주를 완주하면 클리어합니다.</p></div><div class="rule-section"><h3>유물과 연쇄</h3><p>칸 반응 유물은 곱연산으로 감동을 증폭하고, 연쇄 유물은 합연산으로 감동을 만듭니다. 칸 유물의 실제 발동마다 독립 연쇄가 시작됩니다. 여러 칸 유물도 하나의 원천이며 전체 외곽에서 연쇄를 전달합니다. 연쇄 유물은 같은 연쇄에 한 번만 참여하며, 여러 변으로 접해도 중복 발동하지 않습니다.</p><p>검은 덮개는 이번 연쇄에서 이미 발동을 마쳤다는 뜻입니다. 같은 독립 연쇄가 여러 번 반복될 때는 대표 한 번과 반복 횟수를 표시합니다.</p></div><div class="rule-section"><h3>충전으로 조각을 강화하세요</h3><p>조각은 런 전체에서 한 번만 Lv.1에서 Lv.2로 강화할 수 있습니다. 복원 붓은 아직 강화하지 않은 대상 조각마다 충전 1을 쓰며 제출당 최대 한 번 반응합니다. 모두 강화한 자리에서는 발동하지 않고 충전을 보존합니다. 충전이 부족하면 큰 조각부터, 크기도 같으면 무작위로 고릅니다. 충전을 다 쓴 붓은 사라지고 새 발동 횟수는 다음 제출부터 적용됩니다.</p></div><div class="rule-section"><h3>상점에서 다음 전시 준비</h3><p>‘무료 보상!!’에서 관객 종료마다 유물 3개 중 1개를 고릅니다. 주간 평가를 통과하면 조각도 3개 중 1개를 고를 수 있습니다. 상점에서는 조각을 판매하지 않습니다. 런이 끝난 뒤에는 보상 선택을 진행하지 않습니다. 보상은 거절할 수 있습니다. 상품이나 배치 미리보기를 보드로 끌어 놓으세요. 선택 후 칸을 클릭해도 됩니다. R로 회전하고 Esc로 취소할 수 있습니다.</p><p>상점에서 기존 유물도 드래그로 이동할 수 있습니다. 배치된 조각은 고정입니다. 유물은 구매가의 ${number(CONFIG.saleRatio*100,0)}%에 판매할 수 있습니다. 주사위 한 면 변경은 ${number(CONFIG.editDieCost)}원입니다. 면 개조로 주력 족보의 성공 확률을 높여 보세요.</p></div><div class="rule-section"><h3>다섯 단계의 고정 팁</h3><p>관객의 세 제출 누적 감동 ÷ 감동 기준으로 등급을 정합니다. 아주 좋음 이후에는 팁이 더 늘지 않습니다.</p><table class="rule-table"><thead><tr><th>등급</th><th>달성 배수 이상</th><th>팁</th></tr></thead><tbody>${CONFIG.tipTiers.map(t=>`<tr><td>${t.name}</td><td>${number(t.minRatio,2)}배</td><td>${number(t.tip)}원</td></tr>`).join('')}</tbody></table></div><div class="rule-section"><h3>처음에는 이렇게</h3><p>시작 조각은 1눈을 요구합니다. 1이 나온 주사위를 보관하세요. 거울 → 금빛 동전 → 전시 도선으로 연쇄를 연결하세요. 렌즈는 자신의 눈 조건을 만족해야 하며 겹친 조각마다 감동이 커집니다. 붓으로 조각을 한 번 강화한 뒤, 상점에서 새 조각으로 옮겨 남은 충전을 쓰세요. 작은 유물과 큰 유물의 기본 수치는 비슷하며 큰 유물은 조건부 효과를 가집니다. 긴 거울은 두 칸이 모두 발동하고 요구 눈 묶음이 서로 다를 때 배율 보너스를 받습니다.</p><p>진행은 이 브라우저에 자동 저장됩니다. 현재 시드는 ${state.seed}입니다. 수치와 일부 배치 판정은 밸런스 검증을 위한 프로토타입 설정입니다.</p></div>`;
}

async function submitWithAnimation() {
  if(animation||state.phase!=='visit')return;
  clearDrag();
  const before=structuredClone(state),result=action(state,{type:'SUBMIT'});
  if(!result.ok){toast(result.error);return;}
  pending=null;selectedPiece=null;save();
  let skipResolve;
  animation={before,resolution:result.resolution,skip:false,skipPromise:new Promise(resolve=>{skipResolve=resolve;}),skipResolve:()=>skipResolve()};
  const current=animation;
  renderAll();$('animation-bar').hidden=false;
  const groups=result.resolution.chains;
  const steps=groups.reduce((n,c)=>n+c.steps.length,0);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration=reduced?180:Math.max(180,Math.min(360,9000/Math.max(steps,1)));
  $('board-grid').style.setProperty('--activation-duration',`${duration}ms`);
  const pause=ms=>Promise.race([new Promise(resolve=>setTimeout(resolve,ms)),current.skipPromise]);
  for(let i=0;i<groups.length&&!current.skip;i++){
    const chain=groups[i];
    $('board-grid').querySelectorAll('.fired,.firing').forEach(el=>el.classList.remove('fired','firing'));
    $('chain-lines').innerHTML='';
    $('animation-title').textContent=`연쇄 ${i+1}/${groups.length} · ${nameOf(chain.rootId,before)}`;
    $('animation-detail').textContent=chain.repeat>1?`동일한 독립 연쇄 ×${number(chain.repeat,0)} · 대표 1회 표시`:'독립 연쇄 1회 · 발동 완료 유물에 검정 덮개 표시';
    for(const step of chain.steps){
      if(current.skip)break;
      const el=$('board-grid').querySelector(`[data-artifact-id="${CSS.escape(step.artifactId)}"]`);
      const artifact=before.artifacts.find(a=>a.id===step.artifactId);
      const tiles=artifact?getArtifactFootprint(before,artifact).map(c=>$('board-grid').querySelector(`.tile[data-x="${c.x}"][data-y="${c.y}"]`)).filter(Boolean):[];
      if(step.senderId)drawConnection(step.senderId,step.artifactId,before);
      tiles.forEach(tile=>tile.classList.add('firing'));
      el?.classList.add('firing');
      await pause(duration);
      tiles.forEach(tile=>tile.classList.remove('firing'));
      el?.classList.remove('firing');el?.classList.add('fired');
      await pause(duration*.35);
    }
    await pause(duration*.6);
    if(result.resolution.despawn.includes(chain.rootId)){
      $('board-grid').querySelector(`[data-artifact-id="${CSS.escape(chain.rootId)}"]`)?.remove();
    }
  }
  if(!groups.length&&!current.skip){$('animation-title').textContent='이번에는 발동할 유물이 없어요';$('animation-detail').textContent='다음 굴림에서 전시의 조건을 노려 보세요.';await pause(550);}
  animation=null;$('animation-bar').hidden=true;giftOpen=false;
  if(selection?.artifactId&&!state.artifacts.some(a=>a.id===selection.artifactId))selection.artifactId=null;
  renderAll();
  const r=result.resolution;
  toast(r.visitEnd?`${r.visitEnd.tier} · 팁 +${number(r.visitEnd.tip)}원${r.visitEnd.evaluator?(r.visitEnd.passed?' · 평가 통과':' · 평가 미통과'):''}`:`${number(r.score)} 감동${r.upgrades.length?` · 조각 ${r.upgrades.length}개 강화`:''}`);
}
function drawConnection(fromId,toId,s) {
  const a=s.artifacts.find(x=>x.id===fromId),b=s.artifacts.find(x=>x.id===toId);if(!a||!b)return;
  const center=item=>{
    const fp=getArtifactFootprint(s,item);
    return {x:(fp.reduce((n,c)=>n+c.x,0)/fp.length-bounds.minX)*(tileSize+TILE_GAP)+tileSize/2,y:(fp.reduce((n,c)=>n+c.y,0)/fp.length-bounds.minY)*(tileSize+TILE_GAP)+tileSize/2};
  };
  const from=center(a),to=center(b);
  const line=document.createElementNS('http://www.w3.org/2000/svg','path');
  line.setAttribute('class','chain-line');line.setAttribute('d',`M${from.x},${from.y} Q${(from.x+to.x)/2+8},${(from.y+to.y)/2-10} ${to.x},${to.y}`);$('chain-lines').appendChild(line);
}

$('board-grid').addEventListener('pointermove',event=>{
  if(!pending||drag?.active||animation)return;const point=pointFromEvent(event);
  if(point&&(!hoverCell||point.x!==hoverCell.x||point.y!==hoverCell.y)){hoverCell=point;renderGhost(point);}
});
$('board-grid').addEventListener('pointerleave',()=>{hoverCell=null;renderGhost(null);});
$('board-grid').addEventListener('click',event=>{
  if(animation)return;
  const point=pointFromEvent(event);if(!point)return;
  if(pending){placeAt(point);return;}
  const a=event.target.closest('[data-artifact-id]');selectAt(point,a?.dataset.artifactId||null);
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const what=button.dataset.action;
  if(what==='close-dialog'){closeDialog(button);return;}
  if(what==='help'){renderHelp();dialogOpen('help-dialog');return;}
  if(what==='new-run'){if(animation){toast('연출을 건너뛴 뒤 새 박물관을 열 수 있습니다.');return;}dialogOpen('new-dialog');return;}
  if(what==='confirm-new'){
    clearDrag();
    const input=$('seed-input').value.trim();const seed=input?(/^\d+$/.test(input)?Number(input)>>>0:input):randomSeed();
    state=createGame(seed);selection={x:0,y:0,artifactId:state.artifacts[0]?.id};pending=null;giftOpen=false;selectedPiece=null;firstBoard=true;
    document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());save();renderAll();
    document.querySelectorAll('.left-column,.right-column,#inspector,#recent-panel').forEach(panel=>{panel.scrollTop=0;});
    window.scrollTo({top:0,behavior:'smooth'});toast('새로운 박물관의 문을 열었습니다. 1눈부터 노려 보세요.');return;
  }
  if(what==='zoom-in'||what==='zoom-out'){tileSize=Math.max(42,Math.min(104,tileSize+(what==='zoom-in'?8:-8)));renderBoard(shownState());return;}
  if(what==='fit-board'){fitBoard();return;}
  if(what==='skip-animation'){if(animation){animation.skip=true;animation.skipResolve();}return;}
  if(animation)return;
  if(what==='die'){const i=Number(button.dataset.die);if(state.phase==='shop')openEditor(i);else doAction({type:'HOLD',die:i});return;}
  if(what==='release-dice'){state.dice.forEach((die,i)=>{if(die.held)action(state,{type:'HOLD',die:i,held:false});});save();renderAll();return;}
  if(what==='reroll'){doAction({type:'REROLL'});return;}
  if(what==='submit'){await submitWithAnimation();return;}
  if(what==='next-visitor'){if(doAction({type:'NEXT_VISITOR'})){giftOpen=false;renderAll();window.scrollTo({top:0,behavior:'smooth'});toast(state.visitor===CONFIG.visitorsPerWeek?'평가 담당자가 입장했습니다.':'새 관객이 입장했습니다.');}return;}
  if(what==='toggle-gift'){giftOpen=!giftOpen;renderShop(state);return;}
  if(what==='skip-free'){doAction({type:'SKIP_FREE',category:button.dataset.category},{message:'이번 무료 보상은 받지 않습니다.'});return;}
  if(what==='pick-offer'){beginPlacement(button.dataset.type,button.dataset.source,Number(button.dataset.index));return;}
  if(what==='rotate'){rotatePlacement();return;}
  if(what==='cancel-placement'){cancelPlacement();return;}
  if(what==='highlight-piece'){
    selectedPiece=selectedPiece===button.dataset.id?null:button.dataset.id;
    $('board-grid').querySelectorAll('.piece-tint').forEach(tint=>tint.classList.toggle('is-selected',tint.dataset.pieceId===selectedPiece));
    $('board-grid').querySelectorAll('.tile').forEach(tile=>{const cell=cellMap.get(key(Number(tile.dataset.x),Number(tile.dataset.y)));tile.classList.toggle('piece-highlight',!!cell&&cell.pieceIds.includes(selectedPiece));});renderInspector(state);return;
  }
  if(what==='move-artifact'){
    const artifact=state.artifacts.find(a=>a.id===button.dataset.id);if(!artifact)return;
    beginMove(artifact);return;
  }
  if(what==='sell-artifact'){
    const artifact=state.artifacts.find(a=>a.id===button.dataset.id);if(!artifact)return;
    const name=getArtifactDefinition(artifact.kind).name,price=getArtifactDefinition(artifact.kind).price*CONFIG.saleRatio;
    if(doAction({type:'SELL',artifactId:artifact.id},{message:`${name} 판매 · +${number(price)}원`}))selection.artifactId=null;return;
  }
  if(what==='edit-open'){openEditor();return;}
  if(what==='editor-die'){editDraft.die=Number(button.dataset.die);editDraft.face=0;editDraft.value=state.dice[editDraft.die].faces[0]%6+1;renderEditor();return;}
  if(what==='editor-face'){editDraft.face=Number(button.dataset.face);renderEditor();return;}
  if(what==='editor-value'){editDraft.value=Number(button.dataset.value);renderEditor();return;}
  if(what==='apply-edit'){
    const draft={...editDraft};
    if(doAction({type:'EDIT_DIE',die:draft.die,face:draft.face,value:draft.value},{message:`${draft.die+1}번 주사위의 ${draft.face+1}번 면을 ${draft.value}눈으로 바꿨습니다.`}))$('edit-dialog').close();
  }
});
document.addEventListener('keydown',event=>{
  if(event.target.matches('input,textarea,select')||document.querySelector('dialog[open]'))return;
  if(pending&&event.key.toLowerCase()==='r'){event.preventDefault();rotatePlacement();}
  if(pending&&event.key==='Escape'){event.preventDefault();cancelPlacement();}
});

renderAll();save();
if(restored){$('welcome-title').textContent='다시 오셨군요, 관장님.';$('welcome-copy').textContent=restoreNotice||`${state.week}주차 박물관이 마지막으로 저장된 상태 그대로 기다리고 있습니다.`;$('welcome-button').textContent='이어서 운영하기';}
requestAnimationFrame(()=>dialogOpen('welcome-dialog'));
