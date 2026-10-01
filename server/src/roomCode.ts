import { matchMaker } from 'colyseus';

// No 0/O/1/I/L — codes get read aloud and typed on phones.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Short, human-friendly code used as the roomId of private rooms ("ABC123"
 *  style, matching the join box's maxlength). Uniqueness is only checked
 *  against rooms on this process, which is all of them here (one process). */
export function newRoomCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!matchMaker.getRoomById(code)) return code;
  }
}
