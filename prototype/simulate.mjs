#!/usr/bin/env node
/** Seeded, action-only automated players for the text prototype.
 * The policy RNG is separate from the game RNG. A policy may inspect the public
 * museum and make pure previews, but never modifies a live game's state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

export const POLICY_NAMES = ['casual', 'balanced', 'investor'];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (x, y) => `${x},${y}`;
const sum = values => values.reduce((total, value) => total + value, 0);
const mean = values => values.length ? sum(values) / values.length : 0;
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ value >>> 15, 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, 61 | mixed);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4294967296;
  };
}

/** Disperse small sample IDs before feeding xorshift32, whose first outputs for
 * small consecutive numeric seeds are strongly correlated. This is a bijective
 * uint32 mixer, so training and holdout ID ranges remain disjoint seed sets. */
export function experimentSeed(sampleId) {
  let mixed = (sampleId + 0x9e3779b9) >>> 0;
  mixed = Math.imul(mixed ^ mixed >>> 16, 0x21f0aaad);
  mixed = Math.imul(mixed ^ mixed >>> 15, 0x735a2d97);
  return (mixed ^ mixed >>> 15) >>> 0;
}

export function diceCounts(values) {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const face of values) counts[face - 1]++;
  return counts;
}

export function meetsRequirement(valuesOrCounts, requirement, areCounts = false) {
  const counts = areCounts ? valuesOrCounts : diceCounts(valuesOrCounts);
  return requirement.every((amount, index) => counts[index] >= amount);
}

export function rotateCells(cells, rotation = 0) {
  let rotated = cells.map(cell => Array.isArray(cell) ? {x: cell[0], y: cell[1]} : {x: cell.x, y: cell.y});
  for (let turn = 0; turn < ((rotation % 4) + 4) % 4; turn++) rotated = rotated.map(({x, y}) => ({x: -y, y: x}));
  const minX = Math.min(...rotated.map(cell => cell.x));
  const minY = Math.min(...rotated.map(cell => cell.y));
  return rotated.map(({x, y}) => ({x: x - minX, y: y - minY}));
}

/** Exact one-roll distribution, respecting each die's modified six faces. */
export function rollDistribution(dice) {
  let distribution = new Map([['000000', {counts: [0, 0, 0, 0, 0, 0], probability: 1}]]);
  for (const die of dice) {
    const next = new Map();
    const faces = die.faces ?? die;
    for (const {counts, probability} of distribution.values()) for (const face of faces) {
      const countsNext = [...counts];
      countsNext[face - 1]++;
      const countKey = countsNext.join('');
      const entry = next.get(countKey) ?? {counts: countsNext, probability: 0};
      entry.probability += probability / faces.length;
      next.set(countKey, entry);
    }
    distribution = next;
  }
  return [...distribution.values()];
}

function valuesFromCounts(counts) {
  return counts.flatMap((count, index) => Array(count).fill(index + 1));
}

function optionsFromArgs(argv) {
  const options = {seeds: 50, start: 1000, policies: [...POLICY_NAMES], split: 'training', out: null, trace: false};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--seeds') options.seeds = Number(argv[++index]);
    else if (arg === '--start') options.start = Number(argv[++index]);
    else if (arg === '--policies') options.policies = argv[++index].split(',');
    else if (arg === '--out') options.out = argv[++index];
    else if (arg === '--settings') options.settings = argv[++index];
    else if (arg === '--raw-seeds') options.rawSeeds = true;
    else if (arg === '--split') options.split = argv[++index];
    else if (arg === '--trace') options.trace = true;
    else if (arg === '--help') options.help = true;
    else if (arg === '--self-check') options.selfCheck = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.seeds) || options.seeds < 1 || options.seeds > 10000) throw new Error('--seeds must be an integer from 1 to 10000');
  if (!Number.isInteger(options.start) || options.start < 0) throw new Error('--start must be a nonnegative integer');
  for (const policy of options.policies) if (!POLICY_NAMES.includes(policy)) throw new Error(`Unknown policy: ${policy}`);
  return options;
}

export class AutomatedPlayer {
  constructor(engine, catalog, name, seed, {trace = false} = {}) {
    this.engine = engine;
    this.catalog = catalog;
    this.name = name;
    this.random = seededRandom(seed ^ 0xa18f39d5);
    this.traceEnabled = trace;
    this.actions = [];
    this.submissionRecords = [];
    this.metrics = {
      rerolls: 0, submissions: 0, purchases: 0, spent: 0, sales: 0,
      diceEdits: 0, freePieces: 0, freeArtifacts: 0, rejectedPieces: 0,
      rejectedArtifacts: 0, chargesConsumed: 0, strengthenedPieces: 0,
      overlapPlacements: 0, overlapCellsAdded: 0, saleRevenue: 0,
      artifactMoves: 0, brushMoves: 0, brushMovesToUnfinished: 0,
      prismOverlapPlacements: 0, acquiredByKind: {}, activationsByKind: {},
      additiveByKind: {}, errors: [],
    };
  }

