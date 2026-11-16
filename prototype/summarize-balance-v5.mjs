import fs from 'node:fs';
import assert from 'node:assert/strict';
import {getArtifactFootprint} from './dist/engine.js';

const files=['adaptive','expand','overlap'].map(mode=>`balance-v5-validation-${mode}.json`);
const documents=files.map(file=>JSON.parse(fs.readFileSync(new URL(file,import.meta.url),'utf8')));
const reference=documents[0];
for(const doc of documents) {
  assert.deepEqual(doc.sourceHashes,reference.sourceHashes,'Validation sources must stay frozen.');
  assert.deepEqual(doc.artifactBalance,reference.artifactBalance);
  assert.deepEqual(doc.config,reference.config);
  assert.deepEqual(doc.seedRange,[10000,10059]);
  assert(doc.runs.every(run=>run.rulesVersion===5&&run.errors.length===0));
}
const sum=values=>values.reduce((a,b)=>a+b,0);
const mean=values=>values.length?sum(values)/values.length:0;
const key=cell=>`${cell.x},${cell.y}`;
function wilson(wins,total) {
  const z=1.959963984540054,p=wins/total,d=1+z*z/total;
  const center=(p+z*z/(2*total))/d,radius=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/d;
  return [Math.max(0,center-radius),Math.min(1,center+radius)];
}
const arms=[];
for(const doc of documents)for(const original of doc.summaries) {
  const runs=doc.runs.filter(r=>r.policy===original.policy);
  assert.equal(runs.length,60);
  const decisions=runs.flatMap(r=>r.pieceDecisions).filter(d=>d.choice);
  const sourceOverlaps=decisions.filter(d=>{
    const added=new Set(d.choice.cells.map(key));
    return d.beforeState.artifacts.some(a=>doc.artifactBalance[a.kind].effect==='multiply'&&getArtifactFootprint(d.beforeState,a).some(c=>added.has(key(c))));
  });
  const starts=runs.flatMap(r=>r.shopSnapshots.filter(s=>s.stage==='before'));
  const free=starts.map(s=>s.freeDecision).filter(Boolean);
  const byWeek=Array.from({length:8},(_,i)=>{
    const week=i+1,snapshots=runs.flatMap(r=>r.evaluatorSnapshots.filter(s=>s.week===week));
    const shops=starts.filter(s=>s.week===week);
    return {week,reached:snapshots.length,meanOccupancy:mean(snapshots.map(s=>s.occupancy)),
      fullBoards:snapshots.filter(s=>s.emptyCells===0).length,
      meanEmptyCells:mean(snapshots.map(s=>s.emptyCells)),meanMoney:mean(snapshots.map(s=>s.money)),
      shops:shops.length,freeNoneFit:shops.filter(s=>s.freeDecision&&!s.freeDecision.offers.some(o=>o.fits)).length};
  });
  arms.push({...original,clearRateWilson95:wilson(original.wins,runs.length),
    decisionCounts:{pieces:decisions.length,expansion:decisions.filter(d=>d.choice.overlapCells===0).length,
      mixed:decisions.filter(d=>d.choice.overlapCells>0&&d.choice.overlapCells<d.choice.cells.length).length,
      fullOverlap:decisions.filter(d=>d.choice.overlapCells===d.choice.cells.length).length,
      sourceOverlap:sourceOverlaps.length,sourceOverlapImmediateGain:sourceOverlaps.filter(d=>d.choice.scoreMarginal>1e-8).length},
    freeChoicePressure:{decisions:free.length,noneFit:free.filter(d=>!d.offers.some(o=>o.fits)).length,
      replaced:free.filter(d=>d.outcome==='replaced').length,
      rejectedForSpace:free.filter(d=>d.outcome==='rejected'&&d.reason==='space').length,
      rejectedForValue:free.filter(d=>d.outcome==='rejected'&&d.reason==='lowValue').length},
    byWeek,
  });
}
assert.equal(sum(arms.map(a=>a.samples)),300);
const result={rulesVersion:5,files,policyVersion:reference.policyVersion,sourceHashes:reference.sourceHashes,
  config:reference.config,artifactBalance:reference.artifactBalance,
  note:'Wilson intervals describe binomial sampling uncertainty for these policies, not human skill. Same-seed arms diverge in future RNG consumption. Source overlap means covering a multiplier footprint; immediateGain uses the decision-time exact dice expectation.',
  arms};
fs.writeFileSync(new URL('balance-v5-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
for(const arm of arms)console.log(`${arm.policy}/${arm.placementMode}: ${arm.wins}/${arm.samples}, source overlaps ${arm.decisionCounts.sourceOverlap}, no-fit gifts ${arm.freeChoicePressure.noneFit}/${arm.freeChoicePressure.decisions}`);
