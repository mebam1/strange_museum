/** Historical rules-v3 controlled fixtures. These are not v4 balance evidence or player runs. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  ARTIFACTS,CONFIG,SHAPES,createGame,getBoardCells,legalArtifactPlacement,
  legalPiecePlacement,previewSubmission,rotatedCells,
} from './dist/engine.js';

const pointList=coordinates=>coordinates.map(([x,y])=>({x,y}));
const piece=(id,face,level,coordinates)=>({id,face,level,cells:pointList(coordinates)});
const artifact=(kind,id,x,y)=>({kind,id,x,y,rotation:0});
const signature=cells=>cells.map(c=>`${c.x},${c.y}`).sort().join(';');
const normalized=cells=>rotatedCells(cells,0);

// Constructive placement order: root D2, top I4, far D2, then lower bridge D2.
// The upper I4 connects the separate endpoint pieces; its empty cells hold no relics.
const bridgePieces=[
  piece('root-piece',3,2,[[0,0],[0,-1]]),
  piece('upper-corridor',6,1,[[0,-1],[1,-1],[2,-1],[3,-1]]),
  piece('far-piece',3,2,[[3,0],[3,-1]]),
  piece('lower-bridge',6,1,[[1,0],[2,0]]),
];
const extraFive=piece('extra-five',5,1,[[3,0],[4,0]]);
const bridgeArtifacts=[
  artifact('coin','source',0,0),artifact('conduit','wire1',1,0),
  artifact('conduit','wire2',2,0),artifact('prism','lens',3,0),
];
const multiPieces=[
  piece('shared-t',3,2,[[0,0],[-1,0],[1,0],[0,-1]]),
  piece('center-extra',5,1,[[0,0],[0,1]]),
];
const multiArtifacts=[
  artifact('coin','left',-1,0),artifact('coin','right',1,0),
  artifact('coin','top',0,-1),artifact('prism','center',0,0),
];
const fixtures=[
  {id:'bridge_depth1',family:'single-source bridge',description:'Two conduits carry the source across face-6 cells to a one-piece face-3 prism.',pieces:bridgePieces,artifacts:bridgeArtifacts},
  {id:'bridge_depth2',family:'single-source bridge',description:'Add a face-5 domino over the far prism, requiring 3+5 and raising its per-reaction addition from 6 to 12.',pieces:[...bridgePieces,extraFive],artifacts:bridgeArtifacts},
  {id:'bridge_gap_depth2',family:'single-source bridge',description:'Remove wire2 only. The museum cell remains; the remote prism has no reachable source.',pieces:[...bridgePieces,extraFive],artifacts:bridgeArtifacts.filter(a=>a.id!=='wire2')},
  {id:'coin_replaces_bridge_depth2',family:'single-source bridge',description:'Replace wire2 with a coin on the same face-6 cell. A coin can seed a new chain when 6 rolls, but cannot relay the source chain through an unmet cell.',pieces:[...bridgePieces,extraFive],artifacts:bridgeArtifacts.map(a=>a.id==='wire2'?{...a,id:'middle-coin',kind:'coin'}:a)},
  {id:'coin_replaces_prism_depth2',family:'single-source bridge',description:'Replace the far depth-2 prism with a coin. This deliberately retains a case where a coin is cheaper and stronger.',pieces:[...bridgePieces,extraFive],artifacts:bridgeArtifacts.map(a=>a.id==='lens'?{...a,id:'far-coin',kind:'coin'}:a)},
  {id:'three_sources_prism_depth2',family:'multiple adjacent sources',description:'Three coins share a level-2 T4 piece. Their six independent chains reach a center depth-2 prism requiring 3+5.',pieces:multiPieces,artifacts:multiArtifacts},
  {id:'three_sources_coin_center_depth2',family:'multiple adjacent sources',description:'Replace the same central prism with a coin; the neighbor coins are tile reactions and cannot receive its outgoing chain.',pieces:multiPieces,artifacts:multiArtifacts.map(a=>a.id==='center'?{...a,kind:'coin'}:a)},
];

function validateFixture(fixture) {
  const state={pieces:[],artifacts:[]},pieceChecks=[],artifactChecks=[];
  for(const p of fixture.pieces) {
    assert(p.level>=1&&p.level<=CONFIG.maxPieceLevel,`${fixture.id}: level exceeds the actual cap`);
    const local=normalized(p.cells),sig=signature(local);
    let match=null;
    for(const shape of SHAPES)for(let rotation=0;rotation<4;rotation++) {
      if(signature(rotatedCells(shape.cells,rotation))===sig)match||={shape:shape.id,rotation};
    }
    assert(match,`${fixture.id}: piece ${p.id} is not an available catalog shape`);
    const x=Math.min(...p.cells.map(c=>c.x)),y=Math.min(...p.cells.map(c=>c.y));
    assert(legalPiecePlacement(state,{face:p.face,cells:local},x,y,0),`${fixture.id}: disconnected piece ${p.id}`);
    state.pieces.push(structuredClone(p));
    pieceChecks.push({pieceId:p.id,...match,levelWithinCap:true,connectedAtPlacement:true});
  }
  for(const a of fixture.artifacts) {
    assert(legalArtifactPlacement(state,a,a.x,a.y,a.rotation),`${fixture.id}: illegal artifact ${a.id}`);
    state.artifacts.push(structuredClone(a));
    artifactChecks.push({artifactId:a.id,onMuseum:true,nonOverlapping:true});
  }
  return {pieceChecks,artifactChecks,board:getBoardCells(state)};
}

// All 6^5 physical outcomes have equal weight. Compress duplicate count histograms only.
const histograms=new Map();
function enumerate(values=[]) {
  if(values.length===5) {
    const sorted=values.slice().sort((a,b)=>a-b),key=sorted.join('');
    const existing=histograms.get(key);
    if(existing)existing.weight++;else histograms.set(key,{values:sorted,weight:1});
    return;
  }
  for(let value=1;value<=6;value++)enumerate([...values,value]);
}
enumerate();
assert.equal(histograms.size,252);
assert.equal([...histograms.values()].reduce((n,h)=>n+h.weight,0),7776);
const conditionalHands={
  only3:{values:[3,1,1,2,4],condition:'3 present; 5 and 6 absent'},
  both35:{values:[3,5,1,2,4],condition:'3 and 5 present; 6 absent'},
  all356:{values:[3,5,6,1,2],condition:'3, 5 and 6 present'},
  only6:{values:[6,1,1,2,4],condition:'6 present; 3 and 5 absent'},
};
function effectiveAddition(a,state) {
  const def=ARTIFACTS[a.kind];
  if(a.kind!=='prism')return def.value;
  return def.value*getBoardCells(state).find(c=>c.x===a.x&&c.y===a.y).pieceIds.length;
}
function measure(fixture) {
  const validation=validateFixture(fixture),state=createGame(1);
  state.rulesVersion=3; // Preserve the archived coin-source comparison under its original rules.
  state.pieces=structuredClone(fixture.pieces);state.artifacts=structuredClone(fixture.artifacts);
  const initial=structuredClone(state),addition=new Map(state.artifacts.map(a=>[a.id,effectiveAddition(a,state)]));
  const expectedCountsNumerator={},expectedAddNumerator={};let scoreNumerator=0;
  for(const histogram of histograms.values()) {
    const resolution=previewSubmission(state,histogram.values);
    assert.equal(resolution.multiplier,1);
    let score=0;
    for(const [id,count] of Object.entries(resolution.counts)) {
      const contribution=count*addition.get(id);score+=contribution;
      expectedCountsNumerator[id]=(expectedCountsNumerator[id]||0)+count*histogram.weight;
      expectedAddNumerator[id]=(expectedAddNumerator[id]||0)+contribution*histogram.weight;
    }
    assert.equal(resolution.score,score,'Contribution totals must equal the engine result.');
    scoreNumerator+=resolution.score*histogram.weight;
  }
  const hands=Object.fromEntries(Object.entries(conditionalHands).map(([id,hand])=>{
    const resolution=previewSubmission(state,hand.values);
    return [id,{...hand,score:resolution.score,counts:resolution.counts,chains:resolution.chains.map(c=>({rootId:c.rootId,repeat:c.repeat,steps:c.steps}))}];
  }));
  assert.deepEqual(state,initial,'Exact previews must not modify the fixture.');
  const artifactShopCost=state.artifacts.reduce((n,a)=>n+ARTIFACTS[a.kind].price,0);
  const pieceReplacementCost=state.pieces.reduce((n,p)=>n+CONFIG.pieceBasePrice+p.cells.length*CONFIG.pieceCellPrice,0);
  return {
    ...fixture,validation,artifactShopCost,pieceReplacementCost,
    alreadyInvestedUpgradeCharges:state.pieces.reduce((n,p)=>n+p.level-1,0),
    expectedScore:{numerator:scoreNumerator,denominator:7776,value:scoreNumerator/7776},
    expectedCounts:Object.fromEntries(state.artifacts.map(a=>[a.id,{numerator:expectedCountsNumerator[a.id]||0,denominator:7776,value:(expectedCountsNumerator[a.id]||0)/7776}])),
    expectedAdditiveContributions:Object.fromEntries(state.artifacts.map(a=>[a.id,{perReaction:addition.get(a.id),numerator:expectedAddNumerator[a.id]||0,denominator:7776,value:(expectedAddNumerator[a.id]||0)/7776}])),
    conditionalHands:hands,
  };
}
const results=fixtures.map(measure);
const report={
  title:'Conduit and prism controlled role diagnostics',rulesVersion:3,
  priceComparison:'All quoted comparison prices are artifactShopCost: artifact purchase prices only, excluding pieces and prior upgrades. pieceReplacementCost is reported separately.',
  method:{dice:5,facesPerDie:[1,2,3,4,5,6],physicalOutcomes:7776,countHistograms:252,exactEnumeration:true,rerolls:false,humanPlay:false,autoplayRun:false},
  limitations:[
    'These are deliberately constructed legal connected placements, not claims that a policy acquires them by a particular week.',
    'One full fair roll is enumerated. There is no reroll policy, held dice, visitor tip, run economy, shop sequence, or ongoing research.',
    'Every piece matches an actual offered shape and every level is at most the current cap. Level 2 is pre-invested; charge counts are recorded rather than treated as free upgrades.',
    'The comparison contains no multiplier or static-support artifact. All expected-score numerators are exact integer sums over the 7776 physical outcomes.',
    'Artifact prices and piece replacement costs are shown. Alternatives are not equal-spend comparisons; free rewards and actual acquisition costs are not modeled.',
    'Overlap depth 1 to 2 adds an actual face-5 domino and its condition. The new unused cell and future placement benefits are outside the score metric.',
    'Both favorable and unfavorable coin alternatives are retained. A useful relay role does not establish global balance or human enjoyment.',
  ],
  config:{maxPieceLevel:CONFIG.maxPieceLevel,coin:{value:ARTIFACTS.coin.value,price:ARTIFACTS.coin.price},conduit:{value:ARTIFACTS.conduit.value,price:ARTIFACTS.conduit.price},prism:{valuePerPiece:ARTIFACTS.prism.value,price:ARTIFACTS.prism.price}},
  results,
};
const output=JSON.stringify(report,null,2)+'\n',outIndex=process.argv.indexOf('--out');
if(outIndex>=0) {
  if(!process.argv[outIndex+1])throw new Error('--out requires a destination');
  fs.writeFileSync(process.argv[outIndex+1],output,'utf8');
} else process.stdout.write(output);
