// Pure Ludo rules/path-math, ported from design/game.js. No rendering, no
// grid coordinates — the server only needs to know whether two tokens
// occupy the same *abstract* ring square, not where that square is drawn.
//
// design/game.js's RING array (52 board cells) + each color's entryIndex
// into it are what a client uses to turn an abstract position into (row,col)
// for drawing. The server never draws anything, so all it needs is each
// color's entryIndex (to translate a color-relative position into an
// absolute ring index 0-51) and which absolute ring indices are "safe"
// (entry + star squares) — verified against design/game.js's RING/COLORS/
// entryCells/starCells during that session's simulation check.

export const RING_LENGTH = 52;
export const HOME_COLUMN_LENGTH = 5;
// A token only travels 51 of the ring's 52 cells (pos 0-50) before peeling off
// into its own home column (pos 51-55), then one more step lands it home
// (pos 56) — matching design/game.js's coordFor exactly. RING_LENGTH itself
// stays 52 (it's also used for absoluteRingIndex's modulo, where the full
// physical cell count is correct), so this deliberately doesn't reuse it
// directly: RING_LENGTH + HOME_COLUMN_LENGTH would be 57, one past where the
// client's coordFor actually has a coordinate for — that mismatch was a real
// bug (caught from an actual played game): the server let a token sit at
// pos 56 as still "active", but the client's coordFor has no coordinate for
// 56 at all (it's the client's own finished state), crashing renderTokens's
// destructure and freezing rendering for the rest of that game.
export const FINISHED_POS = RING_LENGTH - 1 + HOME_COLUMN_LENGTH; // 56

// Turn order follows the ring direction (ascending entryIndex, wrapping).
export const TURN_ORDER: Color[] = ['green', 'yellow', 'blue', 'red'];

export type Color = 'red' | 'green' | 'yellow' | 'blue';

export const ENTRY_INDEX: Record<Color, number> = {
  red: 1,
  green: 14,
  yellow: 27,
  blue: 40,
};

// Entry squares (ENTRY_INDEX values) + star squares, as absolute ring
// indices. A token landing here can't be captured.
export const SAFE_RING_INDICES = new Set<number>([
  1, 14, 27, 40, // entry squares (red, green, yellow, blue)
  9, 22, 35, 48, // star squares (red, green, yellow, blue)
]);

export type TokenLike = { state: 'yard' | 'active' | 'finished'; pos: number };

export function absoluteRingIndex(color: Color, pos: number): number {
  return (ENTRY_INDEX[color] + pos) % RING_LENGTH;
}

export function isSafeAbsoluteIndex(absIndex: number): boolean {
  return SAFE_RING_INDICES.has(absIndex);
}

export function sameCell(a: { color: Color; pos: number }, b: { color: Color; pos: number }): boolean {
  if (a.pos > 50 || b.pos > 50) return false; // home column / finished are private, never shared
  return absoluteRingIndex(a.color, a.pos) === absoluteRingIndex(b.color, b.pos);
}

/**
 * Which of a player's 4 tokens can legally move on this roll. Yard tokens
 * are interchangeable (bringing any one out has the same effect), so at
 * most one shows up here — mirrors the client-side fix for the "glow
 * merges into a square" bug, and here it also keeps the server from
 * presenting a fake choice between identical options.
 */
export function movableTokenIndices(tokens: TokenLike[], roll: number): number[] {
  const result: number[] = [];
  let yardOptionAdded = false;
  tokens.forEach((t, i) => {
    if (t.state === 'finished') return;
    if (t.state === 'yard') {
      if (roll === 6 && !yardOptionAdded) { result.push(i); yardOptionAdded = true; }
      return;
    }
    if (t.pos + roll <= FINISHED_POS) result.push(i);
  });
  return result;
}
