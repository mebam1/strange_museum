/** Exact, bounded spatial counterfactuals. These are not full-run or human-play evidence. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import * as engine from './dist/engine.js';

const key=(x,y)=>`${x},${y}`;
const signature=cells=>cells.map(c=>key(c.x,c.y)).sort().join(';');
const clone=state=>structuredClone(state);
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
const sum=values=>values.reduce((a,b)=>a+b,0);
const sourceHashes=Object.fromEntries(['dist/engine.js','dist/catalog.js'].map(file=>[file,
  createHash('sha256').update(fs.readFileSync(new URL(file,import.meta.url))).digest('hex')]));

/** Integer weights over actual physical faces, including nonidentical edited dice. */
export function physicalHistograms(dice) {
  let rows=new Map([['000000',{counts:[0,0,0,0,0,0],weight:1}]]),total=1;
  for(const die of dice) {
    const faces=die.faces??die;
    total*=faces.length;
    const next=new Map();
    for(const row of rows.values())for(const face of faces) {
      const counts=[...row.counts];counts[face-1]++;
      const k=counts.join(',');
      const entry=next.get(k)??{counts,weight:0};entry.weight+=row.weight;next.set(k,entry);
    }
    rows=next;
  }
  assert.equal(sum([...rows.values()].map(row=>row.weight)),total);
  return {total,rows:[...rows.values()].map(row=>({...row,values:row.counts.flatMap((n,i)=>Array(n).fill(i+1))}))};
}

export function exactOneRoll(state,distribution=physicalHistograms(state.dice)) {
  let score=0,chains=0,zero=0,bonus=0;
  const counts={};
  for(const row of distribution.rows) {
    const result=engine.previewSubmission(state,row.values);
    score+=result.score*row.weight;chains+=result.chainCount*row.weight;
    if(result.score===0)zero+=row.weight;
    if(Object.values(result.conditionBonuses??{}).some(Boolean))bonus+=row.weight;
    for(const [id,n] of Object.entries(result.counts))counts[id]=(counts[id]??0)+n*row.weight;
  }
  return {expectedScore:score/distribution.total,expectedChains:chains/distribution.total,
    zeroScoreProbability:zero/distribution.total,anyConditionalBonusProbability:bonus/distribution.total,
    expectedCounts:Object.fromEntries(Object.entries(counts).map(([id,n])=>[id,n/distribution.total])),
    physicalOutcomes:distribution.total,histograms:distribution.rows.length};
}

export function legalPlacements(state,offer,category) {
  const board=engine.getBoardCells(state),boardSet=new Set(board.map(c=>key(c.x,c.y)));
  const local=category==='piece'?offer.cells:engine.getArtifactDefinition(offer,state).cells;
  const seen=new Set(),placements=[];
  for(let rotation=0;rotation<4;rotation++) {
    const shape=engine.rotatedCells(local,rotation),anchors=new Map();
    for(const b of board)for(const s of shape) {
      const points=category==='piece'?[b,...DIRS.map(([dx,dy])=>({x:b.x+dx,y:b.y+dy}))]:[b];
      for(const point of points)anchors.set(key(point.x-s.x,point.y-s.y),{x:point.x-s.x,y:point.y-s.y});
    }
    for(const {x,y} of anchors.values()) {
      const check=category==='piece'?engine.legalPiecePlacement:engine.legalArtifactPlacement;
      if(!check(state,offer,x,y,rotation))continue;
      const cells=shape.map(c=>({x:c.x+x,y:c.y+y})),sig=signature(cells);
      if(seen.has(sig))continue;seen.add(sig);
      const overlap=cells.filter(c=>boardSet.has(key(c.x,c.y))).length;
      placements.push({x,y,rotation,cells,overlapCells:overlap,newCells:cells.length-overlap});
    }
  }
  return placements.sort((a,b)=>a.y-b.y||a.x-b.x||a.rotation-b.rotation);
}

function addPiece(state,offer,placement) {
  const after=clone(state);
  after.pieces.push({id:'spatial-new-piece',face:offer.face,level:1,cells:clone(placement.cells)});
  return after;
}

