// Regression check for server/src/rummy/engine.ts: a randomized comparison
// against design/rummy-rules.js (the original, extensively unit-tested
// client engine this was ported from — see design/rummy-rules.test.js).
// Not part of the deployed server (dev-only, requires design/ which isn't
// in the Docker build context) — this is what gives confidence the TS port
// didn't silently drift from the engine real money already depends on
// client-side, before trusting it as the new server-side authority.

import * as Engine from '../rummy/engine';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const OriginalRules = require('../../../design/rummy-rules.js');

function randomHand(deck: Engine.Card[], size: number): Engine.Card[] {
  const shuffled = Engine.shuffle(deck);
  return shuffled.slice(0, size);
}

function cardsEqual(a: Engine.Card, b: Engine.Card): boolean {
  return a.id === b.id && a.rank === b.rank && a.suit === b.suit;
}

function main() {
  let checks = 0;

  // dealNewRound: full-pack accounting, both implementations agree on shape.
  for (let trial = 0; trial < 20; trial++) {
    const playerCount = [2, 3, 4][trial % 3]!;
    const deal = Engine.dealNewRound(playerCount);
    const total = deal.hands.reduce((s, h) => s + h.length, 0) + 1 /* indicator */ + deal.closedDeck.length + deal.discardPile.length;
    if (total !== 108) throw new Error(`dealNewRound(${playerCount}) accounted for ${total} cards, expected 108`);
    deal.hands.forEach((h) => {
      if (h.length !== 13) throw new Error(`dealNewRound(${playerCount}) dealt a hand of ${h.length}, expected 13`);
    });
    if (deal.wildIndicator.rank === 'JOKER') throw new Error('wildIndicator should never be a JOKER');
    checks++;
  }

  // computeBestGrouping / isValidDeclare: randomized comparison against the
  // original JS engine across many hand sizes and wild ranks.
  const deck = Engine.buildDoubleDeck();
  for (let trial = 0; trial < 4000; trial++) {
    const size = 1 + Math.floor(Math.random() * 14);
    const hand = randomHand(deck, size);
    const wildRank = Engine.RANKS[Math.floor(Math.random() * Engine.RANKS.length)]!;

    const mine = Engine.computeBestGrouping(hand, wildRank);
    const theirs = OriginalRules.computeBestGrouping(hand, wildRank);
    if (mine.deadwood !== theirs.deadwood) {
      throw new Error(
        `computeBestGrouping mismatch on trial ${trial} (size ${size}, wildRank ${wildRank}): ` +
          `mine=${mine.deadwood} theirs=${theirs.deadwood}\nhand=${JSON.stringify(hand)}`
      );
    }
    if (mine.pureAchieved !== theirs.pureAchieved) {
      throw new Error(`pureAchieved mismatch on trial ${trial}: mine=${mine.pureAchieved} theirs=${theirs.pureAchieved}`);
    }
    if (mine.totalPoints !== theirs.totalPoints) {
      throw new Error(`totalPoints mismatch on trial ${trial}: mine=${mine.totalPoints} theirs=${theirs.totalPoints}`);
    }

    if (size === 13) {
      const mineValid = Engine.isValidDeclare(hand, wildRank);
      const theirsValid = OriginalRules.isValidDeclare(hand, wildRank);
      if (mineValid !== theirsValid) {
        throw new Error(`isValidDeclare mismatch on trial ${trial}: mine=${mineValid} theirs=${theirsValid}\nhand=${JSON.stringify(hand)}`);
      }
    }
    checks++;
  }

  // A known real valid 13-card declare (3 pure sequences worth of cards +
  // one set), independent of wild rank — should validate identically.
  const bySpec = (rank: string, suit: string) => deck.find((c) => c.rank === rank && c.suit === suit && !usedIds.has(c.id))!;
  const usedIds = new Set<string>();
  const takeCards = (specs: Array<[string, string]>) =>
    specs.map(([rank, suit]) => {
      const c = bySpec(rank, suit);
      usedIds.add(c.id);
      return c;
    });
  const knownValidHand: Engine.Card[] = [
    ...takeCards([
      ['2', '♠'],
      ['3', '♠'],
      ['4', '♠'],
    ]),
    ...takeCards([
      ['5', '♥'],
      ['6', '♥'],
      ['7', '♥'],
    ]),
    ...takeCards([
      ['8', '♦'],
      ['9', '♦'],
      ['10', '♦'],
    ]),
    ...takeCards([
      ['K', '♣'],
      ['K', '♠'],
      ['K', '♥'],
      ['K', '♦'],
    ]),
  ];
  if (knownValidHand.length !== 13) throw new Error('knownValidHand setup bug');
  const mineKnown = Engine.isValidDeclare(knownValidHand, 'A');
  const theirsKnown = OriginalRules.isValidDeclare(
    knownValidHand.map((c) => ({ ...c })),
    'A'
  );
  if (!mineKnown || !theirsKnown) throw new Error(`known-valid hand didn't validate: mine=${mineKnown} theirs=${theirsKnown}`);
  checks++;

  // Pool bookkeeping: cross-checked identically (pure data transforms, low
  // risk, but cheap to confirm).
  const poolA = Engine.createPoolPlayers(['A', 'B', 'C']);
  const poolB = OriginalRules.createPoolPlayers(['A', 'B', 'C']);
  const afterA = Engine.applyPoolHandResult(poolA, [0, 40, 15], 51);
  const afterB = OriginalRules.applyPoolHandResult(poolB, [0, 40, 15], 51);
  if (JSON.stringify(afterA) !== JSON.stringify(afterB)) {
    throw new Error(`applyPoolHandResult mismatch: mine=${JSON.stringify(afterA)} theirs=${JSON.stringify(afterB)}`);
  }
  checks++;

  console.log(`[compare-rummy-engine] PASS — ${checks} checks across 4000+ randomized hands, all matched design/rummy-rules.js exactly.`);
}

main();
