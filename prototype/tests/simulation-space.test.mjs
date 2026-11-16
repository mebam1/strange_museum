import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../dist/engine.js';
import * as catalog from '../dist/catalog.js';
import {AutomatedPlayer,experimentSeed,runOne,summarizeRuns} from '../simulate.mjs';

function fixture(artifacts,width=3) {
  const state=engine.createGame(101);
  state.phase='shop';
  state.pieces=[{id:'floor',face:1,level:1,cells:Array.from({length:width},(_,x)=>({x,y:0}))}];
  state.artifacts=artifacts.map((a,index)=>({id:`a${index}`,rotation:0,y:0,...a}));
  state.dice.forEach(die=>{die.faces=[1,1,1,1,1,1];die.value=1;});
  state.shop={freePieces:[],freeArtifacts:[],artifacts:[],freePieceClaimed:true,freeArtifactClaimed:false};
  return state;
}

test('geometry modes restrict only floor placements and direct recipients reward overlap',()=>{
  const state=fixture([{kind:'mirror',x:0},{kind:'coin',x:1}]);
  const offer={face:1,cells:[{x:0,y:0}]};
  const placements={};
  for(const mode of ['adaptive','expand','overlap']) {
    const player=new AutomatedPlayer(engine,catalog,'investor',1,{placementMode:mode});
    placements[mode]=player.bestPlacement(state,offer,'piece');
    assert(engine.legalPiecePlacement(state,offer,placements[mode].x,placements[mode].y,placements[mode].rotation));
    assert(player.sourceSupport(state,[{x:0,y:0}],new Set(['floor']))>=catalog.ARTIFACTS.coin.value);
  }
  assert.equal(placements.expand.overlapCells,0);
  assert.equal(placements.overlap.overlapCells,1);
  assert.equal(placements.adaptive.overlapCells,1);
  assert(placements.overlap.scoreMarginal>0);
});

test('offer diagnostics distinguish area, fragmentation and unavailable money',()=>{
  const state=fixture([{kind:'mirror',x:1}]);
  state.money=0;
  state.shop.artifacts=[{kind:'long_mirror',price:20},{kind:'coin',price:10}];
  const player=new AutomatedPlayer(engine,catalog,'balanced',1);
  const offers=player.inspectOffers(state,'shop');
  assert.equal(offers[0].spaceReason,'fragmented');
  assert.equal(offers[0].reason,'noIncome');
  assert.equal(offers[1].fits,true);
  state.artifacts.push({id:'extra',kind:'coin',x:0,y:0,rotation:0});
  player._analysis=null;
  assert.equal(player.inspectOffers(state,'shop')[0].spaceReason,'area');
});

test('fixed public previews leave state and player RNG unchanged',()=>{
  const state=fixture([{kind:'mirror',x:0},{kind:'coin',x:1}]);
  const player=new AutomatedPlayer(engine,catalog,'investor',123);
  const control=new AutomatedPlayer(engine,catalog,'investor',123);
  const before=structuredClone(state);
  const value=player.sampledBoardValue(state);
  assert.deepEqual(state,before);
  assert.equal(player.random(),control.random());
  state.rng^=0x76543210;
  assert.equal(player.sampledBoardValue(state),value);
});

test('layout expectation matches physical dice outcomes and does not privilege the first face',()=>{
  const state=fixture([{kind:'mirror',x:0},{kind:'coin',x:1}]);
  state.dice.forEach(die=>{die.faces=[1,2,3,4,5,6];});
  state.dice[0].faces=[1,1,2,3,4,5];
  const player=new AutomatedPlayer(engine,catalog,'investor',123);
  let total=0,count=0;
  const enumerate=values=>{
    if(values.length===state.dice.length){total+=engine.previewSubmission(state,values).score;count++;return;}
    for(const face of state.dice[values.length].faces)enumerate([...values,face]);
  };
  enumerate([]);
  assert(Math.abs(player.sampledBoardValue(state)-total/count)<1e-9);
  state.dice.forEach(die=>{die.faces=[1,2,3,4,5,6];});
  const byFace=[];
  for(let face=1;face<=6;face++) {
    state.pieces[0].face=face;
    byFace.push(player.sampledBoardValue(state));
  }
  assert(Math.max(...byFace)-Math.min(...byFace)<1e-10);
});