  act(state, action) {
    const moneyBefore = state.money;
    const submissionNumber = action.type === 'SUBMIT' ? this.catalog.CONFIG.submissionsPerVisitor - state.visit.submissionsLeft + 1 : null;
    const kindsBefore = new Map(state.artifacts.map(artifact => [artifact.id, artifact.kind]));
    const addValuesBefore = action.type === 'SUBMIT' ? this.effectiveAdditiveValues(state) : null;
    const movedArtifact = action.type === 'MOVE_ARTIFACT' ? state.artifacts.find(artifact => artifact.id === action.artifactId) : null;
    const unfinishedAtDestination = movedArtifact?.kind === 'brush' ? this.engine.getArtifactFootprint(state, {...movedArtifact, x:action.x, y:action.y, rotation:action.rotation ?? movedArtifact.rotation}).some(point => this.board(state).some(cell => cell.x === point.x && cell.y === point.y && cell.pieceIds.some(id => state.pieces.some(piece => piece.id === id && piece.level < this.catalog.CONFIG.maxPieceLevel)))) : false;
    const result = this.engine.action(state, action);
    this._analysis = null;
    if (result === false || result?.ok === false) {
      const message = result?.error ?? 'action rejected';
      this.metrics.errors.push({action, message});
      throw new Error(`${this.name}: ${action.type}: ${message}`);
    }
    if (this.traceEnabled) this.actions.push({...action, week: state.week, visitor: state.visitor});
    if (['PLACE_ARTIFACT', 'PLACE_PIECE', 'EDIT_DIE'].includes(action.type) && moneyBefore > state.money) this.metrics.spent += moneyBefore - state.money;
    if (action.type === 'REROLL') this.metrics.rerolls++;
    if (action.type === 'EDIT_DIE') this.metrics.diceEdits++;
    if (action.type === 'EDIT_DIE' && this.currentDistribution) this.currentDistribution = rollDistribution(state.dice);
    if (action.type === 'SELL') { this.metrics.sales++; this.metrics.saleRevenue += state.money - moneyBefore; }
    if (movedArtifact) {
      this.metrics.artifactMoves++;
      if (movedArtifact.kind === 'brush') {
        this.metrics.brushMoves++;
        if (unfinishedAtDestination) this.metrics.brushMovesToUnfinished++;
      }
    }
    if (action.type === 'SUBMIT') {
      this.metrics.submissions++;
      const resolution = result?.resolution ?? state.visit?.results?.at(-1);
      const upgrades = resolution?.upgrades ?? [];
      this.metrics.chargesConsumed += upgrades.length;
      this.metrics.strengthenedPieces += upgrades.length;
      for (const [id, count] of Object.entries(resolution?.counts ?? {})) {
        const kind = kindsBefore.get(id);
        if (kind) this.metrics.activationsByKind[kind] = (this.metrics.activationsByKind[kind] ?? 0) + count;
        if (kind && addValuesBefore.has(id)) this.metrics.additiveByKind[kind] = (this.metrics.additiveByKind[kind] ?? 0) + addValuesBefore.get(id) * count;
      }
      const attributed = sum(Object.entries(resolution?.counts ?? {}).map(([id, count]) => (addValuesBefore.get(id) ?? 0) * count));
      if (Math.abs(attributed - resolution.additive) > Math.max(1, resolution.additive) * 1e-10) throw new Error(`Additive attribution mismatch: ${attributed} vs ${resolution.additive}`);
      const contribution = kind => Object.entries(resolution.counts).filter(([id]) => kindsBefore.get(id) === kind).reduce((total, [id, count]) => ({activations:total.activations + count, additive:total.additive + (addValuesBefore.get(id) ?? 0) * count}), {activations:0, additive:0});
      this.submissionRecords.push({week:state.week, visitor:state.visitor, submission:submissionNumber, score:resolution.score, additive:resolution.additive, multiplier:resolution.multiplier, upgrades:upgrades.length, conduit:contribution('conduit'), prism:contribution('prism')});
    }
    return result;
  }

  definition(artifact) { return this.catalog.ARTIFACTS[artifact.kind] ?? artifact; }
  board(state) { return this._analysis?.board ?? this.engine.getBoardCells(state); }
  footprint(state, artifact) { return this.engine.getArtifactFootprint(state, artifact); }

  effectiveAdditiveValues(state) {
    const entries = this.requirements(state);
    const touches = (a, b) => a.some(cell => b.some(other => Math.abs(cell.x - other.x) + Math.abs(cell.y - other.y) === 1));
    const values = new Map();
    for (const entry of entries.filter(item => item.definition.effect === 'add')) {
      let value = entry.definition.value * (entry.artifact.kind === 'prism' ? entry.cells[0].pieceIds.length : 1);
      for (const aura of entries.filter(item => item.definition.trigger === 'static')) {
        if (aura.artifact.kind === 'pedestal' && touches(aura.footprint, entry.footprint)) value += aura.definition.value;
        if (aura.artifact.kind === 'frame' && entry.definition.trigger === 'chain') {
          const horizontal = ((aura.artifact.rotation ?? 0) % 2) === 0;
          if (entry.footprint.some(point => horizontal ? point.y === aura.footprint[0].y : point.x === aura.footprint[0].x)) value += aura.definition.value;
        }
      }
      values.set(entry.artifact.id, value);
    }
    return values;
  }

  shape(offer, category) {
    if (category === 'artifact') return this.definition(offer).cells;
    if (offer.cells) return offer.cells;
    return this.catalog.SHAPES.find(shape => shape.id === (offer.shape?.id ?? offer.shape))?.cells ?? offer.shape?.cells;
  }

  requirements(state) {
    if (this._analysis) return this._analysis.entries;
    const board = this.board(state);
    const boardMap = new Map(board.map(cell => [key(cell.x, cell.y), cell]));
    const entries = state.artifacts.map(artifact => {
      const footprint = this.footprint(state, artifact);
      const cells = footprint.map(cell => boardMap.get(key(cell.x, cell.y)));
      const requirement = [0, 0, 0, 0, 0, 0];
      for (const cell of cells) {
        const local = diceCounts(cell?.faces ?? []);
        for (let face = 0; face < 6; face++) requirement[face] = Math.max(requirement[face], local[face]);
      }
      return {
        artifact, definition: this.definition(artifact), footprint, cells,
        requirement, count: Math.max(0,...cells.map(cell => cell?.levelSum ?? 0)),
        pieceIds: new Set(cells.flatMap(cell => cell?.pieceIds ?? [])),
        upgradeablePieces: state.pieces.filter(piece => piece.level < this.catalog.CONFIG.maxPieceLevel && cells.some(cell => cell?.pieceIds.includes(piece.id))).length,
      };
    });
    this._analysis = {board, boardMap, entries, probabilities: new Map(), expectedCounts: new Map(), cellStats: new Map(), relayPlans: new Map()};
    return entries;
  }

  requirementProbability(state, requirement) {
    this.requirements(state);
    const signature = requirement.join('');
    if (!this._analysis.probabilities.has(signature)) {
      const distribution = this.currentDistribution ?? rollDistribution(state.dice);
      const probability = sum(distribution.filter(entry => meetsRequirement(entry.counts, requirement, true)).map(entry => entry.probability));
      this._analysis.probabilities.set(signature, probability);
    }
    return this._analysis.probabilities.get(signature);
  }

