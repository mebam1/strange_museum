import {ARTIFACTS, SHAPES, CONFIG, LEGACY_ARTIFACTS, getArtifactDefinition} from './catalog.js';
export {ARTIFACTS, SHAPES, CONFIG, LEGACY_ARTIFACTS, getArtifactDefinition} from './catalog.js';

const key = (x,y) => `${x},${y}`;
const copy = value => structuredClone(value);
const readingOrder = (a,b) => a.y-b.y || a.x-b.x || String(a.id).localeCompare(String(b.id));
const integer = n => Number.isInteger(n) && Number.isFinite(n);
// Current economy uses integer prices and tenths for resale; keep binary noise out of transactions.
const roundMoney = value => { const rounded=Math.round(value*10)/10;return rounded===0?0:rounded; };
const canAfford = (state,price) => Math.round(state.money*10)>=Math.round(price*10);
function rng(state) {
  let n = state.rng >>> 0;
  n ^= n << 13; n ^= n >>> 17; n ^= n << 5;
  state.rng = n >>> 0;
  return state.rng / 4294967296;
}
function pick(state,values) { return values[Math.floor(rng(state)*values.length)]; }
function nextId(state,prefix) { return `${prefix}${state.nextId++}`; }
function turns(rotation=0) {
  if (!Number.isFinite(rotation)) return 0;
  const n = Math.abs(rotation)>3 ? rotation/90 : rotation;
  return ((Math.round(n)%4)+4)%4;
}
export function rotatedCells(cells,rotation=0) {
  const t = turns(rotation);
  const out = cells.map(({x,y}) => {
    for(let i=0;i<t;i++) [x,y]=[-y,x];
    return {x,y};
  });
  if(!out.length) return [];
  const minX=Math.min(...out.map(c=>c.x)), minY=Math.min(...out.map(c=>c.y));
  return out.map(c=>({x:c.x-minX,y:c.y-minY}));
}
function pieceLocalCells(offer) {
  return offer?.cells || SHAPES.find(s=>s.id===offer?.shape)?.cells || [];
}
function definition(artifact,state) { return getArtifactDefinition(artifact,state); }
export function getArtifactFootprint(state,artifact) {
  const def=definition(artifact,state);
  if(!def) return [];
  return rotatedCells(artifact.cells || def.cells,artifact.rotation).map(c=>({x:c.x+(artifact.x||0),y:c.y+(artifact.y||0)}));
}
export function getBoardCells(state) {
  const board=new Map();
  for(const piece of state.pieces) for(const c of piece.cells) {
    const k=key(c.x,c.y);
    if(!board.has(k)) board.set(k,{x:c.x,y:c.y,faces:[],pieceIds:[],levelSum:0,requirements:{}});
    const cell=board.get(k);
    cell.faces.push(piece.face); cell.pieceIds.push(piece.id); cell.levelSum+=piece.level;
    cell.requirements[piece.face]=(cell.requirements[piece.face]||0)+1;
  }
  return [...board.values()].map(c=>({...c,faces:c.faces.sort((a,b)=>a-b),level:c.levelSum})).sort(readingOrder);
}
function connected(cells) {
  if(!cells.length) return false;
  const available=new Set(cells.map(c=>key(c.x,c.y))), visited=new Set([key(cells[0].x,cells[0].y)]), queue=[cells[0]];
  for(let i=0;i<queue.length;i++) {
    const c=queue[i];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const k=key(c.x+dx,c.y+dy);
      if(available.has(k)&&!visited.has(k)) {visited.add(k);queue.push({x:c.x+dx,y:c.y+dy});}
    }
  }
  return visited.size===available.size;
}
export function legalPiecePlacement(state,offer,x,y,rotation=0) {
  if(!integer(x)||!integer(y)||!integer(offer?.face)||offer.face<1||offer.face>6) return false;
  const cells=rotatedCells(pieceLocalCells(offer),rotation).map(c=>({x:c.x+x,y:c.y+y}));
  if(!cells.length||!cells.every(c=>integer(c.x)&&integer(c.y))||!connected(cells)) return false;
  if(new Set(cells.map(c=>key(c.x,c.y))).size!==cells.length) return false;
  const board=new Set(getBoardCells(state).map(c=>key(c.x,c.y)));
  if(!board.size) return true;
  return cells.some(c=>board.has(key(c.x,c.y))||[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>board.has(key(c.x+dx,c.y+dy))));
}
export function legalArtifactPlacement(state,offer,x,y,rotation=0,ignoreArtifactId=null) {
  if(!integer(x)||!integer(y)||!definition(offer,state)) return false;
  const cells=getArtifactFootprint(state,{...offer,x,y,rotation});
  const board=new Set(getBoardCells(state).map(c=>key(c.x,c.y)));
  const occupied=new Set(state.artifacts.filter(a=>a.id!==ignoreArtifactId).flatMap(a=>getArtifactFootprint(state,a).map(c=>key(c.x,c.y))));
  return cells.length>0&&cells.every(c=>board.has(key(c.x,c.y))&&!occupied.has(key(c.x,c.y)));
}
export function getConfig() { return CONFIG; }
export function getWeekMultiplier(week) {
  return CONFIG.weeklyRate**(week-1)*CONFIG.bossJump**CONFIG.bossWeeks.filter(w=>w<week).length;
}
export function getVisitorTarget(state) {
  if(['won','lost'].includes(state.phase)&&Number.isFinite(state.lastVisitor?.target))return state.lastVisitor.target;
  return (state.visitor===CONFIG.visitorsPerWeek?CONFIG.evaluatorTarget:CONFIG.normalTarget)*getWeekMultiplier(state.week);
}
function rollAll(state) {
  for(const die of state.dice) {die.held=false;die.value=pick(state,die.faces);}
}
function makePieceOffer(state) {
  const shape=pick(state,SHAPES);
  return {id:nextId(state,'offerP'),shape:shape.id,name:shape.name,cells:copy(shape.cells),face:1+Math.floor(rng(state)*6),level:1,price:CONFIG.pieceBasePrice+shape.cells.length*CONFIG.pieceCellPrice};
}
function makeArtifactOffer(state,kind=null) {
  kind ||= pick(state,['coin','coin','mirror','long_mirror','brush','brush','observer','prism','seal','conduit','pedestal','frame']);
  const def=ARTIFACTS[kind];
  return {id:nextId(state,'offerA'),kind,price:def.price,...(kind==='brush'?{charges:CONFIG.brushCharges}:{})};
}
function hasWeeklyPieceReward(state) {
  const record=state.lastVisitor;
  return state.visitor===CONFIG.visitorsPerWeek&&record?.week===state.week&&record.visitor===state.visitor&&record.evaluator&&record.passed;
}
function makeShop(state) {
  const weekly=hasWeeklyPieceReward(state);
  return {freePieces:weekly?Array.from({length:3},()=>makePieceOffer(state)):[],freeArtifacts:Array.from({length:3},()=>makeArtifactOffer(state)),pieces:[],artifacts:Array.from({length:4},()=>makeArtifactOffer(state)),freePieceClaimed:!weekly,freeArtifactClaimed:false};
}
function freshVisit() {return {score:0,submissionsLeft:CONFIG.submissionsPerVisitor,rerollsLeft:CONFIG.rerollsPerVisitor,results:[]};}
export function createGame(seed=1) {
  const numeric=typeof seed==='number'?seed:[...String(seed)].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,2166136261);
  const state={version:1,rulesVersion:4,seed:numeric>>>0,rng:(numeric>>>0)||0x9e3779b9,nextId:20,phase:'visit',week:1,visitor:1,money:CONFIG.startingMoney,
    pieces:[{id:'p1',face:1,level:1,cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1}]}],
    artifacts:[{id:'a1',kind:'coin',x:0,y:0,rotation:0},{id:'a2',kind:'brush',x:1,y:1,rotation:0,charges:CONFIG.brushCharges},{id:'a3',kind:'conduit',x:0,y:1,rotation:0},{id:'a4',kind:'mirror',x:1,y:0,rotation:0}],
    dice:Array.from({length:5},(_,i)=>({id:`d${i+1}`,faces:[1,2,3,4,5,6],value:1,held:false})),visit:freshVisit(),shop:null,lastResolution:null,history:[]};
  rollAll(state); return state;
}
/** Preserve finished results; migrate unfinished legacy runs without changing earned scores. */
export function restoreGame(saved) {
  const state=copy(saved);
  if(['won','lost'].includes(state.phase))return state;
  if((state.rulesVersion??1)<2) {
    for(const piece of state.pieces)piece.level=Math.min(piece.level,CONFIG.maxPieceLevel);
  }
  const replacements={echo:'conduit',bell:'prism'};
  for(const artifact of state.artifacts)if(replacements[artifact.kind])artifact.kind=replacements[artifact.kind];
  for(const offers of [state.shop?.freeArtifacts,state.shop?.artifacts])for(const offer of offers||[]) {
    if(!replacements[offer.kind])continue;
    offer.kind=replacements[offer.kind];offer.price=ARTIFACTS[offer.kind].price;
  }
  if((state.rulesVersion??1)<4&&state.shop) {
    // Retain earned rewards and artifact offers without rerolling an existing shop.
    state.shop.pieces=[];
    if(!hasWeeklyPieceReward(state)) {
      state.shop.freePieces=[];state.shop.freePieceClaimed=true;
    } else if(!state.shop.freePieceClaimed&&!state.shop.freePieces?.length) {
      state.shop.freePieces=Array.from({length:3},()=>makePieceOffer(state));
    }
  }
  state.rulesVersion=4;
  return state;
}
function adjacent(a,b) {return a.some(c=>b.some(d=>Math.abs(c.x-d.x)+Math.abs(c.y-d.y)===1));}
function sameRow(a,b) {return a.some(c=>b.some(d=>c.y===d.y));}
function shared(a,b) {return [...a].some(id=>b.has(id));}
function targetsFor(state,artifact,boardMap,footprints) {
  return new Set(footprints.get(artifact.id).flatMap(c=>boardMap.get(key(c.x,c.y))?.pieceIds||[]));
}
function chooseUpgradeTargets(state,pieceIds,charges,reserved) {
  const candidates=state.pieces.filter(p=>pieceIds.has(p.id)&&p.level<CONFIG.maxPieceLevel&&!reserved.has(p.id));
  if(charges>=candidates.length) return candidates.sort((a,b)=>a.level-b.level||b.cells.length-a.cells.length||String(a.id).localeCompare(String(b.id)));
  const ranked=candidates.map(p=>({p,tie:rng(state)}));
  ranked.sort((a,b)=>a.p.level-b.p.level||b.p.cells.length-a.p.cells.length||a.tie-b.tie);
  return ranked.slice(0,charges).map(x=>x.p);
}

