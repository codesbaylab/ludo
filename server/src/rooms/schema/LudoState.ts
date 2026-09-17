import { Schema, ArraySchema, type } from '@colyseus/schema';

export class TokenState extends Schema {
  @type('string') state: 'yard' | 'active' | 'finished' = 'yard';
  @type('number') pos: number = -1;
  // Server-computed hint for the client: can this token be picked right now?
  @type('boolean') movable: boolean = false;
}

export class PlayerState extends Schema {
  @type('string') sessionId: string = '';
  @type('string') name: string = '';
  @type('string') color: string = '';
  @type('number') homeCount: number = 0;
  @type('boolean') connected: boolean = false;
  @type([TokenState]) tokens = new ArraySchema<TokenState>();
}

export class LudoState extends Schema {
  @type([PlayerState]) players = new ArraySchema<PlayerState>();
  @type('number') currentPlayerIdx: number = 0;
  @type('number') diceValue: number = 0;
  // Bumped on every real roll, independent of the face value. A die only
  // has 6 faces, so two consecutive rolls landing on the same number is a
  // 1-in-6 event every single turn — common enough that clients comparing
  // diceValue itself to detect "did a roll just happen" silently skipped
  // the whole reveal animation (and the move/turn-pass it gates) whenever
  // that happened, making the dice look frozen mid-game.
  @type('number') rollSeq: number = 0;
  @type('boolean') rolling: boolean = false;
  @type('boolean') awaitingMove: boolean = false;
  @type('number') consecutiveSixes: number = 0;
  @type('boolean') gameOver: boolean = false;
  @type('string') winnerColor: string = '';
  @type('number') stake: number = 0;
  @type('string') statusMessage: string = 'Waiting for players…';
  // False until every seat has connected at least once. Lets the client
  // distinguish "still filling the table" (block the board, show the
  // waiting message) from "someone left/dropped mid-game" (the game keeps
  // going for whoever's left — see LudoRoom's forfeit-win rules — so this
  // should just be a status notification, not a full-board block).
  @type('boolean') started: boolean = false;
  // True for a short window after a roll that ends the turn without a move
  // (no valid moves, or three 6s in a row) — long enough for clients to
  // actually see that roll's result before currentPlayerIdx advances. See
  // LudoRoom's turnPassDelayMs for why this exists.
  @type('boolean') turnPassPending: boolean = false;
  // Bumped every time a fresh roll/select countdown is armed server-side.
  // The client's cosmetic countdown keys off this rather than trying to
  // infer "a new turn window started" from currentPlayerIdx/awaitingMove —
  // an extra turn (rolling a 6) changes neither, so the countdown used to
  // silently not restart for it.
  @type('number') turnSeq: number = 0;
  // The real server-side timeout the countdown above is mirroring, so the
  // client can't drift out of sync with it by hardcoding its own guess.
  @type('number') turnTimeoutMs: number = 0;
}