test('artifact usage includes acquired and owned static relics without activation counters',()=>{
  const summary=summarizeRuns([{won:false,finalWeek:1,evaluatorHistory:[],errors:[],
    acquiredByKind:{pedestal:2},finalArtifactsByKind:{frame:1},activationsByKind:{coin:4}}]);
  assert.equal(summary.artifactUsage.pedestal.meanAcquired,2);
  assert.equal(summary.artifactUsage.pedestal.meanActivations,0);
  assert.equal(summary.artifactUsage.frame.meanFinalOwned,1);
  assert.equal(summary.artifactUsage.frame.runsWithActivation,0);
});

test('blocked useful relic replaces an inert relic through legal actions and preserves scoring roles',()=>{
  const state=fixture([{kind:'mirror',x:0},{kind:'coin',x:1},{kind:'seal',x:2}]);
  state.shop.freeArtifacts=[{kind:'observer',price:catalog.ARTIFACTS.observer.price}];
  const player=new AutomatedPlayer(engine,catalog,'investor',1,{trace:true});
  const before=player.sampledBoardValue(state);
  assert.equal(player.inspectOffers(state,'free')[0].fits,false);
  assert(player.tryReplacement(state,'free'));
  assert(player.sampledBoardValue(state)>before);
  assert.equal(player.metrics.replacements,1);
  assert.equal(player.metrics.soldArtifactArea,1);
  assert.equal(player.metrics.incomingArtifactArea,1);
  assert.deepEqual(player.actions.map(a=>a.type),['SELL','PLACE_ARTIFACT']);
  assert(state.artifacts.some(a=>a.kind==='mirror'));
  assert(state.artifacts.some(a=>a.kind==='coin'));
  assert.equal(player.tryReplacement(state,'shop'),null);
});

test('general relocation compares net whole-board score rather than incoming score alone',()=>{
  const state=fixture([{kind:'mirror',x:0},{kind:'coin',x:2}],4);
  const player=new AutomatedPlayer(engine,catalog,'investor',1,{trace:true});
  const before=player.sampledBoardValue(state);
  player.moveArtifacts(state);
  assert(player.sampledBoardValue(state)>before);
  assert.equal(player.metrics.generalMoves,1);
  assert.deepEqual(player.actions.map(a=>a.type),['MOVE_ARTIFACT']);
});

test('last charged brush remains available for future weekly pieces',()=>{
  const state=fixture([{kind:'mirror',x:0},{kind:'coin',x:1},{kind:'brush',x:2,charges:3}]);
  state.pieces[0].level=catalog.CONFIG.maxPieceLevel;
  state.shop.freeArtifacts=[{kind:'observer',price:catalog.ARTIFACTS.observer.price}];
  const player=new AutomatedPlayer(engine,catalog,'investor',1);
  player.tryReplacement(state,'free');
  assert(state.artifacts.some(a=>a.kind==='brush'&&a.charges===3));
});

test('complete runs preserve snapshots, area-flow accounting and matching-week denominators',()=>{
  const runs=['adaptive','expand','overlap'].map(placementMode=>runOne(engine,catalog,experimentSeed(8000),'investor',{placementMode}));
  for(const run of runs) {
    assert.equal(run.errors.length,0);
    assert.equal(run.initialSpace.boardCells+run.addedBoardCells,run.finalSpace.boardCells);
    assert.equal(run.initialSpace.occupiedCells+run.incomingArtifactArea-run.soldArtifactArea-run.despawnedArtifactArea,run.finalSpace.occupiedCells);
    assert.equal(run.freeArtifacts+run.rejectedArtifacts,run.offeredFreeArtifactChoices);
    assert.equal(run.freeRejectReasons.space+run.freeRejectReasons.lowValue,run.rejectedArtifacts);
    assert.equal(run.shopSnapshots.length,run.offeredFreeArtifactChoices*2);
    assert.equal(run.pieceDecisions.length,run.freePieces+run.rejectedPieces);
    assert.equal(run.evaluatorSnapshots.length,run.finalWeek);
    assert.equal(run.finalBoard.artifacts.length,run.artifacts);
    for(const decision of run.pieceDecisions) {
      assert.equal(decision.beforeState.dice.length,5);
      assert.equal(decision.beforeState.freePieces.length,3);
      assert(!('rng' in decision.beforeState));
    }
    if(run.placementMode==='expand')assert.equal(run.overlapCellsAdded,0);
    const summary=summarizeRuns([run]);
    assert.equal(summary.weeks[0].evaluatorSpace.samples,1);
    if(run.finalWeek<8)assert.equal(summary.weeks[run.finalWeek].evaluatorSpace.samples,0);
  }
});
