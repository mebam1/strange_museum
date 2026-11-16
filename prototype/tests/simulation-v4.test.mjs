import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../dist/engine.js';
import * as catalog from '../dist/catalog.js';
import {AutomatedPlayer,rollDistribution} from '../simulate.mjs';

test('simulator values a multicell source using OR activation and maximum active count',()=>{
  const state=engine.createGame(8);
  const player=new AutomatedPlayer(engine,catalog,'balanced',8);
  player.currentDistribution=rollDistribution(state.dice);
  const stats=player.cellActivationStats(state,[{faces:[1],levelSum:2},{faces:[2],levelSum:2}]);
  const expected=1-(4/6)**5;
  assert(Math.abs(stats.probability-expected)<1e-12);
  assert(Math.abs(stats.repetitions-2*expected)<1e-12);
  const same=player.cellActivationStats(state,[{faces:[1],levelSum:2},{faces:[1],levelSum:2}]);
  assert(Math.abs(same.repetitions-2*(1-(5/6)**5))<1e-12);
});

test('simulator neither claims nor rejects a nonexistent ordinary piece reward',()=>{
  const state=engine.createGame(11);
  for(let i=0;i<3;i++)assert(engine.action(state,{type:'SUBMIT'}).ok);
  assert.equal(state.phase,'shop');
  const player=new AutomatedPlayer(engine,catalog,'casual',11,{trace:true});
  player.playShop(state);
  assert.equal(player.metrics.freePieces,0);
  assert.equal(player.metrics.rejectedPieces,0);
  assert(!player.actions.some(a=>a.type==='PLACE_PIECE'||a.type==='SKIP_FREE'&&a.category==='piece'));
  assert.equal(state.phase,'visit');
});
