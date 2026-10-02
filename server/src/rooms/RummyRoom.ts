import { Room, Client, ServerError } from 'colyseus';
import { ArraySchema } from '@colyseus/schema';
import { RummyState, RummyPlayerState, CardState } from './schema/RummyState';
import * as Engine from '../rummy/engine';
import { getSupabase, authorizeJoin, holdFunds, releaseFunds, settleWallet, getPlatformSettings, Hold } from '../supabase';
import { newRoomCode } from '../roomCode';

interface JoinOptions {
  name?: string;
  userId?: string;
  accessToken?: string; // verified server-side; every Rummy table here is real-money, so Pro is required.
}

interface CreateOptions {
  // true = private table joined by code only (see onCreate).
  private?: boolean;
  // true = free table: real players but no money (see RummyState.free).
  free?: boolean;
  mode?: 'points' | 'pool';
  playerCount?: number;
  pointValue?: number;
  poolLimit?: number;
  entryFee?: number;
  // Overridable so tests don't have to wait out real timers.
  drawTimeoutMs?: number;
  discardTimeoutMs?: number;
  handEndDelayMs?: number;
  reconnectGraceSeconds?: number;
}

// 10% platform fee on money actually changing hands, matching Ludo's cash
// tables exactly (LudoRoom.persistResult) — kept as one constant so both
// modes' payout math stays consistent and easy to retune together.
const PLATFORM_FEE_RATE = 0.1;

function cardToState(card: Engine.Card): CardState {
  const c = new CardState();
  c.id = card.id;
  c.rank = card.rank;
  c.suit = card.suit ?? '';
  return c;
}

export class RummyRoom extends Room<RummyState> {
  maxClients = 4;

  private mode: 'points' | 'pool' = 'points';
  private drawTimeoutMs = 20000;
  private discardTimeoutMs = 20000;
  private handEndDelayMs = 3000;
  private reconnectGraceSeconds = 60;

  private drawTimer: any = null;
  private discardTimer: any = null;
  private handEndTimer: any = null;

  // Real per-player hands are deliberately never part of the synced
  // RummyState schema — every client's own WebSocket already sees the
  // whole schema, so a hand living there would leak straight to every
  // opponent. Kept here as private server state and delivered per-player
  // through a private 'hand' message instead (see sendHandTo).
  private hands: Engine.Card[][] = [];
  private deck: Engine.DeckState = { closedDeck: [], discardPile: [] };
  // Supabase auth user id per session, only populated for clients that pass
  // one at join time. Not part of the synced schema (opponents don't need it).
  private sessionUserIds: Record<string, string> = {};
  private isFree = false;
  private feeRate: number | null = null;   // admin-editable; fixed when the table is first joined
  private startedAt = 0;
  private endReason = 'declare';
  // Reserved worst-case loss per session (see holdFunds in supabase.ts).
  private holds: Record<string, Hold> = {};

