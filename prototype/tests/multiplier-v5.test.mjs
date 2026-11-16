import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,previewSubmission,restoreGame} from '../dist/engine.js';

const close=(actual,expected)=>assert(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
function museum() {
  const state=createGame(517);
  state.pieces=[{id:'floor',face:1,level:2,cells:[{x:0,y:0},{x:1,y:0},{x:2,y:0}]}];
  state.artifacts=[{id:'source',kind:'mirror',x:0,y:0,rotation:0},{id:'receiver',kind:'coin',x:1,y:0,rotation:0}];
  state.dice.forEach(d=>{d.value=1;});
  return state;
}

test('two mirror activations add two bonuses to one shared base: 20 × 1.02',()=>{
  const result=previewSubmission(museum());
  assert.equal(result.counts.source,2);
  assert.equal(result.additive,20);
  close(result.multiplierBonus,.02);
  close(result.multiplier,1.02);
  close(result.score,20.4);
});

test('different sources and conditional bonuses share the same multiplier base',()=>{
  const state=museum();
  state.pieces.push({id:'other',face:2,level:1,cells:[{x:3,y:0},{x:4,y:0}]});
  state.artifacts.push({id:'wide',kind:'long_mirror',x:2,y:0,rotation:0});
  state.dice[4].value=2;
  const result=previewSubmission(state);
  assert.equal(result.conditionBonuses.wide,true);
  assert.equal(result.counts.source,2);assert.equal(result.counts.wide,2);
  close(result.multiplier,1+.01*2+.02*2);
  close(result.score,40*1.06);
});

test('without multiplying relic activations multiplier stays one and no additive stays zero',()=>{
  const state=museum();
  state.dice.forEach(d=>{d.value=6;});
  const inactive=previewSubmission(state);
  assert.equal(inactive.multiplier,1);assert.equal(inactive.score,0);
  state.artifacts=state.artifacts.filter(a=>a.kind==='mirror');
  state.dice.forEach(d=>{d.value=1;});
  const noReceiver=previewSubmission(state);
  close(noReceiver.multiplier,1.02);assert.equal(noReceiver.score,0);
});

test('finished v4 keeps product rules and active v4 migrates without changing earned scores',()=>{
  const old=museum();old.rulesVersion=4;old.phase='won';old.history=[{score:123}];
  const finished=restoreGame(old);
  assert.deepEqual(finished,old);close(previewSubmission(finished).score,20*1.01**2);
  old.phase='visit';old.visit.score=123;
  const current=restoreGame(old);
  assert.equal(current.rulesVersion,5);assert.equal(current.visit.score,123);
  assert.deepEqual(current.history,old.history);assert.equal(current.rng,old.rng);
  close(previewSubmission(current).score,20.4);
});
