(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.MuseumGame = factory(root.MuseumCore);
})(globalThis, function (Core) {
  'use strict';

  const C = Core.CONFIG;
  const RULES_VERSION = C.rulesVersion;
  const SAVE_KEY = 'strange-museum-v12-run-v5';
  const bossNames = { steady: '꾸준함', burst: '한 방', diversity: '눈의 다양성' };
  const strengthNames = ['약', '중', '강'];
  const copy = value => JSON.parse(JSON.stringify(value));
  const money = value => Math.round(value * 10) / 10;
  const choose = (game, entries) => entries[Core.randomInt(game, entries.length)];
  const belowCap = (count, cap) => cap == null || count < cap;

  function seedNumber(seed) {
    if (Number.isFinite(seed)) return Math.trunc(seed) >>> 0;
    let hash = 2166136261;
    for (const ch of String(seed)) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619);
    return hash >>> 0;
  }

  function bossEntry(week, type) {
    const [weakThrough, mediumThrough] = C.boss.strengthWeeks;
    const tier = week <= weakThrough ? 0 : week <= mediumThrough ? 1 : 2;
    let rule;
    if (type === 'steady') {
      const cap = C.boss.steady.caps[tier];
      const damage = tier === 0 ? '남은 주사위 1개를 이번 관람에서 제외합니다.' : '주사위 1개를 영구히 잃습니다.';
      rule = `한 번의 제출로 합 +${week * C.boss.steady.perWeek} 또는 배율 +1을 얻어야 합니다. 미달하면 ${damage}${cap == null ? '' : ' 최대 ' + cap + '회.'}`;
    } else if (type === 'burst') {
      const b = C.boss.burst;
      const mult = b.mult[tier] ? `, 배율 −${b.mult[tier]}` : '';
      const cap = b.dustCaps[tier];
      const dust = cap === 0 ? '' : ` 유물 곁에 먼지가 쌓입니다.${cap == null ? '' : ' 최대 ' + cap + '개.'}`;
      rule = `${b.free[tier] + 1}번째 제출부터 매번 합 −${b.sum[tier]}${mult}.${dust}`;
    } else {
      const cap = C.boss.diversity.caps[tier];
      rule = '전체 주사위의 면에 가장 많은 눈을 봉인합니다(동률이면 큰 눈). 그 눈을 내면 모든 패턴이 무효입니다.';
      if (cap !== 0) rule += ` 함께 낸 봉인된 면 하나가 영구히 바뀝니다.${cap == null ? '' : ' 최대 ' + cap + '회.'}`;
    }
    return { week, type, tier, strength: strengthNames[tier], name: bossNames[type], rule };
  }

  function newGame(seed = Date.now()) {
    const game = {
      rulesVersion: RULES_VERSION, seed, rng: seedNumber(seed), phase: 'intro', week: 1, visitor: 1,
      money: C.startMoney, dice: [], nextDieId: 1, schedule: [], view: null, shop: null,
      lastResult: null, history: [], board: { cells: [...C.startCells], relics: {}, tokens: {} }
    };
    for (const [pos, id] of Object.entries(C.startRelics)) game.board.relics[pos] = Core.instance(id);
    for (let i = 0; i < C.startDice; i++) game.dice.push(Core.newDie(game));
    let previous;
    for (let week = 1; week <= C.weeks; week++) {
      const type = choose(game, Object.keys(bossNames).filter(id => id !== previous));
      game.schedule.push(bossEntry(week, type));
      previous = type;
    }
    return game;
  }

  function drawStock(game, ids) {
    const pool = [...ids], drawn = [];
    while (drawn.length < C.slots && pool.length) drawn.push(pool.splice(Core.randomInt(game, pool.length), 1)[0]);
    return drawn;
  }

  function rewardChoices(game) {
    const catalog = Object.values(Core.RELICS);
    const choices = drawStock(game, catalog.filter(r => r.kind === 'normal').map(r => r.id));
    if (Core.random(game) < C.rewardDiceChance) {
      choices[Core.randomInt(game, choices.length)] = choose(game, catalog.filter(r => r.kind === 'dice')).id;
    }
    return choices;
  }

  function sealedValue(game) {
    const counts = new Map(C.fairFaces.map(value => [value, 0]));
    for (const die of game.dice) for (const face of die.faces) counts.set(face, counts.get(face) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  }

  function startViewing(game) {
    if (game.phase !== 'intro' && game.phase !== 'shop') return false;
    if (game.phase === 'shop') {
      game.visitor = game.visitor % C.visitorsPerWeek + 1;
      if (game.visitor === 1) game.week++;
    }
    const boss = game.visitor === C.visitorsPerWeek ? game.schedule[game.week - 1] : null;
    game.phase = 'viewing';
    game.shop = null;
    game.view = {
      remaining: game.dice.map(die => ({ id: die.id, face: Core.randomInt(game, die.faces.length) })),
      submitted: [], removed: [], sum: 0, mult: 0, rerollsLeft: C.rerolls, thresholds: [],
      rewards: rewardChoices(game), target: C.baseTarget[boss ? 'boss' : 'normal'] * C.weekMultipliers[game.week - 1],
      boss, sealedFace: boss && boss.type === 'diversity' ? sealedValue(game) : null,
      submissions: 0, damage: [], penaltyCount: 0, dustCount: 0
    };
    return true;
  }

  function selected(game, ids) {
    if (game.phase !== 'viewing' || !Array.isArray(ids) || !ids.length) return [];
    const keys = new Set(ids);
    if (keys.size !== ids.length) return [];
    const entries = game.view.remaining.filter(entry => keys.has(entry.id));
    return entries.length === keys.size ? entries : [];
  }

  function reroll(game, ids) {
    const entries = selected(game, ids);
    if (!entries.length || game.view.rerollsLeft <= 0) return [];
    game.view.rerollsLeft--;
    for (const entry of entries) {
      const die = game.dice.find(d => d.id === entry.id);
      entry.face = Core.randomInt(game, die.faces.length);
    }
    return [{ type: 'reroll', text: `주사위 ${entries.length}개를 다시 굴렸습니다.` }, ...Core.rerollEffects(game, entries.length)];
  }

  function recordDamage(view, trace, kind, text) {
    view.damage.push(text);
    trace.push({ type: 'boss', kind, text });
  }

  function steadyPenalty(game, oldSum, oldMult, trace) {
    const v = game.view, tier = v.boss.tier;
    if (v.sum - oldSum >= C.boss.steady.perWeek * game.week || v.mult > oldMult) return;
    if (!belowCap(v.penaltyCount, C.boss.steady.caps[tier])) return;
    if (tier === 0 ? !v.remaining.length : game.dice.length <= C.minimumDice) return;
    const chosen = choose(game, v.remaining.length ? v.remaining : game.dice);
    const remaining = v.remaining.find(entry => entry.id === chosen.id);
    if (remaining) v.removed.push({ id: chosen.id, value: Core.valueOf(game, remaining) });
    v.remaining = v.remaining.filter(entry => entry.id !== chosen.id);
    v.penaltyCount++;
    if (tier === 0) {
      recordDamage(v, trace, 'temporaryLoss', `주사위 #${chosen.id}을 이번 관람에서 제외했습니다.`);
    } else {
      game.dice = game.dice.filter(die => die.id !== chosen.id);
      recordDamage(v, trace, 'dieLost', `주사위 #${chosen.id}을 영구히 잃었습니다.`);
    }
  }

  function burstPenalty(game, trace) {
    const v = game.view, tier = v.boss.tier, b = C.boss.burst;
    if (v.submissions <= b.free[tier]) return;
    const sumLost = Math.min(v.sum, b.sum[tier]), multLost = Math.min(v.mult, b.mult[tier]);
    v.sum -= sumLost;
    v.mult -= multLost;
    if (sumLost || multLost) {
      const losses = [sumLost && `합 −${sumLost}`, multLost && `배율 −${multLost}`].filter(Boolean);
      recordDamage(v, trace, 'scoreLost', losses.join(', '));
    }
    if (!belowCap(v.dustCount, b.dustCaps[tier])) return;
    const neighbours = new Set();
    for (const source of Object.keys(game.board.relics)) {
      for (const pos of Core.targets(game.board, source, 'adjacent')) {
        if (!game.board.relics[pos] && !game.board.tokens[pos]) neighbours.add(pos);
      }
    }
    if (!neighbours.size) return;
    const pos = choose(game, [...neighbours].sort(Core.comparePos));
    v.dustCount++;
    recordDamage(v, trace, 'dust', `(${pos})에 먼지가 쌓였습니다.`);
    trace.push(...Core.createExternalToken(game, pos, 'dust'));
  }

  function diversityPenalty(game, blockedDice, trace) {
    const v = game.view, cap = C.boss.diversity.caps[v.boss.tier];
    recordDamage(v, trace, 'sealed', `봉인된 눈 ${v.sealedFace}을 내서 패턴이 무효가 되었습니다.`);
    if (!belowCap(v.penaltyCount, cap)) return;
    const chosen = choose(game, blockedDice);
    const die = game.dice.find(d => d.id === chosen.id);
    const replacement = choose(game, C.fairFaces.filter(n => n !== v.sealedFace));
    die.faces[chosen.face] = replacement;
    v.penaltyCount++;
    recordDamage(v, trace, 'faceChanged', `주사위 #${die.id}의 ${v.sealedFace} 면이 ${replacement}(으)로 바뀌었습니다.`);
  }

  function submit(game, ids) {
    const entries = selected(game, ids);
    if (!entries.length) return [];
    const v = game.view, selectedIds = new Set(ids);
    const values = entries.map(entry => Core.valueOf(game, entry));
    const blockedDice = entries.filter((_, index) => values[index] === v.sealedFace);
    const oldSum = v.sum, oldMult = v.mult;
    v.remaining = v.remaining.filter(entry => !selectedIds.has(entry.id));
    v.submitted.push(...entries.map((entry, i) => ({ id: entry.id, value: values[i] })));
    v.submissions++;
    const trace = [{ type: 'submit', text: `${values.join(' · ')} 제출` },
      ...Core.submitEffects(game, values, { sealed: blockedDice.length > 0 })];
    switch (v.boss && v.boss.type) {
      case 'steady': steadyPenalty(game, oldSum, oldMult, trace); break;
      case 'burst': burstPenalty(game, trace); break;
      case 'diversity': if (blockedDice.length) diversityPenalty(game, blockedDice, trace); break;
    }
    if (!v.remaining.length) trace.push(...endViewing(game));
    return trace;
  }

  function endViewing(game) {
    if (game.phase !== 'viewing') return [];
    const v = game.view;
    v.remaining = [];
    v.rerollsLeft = 0;
    const trace = Core.endEffects(game);
    const score = v.sum * (1 + v.mult), ratio = score / v.target;
    const tier = C.tipTiers.filter(t => ratio >= t.ratio).pop();
    const passed = score >= v.target;
    const result = {
      week: game.week, visitor: game.visitor, score, target: v.target, tip: tier.tip, grade: tier.name,
      passed, damage: [...v.damage], diceCount: game.dice.length
    };
    game.history.push(result);
    game.lastResult = result;
    game.money = money(game.money + tier.tip);
    if (v.boss && !passed) game.phase = 'lost';
    else if (v.boss && game.week === C.weeks) game.phase = 'won';
    else {
      game.phase = 'shop';
      game.shop = { stock: drawStock(game, Object.keys(Core.RELICS)), rewardDone: false };
    }
    trace.push({ type: 'end', text: `관람 종료 · 감동 ${score} · 팁 ${tier.tip}원` });
    return trace;
  }

  function projected(game) {
    if (game.phase === 'viewing') return Core.projectedScore(game);
    return { score: game.lastResult ? game.lastResult.score : 0, tokenSum: 0 };
  }

  function preview(game, ids) {
    // The history and stock of a simulated run never feed the rules for the current visitor.
    const scratch = { ...game, board: copy(game.board), dice: copy(game.dice), view: copy(game.view), history: [] };
    const trace = submit(scratch, ids);
    const byType = type => trace.filter(ev => ev.type === type).map(ev => ev.text);
    const count = kind => trace.filter(ev => ev.type === 'boss' && ev.kind === kind).length;
    return {
      ...projected(scratch), trace, patterns: byType('pattern'), warnings: byType('warning'),
      damage: byType('boss'), permanentLosses: count('dieLost'), permanentFaceChanges: count('faceChanged'),
      temporaryLosses: count('temporaryLoss'), newDust: count('dust')
    };
  }

  function cellPrice(game) {
    return C.cellPriceBase + C.cellPriceStep * (game.board.cells.length - C.startCells.length);
  }

  function validPos(pos) {
    if (typeof pos !== 'string') return false;
    const xy = pos.split(',').map(Number);
    return xy.length === 2 && xy.every(Number.isSafeInteger) && xy.join(',') === pos;
  }

  function buyCell(game, pos) {
    if (game.phase !== 'shop' || !validPos(pos) || game.board.cells.includes(pos)) return false;
    const price = cellPrice(game);
    if (game.money < price) return false;
    game.money = money(game.money - price);
    game.board.cells.push(pos);
    return true;
  }

  const emptyCell = (board, pos) => board.cells.includes(pos) && !board.relics[pos] && !board.tokens[pos];
  const validFacing = facing => Number.isInteger(facing) && facing >= 0 && facing < 4;

  function acquire(game, source, index, pos, facing = 0) {
    if (game.phase !== 'shop' || !Number.isInteger(index) || !validFacing(facing)) return false;
    if (!emptyCell(game.board, pos)) return false;
    const reward = source === 'reward';
    if (reward ? game.shop.rewardDone : source !== 'stock') return false;
    const id = (reward ? game.view.rewards : game.shop.stock)[index];
    const def = Core.RELICS[id];
    if (!def || (!reward && game.money < def.price)) return false;
    const item = Core.instance(id, def.facing ? facing : 0);
    if (reward) game.shop.rewardDone = true;
    else {
      game.shop.stock[index] = null;
      game.money = money(game.money - def.price);
    }
    game.board.relics[pos] = item;
    return true;
  }

  function declineReward(game) {
    if (game.phase !== 'shop' || game.shop.rewardDone) return false;
    game.shop.rewardDone = true;
    return true;
  }

  function moveRelic(game, from, to, facing) {
    if (game.phase !== 'shop' || !game.board.cells.includes(from)) return false;
    const item = game.board.relics[from];
    if (!item || (from !== to && !emptyCell(game.board, to))) return false;
    if (facing != null && !validFacing(facing)) return false;
    if (facing != null && Core.RELICS[item.id].facing) item.facing = facing;
    delete game.board.relics[from];
    game.board.relics[to] = item;
    return true;
  }

  function rotateRelic(game, pos) {
    if (game.phase !== 'shop' || !game.board.cells.includes(pos)) return false;
    const item = game.board.relics[pos];
    if (!item || !Core.RELICS[item.id].facing) return false;
    item.facing = (item.facing + 1) % 4;
    return true;
  }

  function sellRelic(game, pos) {
    if (game.phase !== 'shop' || !game.board.cells.includes(pos)) return false;
    const item = game.board.relics[pos];
    if (!item) return false;
    game.money = money(game.money + Core.RELICS[item.id].price * C.saleFraction);
    delete game.board.relics[pos];
    return true;
  }

  function compatible(game) {
    if (!game || game.rulesVersion !== RULES_VERSION || !Number.isSafeInteger(game.rng)) return false;
    if (!['intro', 'shop', 'viewing', 'lost', 'won'].includes(game.phase)) return false;
    if (!Number.isInteger(game.week) || game.week < 1 || game.week > C.weeks) return false;
    if (!Number.isInteger(game.visitor) || game.visitor < 1 || game.visitor > C.visitorsPerWeek) return false;
    const board = game.board;
    if (!board || !Array.isArray(board.cells) || !board.cells.every(validPos) || !board.relics || !board.tokens) return false;
    if (!Object.entries(board.relics).every(([p, r]) => board.cells.includes(p) && !board.tokens[p] && r && Core.RELICS[r.id])) return false;
    if (!Object.entries(board.tokens).every(([p, id]) => validPos(p) && Core.TOKENS[id])) return false;
    if (!Array.isArray(game.dice) || !game.dice.length ||
        !game.dice.every(die => die && Array.isArray(die.faces) && die.faces.length === C.fairFaces.length && die.faces.every(n => C.fairFaces.includes(n)))) return false;
    if (!Array.isArray(game.history) || !Array.isArray(game.schedule) || game.schedule.length !== C.weeks ||
        !game.schedule.every((b, i) => b && b.week === i + 1 && bossNames[b.type] && strengthNames[b.tier] === b.strength)) return false;
    if (game.phase === 'intro') return true;
    const v = game.view;
    if (!v || !Array.isArray(v.remaining) || !Array.isArray(v.submitted) || !Array.isArray(v.damage) ||
        !Array.isArray(v.thresholds) || !Array.isArray(v.rewards) || !v.rewards.every(id => Core.RELICS[id])) return false;
    if (!v.remaining.every(entry => Number.isInteger(entry.face) && entry.face >= 0 && entry.face < C.fairFaces.length && game.dice.some(d => d.id === entry.id))) return false;
    return game.phase !== 'shop' || (game.shop && Array.isArray(game.shop.stock) && game.shop.stock.every(id => id === null || Core.RELICS[id]));
  }

  function load(storage, seed) {
    try {
      const raw = storage.getItem(SAVE_KEY);
      if (raw !== null) {
        const game = JSON.parse(raw);
        if (compatible(game)) return game;
      }
    } catch { /* Some browsers restrict local storage on file URLs. */ }
    return newGame(seed);
  }

  function save(storage, game) {
    try {
      const old = storage.getItem(SAVE_KEY);
      if (old !== null) {
        let valid = false;
        try { valid = compatible(JSON.parse(old)); } catch { /* Preserve unreadable data as well. */ }
        if (!valid) {
          let suffix = 1;
          while (storage.getItem(SAVE_KEY + '-backup-' + suffix) !== null) suffix++;
          storage.setItem(SAVE_KEY + '-backup-' + suffix, old);
        }
      }
      storage.setItem(SAVE_KEY, JSON.stringify(game));
      return true;
    } catch { return false; }
  }

  return {
    RULES_VERSION, SAVE_KEY, bossEntry, newGame, startViewing, submit, reroll, endViewing, projected, preview,
    cellPrice, buyCell, acquire, declineReward, moveRelic, rotateRelic, sellRelic, save, load
  };
});