  onCreate(options: CreateOptions) {
    this.mode = options.mode === 'pool' ? 'pool' : 'points';
    const playerCount = [2, 4].includes(options.playerCount!) ? options.playerCount! : 4;
    this.maxClients = playerCount;
    // Private table (created via the lobby's "Create Room"): a short shareable
    // code as the roomId, and hidden from automatic matchmaking so joinOrCreate
    // never drops strangers into it — friends join it by code (joinById) only.
    if (options.private) {
      this.roomId = newRoomCode();
      this.setPrivate(true);
    }

    this.drawTimeoutMs = options.drawTimeoutMs ?? 20000;
    this.discardTimeoutMs = options.discardTimeoutMs ?? 20000;
    this.handEndDelayMs = options.handEndDelayMs ?? 3000;
    this.reconnectGraceSeconds = options.reconnectGraceSeconds ?? 60;

    const state = new RummyState();
    state.mode = this.mode;
    state.playerCount = playerCount;
    this.isFree = !!options.free;
    state.free = this.isFree;
    // Unused-for-this-mode fields stay at a consistent default (0) so two
    // tables of the same mode+relevant-stake always share metadata shape —
    // filterBy(['mode','playerCount','pointValue','poolLimit','entryFee'])
    // in index.ts would otherwise never match two Points tables against
    // each other just because one had a stray non-zero poolLimit/entryFee.
    state.pointValue = this.mode === 'points' ? options.pointValue ?? 1 : 0;
    state.poolLimit = this.mode === 'pool' ? options.poolLimit ?? 101 : 0;
    state.entryFee = this.mode === 'pool' ? options.entryFee ?? 100 : 0;

    for (let i = 0; i < playerCount; i++) {
      state.players.push(new RummyPlayerState());
      this.hands.push([]);
    }
    this.setState(state);
    this.setMetadata({
      mode: state.mode,
      playerCount,
      pointValue: state.pointValue,
      poolLimit: state.poolLimit,
      entryFee: state.entryFee,
      free: this.isFree,
    });

    // Waiting room -> board handoff: the old page's socket close can take ~10s to
    // reach us through Render's proxy (we'd only notice via ping timeout), and
    // until onLeave runs there is no reconnection window for the board to
    // resume into. So the client asks us to drop that connection ourselves —
    // terminate() closes the socket server-side at once, which runs the normal
    // unconsented onLeave -> allowReconnection path immediately.
    this.onMessage('handoff', (client) => (client as any).ref?.terminate?.());
    this.onMessage('draw', (client, message) => this.handleDraw(client, message));
    this.onMessage('discard', (client, message) => this.handleDiscard(client, message));
    this.onMessage('declare', (client, message) => this.handleDeclare(client, message));
  }