  // Multi-cell sources react to the largest *active* cell. The union of cell
  // conditions cannot be approximated by one AND requirement and max level.
  cellActivationStats(state, cells, required = null) {
    this.requirements(state);
    const specs=cells.filter(Boolean).map(cell=>({requirement:diceCounts(cell.faces),level:cell.levelSum}));
    const signature=JSON.stringify([specs,required]);
    if(!this._analysis.cellStats.has(signature)) {
      let probability=0,repetitions=0;
      for(const roll of this.currentDistribution ?? rollDistribution(state.dice)) {
        if(required&&!meetsRequirement(roll.counts,required,true))continue;
        const count=Math.max(0,...specs.map(spec=>meetsRequirement(roll.counts,spec.requirement,true)?spec.level:0));
        if(count>0)probability+=roll.probability;
        repetitions+=count*roll.probability;
      }
      this._analysis.cellStats.set(signature,{probability,repetitions});
    }
    return this._analysis.cellStats.get(signature);
  }

  targetFace(state) {
    const weights = [0, 0, 0, 0, 0, 0];
    for (const entry of this.requirements(state)) {
      if (entry.definition.trigger !== 'tile') continue;
      if (entry.definition.effect === 'upgrade' && !entry.upgradeablePieces) continue;
      const effectWeight = entry.definition.effect === 'upgrade' ? 16 : entry.definition.effect === 'add' ? 12 : 8;
      for (let face = 0; face < 6; face++) if (entry.requirement[face]) weights[face] += effectWeight * Math.sqrt(Math.max(1, entry.count));
    }
    return weights.indexOf(Math.max(...weights)) + 1;
  }

  candidatePlacements(state, offer, category, ignoreArtifactId = null) {
    const cells = this.shape(offer, category);
    if (!cells) return [];
    const board = this.board(state);
    const boardSet = new Set(board.map(cell => key(cell.x, cell.y)));
    const occupied = new Set(state.artifacts.filter(artifact => artifact.id !== ignoreArtifactId).flatMap(artifact => this.footprint(state, artifact).map(cell => key(cell.x, cell.y))));
    const anchors = new Map();
    for (const cell of board) {
      anchors.set(key(cell.x, cell.y), cell);
      if (category === 'piece') for (const [dx, dy] of DIRS) anchors.set(key(cell.x + dx, cell.y + dy), {x: cell.x + dx, y: cell.y + dy});
    }
    if (!board.length) anchors.set('0,0', {x: 0, y: 0});
    const placements = [];
    const seen = new Set();
    for (let rotation = 0; rotation < 4; rotation++) {
      const rotated = rotateCells(cells, rotation);
      for (const anchor of anchors.values()) for (const offset of rotated) {
        const x = anchor.x - offset.x;
        const y = anchor.y - offset.y;
        const signature = rotated.map(cell => key(cell.x + x, cell.y + y)).sort().join(';');
        if (seen.has(signature)) continue;
        seen.add(signature);
        const placed = rotated.map(cell => ({x: cell.x + x, y: cell.y + y}));
        if (category === 'artifact' && !placed.every(cell => boardSet.has(key(cell.x, cell.y)) && !occupied.has(key(cell.x, cell.y)))) continue;
        placements.push({x, y, rotation, cells: placed});
      }
    }
    return placements;
  }

  piecePlacementValue(state, offer, placement) {
    const board = this.board(state);
    const boardMap = new Map(board.map(cell => [key(cell.x, cell.y), cell]));
    const artifacts = this.requirements(state);
    const targetFace = this.targetFace(state);
    let value = 0;
    let overlaps = 0;
    const occupied = new Set(artifacts.flatMap(entry => entry.footprint.map(cell => key(cell.x, cell.y))));
    const empty = board.filter(cell => !occupied.has(key(cell.x, cell.y))).length;
    const added = new Set(placement.cells.map(cell => key(cell.x, cell.y)));
    const canGrow = this.name !== 'casual' && state.artifacts.some(artifact => artifact.kind === 'brush' && artifact.charges > 0);
    const projectedLevel = canGrow ? Math.min(2, this.catalog.CONFIG.maxPieceLevel) : 1;
    for (const point of placement.cells) {
      const existing = boardMap.get(key(point.x, point.y));
      if (!existing) {
        value += this.name === 'casual' ? offer.face === targetFace ? 4 : 2 : (empty < 6 ? 1.3 : .35) + (offer.face === targetFace ? .4 : 0);
        const neighbors = DIRS.filter(([dx, dy]) => boardMap.has(key(point.x + dx, point.y + dy))).length;
        value += neighbors * .3;
      } else {
        overlaps++;
        if (existing.faces.length >= 5) return -1000;
        value += this.name === 'casual' ? -2 : -.1;
      }
    }
    if (this.name !== 'casual' && overlaps) for (const entry of artifacts) {
      if (!entry.footprint.some(cell => added.has(key(cell.x, cell.y)))) continue;
      const requirement = [0, 0, 0, 0, 0, 0];
      const projectedCells = [];
      for (const cell of entry.cells) {
        const changed = added.has(key(cell.x, cell.y));
        const local = diceCounts([...cell.faces, ...(changed ? [offer.face] : [])]);
        for (let face = 0; face < 6; face++) requirement[face] = Math.max(requirement[face], local[face]);
        projectedCells.push({...cell,faces:[...cell.faces,...(changed?[offer.face]:[])],levelSum:cell.levelSum+(changed?projectedLevel:0)});
      }
      const before = this.requirementProbability(state, entry.requirement);
      const after = this.requirementProbability(state, requirement);
      if (entry.definition.trigger === 'tile' && entry.definition.effect !== 'upgrade') {
        const relay = this.relayPlan(state, entry.footprint);
        const support = relay.relays.reduce((total, item) => total + (item.artifact.kind === 'prism' ? item.definition.value * item.cells[0].faces.length * this.requirementProbability(state, item.requirement) : item.definition.value), 0);
        const perActivation = entry.definition.effect === 'add' ? entry.definition.value + support : 2 + support;
        value += (this.cellActivationStats(state,projectedCells).repetitions - this.expectedTileCount(state,entry)) * perActivation;
      } else if (entry.artifact.kind === 'prism') {
        const sourceCount = this.relayPlan(state, entry.footprint).sources.reduce((total, source) => total + this.expectedTileCount(state, source), 0);
        value += (after * (entry.cells[0].faces.length + 1) - before * entry.cells[0].faces.length) * entry.definition.value * sourceCount;
      } else if (entry.artifact.kind === 'brush' && entry.artifact.charges > 0) value += after * 1.5;
    }
    if (this.name === 'casual') {
      if (empty > 12) value *= .2;
      value += placement.cells.length - overlaps * 3;
    }
    return value - Math.abs(placement.x) * .005 - Math.abs(placement.y) * .005;
  }

