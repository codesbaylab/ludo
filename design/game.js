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
    const canRollNow = myTurn && snapshot.started && !snapshot.awaitingMove && !snapshot.gameOver;
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
    const key = gameActive && !snapshot.gameOver
      ? `${snapshot.currentPlayerIdx}:${snapshot.awaitingMove}`
      : null;

    if (key !== cosmeticKey) {
      cosmeticKey = key;
      if (cosmeticInterval) { clearInterval(cosmeticInterval); cosmeticInterval = null; }
      if (key && myTurn) {
        cosmeticRemaining = COSMETIC_TIMER_SECONDS;
        diceTimerEl.style.display = 'block';
        diceTimerEl.classList.remove('urgent');
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
    const pot = stake * 4;
    const fee = Math.round(pot * 0.1);
    const payout = pot - fee;
    document.getElementById('winner-icon').style.background = `var(--${winner.color}-soft)`;
    document.getElementById('winner-title').textContent = `${colorDot(winner.color)} ${winner.name} Wins!`;
    document.getElementById('payout-block').style.display = isFree ? 'none' : '';
    document.getElementById('free-note').style.display = isFree ? '' : 'none';
    if (!isFree) {
      document.getElementById('payout-pot').textContent = `₹${pot}`;
      document.getElementById('payout-fee').textContent = `-₹${fee}`;
      document.getElementById('payout-amount').textContent = `₹${payout}`;
    }
    gameOverOverlay.classList.add('open');
  }

  let diceRollTimeout = null;

  function revealDice(value) {
    // Extra turns (rolling a 6) mean back-to-back rolls are common — without
    // this, a second roll landing before the first roll's 1550ms cleanup
    // fires would get its ".rolling" animation cut short by that stale
    // timer, snapping the dice cube mid-animation instead of finishing the
    // second roll's spin. Cancel any pending cleanup and force-restart the
    // CSS animation (same reflow trick hop() already uses) so every roll
    // gets its own full, uninterrupted 1550ms.
    if (diceRollTimeout) clearTimeout(diceRollTimeout);
    diceFace.classList.remove('rolling');
    diceShadow.classList.remove('rolling');
    void diceFace.offsetWidth;
    diceFace.classList.add('rolling');
    diceShadow.classList.add('rolling');
    playDiceSound();
    const target = faceOrientation[value];
    currentX = spinTo(target.x, currentX, 2, 3);
    currentY = spinTo(target.y, currentY, 3, 5);
    diceCube.style.transform = `rotateX(${currentX}deg) rotateY(${currentY}deg)`;
    diceRollTimeout = setTimeout(() => {
      diceFace.classList.remove('rolling');
      diceShadow.classList.remove('rolling');
      diceRollTimeout = null;
    }, 1550);
  }

  function hop(el) {
    el.classList.remove('hop');
    void el.offsetWidth; // restart the animation even if the class was already there
    el.classList.add('hop');
    playHopSound();
    setTimeout(() => el.classList.remove('hop'), 170);
  }

  function flashCapture(el) {
    el.classList.add('captured');
    playCaptureSound();
    setTimeout(() => el.classList.remove('captured'), 300);
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

  let room = null;
  let myPlayerIdx = -1;
  let prevSnapshot = null;

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
      connectingStatus.textContent = 'Resuming your seat…';
      // No hard ordering guarantee between waiting-room.html's leave() and
      // this page's boot, so the server may not have processed the leave
      // (and opened its reconnection window) yet — a bare single attempt
      // measurably races and fails. A few quick retries absorb that without
      // meaningfully delaying the common case where it's already ready.
      for (let attempt = 1; attempt <= 5 && !joined; attempt++) {
        try {
          joined = await client.reconnect(handoffToken);
        } catch (err) {
          if (attempt === 5) console.error('[ludo] handoff reconnect failed, falling back to a fresh join:', err);
          else await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
    }

    if (!joined) {
      connectingStatus.textContent = 'Joining a table…';
      try {
        joined = await client.joinOrCreate('ludo', {
          name: profile?.display_name || session.user.email || 'Player',
          userId: session.user.id,
          stake: joinStake,
          playerCount: joinPlayerCount,
        });
      } catch (err) {
        console.error('[ludo] failed to join room:', err);
        connectingStatus.textContent = 'Could not reach the game server. Is it running?';
        return;
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

    if (!prevSnapshot) {
      renderAll(snapshot);
      prevSnapshot = snapshot;
      return;
    }

    if (snapshot.diceValue !== prevSnapshot.diceValue && snapshot.diceValue > 0) {
      revealDice(snapshot.diceValue);
    }

    // Diff every token against the previous snapshot to trigger the right
    // cosmetic effect — the server already decided WHAT happened, the
    // client only has to notice and animate it.
    snapshot.players.forEach((p, pi) => {
      const prevPlayer = prevSnapshot.players[pi];
      if (!prevPlayer) return;
      p.tokens.forEach((t, ti) => {
        const prevT = prevPlayer.tokens[ti];
        if (!prevT) return;
        const el = tokenEl(p.color, ti);
        if (prevT.state === 'active' && t.state === 'yard') {
          flashCapture(el);
        } else if (prevT.pos !== t.pos || prevT.state !== t.state) {
          hop(el);
        }
      });
    });

    renderAll(snapshot);

    if (snapshot.statusMessage && snapshot.statusMessage !== prevSnapshot.statusMessage) {
      log(statusToLogLine(snapshot.statusMessage));
    }
    if (snapshot.gameOver && !prevSnapshot.gameOver) showGameOver(snapshot);

    // Always advance, even if a render call above threw — otherwise a single
    // bad snapshot repeats the same crash on every future update forever
    // (this is exactly how a real bug froze a live match: a server/client
    // position mismatch made renderTokens throw, which skipped this line,
    // which fed the same stale snapshot into the next diff, which threw
    // again — movable glows and click handlers never got a chance to catch
    // up to the real state again for the rest of that game).
    prevSnapshot = snapshot;
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
    if (!confirm('Leave this match? The other player will see that you left.')) return;
    // Consented leave (Colyseus close code 4000) — LudoRoom's onLeave shows
    // "<name> left the game." to everyone else instead of holding the seat
    // open for the reconnection grace period like an accidental drop would.
    // Awaited so the navigation below can't cut the WebSocket off before the
    // LEAVE_ROOM message actually reaches the server — a bare fire-and-forget
    // call raced and lost in exactly this way when this same pattern was
    // first tried for the waiting-room -> board handoff.
    reconnecting = true; // suppress attachRoomHandlers' onLeave auto-reconnect for this deliberate close
    await room.leave(true);
    location.href = 'lobby.html';
  });

  connect();
})();