  async onJoin(client: Client, options: JoinOptions = {}) {
    // Same real-money ban check as LudoRoom.onJoin, checked before reserving
    // a slot so a banned user can never occupy a seat even briefly.
    const settings = await getPlatformSettings();
    if (this.feeRate === null) this.feeRate = settings.feeRate;
    if (settings.maintenance) throw new ServerError(4503, 'maintenance');
    if (!this.isFree && !settings.cashTables) throw new ServerError(4504, 'cash_tables_off');
    const check = await authorizeJoin(options, !this.isFree);
    if (!check.ok) {
      if (check.reason === 'banned') {
        client.leave();
        return;
      }
      // Distinct, non-retryable rejection the client turns into a message —
      // cash tables need a verified Pro member (see authorizeJoin).
      throw new ServerError(check.reason === 'pro_required' ? 4403 : 4401, check.reason);
    }
    const verifiedUserId = check.userId;

    // Reserve the worst-case loss BEFORE touching any seat state (the await
    // would otherwise let two joins pick the same free slot): the entry fee for
    // Pool, 80 points x the point value for Points.
    let reservedHere = false;
    if (verifiedUserId) {
      const amount = this.holdAmount();
      if (amount > 0) {
        if (!(await holdFunds(verifiedUserId, amount))) {
          throw new ServerError(4402, 'insufficient_funds');
        }
        this.holds[client.sessionId] = { userId: verifiedUserId, amount };
        reservedHere = true;
      }
    }

    const slot = this.state.players.find((p) => !p.connected);
    if (!slot) {
      if (reservedHere) await this.releaseHold(client.sessionId);
      client.leave();
      return;
    }
    const seatIdx = this.state.players.indexOf(slot);
    slot.sessionId = client.sessionId;
    slot.name = (options.name || `Player ${seatIdx + 1}`).slice(0, 24);
    slot.connected = true;
    if (verifiedUserId) this.sessionUserIds[client.sessionId] = verifiedUserId;

    if (this.state.players.every((p) => p.connected)) {
      this.state.started = true;
      this.startedAt = Date.now();
      this.startNewHand();
    } else {
      const connected = this.state.players.filter((p) => p.connected).length;
      this.state.statusMessage = `Waiting for players… (${connected}/${this.state.players.length})`;
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.find((p) => p.sessionId === client.sessionId);
    if (!player) return;
    const seatIdx = this.state.players.indexOf(player);

    player.connected = false;
    if (this.state.matchOver) return;

    if (!this.state.started) {
      const connected = this.state.players.filter((p) => p.connected).length;
      this.state.statusMessage = `Waiting for players… (${connected}/${this.state.players.length})`;
      // Seat is empty again, so its reserved stake goes back to the player.
      await this.releaseHold(client.sessionId);
      return;
    }

    if (consented) {
      this.state.statusMessage = `${player.name} left the game.`;
      this.checkForfeit('forfeit');
      return;
    }

    this.state.statusMessage = `${player.name} disconnected — reconnecting…`;
    try {
      await this.allowReconnection(client, this.reconnectGraceSeconds);
    } catch {
      this.state.statusMessage = `${player.name} disconnected and never reconnected.`;
      this.checkForfeit('timeout');
      return;
    }

    player.connected = true;
    this.state.statusMessage = `${player.name} reconnected.`;
    this.sendHandTo(seatIdx);
    if (this.state.currentPlayerIdx !== seatIdx) return;
    if (this.state.phase === 'draw') this.armDrawTimer(seatIdx);
    else if (this.state.phase === 'discard') this.armDiscardTimer(seatIdx);
  }

  /** Mirrors LudoRoom.checkForfeitWin's philosophy (2+ connected keeps
   *  playing unaffected — the existing timers already auto-act through a
   *  disconnected player's turn), but a card game can't just let the game
   *  "continue" once only one player is left: nobody else can take the
   *  actions needed to finish the hand fairly. So the sole survivor is
   *  awarded the current hand outright (and, in Pool mode, the whole
   *  match — every other seat is force-eliminated), with everyone who
   *  isn't the survivor scored at the flat max penalty for this hand as
   *  a forfeit penalty, same as a real declare-invalid. */
  private checkForfeit(kind: 'forfeit' | 'timeout') {
    if (this.state.matchOver) return;
    this.endReason = kind;
    const stillConnected = this.state.players.filter((p) => p.connected);
    if (stillConnected.length !== 1) return;
    const winnerIdx = this.state.players.indexOf(stillConnected[0]!);

    this.clearTimers();
    const points = this.state.players.map((_, i) => (i === winnerIdx ? 0 : Engine.MAX_PENALTY));
    // Record the result the same way a normal finishHand does — the client's
    // result popup reads these (a forfeit used to leave winnerIdx at -1 and crash it).
    this.state.lastHandWinnerIdx = winnerIdx;
    this.state.lastHandPoints = new ArraySchema<number>();
    points.forEach((p) => this.state.lastHandPoints.push(p));
    this.state.phase = 'hand-over';

    if (this.mode === 'points') {
      this.finishHandPoints(points, winnerIdx);
      return;
    }

    // Pool: force-eliminate every other still-active seat immediately so
    // isPoolOver reads true and the survivor takes the whole pot, same as
    // reaching the cap naturally.
    this.state.players.forEach((p, i) => {
      if (i === winnerIdx) return;
      p.cumulative = Math.max(p.cumulative, this.state.poolLimit);
      p.eliminated = true;
    });
    this.finishHandPool(points, winnerIdx, true);
  }

  // --- Hand lifecycle -----------------------------------------------------

  private startNewHand() {
    const playerCount = this.state.players.length;
    const deal = Engine.dealNewRound(playerCount);

    this.hands = deal.hands;
    this.deck = { closedDeck: deal.closedDeck, discardPile: deal.discardPile };

    this.state.handNumber++;
    this.state.wildRank = deal.wildRank;
    this.syncDeckCounts();
    this.state.lastHandWinnerIdx = -1;
    this.state.lastHandInvalidDeclareBy = -1;
    this.state.lastHandPoints = new ArraySchema<number>();

    this.state.players.forEach((p, i) => {
      p.handCount = this.hands[i]!.length;
    });

    const startIdx =
      this.mode === 'pool'
        ? Engine.firstActiveFrom((this.state.currentPlayerIdx + 1) % playerCount, playerCount, this.poolPlayersFromState())
        : 0;
    this.state.currentPlayerIdx = startIdx;
    this.state.phase = 'draw';
    const starter = this.state.players[startIdx]!;
    this.state.statusMessage = `${starter.name}'s turn — draw a card.`;

    this.state.players.forEach((_, i) => this.sendHandTo(i));
    this.armDrawTimer(startIdx);
  }

  private sendHandTo(seatIdx: number) {
    const player = this.state.players[seatIdx];
    if (!player || !player.connected) return;
    const client = this.clients.find((c) => c.sessionId === player.sessionId);
    if (!client) return;
    client.send('hand', { cards: this.hands[seatIdx] ?? [] });
  }

  private syncDeckCounts() {
    this.state.closedDeckCount = this.deck.closedDeck.length;
    this.state.discardPileCount = this.deck.discardPile.length;
    const top = this.deck.discardPile[this.deck.discardPile.length - 1];
    this.state.discardTop = top ? cardToState(top) : new CardState();
  }

  private handleDraw(client: Client, message: { source?: 'closed' | 'discard' }) {
    const playerIdx = this.state.players.findIndex((p) => p.sessionId === client.sessionId);
    if (playerIdx === -1 || this.state.matchOver) return;
    if (playerIdx !== this.state.currentPlayerIdx || this.state.phase !== 'draw') return;
    this.applyDraw(playerIdx, message.source === 'discard' ? 'discard' : 'closed');
  }

  private applyDraw(playerIdx: number, source: 'closed' | 'discard') {
    Engine.ensureClosedDeckNotEmpty(this.deck);
    let card: Engine.Card | undefined;
    if (source === 'discard' && this.deck.discardPile.length > 0) {
      card = this.deck.discardPile.pop();
    } else if (this.deck.closedDeck.length > 0) {
      card = this.deck.closedDeck.pop();
    }
    // Both piles empty is impossible mid-game (see ensureClosedDeckNotEmpty's
    // invariant note in the client engine this was ported from) — this guard
    // exists only so a freak edge case no-ops instead of crashing the room.
    if (!card) return;

    this.hands[playerIdx]!.push(card);
    const player = this.state.players[playerIdx]!;
    player.handCount = this.hands[playerIdx]!.length;
    this.syncDeckCounts();

    this.drawTimer?.clear();
    this.state.phase = 'discard';
    this.state.statusMessage = `${player.name} drew a card — choose to discard or declare.`;
    this.sendHandTo(playerIdx);
    this.armDiscardTimer(playerIdx);
  }

  private handleDiscard(client: Client, message: { cardId?: string }) {
    const playerIdx = this.state.players.findIndex((p) => p.sessionId === client.sessionId);
    if (playerIdx === -1 || this.state.matchOver) return;
    if (playerIdx !== this.state.currentPlayerIdx || this.state.phase !== 'discard') return;
    if (typeof message.cardId !== 'string') return;
    this.applyDiscard(playerIdx, message.cardId);
  }

  private applyDiscard(playerIdx: number, cardId: string) {
    const hand = this.hands[playerIdx]!;
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return;
    const [card] = hand.splice(idx, 1);
    this.deck.discardPile.push(card!);

    const player = this.state.players[playerIdx]!;
    player.handCount = hand.length;
    this.syncDeckCounts();
    this.discardTimer?.clear();
    this.sendHandTo(playerIdx);

    const nextIdx = Engine.firstActiveFrom((playerIdx + 1) % this.state.players.length, this.state.players.length, this.poolPlayersFromState());
    this.state.currentPlayerIdx = nextIdx;
    this.state.phase = 'draw';
    this.state.statusMessage = `${this.state.players[nextIdx]!.name}'s turn — draw a card.`;
    this.armDrawTimer(nextIdx);
  }

  private handleDeclare(client: Client, message: { cardId?: string }) {
    const playerIdx = this.state.players.findIndex((p) => p.sessionId === client.sessionId);
    if (playerIdx === -1 || this.state.matchOver) return;
    if (playerIdx !== this.state.currentPlayerIdx || this.state.phase !== 'discard') return;
    if (typeof message.cardId !== 'string') return;

    const hand = this.hands[playerIdx]!;
    const idx = hand.findIndex((c) => c.id === message.cardId);
    if (idx === -1) return;
    const [setAside] = hand.splice(idx, 1);
    const hand13 = hand; // remaining 13 cards, still this.hands[playerIdx] by reference

    this.discardTimer?.clear();
    // The set-aside card goes to the discard pile either way, same as a
    // normal discard — opponents seeing what a declare attempt gave up is
    // part of a real table, valid or not.
    this.deck.discardPile.push(setAside!);
    this.syncDeckCounts();

    if (Engine.isValidDeclare(hand13, this.state.wildRank)) {
      this.finishHand({ winnerIdx: playerIdx });
    } else {
      this.finishHand({ invalidDeclareBy: playerIdx });
    }
  }

  private finishHand(result: { winnerIdx?: number; invalidDeclareBy?: number }) {
    this.clearTimers();
    const playerCount = this.state.players.length;
    const points: number[] = new Array(playerCount).fill(0);

    if (result.invalidDeclareBy !== undefined) {
      points[result.invalidDeclareBy] = Engine.MAX_PENALTY;
      this.endReason = 'invalid_declare';
      this.state.lastHandInvalidDeclareBy = result.invalidDeclareBy;
      const who = this.state.players[result.invalidDeclareBy]!.name;
      this.state.statusMessage = `${who} declared invalidly and takes the ${Engine.MAX_PENALTY}-point penalty.`;
    } else {
      const winnerIdx = result.winnerIdx!;
      for (let i = 0; i < playerCount; i++) {
        if (i === winnerIdx) continue;
        points[i] = Engine.computeBestGrouping(this.hands[i]!, this.state.wildRank).deadwood;
      }
      this.state.lastHandWinnerIdx = winnerIdx;
      const who = this.state.players[winnerIdx]!.name;
      this.state.statusMessage = `${who} declares and wins this hand.`;
    }

    this.state.lastHandPoints = new ArraySchema<number>();
    points.forEach((p) => this.state.lastHandPoints.push(p));
    this.state.phase = 'hand-over';

    // An invalid declare has no winnerIdx at all — the declarer just eats
    // the flat penalty and everyone else scores 0, so there's no single
    // "winner" to pay in Points mode. Both finishHandPoints/finishHandPool
    // handle that shape via `points` and an optional/undefined winnerIdx
    // rather than needing one unconditionally.
    if (this.mode === 'points') {
      this.finishHandPoints(points, result.winnerIdx);
    } else {
      this.finishHandPool(points, result.winnerIdx, false);
    }
  }

  /** Points mode is always a single-hand match: whoever isn't the winner
   *  pays their points × the table's point value directly into the
   *  winner's payout, minus the same 10% platform fee every other real-
   *  money table in this app takes. An invalid declare has no `winnerIdx`
   *  at all — the declarer just eats the flat penalty, and this settles
   *  as an entirely separate case (nobody "wins" money; the platform takes
   *  no fee either, since nothing was actually contested). */
  private finishHandPoints(points: number[], winnerIdx: number | undefined) {
    this.state.matchOver = true;
    if (winnerIdx === undefined) {
      // Invalid declare: nobody else owes anything — the penalty is a
      // scoring concept (relevant if this table's players start another
      // Points hand from the lobby) with no money movement here at all.
      this.persistPointsMatch(points, null).catch((err) => console.error('[rummy] persistPointsMatch failed:', err));
      return;
    }
    this.persistPointsMatch(points, winnerIdx).catch((err) => console.error('[rummy] persistPointsMatch failed:', err));
  }

  /** Pool mode folds this hand's points into each player's running total,
   *  eliminating anyone who reaches/crosses the cap, then either deals the
   *  next hand (after a short pause so the result is readable) or, once
   *  exactly one player is left active, settles the whole match. */
  private finishHandPool(points: number[], _winnerIdx: number | undefined, alreadyForfeited: boolean) {
    if (!alreadyForfeited) {
      const before = this.poolPlayersFromState();
      const eliminatedBefore = before.map((p) => p.eliminated);
      const handPoints = points.map((pts, i) => (eliminatedBefore[i] ? 0 : pts));
      const after = Engine.applyPoolHandResult(before, handPoints, this.state.poolLimit);
      after.forEach((p, i) => {
        this.state.players[i]!.cumulative = p.cumulative;
        this.state.players[i]!.eliminated = p.eliminated;
      });
    }

    if (Engine.isPoolOver(this.poolPlayersFromState())) {
      this.state.matchOver = true;
      const survivor = Engine.activePoolPlayers(this.poolPlayersFromState())[0]!;
      this.persistPoolMatch(survivor.idx).catch((err) => console.error('[rummy] persistPoolMatch failed:', err));
      return;
    }

    this.handEndTimer?.clear();
    this.handEndTimer = this.clock.setTimeout(() => {
      this.handEndTimer = null;
      if (this.state.matchOver) return;
      this.startNewHand();
    }, this.handEndDelayMs);
  }

  private poolPlayersFromState(): Engine.PoolPlayer[] {
    return this.state.players.map((p, i) => ({ idx: i, name: p.name, cumulative: p.cumulative, eliminated: p.eliminated }));
  }

  // --- Timers (auto-draw / auto-discard if a player leaves the table idle) --

  private armDrawTimer(playerIdx: number) {
    this.drawTimer?.clear();
    this.startTurnCountdown(this.drawTimeoutMs);
    this.drawTimer = this.clock.setTimeout(() => {
      if (this.state.matchOver) return;
      if (this.state.currentPlayerIdx !== playerIdx || this.state.phase !== 'draw') return;
      this.applyDraw(playerIdx, 'closed');
    }, this.drawTimeoutMs);
  }

  private armDiscardTimer(playerIdx: number) {
    this.discardTimer?.clear();
    this.startTurnCountdown(this.discardTimeoutMs);
    this.discardTimer = this.clock.setTimeout(() => {
      if (this.state.matchOver) return;
      if (this.state.currentPlayerIdx !== playerIdx || this.state.phase !== 'discard') return;
      // Simplest always-legal auto-action: discard whatever was just drawn
      // (the last card in hand), rather than trying to pick a "smart"
      // discard server-side — this only fires when a player has gone idle,
      // so keeping the table moving matters far more than optimizing their
      // discard for them.
      const hand = this.hands[playerIdx]!;
      const lastCard = hand[hand.length - 1];
      if (lastCard) this.applyDiscard(playerIdx, lastCard.id);
    }, this.discardTimeoutMs);
  }

  private startTurnCountdown(timeoutMs: number) {
    this.state.turnSeq++;
    this.state.turnTimeoutMs = timeoutMs;
  }

  private clearTimers() {
    this.drawTimer?.clear();
    this.discardTimer?.clear();
    this.handEndTimer?.clear();
  }

  // --- Persistence ------------------------------------------------------

  /** Worst-case loss for this table: Pool = entry fee; Points = 80 points x value. */
  private holdAmount(): number {
    if (this.isFree) return 0; // free tables never reserve or move money
    return this.state.mode === 'pool' ? this.state.entryFee : this.state.pointValue * Engine.MAX_PENALTY;
  }

  private async releaseHold(sessionId: string) {
    const hold = this.holds[sessionId];
    if (!hold) return;
    delete this.holds[sessionId];
    await releaseFunds(hold.userId, hold.amount);
  }

  /** Anything still reserved when the room goes away (match never settled) is refunded. */
  async onDispose() {
    await Promise.all(Object.keys(this.holds).map((sid) => this.releaseHold(sid)));
  }

  /** Apply one seat's result and release its reservation in a single statement. */
  private async settleSeat(i: number, userId: string, delta: number, matchId: string) {
    const sid = this.state.players[i]!.sessionId;
    const reserved = this.holds[sid]?.amount ?? 0;
    delete this.holds[sid];
    await settleWallet(userId, delta, reserved, 'match_result', 'rummy_match', matchId);
  }

  /** winnerIdx === null means an invalid declare with no money to move —
   *  still recorded as a finished match (for history), just with a null
   *  winner and every player's own `payout` at 0. */
  private async persistPointsMatch(points: number[], winnerIdx: number | null) {
    if (this.isFree) return; // no money, no wallet settlement
    const supabase = getSupabase();
    if (!supabase) return;

    const players = this.state.players;
    const userIds = players.map((p) => this.sessionUserIds[p.sessionId]);
    if (userIds.some((id) => !id)) {
      console.warn('[rummy] skipping points-match persistence: not every player had an auth userId');
      return;
    }

    const pointValue = this.state.pointValue;
    let payouts: number[];
    if (winnerIdx === null) {
      payouts = points.map(() => 0);
    } else {
      const totalOwed = points.reduce((s, pts, i) => (i === winnerIdx ? s : s + pts * pointValue), 0);
      const fee = Math.round(totalOwed * (this.feeRate ?? PLATFORM_FEE_RATE));
      const winnerPayout = totalOwed - fee;
      payouts = points.map((pts, i) => (i === winnerIdx ? winnerPayout : -(pts * pointValue)));
    }

    const { data: match, error: matchErr } = await supabase
      .from('rummy_matches')
      .insert({
        mode: 'points',
        player_count: players.length,
        point_value: pointValue,
        status: 'finished',
        winner_id: winnerIdx === null ? null : userIds[winnerIdx],
        finished_at: new Date().toISOString(),
        end_reason: this.endReason,
        duration_s: this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : null,
        fee_amount: winnerIdx === null ? 0 : Math.round(payouts.filter((_, k) => k !== winnerIdx).reduce((s, v) => s + -v, 0) * (this.feeRate ?? PLATFORM_FEE_RATE)),
      })
      .select('id')
      .single();
    if (matchErr || !match) {
      console.error('[rummy] failed to insert rummy_matches row:', matchErr);
      return;
    }

    const rows = players.map((p, i) => ({
      match_id: match.id,
      user_id: userIds[i],
      seat_idx: i,
      result: winnerIdx === null ? 'lose' : i === winnerIdx ? 'win' : 'lose',
      points: points[i],
      payout: payouts[i],
    }));
    const { error: playersErr } = await supabase.from('rummy_match_players').insert(rows);
    if (playersErr) console.error('[rummy] failed to insert rummy_match_players rows:', playersErr);

    for (let i = 0; i < players.length; i++) {
      // Even a 0 payout still has to release the seat's reservation.
      await this.settleSeat(i, userIds[i]!, payouts[i]!, match.id);
    }
  }

  private async persistPoolMatch(survivorIdx: number) {
    if (this.isFree) return; // no money, no wallet settlement
    const supabase = getSupabase();
    if (!supabase) return;

    const players = this.state.players;
    const userIds = players.map((p) => this.sessionUserIds[p.sessionId]);
    if (userIds.some((id) => !id)) {
      console.warn('[rummy] skipping pool-match persistence: not every player had an auth userId');
      return;
    }

    const entryFee = this.state.entryFee;
    const pot = entryFee * players.length;
    const fee = Math.round(pot * (this.feeRate ?? PLATFORM_FEE_RATE));
    const payout = pot - fee;
    // No upfront debit ever happened (see the module-level note on
    // settlement timing) — the whole match settles in one deferred delta
    // per player here, same as LudoRoom.persistResult: survivor nets
    // payout-minus-their-own-entry, everyone else nets -entryFee.
    const payouts = players.map((_, i) => (i === survivorIdx ? payout - entryFee : -entryFee));

    const { data: match, error: matchErr } = await supabase
      .from('rummy_matches')
      .insert({
        mode: 'pool',
        player_count: players.length,
        pool_limit: this.state.poolLimit,
        entry_fee: entryFee,
        status: 'finished',
        winner_id: userIds[survivorIdx],
        finished_at: new Date().toISOString(),
        end_reason: this.endReason,
        duration_s: this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : null,
        fee_amount: fee,
      })
      .select('id')
      .single();
    if (matchErr || !match) {
      console.error('[rummy] failed to insert rummy_matches row:', matchErr);
      return;
    }

    const rows = players.map((p, i) => ({
      match_id: match.id,
      user_id: userIds[i],
      seat_idx: i,
      result: i === survivorIdx ? 'win' : 'lose',
      points: p.cumulative,
      payout: payouts[i],
    }));
    const { error: playersErr } = await supabase.from('rummy_match_players').insert(rows);
    if (playersErr) console.error('[rummy] failed to insert rummy_match_players rows:', playersErr);

    for (let i = 0; i < players.length; i++) {
      await this.settleSeat(i, userIds[i]!, payouts[i]!, match.id);
    }
  }
}