  expectedTileCount(state, entry) {
    if (!this._analysis.expectedCounts.has(entry.artifact.id)) {
      const stats=this.cellActivationStats(state,entry.cells);
      const expected=entry.definition.effect === 'upgrade'
        ? (entry.upgradeablePieces > 0 && entry.artifact.charges > 0 ? stats.probability : 0)
        : stats.repetitions;
      this._analysis.expectedCounts.set(entry.artifact.id, expected);
    }
    return this._analysis.expectedCounts.get(entry.artifact.id);
  }

  relayPlan(state, footprint) {
    const entries = this.requirements(state);
    const signature = footprint.map(cell => key(cell.x, cell.y)).sort().join(';');
    if (this._analysis.relayPlans.has(signature)) return this._analysis.relayPlans.get(signature);
    const touches = (a, b) => a.some(cell => b.some(other => Math.abs(cell.x - other.x) + Math.abs(cell.y - other.y) === 1));
    const relays = entries.filter(entry => ['conduit', 'prism'].includes(entry.artifact.kind));
    const reached = relays.filter(entry => touches(footprint, entry.footprint));
    const seen = new Set(reached.map(entry => entry.artifact.id));
    for (let index = 0; index < reached.length; index++) for (const other of relays) if (!seen.has(other.artifact.id) && touches(reached[index].footprint, other.footprint)) {
      seen.add(other.artifact.id);
      reached.push(other);
    }
    const connection = [footprint, ...reached.map(entry => entry.footprint)];
    const sources = entries.filter(entry => entry.definition.trigger === 'tile' && (entry.definition.effect !== 'upgrade' || entry.upgradeablePieces > 0) && connection.some(points => touches(points, entry.footprint)));
    const result = {relays: reached, sources};
    this._analysis.relayPlans.set(signature, result);
    return result;
  }

  artifactPlacementValue(state, offer, placement) {
    const definition = this.definition(offer);
    const entries = this.requirements(state);
    const boardMap = new Map(this.board(state).map(cell => [key(cell.x, cell.y), cell]));
    const cells = placement.cells.map(cell => boardMap.get(key(cell.x, cell.y)));
    const requirement = [0, 0, 0, 0, 0, 0];
    for (const cell of cells) {
      const counts = diceCounts(cell.faces);
      for (let index = 0; index < 6; index++) requirement[index] = Math.max(requirement[index], counts[index]);
    }
    const probability = this.requirementProbability(state, requirement);
    const activation = this.cellActivationStats(state,cells);
    const pieces = new Set(cells.flatMap(cell => cell.pieceIds));
    const touches = entry => placement.cells.some(a => entry.footprint.some(b => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1));
    const sameRow = entry => placement.cells.some(a => entry.footprint.some(b => a.y === b.y));
    const tileEntries = entries.filter(entry => entry.definition.trigger === 'tile' && (entry.definition.effect !== 'upgrade' || entry.upgradeablePieces > 0));
    const additiveEntries = entries.filter(entry => entry.definition.effect === 'add');
    const countExpected = entry => this.expectedTileCount(state, entry);
    const baseAdditive = this._analysis.baseAdditive ??= additiveEntries.reduce((total, entry) => total + (entry.definition.trigger === 'tile' ? countExpected(entry) : 1) * entry.definition.value, 0);
    let value = 0;
    if (definition.trigger === 'tile') {
      if (definition.effect === 'add') {
        const support = entries.reduce((total, entry) => total + (entry.artifact.kind === 'pedestal' && touches(entry) ? 5 : entry.artifact.kind === 'observer' && sameRow(entry) ? 6 : entry.artifact.kind === 'echo' && touches(entry) ? 2 : 0), 0);
        const relaySupport = this.relayPlan(state, placement.cells).relays.reduce((total, entry) => total + entry.definition.value * (entry.artifact.kind === 'prism' ? entry.cells[0].faces.length * this.requirementProbability(state, entry.requirement) : 1), 0);
        value = activation.repetitions * (definition.value + support + relaySupport);
      } else if (definition.effect === 'multiply') {
        const directSupport=entries.reduce((total,entry)=>total+(
          entry.artifact.kind==='coin'&&touches(entry)||entry.artifact.kind==='observer'&&sameRow(entry)?entry.definition.value:0),0);
        const relaySupport=this.relayPlan(state,placement.cells).relays.reduce((total,entry)=>total+entry.definition.value*(entry.artifact.kind==='prism'?entry.cells[0].faces.length*this.requirementProbability(state,entry.requirement):1),0);
        value=activation.repetitions*(directSupport+relaySupport+Math.log(definition.value)*Math.max(12,baseAdditive)*1.6);
        if(offer.kind==='long_mirror'&&new Set(cells.map(cell=>diceCounts(cell.faces).join(','))).size>1)
          value+=probability*Math.max(...cells.map(cell=>cell.levelSum))*Math.log(definition.conditionalValue/definition.value)*Math.max(12,baseAdditive)*1.6;
      }
      else if (definition.effect === 'upgrade') {
        const unfinished=new Set(state.pieces.filter(piece=>pieces.has(piece.id)&&piece.level<this.catalog.CONFIG.maxPieceLevel).map(piece=>piece.id));
        if(!unfinished.size)return 0;
        const remainingSubmissions = Math.max(0, (8 - state.week) * 9 + (3 - state.visitor) * 3);
        const relevant = tileEntries.filter(entry => [...entry.pieceIds].some(id => unfinished.has(id)));
        const occupiedGrowth = relevant.reduce((total, entry) => total + (entry.definition.effect === 'add' ? entry.definition.value : entry.definition.effect === 'multiply' ? Math.max(12, baseAdditive) * .12 : 0), 0);
        const charges = offer.charges ?? definition.charges ?? this.catalog.CONFIG.brushCharges;
        const alreadyCovered = entries.some(entry => entry.artifact.id !== offer.id && entry.artifact.kind === 'brush' && entry.artifact.charges > 0 && [...unfinished].some(id => entry.pieceIds.has(id)));
        value = activation.probability * Math.min(charges, remainingSubmissions>0?unfinished.size:0) * Math.max(4, occupiedGrowth) * .7 * (alreadyCovered ? .1 : 1);
        if (this.name === 'casual') value *= .15;
        if (this.name === 'investor') value *= 1.45;
      }
    } else if (['conduit', 'prism'].includes(offer.kind)) {
      const plan = this.relayPlan(state, placement.cells);
      let expectedSources = 0;
      for (const source of plan.sources) {
        if (offer.kind === 'prism') {
          const stats=this.cellActivationStats(state,source.cells,requirement);
          expectedSources += source.definition.effect === 'upgrade' ? stats.probability : stats.repetitions;
        } else expectedSources += countExpected(source);
      }
      const ownValue = definition.value * (offer.kind === 'prism' ? cells[0].faces.length : 1);
      value = expectedSources * (ownValue + plan.relays.length * .6);
    } else if (offer.kind === 'coin') value = sum(tileEntries.filter(touches).map(countExpected)) * definition.value;
    else if (offer.kind === 'observer') value = sum(tileEntries.filter(sameRow).map(countExpected)) * definition.value;
    else if (offer.kind === 'echo') value = sum(additiveEntries.filter(touches).map(entry => entry.definition.trigger === 'tile' ? countExpected(entry) : 1.5)) * definition.value;
    else if (offer.kind === 'pedestal') value = sum(additiveEntries.filter(touches).map(entry => entry.definition.trigger === 'tile' ? countExpected(entry) : 1.5)) * definition.value;
    else if (offer.kind === 'frame') {
      const horizontal = placement.cells[0].y === placement.cells[1].y;
      value = sum(additiveEntries.filter(entry => entry.footprint.some(point => horizontal ? point.y === placement.cells[0].y : point.x === placement.cells[0].x)).map(()=>1.5)) * definition.value;
    } else if (offer.kind === 'bell') {
      const adjacent = tileEntries.filter(touches);
      value = adjacent.length >= 3 ? sum(adjacent.map(countExpected)) * definition.value * .65 : adjacent.length * 1.5;
    } else if (offer.kind === 'seal') {
      let best = 0;
      for (const piece of pieces) {
        const sources = tileEntries.filter(entry => entry.pieceIds.has(piece));
        if (sources.length >= 2) best = Math.max(best, sum(sources.map(countExpected)));
      }
      value = best * definition.value;
    }
    const openAdjacent = placement.cells.reduce((total, cell) => total + DIRS.filter(([dx, dy]) => boardMap.has(key(cell.x + dx, cell.y + dy))).length, 0);
    return value + openAdjacent * .015;
  }