function addRelic(state,offer,placement,index) {
  const after=clone(state);
  after.artifacts.push({id:`spatial-new-artifact-${index}`,kind:offer.kind,x:placement.x,y:placement.y,
    rotation:placement.rotation,...(offer.kind==='brush'?{charges:offer.charges??engine.CONFIG.brushCharges}:{})});
  return after;
}

/** Existing relics stay fixed; choose at most one identical offered relic after the piece. */
export function comparePieceChoice(state,pieceOffer,{incomingArtifacts=[],maxPlacements=Infinity}={}) {
  assert(!state.pieces.some(p=>p.id==='spatial-new-piece'));
  const before=JSON.stringify(state),distribution=physicalHistograms(state.dice);
  const allPlacements=legalPlacements(state,pieceOffer,'piece');
  // A caller may bound a large captured state; never hide that selection in the report.
  const placements=allPlacements.slice(0,maxPlacements),rows=[];
  const tileSources=state.artifacts.filter(a=>engine.getArtifactDefinition(a,state).trigger==='tile')
    .map(a=>({id:a.id,cells:engine.getArtifactFootprint(state,a)}));
  let evaluatedLayouts=0;
  for(const placement of placements) {
    const after=addPiece(state,pieceOffer,placement),fixed=exactOneRoll(after,distribution);
    evaluatedLayouts++;
    let best={...fixed,incoming:null},legalIncoming=0;
    const incomingCandidates=[];
    for(const [index,offer] of incomingArtifacts.entries())for(const relicPlacement of legalPlacements(after,offer,'artifact')) {
      legalIncoming++;evaluatedLayouts++;
      const measured=exactOneRoll(addRelic(after,offer,relicPlacement,index),distribution);
      incomingCandidates.push({kind:offer.kind,index,x:relicPlacement.x,y:relicPlacement.y,rotation:relicPlacement.rotation,expectedScore:measured.expectedScore});
      if(measured.expectedScore>best.expectedScore+1e-10)best={...measured,incoming:{kind:offer.kind,index,x:relicPlacement.x,y:relicPlacement.y,rotation:relicPlacement.rotation}};
    }
    const placedKeys=new Set(placement.cells.map(c=>key(c.x,c.y)));
    rows.push({x:placement.x,y:placement.y,rotation:placement.rotation,cells:clone(placement.cells),overlapCells:placement.overlapCells,
      overlappedTileSourceIds:tileSources.filter(a=>a.cells.some(c=>placedKeys.has(key(c.x,c.y)))).map(a=>a.id),
      newCells:placement.newCells,fixedInventory:fixed,withOneIncoming:best,legalIncomingPlacements:legalIncoming,incomingCandidates});
  }
  const best=(mode,regime)=>rows.filter(row=>mode==='overlap'?row.overlapCells>0:row.overlapCells===0)
    .reduce((winner,row)=>!winner||row[regime].expectedScore>winner[regime].expectedScore+1e-10?row:winner,null);
  const bestSourceOverlap=regime=>rows.filter(row=>row.overlappedTileSourceIds.length)
    .reduce((winner,row)=>!winner||row[regime].expectedScore>winner[regime].expectedScore+1e-10?row:winner,null);
  assert.equal(JSON.stringify(state),before,'Counterfactual evaluation must not change the supplied state.');
  return {rulesVersion:state.rulesVersion,before:exactOneRoll(state,distribution),
    initialBoardCells:engine.getBoardCells(state).length,initialArtifactCells:sum(state.artifacts.map(a=>engine.getArtifactFootprint(state,a).length)),
    pieceOffer:clone(pieceOffer),incomingArtifacts:clone(incomingArtifacts),
    totalLegalPiecePlacements:allPlacements.length,evaluatedPiecePlacements:rows.length,evaluatedLayouts,
    exhaustive:rows.length===allPlacements.length,
    selectionWhenCapped:'Stable reading order (y, x, rotation), not an optimization or random sample.',
    bestFixed:{overlap:best('overlap','fixedInventory'),expand:best('expand','fixedInventory')},
    bestWithIncoming:{overlap:best('overlap','withOneIncoming'),expand:best('expand','withOneIncoming')},
    bestSourceOverlap:{fixedInventory:bestSourceOverlap('fixedInventory'),withOneIncoming:bestSourceOverlap('withOneIncoming')},
    candidates:rows};
}

