import { Schema, ArraySchema, type } from '@colyseus/schema';

// Card identity/rank/suit are safe to sync publicly ONLY for the discard
// pile's top card (any player can see it) and never for a hand — hands are
// deliberately kept out of this schema entirely and delivered per-player via
// a private 'hand' message instead (see RummyRoom). Suit uses '' rather than
// null for a JOKER, since Colyseus schema string fields can't hold null.
export class CardState extends Schema {
  @type('string') id: string = '';
  @type('string') rank: string = '';
  @type('string') suit: string = '';
}

export class RummyPlayerState extends Schema {
  @type('string') sessionId: string = '';
  @type('string') name: string = '';
  @type('boolean') connected: boolean = false;
  // Opponents' hand sizes are public (you can see how many cards someone is
  // holding at a real table) — the cards themselves are not.
  @type('number') handCount: number = 0;
  // Pool mode only; stays 0/false for the whole match in Points mode.
  @type('number') cumulative: number = 0;
  @type('boolean') eliminated: boolean = false;
}

export class RummyState extends Schema {
  @type('string') mode: 'points' | 'pool' = 'points';
  @type('number') playerCount: number = 4;
  // Points mode only.
  @type('number') pointValue: number = 1;
  // Pool mode only.
  @type('number') poolLimit: number = 101;
  @type('number') entryFee: number = 100;

  @type([RummyPlayerState]) players = new ArraySchema<RummyPlayerState>();

  // False until every seat has connected at least once — same meaning as
  // LudoState.started.
  @type('boolean') started: boolean = false;
  @type('number') currentPlayerIdx: number = 0;
  // 'draw': current player must draw (closed deck or discard pile).
  // 'discard': current player must discard or declare.
  // 'hand-over': a hand just ended, waiting for the next one (or the whole
  // table is over — see matchOver) — mirrors the client practice table's
  // 'round-over' phase name closely enough to reason about, renamed since
  // "round" was ambiguous between one hand and a whole Pool match.
  @type('string') phase: 'draw' | 'discard' | 'hand-over' = 'draw';
  @type('string') wildRank: string = '';
  @type(CardState) discardTop = new CardState();
  @type('number') closedDeckCount: number = 0;
  @type('number') discardPileCount: number = 0;
  @type('string') statusMessage: string = 'Waiting for players…';

  // True once the whole table is done — a finished Points hand (always, it's
  // a one-hand match) or a Pool match down to one survivor. No further
  // hands are dealt once this is true.
  @type('boolean') matchOver: boolean = false;
  @type('number') handNumber: number = 0;
  // Set once the most recent hand concludes, for the client's result modal.
  // -1 for "not applicable yet" / no invalid declare.
  @type('number') lastHandWinnerIdx: number = -1;
  @type('number') lastHandInvalidDeclareBy: number = -1;
  @type(['number']) lastHandPoints = new ArraySchema<number>();

  // Same countdown-sync pattern as LudoState: bumped every time a fresh
  // draw/discard window is armed, so the client's cosmetic countdown can key
  // off a real "a new window started" signal instead of trying to infer one.
  @type('number') turnSeq: number = 0;
  @type('number') turnTimeoutMs: number = 0;
}