  bestPlacement(state, offer, category, ignoreArtifactId = null) {
    let best = null;
    let bestValue = -Infinity;
    for (const placement of this.candidatePlacements(state, offer, category, ignoreArtifactId)) {
      const value = category === 'piece' ? this.piecePlacementValue(state, offer, placement) : this.artifactPlacementValue(state, offer, placement);
      if (value > bestValue) {
        const check = category === 'piece' ? this.engine.legalPiecePlacement : this.engine.legalArtifactPlacement;
        if (check(state, offer, placement.x, placement.y, placement.rotation, ignoreArtifactId)) { best = placement; bestValue = value; }
      }
    }
    return best ? {...best, value: bestValue} : null;
  }

  chooseOffer(state, category, source) {
    const offers = state.shop[source === 'free' ? category === 'piece' ? 'freePieces' : 'freeArtifacts' : category === 'piece' ? 'pieces' : 'artifacts'] ?? [];
    let best = null;
    for (let index = 0; index < offers.length; index++) {
      const offer = offers[index];
      if (!offer || offer.sold || offer.purchased || (source === 'shop' && offer.price > state.money)) continue;
      if (this.name === 'casual' && source === 'shop' && category === 'artifact' && !['coin', 'mirror', 'echo', 'conduit'].includes(offer.kind)) continue;
      const placement = this.bestPlacement(state, offer, category);
      if (!placement) continue;
      const value = source === 'shop' ? placement.value / Math.max(1, offer.price) : placement.value;
      if (!best || value > best.value) best = {index, offer, placement, value};
    }
    return best;
  }

  placeOffer(state, choice, category, source) {
    const oldBoard = new Set(this.board(state).map(cell => key(cell.x, cell.y)));
    this.act(state, {type: category === 'piece' ? 'PLACE_PIECE' : 'PLACE_ARTIFACT', source, index: choice.index, x: choice.placement.x, y: choice.placement.y, rotation: choice.placement.rotation});
    if (source === 'free') this.metrics[category === 'piece' ? 'freePieces' : 'freeArtifacts']++;
    else this.metrics.purchases++;
    if (category === 'artifact') {
      this.metrics.acquiredByKind[choice.offer.kind] = (this.metrics.acquiredByKind[choice.offer.kind] ?? 0) + 1;
      if (choice.offer.kind === 'prism' && this.board(state).some(cell => choice.placement.cells.some(point => point.x === cell.x && point.y === cell.y) && cell.faces.length > 1)) this.metrics.prismOverlapPlacements++;
    }
    if (category === 'piece' && choice.placement.cells.some(cell => oldBoard.has(key(cell.x, cell.y)))) {
      this.metrics.overlapPlacements++;
      this.metrics.overlapCellsAdded += choice.placement.cells.filter(cell => oldBoard.has(key(cell.x, cell.y))).length;
    }
  }