function artifact(kind,id,x,y,rotation=0){return {kind,id,x,y,rotation};}
function rectangleState(sourceKind='long_mirror',edited=false) {
  const state=engine.createGame(901);
  state.pieces[0].level=2;
  state.artifacts=sourceKind==='long_mirror'
    ?[artifact('long_mirror','source',0,0),artifact('conduit','r1',2,0),artifact('conduit','r2',0,1),artifact('conduit','r3',1,1),artifact('conduit','r4',2,1)]
    :[artifact('mirror','source',0,0),artifact('conduit','r0',1,0),artifact('conduit','r1',2,0),artifact('conduit','r2',0,1),artifact('conduit','r3',1,1),artifact('conduit','r4',2,1)];
  if(edited)for(const die of state.dice)die.faces=[1,1,1,2,2,6];
  return state;
}

export function validateGeometry(state) {
  const partial={...state,pieces:[],artifacts:[]};
  const start=engine.createGame(1).pieces[0].cells;
  for(const [index,p] of state.pieces.entries()) {
    assert(p.level>=1&&p.level<=engine.CONFIG.maxPieceLevel);
    const normalized=engine.rotatedCells(p.cells,0),sig=signature(normalized);
    const shapes=index===0?[...engine.SHAPES,{id:'starting-rectangle',cells:start}]:engine.SHAPES;
    assert(shapes.some(s=>[0,1,2,3].some(r=>signature(engine.rotatedCells(s.cells,r))===sig)),`Unavailable shape ${p.id}`);
    const x=Math.min(...p.cells.map(c=>c.x)),y=Math.min(...p.cells.map(c=>c.y));
    assert(engine.legalPiecePlacement(partial,{face:p.face,cells:normalized},x,y),`Disconnected piece ${p.id}`);
    partial.pieces.push(clone(p));
  }
  for(const a of state.artifacts) {
    assert(!a.cells,'Only actual catalog footprints are allowed in diagnostics.');
    assert(engine.legalArtifactPlacement(partial,a,a.x,a.y,a.rotation),`Illegal relic ${a.id}`);
    partial.artifacts.push(clone(a));
  }
  return true;
}

