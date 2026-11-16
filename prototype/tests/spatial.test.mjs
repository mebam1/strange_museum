import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,previewSubmission,SHAPES,ARTIFACTS,CONFIG} from '../dist/engine.js';
import {exactOneRoll,physicalHistograms,comparePieceChoice,reachedReport} from '../spatial-check.mjs';

test('spatial histogram expectation agrees with physical outcomes for nonidentical edited dice',()=>{
  const state=createGame(53);
  state.pieces[0].level=2;
  state.artifacts=[{id:'source',kind:'mirror',x:0,y:0,rotation:0},{id:'receiver',kind:'coin',x:1,y:0,rotation:0}];
  state.dice[0].faces=[1,1,1,1,2,6];state.dice[1].faces=[2,2,2,3,3,6];
  const before=structuredClone(state),distribution=physicalHistograms(state.dice);
  let total=0,score=0;
  const visit=(values=[])=>{
    if(values.length===state.dice.length){total++;score+=previewSubmission(state,values).score;return;}
    for(const value of state.dice[values.length].faces)visit([...values,value]);
  };
  visit();
  assert.equal(total,7776);assert.equal(distribution.total,total);
  assert(Math.abs(exactOneRoll(state,distribution).expectedScore-score/total)<1e-9);
  assert.deepEqual(state,before);
});

test('reached snapshots are chosen by declared sample order and restore diagnostic balance overrides',()=>{
  const state=createGame(55);
  state.pieces[0].level=2;
  state.artifacts=[{id:'source',kind:'mirror',x:0,y:0,rotation:0},{id:'receiver',kind:'coin',x:1,y:0,rotation:0}];
  for(const die of state.dice)die.faces=[1,1,1,1,1,1];
  state.freePieces=[{...SHAPES[0],face:2},{...SHAPES[0],face:3}];state.freeArtifacts=[];
  const catalogBefore=structuredClone(ARTIFACTS),configBefore=structuredClone(CONFIG);
  const input={artifactBalance:structuredClone(ARTIFACTS),config:structuredClone(CONFIG),policyVersion:'fixture',
    runs:[9001,9000].map(sampleId=>({sampleId,seed:sampleId,policy:'balanced',placementMode:'adaptive',
      pieceDecisions:[{week:1,beforeState:structuredClone(state),choice:{index:1}}]}))};
  input.artifactBalance.long_mirror.conditionalValue=1.16;
  const before=structuredClone(input),report=reachedReport(input,{weeks:[1,3]});
  assert.equal(report.cases[0].sampleId,9000);
  assert.equal(report.cases[0].comparison.pieceOffer.face,2);
  assert.equal(report.cases[1].missing,true);
  assert.equal(report.capturedRules.artifactBalance.long_mirror.conditionalValue,1.16);
  report.input={path:'fixture.json',sha256:'fixture-hash'};
  const reused=reachedReport(input,{weeks:[1,3],cachedReport:report});
  assert.equal(reused.cases[0].reusedFromInput.sha256,'fixture-hash');
  const changed=structuredClone(input);changed.artifactBalance.long_mirror.conditionalValue=1.20;
  const recalculated=reachedReport(changed,{weeks:[1],cachedReport:report});
  assert.equal(recalculated.cases[0].reusedFromInput,null);
  assert.deepEqual(input,before);
  assert.deepEqual(ARTIFACTS,catalogBefore);assert.deepEqual(CONFIG,configBefore);
});

test('spatial paired choice gives expansion its new space without inventing stock or mutating input',()=>{
  const state=createGame(54);
  state.pieces[0].level=2;
  state.artifacts=[{id:'source',kind:'mirror',x:0,y:0,rotation:0},
    ...[[1,0],[2,0],[0,1],[1,1],[2,1]].map(([x,y],i)=>({id:`r${i}`,kind:'conduit',x,y,rotation:0}))];
  for(const die of state.dice)die.faces=[1,1,1,1,1,1];
  const before=structuredClone(state);
  const result=comparePieceChoice(state,{...SHAPES[0],face:1},{incomingArtifacts:[{kind:'long_mirror'}]});
  assert.equal(result.exhaustive,true);
  assert.equal(result.evaluatedPiecePlacements,result.totalLegalPiecePlacements);
  assert(result.candidates.some(row=>row.overlapCells===0&&row.legalIncomingPlacements>0));
  assert(result.candidates.filter(row=>row.overlapCells>0).every(row=>row.legalIncomingPlacements===0));
  assert(result.bestWithIncoming.expand.withOneIncoming.incoming);
  assert.deepEqual(state,before);
});