  moveBrushes(state) {
    if (this.name === 'casual') return;
    const reserved = new Set();
    for (const brush of state.artifacts.filter(artifact => artifact.kind === 'brush' && artifact.charges > 0)) {
      const current = this.requirements(state).find(entry => entry.artifact.id === brush.id);
      const available = entry => [...entry.pieceIds].filter(id => !reserved.has(id) && state.pieces.some(piece => piece.id === id && piece.level < this.catalog.CONFIG.maxPieceLevel));
      let best = null;
      let bestValue = available(current).length ? this.artifactPlacementValue(state, brush, {cells:current.footprint}) : 0;
      for (const placement of this.candidatePlacements(state, brush, 'artifact', brush.id)) {
        const ids = new Set(placement.cells.flatMap(point => this._analysis.boardMap.get(key(point.x, point.y))?.pieceIds ?? []));
        if (![...ids].some(id => !reserved.has(id) && state.pieces.some(piece => piece.id === id && piece.level < this.catalog.CONFIG.maxPieceLevel))) continue;
        const value = this.artifactPlacementValue(state, brush, placement);
        if (value > bestValue + .1 && this.engine.legalArtifactPlacement(state, brush, placement.x, placement.y, placement.rotation, brush.id)) { best = placement; bestValue = value; }
      }
      if (best) this.act(state, {type:'MOVE_ARTIFACT', artifactId:brush.id, x:best.x, y:best.y, rotation:best.rotation});
      const final = this.requirements(state).find(entry => entry.artifact.id === brush.id);
      for (const id of available(final)) reserved.add(id);
    }
  }

  visitUtility(state) {
    const cache = new Map();
    const target = this.engine.getVisitorTarget(state);
    const cap = Math.max(0, target * 1.6 - state.visit.score);
    const entries = this.requirements(state);
    const baseGrowthValue = Math.max(6, sum(entries.filter(entry => entry.definition.effect === 'add').map(entry => entry.definition.value)) * .7);
    return values => {
      const signature = diceCounts(values).join('');
      if (cache.has(signature)) return cache.get(signature);
      const preview = this.engine.previewSubmission(state, values);
      const upgrades = preview.upgrades?.length ?? 0;
      const remaining = Math.max(0, (8 - state.week) * 9 + (3 - state.visitor) * 3 + state.visit.submissionsLeft - 1);
      const growth = this.name === 'casual' ? 0 : upgrades * baseGrowthValue * Math.min(3, remaining / 6) * (this.name === 'investor' ? 1.3 : .6);
      const utility = Math.min(preview.score, cap) + growth;
      cache.set(signature, utility);
      return utility;
    };
  }

  rerollDecision(state) {
    if (!state.visit.rerollsLeft) return null;
    const values = state.dice.map(die => die.value);
    if (this.name === 'casual') {
      const face = this.targetFace(state);
      const keepMask = values.reduce((mask, value, index) => value === face ? mask | 1 << index : mask, 0);
      if (keepMask && state.visit.rerollsLeft < state.visit.submissionsLeft) return null;
      return keepMask === 31 ? null : keepMask;
    }
    const remaining = Math.max(0, (8 - state.week) * 9 + (3 - state.visitor) * 3 + state.visit.submissionsLeft - 1);
    if (state.visit.score >= this.engine.getVisitorTarget(state) * 1.6 && !(remaining > 0 && state.artifacts.some(artifact => this.definition(artifact).effect === 'upgrade' && artifact.charges > 0))) {
      // Preserve the policy random stream of the full search. Skipping its
      // previews must not silently change decisions in later submissions.
      for (let index = 0; index < 18 * state.dice.length; index++) this.random();
      return null;
    }
    const utility = this.visitUtility(state);
    const current = utility(values);
    let best = {keepMask: null, utility: current};
    const sampleCount = 18;
    const samples = Array.from({length: sampleCount}, () => state.dice.map(die => die.faces[Math.floor(this.random() * die.faces.length)]));
    for (let keepMask = 0; keepMask < 31; keepMask++) {
      const candidate = mean(samples.map(roll => utility(roll.map((value, index) => keepMask & 1 << index ? values[index] : value))));
      if (candidate > best.utility) best = {keepMask, utility: candidate};
    }
    const reserveForLater = state.visit.rerollsLeft < state.visit.submissionsLeft;
    const requiredGain = reserveForLater ? Math.max(4, current * .3) : Math.max(.5, current * .015);
    return best.keepMask !== null && best.utility - current > requiredGain ? best.keepMask : null;
  }

  playSubmission(state) {
    let rerolls = 0;
    while (state.phase === 'visit' && state.visit.rerollsLeft > 0 && rerolls < 3) {
      const keepMask = this.rerollDecision(state);
      if (keepMask === null) break;
      for (let index = 0; index < state.dice.length; index++) if (Boolean(keepMask & 1 << index) !== Boolean(state.dice[index].held)) this.act(state, {type: 'HOLD', die: index});
      this.act(state, {type: 'REROLL'});
      rerolls++;
    }
    this.act(state, {type: 'SUBMIT'});
  }

  chooseDieEdit(state) {
    if (this.name !== 'investor' || state.week >= 7 || state.money < this.catalog.CONFIG.editDieCost + 12) return null;
    const face = this.targetFace(state);
    const totalCopies = sum(state.dice.map(die => die.faces.filter(value => value === face).length));
    const maxCopies = state.week < 3 ? 10 : 16;
    if (totalCopies >= maxCopies) return null;
    const dieIndex = state.dice.map((die, index) => ({index, copies: die.faces.filter(value => value === face).length})).sort((a, b) => a.copies - b.copies)[0].index;
    const replace = state.dice[dieIndex].faces.findIndex(value => value !== face);
    return replace >= 0 ? {type: 'EDIT_DIE', die: dieIndex, face: replace, value: face} : null;
  }

