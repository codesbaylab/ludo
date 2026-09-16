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
}
