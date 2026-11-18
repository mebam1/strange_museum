const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");

function museum(layout = {}, rolls = [1, 2, 3, 4, 5, 6], empty = []) {
  const game = {
    rng: 17, nextDieId: 1, dice: [],
    board: {cells: [...Object.keys(layout), ...empty], relics: {}, tokens: {}},
    view: {remaining: [], thresholds: [], sum: 0, mult: 0, rerollsLeft: C.CONFIG.rerolls}
  };
  for (const [pos, id] of Object.entries(layout)) game.board.relics[pos] = C.instance(id);
  for (const eye of rolls) {
    const die = C.newDie(game);
    game.dice.push(die);
    game.view.remaining.push({id: die.id, face: die.faces.indexOf(eye)});
  }
  return game;
}
function give(game, values) {
  for (const eye of values) {
    const index = game.view.remaining.findIndex(entry => C.valueOf(game, entry) === eye);
    assert.notEqual(index, -1);
    game.view.remaining.splice(index, 1);
  }
  return C.submitEffects(game, values);
}
function finishedScore(game) {
  C.endEffects(game);
  return game.view.sum * (1 + game.view.mult);
}

test("정확한 패턴 · 숫자, 다른 변수, 항 수와 순서", () => {
  for (const pattern of ["[2,2]", "[x,x]", "[2,x]"]) assert.ok(C.matchPattern(pattern, [2, 2]), pattern);
  assert.deepEqual(C.matchPattern("[2,x]", [2, 2]), {x: 2});
  for (const pattern of ["[x,y]", "[2]", "[x]", "[2,2,2]"]) assert.equal(C.matchPattern(pattern, [2, 2]), null, pattern);
  assert.ok(C.matchPattern("[x,x,y,y]", [3, 5, 3, 5]));
  assert.equal(C.matchPattern("[x,x,x,y]", [3, 3, 5, 5]), null);
  assert.deepEqual(C.matchPattern("[n,n+1,n+2]", [4, 2, 3]), {n: 2});
  assert.equal(C.matchPattern("[n,n+1,n+2]", [5, 6, 1]), null);
  assert.ok(C.matchPattern("[x,y] where x+y=7", [1, 6]));
  assert.equal(C.matchPattern("[x,y] where x+y=7", [2, 6]), null);
  assert.ok(C.matchPattern("[x,y] where x + y가 소수", [5, 6]));
});

test("9개 인접 반응 유물의 고리 · 이웃 대상마다 한 번 이하", () => {
  C.RELICS.echoTest = {name: "시험 메아리", trigger: {on: "relicFired", where: "adjacent"},
    effects: [{type: "addSum", amount: 1}]};
  try {
    const layout = {};
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) layout[x + "," + y] = "echoTest";
    const game = museum(layout);
    const trace = C.resolveEvent(game, {on: "relicFired", pos: "1,1", causes: new Set(["1,1"])});
    assert.ok(trace.every(event => event.type !== "warning"));
    for (const pos of Object.keys(layout)) {
      const degree = C.targets(game.board, pos, "adjacent").filter(adjacent => layout[adjacent]).length;
      const fires = trace.filter(event => event.type === "fire" && event.pos === pos).length;
      if (pos === "1,1") assert.equal(fires, 0);
      else assert.ok(fires > 0 && fires <= degree, pos + " / " + fires);
    }
  } finally { delete C.RELICS.echoTest; }
});

test("인접 생성은 유물과 기존 토큰을 건너뛰고 미구매 자리를 사용한다", () => {
  const game = museum({"0,0": "banker", "0,-1": "collector"});
  game.board.tokens["1,0"] = "scroll";
  const trace = C.submitEffects(game, [2, 2]);
  assert.deepEqual(game.board.tokens, {"1,0": "scroll", "-1,0": "coin", "0,1": "coin"});
  assert.equal(game.view.sum, 4);
  assert.deepEqual(trace.filter(e => e.type === "create").map(e => e.pos), ["-1,0", "0,1"]);
  C.submitEffects(game, [4, 4]);
  assert.equal(game.view.sum, 4);
});

