/* 규칙 v12 카탈로그와 프로토타입 시험값. */
(function (root) {
  "use strict";

  const CONFIG = {
    rulesVersion: 5, weeks: 8, visitorsPerWeek: 3,
    fairFaces: [1, 2, 3, 4, 5, 6], startDice: 6, minimumDice: 1, rerolls: 8,
    startMoney: 24, startCells: ["0,0", "2,0", "1,1"],
    startRelics: {"0,0": "guide", "2,0": "lamp"},
    cellPriceBase: 4, cellPriceStep: 2, saleFraction: 0.1, slots: 3, rewardDiceChance: 0.5,
    baseTarget: {normal: 20, boss: 40}, weekMultipliers: [1, 1.6, 2.5, 3.8, 5.5, 8, 11, 15],
    tipTiers: [
      {ratio: 0, name: "매우 나쁨", tip: 4}, {ratio: 0.25, name: "나쁨", tip: 8},
      {ratio: 0.6, name: "보통", tip: 14}, {ratio: 1, name: "좋음", tip: 22},
      {ratio: 1.6, name: "아주 좋음", tip: 32}
    ],
    boss: {
      strengthWeeks: [2, 6],
      steady: {perWeek: 2, caps: [1, 2, null]},
      burst: {free: [3, 2, 2], sum: [3, 5, 8], mult: [0, 1, 1], dustCaps: [0, 2, null]},
      diversity: {caps: [0, 2, null]}
    },
    eventLimit: 1000,
    auto: {fullEnumerationLimit: 12, maxSubsetSize: 6, dieLossPenalty: 10000,
      faceChangePenalty: 8, dustPenalty: 5, warningPenalty: 10, temporaryLossPenalty: 3}
  };

  const PATTERNS = {
    "[x]": "주사위 하나", "[x,x]": "같은 눈 둘", "[x,x,x]": "같은 눈 셋",
    "[x,y]": "서로 다른 눈 둘", "[x,y] where x+y=7": "합이 7인 서로 다른 눈 둘",
    "[n,n+1,n+2]": "연속된 눈 셋", "[x,x,y,y]": "서로 다른 두 쌍"
  };

  const sum = amount => ({type: "addSum", amount});
  const mult = amount => ({type: "addMult", amount});
  const submit = pattern => ({on: "submit", pattern});
  const create = (token, scope = "adjacent") => ({type: "createToken", token, scope});
  const destroy = token => ({type: "destroyTokens", token, scope: "adjacent"});
  const token = (id, name, tags, lifetime, onVanish, description) =>
    ({id, name, tags, lifetime, onVanish, onDestroyed: [], description});

  const tokenList = [
    token("coin", "동전", ["보석"], "viewing", [sum(5)], "관람이 끝나면 합 +5"),
    token("ingot", "금괴", ["보석"], "viewing", [sum(15)], "관람이 끝나면 합 +15"),
    token("cheese", "치즈", ["음식"], "viewing", [sum(3)], "관람이 끝나면 합 +3"),
    token("scroll", "문서", ["문서"], "viewing", [sum(4)], "관람이 끝나면 합 +4"),
    token("spark", "불꽃", [], "submission", [mult(1)], "제출이 끝나면 배율 +1"),
    token("dust", "먼지", [], "persistent", [], "치울 때까지 이 자리를 차지합니다.")
  ];
  const TOKENS = Object.fromEntries(tokenList.map(item => [item.id, item]));

  function relic(id, name, price, trigger, effects, effectText, extra = {}) {
    const triggerText = extra.triggerText || PATTERNS[trigger.pattern] + " 제출";
    return {id, name, price, kind: "normal", tags: [], trigger, effects, triggerText, effectText,
      description: triggerText + " · " + effectText, ...extra};
  }
  function dieRelic(id, name, pattern, tokenId, required) {
    const targetName = TOKENS[tokenId].name;
    return relic(id, name, 20, submit(pattern), [destroy(tokenId), {type: "grantDieIfDestroyed", required}],
      `인접한 ${targetName} 모두 파괴. 한 번에 ${required}개 이상이면 주사위 하나를 얻고 이 유물은 사라집니다.`,
      {kind: "dice"});
  }
  const relicList = [
    relic("guide", "안내원", 12, submit("[x]"), [sum("x")], "낸 눈만큼 합 증가"),
    relic("lamp", "조명", 16, submit("[x,x]"), [mult(1)], "배율 +1"),
    relic("banker", "금고지기", 18, submit("[x,x]"), [create("coin")], "인접한 빈자리마다 동전 생성"),
    relic("alchemist", "연금술사", 22, submit("[x,x,x]"),
      [{type: "transformTokens", from: "coin", to: "ingot", scope: "adjacent"}], "인접한 동전을 모두 금괴로 변형"),
    relic("thief", "좀도둑", 20, submit("[x,y] where x+y=7"),
      [{...destroy("ingot"), perToken: [sum(30)]}], "인접한 금괴를 모두 파괴하고 하나당 합 +30"),
    relic("dairy", "낙농가", 16, submit("[x,x]"), [create("cheese")], "인접한 빈자리마다 치즈 생성"),
    relic("scribe", "필경사", 14, submit("[x,y]"), [create("scroll", "facing")], "바라보는 빈자리에 문서 생성", {facing: true}),
    relic("archivist", "기록 보관인", 22, submit("[n,n+1,n+2]"), [create("scroll", "rowCol")],
      "같은 행·열의 구매한 빈칸마다 문서 생성"),
    relic("collector", "수집가", 20, {on: "tokenCreated"}, [sum(2)], "합 +2", {triggerText: "어디서든 토큰이 생성될 때마다"}),
    relic("curator", "학예사", 22, {on: "tokenDestroyed", where: "adjacent"}, [mult(1)], "배율 +1",
      {triggerText: "인접한 토큰이 파괴될 때마다"}),
    relic("critic", "평론가", 20, {on: "threshold", stat: "sum", limit: 30}, [mult(2)], "배율 +2",
      {triggerText: "한 관람에서 합이 처음으로 30을 넘을 때"}),
    relic("fidget", "안절부절", 14, {on: "reroll"}, [sum(2)], "합 +2", {triggerText: "리롤할 때마다"}),
    relic("sweeper", "청소부", 10, submit("[x]"), [destroy("dust")], "인접한 먼지 모두 파괴"),
    relic("firework", "폭죽 장수", 20, submit("[x,x,y,y]"), [create("spark")], "인접한 빈자리마다 불꽃 생성"),
    relic("carver", "조각칼", 24, submit("[x,x,x]"), [{type: "changeFace", value: "x"}],
      "남은 주사위 하나의 현재 면을 제출한 눈으로 영구 교체", {charges: 6}),
    dieRelic("die_coin", "환전상", "[x,x]", "coin", 2),
    dieRelic("die_scroll", "사서", "[x,x,x]", "scroll", 2),
    dieRelic("die_cheese", "미식가", "[x,x,y,y]", "cheese", 3)
  ];
  const RELICS = Object.fromEntries(relicList.map(item => [item.id, item]));
  const api = {CONFIG, PATTERNS, TOKENS, RELICS};
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MuseumCatalog = api;
})(globalThis);
