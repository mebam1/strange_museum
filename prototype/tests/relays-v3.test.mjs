import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTIFACTS,CONFIG,LEGACY_ARTIFACTS,createGame,action,restoreGame,
  getArtifactDefinition,getArtifactFootprint,getVisitorTarget,previewSubmission,resolveSubmission,
} from '../dist/engine.js';

const cells=points=>points.map(([x,y])=>({x,y}));
const p=(id,face,level,points)=>({id,face,level,cells:cells(points)});
const a=(kind,id,x,y,extra={})=>({kind,id,x,y,rotation:0,...extra});
function fixture(pieces,artifacts,values=[3,5,1,2,6]) {
  const state=createGame(123);
  state.pieces=structuredClone(pieces);state.artifacts=structuredClone(artifacts);
  state.dice.forEach((die,i)=>{die.value=values[i];die.held=false;});
  return state;
}
const close=(actual,expected)=>assert(Math.abs(actual-expected)<=Math.max(1,Math.abs(expected))*1e-10,`${actual} != ${expected}`);

test('current rules starter and generated markets use current kinds only',()=>{
  assert.equal(ARTIFACTS.echo,undefined);assert.equal(ARTIFACTS.bell,undefined);
  assert.equal(ARTIFACTS.conduit.value,4);assert.equal(ARTIFACTS.prism.value,6);
  assert.equal(getArtifactDefinition('echo'),LEGACY_ARTIFACTS.echo);
  assert.equal(getArtifactDefinition({kind:'prism'}),ARTIFACTS.prism);
  for(let seed=1;seed<=8;seed++) {
    const state=createGame(seed);
    assert.equal(state.rulesVersion,5);
    assert(state.artifacts.some(x=>x.kind==='conduit'));
    assert(state.artifacts.every(x=>ARTIFACTS[x.kind]));
    for(let i=0;i<3;i++)assert(action(state,{type:'SUBMIT'}).ok);
    assert.equal(state.phase,'shop');
    for(const offer of [...state.shop.freeArtifacts,...state.shop.artifacts])assert(ARTIFACTS[offer.kind]);
  }
});

test('conduit accepts a mirror root while ignoring its own unmet dice condition',()=>{
  const state=fixture([p('source',3,1,[[0,0]]),p('destination',5,1,[[1,0]])],[
    a('mirror','mirror',0,0),a('conduit','conduit',1,0),
  ],[3,1,1,2,6]);
  const result=resolveSubmission(state);
  assert.deepEqual(result.counts,{mirror:1,conduit:1});
  close(result.score,ARTIFACTS.conduit.value*ARTIFACTS.mirror.value);
});

test('conduit accepts actual upgrades but static modifiers never start a chain',()=>{
  const state=fixture([p('fresh',3,1,[[0,0],[1,0],[2,0]])],[
    a('brush','brush',0,0,{charges:2}),a('conduit','conduit',1,0),a('pedestal','stand',2,0),
  ]);
  const result=resolveSubmission(state);
  assert.equal(result.counts.brush,1);assert.equal(result.counts.conduit,1);
  assert.equal(result.counts.stand,undefined);
  assert.equal(result.score,ARTIFACTS.conduit.value+ARTIFACTS.pedestal.value);
  assert.equal(result.chainCount,1);assert.equal(state.pieces[0].level,2);
  const again=resolveSubmission(state);
  assert.equal(again.chainCount,0);assert.equal(again.score,0);
  assert.equal(state.artifacts.find(x=>x.kind==='brush').charges,1);
});

test('prism requires its own full eye bundle even when a neighbor actually fires',()=>{
  const state=fixture([
    p('base',3,2,[[0,0],[1,0]]),p('extra',5,1,[[1,0]]),
  ],[a('mirror','source',0,0),a('prism','prism',1,0)],[3,1,1,2,6]);
  const blocked=resolveSubmission(state);
  assert.equal(blocked.counts.source,2);assert.equal(blocked.counts.prism,undefined);
  assert.equal(blocked.score,0);
  const open=previewSubmission(state,[3,5,1,2,6]);
  assert.equal(open.counts.prism,2);
  close(open.score,2*2*ARTIFACTS.prism.value*(1+(ARTIFACTS.mirror.value-1)*2));
  assert.equal(open.events.find(e=>e.type==='fire'&&e.artifactId==='prism').value,12);
  state.pieces[1].level=2;
  assert.equal(previewSubmission(state,[3,5,1,2,6]).score,open.score,'Prism reward counts pieces, not their level sum.');
});

test('a single-piece prism gives +6 and multiple copies of the bundle add no reward',()=>{
  const state=fixture([p('p',3,1,[[0,0],[1,0]])],[a('mirror','source',0,0),a('prism','prism',1,0)]);
  const one=previewSubmission(state,[3,1,2,4,6]);
  const five=previewSubmission(state,[3,3,3,3,3]);
  close(one.score,ARTIFACTS.prism.value*ARTIFACTS.mirror.value);
  assert.equal(five.score,one.score);
});

