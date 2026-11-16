import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTIFACTS, CONFIG, action, createGame, getArtifactDefinition, getArtifactFootprint,
  legalArtifactPlacement, previewSubmission, resolveSubmission, restoreGame,
} from '../dist/engine.js';

const cells = pairs => pairs.map(([x,y]) => ({x,y}));
const piece = (id,face,level,pairs) => ({id,face,level,cells:cells(pairs)});
const relic = (kind,id,x,y,extra={}) => ({kind,id,x,y,rotation:0,...extra});
const close = (a,b) => assert(Math.abs(a-b)<=Math.max(1,Math.abs(b))*1e-10, `${a} != ${b}`);
function fixture(pieces,artifacts,values=[1,2,3,4,5]) {
  const state=createGame(406);
  state.pieces=structuredClone(pieces);state.artifacts=structuredClone(artifacts);
  state.dice.forEach((die,i)=>{die.value=values[i];die.held=false;});
  return state;
}
function submitVisit(state) {
  while(state.phase==='visit') assert.equal(action(state,{type:'SUBMIT'}).ok,true);
}
function guaranteedPass(visitor=CONFIG.visitorsPerWeek,week=1) {
  const state=createGame(10);state.visitor=visitor;state.week=week;
  // A progression fixture isolates reward eligibility from combat balancing.
  state.visit.score=1e9;state.artifacts=[];
  return state;
}
function rejectUnchanged(state,command) {
  const before=structuredClone(state);
  assert.equal(action(state,command).ok,false);
  assert.deepEqual(state,before);
}

test('current scoring artifacts separate multiplicative tile sources and additive chain receivers',()=>{
  for(const def of Object.values(ARTIFACTS)) {
    if(def.effect==='multiply') assert.equal(def.trigger,'tile',def.kind);
    if(def.effect==='add') assert.equal(def.trigger,'chain',def.kind);
  }
  assert.equal(ARTIFACTS.long_mirror.value,ARTIFACTS.mirror.value);
  assert.equal(ARTIFACTS.long_mirror.cells.length,2);
});

test('every ordinary visitor offers three artifacts but no piece, even after an excellent score',()=>{
  for(const visitor of [1,2]) {
    const state=guaranteedPass(visitor);submitVisit(state);
    assert.equal(state.phase,'shop');
    assert.equal(state.shop.freeArtifacts.length,3);
    assert.equal(state.shop.freeArtifactClaimed,false);
    assert.deepEqual(state.shop.freePieces,[]);
    assert.equal(state.shop.freePieceClaimed,true);
    assert.deepEqual(state.shop.pieces,[]);
    rejectUnchanged(state,{type:'SKIP_FREE',category:'piece'});
  }
});

test('a passing weekly evaluator offers one selection from three pieces and three artifacts',()=>{
  const state=guaranteedPass();submitVisit(state);
  assert.equal(state.phase,'shop');
  assert.equal(state.lastVisitor.evaluator,true);assert.equal(state.lastVisitor.passed,true);
  assert.equal(state.shop.freePieces.length,3);assert.equal(state.shop.freePieceClaimed,false);
  assert.equal(state.shop.freeArtifacts.length,3);assert.equal(state.shop.freeArtifactClaimed,false);
  assert.deepEqual(state.shop.pieces,[]);
  const before=state.pieces.length;
  assert.equal(action(state,{type:'PLACE_PIECE',source:'free',index:0,x:3,y:0,rotation:0}).ok,true);
  assert.equal(state.pieces.length,before+1);
  rejectUnchanged(state,{type:'PLACE_PIECE',source:'free',index:1,x:3,y:0,rotation:0});
});

test('failed evaluations and final victory terminate without reward markets',()=>{
  const failed=createGame(41);failed.visitor=3;failed.artifacts=[];
  submitVisit(failed);assert.equal(failed.phase,'lost');assert.equal(failed.shop,null);
  const won=guaranteedPass(3,CONFIG.weeks);submitVisit(won);
  assert.equal(won.phase,'won');assert.equal(won.shop,null);
});

test('injected paid pieces and ordinary-visitor free pieces cannot bypass the reward schedule',()=>{
  const state=guaranteedPass(1);submitVisit(state);state.money=999;
  const offer={id:'forged',face:2,level:1,cells:cells([[0,0],[1,0]]),price:1};
  state.shop.pieces=[offer];
  rejectUnchanged(state,{type:'PLACE_PIECE',source:'shop',index:0,x:3,y:0});
  state.shop.freePieces=[offer];state.shop.freePieceClaimed=false;
  rejectUnchanged(state,{type:'PLACE_PIECE',source:'free',index:0,x:3,y:0});
});

test('a multicell source uses max rather than sum and transmits from its inactive outer cell',()=>{
  const state=fixture([
    piece('hub',1,2,[[0,0]]),piece('hub2',2,2,[[0,0]]),
    piece('body',6,2,[[1,0],[2,0]]),
  ],[relic('long_mirror','wide',0,0),relic('conduit','receiver',2,0)]);
  assert.equal(legalArtifactPlacement({...state,artifacts:[state.artifacts[1]]},state.artifacts[0],0,0),true);
  const result=resolveSubmission(state);
  assert.equal(result.counts.wide,4);assert.equal(result.counts.receiver,4);
  assert.equal(result.chainCount,4);assert.equal(result.chains.length,1);
  assert.equal(result.chains[0].rootId,'wide');
  close(result.score,4*ARTIFACTS.conduit.value*(1+(ARTIFACTS.mirror.value-1)*4));
});

