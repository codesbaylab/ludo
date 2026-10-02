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

  // --- DOM refs shared by rendering + networking below -------------------

  const walletChip = document.getElementById('wallet-chip');
  const panel = document.getElementById('players-panel');
  const turnBanner = document.querySelector('.turn-banner');
  const logBody = document.querySelector('.log-panel .log-body');
  const diceTimerEl = document.getElementById('dice-timer');
  const gameOverOverlay = document.getElementById('game-over-overlay');
  const connectingOverlay = document.getElementById('connecting-overlay');
  const connectingStatus = document.getElementById('connecting-status');

  function log(msg) {
    const div = document.createElement('div');
    div.textContent = msg;
    logBody.insertBefore(div, logBody.firstChild);
  }

  function colorDot(color) {
    return { red: '🔴', green: '🟢', yellow: '🟡', blue: '🔵' }[color];
  }

  // One DOM token per color per slot (16 total), built once — the server's
  // PlayerState always has exactly 4 token slots per color regardless of who
  // (if anyone) is connected to that seat.
  const tokenEls = {};
  ['red', 'green', 'yellow', 'blue'].forEach(color => {
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'token token-' + color;
      el.addEventListener('click', () => onTokenClick(color, i));
      tokenEls[color + '-' + i] = el;
      yardEls[color].appendChild(el);
    }
  });
  function tokenEl(color, i) { return tokenEls[color + '-' + i]; }

  // --- Rendering, driven entirely by the latest server-state snapshot ----
  // (a plain object from room.state.toJSON(), never mutated locally — the
  // server is the only source of truth for game state now.)

  function renderTokens(snapshot) {
    const byCell = {};
    const finishedByColor = {};
    snapshot.players.forEach(p => p.tokens.forEach((t, i) => {
      if (t.state === 'active') {
        const [r, c] = coordFor(p.color, t.pos);
        const key = r + ',' + c;
        (byCell[key] = byCell[key] || []).push({ color: p.color, i });
      } else if (t.state === 'finished') {
        (finishedByColor[p.color] = finishedByColor[p.color] || []).push(i);
      }
    }));

    snapshot.players.forEach((p, pi) => p.tokens.forEach((t, i) => {
      const el = tokenEl(p.color, i);
      el.classList.toggle('movable', !!t.movable && pi === myPlayerIdx);
      if (t.state === 'yard') {
        el.classList.remove('token-on-board', 'token-finished');
        if (el.parentElement !== yardEls[p.color]) yardEls[p.color].appendChild(el);
        el.style.left = ''; el.style.top = '';
      } else if (t.state === 'finished') {
        el.classList.remove('token-on-board');
        el.classList.add('token-finished');
        if (el.parentElement !== centerEl) centerEl.appendChild(el);
        const wedge = WEDGE[p.color];
        const group = finishedByColor[p.color];
        const gi = group.indexOf(i);
        const spread = group.length > 1 ? (gi - (group.length - 1) / 2) * 16 : 0;
        el.style.left = (wedge.axis === 'x' ? wedge.left + spread : wedge.left) + '%';
        el.style.top = (wedge.axis === 'y' ? wedge.top + spread : wedge.top) + '%';
      } else {
        el.classList.remove('token-finished');
        el.classList.add('token-on-board');
        if (el.parentElement !== tokenLayer) tokenLayer.appendChild(el);
        const [r, c] = coordFor(p.color, t.pos);
        const key = r + ',' + c;
        const stack = byCell[key];
        const si = stack.findIndex(s => s.color === p.color && s.i === i);
        const offset = stack.length > 1 ? (si - (stack.length - 1) / 2) * 3.2 : 0;
        el.style.left = ((c - 0.5) / size * 100 + offset) + '%';
        el.style.top = ((r - 0.5) / size * 100 + offset) + '%';
      }
    }));
  }

  function renderPlayersPanel(snapshot) {
    panel.innerHTML = '';
    snapshot.players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'player-row' + (i === snapshot.currentPlayerIdx ? ' current' : '');
      // Pre-game, an empty seat just hasn't joined yet ("Waiting…"). Once
      // started, "disconnected" covers both someone mid-reconnect-grace and
      // someone gone for good — the status log/banner carries that nuance,
      // this row just needs to show they're not currently in the game.
      const name = p.connected ? (p.name || 'Player') : (snapshot.started ? `${p.name || 'Player'} (disconnected)` : 'Waiting…');
      const dots = Array.from({ length: 4 }, (_, d) => `<span class="${d < p.homeCount ? 'home' : ''}"></span>`).join('');
      row.innerHTML = `
        <div class="avatar-ring" style="background:var(--${p.color});">${(name[0] || '?').toUpperCase()}</div>
        <div class="pname">${name}${i === myPlayerIdx ? ' (You)' : ''}</div>
        <div class="token-dots" style="color:var(--${p.color});">${dots}</div>
      `;
      panel.appendChild(row);
    });
  }

  function renderTurnBanner(snapshot) {
    const p = snapshot.players[snapshot.currentPlayerIdx];
    const name = p.connected ? p.name : (snapshot.started ? `${p.name} (away)` : 'Waiting');
    turnBanner.innerHTML = `<span class="dot dot-${p.color}"></span> ${name}'s Turn`;
  }

  function updateDiceUI(snapshot) {
    const myTurn = myPlayerIdx === snapshot.currentPlayerIdx;
    // Gameplay only waits on the table filling up pre-game (snapshot.started)
    // — once started, another player leaving/dropping doesn't block anyone
    // else from playing (the game keeps going with whoever's left; see
    // LudoRoom's forfeit-win rules), so this must NOT also gate on every
    // player being connected the way it used to.
    const canRollNow = myTurn && snapshot.started && !snapshot.awaitingMove && !snapshot.gameOver
      && !snapshot.turnPassPending;
    diceFace.classList.toggle('disabled', !canRollNow);

    if (snapshot.gameOver) {
      const winner = snapshot.players.find(p => p.color === snapshot.winnerColor);
      diceStatus.textContent = `🏆 ${winner ? winner.name : 'Someone'} wins!`;
      diceBadge.textContent = '🏆 Game over';
    } else if (!snapshot.started) {
      diceStatus.textContent = 'Waiting for players…';
      diceBadge.textContent = `👥 ${snapshot.players.filter(p => p.connected).length}/${snapshot.players.length} joined`;
    } else {
      diceStatus.textContent = snapshot.statusMessage || 'Tap the dice to roll';
      diceBadge.textContent = snapshot.awaitingMove
        ? (myTurn ? '👉 Choose a token to move' : `⏳ ${snapshot.players[snapshot.currentPlayerIdx].name} is choosing…`)
        : myTurn ? '🎲 Your turn to roll' : `⏳ ${snapshot.players[snapshot.currentPlayerIdx].name}'s turn`;
    }
    updateCosmeticTimer(snapshot, myTurn, snapshot.started);
  }

  // Purely decorative — the real 15s auto-roll/auto-pick timeout is
  // enforced server-side (see server/src/rooms/LudoRoom.ts); this just
  // mirrors that default locally so players still see a countdown, without
  // the client being trusted to actually act on it.
  const COSMETIC_TIMER_SECONDS = 15;
  let cosmeticInterval = null;
  let cosmeticRemaining = 0;
  let cosmeticKey = null;

  function updateCosmeticTimer(snapshot, myTurn, gameActive) {
    // Keyed on the server's turnSeq (bumped every time it arms a fresh
    // roll/select timer), NOT on currentPlayerIdx/awaitingMove: an extra
    // turn from rolling a 6 changes neither, so keying on those left the
    // countdown stuck mid-tick from the previous window — or hidden
    // entirely, if that one had already run out — while the server had
    // quietly started a whole new 15s.
    // turnPassPending means the roll already resolved and the turn is on
    // its way out, so there's nothing left to count down to.
    const key = gameActive && !snapshot.gameOver && !snapshot.turnPassPending
      ? String(snapshot.turnSeq)
      : null;

    if (key !== cosmeticKey) {
      cosmeticKey = key;
      if (cosmeticInterval) { clearInterval(cosmeticInterval); cosmeticInterval = null; }
      if (key && myTurn) {
        // Count down from when this snapshot ARRIVED, not from now:
        // rendering it can lag arrival by the dice reveal plus the
        // per-cell step animation (~2.6s worst case), and the server's
        // real timer started at arrival. Counting from render time showed
        // a full 15s that then got auto-rolled out from under the player
        // with seconds still on the clock.
        const totalMs = snapshot.turnTimeoutMs || COSMETIC_TIMER_SECONDS * 1000;
        const elapsedMs = Math.max(0, Date.now() - renderingArrivedAt);
        cosmeticRemaining = Math.max(0, Math.round((totalMs - elapsedMs) / 1000));
        if (cosmeticRemaining <= 0) { diceTimerEl.style.display = 'none'; return; }
        diceTimerEl.style.display = 'block';
        diceTimerEl.classList.toggle('urgent', cosmeticRemaining <= 5);
        const label = snapshot.awaitingMove ? 'Auto-pick in' : 'Auto-roll in';
        diceTimerEl.textContent = `⏱ ${label} ${cosmeticRemaining}s`;
        cosmeticInterval = setInterval(() => {
          cosmeticRemaining -= 1;
          if (cosmeticRemaining <= 0) { clearInterval(cosmeticInterval); cosmeticInterval = null; diceTimerEl.style.display = 'none'; return; }
          diceTimerEl.classList.toggle('urgent', cosmeticRemaining <= 5);
          diceTimerEl.textContent = `⏱ ${label} ${cosmeticRemaining}s`;
        }, 1000);
      } else {
        diceTimerEl.style.display = 'none';
      }
    }
  }

  function showGameOver(snapshot) {
    const winner = snapshot.players.find(p => p.color === snapshot.winnerColor);
    if (!winner) return;
    const stake = snapshot.stake || 0;
    const isFree = stake <= 0;
    const pot = stake * snapshot.players.length; // table size, not a fixed 4 — same math as LudoRoom.persistResult
    const fee = Math.round(pot * 0.1);
    const payout = pot - fee;
    document.getElementById('winner-icon').style.background = `var(--${winner.color}-soft)`;
    document.getElementById('winner-title').textContent = `${colorDot(winner.color)} ${winner.name} Wins!`;
    // A forfeit win (opponents left) carries the reason in the final status message ("<name> wins — <reason>").
    const forfeitReason = (snapshot.statusMessage || '').split(' wins — ')[1];
    document.getElementById('winner-sub').textContent = forfeitReason || 'All 4 tokens home';
    document.getElementById('payout-block').style.display = isFree ? 'none' : '';
    document.getElementById('free-note').style.display = isFree ? '' : 'none';
    if (!isFree) {
      document.getElementById('payout-pot').textContent = `₹${pot}`;
      document.getElementById('payout-fee').textContent = `-₹${fee}`;
      document.getElementById('payout-amount').textContent = `₹${payout}`;
    }
    gameOverOverlay.classList.add('open');
  }

  // How long a roll is shown before its consequences (token move, turn
  // change) are applied: the flight itself plus a short hold so the landed
  // face can actually be read.
  const DICE_REVEAL_MS = 1750;
  let diceFlight = null; // { el, anims, timer, timers } for the roll currently in the air

  // A soft thud for each time the rolling dice hits the board.
  function playDiceThud(vol) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.09);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  // Heights (px above the board) the dice passes through, as fractions of
  // DICE_REVEAL_MS. h = 0 means touching the board (hit = an impact). Scale
  // grows with height so it reads as coming closer to the camera.
  const DICE_PATH = [
    { t: 0,    h: 0,  ease: 'cubic-bezier(.2,.6,.4,1)' },
    { t: 0.16, h: 90, ease: 'cubic-bezier(.6,0,.8,.4)' },
    { t: 0.34, h: 0,  hit: 1 },
    { t: 0.45, h: 38, ease: 'cubic-bezier(.6,0,.8,.4)' },
    { t: 0.55, h: 0,  hit: 1 },
    { t: 0.62, h: 14, ease: 'cubic-bezier(.6,0,.8,.4)' },
    { t: 0.69, h: 0,  hit: 1 },
    { t: 0.74, h: 4,  ease: 'cubic-bezier(.6,0,.8,.4)' },
    { t: 0.78, h: 0 },
    { t: 1,    h: 0 },
  ];
  const DICE_LAND_SCALE = 0.8;

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function endDiceFlight() {
    if (!diceFlight) return;
    clearTimeout(diceFlight.timer);
    diceFlight.timers.forEach(clearTimeout);
    diceFlight.anims.forEach(a => { try { a.cancel(); } catch (e) { /* already gone */ } });
    diceFlight.el.remove();
    diceFlight = null;
    diceFace.classList.remove('flying');
  }

  // The roll animation: a clone of the cube is thrown from the roller's spot
  // (the dice button for me, the roller's yard for everyone else), tumbles on
  // all three axes, bounces three times with a shadow, and settles near the
  // board center showing the true result. Only transform/opacity animate, so
  // it stays on the GPU.
  function flyDice(prevX, prevY, rollerEl) {
    const board = document.getElementById('board-grid');
    const src = (rollerEl || diceFace).getBoundingClientRect();
    const dst = board.getBoundingClientRect();
    const sx = src.left + src.width / 2 - 32, sy = src.top + src.height / 2 - 32;
    const ex = dst.left + dst.width * (0.5 + (Math.random() - 0.5) * 0.18) - 32;
    const ey = dst.top + dst.height * (0.5 + (Math.random() - 0.5) * 0.18) - 32;

    const root = document.createElement('div');
    root.className = 'dice-fly';
    const ground = document.createElement('div');
    ground.className = 'dice-fly-ground';
    const shadow = document.createElement('div');
    shadow.className = 'dice-fly-shadow';
    const air = document.createElement('div');
    air.className = 'dice-fly-air';
    const cube = diceCube.cloneNode(true);
    cube.removeAttribute('id');
    cube.style.transition = 'none';
    cube.style.opacity = '1';
    air.appendChild(cube);
    ground.append(shadow, air);
    root.appendChild(ground);
    document.body.appendChild(root);

    const D = DICE_REVEAL_MS;
    const anims = [];
    const heightScale = (h) => (h === 0 ? DICE_LAND_SCALE : DICE_LAND_SCALE + (h / 90) * 0.5);

    // 1. Ground path: ease-out so the dice decelerates as it travels.
    anims.push(ground.animate([
      { transform: `translate(${sx}px, ${sy}px)`, easing: 'cubic-bezier(.22,.55,.3,1)' },
      { transform: `translate(${ex}px, ${ey}px)`, offset: 0.78 },
      { transform: `translate(${ex}px, ${ey}px)` },
    ], { duration: D, fill: 'forwards' }));

    // 2. Height: gravity-style up/down with a squash on each impact.
    anims.push(air.animate(DICE_PATH.map((k) => {
      const sc = k.t === 0 ? 1 : heightScale(k.h);
      const squash = k.hit ? ' scale(1.07, 0.9)' : '';
      const f = { offset: k.t, transform: `translateY(${-k.h}px) scale(${sc})${squash}` };
      if (k.ease) f.easing = k.ease;
      return f;
    }), { duration: D, fill: 'forwards' }));

    // 3. Shadow stays on the board; smaller and fainter the higher the dice is.
    anims.push(shadow.animate(DICE_PATH.map((k) => {
      const sc = 1 / (1 + k.h / 70);
      const f = { offset: k.t, transform: `translateY(48px) scale(${sc.toFixed(3)})`, opacity: (0.08 + 0.3 * sc).toFixed(3) };
      if (k.ease) f.easing = k.ease;
      return f;
    }), { duration: D, fill: 'forwards' }));

    // 4. Tumble: from where the cube was resting to the exact result face
    // (plus whole spins), decelerating. Whole Z turns so the face ends upright.
    const zTurns = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2)) * 360;
    anims.push(cube.animate([
      { transform: `rotateZ(0deg) rotateX(${prevX}deg) rotateY(${prevY}deg)`, easing: 'cubic-bezier(.12,.62,.28,1)' },
      { offset: 0.78, transform: `rotateZ(${zTurns}deg) rotateX(${currentX}deg) rotateY(${currentY}deg)` },
      { transform: `rotateZ(${zTurns}deg) rotateX(${currentX}deg) rotateY(${currentY}deg)` },
    ], { duration: D, fill: 'forwards' }));

    // Thuds on each impact, synced to the same timeline.
    const timers = DICE_PATH.filter(k => k.hit)
      .map((k, i) => setTimeout(() => playDiceThud([0.22, 0.14, 0.08][i] || 0.06), k.t * D));

    // Hand back to the resting cube: crossfade, then drop the clone.
    const timer = setTimeout(() => {
      diceFace.classList.remove('flying');
      const out = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
      anims.push(out);
      out.onfinish = () => { if (diceFlight && diceFlight.el === root) endDiceFlight(); };
    }, D - 40);
    diceFlight = { el: root, anims, timer, timers };
  }

  function revealDice(value, snapshot) {
    // Extra turns (rolling a 6) mean back-to-back rolls are common: abort any
    // flight still in the air so every roll gets its own full, uninterrupted
    // animation instead of two overlapping clones.
    endDiceFlight();
    playDiceSound();
    const target = faceOrientation[value];
    const prevX = currentX, prevY = currentY;
    currentX = spinTo(target.x, currentX, 2, 3);
    currentY = spinTo(target.y, currentY, 3, 5);

    // The resting cube jumps (no transition) to the final orientation; it is
    // hidden while the flying clone is in the air and fades back in after.
    diceCube.style.transition = 'none';
    diceCube.style.transform = `rotateX(${currentX}deg) rotateY(${currentY}deg)`;
    void diceCube.offsetWidth;
    diceCube.style.transition = '';

    if (prefersReducedMotion() || !diceFace.animate) return;
    // Who rolled? me -> the dice button; anyone else -> their yard on the board.
    let rollerEl = null;
    const p = snapshot && snapshot.players && snapshot.players[snapshot.currentPlayerIdx];
    if (p && p.sessionId !== room.sessionId && yardEls[p.color]) rollerEl = yardEls[p.color];
    diceFace.classList.add('flying');
    flyDice(prevX, prevY, rollerEl);
  }

  // Per-element so a previous hop's cleanup can't strip the class out from
  // under the next one — with per-cell stepping these now fire back to back
  // (STEP_MS apart, barely wider than the 170ms cleanup), so an untracked
  // stale timer would clip mid-walk bounces short.
  const hopTimeouts = new WeakMap();

  function hop(el) {
    clearTimeout(hopTimeouts.get(el));
    el.classList.remove('hop');
    void el.offsetWidth; // restart the animation even if the class was already there
    el.classList.add('hop');
    playHopSound();
    hopTimeouts.set(el, setTimeout(() => {
      el.classList.remove('hop');
      hopTimeouts.delete(el);
    }, 170));
  }

  function flashCapture(el) {
    el.classList.add('captured');
    playCaptureSound();
    setTimeout(() => el.classList.remove('captured'), 300);
  }

  // The server only ever sends a token's final resting position — it has no
  // notion of "board cells" at all, just an abstract path index (see
  // rules.ts) — so a 4-square move used to render as one smooth CSS slide
  // straight from A to B. That reads as the coin teleporting rather than
  // walking the board, so the client reconstructs the intermediate path
  // itself and steps through it one cell at a time, each step getting its
  // own hop() bounce + sound, same as the old locally-authoritative version.
  const STEP_MS = 180; // ~matches .token-on-board's own .16s CSS slide
  // The longest a single dice roll can move a token — used only to tell a
  // real move apart from a patch whose "previous" snapshot is actually
  // stale (e.g. the first onStateChange after a reconnect, diffed against
  // whatever was on screen before the drop). Stepping cell-by-cell across
  // that kind of gap would crawl the token across half the board, so
  // anything bigger than one roll's reach just snaps instead.
  const MAX_STEP_ANIMATE_DELTA = 6;

  async function animateTokenSteps(color, fromPos, toPos, el) {
    // 56 (finished) has no board coordinate of its own — coordFor's usable
    // range stops at 55; renderAll's normal finished-tray placement takes
    // over from there once the step animation below hands off to it.
    const lastVisiblePos = Math.min(toPos, 55);
    for (let p = fromPos + 1; p <= lastVisiblePos; p++) {
      const [r, c] = coordFor(color, p);
      el.style.left = ((c - 0.5) / size * 100) + '%';
      el.style.top = ((r - 0.5) / size * 100) + '%';
      hop(el);
      await new Promise(resolve => setTimeout(resolve, STEP_MS));
    }
  }

  function statusToLogLine(msg) {
    if (/wins!$/.test(msg)) return `🏆 ${msg}`;
    if (msg.includes('captured')) return msg;
    if (msg.includes('rolled')) return `🎲 ${msg}`;
    if (msg.includes('reached home')) return `🏠 ${msg}`;
    return msg;
  }

  // --- Colyseus connection -------------------------------------------

  // Defaults to the live Render deployment; ?server= still overrides for local dev
  // (e.g. ?server=ws://localhost:2567) or pointing at a different deployment.
  const SERVER_URL = new URLSearchParams(location.search).get('server') || 'wss://ludo-x96u.onrender.com';
  const stakeParam = new URLSearchParams(location.search).get('stake');
  const joinStake = stakeParam === null ? 50 : Math.max(0, Number(stakeParam) || 0);
  const playersParam = Number(new URLSearchParams(location.search).get('players'));
  const joinPlayerCount = [2, 4].includes(playersParam) ? playersParam : 4;
  // Set by waiting-room.html for private rooms, so a failed handoff falls back to
  // re-joining THAT room by code instead of joinOrCreate (which would drop a
  // private-room player into a random public table).
  const privateRoomCode = (new URLSearchParams(location.search).get('code') || '').toUpperCase();

  let room = null;
  let myPlayerIdx = -1;
  let prevSnapshot = null;
  // Serializes applying each snapshot's visual effects so a fresh dice roll
  // can hold its own snapshot back until the cube's spin actually finishes
  // (see applySnapshot below) without racing whatever snapshot arrives next.
  let renderQueue = Promise.resolve();
  // When the snapshot currently being rendered actually arrived from the
  // server. Rendering deliberately lags arrival (dice reveal + per-cell
  // step animation), and the server's turn timer is running that whole
  // time, so anything clock-related has to measure from here, not from
  // whenever the render finally happens. Safe as a single variable because
  // renderQueue guarantees one snapshot is in flight at a time.
  let renderingArrivedAt = Date.now();

  // Colyseus close code sent when the client called room.leave() on purpose
  // (see colyseus.js's ServerError.CloseCode.CONSENTED) — anything else means
  // the connection dropped unexpectedly and is worth trying to reconnect.
  const CONSENTED_CLOSE_CODE = 4000;
  const RECONNECT_ATTEMPTS = 20;
  const RECONNECT_DELAY_MS = 3000;

  let client = null;
  let reconnecting = false;

  function attachRoomHandlers(r) {
    room = r;
    room.onStateChange(state => handleStateChange(state.toJSON()));
    room.onLeave(code => {
      if (code === CONSENTED_CLOSE_CODE || reconnecting) return;
      attemptReconnect();
    });
  }

  async function attemptReconnect() {
    reconnecting = true;
    connectingOverlay.classList.add('open');
    connectingStatus.textContent = 'Reconnecting…';
    const token = room.reconnectionToken;

    for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS; attempt++) {
      try {
        const newRoom = await client.reconnect(token);
        reconnecting = false;
        attachRoomHandlers(newRoom);
        return;
      } catch (err) {
        console.error(`[ludo] reconnect attempt ${attempt} failed:`, err);
        // "disposed" / "not found" never recovers (match over, or the server restarted
        // and lost the room) — say so now instead of retrying for a minute.
        if (/disposed|not found/i.test(err && err.message || '')) {
          reconnecting = false;
          connectingOverlay.classList.remove('open');
          await ludoAlert({ tone: 'warn', icon: '🔌', title: 'Match ended', message: 'The match has ended, or the game server restarted. If it didn\'t finish, your stake was not charged.', confirmText: 'Back to lobby' });
          location.href = 'lobby.html';
          return;
        }
        await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS));
      }
    }

    reconnecting = false;
    connectingStatus.textContent = 'Could not reconnect to the game server.';
  }

  async function connect() {
    const { data: { session } } = await ludoSupabase.auth.getSession();
    if (!session) { location.href = 'login.html'; return; }

    const [{ data: profile }, { data: wallet }] = await Promise.all([
      ludoSupabase.from('profiles').select('display_name').eq('id', session.user.id).single(),
      ludoSupabase.from('wallets').select('balance').eq('user_id', session.user.id).single(),
    ]);
    if (walletChip && wallet) walletChip.textContent = `💰 ₹${Number(wallet.balance).toFixed(2)}`;

    client = new Colyseus.Client(SERVER_URL);
    let joined;

    // waiting-room.html hands off its live connection here instead of us
    // taking a fresh joinOrCreate seat (which would double up on the same
    // room). The handoff token is a one-shot: clear it whether or not the
    // resume actually succeeds, so a plain reload/direct board.html visit
    // afterward falls back to a normal join.
    const handoffToken = sessionStorage.getItem('ludoReconnectToken');
    if (handoffToken) {
      sessionStorage.removeItem('ludoReconnectToken');
      // ~14s total: over a real network (esp. a phone PWA) the server can take
      // well past 2s to notice the old socket closed, and until it does it has
      // no reconnection window open for this token.
      const HANDOFF_ATTEMPTS = 20;
      connectingStatus.textContent = 'Resuming your seat…';
      // No hard ordering guarantee between waiting-room.html's leave() and
      // this page's boot, so the server may not have processed the leave
      // (and opened its reconnection window) yet — a bare single attempt
      // measurably races and fails. A few quick retries absorb that without
      // meaningfully delaying the common case where it's already ready.
      for (let attempt = 1; attempt <= HANDOFF_ATTEMPTS && !joined; attempt++) {
        try {
          joined = await client.reconnect(handoffToken);
        } catch (err) {
          if (attempt === HANDOFF_ATTEMPTS) console.error('[ludo] handoff reconnect failed, falling back to a fresh join:', err);
          else await new Promise(resolve => setTimeout(resolve, 700));
        }
      }
    }

    if (!joined) {
      connectingStatus.textContent = 'Joining a table…';
      // Same cold-start reasoning as the handoff retry above, plus
      // waiting-room.html's own join retry: the live server (Render free
      // tier) can take well past 60s to wake from idle in practice (a real
      // trace confirmed a 60s retry window still wasn't enough after a
      // multi-day idle period), so a bare single attempt here fails outright
      // during that window instead of just being slow. Retry for up to two
      // minutes before giving up for real.
      for (let attempt = 1; attempt <= 30 && !joined; attempt++) {
        try {
          const fallbackOptions = {
            name: profile?.display_name || session.user.email || 'Player',
            userId: session.user.id,
            accessToken: session.access_token,
            stake: joinStake,
            playerCount: joinPlayerCount,
          };
          joined = privateRoomCode
            ? await client.joinById(privateRoomCode, fallbackOptions)
            : await client.joinOrCreate('ludo', fallbackOptions);
        } catch (err) {
          if (privateRoomCode && err && /not found|locked|full/i.test(err.message || '')) {
            connectingStatus.innerHTML = 'This private room is no longer available. <a href="lobby.html">Back to lobby</a>';
            return;
          }
          if (err && err.code === 4402) {
            connectingStatus.innerHTML = 'Not enough available balance for this table (funds locked in other games don\'t count). <a href="wallet.html">Open wallet</a>';
            return;
          }
          if (err && (err.code === 4503 || err.code === 4504)) {
            connectingStatus.innerHTML = (err.code === 4503 ? 'The game is briefly down for maintenance. Please try again soon.' : 'Cash tables are paused right now. Free tables are still open.') + ' <a href="lobby.html">Back to lobby</a>';
            return;
          }
          if (err && err.code === 4403) {
            connectingStatus.innerHTML = 'Cash tables are for Pro members. <a href="wallet.html#pro">Go Pro</a>';
            return;
          }
          if (attempt === 1) {
            connectingStatus.textContent = 'Waking up the game server — this can take a couple of minutes…';
          }
          if (attempt === 30) {
            console.error('[ludo] failed to join room:', err);
            connectingStatus.textContent = 'Could not reach the game server. Is it running?';
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }
    }

    attachRoomHandlers(joined);
  }

  function handleStateChange(snapshot) {
    myPlayerIdx = snapshot.players.findIndex(p => p.sessionId === room.sessionId);
    // Full-board block only for "still filling the table" (pre-game) or "my
    // own connection is the problem" — once the game has started, another
    // player leaving/dropping does NOT block the board for everyone else
    // (the game keeps going with whoever's left; see LudoRoom's forfeit-win
    // rules), it just becomes a status message + log entry like any other
    // game event, same as e.g. "X captured Y's token".
    const myConnected = myPlayerIdx === -1 || snapshot.players[myPlayerIdx].connected;
    const blockBoard = !snapshot.started || !myConnected;

    connectingOverlay.classList.toggle('open', blockBoard);
    if (blockBoard) connectingStatus.textContent = snapshot.statusMessage || 'Waiting for players…';

    // Everything above is about connectivity and must reflect this snapshot
    // right away. Everything below is the snapshot's visual *consequences*
    // (did a token move, did the turn pass, ...) and is queued instead of
    // applied immediately — see applySnapshot for why.
    const arrivedAt = Date.now();
    renderQueue = renderQueue.then(() => applySnapshot(snapshot, arrivedAt));
  }

  // Applies one snapshot's diff against the previous one, in order, one at
  // a time. Queued (rather than called directly from handleStateChange)
  // because a fresh dice roll needs to hold its own snapshot back until the
  // cube's 1550ms spin actually finishes: the server can move a token (and
  // even pass the turn) in the very same patch as the roll that caused it,
  // and rendering that patch immediately made the token teleport to its
  // destination — hop sound and all — while the dice was still visibly
  // mid-spin, before the player could even see what they'd rolled. Chaining
  // through a single promise keeps snapshots applied in server order even
  // when several land in quick succession (e.g. consecutive 6s), each
  // getting its own full reveal before the next one starts.
  async function applySnapshot(snapshot, arrivedAt) {
    renderingArrivedAt = arrivedAt;
    // The whole body is wrapped, not just renderAll — applySnapshot calls
    // are now chained through renderQueue (see handleStateChange), so an
    // uncaught throw here wouldn't just skip one frame like it used to, it'd
    // reject that link in the chain and silently freeze every render for
    // the rest of the match (every future .then() staying on a rejected
    // promise forever). The finally still guarantees prevSnapshot always
    // advances, same reasoning as before: a bad snapshot should log and get
    // skipped, never get re-diffed against itself forever.
    try {
      if (!prevSnapshot) {
        renderAll(snapshot);
        return;
      }

      // Keyed on rollSeq, NOT on diceValue itself: a die only has 6 faces,
      // so two consecutive rolls landing on the same number is a 1-in-6
      // event on every single turn — common enough that comparing values
      // silently skipped the whole reveal (and the move/turn-pass it
      // gates) whenever it happened, making the dice look frozen mid-game.
      if (snapshot.rollSeq !== prevSnapshot.rollSeq) {
        revealDice(snapshot.diceValue, snapshot);
        await new Promise(resolve => setTimeout(resolve, DICE_REVEAL_MS));
      }

      // Diff every token against the previous snapshot to trigger the right
      // cosmetic effect — the server already decided WHAT happened, the
      // client only has to notice and animate it. Real moves step through
      // every intermediate cell (awaited, so they finish before anything
      // else renders); a yard entry (no path to walk yet) or an oversized
      // jump (see MAX_STEP_ANIMATE_DELTA) just gets an immediate bump; a
      // capture only flashes once the capturing token has actually arrived.
      const moverPromises = [];
      const capturedEls = [];
      snapshot.players.forEach((p, pi) => {
        const prevPlayer = prevSnapshot.players[pi];
        if (!prevPlayer) return;
        p.tokens.forEach((t, ti) => {
          const prevT = prevPlayer.tokens[ti];
          if (!prevT) return;
          const el = tokenEl(p.color, ti);

          if (prevT.state === 'active' && t.state === 'yard') {
            capturedEls.push(el);
            return;
          }
          if (prevT.state === t.state && prevT.pos === t.pos) return;

          const isNormalMove = prevT.state === 'active' && t.pos > prevT.pos
            && (t.pos - prevT.pos) <= MAX_STEP_ANIMATE_DELTA;
          if (isNormalMove) {
            moverPromises.push(animateTokenSteps(p.color, prevT.pos, t.pos, el));
          } else {
            hop(el);
          }
        });
      });

      await Promise.all(moverPromises);
      capturedEls.forEach(flashCapture);

      renderAll(snapshot);

      if (snapshot.statusMessage && snapshot.statusMessage !== prevSnapshot.statusMessage) {
        log(statusToLogLine(snapshot.statusMessage));
      }
      if (snapshot.gameOver && !prevSnapshot.gameOver) showGameOver(snapshot);
    } catch (err) {
      console.error('[ludo] applySnapshot failed for this snapshot:', err, snapshot);
    } finally {
      prevSnapshot = snapshot;
    }
  }

  // Wraps the per-snapshot render calls so one bad token/state never freezes
  // the rest of the board — logs and moves on instead of leaving the UI
  // stuck showing stale movable/click state that no longer matches the
  // server (see the comment on prevSnapshot above for how that happens).
  function renderAll(snapshot) {
    try {
      renderTokens(snapshot);
      renderPlayersPanel(snapshot);
      renderTurnBanner(snapshot);
      updateDiceUI(snapshot);
    } catch (err) {
      console.error('[ludo] render failed for this snapshot:', err, snapshot);
    }
  }

  diceFace.addEventListener('click', () => {
    if (!room || diceFace.classList.contains('disabled')) return;
    room.send('roll');
  });

  function onTokenClick(color, index) {
    if (!room) return;
    const el = tokenEl(color, index);
    if (!el.classList.contains('movable')) return;
    room.send('selectToken', { tokenIndex: index });
  }

  document.getElementById('log-toggle').addEventListener('click', () => {
    document.getElementById('log-panel').classList.toggle('open');
  });

  document.getElementById('exit-link').addEventListener('click', async (e) => {
    if (!room) return; // not connected yet — plain navigation is fine
    e.preventDefault();
    if (!(await ludoConfirm({ tone: 'danger', icon: '🚪', title: 'Leave this match?', message: 'The other player will see that you left and may win by forfeit.', confirmText: 'Leave match', cancelText: 'Keep playing' }))) return;
    // Consented leave (Colyseus close code 4000) — LudoRoom's onLeave shows
    // "<name> left the game." to everyone else instead of holding the seat
    // open for the reconnection grace period like an accidental drop would.
    // Awaited so the navigation below can't cut the WebSocket off before the
    // LEAVE_ROOM message actually reaches the server — a bare fire-and-forget
    // call raced and lost in exactly this way when this same pattern was
    // first tried for the waiting-room -> board handoff. That round trip is
    // usually well under a second but isn't instant, and with nothing on
    // screen acknowledging the click, the board just sat there unchanged
    // until the sudden jump to lobby.html — reported as an unexplained
    // delay. Reusing the connecting-overlay here doesn't shorten the wait
    // (still needed, still real), it just makes clear the app is actually
    // leaving the match rather than looking stuck.
    connectingOverlay.classList.add('open');
    connectingStatus.textContent = 'Leaving match…';
    reconnecting = true; // suppress attachRoomHandlers' onLeave auto-reconnect for this deliberate close
    // room.leave() resolves only once the server's close frame comes back, and
    // through Render's proxy that echo can lag ~20s (same proxy delay that
    // slows close detection on the handoff). The LEAVE_ROOM message itself has
    // long since been sent, so cap the wait instead of sitting on "Leaving…".
    await Promise.race([room.leave(true), new Promise(resolve => setTimeout(resolve, 1500))]);
    location.href = 'lobby.html';
  });

  connect();
})();