  playShop(state) {
    this.currentDistribution = rollDistribution(state.dice);
    // Each category is chosen once. Action validation enforces claimed flags.
    for (const category of ['piece', 'artifact']) {
      const offerKey=category==='piece'?'freePieces':'freeArtifacts';
      const claimedKey=category==='piece'?'freePieceClaimed':'freeArtifactClaimed';
      if(state.shop[claimedKey]||!state.shop[offerKey]?.length)continue;
      const choice = this.chooseOffer(state, category, 'free');
      if (choice && choice.placement.value > .05) this.placeOffer(state, choice, category, 'free');
      else {
        this.act(state, {type: 'SKIP_FREE', category});
        this.metrics[category === 'piece' ? 'rejectedPieces' : 'rejectedArtifacts']++;
      }
      if (category === 'piece') this.moveBrushes(state);
    }
    let editedDie = false;
    // Reserve some spending for probability investment, instead of letting
    // attractive artifacts consume the entire budget before this choice.
    if (this.name === 'investor' && state.week >= 2 && state.money >= this.catalog.CONFIG.editDieCost + 20) {
      const edit = this.chooseDieEdit(state);
      if (edit) { this.act(state, edit); editedDie = true; }
    }
    for (let purchase = 0; purchase < 3; purchase++) {
      const artifact = this.chooseOffer(state, 'artifact', 'shop');
      const minimumRatio = this.name === 'casual' ? .45 : .35;
      if (artifact && artifact.value >= minimumRatio && state.money >= artifact.offer.price) {
        this.placeOffer(state, artifact, 'artifact', 'shop');
        continue;
      }
      break;
    }
    if (this.name === 'investor' && !editedDie) {
      const edit = this.chooseDieEdit(state);
      if (edit) this.act(state, edit);
    }
    this.currentDistribution = null;
    this.act(state, {type: 'NEXT_VISITOR'});
  }
}

export function runOne(engine, catalog, seed, policyName, options = {}) {
  const started = performance.now();
  const state = engine.createGame(seed);
  const initialDice = state.dice.map(die => die.value);
  const initialArtifactKinds = state.artifacts.map(artifact => artifact.kind);
  const player = new AutomatedPlayer(engine, catalog, policyName, seed, options);
  let iterations = 0;
  while (state.phase !== 'won' && state.phase !== 'lost') {
    if (++iterations > 200) throw new Error(`Run ${seed}/${policyName} exceeded 200 phases`);
    if (state.phase === 'visit') player.playSubmission(state);
    else if (state.phase === 'shop') player.playShop(state);
    else throw new Error(`Unknown phase: ${state.phase}`);
  }
  const history = state.history ?? [];
  const visitors = history.filter(entry => entry.score !== undefined || entry.total !== undefined || entry.totalScore !== undefined);
  const evaluatorHistory = visitors.filter(entry => entry.visitor === 3 || entry.isEvaluator || entry.evaluator);
  const expectedMoney = catalog.CONFIG.startingMoney + sum(visitors.map(visitor => visitor.tip ?? 0)) - player.metrics.spent + player.metrics.saleRevenue;
  if (Math.abs(state.money - expectedMoney) > 1e-8) throw new Error(`Money accounting mismatch in ${seed}/${policyName}`);
  if (sum(state.pieces.map(piece => piece.level)) !== state.pieces.length + player.metrics.chargesConsumed) throw new Error(`Level/charge accounting mismatch in ${seed}/${policyName}`);
  if (state.pieces.some(piece=>piece.level<1||piece.level>catalog.CONFIG.maxPieceLevel)) throw new Error(`Piece level cap violated in ${seed}/${policyName}`);
  if (player.metrics.submissions !== visitors.length * catalog.CONFIG.submissionsPerVisitor) throw new Error(`Submission accounting mismatch in ${seed}/${policyName}`);
  if (state.phase === 'won' && (visitors.length !== 24 || player.metrics.submissions !== 72)) throw new Error(`Incomplete eight-week victory in ${seed}/${policyName}`);
  const result = {
    seed, initialDice, initialArtifactKinds, rulesVersion:state.rulesVersion, policy: policyName, won: state.phase === 'won', finalWeek: state.week,
    finalVisitor: state.visitor, money: state.money,
    pieces: state.pieces.length, artifacts: state.artifacts.length,
    sumPieceLevels: sum(state.pieces.map(piece => piece.level)),
    maxPieceLevel: Math.max(...state.pieces.map(piece => piece.level)),
    boardCells: engine.getBoardCells(state).length,
    chargesRemaining: sum(state.artifacts.map(artifact => artifact.charges ?? 0)),
    totalTips: sum(visitors.map(visitor => visitor.tip ?? 0)),
    totalEmotion: sum(visitors.map(visitor => visitor.score ?? 0)),
    cappedTips: visitors.filter(visitor => visitor.tip === catalog.CONFIG.tipTiers.at(-1).tip).length,
    diceFaces: state.dice.map(die => [...die.faces]),
    finalArtifactsByKind: state.artifacts.reduce((counts, artifact) => { counts[artifact.kind] = (counts[artifact.kind] ?? 0) + 1; return counts; }, {}),
    submissionContributions:player.submissionRecords,
    ...player.metrics, elapsedMs: performance.now() - started,
    visits: visitors, evaluatorHistory,
  };
  if (options.trace) result.actions = player.actions;
  return result;
}