test("방향은 회전을 따르고 행·열은 먼 구매 빈칸까지 포함한다", () => {
  const game = museum({"0,0": "archivist", "0,3": "guide", "1,1": "scribe"},
    [], ["-12,0", "0,-8", "3,4", "7,0"]);
  game.board.tokens["7,0"] = "dust";
  C.submitEffects(game, [2, 3, 4]);
  assert.deepEqual(game.board.tokens, {"7,0": "dust", "-12,0": "scroll", "0,-8": "scroll"});
  game.board.relics["1,1"].facing = 1;
  C.submitEffects(game, [1, 2]);
  assert.equal(game.board.tokens["2,1"], "scroll");
});

for (const [parts, expected] of [
  [[[2, 2], [4, 4, 4], [6]], 70],
  [[[2, 2], [4, 4], [4], [6]], 45],
  [[[4, 4, 4], [2, 2], [6]], 30],
  [[[2, 2, 4, 4, 4], [6]], 0]
]) {
  test("같은 굴림을 분할한 순서 " + JSON.stringify(parts) + " → 감동 " + expected, () => {
    const game = museum({"0,0": "banker", "1,1": "alchemist", "0,-1": "lamp"}, [2, 2, 4, 4, 4, 6]);
    for (const values of parts) give(game, values);
    assert.equal(game.view.remaining.length, 0);
    assert.equal(C.projectedScore(game).score, expected);
    assert.equal(finishedScore(game), expected);
    assert.deepEqual(game.board.tokens, {});
  });
}

test("미식가 · 치즈 세 개를 한 번에 파괴하면 다음 관람의 주사위 +1", () => {
  const game = museum({"0,0": "dairy", "2,0": "dairy", "1,1": "die_cheese"}, [1, 1, 3, 3, 5, 5]);
  give(game, [1, 1]);
  const trace = give(game, [3, 3, 5, 5]);
  assert.equal(trace.filter(event => event.type === "destroy").length, 3);
  assert.equal(game.board.relics["1,1"], undefined);
  assert.equal(game.dice.length, 7);
  assert.deepEqual(game.dice.at(-1).faces, [1, 2, 3, 4, 5, 6]);
  assert.equal(game.view.remaining.length, 0);
});

test("미식가 · 역순으로 제출하거나 두 개만 파괴하면 주사위를 얻지 못한다", () => {
  const game = museum({"0,0": "dairy", "2,0": "dairy", "1,1": "die_cheese"}, [1, 1, 3, 3, 5, 5]);
  const early = give(game, [3, 3, 5, 5]);
  assert.equal(early.find(event => event.type === "warning").count, 0);
  give(game, [1, 1]);
  assert.ok(game.board.relics["1,1"]);
  assert.equal(game.dice.length, 6);
  const fewer = museum({"0,0": "die_cheese"}, [1, 1, 3, 3, 5, 5]);
  Object.assign(fewer.board.tokens, {"-1,0": "cheese", "1,0": "cheese", "0,1": "coin"});
  const trace = give(fewer, [3, 3, 5, 5]);
  assert.equal(trace.find(event => event.type === "warning").count, 2);
  assert.equal(fewer.dice.length, 6);
  assert.deepEqual(fewer.board.tokens, {"0,1": "coin"});
});

