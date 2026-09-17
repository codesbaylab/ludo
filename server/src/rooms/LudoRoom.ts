import { Room, Client } from 'colyseus';
import { LudoState, PlayerState, TokenState } from './schema/LudoState';
import {
  Color,
  TURN_ORDER,
  FINISHED_POS,
  absoluteRingIndex,
  isSafeAbsoluteIndex,
  movableTokenIndices,
} from '../rules';
import { getSupabase } from '../supabase';

interface JoinOptions {
  name?: string;
  userId?: string; // Supabase auth user id, once Phase C wires client auth. Optional for now.
}

interface CreateOptions {
  stake?: number;
  // 2 or 4; defaults to 4 (a full table) when omitted or out of range.
  playerCount?: number;
  // Overridable so the automated smoke test doesn't have to wait 15s per turn.
  rollTimeoutMs?: number;
  selectTimeoutMs?: number;
  // How long a disconnected player's seat stays reserved for a reconnect,
  // in seconds. Overridable so tests don't have to wait a full minute.
  reconnectGraceSeconds?: number;
  // Overridable so tests don't have to wait through the pause below.
  turnPassDelayMs?: number;
}

// Which colors play at a smaller table, chosen for board balance rather
// than arbitrarily: yellow/red sit at opposite corners of the ring (same
// gap as green/blue), matching the classic 2-player Ludo variant.
const COLORS_BY_PLAYER_COUNT: Record<number, Color[]> = {
  2: ['yellow', 'red'],
  4: TURN_ORDER,
};

export class LudoRoom extends Room<LudoState> {
  maxClients = 4;

  private rollTimeoutMs = 15000;
  private selectTimeoutMs = 15000;
  private reconnectGraceSeconds = 60;
  // Colyseus batches every schema mutation made within one JS tick into a
  // single patch — so a resolveRoll() that sets diceValue/statusMessage and
  // then calls passTurn() synchronously (same tick) never actually shows
  // clients the roll: passTurn() overwrites statusMessage with "<next>'s
  // turn." before either value is ever broadcast, and currentPlayerIdx
  // flips in that same patch. A player watching this (most visibly the
  // idle-timeout auto-roll, but a manual roll with no valid move hits the
  // exact same path) sees the turn jump to the other player with no visible
  // "you rolled a 4, no valid moves" beat — looks like the dice never
  // rolled at all. This delay lets the roll's own patch reach clients (and
  // revealDice's animation start) before the turn actually passes.
  private turnPassDelayMs = 1200;
  private rollTimer: any = null;
  private selectTimer: any = null;
  private passTurnTimer: any = null;
  // Supabase auth user id per session, only populated for clients that pass
  // one at join time. Not part of the synced schema (opponents don't need it).
  private sessionUserIds: Record<string, string> = {};

  onCreate(options: CreateOptions) {
    this.rollTimeoutMs = options.rollTimeoutMs ?? 15000;
    this.selectTimeoutMs = options.selectTimeoutMs ?? 15000;
    this.reconnectGraceSeconds = options.reconnectGraceSeconds ?? 60;
    this.turnPassDelayMs = options.turnPassDelayMs ?? 1200;

    const playerCount = COLORS_BY_PLAYER_COUNT[options.playerCount!] ? options.playerCount! : 4;
    this.maxClients = playerCount;

    const state = new LudoState();
    state.stake = options.stake ?? 0;
    COLORS_BY_PLAYER_COUNT[playerCount]!.forEach((color) => {
      const player = new PlayerState();
      player.color = color;
      for (let i = 0; i < 4; i++) player.tokens.push(new TokenState());
      state.players.push(player);
    });
    this.setState(state);
    // Read by filterBy(['playerCount', 'stake']) in index.ts so joinOrCreate
    // only matches players who asked for the same table size and stake.
    this.setMetadata({ playerCount, stake: state.stake });

    this.onMessage('roll', (client) => this.handleRoll(client));
    this.onMessage('selectToken', (client, message) => this.handleSelectToken(client, message));
  }

