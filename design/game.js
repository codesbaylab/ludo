// Ludo game engine + board rendering. Hotseat play: whoever's turn it is clicks
// the dice, then clicks one of their own highlighted tokens to move it.
(function () {
  const size = 15;
  const grid = document.getElementById('board-grid');

  function classify(r, c) {
    const yardRed = r <= 6 && c <= 6;
    const yardGreen = r <= 6 && c >= 10;
    const yardYellow = r >= 10 && c >= 10;
    const yardBlue = r >= 10 && c <= 6;
    const center = r >= 7 && r <= 9 && c >= 7 && c <= 9;

    if (yardRed) return { type: 'yard', cls: 'yard yard-red' };
    if (yardGreen) return { type: 'yard', cls: 'yard yard-green' };
    if (yardYellow) return { type: 'yard', cls: 'yard yard-yellow' };
    if (yardBlue) return { type: 'yard', cls: 'yard yard-blue' };
    if (center) return { type: 'center', cls: 'center-home' };

    if (c >= 7 && c <= 9) {
      if (c === 8) {
        if (r >= 2 && r <= 6) return { type: 'cell', cls: 'cell path home-col-green' };
        if (r >= 10 && r <= 14) return { type: 'cell', cls: 'cell path home-col-blue' };
      }
      return { type: 'cell', cls: 'cell path' };
    }
    if (r >= 7 && r <= 9) {
      if (r === 8) {
        if (c >= 2 && c <= 6) return { type: 'cell', cls: 'cell path home-col-red' };
        if (c >= 10 && c <= 14) return { type: 'cell', cls: 'cell path home-col-yellow' };
      }
      return { type: 'cell', cls: 'cell path' };
    }
    return { type: 'cell', cls: 'cell path' };
  }

  const entryCells = { '7,2': 'red', '2,9': 'green', '9,14': 'yellow', '14,7': 'blue' };
  const starCells = { '9,3': 'blue', '3,7': 'red', '7,13': 'green', '13,9': 'yellow' };

  const yardEls = {}; // color -> .yard-inner div
  let centerEl = null;

  for (let r = 1; r <= size; r++) {
    for (let c = 1; c <= size; c++) {
      const info = classify(r, c);
      if (info.type === 'yard') {
        const isAnchor = (r === 1 || r === 10) && (c === 1 || c === 10);
        if (!isAnchor) continue;
        const div = document.createElement('div');
        div.className = info.cls;
        const inner = document.createElement('div');
        inner.className = 'yard-inner';
        const color = info.cls.includes('red') ? 'red' : info.cls.includes('green') ? 'green' : info.cls.includes('yellow') ? 'yellow' : 'blue';
        yardEls[color] = inner;
        div.appendChild(inner);
        grid.appendChild(div);
        continue;
      }
      if (info.type === 'center') {
        if (!(r === 7 && c === 7)) continue;
        const div = document.createElement('div');
        div.className = info.cls;
        grid.appendChild(div);
        centerEl = div;
        continue;
      }
      const div = document.createElement('div');
      div.className = info.cls;
      div.style.gridColumn = c;
      div.style.gridRow = r;
      const key = r + ',' + c;
      if (entryCells[key]) div.classList.add('entry-' + entryCells[key]);
      if (starCells[key]) div.classList.add('star', 'c-' + starCells[key]);
      grid.appendChild(div);
    }
  }

  const tokenLayer = document.createElement('div');
  tokenLayer.className = 'token-layer';
  grid.appendChild(tokenLayer);

  // --- Dice (visual/audio unchanged from the original mockup) ---

  const diceFace = document.getElementById('dice-face');
  const diceCube = document.getElementById('dice-cube');
  const diceShadow = document.getElementById('dice-shadow');
  const diceStatus = document.getElementById('dice-status');
  const diceBadge = document.getElementById('dice-badge');

  const dicePatterns = {
    1: [0,0,0, 0,1,0, 0,0,0],
    2: [1,0,0, 0,0,0, 0,0,1],
    3: [1,0,0, 0,1,0, 0,0,1],
    4: [1,0,1, 0,0,0, 1,0,1],
    5: [1,0,1, 0,1,0, 1,0,1],
    6: [1,0,1, 1,0,1, 1,0,1],
  };

  document.querySelectorAll('.dice-face-3d').forEach(faceEl => {
    const value = Number(faceEl.dataset.pips);
    dicePatterns[value].forEach(v => {
      const p = document.createElement('div');
      p.className = 'pip';
      p.style.opacity = v ? '1' : '0';
      faceEl.appendChild(p);
    });
  });

  const faceOrientation = {
    1: { x: 0,   y: 0 },
    6: { x: 0,   y: 180 },
    2: { x: 0,   y: -90 },
    5: { x: 0,   y: 90 },
    3: { x: -90, y: 0 },
    4: { x: 90,  y: 0 },
  };

  let audioCtx = null;
  function playDiceSound() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const clickCount = 7;
    for (let i = 0; i < clickCount; i++) {
      const t = now + i * 0.09 + Math.random() * 0.02;
      const bufferSize = audioCtx.sampleRate * 0.03;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < bufferSize; j++) {
        data[j] = (Math.random() * 2 - 1) * (1 - j / bufferSize);
      }
      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1200 + Math.random() * 800;

      const gain = audioCtx.createGain();
      const volume = 0.8 * (1 - i / clickCount) + 0.2;
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      noise.start(t);
      noise.stop(t + 0.03);
    }
  }

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // A short upward "tap" for each single-cell hop a token takes.
  function playHopSound() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(380, t + 0.08);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  // A short downward "thud" when a token gets captured and sent home.
  function playCaptureSound() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.28);
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  let currentX = -18, currentY = 24;
  function spinTo(axisTarget, current, minSpins, maxSpins) {
    const base = ((axisTarget - current) % 360 + 360) % 360;
    const spins = minSpins + Math.floor(Math.random() * (maxSpins - minSpins + 1));
    return current + base + spins * 360;
  }

  // --- Game engine ---

  // Canonical 52-square ring, starting at (7,1) and walking clockwise through
  // all four arms. Each color's private path is this ring rotated to start at
  // its own entry square, followed by its 5-cell home column, then "finished".
  const RING = [
    [7,1],[7,2],[7,3],[7,4],[7,5],[7,6],
    [6,7],[5,7],[4,7],[3,7],[2,7],[1,7],
    [1,8],
    [1,9],[2,9],[3,9],[4,9],[5,9],[6,9],
    [7,10],[7,11],[7,12],[7,13],[7,14],[7,15],
    [8,15],
    [9,15],[9,14],[9,13],[9,12],[9,11],[9,10],
    [10,9],[11,9],[12,9],[13,9],[14,9],[15,9],
    [15,8],
    [15,7],[14,7],[13,7],[12,7],[11,7],[10,7],
    [9,6],[9,5],[9,4],[9,3],[9,2],[9,1],
    [8,1],
  ];

  const SAFE_CELLS = new Set(Object.keys(entryCells).concat(Object.keys(starCells)));

  const COLORS = {
    red:    { entryIndex: 1,  yard: [1,1],   homeColumn: [[8,2],[8,3],[8,4],[8,5],[8,6]] },
    green:  { entryIndex: 14, yard: [1,10],  homeColumn: [[2,8],[3,8],[4,8],[5,8],[6,8]] },
    blue:   { entryIndex: 40, yard: [10,1],  homeColumn: [[14,8],[13,8],[12,8],[11,8],[10,8]] },
    yellow: { entryIndex: 27, yard: [10,10], homeColumn: [[8,14],[8,13],[8,12],[8,11],[8,10]] },
  };

  // Where each color's wedge sits inside the center triangle (% of the
  // center-home box), and which axis to spread stacked finished tokens along.
  const WEDGE = {
    green:  { left: 50, top: 24, axis: 'x' },
    yellow: { left: 76, top: 50, axis: 'y' },
    blue:   { left: 50, top: 76, axis: 'x' },
    red:    { left: 24, top: 50, axis: 'y' },
  };

  function coordFor(color, pos) {
    if (pos >= 0 && pos <= 50) {
      const idx = (COLORS[color].entryIndex + pos) % RING.length;
      return RING[idx];
    }
    if (pos >= 51 && pos <= 55) {
      return COLORS[color].homeColumn[pos - 51];
    }
    return null; // finished (56) — no board coordinate
  }

  // The match's stake, passed in as ?stake=<rupees> (e.g. from a lobby table
  // link). No param falls back to the ₹50 table this mockup started with;
  // ?stake=0 (or a free-table link) plays for nothing.
  const stakeParam = new URLSearchParams(location.search).get('stake');
  const STAKE = stakeParam === null ? 50 : Math.max(0, Number(stakeParam) || 0);
  const IS_FREE = STAKE <= 0;
  const POT = STAKE * 4;
  const PLATFORM_FEE = Math.round(POT * 0.1);
  const PAYOUT = POT - PLATFORM_FEE;

  // Turn order follows the ring direction (ascending entryIndex, wrapping):
  // red -> green -> yellow -> blue -> red. Starting at green (Aria) here just
  // keeps her as the opening player, same as the original mockup.
  const players = [
    { name: 'Aria', color: 'green' },
    { name: 'Kofi', color: 'yellow' },
    { name: 'Mei', color: 'blue' },
    { name: 'Ragnar (You)', color: 'red' },
  ];
  players.forEach(p => {
    p.homeCount = 0;
    p.tokens = Array.from({ length: 4 }, (_, i) => ({
      color: p.color, index: i, state: 'yard', pos: -1, el: null,
    }));
  });

  // Build a DOM token for every token and drop it in its yard slot.
  players.forEach(p => {
    p.tokens.forEach(token => {
      const el = document.createElement('div');
      el.className = 'token token-' + p.color;
      el.dataset.color = p.color;
      el.dataset.index = String(token.index);
      el.addEventListener('click', () => onTokenClick(token));
      token.el = el;
      yardEls[p.color].appendChild(el);
    });
  });

  const panel = document.getElementById('players-panel');
  const turnBanner = document.querySelector('.turn-banner');
  const logBody = document.querySelector('.log-panel .log-body');

  function log(msg) {
    const div = document.createElement('div');
    div.textContent = msg;
    logBody.insertBefore(div, logBody.firstChild);
  }

  function renderPlayersPanel() {
    panel.innerHTML = '';
    players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'player-row' + (i === currentPlayerIdx ? ' current' : '');
      const dots = Array.from({ length: 4 }, (_, d) => `<span class="${d < p.homeCount ? 'home' : ''}"></span>`).join('');
      row.innerHTML = `
        <div class="avatar-ring" style="background:var(--${p.color});">${p.name[0]}</div>
        <div class="pname">${p.name}</div>
        <div class="token-dots" style="color:var(--${p.color});">${dots}</div>
      `;
      panel.appendChild(row);
    });
  }

  function renderTurnBanner() {
    const p = players[currentPlayerIdx];
    turnBanner.innerHTML = `<span class="dot dot-${p.color}"></span> ${p.name}'s Turn`;
  }

  // Re-parent every token div to wherever its current state says it belongs.
  // Active (on-board) tokens live in the floating token-layer, positioned by
  // percentage so CSS can smoothly transition them between cells.
  function renderTokens() {
    const byCell = {};
    const finishedByColor = {};
    players.forEach(p => p.tokens.forEach(t => {
      if (t.state === 'active') {
        const [r, c] = coordFor(t.color, t.pos);
        const key = r + ',' + c;
        (byCell[key] = byCell[key] || []).push(t);
      } else if (t.state === 'finished') {
        (finishedByColor[t.color] = finishedByColor[t.color] || []).push(t);
      }
    }));

    players.forEach(p => p.tokens.forEach(t => {
      const el = t.el;
      if (t.state === 'yard') {
        el.classList.remove('token-on-board', 'token-finished', 'movable');
        if (el.parentElement !== yardEls[t.color]) yardEls[t.color].appendChild(el);
        el.style.left = ''; el.style.top = '';
      } else if (t.state === 'finished') {
        el.classList.remove('token-on-board', 'movable');
        el.classList.add('token-finished');
        if (el.parentElement !== centerEl) centerEl.appendChild(el);
        const wedge = WEDGE[t.color];
        const group = finishedByColor[t.color];
        const i = group.indexOf(t);
        const spread = group.length > 1 ? (i - (group.length - 1) / 2) * 16 : 0;
        el.style.left = (wedge.axis === 'x' ? wedge.left + spread : wedge.left) + '%';
        el.style.top = (wedge.axis === 'y' ? wedge.top + spread : wedge.top) + '%';
      } else {
        el.classList.remove('token-finished');
        el.classList.add('token-on-board');
        if (el.parentElement !== tokenLayer) tokenLayer.appendChild(el);
        const [r, c] = coordFor(t.color, t.pos);
        const key = r + ',' + c;
        const stack = byCell[key];
        const i = stack.indexOf(t);
        const offset = stack.length > 1 ? (i - (stack.length - 1) / 2) * 3.2 : 0;
        el.style.left = ((c - 0.5) / size * 100 + offset) + '%';
        el.style.top = ((r - 0.5) / size * 100 + offset) + '%';
      }
    }));
  }

  let currentPlayerIdx = 0;
  let consecutiveSixes = 0;
  let canRoll = true;
  let gameOver = false;
  let awaitingMove = false;

  function movableTokens(player, roll) {
    return player.tokens.filter(t => {
      if (t.state === 'finished') return false;
      if (t.state === 'yard') return roll === 6;
      return t.pos + roll <= 56;
    });
  }

  function updateDiceUI() {
    diceFace.classList.toggle('disabled', !canRoll || gameOver);
  }

  // Auto-rolls / auto-picks for whoever's turn it is if they leave the game
  // untouched — keeps a hotseat game with 4 humans moving instead of
  // stalling forever. Both the roll and the token-choice share one timer.
  const DICE_TIMER_SECONDS = 15;
  const SELECT_TIMER_SECONDS = 15;
  const diceTimerEl = document.getElementById('dice-timer');
  let timerInterval = null;
  let timerRemaining = 0;

  function startCountdown(seconds, label, onExpire) {
    clearDiceTimer();
    if (gameOver) return;
    timerRemaining = seconds;
    diceTimerEl.style.display = 'block';
    diceTimerEl.classList.remove('urgent');
    diceTimerEl.textContent = `⏱ ${label} ${timerRemaining}s`;
    timerInterval = setInterval(() => {
      timerRemaining -= 1;
      if (timerRemaining <= 0) {
        clearDiceTimer();
        onExpire();
        return;
      }
      diceTimerEl.classList.toggle('urgent', timerRemaining <= 5);
      diceTimerEl.textContent = `⏱ ${label} ${timerRemaining}s`;
    }, 1000);
  }

  function startDiceTimer() {
    if (!canRoll) return;
    startCountdown(DICE_TIMER_SECONDS, 'Auto-roll in', () => {
      if (canRoll && !gameOver && !rollingAnim) startRoll();
    });
  }

  function startSelectTimer(options) {
    startCountdown(SELECT_TIMER_SECONDS, 'Auto-pick in', () => {
      if (awaitingMove && !gameOver) autoPickToken(options);
    });
  }

  function clearDiceTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    diceTimerEl.style.display = 'none';
  }

  diceFace.addEventListener('click', () => {
    if (rollingAnim || !canRoll || gameOver) return;
    startRoll();
  });

  let rollingAnim = false;
  function startRoll() {
    clearDiceTimer();
    rollingAnim = true;
    canRoll = false;
    updateDiceUI();
    diceStatus.textContent = 'Rolling…';
    diceFace.classList.add('rolling');
    diceShadow.classList.add('rolling');
    playDiceSound();

    const result = 1 + Math.floor(Math.random() * 6);
    const target = faceOrientation[result];
    currentX = spinTo(target.x, currentX, 2, 3);
    currentY = spinTo(target.y, currentY, 3, 5);
    diceCube.style.transform = `rotateX(${currentX}deg) rotateY(${currentY}deg)`;

    setTimeout(() => {
      diceFace.classList.remove('rolling');
      diceShadow.classList.remove('rolling');
      rollingAnim = false;
      onRollResolved(result);
    }, 1550);
  }

  function onRollResolved(result) {
    const player = players[currentPlayerIdx];
    diceStatus.textContent = `${player.name} rolled a ${result}`;
    log(`🎲 ${player.name} rolled a ${result}`);

    consecutiveSixes = result === 6 ? consecutiveSixes + 1 : 0;
    if (consecutiveSixes === 3) {
      log(`⚠️ ${player.name} rolled three 6s in a row — turn forfeited!`);
      consecutiveSixes = 0;
      diceBadge.textContent = '🚫 Forfeited';
      passTurn();
      return;
    }

    const options = movableTokens(player, result);
    if (options.length === 0) {
      diceBadge.textContent = '🚫 No valid moves';
      log(`No valid moves for ${player.name}.`);
      if (result === 6) { canRoll = true; updateDiceUI(); diceBadge.textContent = '🎲 Roll again!'; startDiceTimer(); return; }
      passTurn();
      return;
    }

    // Only one legal move (often because just one token is out of the
    // yard) — play it automatically instead of making them click it.
    if (options.length === 1) {
      diceBadge.textContent = '🤖 Only one move — playing it…';
      setTimeout(() => playMove(player, options[0], result), 500);
      return;
    }

    pendingRoll = result;
    awaitingMove = true;
    diceBadge.textContent = '👉 Choose a token to move';
    options.forEach(t => t.el.classList.add('movable'));
    startSelectTimer(options);
  }

  let pendingRoll = null;

  function onTokenClick(token) {
    if (!awaitingMove || gameOver) return;
    const player = players[currentPlayerIdx];
    if (token.color !== player.color) return;
    if (!token.el.classList.contains('movable')) return;
    pickToken(player, token);
  }

  // Picks a sensible token automatically once the selection timer runs out:
  // prefer a capture, then whichever token is furthest along its path.
  function autoPickToken(options) {
    const player = players[currentPlayerIdx];
    const roll = pendingRoll;
    let best = options[0];
    let bestScore = -1;
    options.forEach(t => {
      const newPos = t.state === 'yard' ? 0 : t.pos + roll;
      const score = (wouldCapture(player, t, newPos) ? 1000 : 0) + newPos;
      if (score > bestScore) { bestScore = score; best = t; }
    });
    diceBadge.textContent = '🤖 Auto-picking a token…';
    pickToken(player, best);
  }

  function wouldCapture(player, token, newPos) {
    if (newPos > 50) return false;
    const [r, c] = coordFor(token.color, newPos);
    if (SAFE_CELLS.has(r + ',' + c)) return false;
    return players.some(op => op.color !== player.color && op.tokens.some(t => {
      if (t.state !== 'active' || t.pos > 50) return false;
      const [tr, tc] = coordFor(t.color, t.pos);
      return tr === r && tc === c;
    }));
  }

  function pickToken(player, token) {
    const roll = pendingRoll;
    awaitingMove = false;
    pendingRoll = null;
    clearDiceTimer();
    player.tokens.forEach(t => t.el.classList.remove('movable'));
    diceBadge.textContent = '🚶 Moving…';
    playMove(player, token, roll);
  }

  function playMove(player, token, roll) {
    if (token.state === 'yard') {
      token.state = 'active';
      token.pos = 0;
      hopStep(token, () => finishMove(player, token, roll));
    } else {
      animateSteps(token, roll, () => finishMove(player, token, roll));
    }
  }

  // Walks the token one cell at a time (a real single hop per step), so a
  // roll of 5 visibly hops across 5 cells instead of teleporting.
  function animateSteps(token, stepsLeft, done) {
    token.pos += 1;
    if (token.pos === 56) token.state = 'finished';
    hopStep(token, () => {
      stepsLeft -= 1;
      if (stepsLeft > 0 && token.state === 'active') animateSteps(token, stepsLeft, done);
      else done();
    });
  }

  function hopStep(token, cb) {
    renderTokens();
    const el = token.el;
    el.classList.remove('hop');
    void el.offsetWidth; // restart the animation even if the class was already there
    el.classList.add('hop');
    playHopSound();
    setTimeout(() => { el.classList.remove('hop'); cb(); }, 170);
  }

  function finishMove(player, token, roll) {
    if (token.state === 'yard') {
      log(`${colorDot(player.color)} ${player.name} brought a token out.`);
    } else if (token.state === 'finished') {
      player.homeCount++;
      log(`🏠 ${colorDot(player.color)} ${player.name}'s token reached home!`);
    }

    let captured = false;
    if (token.pos <= 50 && token.state === 'active') {
      const [r, c] = coordFor(token.color, token.pos);
      const key = r + ',' + c;
      if (!SAFE_CELLS.has(key)) {
        const victims = players.filter(op => op.color !== player.color);
        victims.forEach(op => {
          const hit = op.tokens.filter(t => t.state === 'active' && t.pos <= 50 && sameCell(t, token));
          if (hit.length === 1) {
            captured = true;
            log(`${colorDot(player.color)} ${player.name} captured ${colorDot(op.color)} ${op.name}'s token!`);
            playCaptureSound();
            hit[0].el.classList.add('captured');
            setTimeout(() => {
              hit[0].el.classList.remove('captured');
              hit[0].state = 'yard';
              hit[0].pos = -1;
              renderTokens();
            }, 300);
          }
        });
      }
    }

    renderTokens();
    renderPlayersPanel();

    if (player.homeCount === 4) {
      gameOver = true;
      diceStatus.textContent = `🏆 ${player.name} wins!`;
      diceBadge.textContent = '🏆 Game over';
      log(`🏆 ${player.name} wins the game!`);
      updateDiceUI();
      showGameOver(player);
      return;
    }

    const extraTurn = roll === 6 || captured || token.state === 'finished';
    if (extraTurn) {
      canRoll = true;
      diceStatus.textContent = 'Roll again!';
      diceBadge.textContent = '🎲 Roll again!';
      updateDiceUI();
      startDiceTimer();
    } else {
      passTurn();
    }
  }

  function sameCell(a, b) {
    const ca = coordFor(a.color, a.pos), cb = coordFor(b.color, b.pos);
    return ca && cb && ca[0] === cb[0] && ca[1] === cb[1];
  }

  function colorDot(color) {
    return { red: '🔴', green: '🟢', yellow: '🟡', blue: '🔵' }[color];
  }

  const gameOverOverlay = document.getElementById('game-over-overlay');
  function showGameOver(player) {
    document.getElementById('winner-icon').style.background = `var(--${player.color}-soft)`;
    document.getElementById('winner-title').textContent = `${colorDot(player.color)} ${player.name} Wins!`;
    document.getElementById('payout-block').style.display = IS_FREE ? 'none' : '';
    document.getElementById('free-note').style.display = IS_FREE ? '' : 'none';
    if (!IS_FREE) {
      document.getElementById('payout-pot').textContent = `₹${POT}`;
      document.getElementById('payout-fee').textContent = `-₹${PLATFORM_FEE}`;
      document.getElementById('payout-amount').textContent = `₹${PAYOUT}`;
    }
    gameOverOverlay.classList.add('open');
  }

  function passTurn() {
    consecutiveSixes = 0;
    currentPlayerIdx = (currentPlayerIdx + 1) % players.length;
    canRoll = true;
    awaitingMove = false;
    pendingRoll = null;
    renderPlayersPanel();
    renderTurnBanner();
    diceStatus.textContent = 'Tap the dice to roll';
    diceBadge.textContent = `🎲 ${players[currentPlayerIdx].name}'s turn`;
    updateDiceUI();
    startDiceTimer();
  }

  renderTokens();
  renderPlayersPanel();
  renderTurnBanner();
  updateDiceUI();
  startDiceTimer();

  document.getElementById('log-toggle').addEventListener('click', () => {
    document.getElementById('log-panel').classList.toggle('open');
  });
})();