function mirrorComparisons() {
  const examples=[];
  // Both two-cell floor pieces are actual D2 shapes, joined end to end.
  for(const differentFaces of [false,true]) {
    const state=engine.createGame(902);
    // Retain the mandatory starting floor, with this comparison bridge just above it.
    state.pieces=[state.pieces[0],{id:'left',face:1,level:2,cells:[{x:-1,y:-1},{x:0,y:-1}]},
      {id:'right',face:differentFaces?2:1,level:2,cells:[{x:1,y:-1},{x:2,y:-1}]}];
    const receivers=[artifact('coin','left-receiver',-1,0),artifact('coin','right-receiver',2,0)];
    const variants=[
      {name:'one_large_bridge',sources:[artifact('long_mirror','large',0,0)]},
      {name:'two_small_sources',sources:[artifact('mirror','small-left',0,0),artifact('mirror','small-right',1,0)]},
      {name:'small_source_and_receiver_left',sources:[artifact('mirror','small-left',0,0),artifact('conduit','extra-receiver',1,0)]},
      {name:'small_source_and_receiver_right',sources:[artifact('conduit','extra-receiver',0,0),artifact('mirror','small-right',1,0)]},
      {name:'small_source_and_coin_left',sources:[artifact('mirror','small-left',0,0),artifact('coin','extra-receiver',1,0)]},
      {name:'small_source_and_coin_right',sources:[artifact('coin','extra-receiver',0,0),artifact('mirror','small-right',1,0)]},
    ];
    const results=variants.map(variant=>{
      const current={...state,artifacts:[...variant.sources,...receivers].map(a=>({...a,y:a.y-1}))};validateGeometry(current);
      const sources=variant.sources.filter(a=>engine.ARTIFACTS[a.kind].effect==='multiply');
      return {name:variant.name,sourceArea:sum(sources.map(a=>engine.ARTIFACTS[a.kind].cells.length)),
        sourcePurchaseCost:sum(sources.map(a=>engine.ARTIFACTS[a.kind].price)),
        comparisonArea:2,comparisonPurchaseCost:sum(variant.sources.map(a=>engine.ARTIFACTS[a.kind].price)),
        state:{pieces:current.pieces,artifacts:current.artifacts,diceFaces:current.dice.map(d=>d.faces)},...exactOneRoll(current)};
    });
    examples.push({id:differentFaces?'bridge_different_conditions':'bridge_same_condition',results});
  }
  // A single connected receiver network lets both small sources reach all four receivers.
  for(const distinctCoverage of [false,true]) {
  const state=rectangleState();
  if(distinctCoverage)state.pieces.push({id:'second-condition',face:2,level:1,cells:[{x:1,y:0},{x:2,y:0}]});
  const variants=[{name:'one_large_shared_network',artifacts:state.artifacts},
    {name:'two_small_shared_network',artifacts:[artifact('mirror','small-left',0,0),artifact('mirror','small-right',1,0),...state.artifacts.slice(1)]},
    {name:'small_source_and_receiver_left',artifacts:[artifact('mirror','small-left',0,0),artifact('conduit','extra-receiver',1,0),...state.artifacts.slice(1)]},
    {name:'small_source_and_receiver_right',artifacts:[artifact('conduit','extra-receiver',0,0),artifact('mirror','small-right',1,0),...state.artifacts.slice(1)]},
    {name:'small_source_and_coin_left',artifacts:[artifact('mirror','small-left',0,0),artifact('coin','extra-receiver',1,0),...state.artifacts.slice(1)]},
    {name:'small_source_and_coin_right',artifacts:[artifact('coin','extra-receiver',0,0),artifact('mirror','small-right',1,0),...state.artifacts.slice(1)]}];
  examples.push({id:distinctCoverage?'shared_receiver_network_distinct_coverage':'shared_receiver_network',results:variants.map(variant=>{
    const current={...state,artifacts:variant.artifacts};validateGeometry(current);
    const sources=current.artifacts.filter(a=>engine.ARTIFACTS[a.kind].effect==='multiply');
    return {name:variant.name,sourceArea:sum(sources.map(a=>engine.ARTIFACTS[a.kind].cells.length)),
      sourcePurchaseCost:sum(sources.map(a=>engine.ARTIFACTS[a.kind].price)),
      comparisonArea:2,comparisonPurchaseCost:sum(current.artifacts.filter(a=>a.y===0&&a.x<2).map(a=>engine.ARTIFACTS[a.kind].price)),
      state:{pieces:current.pieces,artifacts:current.artifacts,diceFaces:current.dice.map(d=>d.faces)},...exactOneRoll(current)};
  })});
  }
  return examples;
}

function controlledReportBody() {
  const domino=engine.SHAPES.find(s=>s.id==='D2');
  const scenarios=[
    {id:'wide_source_new_condition_one_receiver',source:'long_mirror',face:2,stock:'conduit',edited:false},
    {id:'wide_source_new_condition_large_stock',source:'long_mirror',face:2,stock:'long_mirror',edited:false},
    {id:'small_source_duplicate_condition_fair',source:'mirror',face:1,stock:'conduit',edited:false},
    {id:'small_source_duplicate_condition_edited',source:'mirror',face:1,stock:'conduit',edited:true},
  ];
  const results=scenarios.map(spec=>{
    const state=rectangleState(spec.source,spec.edited);validateGeometry(state);
    return {...spec,state:{pieces:state.pieces,artifacts:state.artifacts,diceFaces:state.dice.map(d=>d.faces)},
      comparison:comparePieceChoice(state,{shape:'D2',face:spec.face,cells:domino.cells}, {incomingArtifacts:[{kind:spec.stock}]})};
  });
  return {title:'Exact spatial counterfactuals',rulesVersion:engine.createGame(1).rulesVersion,
    sourceHashes:clone(sourceHashes),
    method:{exact:true,rerolls:false,submittedRolls:1,existingRelicsFixed:true,
      diceState:'Fresh independent roll from each actual die face array; current displayed values and held flags are not conditioned.',
      incomingRelicEntitlement:'At most one free relic from the identical declared stock, or decline.',
      futureSpaceValue:'New cells are recorded separately; no invented score is assigned to future offers.',
      layoutReachability:'Mandatory starting floor retained, geometry and Lv1–2 validated; controlled inventories are constructed, not claimed to arise in a particular run.'},
    limitations:['One-roll comparisons do not estimate an entire visitor or run. Rerolls, later gifts, upgrades and money choices are not optimized.',
      'Fixed-inventory pure expansion cannot improve immediate score; the one-incoming regime explicitly gives expansion a usable new relic.',
      'Existing relics are fixed in both alternatives; repositioning and sales are not searched.',
      'Large versus two-small or small-plus-receiver comparisons have equal footprint but different purchase costs and acquisition counts, shown explicitly. They do not establish equal-budget global dominance.',
      `Edited-dice scenes pre-invest twenty changed faces (cost ${20*engine.CONFIG.editDieCost}); both paired alternatives use the same dice.`],
    config:clone(engine.CONFIG),artifactBalance:clone(engine.ARTIFACTS),pieceCases:results,mirrorCases:mirrorComparisons()};
}