  onJoin(client: Client, options: JoinOptions = {}) {
    const slot = this.state.players.find((p) => !p.connected);
    if (!slot) {
      client.leave();
      return;
    }
    slot.sessionId = client.sessionId;
    slot.name = (options.name || `Player ${this.state.players.indexOf(slot) + 1}`).slice(0, 24);
    slot.connected = true;
    if (options.userId) this.sessionUserIds[client.sessionId] = options.userId;

    if (this.state.players.every((p) => p.connected)) {
      this.state.started = true;
      this.state.statusMessage = `${this.state.players[0]!.name}'s turn.`;
      this.armRollTimer(0);
    } else {
      const connected = this.state.players.filter((p) => p.connected).length;
      this.state.statusMessage = `Waiting for players… (${connected}/${this.state.players.length})`;
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.find((p) => p.sessionId === client.sessionId);
    if (!player) return;

    player.connected = false;
    if (this.state.gameOver) return;

    if (!this.state.started) {
      // Still filling the table pre-game — no turn order or timers exist
      // yet, so there's nothing to skip and no forfeit-win to apply.
      const connected = this.state.players.filter((p) => p.connected).length;
      this.state.statusMessage = `Waiting for players… (${connected}/${this.state.players.length})`;
      return;
    }

    if (consented) {
      // Explicit client.leave() — not a dropped connection, don't wait for
      // one. sessionUserIds is intentionally NOT cleared: harmless to keep,
      // and client.sessionId survives a (now moot, for a consented leave)
      // reconnect either way.
      const reason = `${player.name} left the game.`;
      this.state.statusMessage = reason;
      this.checkForfeitWin(reason);
      return;
    }

    this.state.statusMessage = `${player.name} disconnected — reconnecting…`;
    try {
      await this.allowReconnection(client, this.reconnectGraceSeconds);
    } catch {
      // Grace period expired without a reconnect — they're gone for good.
      const reason = `${player.name} disconnected and never reconnected.`;
      this.state.statusMessage = reason;
      this.checkForfeitWin(reason);
      return;
    }

    // Reconnected within the grace window. The rest of the table was never
    // paused waiting for this (see checkForfeitWin/handleRoll below) — deal
    // timers already kept cycling through whoever's turn it actually was —
    // so this just needs to resume this player's own turn if it's
    // currently theirs, giving them a fresh window rather than whatever was
    // left when they dropped.
    player.connected = true;
    this.state.statusMessage = `${player.name} reconnected.`;
    if (this.state.currentPlayerIdx !== this.state.players.indexOf(player)) return;
    if (this.state.awaitingMove) {
      const options = this.currentPlayer()
        .tokens.map((t, i) => (t.movable ? i : -1))
        .filter((i) => i >= 0);
      this.armSelectTimer(this.state.currentPlayerIdx, options);
    } else {
      this.armRollTimer(this.state.currentPlayerIdx);
    }
  }

  /** Called once someone's confirmed gone for good (a consented leave, or
   *  an unconsented drop whose reconnection grace period expired). If that
   *  leaves exactly one player still connected, they win by forfeit —
   *  matching a normal win's path (gameOver, winnerColor, persistResult).
   *  With 2+ still connected, the game just keeps going: whoever's turn it
   *  is (now or once the existing roll/select timers naturally cycle past
   *  the departed player — those timers never checked connection status,
   *  so they already auto-play an absent player's turn the same way they
   *  already auto-play an idle-but-connected one) carries on unaffected. */
  private checkForfeitWin(reason: string) {
    const stillConnected = this.state.players.filter((p) => p.connected);
    if (stillConnected.length !== 1) return;
    const winnerIdx = this.state.players.indexOf(stillConnected[0]!);
    this.declareWinner(winnerIdx, `${stillConnected[0]!.name} wins — ${reason}`);
  }

  // --- Turn flow -----------------------------------------------------

  private currentPlayer(): PlayerState {
    // Always populated: the table's player slots (2-4, per COLORS_BY_PLAYER_COUNT)
    // are created up front in onCreate() and currentPlayerIdx only ever cycles
    // within that range.
    return this.state.players[this.state.currentPlayerIdx]!;
  }

  private handleRoll(client: Client) {
    const playerIdx = this.state.players.findIndex((p) => p.sessionId === client.sessionId);
    if (playerIdx === -1) return;
    if (this.state.gameOver) return;
    if (playerIdx !== this.state.currentPlayerIdx) return;
    if (this.state.awaitingMove) return;
    if (this.state.turnPassPending) return;

    this.rollTimer?.clear();
    this.resolveRoll(playerIdx);
  }

  private resolveRoll(playerIdx: number) {
    const player = this.state.players[playerIdx]!;
    const result = 1 + Math.floor(Math.random() * 6);
    this.state.diceValue = result;
    this.state.consecutiveSixes = result === 6 ? this.state.consecutiveSixes + 1 : 0;

    if (this.state.consecutiveSixes === 3) {
      this.state.consecutiveSixes = 0;
      this.state.statusMessage = `${player.name} rolled three 6s in a row — turn forfeited!`;
      this.schedulePassTurn();
      return;
    }

    const plainTokens = player.tokens.map((t) => ({ state: t.state, pos: t.pos }));
    const options = movableTokenIndices(plainTokens, result);
    player.tokens.forEach((t) => (t.movable = false));

    if (options.length === 0) {
      if (result === 6) {
        this.state.statusMessage = `${player.name} rolled a 6 but has no valid move — roll again.`;
        this.armRollTimer(playerIdx);
        return;
      }
      this.state.statusMessage = `No valid moves for ${player.name}.`;
      this.schedulePassTurn();
      return;
    }

    if (options.length === 1) {
      this.applyMove(playerIdx, options[0], result);
      return;
    }

    options.forEach((i) => (player.tokens[i]!.movable = true));
    this.state.awaitingMove = true;
    this.state.statusMessage = `${player.name}, choose a token to move.`;
    this.armSelectTimer(playerIdx, options);
  }

  private handleSelectToken(client: Client, message: { tokenIndex?: number }) {
    const playerIdx = this.state.players.findIndex((p) => p.sessionId === client.sessionId);
    if (playerIdx === -1) return;
    if (!this.state.awaitingMove) return;
    if (playerIdx !== this.state.currentPlayerIdx) return;

    const tokenIndex = message.tokenIndex;
    if (typeof tokenIndex !== 'number') return;
    const player = this.state.players[playerIdx]!;
    const token = player.tokens[tokenIndex];
    if (!token || !token.movable) return;

    this.selectTimer?.clear();
    this.applyMove(playerIdx, tokenIndex, this.state.diceValue);
  }

  /** Picks a sensible auto-move when the selection timer runs out: prefer a
   *  capture, otherwise whichever token is furthest along its path. */
  private autoPickToken(playerIdx: number, options: number[]) {
    const player = this.state.players[playerIdx]!;
    let best = options[0]!;
    let bestScore = -1;
    options.forEach((i) => {
      const t = player.tokens[i]!;
      const newPos = t.state === 'yard' ? 0 : t.pos + this.state.diceValue;
      const captures = this.wouldCapture(playerIdx, newPos);
      const score = (captures ? 1000 : 0) + newPos;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    this.applyMove(playerIdx, best, this.state.diceValue);
  }

  private wouldCapture(playerIdx: number, newPos: number): boolean {
    if (newPos > 50) return false;
    const color = this.state.players[playerIdx]!.color as Color;
    const absIdx = absoluteRingIndex(color, newPos);
    if (isSafeAbsoluteIndex(absIdx)) return false;
    return this.state.players.some(
      (opp, oi) =>
        oi !== playerIdx &&
        opp.tokens.some((t) => t.state === 'active' && t.pos <= 50 && absoluteRingIndex(opp.color as Color, t.pos) === absIdx)
    );
  }

  private applyMove(playerIdx: number, tokenIndex: number, roll: number) {
    const player = this.state.players[playerIdx]!;
    const token = player.tokens[tokenIndex]!;

    player.tokens.forEach((t) => (t.movable = false));
    this.state.awaitingMove = false;

    // Every branch below must end up setting a message. A plain ring move
    // used to set none at all, which left whatever was there before frozen
    // on screen — and since a 6 grants an extra turn (so passTurn() never
    // runs to overwrite it), players were left staring at "X, choose a
    // token to move." with nothing selectable while the game was actually
    // waiting on them to roll again. It also meant plain moves never
    // appeared in the game log, since that only logs on message changes.
    let moveMessage = `${player.name} moved ${roll}.`;

    if (token.state === 'yard') {
      token.state = 'active';
      token.pos = 0;
      moveMessage = `${player.name} brought a token out.`;
    } else {
      token.pos += roll;
      if (token.pos === FINISHED_POS) {
        token.state = 'finished';
        player.homeCount++;
        moveMessage = `${player.name}'s token reached home!`;
      }
    }

    let capturedSomething = false;
    if (token.state === 'active' && token.pos <= 50) {
      const absIdx = absoluteRingIndex(player.color as Color, token.pos);
      if (!isSafeAbsoluteIndex(absIdx)) {
        this.state.players.forEach((opp, oppIdx) => {
          if (oppIdx === playerIdx) return;
          const hits = opp.tokens.filter(
            (t) => t.state === 'active' && t.pos <= 50 && absoluteRingIndex(opp.color as Color, t.pos) === absIdx
          );
          // A stack of 2+ same-color tokens is a protected block — only a
          // lone opposing token gets captured.
          if (hits.length === 1) {
            hits[0].state = 'yard';
            hits[0].pos = -1;
            capturedSomething = true;
            moveMessage = `${player.name} captured ${opp.name}'s token!`;
          }
        });
      }
    }

    if (player.homeCount === 4) {
      this.declareWinner(playerIdx, `${player.name} wins!`);
      return;
    }

    const extraTurn = roll === 6 || capturedSomething || token.state === 'finished';
    // On an extra turn this message is the only thing telling the player
    // the board is waiting on them again, since passTurn() won't run.
    this.state.statusMessage = extraTurn ? `${moveMessage} Roll again!` : moveMessage;
    if (extraTurn) {
      this.armRollTimer(playerIdx);
    } else {
      // schedulePassTurn, not passTurn: calling passTurn() here would
      // overwrite the message just set, in the same tick, so Colyseus would
      // batch both into one patch and clients would only ever see "<next>'s
      // turn." — the move itself would never show or reach the game log.
      // The delay is mostly absorbed by the client's own dice-reveal/step
      // animation for this same patch, so it doesn't add dead time.
      this.schedulePassTurn();
    }
  }

  private declareWinner(winnerIdx: number, statusMessage: string) {
    const winner = this.state.players[winnerIdx]!;
    this.state.gameOver = true;
    this.state.winnerColor = winner.color;
    this.state.statusMessage = statusMessage;
    this.clearTimers();
    this.persistResult(winnerIdx).catch((err) => console.error('[ludo] persistResult failed:', err));
  }

  private passTurn() {
    this.state.turnPassPending = false;
    this.state.consecutiveSixes = 0;
    this.state.awaitingMove = false;
    this.state.players.forEach((p) => p.tokens.forEach((t) => (t.movable = false)));
    this.state.currentPlayerIdx = (this.state.currentPlayerIdx + 1) % this.state.players.length;
    const next = this.currentPlayer();
    this.state.statusMessage = `${next.name}'s turn.`;
    this.armRollTimer(this.state.currentPlayerIdx);
  }

  /** Used instead of calling passTurn() directly whenever the turn ends on
   *  the strength of a message (no valid moves / three 6s) that passTurn()
   *  would otherwise immediately clobber in the same patch — see
   *  turnPassDelayMs above for the full reasoning. */
  private schedulePassTurn() {
    this.state.turnPassPending = true;
    this.passTurnTimer?.clear();
    this.passTurnTimer = this.clock.setTimeout(() => {
      this.passTurnTimer = null;
      if (this.state.gameOver) return;
      this.passTurn();
    }, this.turnPassDelayMs);
  }

  // --- Timers (auto-roll / auto-pick if a player leaves the game idle) ---

  private armRollTimer(playerIdx: number) {
    this.rollTimer?.clear();
    this.startTurnCountdown(this.rollTimeoutMs);
    this.rollTimer = this.clock.setTimeout(() => {
      if (this.state.gameOver) return;
      if (this.state.currentPlayerIdx !== playerIdx) return;
      if (this.state.awaitingMove) return;
      this.resolveRoll(playerIdx);
    }, this.rollTimeoutMs);
  }

  private armSelectTimer(playerIdx: number, options: number[]) {
    this.selectTimer?.clear();
    this.startTurnCountdown(this.selectTimeoutMs);
    this.selectTimer = this.clock.setTimeout(() => {
      if (this.state.gameOver) return;
      if (!this.state.awaitingMove) return;
      this.autoPickToken(playerIdx, options);
    }, this.selectTimeoutMs);
  }

  /** Tells clients a fresh countdown window just started, and how long it
   *  is. Keyed on a counter rather than left for the client to infer from
   *  currentPlayerIdx/awaitingMove, neither of which changes on an extra
   *  turn — so that case used to leave the on-screen countdown stuck on
   *  whatever was left of the previous one (or hidden entirely). */
  private startTurnCountdown(timeoutMs: number) {
    this.state.turnSeq++;
    this.state.turnTimeoutMs = timeoutMs;
  }

  private clearTimers() {
    this.rollTimer?.clear();
    this.selectTimer?.clear();
    this.passTurnTimer?.clear();
  }

  // --- Persistence ------------------------------------------------------

  private async persistResult(winnerIdx: number) {
    const supabase = getSupabase();
    if (!supabase) return;

    const players = this.state.players;
    const userIds = players.map((p) => this.sessionUserIds[p.sessionId]);
    if (userIds.some((id) => !id)) {
      console.warn('[ludo] skipping result persistence: not every player had an auth userId (Phase C not wired yet)');
      return;
    }

    const { data: match, error: matchErr } = await supabase
      .from('matches')
      .insert({
        stake: this.state.stake,
        status: 'finished',
        winner_id: userIds[winnerIdx],
        finished_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (matchErr || !match) {
      console.error('[ludo] failed to insert match row:', matchErr);
      return;
    }

    const rows = players.map((p, i) => ({
      match_id: match.id,
      user_id: userIds[i],
      color: p.color,
      result: i === winnerIdx ? 'win' : 'lose',
    }));
    const { error: playersErr } = await supabase.from('match_players').insert(rows);
    if (playersErr) console.error('[ludo] failed to insert match_players rows:', playersErr);

    if (this.state.stake > 0) {
      const pot = this.state.stake * players.length;
      const fee = Math.round(pot * 0.1);
      const payout = pot - fee;
      // increment_wallet_balance does `balance = balance + delta` in one
      // UPDATE statement (see migration add_atomic_increment_wallet_balance_rpc),
      // so concurrent matches finishing for the same user can no longer race
      // like a plain read-then-write would.
      for (let i = 0; i < players.length; i++) {
        const uid = userIds[i];
        const delta = i === winnerIdx ? payout - this.state.stake : -this.state.stake;
        const { error } = await supabase.rpc('increment_wallet_balance', { p_user_id: uid, p_delta: delta });
        if (error) console.error(`[ludo] failed to update wallet balance for ${uid}:`, error);
      }
    }
  }
}