test('prism overlap reward is computed before static support, and frame affects chain additions',()=>{
  const state=fixture([
    p('base',3,2,[[0,0],[1,0],[2,0],[3,0],[1,1]]),p('extra',5,1,[[1,0]]),
  ],[
    a('mirror','source',0,0),a('prism','prism',1,0),a('pedestal','stand',1,1),a('frame','frame',2,0),
  ]);
  const result=resolveSubmission(state);
  const source=result.events.find(e=>e.type==='fire'&&e.artifactId==='source');
  const prism=result.events.find(e=>e.type==='fire'&&e.artifactId==='prism');
  assert.equal(source.value,ARTIFACTS.mirror.value);
  assert.equal(prism.value,2*ARTIFACTS.prism.value+ARTIFACTS.pedestal.value+ARTIFACTS.frame.value);
  close(result.score,2*prism.value*(1+(ARTIFACTS.mirror.value-1)*2));
  assert.equal(result.counts.stand,undefined);assert.equal(result.counts.frame,undefined);
});

test('conduits and prisms repropagate through diamond merges and cycles once per independent root',()=>{
  const state=fixture([
    p('base',3,2,[[0,0],[1,0],[0,1],[1,1],[2,1]]),p('extra',5,1,[[1,1]]),
  ],[
    a('mirror','source',0,0),a('conduit','b',1,0),a('conduit','c',0,1),
    a('prism','d',1,1),a('conduit','e',2,1),
  ]);
  const result=resolveSubmission(state);
  assert.equal(result.chainCount,2);
  assert.deepEqual(result.counts,{source:2,b:2,c:2,d:2,e:2});
  assert.deepEqual(result.chains[0].steps.map(s=>[s.artifactId,s.layer]),[['source',0],['b',1],['c',1],['d',2],['e',3]]);
  close(result.score,2*(3*ARTIFACTS.conduit.value+2*ARTIFACTS.prism.value)*(1+(ARTIFACTS.mirror.value-1)*2));
  const blocked=previewSubmission(state,[3,1,1,2,6]);
  assert.deepEqual(blocked.counts,{source:2,b:2,c:2});
  close(blocked.score,4*ARTIFACTS.conduit.value*(1+(ARTIFACTS.mirror.value-1)*2));
});

test('a skipped capped brush cannot seed either new relay, while a fresh target restores one real root',()=>{
  const state=fixture([p('done',3,2,[[0,0],[1,0],[2,0]])],[
    a('brush','brush',0,0,{charges:4}),a('conduit','wire',1,0),a('prism','lens',2,0),
  ]);
  const before=structuredClone(state);
  const empty=resolveSubmission(state);
  assert.equal(empty.score,0);assert.equal(empty.chainCount,0);assert.deepEqual(empty.events,[]);
  assert.deepEqual(state,before);
  state.pieces.push(p('fresh',5,1,[[0,0]]));
  const projected=previewSubmission(state,[3,5,1,2,6]);
  assert.equal(projected.upgrades.length,1);assert.equal(projected.chainCount,1);
  assert.deepEqual(projected.counts,{brush:1,wire:1,lens:1});
  assert.equal(projected.score,ARTIFACTS.conduit.value+ARTIFACTS.prism.value);
  assert.equal(state.pieces.at(-1).level,1,'Preview must not apply the projected level-up.');
  assert.equal(state.artifacts[0].charges,4);
});

test('finished legacy restores preserve kind, levels, RNG, earned records, and recorded visitor target',()=>{
  for(const phase of ['won','lost']) {
    const old=createGame(12);old.rulesVersion=2;old.phase=phase;old.pieces[0].level=8;
    old.artifacts[2].kind='echo';old.artifacts.push(a('bell','old-bell',2,0));
    old.lastVisitor={score:1234,target:987.65,ratio:1234/987.65,tip:22};
    old.history=[structuredClone(old.lastVisitor)];old.visit.score=1234;
    old.lastResolution={score:1234,counts:{a3:19,'old-bell':7},events:[]};
    const backup=structuredClone(old),restored=restoreGame(old);
    assert.deepEqual(restored,backup);assert.deepEqual(old,backup);
    assert.equal(getVisitorTarget(restored),987.65);
    for(const artifact of restored.artifacts) {
      assert(getArtifactDefinition(artifact));
      assert(getArtifactFootprint(restored,artifact).length>0);
    }
    previewSubmission(restored,[1,2,3,4,5]);
    assert.deepEqual(restored,backup);
  }
});

test('terminal visitor target remains the recorded target after balance constants change',t=>{
  const before=CONFIG.evaluatorTarget;
  t.after(()=>{CONFIG.evaluatorTarget=before;});
  const state=createGame(4);state.phase='won';state.week=8;state.visitor=3;
  state.lastVisitor={target:12345.6};
  CONFIG.evaluatorTarget=before*3;
  assert.equal(getVisitorTarget(state),12345.6);
  state.phase='lost';assert.equal(getVisitorTarget(state),12345.6);
});