/** Diagnostic override is process-local, restored even on error; production files are never changed. */
export function controlledReport({conditionalValue=null}={}) {
  const original=engine.ARTIFACTS.long_mirror.conditionalValue;
  try {
    if(conditionalValue!==null)engine.ARTIFACTS.long_mirror.conditionalValue=conditionalValue;
    const report=controlledReportBody();
    report.diagnosticOverrides=conditionalValue===null?{}:{long_mirror:{conditionalValue}};
    return report;
  } finally {engine.ARTIFACTS.long_mirror.conditionalValue=original;}
}

/** Predeclared real-run snapshot selection; no future state or result-dependent case search. */
export function reachedReport(input,{weeks=[1,3,5,7],pieceIndex=0,cachedReport=null}={}) {
  const originalArtifacts=clone(engine.ARTIFACTS),originalConfig=clone(engine.CONFIG);
  try {
    // Recreate the captured public rules, not whichever training candidate is currently in the files.
    for(const [kind,definition] of Object.entries(input.artifactBalance))Object.assign(engine.ARTIFACTS[kind],clone(definition));
    Object.assign(engine.CONFIG,clone(input.config));
    const reuseCompatible=cachedReport?.sourceHashes?.['dist/engine.js']===sourceHashes['dist/engine.js']
      &&JSON.stringify(cachedReport?.capturedRules?.config)===JSON.stringify(input.config)
      &&JSON.stringify(cachedReport?.capturedRules?.artifactBalance)===JSON.stringify(input.artifactBalance);
    const runs=input.runs.filter(run=>run.policy==='balanced'&&(run.placementMode??input.placementMode)==='adaptive').sort((a,b)=>a.sampleId-b.sampleId);
    const actualChoices=runs.flatMap(run=>(run.pieceDecisions??[]).filter(decision=>decision.beforeState).map(decision=>{
      const state=decision.beforeState,placed=new Set((decision.choice?.cells??[]).map(c=>key(c.x,c.y)));
      const sources=state.artifacts.filter(a=>engine.getArtifactDefinition(a,state).trigger==='tile'&&engine.getArtifactFootprint(state,a).some(c=>placed.has(key(c.x,c.y))));
      return {sampleId:run.sampleId,week:decision.week,outcome:decision.outcome,
        overlapCells:decision.choice?.overlapCells??0,newCells:(decision.choice?.cells?.length??0)-(decision.choice?.overlapCells??0),
        overlappedSourceIds:sources.map(a=>a.id),overlappedSourceKinds:sources.map(a=>a.kind)};
    }));
    const actualOverlapSummary={runs:runs.length,decisions:actualChoices.length,
      acquired:actualChoices.filter(c=>c.outcome==='acquired').length,
      genericOverlap:actualChoices.filter(c=>c.overlapCells>0).length,
      tileSourceOverlap:actualChoices.filter(c=>c.overlappedSourceIds.length>0).length,
      mirrorSourceOverlap:actualChoices.filter(c=>c.overlappedSourceKinds.some(k=>k==='mirror'||k==='long_mirror')).length,
      brushSourceOverlap:actualChoices.filter(c=>c.overlappedSourceKinds.includes('brush')).length,
      overlapWithoutTileSource:actualChoices.filter(c=>c.overlapCells>0&&!c.overlappedSourceIds.length).length};
    const cases=weeks.map(week=>{
      const run=runs.find(r=>r.pieceDecisions?.some(d=>d.week===week&&d.beforeState));
      if(!run)return {week,missing:true,reason:'No matching reached reward state in the specified training input.'};
      const decision=run.pieceDecisions.find(d=>d.week===week&&d.beforeState),snapshot=decision.beforeState;
      const state={...engine.createGame(900001),...clone(snapshot)};
      assert.equal(state.rulesVersion,5,'Reached-state diagnostics require v5 snapshots.');
      validateGeometry(state);
      const offer=snapshot.freePieces?.[pieceIndex]??snapshot.shop?.freePieces?.[pieceIndex];
      const incoming=snapshot.freeArtifacts??snapshot.shop?.freeArtifacts??[];
      assert(offer,`Missing predeclared offered piece ${pieceIndex}`);
      const cached=reuseCompatible&&cachedReport.cases.find(c=>c.week===week&&c.sampleId===run.sampleId&&c.pieceIndex===pieceIndex
        &&JSON.stringify(c.snapshot)===JSON.stringify(snapshot));
      return {week,sampleId:run.sampleId,seed:run.seed,pieceIndex,policyChoice:decision.choice??null,snapshot:clone(snapshot),
        reusedFromInput:cached?clone(cachedReport.input??null):null,
        comparison:cached?clone(cached.comparison):comparePieceChoice(state,offer,{incomingArtifacts:incoming})};
    });
    return {title:'Exact paired choices on predeclared reached states',rulesVersion:5,
      selection:{policy:'balanced',placementMode:'adaptive',weeks,sampleOrder:'Ascending sampleId; first run reaching each requested reward state.',pieceIndex},
      method:{exact:true,rerolls:false,submittedRolls:1,existingRelicsFixed:true,
        diceState:'Fresh independent roll from each actual die face array; current displayed values and held flags are not conditioned.',
        incomingRelicEntitlement:'At most one of the identical captured free-artifact 3-choice offers, or decline.',
        reconstructedRng:'Fixed independent seed for engine upgrade ties; RNG never used to sample future dice. Every physical face result is enumerated.'},
      limitations:['This isolates the immediate score of piece placement and one optional free relic. It excludes later rewards, money spending, repositioning and replacements.',
        'A fixed-inventory expansion has capacity value but cannot improve immediate score without a new relic; both regimes are reported separately.',
        'Brush future upgrade value is not converted into current score. Upgrade ties use the same fixed independent seed, not a marginal average over every tie outcome. These comparisons are not a full policy or optimal-run estimate.'],
      sourceHashes:clone(sourceHashes),
      capturedRules:{config:clone(input.config),artifactBalance:clone(input.artifactBalance),policyVersion:input.policyVersion},
      actualOverlapSummary,actualChoices,cases};
  } finally {
    for(const [kind,definition] of Object.entries(originalArtifacts))Object.assign(engine.ARTIFACTS[kind],definition);
    Object.assign(engine.CONFIG,originalConfig);
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2),outIndex=args.indexOf('--out');
  const valueIndex=args.indexOf('--conditional-value'),inputIndex=args.indexOf('--reached'),reuseIndex=args.indexOf('--reuse');
  const inputPath=inputIndex<0?null:args[inputIndex+1];
  const cachedReport=reuseIndex<0?null:JSON.parse(fs.readFileSync(args[reuseIndex+1],'utf8'));
  const report=inputPath?reachedReport(JSON.parse(fs.readFileSync(inputPath,'utf8')),{cachedReport}):controlledReport({conditionalValue:valueIndex<0?null:Number(args[valueIndex+1])});
  if(inputPath)report.input={path:inputPath,sha256:createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex')};
  const output=JSON.stringify(report,null,2)+'\n';
  if(outIndex>=0)fs.writeFileSync(args[outIndex+1],output,'utf8');else process.stdout.write(output);
}