export function summarizeRuns(runs) {
  const weeks = Array.from({length: 8}, (_, index) => ({week: index + 1, losses: 0, reached: 0, meanRatio: null, medianRatio: null, minRatio: null}));
  for (const run of runs) {
    if (!run.won) weeks[Math.min(7, run.finalWeek - 1)].losses++;
    for (let index = 0; index < Math.min(8, run.finalWeek); index++) weeks[index].reached++;
  }
  for (const week of weeks) {
    const entries = runs.flatMap(run => run.evaluatorHistory.filter(entry => entry.week === week.week));
    const ratios = entries.map(entry => entry.ratio ?? ((entry.score ?? entry.total ?? entry.totalScore) / entry.target)).filter(Number.isFinite);
    if (ratios.length) {
      week.meanRatio = mean(ratios);
      week.medianRatio = median(ratios);
      week.minRatio = Math.min(...ratios);
    }
  }
  const metrics = ['money', 'pieces', 'artifacts', 'sumPieceLevels', 'maxPieceLevel', 'boardCells', 'chargesRemaining', 'totalTips', 'totalEmotion', 'cappedTips', 'rerolls', 'submissions', 'purchases', 'spent', 'sales', 'saleRevenue', 'diceEdits', 'freePieces', 'freeArtifacts', 'rejectedPieces', 'rejectedArtifacts', 'chargesConsumed', 'overlapPlacements', 'overlapCellsAdded', 'prismOverlapPlacements', 'artifactMoves', 'brushMoves', 'brushMovesToUnfinished', 'elapsedMs'];
  const kinds = new Set(runs.flatMap(run => Object.keys(run.activationsByKind ?? {})));
  return {
    policy: runs[0]?.policy, samples: runs.length, wins: runs.filter(run => run.won).length,
    clearRate: runs.length ? runs.filter(run => run.won).length / runs.length : 0,
    meanFinalWeek: mean(runs.map(run => run.finalWeek)), weeks,
    averages: Object.fromEntries(metrics.map(metric => [metric, mean(runs.map(run => run[metric]))])),
    medianElapsedMs: median(runs.map(run => run.elapsedMs)),
    artifactUsage: Object.fromEntries([...kinds].sort().map(kind => [kind, {
      meanAcquired:mean(runs.map(run => run.acquiredByKind?.[kind] ?? 0)),
      meanFinalOwned:mean(runs.map(run => run.finalArtifactsByKind?.[kind] ?? 0)),
      meanActivations:mean(runs.map(run => run.activationsByKind?.[kind] ?? 0)),
      meanAdditiveContribution:mean(runs.map(run => run.additiveByKind?.[kind] ?? 0)),
      runsWithActivation:runs.filter(run => (run.activationsByKind?.[kind] ?? 0) > 0).length,
    }])),
    errors: runs.flatMap(run => run.errors),
  };
}

export async function runExperiment(options) {
  const engine = await import('./dist/engine.js');
  const catalog = await import('./dist/catalog.js');
  const settings = options.settings ? JSON.parse(fs.readFileSync(path.resolve(options.settings), 'utf8')) : {};
  // Settings configure the experiment before any game exists; live states are
  // still advanced exclusively by action(). The catalog source is never edited.
  for (const [name, value] of Object.entries(settings.config ?? {})) {
    if (!(name in catalog.CONFIG)) throw new Error(`Unknown configuration value: ${name}`);
    catalog.CONFIG[name] = value;
  }
  for (const [kind, overrides] of Object.entries(settings.artifacts ?? {})) {
    if (!catalog.ARTIFACTS[kind]) throw new Error(`Unknown artifact setting: ${kind}`);
    Object.assign(catalog.ARTIFACTS[kind], overrides);
  }
  const started = performance.now();
  const runs = [];
  for (const policy of options.policies) {
    for (let index = 0; index < options.seeds; index++) {
      const sampleId = options.start + index;
      const seed = options.rawSeeds ? sampleId : experimentSeed(sampleId);
      const result = runOne(engine, catalog, seed, policy, options);
      result.sampleId = sampleId;
      runs.push(result);
      if ((index + 1) % 10 === 0 || index === options.seeds - 1) process.stderr.write(`${options.split} ${policy}: ${index + 1}/${options.seeds}, wins ${runs.filter(run => run.policy === policy && run.won).length}\n`);
    }
  }
  return {
    schemaVersion: 3, split: options.split,
    policyVersion:'v4-weekly-floor-max-source-v1',
    seedRange: [options.start, options.start + options.seeds - 1],
    assumptions: {
      gameplay: 'All live state changes go through engine.action; no hidden RNG inspection or future-roll access.',
      policy: 'Heuristic public-state players with independently seeded Monte Carlo reroll estimates; automated results are not human playtests.',
      holdSamples: 18,
      seedMapping: options.rawSeeds ? 'Raw numeric seed = sample ID (exploratory reproduction only).' : 'Bijective uint32 hash of sample ID; avoids correlated initial rolls for small xorshift32 seeds.',
    },
    config: structuredClone(engine.getConfig?.() ?? catalog.CONFIG),
    artifactBalance: Object.fromEntries(Object.entries(catalog.ARTIFACTS).map(([kind, entry]) => [kind, {value: entry.value, price: entry.price, charges: kind === 'brush' ? catalog.CONFIG.brushCharges : entry.charges}])),
    settings,
    elapsedMs: performance.now() - started,
    summaries: options.policies.map(policy => summarizeRuns(runs.filter(run => run.policy === policy))),
    runs,
  };
}

function selfCheck() {
  const randomA = seededRandom(10);
  const randomB = seededRandom(10);
  for (let index = 0; index < 100; index++) if (randomA() !== randomB()) throw new Error('Policy RNG is not repeatable');
  const distribution = rollDistribution(Array.from({length: 5}, () => ({faces: [1, 2, 3, 4, 5, 6]})));
  if (distribution.length !== 252 || Math.abs(sum(distribution.map(entry => entry.probability)) - 1) > 1e-10) throw new Error('Incorrect five-dice distribution');
  const targetOne = sum(distribution.filter(entry => entry.counts[0] >= 1).map(entry => entry.probability));
  if (Math.abs(targetOne - (1 - (5 / 6) ** 5)) > 1e-10) throw new Error('Incorrect containment probability');
  if (!meetsRequirement([1, 1, 2, 5, 6], [2, 1, 0, 0, 0, 0])) throw new Error('Repeated-face requirement failed');
  if (meetsRequirement([1, 2, 3, 5, 6], [2, 1, 0, 0, 0, 0])) throw new Error('Repeated-face requirement incorrectly passed');
  console.log('Simulator self-check passed: seeded RNG, per-die distributions, repeated-face containment.');
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const options = optionsFromArgs(process.argv.slice(2));
  if (options.help) {
    console.log('node prototype/simulate.mjs --seeds 50 --start 1000 --split training --policies casual,balanced,investor --out prototype/balance-training.json');
  } else if (options.selfCheck) selfCheck();
  else {
    const result = await runExperiment(options);
    console.log(JSON.stringify(result.summaries, null, 2));
    if (options.out) fs.writeFileSync(path.resolve(options.out), JSON.stringify(result, null, 2) + '\n');
  }
}
