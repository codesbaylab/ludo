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
  // 2-4; defaults to 4 (a full table) when omitted or out of range.
  playerCount?: number;
  // Overridable so the automated smoke test doesn't have to wait 15s per turn.
  rollTimeoutMs?: number;
  selectTimeoutMs?: number;
}

// Which colors play at a smaller table, chosen for board balance rather
// than arbitrarily: yellow/red sit at opposite corners of the ring (same
// gap as green/blue), matching the classic 2-player Ludo variant.
const COLORS_BY_PLAYER_COUNT: Record<number, Color[]> = {
  2: ['yellow', 'red'],
  3: ['green', 'blue', 'red'],
  4: TURN_ORDER,
};

export class LudoRoom extends Room<LudoState> {
  maxClients = 4;

  private rollTimeoutMs = 15000;
  private selectTimeoutMs = 15000;
  private rollTimer: any = null;
  private selectTimer: any = null;
  // Supabase auth user id per session, only populated for clients that pass
  // one at join time. Not part of the synced schema (opponents don't need it).
  private sessionUserIds: Record<string, string> = {};

  onCreate(options: CreateOptions) {
    this.rollTimeoutMs = options.rollTimeoutMs ?? 15000;
    this.selectTimeoutMs = options.selectTimeoutMs ?? 15000;

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
      this.state.statusMessage = `${this.state.players[0]!.name}'s turn.`;
      this.armRollTimer(0);
    } else {
      const connected = this.state.players.filter((p) => p.connected).length;
      this.state.statusMessage = `Waiting for players… (${connected}/${this.state.players.length})`;
    }
  }

  onLeave(client: Client) {
    const player = this.state.players.find((p) => p.sessionId === client.sessionId);
    if (!player) return;
    player.connected = false;
    delete this.sessionUserIds[client.sessionId];
    if (!this.state.gameOver) {
      // Scaffold-level handling: pause the clock and wait. Reconnection and
      // "what happens if someone never comes back" are follow-up work, not
      // solved by this pass.
      this.clearTimers();
      this.state.statusMessage = `${player.name} disconnected — waiting…`;
    }
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
    if (!this.state.players.every((p) => p.connected)) return;
    if (playerIdx !== this.state.currentPlayerIdx) return;
    if (this.state.awaitingMove) return;

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
      this.passTurn();
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
      this.passTurn();
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

    if (token.state === 'yard') {
      token.state = 'active';
      token.pos = 0;
      this.state.statusMessage = `${player.name} brought a token out.`;
    } else {
      token.pos += roll;
      if (token.pos === FINISHED_POS) {
        token.state = 'finished';
        player.homeCount++;
        this.state.statusMessage = `${player.name}'s token reached home!`;
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
            this.state.statusMessage = `${player.name} captured ${opp.name}'s token!`;
          }
        });
      }
    }

    if (player.homeCount === 4) {
      this.state.gameOver = true;
      this.state.winnerColor = player.color;
      this.state.statusMessage = `${player.name} wins!`;
      this.clearTimers();
      this.persistResult(playerIdx).catch((err) => console.error('[ludo] persistResult failed:', err));
      return;
    }

    const extraTurn = roll === 6 || capturedSomething || token.state === 'finished';
    if (extraTurn) {
      this.armRollTimer(playerIdx);
    } else {
      this.passTurn();
    }
  }

  private passTurn() {
    this.state.consecutiveSixes = 0;
    this.state.awaitingMove = false;
    this.state.players.forEach((p) => p.tokens.forEach((t) => (t.movable = false)));
    this.state.currentPlayerIdx = (this.state.currentPlayerIdx + 1) % this.state.players.length;
    const next = this.currentPlayer();
    this.state.statusMessage = `${next.name}'s turn.`;
    this.armRollTimer(this.state.currentPlayerIdx);
  }

  // --- Timers (auto-roll / auto-pick if a player leaves the game idle) ---

  private armRollTimer(playerIdx: number) {
    this.rollTimer?.clear();
    this.rollTimer = this.clock.setTimeout(() => {
      if (this.state.gameOver) return;
      if (this.state.currentPlayerIdx !== playerIdx) return;
      if (this.state.awaitingMove) return;
      this.resolveRoll(playerIdx);
    }, this.rollTimeoutMs);
  }

  private armSelectTimer(playerIdx: number, options: number[]) {
    this.selectTimer?.clear();
    this.selectTimer = this.clock.setTimeout(() => {
      if (this.state.gameOver) return;
      if (!this.state.awaitingMove) return;
      this.autoPickToken(playerIdx, options);
    }, this.selectTimeoutMs);
  }

  private clearTimers() {
    this.rollTimer?.clear();
    this.selectTimer?.clear();
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
      // TODO: replace with an atomic Postgres RPC (increment balance in one
      // statement) before this runs concurrently for real — a plain
      // read-then-write has a race condition under load.
      for (let i = 0; i < players.length; i++) {
        const uid = userIds[i];
        const delta = i === winnerIdx ? payout - this.state.stake : -this.state.stake;
        const { data: wallet } = await supabase.from('wallets').select('balance').eq('user_id', uid).single();
        const newBalance = Number(wallet?.balance ?? 240) + delta;
        await supabase.from('wallets').update({ balance: newBalance, updated_at: new Date().toISOString() }).eq('user_id', uid);
      }
    }
  }
}