test("조각칼 · 실제로 바꾼 물리적 면만 영구 교체하고 충전을 쓴다", () => {
  const game = museum({"0,0": "carver"}, [3, 3, 3, 3, 5, 6]);
  const before = structuredClone(game.dice);
  const change = give(game, [3, 3, 3]).find(event => event.type === "changeFace");
  assert.ok([5, 6].includes(change.old));
  assert.equal(change.value, 3);
  assert.equal(game.board.relics["0,0"].charges, 5);
  const altered = game.dice.flatMap((die, index) => die.faces.filter((eye, side) => eye !== before[index].faces[side]));
  assert.deepEqual(altered, [3]);
  assert.equal(game.view.remaining.filter(rolled => C.valueOf(game, rolled) === 3).length, 2);
  const identical = museum({"0,0": "carver"}, [3, 3, 3, 3, 3, 3]);
  const rng = identical.rng;
  give(identical, [3, 3, 3]);
  assert.equal(identical.board.relics["0,0"].charges, 6);
  assert.equal(identical.rng, rng);
  const last = museum({"0,0": "carver"}, [3, 3, 3, 4]);
  last.board.relics["0,0"].charges = 1;
  give(last, [3, 3, 3]);
  assert.equal(last.board.relics["0,0"], undefined);
});

test("같은 제출의 서로 다른 패턴도 유물의 판 위 순서로 반응한다", () => {
  const game = museum({"2,0": "scribe", "1,0": "thief", "0,0": "scribe"});
  const fires = C.submitEffects(game, [6, 1]).filter(event => event.type === "fire");
  assert.deepEqual(fires.map(event => event.pos), ["0,0", "1,0", "2,0"]);
});

test("같은 패턴의 생산과 수확도 배치 순서를 따른다", () => {
  for (const [producer, consumer, earned] of [["0,0", "1,1", true], ["1,1", "0,0", false]]) {
    const game = museum({[producer]: "banker", [consumer]: "die_coin"});
    C.submitEffects(game, [2, 2]);
    assert.equal(game.dice.length, earned ? 7 : 6);
  }
});

test("소멸은 파괴와 다르고, 불꽃은 제출 종료·먼지는 지속·변형은 양쪽 효과를 건너뛴다", () => {
  const game = museum({"0,0": "firework", "-1,-1": "curator", "3,1": "alchemist", "4,0": "thief"});
  Object.assign(game.board.tokens, {"3,0": "coin", "-2,-2": "dust"});
  C.submitEffects(game, [2, 2, 3, 3]);
  assert.equal(game.view.mult, 4);
  C.submitEffects(game, [3, 3, 3]);
  assert.equal(game.view.sum, 0);
  assert.equal(game.board.tokens["3,0"], "ingot");
  C.submitEffects(game, [1, 6]);
  assert.equal(game.view.sum, 30);
  C.endEffects(game);
  assert.deepEqual(game.board.tokens, {"-2,-2": "dust"});
});

test("종료 미리보기가 토큰 소멸로 넘는 임계값까지 반영하고 원본을 보존한다", () => {
  const game = museum({"0,0": "critic", "1,0": "critic"});
  game.view.sum = 25;
  Object.assign(game.board.tokens, {"0,1": "coin", "0,2": "cheese"});
  const before = structuredClone(game);
  assert.deepEqual(C.projectedScore(game), {tokenSum: 8, score: 165});
  assert.deepEqual(game, before);
  const trace = C.endEffects(game);
  assert.deepEqual(trace.filter(e => e.type === "vanish").map(e => e.id), ["coin", "cheese"]);
  assert.deepEqual(trace.filter(e => e.type === "fire").map(e => e.pos), ["0,0", "1,0"]);
  assert.deepEqual(game.view.thresholds, ["sum:30"]);
  game.view.sum = 30;
  C.createExternalToken(game, "2,0", "coin");
  C.endEffects(game);
  assert.equal(game.view.mult, 4);
});

test("리롤과 외부 토큰 생성도 같은 바구니에 사건을 전달한다", () => {
  const game = museum({"0,0": "fidget", "1,0": "collector", "2,0": "sweeper", "4,0": "curator"});
  C.rerollEffects(game, 5);
  assert.equal(game.view.sum, 2);
  C.createExternalToken(game, "3,0", "dust");
  C.createExternalToken(game, "3,0", "dust");
  assert.equal(game.view.sum, 4);
  C.submitEffects(game, [1]);
  assert.equal(game.view.mult, 1);
});
