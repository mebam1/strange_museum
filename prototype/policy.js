(function (root, makePolicy) {
  if (typeof module === 'object' && module.exports) {
    module.exports = makePolicy(require('./core.js'), require('./game.js'));
  } else {
    root.MuseumPolicy = makePolicy(root.MuseumCore, root.MuseumGame);
  }
})(globalThis, function (Core, Game) {
  'use strict';

  function chooseAction(game) {
    if (game.phase !== 'viewing') throw new Error('관람 중에만 제출을 고를 수 있습니다.');
    const ids = game.view.remaining.map(die => die.id);
    const policy = Core.CONFIG.auto;
    const maxSize = ids.length > policy.fullEnumerationLimit ? policy.maxSubsetSize : ids.length;
    const baseline = Game.projected(game).score;
    let bestGain = 0;
    let best = null;
    const picked = [];

    function explore(start) {
      for (let i = start; i < ids.length; i++) {
        picked.push(ids[i]);
        const result = Game.preview(game, picked);
        const gain = result.score - baseline
          - result.permanentLosses * policy.dieLossPenalty
          - result.permanentFaceChanges * policy.faceChangePenalty
          - result.newDust * policy.dustPenalty
          - (result.temporaryLosses || 0) * policy.temporaryLossPenalty
          - result.warnings.length * policy.warningPenalty;
        if (gain > bestGain || (gain === bestGain && best && picked.length < best.length)) {
          bestGain = gain;
          best = picked.slice();
        }
        if (picked.length < maxSize) explore(i + 1);
        picked.pop();
      }
    }

    explore(0);
    if (best) return { type: 'submit', ids: best };
    if (ids.length && game.view.rerollsLeft > 0) return { type: 'reroll', ids };
    return { type: 'end', ids: [] };
  }

  // Deterministic shop choices are shared by the full-run button and the simulator.
  // Prefer early sources of token value, then multipliers and additional sources.
  function shopPreference(game) {
    const owned = Object.values(game.board.relics).map(relic => relic.id);
    const priorities = [];
    if (!owned.includes('banker')) priorities.push('banker');
    if (!owned.includes('critic')) priorities.push('critic');
    if (owned.includes('banker') && !owned.includes('die_coin')) priorities.push('die_coin');
    if (!owned.includes('collector')) priorities.push('collector');
    priorities.push('banker', 'lamp', 'guide', 'critic', 'dairy', 'collector', 'scribe',
      'firework', 'alchemist', 'fidget', 'die_coin', 'die_cheese', 'die_scroll',
      'archivist', 'thief', 'curator', 'carver', 'sweeper');
    return priorities;
  }

  function nextShopPosition(board) {
    const available = pos => !board.relics[pos] && !board.tokens[pos];
    const owned = board.cells.find(available);
    if (owned) return { pos: owned, needsCell: false };
    // Fill a checkerboard around the entrance, leaving orthogonal spaces for tokens.
    for (let radius = 0; ; radius += 2) {
      for (let y = -radius; y <= radius; y++) {
        const distance = radius - Math.abs(y);
        for (const x of distance ? [-distance, distance] : [0]) {
          const pos = x + ',' + y;
          if (!board.cells.includes(pos) && available(pos)) return { pos, needsCell: true };
        }
      }
    }
  }

  function takeOffer(game, source, offers) {
    const priorities = shopPreference(game);
    const place = nextShopPosition(game.board);
    const cellCost = place.needsCell ? Game.cellPrice(game) : 0;
    const candidates = offers.map((id, index) => ({ id, index }))
      .filter(offer => offer.id && cellCost + (source === 'reward' ? 0 : Core.RELICS[offer.id].price) <= game.money)
      .sort((a, b) => priorities.indexOf(a.id) - priorities.indexOf(b.id));
    if (!candidates.length) return;
    if (place.needsCell && !Game.buyCell(game, place.pos)) throw new Error('자동 상점의 칸 구매 실패');
    if (!Game.acquire(game, source, candidates[0].index, place.pos)) throw new Error('자동 상점의 유물 배치 실패');
  }

  function step(game) {
    if (game.phase === 'intro') {
      Game.startViewing(game);
      return { type: 'start', trace: [] };
    }
    if (game.phase === 'shop') {
      if (!game.shop.rewardDone) {
        takeOffer(game, 'reward', game.view.rewards);
        if (!game.shop.rewardDone) Game.declineReward(game);
      }
      takeOffer(game, 'stock', game.shop.stock);
      Game.startViewing(game);
      return { type: 'shop', trace: [] };
    }
    if (game.phase === 'won' || game.phase === 'lost') return { type: 'done', trace: [] };
    const action = chooseAction(game);
    let trace;
    if (action.type === 'submit') trace = Game.submit(game, action.ids);
    else if (action.type === 'reroll') trace = Game.reroll(game, action.ids);
    else trace = Game.endViewing(game);
    return { ...action, trace };
  }

  function run(seed) {
    const game = Game.newGame(seed);
    while (game.phase !== 'won' && game.phase !== 'lost') step(game);
    return game;
  }

  return { chooseAction, step, run };
});