test('conditional wide mirror needs different requirements and every covered cell active',()=>{
  const state=fixture([
    piece('left',1,2,[[0,0]]),piece('right',2,1,[[1,0],[2,0]]),
  ],[relic('long_mirror','wide',0,0),relic('conduit','receiver',2,0)]);
  const both=previewSubmission(state,[1,2,3,4,5]);
  const left=previewSubmission(state,[1,1,3,4,5]);
  const right=previewSubmission(state,[2,2,3,4,5]);
  const neither=previewSubmission(state,[3,3,3,4,5]);
  assert.equal(both.counts.wide,2);assert.equal(both.chainCount,2);
  assert.equal(both.conditionBonuses.wide,true);assert.equal(both.effectValues.wide,1.02);
  close(both.score,2*ARTIFACTS.conduit.value*(1+0.02*2));
  assert.equal(left.counts.wide,2);assert.equal(left.conditionBonuses.wide,false);
  assert.equal(left.effectValues.wide,ARTIFACTS.mirror.value);
  assert.equal(right.counts.wide,1);assert.equal(right.conditionBonuses.wide,false);
  assert.equal(neither.chainCount,0);assert.equal(neither.score,0);
  const same=fixture([piece('same',1,2,[[0,0],[1,0],[2,0]])],state.artifacts);
  const sameResult=previewSubmission(same);
  assert.equal(sameResult.counts.wide,2);assert.equal(sameResult.conditionBonuses.wide,false);
});

test('wide source rotation preserves outer adjacency and the same receiver is counted once',()=>{
  const state=fixture([
    piece('left',1,2,[[0,0],[0,1],[1,0],[1,1],[2,0]]),
  ],[
    relic('long_mirror','wide',0,0,{rotation:1}),
    relic('conduit','receiver',1,0,{cells:cells([[0,0],[0,1]])}),
    relic('conduit','tail',2,0),
  ]);
  assert.deepEqual(getArtifactFootprint(state,state.artifacts[0]),cells([[0,0],[0,1]]));
  const result=resolveSubmission(state);
  assert.deepEqual(result.counts,{wide:2,receiver:2,tail:2});
  assert.equal(result.chainCount,2);
  assert.deepEqual(result.chains[0].steps.map(s=>s.artifactId),['wide','receiver','tail']);
});

test('a wide source starts one connected chain across two disconnected receiver branches',()=>{
  const state=fixture([piece('floor',1,2,[[0,0],[1,0],[-1,0],[2,0]])],[
    relic('long_mirror','wide',0,0),relic('conduit','left',-1,0),relic('conduit','right',2,0),
  ]);
  const result=resolveSubmission(state);
  assert.equal(result.chains.length,1);assert.equal(result.chainCount,2);
  assert.deepEqual(result.counts,{wide:2,left:2,right:2});
});

test('coin receives only adjacent actual tile sources while downstream relays may follow it',()=>{
  const state=fixture([piece('floor',1,2,[[0,0],[1,0],[2,0],[3,0]])],[
    relic('mirror','source',0,0),relic('coin','coin',1,0),
    relic('conduit','relay',2,0),relic('coin','blocked',3,0),
  ]);
  const result=resolveSubmission(state);
  assert.deepEqual(result.counts,{source:2,coin:2,relay:2});
  close(result.score,2*(ARTIFACTS.coin.value+ARTIFACTS.conduit.value)*(1+(ARTIFACTS.mirror.value-1)*2));
});

test('restoring an ordinary v3 shop removes obsolete piece offers without rerolling artifacts',()=>{
  const state=guaranteedPass(1);submitVisit(state);state.rulesVersion=3;
  state.shop.freePieces=[{id:'old-free',face:2,cells:cells([[0,0],[1,0]]),price:10}];
  state.shop.pieces=structuredClone(state.shop.freePieces);state.shop.freePieceClaimed=false;
  const before=structuredClone(state),restored=restoreGame(state);
  assert.equal(restored.rulesVersion,5);
  assert.deepEqual(restored.shop.freePieces,[]);assert.deepEqual(restored.shop.pieces,[]);
  assert.equal(restored.shop.freePieceClaimed,true);
  assert.deepEqual(restored.shop.freeArtifacts,before.shop.freeArtifacts);
  assert.deepEqual(restored.shop.artifacts,before.shop.artifacts);
  assert.equal(restored.rng,before.rng);assert.deepEqual(state,before);
  assert.deepEqual(restoreGame(restored),restored);
});

test('restoring a passing evaluator v3 shop preserves pending and already-claimed weekly choices',()=>{
  const state=guaranteedPass();submitVisit(state);state.rulesVersion=3;
  for(const claimed of [false,true]) {
    state.shop.freePieceClaimed=claimed;
    const before=structuredClone(state),restored=restoreGame(state);
    assert.deepEqual(restored.shop.freePieces,before.shop.freePieces);
    assert.equal(restored.shop.freePieceClaimed,claimed);
    assert.deepEqual(restored.shop.pieces,[]);
    assert.equal(restored.rng,before.rng);
  }
});

test('completed v3 saves retain old artifact meaning while new games use new roles',()=>{
  for(const phase of ['won','lost']) {
    const old=createGame(18);old.rulesVersion=3;old.phase=phase;
    old.lastVisitor={target:123,score:456};
    const original=structuredClone(old),restored=restoreGame(old);
    assert.deepEqual(restored,original);
    assert.equal(getArtifactDefinition('coin',restored).trigger,'tile');
    assert.equal(getArtifactDefinition('coin',restored).effect,'add');
    assert.equal(getArtifactDefinition('seal',restored).effect,'multiply');
    assert.equal(getArtifactDefinition('coin',createGame(18)).trigger,'chain');
  }
});
