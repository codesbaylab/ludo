// Computer opponent's move choice for LudoRoom's "vs Computer" tables. Pure
// (plain data in, token index out) so it's trivially testable. It only ever
// picks among the legal options the rules already produced.
import { Color, FINISHED_POS, absoluteRingIndex, isSafeAbsoluteIndex, RING_LENGTH } from './rules';

export interface BotToken { state: 'yard' | 'active' | 'finished'; pos: number }
export interface BotSeat { color: Color; tokens: BotToken[] }

export const BOT_NAMES = ['Bot Ravi', 'Bot Jilna', 'Bot Sana'];

/** Is an opposing active token 1-6 squares behind this absolute ring cell? */
function threatened(seats: BotSeat[], me: number, absIdx: number): boolean {
  return seats.some(
    (opp, oi) =>
      oi !== me &&
      opp.tokens.some((t) => {
        if (t.state !== 'active' || t.pos > 50) return false;
        const d = (absIdx - absoluteRingIndex(opp.color, t.pos) + RING_LENGTH) % RING_LENGTH;
        return d >= 1 && d <= 6;
      })
  );
}

export function chooseBotToken(seats: BotSeat[], me: number, roll: number, options: number[]): number {
  const color = seats[me]!.color;
  let best = options[0]!;
  let bestScore = -Infinity;
  for (const i of options) {
    const t = seats[me]!.tokens[i]!;
    const from = t.state === 'yard' ? -1 : t.pos;
    const to = t.state === 'yard' ? 0 : t.pos + roll;
    let score = to; // default: push the furthest-along token
    const toAbs = to <= 50 ? absoluteRingIndex(color, to) : -1;
    const fromAbs = from >= 0 && from <= 50 ? absoluteRingIndex(color, from) : -1;

    if (to === FINISHED_POS) score += 800;
    if (t.state === 'yard') score += 500;
    if (toAbs >= 0 && !isSafeAbsoluteIndex(toAbs)) {
      const lone = seats.some(
        (opp, oi) =>
          oi !== me &&
          opp.tokens.filter((x) => x.state === 'active' && x.pos <= 50 && absoluteRingIndex(opp.color, x.pos) === toAbs).length === 1
      );
      if (lone) score += 1000;
    }
    const safeAfter = to > 50 || (toAbs >= 0 && isSafeAbsoluteIndex(toAbs));
    if (safeAfter) score += 150;
    else if (threatened(seats, me, toAbs)) score -= 150;
    if (fromAbs >= 0 && !isSafeAbsoluteIndex(fromAbs) && threatened(seats, me, fromAbs)) score += 120; // run away
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}