/** Resolve one submission only. Mutates levels/charges; visit/phase changes belong to action(SUBMIT). */
export function resolveSubmission(state) {
  const legacy=(state.rulesVersion??1)<4;
  const diceCounts=Array(7).fill(0);
  for(const d of state.dice) diceCounts[d.value]++;
  const cells=getBoardCells(state).map(c=>({...c,count:Object.entries(c.requirements).every(([f,n])=>diceCounts[f]>=n)?c.levelSum:0}));
  const boardMap=new Map(cells.map(c=>[key(c.x,c.y),c]));
  const artifacts=state.artifacts.slice().sort(readingOrder);
  const footprints=new Map(artifacts.map(a=>[a.id,getArtifactFootprint(state,a)]));
  const pieceSets=new Map(artifacts.map(a=>[a.id,targetsFor(state,a,boardMap,footprints)]));
  const tileCounts=new Map(), conditionCounts=new Map(), upgradePlan=new Map(), reservedUpgrades=new Set();
  for(const a of artifacts) {
    const fp=footprints.get(a.id),def=definition(a,state);
    const counts=fp.map(c=>boardMap.get(key(c.x,c.y))?.count||0);
    const n=fp.length?(legacy?Math.min(...counts):Math.max(...counts)):0;
    conditionCounts.set(a.id,n);
    let count=def.trigger==='tile'?n:0;
    if(def.trigger==='tile'&&def.effect==='upgrade') {
      const charges=a.charges??CONFIG.brushCharges;
      const chosen=n>0&&charges>0?chooseUpgradeTargets(state,pieceSets.get(a.id),charges,reservedUpgrades):[];
      // Reserve in root order before freezing the graph. A brush with no remaining
      // eligible piece neither starts a chain nor satisfies bell/seal prerequisites.
      chosen.forEach(p=>reservedUpgrades.add(p.id));
      upgradePlan.set(a.id,chosen);count=chosen.length?1:0;
    }
    tileCounts.set(a.id,count);
  }
  const qualified=artifacts.filter(a=>definition(a,state).trigger==='tile'&&tileCounts.get(a.id)>0);
  const addValues=new Map(artifacts.map(a=>{
    let value=definition(a,state).effect==='add'?definition(a,state).value:0;
    if(a.kind==='prism') {
      // The catalog prism occupies exactly one cell. Count its pieces, never their levels.
      const cell=footprints.get(a.id)[0];
      value*=cell?(boardMap.get(key(cell.x,cell.y))?.pieceIds.length||0):0;
    }
    return [a.id,value];
  }));
  for(const aura of artifacts.filter(a=>definition(a,state).trigger==='static')) for(const a of artifacts) {
    const def=definition(a,state); if(def.effect!=='add'||a.id===aura.id) continue;
    let applies=false;
    if(aura.kind==='pedestal') applies=adjacent(footprints.get(aura.id),footprints.get(a.id));
    if(aura.kind==='frame'&&def.trigger===(legacy?'tile':'chain')) {
      const fp=footprints.get(aura.id), horizontal=turns(aura.rotation)%2===0;
      applies=footprints.get(a.id).some(c=>horizontal?c.y===fp[0].y:c.x===fp[0].x);
    }
    if(applies) addValues.set(a.id,addValues.get(a.id)+definition(aura,state).value);
  }
  const bellEligible=new Map(), sealEligible=new Map();
  for(const a of artifacts) {
    if(a.kind==='bell') bellEligible.set(a.id,new Set(qualified.filter(q=>adjacent(footprints.get(a.id),footprints.get(q.id))).map(q=>q.id)));
    if(a.kind==='seal') {
      const eligible=new Set();
      for(const p of pieceSets.get(a.id)) {
        const sources=qualified.filter(q=>pieceSets.get(q.id).has(p));
        if(sources.length>=2) for(const source of sources) eligible.add(source.id);
      }
      sealEligible.set(a.id,eligible);
    }
  }
  const receivers=artifacts.filter(a=>definition(a,state).trigger==='chain');
  function accepts(source,target) {
    if(source.id===target.id) return false;
    const sourceDef=definition(source,state);
    if(target.kind==='coin')return sourceDef.trigger==='tile'&&adjacent(footprints.get(source.id),footprints.get(target.id));
    if(target.kind==='conduit')return sourceDef.trigger!=='static'&&adjacent(footprints.get(source.id),footprints.get(target.id));
    if(target.kind==='prism')return conditionCounts.get(target.id)>0&&sourceDef.trigger!=='static'&&adjacent(footprints.get(source.id),footprints.get(target.id));
    if(target.kind==='observer') return sourceDef.trigger==='tile'&&(!legacy||sourceDef.effect==='add')&&sameRow(footprints.get(source.id),footprints.get(target.id));
    if(target.kind==='bell') {const ids=bellEligible.get(target.id);return ids.size>=3&&ids.has(source.id);}
    if(target.kind==='seal') return sealEligible.get(target.id).has(source.id);
    if(target.kind==='echo') return sourceDef.effect==='add'&&adjacent(footprints.get(source.id),footprints.get(target.id));
    return false;
  }
  const graph=new Map(artifacts.map(a=>[a.id,receivers.filter(t=>accepts(a,t))]));
  const effectValues={}, conditionBonuses={};
  for(const a of artifacts) {
    const def=definition(a,state);
    effectValues[a.id]=def.effect==='add'?addValues.get(a.id):def.value;
    if(a.kind==='long_mirror') {
      const covered=footprints.get(a.id).map(c=>boardMap.get(key(c.x,c.y)));
      const distinctRequirements=new Set(covered.map(c=>c?.faces.join(',')));
      const enabled=covered.length===2&&covered.every(c=>c?.count>0)&&distinctRequirements.size===2;
      conditionBonuses[a.id]=enabled;
      if(enabled)effectValues[a.id]=def.conditionalValue;
    }
  }
  const resolution={dice:state.dice.map(d=>d.value),score:0,additive:0,multiplier:1,logMultiplier:0,counts:{},effectValues,conditionBonuses,upgrades:[],despawn:[],events:[],chains:[],chainCount:0,tileCounts:cells,eventsCompacted:false};
  function event(e) {if(resolution.events.length<CONFIG.maxLoggedEvents) resolution.events.push(e);else resolution.eventsCompacted=true;}
  function apply(a,n,rootId,layer) {
    const def=definition(a,state); resolution.counts[a.id]=(resolution.counts[a.id]||0)+n;
    event({type:'fire',artifactId:a.id,rootId,layer,repeat:n,effect:def.effect,value:effectValues[a.id],conditionalBonus:conditionBonuses[a.id]||false});
    if(def.effect==='add') resolution.additive+=addValues.get(a.id)*n;
    if(def.effect==='multiply') resolution.logMultiplier+=Math.log(effectValues[a.id])*n;
    if(def.effect==='upgrade') {
      if(a.charges===undefined) a.charges=CONFIG.brushCharges;
      const chosen=upgradePlan.get(a.id)||[];
      for(const p of chosen) {const from=p.level;p.level++;a.charges--;resolution.upgrades.push({artifactId:a.id,pieceId:p.id,from,to:p.level,chargesSpent:1});event({type:'upgrade',artifactId:a.id,pieceId:p.id,from,to:p.level});}
      if(a.charges===0) resolution.despawn.push(a.id);
    }
  }
  for(const root of qualified) {
    const repeat=tileCounts.get(root.id);
    if(repeat<=0) continue;
    const chain={rootId:root.id,repeat,start:resolution.chainCount,steps:[]};
    resolution.chainCount+=repeat;
    event({type:'chainStart',rootId:root.id,repeat,chain:chain.start});
    const visited=new Set([root.id]), queue=[{artifact:root,layer:0,senderId:null}];
    // Identical independent roots have identical frozen graphs. Evaluate BFS once and retain repeat.
    for(let head=0;head<queue.length;head++) {
      const item=queue[head],a=item.artifact;
      chain.steps.push({artifactId:a.id,layer:item.layer,senderId:item.senderId});
      apply(a,repeat,root.id,item.layer);
      for(const target of graph.get(a.id)||[]) if(!visited.has(target.id)) {
        visited.add(target.id); // Shared, at enqueue: diamond merges cannot enqueue twice.
        queue.push({artifact:target,layer:item.layer+1,senderId:a.id});
      }
    }
    resolution.chains.push(chain);
    if(definition(root,state).effect==='upgrade'&&root.charges===0) {
      state.artifacts=state.artifacts.filter(a=>a.id!==root.id);
      event({type:'despawn',artifactId:root.id,rootId:root.id});
    }
  }
  resolution.multiplier=Math.exp(resolution.logMultiplier);
  resolution.score=resolution.additive===0?0:resolution.additive*resolution.multiplier;
  return resolution;
}
export function previewSubmission(state,diceValues=null) {
  // History and old animation logs can be large; resolution only mutates these three collections and RNG.
  const clone={...state,pieces:copy(state.pieces),artifacts:copy(state.artifacts),dice:copy(state.dice)};
  if(diceValues) clone.dice.forEach((d,i)=>{d.value=diceValues[i];});
  return resolveSubmission(clone);
}
export const evaluateSubmission=previewSubmission;
function dieAt(state,value) {return typeof value==='number'?state.dice[value]:state.dice.find(d=>d.id===value);}
function finishVisit(state,resolution) {
  const target=getVisitorTarget(state), ratio=state.visit.score/target;
  const tier=CONFIG.tipTiers.filter(t=>ratio>=t.minRatio).at(-1)||CONFIG.tipTiers[0];
  const record={week:state.week,visitor:state.visitor,evaluator:state.visitor===CONFIG.visitorsPerWeek,score:state.visit.score,target,ratio,tier:tier.name,tip:tier.tip,passed:state.visit.score>=target};
  state.money=roundMoney(state.money+tier.tip);state.history.push(record);state.lastVisitor=record;resolution.visitEnd=record;
  if(record.evaluator&&!record.passed) {state.phase='lost';state.lossReason='평가 담당자의 감동 기준 미달';state.shop=null;}
  else if(record.evaluator&&state.week===CONFIG.weeks) {state.phase='won';state.shop=null;}
  else {state.phase='shop';state.shop=makeShop(state);}
}
export function action(state,command) {
  const fail=error=>({ok:false,error});
  if(!command||typeof command.type!=='string') return fail('행동이 올바르지 않습니다.');
  const a=command;
  if(a.type==='HOLD') {
    if(state.phase!=='visit') return fail('관람 중에만 주사위를 보관할 수 있습니다.');
    const die=dieAt(state,a.die);if(!die)return fail('주사위를 찾을 수 없습니다.');
    die.held=a.held===undefined?!die.held:!!a.held;return {ok:true};
  }
  if(a.type==='REROLL') {
    if(state.phase!=='visit'||state.visit.rerollsLeft<=0) return fail('남은 리롤이 없습니다.');
    if(state.dice.every(d=>d.held))return fail('다시 굴릴 주사위를 선택하세요.');
    for(const die of state.dice)if(!die.held)die.value=pick(state,die.faces);
    state.visit.rerollsLeft--;return {ok:true};
  }
  if(a.type==='SUBMIT') {
    if(state.phase!=='visit'||state.visit.submissionsLeft<=0)return fail('지금 제출할 수 없습니다.');
    const resolution=resolveSubmission(state);state.lastResolution=resolution;
    state.visit.score+=resolution.score;state.visit.results.push(resolution);state.visit.submissionsLeft--;
    if(state.visit.submissionsLeft>0)rollAll(state);else finishVisit(state,resolution);
    return {ok:true,resolution};
  }
  if(state.phase!=='shop') return fail('상점에서만 할 수 있는 행동입니다.');
  if(a.type==='SKIP_FREE') {
    if(a.category==='piece') {
      if(!hasWeeklyPieceReward(state))return fail('조각 보상은 주간 평가 통과 후에만 받을 수 있습니다.');
      state.shop.freePieceClaimed=true;
    }
    else if(a.category==='artifact')state.shop.freeArtifactClaimed=true;
    else return fail('보상 종류가 올바르지 않습니다.');
    return {ok:true};
  }
  if(a.type==='NEXT_VISITOR') {
    if(state.visitor===CONFIG.visitorsPerWeek){state.week++;state.visitor=1;}else state.visitor++;
    state.phase='visit';state.shop=null;state.visit=freshVisit();rollAll(state);return {ok:true};
  }
  if(a.type==='SELL') {
    const i=state.artifacts.findIndex(item=>item.id===a.artifactId);if(i<0)return fail('유물을 찾을 수 없습니다.');
    const item=state.artifacts[i],price=roundMoney(definition(item,state).price*CONFIG.saleRatio);
    state.artifacts.splice(i,1);state.money=roundMoney(state.money+price);return {ok:true,sale:price};
  }
  if(a.type==='EDIT_DIE') {
    const die=dieAt(state,a.die);
    if(!die||!integer(a.face)||a.face<0||a.face>=6||!integer(a.value)||a.value<1||a.value>6)return fail('주사위 면 선택이 올바르지 않습니다.');
    if(die.faces[a.face]===a.value)return fail('같은 눈으로는 바꿀 필요가 없습니다.');
    if(!canAfford(state,CONFIG.editDieCost))return fail('돈이 부족합니다.');
    state.money=roundMoney(state.money-CONFIG.editDieCost);die.faces[a.face]=a.value;return {ok:true};
  }
  if(a.type==='MOVE_ARTIFACT') {
    const item=state.artifacts.find(item=>item.id===a.artifactId);if(!item)return fail('유물을 찾을 수 없습니다.');
    if(!legalArtifactPlacement(state,item,a.x,a.y,a.rotation??item.rotation,item.id))return fail('그 자리에 유물을 놓을 수 없습니다.');
    item.x=a.x;item.y=a.y;item.rotation=turns(a.rotation??item.rotation);return {ok:true};
  }
  if(a.type==='PLACE_PIECE'||a.type==='PLACE_ARTIFACT') {
    if(a.source!=='free'&&a.source!=='shop')return fail('상품 출처가 올바르지 않습니다.');
    const isPiece=a.type==='PLACE_PIECE',category=isPiece?'Pieces':'Artifacts',flag=isPiece?'freePieceClaimed':'freeArtifactClaimed';
    if(isPiece&&a.source==='shop')return fail('상점에서는 조각을 판매하지 않습니다.');
    if(isPiece&&!hasWeeklyPieceReward(state))return fail('조각 보상은 주간 평가 통과 후에만 받을 수 있습니다.');
    if(a.source==='free'&&state.shop[flag])return fail('이미 선택하거나 거절한 무료 보상입니다.');
    const offers=state.shop[a.source==='free'?`free${category}`:category.toLowerCase()],offer=offers?.[a.index];
    if(!offer)return fail('상품을 찾을 수 없습니다.');
    const legal=isPiece?legalPiecePlacement(state,offer,a.x,a.y,a.rotation):legalArtifactPlacement(state,offer,a.x,a.y,a.rotation);
    if(!legal)return fail('그 자리에 배치할 수 없습니다.');
    if(a.source==='shop'&&!canAfford(state,offer.price))return fail('돈이 부족합니다.');
    if(isPiece)state.pieces.push({id:nextId(state,'p'),face:offer.face,level:1,cells:rotatedCells(pieceLocalCells(offer),a.rotation).map(c=>({x:c.x+a.x,y:c.y+a.y}))});
    else state.artifacts.push({id:nextId(state,'a'),kind:offer.kind,x:a.x,y:a.y,rotation:turns(a.rotation),...(offer.kind==='brush'?{charges:offer.charges??CONFIG.brushCharges}:{})});
    if(a.source==='free')state.shop[flag]=true;else {state.money=roundMoney(state.money-offer.price);offers.splice(a.index,1);}
    return {ok:true};
  }
  return fail('알 수 없는 행동입니다.');
}
