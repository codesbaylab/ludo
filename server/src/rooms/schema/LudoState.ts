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
}
