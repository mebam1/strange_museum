(() => {
  'use strict';
  const C = MuseumCore, G = MuseumGame, P = MuseumPolicy, B = MuseumBoard;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const icon = (name, color = false) => '<i data-icon="' + esc(name) + '"' + (color ? ' data-color' : '') + '></i>';
  const btn = (action, name, style = '', disabled = false) => '<button class="btn ' + style + '" data-action="' + action + '"' + (disabled ? ' disabled' : '') + '>' + name + '</button>';
  const head = (name, symbol, right = '') => '<div class="section-head"><div>' + icon(symbol) + '<h2>' + name + '</h2></div>' + right + '</div>';
  const quiet = text => '<span class="quiet">' + text + '</span>';
  const panel = html => '<section class="panel">' + html + '</section>';
  const point = pos => '(' + esc(pos?.replace(',', ', ')) + ')';
  const terminal = () => game.phase === 'lost' || game.phase === 'won';
  let storage;
  try { storage = window.localStorage; } catch { /* The status line reports unavailable storage. */ }
  let game = G.load(storage), chosen = new Set(), focus = null, held = null, prediction = null;
  let lastTrace = [], animation = null, animationTimer, auto = '', autoTimer, messageTimer;
  function save() {
    $('save-status').textContent = G.save(storage, game) ? '●  자동 저장됨' : '자동 저장 불가 · 이 브라우저의 저장 권한을 확인하세요.';
  }
  function say(text) {
    clearTimeout(messageTimer);
    $('feedback').textContent = text;
    messageTimer = setTimeout(() => { $('feedback').textContent = ''; }, 2600);
  }
  function dialog(title, html) {
    $('dialog-title').textContent = title;
    $('dialog-body').innerHTML = html;
    MuseumSymbols.render($('dialog'));
    if (!$('dialog').open) $('dialog').showModal();
  }
  function schedule() {
    return '<ol class="schedule">' + game.schedule.map(b =>
      '<li><span class="week-no">' + b.week + '주</span><div><strong>' + esc(b.name) + '</strong><span class="badge tier-' + b.tier + '">' + esc(b.strength) + '</span><p>' + esc(b.rule) + '</p></div></li>'
    ).join('') + '</ol>';
  }
  function inventory() {
    const field = (name, n, unit) => '<div class="stat"><span>' + name + '</span><strong>' + n + '<small>' + unit + '</small></strong></div>';
    return '<div class="inventory">' + field('운영 자금', game.money, '원') + field('주사위', game.dice.length, '개') + field('소장 유물', Object.keys(game.board.relics).length, '점') + '</div>';
  }
  function itemCard(id, action, suffix = '', disabled = false) {
    if (!id) return '<div class="empty-offer">판매 완료</div>';
    const r = C.RELICS[id];
    const isOffer = action.startsWith('reward-') || action.startsWith('stock-');
    const active = held?.action === action;
    return '<button class="item-card' + (active ? ' chosen' : '') + '" data-action="' + action + '"' +
      (isOffer && !disabled ? ' draggable="true"' : '') + (disabled ? ' disabled' : '') + '><span class="icon-well">' + icon(id, true) +
      '</span><span class="item-text"><strong>' + r.name + '</strong><small>' + r.triggerText + ' · ' + r.effectText +
      '</small></span>' + (suffix ? '<span class="price">' + suffix + '</span>' : '') + '</button>';
  }
  function renderHeadline() {
    const v = game.view, phase = game.phase;
    const [title, desc] = phase === 'intro' ? ['개관 준비','여덟 주 동안 전시실을 운영하고, 매주 세 번째 관객의 평가를 통과하세요.'] :
      phase === 'viewing' ? [v.boss ? '평가 담당자 관람' : '일반 관객 관람', v.boss ? v.boss.name + ' 평가 · ' + v.boss.strength + ' 단계' : '주사위를 나눠 제출해 유물을 발동시키세요.'] :
      phase === 'shop' ? ['전시 정비','관람이 끝났습니다. 다음 관객이 오기 전에 유물을 고르고 전시실을 정비하세요.'] :
      phase === 'won' ? ['최종 평가 통과','여덟 주의 전시를 마쳤습니다.'] : ['전시 종료','이번 주 평가 담당자의 감동이 기준에 미치지 못했습니다.'];
    let actions = '';
    if (auto) actions = btn('stop','자동 진행 멈추기','large');
    else if (phase === 'intro') actions = btn('auto-run','런 자동 진행') + btn('start','첫 관객 맞이하기 ' + icon('arrow'),'primary large');
    else if (phase === 'shop') actions = btn('auto-run','런 자동 진행') + btn('start',(game.shop.rewardDone ? '다음 관객 맞이하기 ' : '무료 보상 건너뛰고 다음 관람 ') + icon('arrow'),'primary large');
    else if (phase === 'viewing') actions = inventory();
    else if (terminal()) actions = btn('new','새 전시 시작 ' + icon('arrow'),'primary large');
    $('headline').innerHTML = '<div><span class="topline">' + (phase === 'intro' ? '전시 운영실' : game.week + '주차 · 관객 ' + game.visitor + ' / ' + C.CONFIG.visitorsPerWeek) + '</span><h1>' + title + '</h1><p>' + desc + '</p></div><div class="title-actions">' + actions + '</div>';
  }
  function remainingGoal(id, pos) {
    const def = C.RELICS[id];
    if (def.kind !== 'dice') return '';
    const destroy = def.effects.find(e => e.type === 'destroyTokens'), grant = def.effects.find(e => e.type === 'grantDieIfDestroyed');
    const count = C.targets(game.board, pos, 'adjacent').filter(p => game.board.tokens[p] === destroy.token).length;
    return '인접 ' + C.TOKENS[destroy.token].name + ' ' + count + '/' + grant.required + '개';
  }
  function detail() {
    const el = $('board-detail');
    if (held) {
      const def = C.RELICS[held.id];
      const message = held.source === 'cell' ? '사려는 자리를 누르세요. 떨어진 자리도 구매할 수 있습니다.' :
        '구매한 빈칸을 눌러 배치하세요.' + (def.facing ? ' 현재 방향 ' + ['↑','→','↓','←'][held.facing] : '');
      el.innerHTML = '<div class="detail-title"><strong>' + (def?.name || '칸 구매 · ' + G.cellPrice(game) + '원') + '</strong></div><p class="detail-copy">' + message + '</p><div class="inline-actions">' +
        (def?.facing ? btn('rotate','회전 R','small') : '') + btn('cancel','취소 Esc','small') + '</div>';
    } else if (focus) {
      const inst = game.board.relics[focus], token = game.board.tokens[focus], owned = game.board.cells.includes(focus);
      const def = inst ? C.RELICS[inst.id] : C.TOKENS[token];
      const info = [def?.description || (owned ? '상점에서 유물을 놓을 수 있습니다.' : '상점에서 구매할 수 있는 자리입니다.')];
      if (inst?.charges != null) info.push('남은 충전 ' + inst.charges + '회');
      if (inst?.id && remainingGoal(inst.id,focus)) info.push(remainingGoal(inst.id,focus));
      if (token) info.push(owned ? '구매한 칸' : '미구매 자리');
      let actions = '';
      if (game.phase === 'shop') {
        if (inst) actions = btn('move','이동','small') + (def.facing ? btn('rotate','회전 R','small') : '') + btn('sell','판매 · ' + (Math.round(def.price * C.CONFIG.saleFraction * 10)/10) + '원','small');
        else if (!owned) actions = btn('buy-here','이 칸 구매 · ' + G.cellPrice(game) + '원','small',game.money < G.cellPrice(game));
      }
      el.innerHTML = '<div class="detail-title"><strong>' + (def?.name || (owned ? '구매한 빈칸' : '미구매 자리')) + '</strong><small>' + point(focus) + '</small></div><p class="detail-copy">' + info.join(' · ') + '</p>' + (actions ? '<div class="inline-actions">' + actions + '</div>' : '');
    } else { el.innerHTML = ''; }
  }
  function renderBoard() {
    const board = animation?.board || game.board;
    $('board-count').textContent = '구매한 칸 ' + game.board.cells.length + '개';
    B.render({board, focus, held, shop:game.phase === 'shop' && !auto, flash:animation?.pos,
      forecast:prediction?.trace.filter(ev => ev.pos && ['fire','create','destroy','vanish','transform'].includes(ev.type)).map(ev => ev.pos)});
    detail();
  }
  const pipPlaces = [[],[5],[1,9],[1,5,9],[1,3,7,9],[1,3,5,7,9],[1,3,4,6,7,9]];
  function pips(value) {
    return '<span class="pips" aria-hidden="true">' + pipPlaces[value].map(n => '<b style="grid-area:' + (Math.floor((n-1)/3)+1) + '/' + ((n-1)%3+1) + '"></b>').join('') + '</span>';
  }
  function diceTray() {
    const v = game.view;
    const dice = v.remaining.map(e => {
      const value = C.valueOf(game,e), faces = game.dice.find(d => d.id === e.id).faces.join(' · ');
      return '<button class="die" data-action="die-' + e.id + '" aria-pressed="' + chosen.has(e.id) + '" aria-label="주사위 ' + e.id + ', ' + value + ' 눈" title="#' + e.id + ' · 면 ' + faces + '"' + (auto ? ' disabled' : '') + '>' + pips(value) + '</button>';
    }).join('');
    const spent = entries => entries.map(e => '<span class="mini-die" title="주사위 ' + e.id + '">' + e.value + '</span>').join('');
    const mobilePrediction = prediction ? '<div class="mobile-prediction"><b>제출 후 감동 ' + prediction.score + ' / ' + v.target + '</b> · ' + (prediction.patterns.map(esc).join(', ') || '일치 패턴 없음') +
      [...prediction.warnings,...prediction.damage].map(s=>'<p class="warning">' + esc(s) + '</p>').join('') + '</div>' : '';
    return head('주사위 선택','dice',quiet('남은 주사위 ' + v.remaining.length + '개')) + '<div class="tray"><div class="dice-row">' + dice + '</div><div class="consumed">제출한 주사위 ' + (spent(v.submitted) || '없음') + (v.removed.length ? ' · 평가로 제외 ' + spent(v.removed) : '') + '</div>' + mobilePrediction + '<div class="action-line">' +
      btn('submit','선택 제출' + (chosen.size ? ' · ' + chosen.size + '개' : ''),'primary',!chosen.size || !!auto) +
      btn('reroll',icon('replay') + '리롤 · ' + v.rerollsLeft,'',!chosen.size || !v.rerollsLeft || !!auto) +
      btn(auto ? 'stop' : 'auto-view',auto ? '자동 멈춤' : '자동 플레이','',false) +
      '<button class="text-btn" data-action="end"' + (auto ? ' disabled' : '') + '>조기 종료</button></div></div>';
  }
  function offers(source, list) {
    return list.map((id,index) => itemCard(id,source + '-' + index,source === 'stock' && id ? C.RELICS[id].price + '원' : '',source === 'stock' && id && game.money < C.RELICS[id].price)).join('');
  }
  function controls() {
    let html;
    if (game.phase === 'intro') {
      html = head('시작 유물','museum',quiet('소장품 2점')) + '<div class="starter-cards">' + Object.entries(game.board.relics).map(([pos,r])=>itemCard(r.id,'inspect-' + pos)).join('') + '</div><p class="intro-note rules-copy">안내원으로 합을 모으고, 같은 눈 둘을 조명에 제출해 배율을 올리세요. 관람이 끝나면 합 × (1 + 배율)이 감동이 됩니다.</p>';
    } else if (game.phase === 'viewing') { html = diceTray(); }
    else if (game.phase === 'shop') {
      html = head('유물 상점','bag',quiet('잔액 ' + game.money + '원')) + '<div class="offers">' + offers('stock',game.shop.stock) + '</div><div class="panel-body"><div class="inline-actions">' + btn('cell','칸 구매 · ' + G.cellPrice(game) + '원','green',game.money < G.cellPrice(game)) + '</div><p class="button-note">유물을 선택한 뒤 배치할 칸을 누르세요. 판 위의 유물을 누르면 이동하거나 판매할 수 있습니다.</p></div>';
    } else {
      html = head('관람 기록','list',quiet(game.history.length + '명')) + '<div class="panel-body">' + game.history.map(r=>'<div class="result-row"><span>' + r.week + '주 · ' + (r.visitor === C.CONFIG.visitorsPerWeek ? '평가 담당자' : '관객 ' + r.visitor) + '</span><b>감동 ' + r.score + ' / ' + r.target + '</b></div>').join('') + '</div>';
    }
    $('controls').innerHTML = html;
  }
  function scorePanel() {
    const v = game.view, end = game.phase !== 'viewing', p = G.projected(game);
    const score = p.score, target = v.target;
    return '<section class="panel score-panel">' + head(end ? '관람 결과' : '현재 예상 감동','pulse',quiet('관객 기준 ' + target)) +
      '<div class="score-main"><div class="score-number"><b>' + score + '</b><span>/ ' + target + '</span></div><div class="progress"><i style="width:' + Math.min(100, 100*score/target) + '%"></i></div><div class="score-breakdown"><span>합 <b>' + v.sum + '</b></span><span>배율 <b>+' + v.mult + '</b></span><span>종료 토큰 합 <b>+' + p.tokenSum + '</b></span></div></div></section>';
  }
  const changes = new Set(['fire','create','destroy','transform','vanish','removeRelic','changeFace','grantDie','gainReroll']);
  function previewPanel() {
    let body = '<p class="muted">남은 주사위를 누르면 이번 제출로 발동할 유물과 감동을 볼 수 있습니다.</p>';
    if (prediction) {
      const items = prediction.trace.filter(e => changes.has(e.type));
      body = '<div class="result-row"><span>제출 후 예상 감동</span><b class="preview-score">' + prediction.score + '</b></div><p class="muted">일치 패턴 · ' + (prediction.patterns.map(esc).join(', ') || '없음') + '</p>' +
        (items.length ? '<ol class="preview-list">' + items.map(ev=>'<li>' + esc(ev.text) + (ev.pos ? ' ' + point(ev.pos) : '') + '</li>').join('') + '</ol>' : '<p class="muted">발동하는 유물이 없습니다.</p>') +
        prediction.warnings.map(s=>'<p class="warning">' + esc(s) + '</p>').join('');
    }
    return panel(head('제출 미리보기','dice',quiet('선택 ' + chosen.size + '개')) + '<div class="preview-body">' + body + '</div>');
  }
  function bossPanel() {
    const v = game.view, b = v.boss, score = prediction?.score ?? G.projected(game).score;
    return panel(head(b.name + ' 평가','flag',quiet(b.strength + ' 단계')) + '<div class="boss-note"><strong>' + (score >= v.target ? '기준 통과' : '기준 미달') + (game.phase === 'viewing' ? ' 예상' : '') + '</strong>' + esc(b.rule) + (v.sealedFace ? ' 봉인된 눈 ' + v.sealedFace + '.' : '') + '</div><div class="panel-body"><p class="rules-copy">입은 피해 · ' + (v.damage.map(esc).join(' / ') || '없음') + '</p>' + (prediction ? '<p class="rules-copy">이번 제출의 피해 · ' + (prediction.damage.map(esc).join(' / ') || '없음') + '</p>' : '') + '</div>');
  }
  function sidebar() {
    const phase = game.phase, v = game.view;
    if (phase === 'intro') {
      $('sidebar').innerHTML = inventory() + panel(head('주간 평가 일정','calendar',quiet('전 8주')) + schedule());
      return;
    }
    let html = scorePanel();
    if (phase === 'viewing') html += previewPanel();
    if (v.boss) html += bossPanel();
    if (phase !== 'viewing') {
      const r = game.lastResult;
      html += panel(head('관객 정산','coins',quiet(r.grade)) + '<div class="panel-body"><div class="result-row"><span>받은 팁</span><b>+' + r.tip + '원</b></div></div>');
    }
    if (phase === 'viewing' || phase === 'shop') {
      const active = phase === 'shop';
      const cards = !active ? v.rewards.map(id=>itemCard(id,'catalog-' + id)).join('') : (game.shop.rewardDone ? '<p class="rules-copy">이번 관람의 보상 선택을 마쳤습니다.</p>' : offers('reward',v.rewards));
      html += panel(head(active ? '무료 유물 선택' : '관람 후 보상','bag',quiet('3택1')) + '<div class="offers">' + cards +
        (active && !game.shop.rewardDone ? btn('decline','보상 거절','small') : '') + '</div>');
    }
    $('sidebar').innerHTML = html + (phase === 'viewing' ? '' : inventory());
  }
  function report() {
    const el = $('report');
    el.hidden = !lastTrace.length;
    if (!lastTrace.length) return;
    const open = !!el.querySelector('details[open]');
    el.innerHTML = head('처리 기록','list',animation ? btn('skip','연출 건너뛰기','small') : '') +
      (animation ? '<div class="trace-line">' + esc(animation.current) + '</div>' : '') +
      '<div class="report-body"><details' + (open ? ' open' : '') + '><summary>최근 행동 전체 보기 · ' + lastTrace.length + '건</summary><ol class="log-list">' + lastTrace.map(e=>'<li>' + esc(e.text) + (e.pos ? ' ' + point(e.pos) : '') + '</li>').join('') + '</ol></details></div>';
  }
  function render() {
    prediction = chosen.size && game.phase === 'viewing' ? G.preview(game,[...chosen]) : null;
    renderHeadline(); controls(); sidebar(); renderBoard(); report();
    MuseumSymbols.render();
  }
  function stopAnimation() {
    clearTimeout(animationTimer);
    animation = null;
  }
  function animate(trace, before) {
    stopAnimation();
    lastTrace = trace;
    const frames = trace.filter(e => changes.has(e.type) || e.type === 'boss');
    if (!frames.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animation = {board:before, pos:null, current:''};
    let cursor = 0;
    function tick() {
      if (!animation) return;
      const e = frames[cursor++];
      if (!e) { stopAnimation(); renderBoard(); report(); MuseumSymbols.render($('report')); return; }
      const b = animation.board;
      if (e.type === 'create' || e.type === 'transform') b.tokens[e.pos] = e.id;
      if (e.type === 'destroy' || e.type === 'vanish') delete b.tokens[e.pos];
      if (e.type === 'removeRelic') delete b.relics[e.pos];
      animation.pos = e.pos;
      animation.current = cursor + ' / ' + frames.length + ' · ' + e.text + (e.pos ? ' ' + point(e.pos) : '');
      renderBoard(); report(); MuseumSymbols.render($('report'));
      animationTimer = setTimeout(tick, auto ? 65 : 210);
    }
    tick();
  }
  function stopAuto() { clearTimeout(autoTimer); auto = ''; }
  function clearInteraction() { chosen.clear(); focus = null; held = null; }
  function nextVisitor() {
    stopAnimation(); clearInteraction();
    if (G.startViewing(game)) { lastTrace = []; save(); render(); }
  }
  function viewingAction(type, ids) {
    const before = structuredClone(game.board);
    const trace = type === 'submit' ? G.submit(game,ids) : type === 'reroll' ? G.reroll(game,ids) : G.endViewing(game);
    if (!trace.length) return;
    chosen.clear(); prediction = null;
    if (terminal() || (game.phase !== 'viewing' && auto === 'view')) stopAuto();
    save(); animate(trace,before); render();
  }
  function autoStep() {
    if (!auto) return;
    if (animation) { autoTimer = setTimeout(autoStep,100); return; }
    if (game.phase === 'viewing') {
      const a = P.chooseAction(game);
      viewingAction(a.type,a.ids);
    } else if (auto === 'run' && !terminal()) {
      clearInteraction(); lastTrace = []; P.step(game); save(); render();
    } else { stopAuto(); render(); return; }
    if (auto) autoTimer = setTimeout(autoStep,350);
  }
  function startAuto(mode) {
    stopAuto(); stopAnimation(); clearInteraction(); auto = mode;
    render(); autoTimer = setTimeout(autoStep,160);
  }
  function selectOffer(action, refresh = true) {
    const [source,i] = action.split('-'), index = Number(i);
    if (game.phase !== 'shop' || auto) return;
    const id = source === 'stock' ? game.shop.stock[index] : game.view.rewards[index];
    if (!id || (source === 'stock' ? game.money < C.RELICS[id].price : game.shop.rewardDone)) return;
    stopAnimation();
    held = {id,source,index,action,facing:0};
    focus = game.board.cells.find(k=>!game.board.relics[k] && !game.board.tokens[k]) || focus;
    if (refresh) {
      render(); B.aim(focus || '0,0');
    } else renderBoard();
  }
  function pickMove(pos) {
    if (game.phase !== 'shop' || auto) return;
    const item = game.board.relics[pos];
    if (!item) return;
    stopAnimation(); focus = pos; held = {id:item.id,source:'move',from:pos,facing:item.facing}; render(); B.aim(pos);
  }
  function boardSelect(pos) {
    if (auto) return;
    stopAnimation();
    focus = pos;
    if (held && game.phase === 'shop') {
      let ok;
      if (held.source === 'cell') ok = G.buyCell(game,pos);
      else if (held.source === 'move') ok = G.moveRelic(game,held.from,pos,held.facing);
      else ok = G.acquire(game,held.source,held.index,pos,held.facing);
      if (ok) { held = null; save(); }
      else say(held.source === 'cell' ? '미구매 자리와 잔액을 확인하세요.' : '유물이나 토큰이 없는 구매한 칸을 선택하세요.');
    }
    render();
  }
  B.connect({select:boardSelect, pick:pickMove, focus(pos) { focus = pos; renderBoard(); }});
  function help() {
    const html = '<div class="dialog-copy"><h3>관람</h3><p>주사위 하나를 골라 제출하면 안내원이 그 눈만큼 합을 올립니다. 같은 눈 둘을 함께 내면 조명이 배율을 1 올립니다. 한 번 제출한 주사위는 다음 관객에게 돌아옵니다.</p><h3>감동과 평가</h3><p>감동은 최종 합 × (1 + 배율)입니다. 현재 예상 감동에는 관람 종료 때 사라질 토큰의 효과도 들어갑니다. 매주 세 번째 관객의 기준을 넘기거나 같으면 다음 주로 넘어갑니다.</p><h3>판과 상점</h3><p>유물을 눌러 발동 조건과 대상 자리를 확인하세요. 빈 곳을 끌어 판을 이동하고 +, −로 확대하거나 축소합니다. 상점에서 유물을 고른 뒤 구매한 빈칸에 놓으세요. 방향 유물은 R로 회전하고 Esc로 배치를 취소합니다.</p><h3>자동 플레이</h3><p>관람 중 자동 플레이는 현재 관객까지 진행합니다. 런 자동 진행은 상점 선택도 맡아 평가 종료까지 이어집니다. 진행 중 멈출 수 있습니다.</p></div>';
    dialog('이용 안내',html);
  }
  function onAction(action) {
    if (action === 'close') { $('dialog').close(); return; }
    if (action === 'help' || action === 'schedule') {
      if (auto) { stopAuto(); render(); }
      if (action === 'help') help(); else dialog('주간 평가 일정',schedule()); return;
    }
    if (action === 'new') {
      if (auto) { stopAuto(); render(); }
      dialog('새 전시 시작','<div class="dialog-copy"><p>새 일정으로 시작하면 이 브라우저에 저장된 현재 런을 교체합니다.</p><div class="inline-actions">' + btn('close','돌아가기') + btn('reset','새 전시 시작','primary') + '</div></div>'); return;
    }
    if (action === 'reset') {
      $('dialog').close(); stopAuto(); stopAnimation(); clearInteraction(); game = G.newGame();
      lastTrace = []; save(); render(); B.fit(); return;
    }
    if (action === 'stop') { stopAuto(); say('자동 진행을 멈췄습니다.'); render(); return; }
    if (action === 'skip') { stopAnimation(); render(); return; }
    if (action === 'zoomin' || action === 'zoomout') { B.zoom(action === 'zoomin' ? 1.25 : 0.8); return; }
    if (action === 'fit') { B.fit(); return; }
    if (auto) return;
    if (action === 'auto-view' || action === 'auto-run') { startAuto(action === 'auto-view' ? 'view' : 'run'); return; }
    if (action === 'start') { nextVisitor(); return; }
    if (action.startsWith('die-')) {
      stopAnimation();
      const id = Number(action.slice(4)); chosen.has(id) ? chosen.delete(id) : chosen.add(id);
      render(); document.querySelector('[data-action="' + action + '"]')?.focus({preventScroll:true}); return;
    }
    if (['submit','reroll','end'].includes(action)) { viewingAction(action,[...chosen]); return; }
    if (action.startsWith('inspect-')) { boardSelect(action.slice(8)); return; }
    if (action.startsWith('catalog-')) {
      const r = C.RELICS[action.slice(8)];
      dialog(r.name,'<div class="dialog-copy"><p>' + r.description + '</p><p class="muted">이번 관람 뒤 상점에서 무료로 선택할 수 있습니다.</p></div>'); return;
    }
    if (action.startsWith('stock-') || action.startsWith('reward-')) { selectOffer(action); return; }
    if (action === 'cancel') { held = null; focus = null; render(); return; }
    if (game.phase !== 'shop') return;
    stopAnimation();
    if (action === 'cell') {
      held = {source:'cell'};
      if (!focus || game.board.cells.includes(focus)) {
        focus = game.board.cells.flatMap(p => C.targets(game.board,p,'adjacent')).find(p => !game.board.cells.includes(p));
      }
      render(); B.aim(focus || '0,0'); return;
    }
    else if (action === 'buy-here') { G.buyCell(game,focus); }
    else if (action === 'decline') { G.declineReward(game); if (held?.source === 'reward') held = null; }
    else if (action === 'move') { pickMove(focus); return; }
    else if (action === 'rotate') {
      if (held && C.RELICS[held.id]?.facing) held.facing = (held.facing+1)%4;
      else if (!held && focus) G.rotateRelic(game,focus);
    }
    else if (action === 'sell') { G.sellRelic(game,focus); }
    save(); render();
  }
  document.addEventListener('click', e => {
    const button = e.target.closest('[data-action]');
    if (button && !button.disabled) onAction(button.dataset.action);
  });
  document.addEventListener('dragstart', e => {
    const card = e.target.closest('.item-card[draggable=true]');
    if (card) {
      e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain',card.dataset.action);
      selectOffer(card.dataset.action,false);
    }
  });
  document.addEventListener('keydown', e => {
    if ($('dialog').open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { if (auto) onAction('stop'); else onAction('cancel'); }
    if (e.key.toLowerCase() === 'r' && game.phase === 'shop') onAction('rotate');
  });
  $('dialog').addEventListener('click', e => { if (e.target === $('dialog')) $('dialog').close(); });
  save(); render();
})();
