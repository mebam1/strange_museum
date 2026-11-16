/** Historical uncapped-level diagnostic, not current v4 balance or a player run. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {ARTIFACTS,CONFIG,createGame,previewSubmission} from './dist/engine.js';

const fair=[1,2,3,4,5,6];
const scenarios=[
  {id:'fair',name:'공정한 주사위 5개',dice:Array.from({length:5},()=>fair.slice())},
  {id:'one_guaranteed_one',name:'주사위 하나의 모든 면을 1로 개조',dice:[[1,1,1,1,1,1],...Array.from({length:4},()=>fair.slice())]},
  {id:'all_half_one',name:'모든 주사위에 1을 세 면씩 배정',dice:Array.from({length:5},()=>[1,2,3,4,1,1])},
  {id:'all_half_one_two',name:'모든 주사위를 1 세 면·2 세 면으로 개조',dice:Array.from({length:5},()=>[1,2,1,2,1,2])},
  {id:'all_one',name:'모든 주사위의 모든 면을 1로 개조',dice:Array.from({length:5},()=>[1,1,1,1,1,1])},
];
const plans=[
  {id:'young_single',requirement:[1],levels:[1],extraCharges:0},
  {id:'young_overlap_same',requirement:[1,1],levels:[1,1],extraCharges:0},
  {id:'young_overlap_different',requirement:[1,2],levels:[1,1],extraCharges:0},
  {id:'existing_level5',requirement:[1],levels:[5],extraCharges:0},
  {id:'existing5_new1_same',requirement:[1,1],levels:[5,1],extraCharges:0},
  {id:'existing5_new1_different',requirement:[1,2],levels:[5,1],extraCharges:0},
  {id:'equal_levels5_same',requirement:[1,1],levels:[5,5],extraCharges:4},
  {id:'equal_levels5_different',requirement:[1,2],levels:[5,5],extraCharges:4},
  {id:'same_four_charges_into_existing',requirement:[1],levels:[9],extraCharges:4},
];
function succeeds(counts,requirement) {
  const required=Array(7).fill(0);
  for(const face of requirement)required[face]++;
  return required.every((n,face)=>counts[face]>=n);
}
function enumerate(dice) {
  const hits={'1':0,'11':0,'12':0},counts=Array(7).fill(0);
  let total=0;
  function walk(i) {
    if(i===dice.length) {
      total++;
      for(const req of [[1],[1,1],[1,2]])if(succeeds(counts,req))hits[req.join('')]++;
      return;
    }
    for(const face of dice[i]){counts[face]++;walk(i+1);counts[face]--;}
  }
  walk(0);return {total,hits};
}
function verifyEnginePlan(plan) {
  const state=createGame(1),cells=[{x:0,y:0},{x:1,y:0}];
  state.rulesVersion=3; // Keep the historical tile-addition scoring contract explicit.
  state.pieces=plan.levels.map((level,i)=>({id:`p${i}`,face:plan.requirement[i],level,cells:structuredClone(cells)}));
  state.artifacts=[{id:'coin',kind:'coin',x:0,y:0,rotation:0},{id:'mirror',kind:'mirror',x:1,y:0,rotation:0}];
  const result=previewSubmission(state,[1,1,2,3,4]),count=plan.levels.reduce((a,b)=>a+b,0);
  assert.equal(result.counts.coin,count);
  assert.equal(result.counts.mirror,count);
  const expected=ARTIFACTS.coin.value*count*ARTIFACTS.mirror.value**count;
  assert(Math.abs(result.score-expected)<Math.max(1,expected)*1e-12);
  assert.equal(previewSubmission(state,[6,6,6,6,6]).score,0);
}
for(const plan of plans)verifyEnginePlan(plan);

const results=scenarios.map(scenario=>{
  const {total,hits}=enumerate(scenario.dice);
  const minimumFaceEdits=scenario.dice.reduce((n,die)=>n+die.filter((f,i)=>f!==fair[i]).length,0);
  const expectations=plans.map(plan=>{
    const successes=hits[plan.requirement.join('')],probability=successes/total;
    const activationCount=plan.levels.reduce((a,b)=>a+b,0);
    return {...plan,successes,outcomes:total,probability,activationCount,
      expectedActivations:probability*activationCount,
      expectedCoinAndMirrorScore:probability*ARTIFACTS.coin.value*activationCount*ARTIFACTS.mirror.value**activationCount,
    };
  });
  const byId=Object.fromEntries(expectations.map(x=>[x.id,x]));
  return {id:scenario.id,name:scenario.name,dice:scenario.dice,minimumFaceEdits,editCostAtCurrentPrice:minimumFaceEdits*CONFIG.editDieCost,expectations,
    comparisons:{
      initialSameOverExisting5:byId.existing5_new1_same.expectedActivations/byId.existing_level5.expectedActivations,
      initialDifferentOverExisting5:byId.existing5_new1_different.expectedActivations/byId.existing_level5.expectedActivations,
      equalGrowthSameOverSingleWithSameCharges:byId.equal_levels5_same.expectedActivations/byId.same_four_charges_into_existing.expectedActivations,
      equalGrowthDifferentOverSingleWithSameCharges:byId.equal_levels5_different.expectedActivations/byId.same_four_charges_into_existing.expectedActivations,
    },
  };
});
const report={
  title:'Controlled overlap expectations under prototype rules',
  method:'Exact enumeration of 6^5 physical face-index outcomes per dice set; no rerolls, policy, shop sequence, visitor strategy, human play, or empirical run claim.',
  controls:[
    'One cell activation count is the sum of levels when its fixed multiset requirement is contained in the roll; repeated sets give no extra reward.',
    'The optional coin+mirror diagnostic uses two adjacent cells with identical piece coverage, one coin and one mirror, without chains or static modifiers.',
    'Existing level 5 is a pre-existing state, not a free level-up claim. Growing the new level-1 piece to level 5 consumes four charges; the fair-charge control spends those same four charges on the original piece (level 9).',
    'Brush placement, proc probability and time to deliver upgrades are not modeled; only the exact number of charge-consuming upgrades is recorded.',
    'The added piece also changes museum geometry and can support other artifacts. Those benefits, along with extra space opportunity costs and free/paid acquisition, are intentionally outside the one-cell comparison.',
    'Edited sets are controlled extremes and their required face-edit expenditure is recorded; they are not claims that a policy could afford those edits at a particular week.',
  ],
  config:{mirror:ARTIFACTS.mirror.value,coin:ARTIFACTS.coin.value,brushCharges:CONFIG.brushCharges,editDieCost:CONFIG.editDieCost},
  engineFixturesVerified:plans.length,
  results,
};
const output=JSON.stringify(report,null,2)+'\n';
const outFlag=process.argv.indexOf('--out');
if(outFlag>=0){if(!process.argv[outFlag+1])throw new Error('--out requires a path');fs.writeFileSync(process.argv[outFlag+1],output,'utf8');}
else process.stdout.write(output);
