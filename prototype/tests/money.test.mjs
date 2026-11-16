import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,action,ARTIFACTS,CONFIG} from '../dist/engine.js';

function shopFixture() {
  const state=createGame(1);
  state.phase='shop';
  state.shop={freePieces:[],freeArtifacts:[],pieces:[],artifacts:[],freePieceClaimed:true,freeArtifactClaimed:true};
  return state;
}

test('fractional resale proceeds can fund an exactly affordable purchase',()=>{
  const state=shopFixture();
  const kinds=['seal','seal','pedestal'];
  const purchasePrice=ARTIFACTS.pedestal.price;
  const saleTenths=kinds.reduce((sum,kind)=>sum+Math.round(ARTIFACTS[kind].price*CONFIG.saleRatio*10),0);
  state.money=purchasePrice-saleTenths/10;
  state.artifacts=kinds.map((kind,i)=>({id:`sale${i}`,kind,x:i,y:0,rotation:0}));
  state.shop.artifacts=[{id:'offer',kind:'pedestal',price:purchasePrice}];
  for(let i=0;i<kinds.length;i++)assert.equal(action(state,{type:'SELL',artifactId:`sale${i}`}).ok,true);
  // Before the fix: 13 + 3.4 + 3.4 + 2.2 = 21.999999999999996, rejecting a 22 purchase.
  const bought=action(state,{type:'PLACE_ARTIFACT',source:'shop',index:0,x:0,y:0,rotation:0});
  assert.equal(bought.ok,true,bought.error);
  assert.equal(state.money,0);
  assert.equal(state.artifacts.length,1);
  assert.equal(state.artifacts[0].kind,'pedestal');
  assert.equal(state.shop.artifacts.length,0);
});

test('an affordable die edit tolerates pre-existing binary noise in a saved wallet',()=>{
  const state=shopFixture();
  state.money=CONFIG.editDieCost-Number.EPSILON*CONFIG.editDieCost;
  const changed=action(state,{type:'EDIT_DIE',die:0,face:1,value:1});
  assert.equal(changed.ok,true,changed.error);
  assert.equal(state.money,0);
  assert.equal(state.dice[0].faces[1],1);
});
