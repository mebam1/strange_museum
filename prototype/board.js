(() => {
  const board = document.getElementById('board');
  const tiles = document.getElementById('tiles');
  const marks = document.getElementById('marks');
  const axes = document.getElementById('axes');
  const coordinate = document.getElementById('coordinate');
  const Core = window.MuseumCore;
  let model, actions, drag, hover = null;
  let center = [1, 0.5], size = 79, fittedSize = 79, autoFit = true;
  const xy = key => key.split(',').map(Number);
  const safeCoordinate = n => Math.max(Number.MIN_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, n));
  function extent(axis) {
    return axis === 0 ? board.clientWidth : board.clientHeight;
  }
  function pixels(value, axis) {
    return extent(axis) / 2 + (value - center[axis] - 0.5) * size;
  }
  function cellAt(pixel, axis) {
    const whole = Math.floor(center[axis]);
    return safeCoordinate(whole + Math.floor((pixel - extent(axis) / 2) / size + (center[axis] - whole) + 0.5));
  }
  function position(event) {
    const rect = board.getBoundingClientRect();
    return [cellAt(event.clientX - rect.left, 0), cellAt(event.clientY - rect.top, 1)].join(',');
  }
  function fit() {
    if (!model || !board.clientWidth || !board.clientHeight) return;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const key of [...model.board.cells, ...Object.keys(model.board.tokens)]) {
      const [x, y] = xy(key);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    center = [left + (right - left) / 2, top + (bottom - top) / 2];
    fittedSize = Math.min(84, board.clientWidth / (right - left + 2.65), board.clientHeight / (bottom - top + 2.65));
    size = fittedSize;
    autoFit = true;
  }
  function zoom(factor) {
    autoFit = false;
    size = Math.max(Math.min(0.35, fittedSize), Math.min(140, size * factor));
    draw();
  }
  function place(key) {
    const [x, y] = xy(key), left = pixels(x, 0), top = pixels(y, 1);
    if (left + size < 0 || top + size < 0 || left > board.clientWidth || top > board.clientHeight) return 'display:none';
    return 'left:' + left + 'px;top:' + top + 'px';
  }
  function drawMarks() {
    if (!model) return;
    const {held, focus, flash, forecast} = model;
    const anchor = held ? (hover || focus) : focus;
    const relic = held ? held.id : model.board.relics[anchor]?.id;
    const def = Core.RELICS[relic];
    const marked = new Map();
    if (anchor && def) {
      const facing = held?.facing ?? model.board.relics[anchor]?.facing ?? 0;
      if (def.trigger.where) {
        for (const key of Core.targets(model.board, anchor, def.trigger.where, facing)) marked.set(key, 'target');
      }
      for (const effect of def.effects) {
        if (!effect.scope) continue;
        for (const key of Core.targets(model.board, anchor, effect.scope, facing)) {
          const token = model.board.tokens[key];
          const occupied = model.board.relics[key] && held?.from !== key;
          let available;
          if (effect.type === 'createToken') available = !occupied && !token;
          else if (effect.type === 'destroyTokens') available = token && (!effect.token || effect.token === token) &&
            (!effect.tag || Core.TOKENS[token].tags.includes(effect.tag));
          else if (effect.type === 'transformTokens') available = token === effect.from;
          else available = true;
          if (available || !marked.has(key)) marked.set(key, available ? 'target target-open' : 'target target-blocked');
        }
      }
    }
    const mark = (key, css) => '<span class="map-mark ' + css + '" style="' + place(key) + '"></span>';
    marks.innerHTML = [...marked].map(([key, css]) => mark(key, css)).join('') +
      [...new Set(forecast || [])].map(k => mark(k, 'forecast')).join('') +
      (focus ? mark(focus, 'focus') : '') + (held && anchor ? mark(anchor, 'place') : '') +
      (flash ? mark(flash, 'flash') : '');
    const shown = hover || focus;
    coordinate.textContent = shown ? 'X ' + xy(shown)[0] + '  /  Y ' + xy(shown)[1] : '';
  }
  function draw() {
    if (!model) return;
    const {cells, relics, tokens} = model.board;
    const gridStep = Math.max(1, Math.ceil(12 / size));
    // Keep the texture's origin near the viewport even for distant rooms.
    const gridOrigin = axis => extent(axis) / 2 - ((center[axis] % gridStep) + 0.5) * size;
    board.style.setProperty('--cell', size + 'px');
    board.style.setProperty('--grid', (size * gridStep) + 'px');
    board.style.setProperty('--ox', gridOrigin(0) + 'px');
    board.style.setProperty('--oy', gridOrigin(1) + 'px');
    board.classList.toggle('small-tiles', size < 53);
    board.classList.toggle('tiny-tiles', size < 22);
    const purchased = new Set(cells);
    const keys = [...new Set([...cells, ...Object.keys(tokens)])];
    tiles.innerHTML = keys.map(key => {
      const inst = relics[key], token = tokens[key];
      const def = inst ? Core.RELICS[inst.id] : Core.TOKENS[token];
      const kind = inst ? 'artifact' : token ? 'token-cell' : 'vacant';
      const name = def?.name || '빈칸';
      const icon = def ? '<i class="tile-icon" data-icon="' + (inst?.id || token) + '" data-color></i>' : '<span class="empty-plus">+</span>';
      const arrow = inst && def.facing ? '<b class="facing">' + ['↑','→','↓','←'][inst.facing] + '</b>' : '';
      let progress = '', progressTitle = '';
      if (def?.kind === 'dice') {
        const target = def.effects.find(e => e.type === 'destroyTokens');
        const required = def.effects.find(e => e.type === 'grantDieIfDestroyed').required;
        const count = Core.targets(model.board, key, target.scope, inst.facing).filter(p => tokens[p] === target.token).length;
        progressTitle = ' · 인접 ' + Core.TOKENS[target.token].name + ' ' + count + '/' + required;
        progress = '<span class="tile-progress">' + count + '/' + required + '</span>';
      }
      const label = name + ' (' + key + ') · ' + (purchased.has(key) ? '구매한 칸' : '미구매 자리') + progressTitle;
      return '<button tabindex="-1" class="tile ' + kind + (purchased.has(key) ? ' purchased' : '') + '" style="' + place(key) + '" data-pos="' + key + '" aria-label="' + label + '" title="' + label + '">' + icon + '<span class="tile-name">' + name + '</span>' + progress + arrow + '</button>';
    }).join('');
    MuseumSymbols.render(tiles);
    let labels = '';
    if (size >= 35) {
      for (const axis of [0, 1]) {
        const first = cellAt(0, axis);
        const count = Math.ceil(extent(axis) / size) + 1;
        for (let i = 0; i < count; i++) {
          const value = first + i, pixel = pixels(value, axis) + size / 2;
          if (!Number.isSafeInteger(value) || pixel < 0 || pixel >= extent(axis)) continue;
          labels += axis === 0 ? '<span class="axis-x" style="left:' + pixel + 'px">' + value + '</span>' :
            '<span class="axis-y" style="top:' + pixel + 'px">' + value + '</span>';
        }
      }
    }
    axes.innerHTML = labels;
    drawMarks();
  }
  function aim(pos, focusBoard = true) {
    hover = pos || null;
    if (hover) {
      const to = xy(hover);
      if (to.some((value, axis) => Math.abs(value - center[axis]) * size > Math.max(0, extent(axis) / 2 - size))) {
        center = to;
        autoFit = false;
      }
    }
    if (focusBoard) board.focus();
    draw();
  }
  board.addEventListener('pointerdown', event => {
    if (!model || drag || !event.isPrimary || event.button !== 0) return;
    const key = position(event);
    drag = {id:event.pointerId, x:event.clientX, y:event.clientY, start:[...center], key, moved:false,
      moveRelic:!model.held && model.shop && !!model.board.relics[key]};
    board.setPointerCapture(event.pointerId);
    board.focus({preventScroll:true});
  });
  board.addEventListener('pointermove', event => {
    if (!model || !event.isPrimary || (drag && event.pointerId !== drag.id)) return;
    const dx = event.clientX - (drag?.x ?? event.clientX), dy = event.clientY - (drag?.y ?? event.clientY);
    if (drag && Math.hypot(dx, dy) > 5 && !drag.moved) {
      drag.moved = true;
      if (drag.moveRelic) actions.pick(drag.key);
    }
    if (drag?.moved && !drag.moveRelic) {
      autoFit = false;
      center = [safeCoordinate(drag.start[0] - dx / size), safeCoordinate(drag.start[1] - dy / size)];
      draw();
    }
    hover = position(event);
    drawMarks();
  });
  board.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const click = !drag.moved || drag.moveRelic;
    const rect = board.getBoundingClientRect();
    drag = null;
    if (click && event.clientX >= rect.left && event.clientX < rect.right &&
        event.clientY >= rect.top && event.clientY < rect.bottom) actions.select(position(event));
  });
  function release(event) { if (drag?.id === event.pointerId) drag = null; }
  board.addEventListener('pointercancel', release);
  board.addEventListener('lostpointercapture', release);
  board.addEventListener('pointerleave', event => { if (event.isPrimary && !drag) { hover = null; drawMarks(); } });
  board.addEventListener('click', event => {
    if (event.detail === 0 && event.target.closest('[data-pos]')) actions.select(event.target.closest('[data-pos]').dataset.pos);
  });
  board.addEventListener('keydown', event => {
    if (!model) return;
    const offsets = {ArrowUp:[0,-1], ArrowDown:[0,1], ArrowRight:[1,0], ArrowLeft:[-1,0]};
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); actions.select(hover || model.focus || '0,0'); }
    const delta = offsets[event.key];
    if (!delta) return;
    event.preventDefault();
    const from = xy(hover || model.focus || '0,0');
    const to = [safeCoordinate(from[0] + delta[0]), safeCoordinate(from[1] + delta[1])];
    aim(to.join(','), false);
    actions.focus(hover);
  });
  board.addEventListener('wheel', event => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.15 : 1/1.15); }, {passive:false});
  board.addEventListener('dragover', event => {
    if (!model?.shop) return;
    event.preventDefault(); hover = position(event); drawMarks();
  });
  board.addEventListener('drop', event => {
    event.preventDefault();
    if (model?.held) actions.select(position(event));
  });
  new ResizeObserver(() => { if (autoFit) fit(); draw(); }).observe(board);
  window.MuseumBoard = {
    connect(handlers) { actions = handlers; },
    render(data) { model = data; if (autoFit) fit(); draw(); },
    aim, zoom, fit() { fit(); draw(); }
  };
})();
