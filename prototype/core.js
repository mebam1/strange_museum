/* DOM 없이 실행되는 관람 규칙. 상태 변경 함수는 화면에서 재생할 사건 기록을 반환한다. */
(function (root) {
  "use strict";
  const catalog = typeof module === "object" && module.exports ? require("./catalog.js") : root.MuseumCatalog;
  const {CONFIG, RELICS, TOKENS, PATTERNS} = catalog;
  const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  function random(game) {
    game.rng = (game.rng + 0x6d2b79f5) >>> 0;
    let bits = game.rng;
    bits = Math.imul(bits ^ (bits >>> 15), bits | 1);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  }
  function randomInt(game, count) {
    if (!Number.isInteger(count) || count < 1) throw new RangeError("추첨할 대상이 없습니다.");
    return Math.floor(random(game) * count);
  }
  function newDie(game) {
    return {id: game.nextDieId++, faces: [...CONFIG.fairFaces]};
  }
  function valueOf(game, rolled) {
    return game.dice.find(die => die.id === rolled.id).faces[rolled.face];
  }
  function instance(id, facing = 0) {
    const item = RELICS[id];
    if (!item) throw new Error("알 수 없는 유물 " + id);
    const result = {id, facing};
    if (item.charges !== undefined) result.charges = item.charges;
    return result;
  }
  function xy(pos) { return pos.split(",").map(Number); }
  function comparePos(a, b) {
    const [ax, ay] = xy(a);
    const [bx, by] = xy(b);
    return ay - by || ax - bx;
  }
  function targets(board, pos, scope, facing = 0) {
    const [x, y] = xy(pos);
    if (scope === "rowCol") {
      return board.cells.filter(cell => {
        const [cx, cy] = xy(cell);
        return cell !== pos && (cx === x || cy === y);
      }).sort(comparePos);
    }
    if (scope !== "adjacent" && scope !== "facing") return [];
    const offsets = scope === "facing" ? [directions[facing]] : directions;
    return offsets.map(([dx, dy]) => [x + dx, y + dy])
      .filter(pair => pair.every(Number.isSafeInteger))
      .map(pair => pair.join(",")).sort(comparePos);
  }

  // Compile the six-face assignments once per pattern. A signature represents
  // the entire multiset, so extra dice can never match a smaller pattern.
  const compiled = new Map();
  function conditionTest(clause) {
    if (!clause) return () => true;
    const compact = clause.replace(/\s/g, "");
    const comparison = /^([a-z](?:\+[a-z])*)(<=|>=|=|<|>)(\d+)$/.exec(compact);
    if (comparison) {
      const [, expr, op, literal] = comparison;
      return bindings => {
        const value = expr.split("+").reduce((a, key) => a + bindings[key], 0);
        const expected = Number(literal);
        switch (op) {
          case "=": return value === expected;
          case "<=": return value <= expected;
          case ">=": return value >= expected;
          case "<": return value < expected;
          case ">": return value > expected;
        }
      };
    }
    const prime = /^([a-z](?:\+[a-z])*)(?:가소수|isprime)$/.exec(compact);
    if (prime) return bindings => {
      const n = prime[1].split("+").reduce((total, key) => total + bindings[key], 0);
      for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
      return n >= 2;
    };
    throw new Error("지원하지 않는 패턴 조건 " + clause);
  }
  function compilePattern(pattern) {
    const syntax = /^\s*\[([^\]]+)\]\s*(?:where\s+(.+))?\s*$/.exec(pattern);
    if (!syntax) throw new Error("잘못된 제출 패턴 " + pattern);
    const accepts = conditionTest(syntax[2]);
    const variables = [];
    const terms = syntax[1].split(",").map(raw => {
      const term = raw.trim();
      if (/^[1-6]$/.test(term)) return {fixed: Number(term)};
      const parsed = /^([a-z])(?:\s*\+\s*(\d+))?$/.exec(term);
      if (!parsed || (parsed[2] && parsed[1] !== "n")) throw new Error("잘못된 패턴 항 " + term);
      const variable = parsed[1];
      if (!variables.includes(variable)) variables.push(variable);
      return {variable, offset: Number(parsed[2] || 0)};
    });
    const results = new Map();
    function enumerate(index, bindings, taken, weight) {
      if (index < variables.length) {
        for (const value of CONFIG.fairFaces) {
          const bit = 1 << value;
          if (bit & taken) continue;
          bindings[variables[index]] = value;
          enumerate(index + 1, bindings, taken | bit, weight + value);
        }
        return;
      }
      if (!accepts(bindings)) return;
      const faces = terms.map(term => term.fixed ?? (bindings[term.variable] + term.offset));
      if (faces.some(value => !CONFIG.fairFaces.includes(value))) return;
      const key = faces.sort().join("");
      if (!results.has(key) || weight > results.get(key).weight) {
        results.set(key, {weight, bindings: Object.freeze({...bindings})});
      }
    }
    enumerate(0, {}, 0, 0);
    return results;
  }
  function matchKey(pattern, key) {
    if (!compiled.has(pattern)) compiled.set(pattern, compilePattern(pattern));
    return compiled.get(pattern).get(key)?.bindings ?? null;
  }
  function matchPattern(pattern, values) {
    if (values.some(value => !CONFIG.fairFaces.includes(value))) return null;
    return matchKey(pattern, [...values].sort().join(""));
  }

  // A wave spans all exact matches of one submission. Positions identify relic
  // instances throughout a wave because a relic can disappear but cannot move.
  class Resolution {
    constructor(game) {
      this.game = game;
      this.board = game.board;
      this.view = game.view;
      this.order = Object.keys(this.board.relics).sort(comparePos);
      this.queue = [];
      this.reacted = new Map();
      this.deferred = [];
      this.trace = [];
      this.handled = 0;
    }
    log(type, text, details = {}) {
      this.trace.push({type, text, ...details});
    }
    limit() {
      this.handled++;
      if (this.handled <= CONFIG.eventLimit) return false;
      if (this.handled === CONFIG.eventLimit + 1) {
        const message = "사건 처리 한도 초과. 연쇄를 중단합니다.";
        console.warn(message);
        this.log("warning", message);
      }
      return true;
    }
    matches(trigger, event, pos, facing) {
      if (trigger.on !== event.on) return false;
      if (trigger.pattern && trigger.pattern !== event.pattern) return false;
      if (trigger.on === "threshold" && (trigger.stat !== event.stat || trigger.limit !== event.limit)) return false;
      if (trigger.token && trigger.token !== event.token) return false;
      if (trigger.tag && !TOKENS[event.token]?.tags.includes(trigger.tag)) return false;
      return !trigger.where || targets(this.board, pos, trigger.where, facing).includes(event.pos);
    }
    react(pos, event) {
      const item = this.board.relics[pos];
      if (!item || event.causes?.has(pos)) return;
      const definition = RELICS[item.id];
      if (!this.matches(definition.trigger, event, pos, item.facing)) return;
      const target = event.pos ?? event;
      if (!this.reacted.has(pos)) this.reacted.set(pos, new Set());
      const seen = this.reacted.get(pos);
      if (seen.has(target)) return;
      seen.add(target);
      const causes = new Set(event.causes);
      causes.add(pos);
      this.log("fire", definition.name + " 발동", {pos, id: item.id});
      const context = {pos, item, causes, bindings: event.bindings || {}, destroyed: 0};
      const applied = this.apply(definition.effects, context);
      if (applied) this.spendCharge(pos, item);
      this.queue.push({on: "relicFired", pos, id: item.id, causes});
    }
    drain() {
      for (let i = 0; i < this.queue.length; i++) {
        if (this.limit()) break;
        const event = this.queue[i];
        for (const pos of this.order) this.react(pos, event);
      }
      this.queue.length = 0;
    }
    spendCharge(pos, item) {
      if (item?.charges === undefined || this.board.relics[pos] !== item) return;
      if (--item.charges === 0) {
        delete this.board.relics[pos];
        this.log("removeRelic", RELICS[item.id].name + " 충전 소진", {pos, id: item.id});
      }
    }
    score(stat, amount, context) {
      if (!amount) return false;
      const before = this.view[stat];
      this.view[stat] += amount;
      this.log("score", (stat === "sum" ? "합 " : "배율 ") + (amount > 0 ? "+" : "") + amount,
        {pos: context.pos, stat, amount});
      for (const pos of this.order) {
        const item = this.board.relics[pos];
        if (!item) continue;
        const {trigger} = RELICS[item.id];
        if (trigger.on !== "threshold" || trigger.stat !== stat) continue;
        const key = stat + ":" + trigger.limit;
        if (before <= trigger.limit && this.view[stat] > trigger.limit && !this.view.thresholds.includes(key)) {
          this.view.thresholds.push(key);
          this.queue.push({on: "threshold", stat, limit: trigger.limit, causes: context.causes});
        }
      }
      return true;
    }
    create(pos, token, causes) {
      if (this.board.relics[pos] || this.board.tokens[pos]) return false;
      this.board.tokens[pos] = token;
      this.log("create", TOKENS[token].name + " 생성", {pos, id: token});
      this.queue.push({on: "tokenCreated", pos, token, causes});
      return true;
    }
    destroy(pos, token, context, perToken) {
      delete this.board.tokens[pos];
      this.log("destroy", TOKENS[token].name + " 파괴", {pos, id: token});
      this.queue.push({on: "tokenDestroyed", pos, token, causes: context.causes});
      this.apply(TOKENS[token].onDestroyed, {...context, pos, item: null});
      if (perToken) this.apply(perToken, context);
    }
    apply(effects, context) {
      let changed = false;
      for (const effect of effects) {
        const {pos, item, causes, bindings} = context;
        const amount = bindings[effect.amount] ?? effect.amount;
        switch (effect.type) {
          case "addSum":
          case "addMult":
            changed = this.score(effect.type === "addSum" ? "sum" : "mult", amount, context) || changed;
            break;
          case "gainReroll":
            this.view.rerollsLeft += amount;
            this.log("gainReroll", "리롤 +" + amount, {pos, amount});
            changed ||= !!amount;
            break;
          case "createToken":
            for (const dest of targets(this.board, pos, effect.scope, item?.facing)) {
              changed = this.create(dest, effect.token, causes) || changed;
            }
            break;
          case "destroyTokens":
            context.destroyed = 0;
            context.targetToken = effect.token;
            for (const dest of targets(this.board, pos, effect.scope, item?.facing)) {
              const token = this.board.tokens[dest];
              if (!token || (effect.token && token !== effect.token)) continue;
              if (effect.tag && !TOKENS[token].tags.includes(effect.tag)) continue;
              this.destroy(dest, token, context, effect.perToken);
              context.destroyed++;
              changed = true;
            }
            break;
          case "transformTokens":
            for (const dest of targets(this.board, pos, effect.scope, item?.facing)) {
              if (this.board.tokens[dest] !== effect.from) continue;
              this.board.tokens[dest] = effect.to;
              this.log("transform", TOKENS[effect.from].name + " → " + TOKENS[effect.to].name,
                {pos: dest, id: effect.to, from: effect.from});
              this.queue.push({on: "tokenTransformed", pos: dest, from: effect.from, token: effect.to, causes});
              changed = true;
            }
            break;
          case "grantDieIfDestroyed":
            if (context.destroyed >= effect.required) {
              this.game.dice.push(newDie(this.game));
              delete this.board.relics[pos];
              this.log("grantDie", "주사위 +1 · 다음 관람부터 사용", {pos, id: item.id});
              this.log("removeRelic", RELICS[item.id].name + " 소진", {pos, id: item.id});
              changed = true;
            } else {
              const name = TOKENS[context.targetToken]?.name || "토큰";
              this.log("warning", name + " " + context.destroyed + "개가 파괴되고 주사위는 얻지 못합니다.",
                {pos, id: item.id, count: context.destroyed, token: context.targetToken, required: effect.required});
            }
            break;
          case "changeFace":
            this.deferred.push({pos, item, value: bindings[effect.value] ?? effect.value});
            break;
          default:
            throw new Error("알 수 없는 효과 " + effect.type);
        }
      }
      return changed;
    }
    expire(lifetime) {
      const positions = Object.keys(this.board.tokens).sort(comparePos);
      for (const pos of positions) {
        const token = this.board.tokens[pos];
        if (TOKENS[token]?.lifetime !== lifetime) continue;
        this.log("vanish", TOKENS[token].name + " 소멸", {pos, id: token});
        delete this.board.tokens[pos];
        this.apply(TOKENS[token].onVanish, {pos, item: null, bindings: {}, causes: new Set()});
        this.drain();
      }
    }
    changeFaces() {
      for (const {pos, item, value} of this.deferred) {
        if (this.board.relics[pos] !== item) continue;
        const candidates = this.view.remaining.filter(die => valueOf(this.game, die) !== value);
        if (!candidates.length) continue;
        const choice = candidates[randomInt(this.game, candidates.length)];
        const die = this.game.dice.find(candidate => candidate.id === choice.id);
        const old = die.faces[choice.face];
        die.faces[choice.face] = value;
        this.log("changeFace", "주사위 면 " + old + " → " + value, {pos, id: item.id, die: die.id, old, value});
        this.spendCharge(pos, item);
      }
    }
  }

  function submitEffects(game, values, {sealed = false} = {}) {
    const wave = new Resolution(game);
    if (!sealed) {
      const key = [...values].sort().join("");
      const patterns = new Set(wave.order.map(pos => RELICS[game.board.relics[pos].id].trigger.pattern).filter(Boolean));
      // Display exact catalogue matches even if this museum owns no listener.
      for (const pattern of Object.keys(PATTERNS)) patterns.add(pattern);
      const events = new Map();
      for (const pattern of patterns) {
        const bindings = matchKey(pattern, key);
        if (!bindings) continue;
        const event = {on: "submit", pattern, bindings};
        events.set(pattern, event);
        wave.log("pattern", PATTERNS[pattern] || pattern, {pattern, bindings});
        if (wave.limit()) break;
      }
      // Distinct patterns share a root. Interleave their listeners in board
      // order before processing the child events generated by any listener.
      for (const pos of wave.order) {
        const item = game.board.relics[pos];
        const event = item && events.get(RELICS[item.id].trigger.pattern);
        if (event) wave.react(pos, event);
      }
      wave.drain();
    }
    wave.expire("submission");
    wave.changeFaces();
    return wave.trace;
  }
  function resolveEvent(game, event) {
    const wave = new Resolution(game);
    wave.queue.push(event);
    wave.drain();
    wave.changeFaces();
    return wave.trace;
  }
  function rerollEffects(game, count) {
    return resolveEvent(game, {on: "reroll", count});
  }
  function createExternalToken(game, pos, id) {
    const wave = new Resolution(game);
    wave.create(pos, id, new Set());
    wave.drain();
    wave.changeFaces();
    return wave.trace;
  }
  function endEffects(game) {
    const wave = new Resolution(game);
    wave.expire("viewing");
    wave.changeFaces();
    return wave.trace;
  }
  function projectedScore(game) {
    const {sum, mult} = game.view;
    if (!Object.values(game.board.tokens).some(id => TOKENS[id].lifetime === "viewing")) {
      return {tokenSum: 0, score: sum * (1 + mult)};
    }
    // A token can cross the critic's threshold at closing. Simulate the same
    // expiry on an isolated rules state so the estimate includes that response.
    const shadow = JSON.parse(JSON.stringify({board: game.board, dice: game.dice, rng: game.rng,
      nextDieId: game.nextDieId, view: {sum, mult, thresholds: game.view.thresholds,
        remaining: game.view.remaining, rerollsLeft: game.view.rerollsLeft}}));
    endEffects(shadow);
    return {tokenSum: shadow.view.sum - sum, score: shadow.view.sum * (1 + shadow.view.mult)};
  }

  const api = {...catalog, random, randomInt, newDie, instance, matchPattern, submitEffects, rerollEffects,
    endEffects, projectedScore, targets, comparePos, valueOf, resolveEvent, createExternalToken};
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MuseumCore = api;
})(globalThis);
