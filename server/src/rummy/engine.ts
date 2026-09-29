// Authoritative Rummy rules engine — a faithful TypeScript port of
// design/rummy-rules.js (the client's practice-table engine, extensively
// unit- and e2e-tested there: see design/rummy-rules.test.js). Duplicated
// rather than imported because server/'s Docker build context is `./server`
// only (see render.yaml/server/Dockerfile) — a cross-directory require into
// design/ would resolve locally but 404 inside the deployed container. Kept
// deliberately identical in structure/behavior to the client copy to
// minimize drift risk; if the two ever need to diverge, treat this file as
// the source of truth (it's the one real money depends on) and port changes
// here first.
//
// The client's bot-decision helpers (botChooseDrawSource/botChooseDiscardIndex)
// and findDeclareOption (a UX nicety for suggesting which card to drop) are
// deliberately NOT ported here — real-money multiplayer tables are real
// players only (no bots), and the server only ever needs to validate a
// declare attempt the client already committed to, not suggest one.

export interface Card {
  id: string;
  rank: string;
  suit: string | null;
}

export interface DealResult {
  hands: Card[][];
  wildRank: string;
  wildIndicator: Card;
  closedDeck: Card[];
  discardPile: Card[];
}

export interface DeckState {
  closedDeck: Card[];
  discardPile: Card[];
}

export interface Meld {
  indices: number[];
  mask: number;
  kind: 'sequence' | 'set';
  pure: boolean;
  points: number;
}

type Choice = { type: 'skip' } | { type: 'meld'; meld: Meld; fromPure: 0 | 1 };

export interface BestGrouping {
  deadwood: number;
  chosenMelds: Meld[];
  ungroupedIndices: number[];
  pureAchieved: boolean;
  totalPoints: number;
}

export interface PoolPlayer {
  idx: number;
  name: string;
  cumulative: number;
  eliminated: boolean;
}

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const MAX_PENALTY = 80;
export const POOL_SIZES = [51, 101, 201];

const LOW_MAP: Record<string, number> = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13 };
const HIGH_MAP: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };

export function buildDoubleDeck(): Card[] {
  const cards: Card[] = [];
  let counter = 0;
  for (let deckIdx = 0; deckIdx < 2; deckIdx++) {
    for (let s = 0; s < SUITS.length; s++) {
      for (let r = 0; r < RANKS.length; r++) {
        cards.push({ id: 'c' + counter++, rank: RANKS[r]!, suit: SUITS[s]! });
      }
    }
    cards.push({ id: 'c' + counter++, rank: 'JOKER', suit: null });
    cards.push({ id: 'c' + counter++, rank: 'JOKER', suit: null });
  }
  return cards;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

export function isWildCard(card: Card, wildRank: string): boolean {
  return card.rank === 'JOKER' || card.rank === wildRank;
}

export function pointValue(card: Card, wildRank: string): number {
  if (isWildCard(card, wildRank)) return 0;
  if (card.rank === 'A') return 1;
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
  return Number(card.rank);
}

export function dealNewRound(playerCount: number): DealResult {
  const deck = shuffle(buildDoubleDeck());
  const hands: Card[][] = [];
  for (let p = 0; p < playerCount; p++) hands.push([]);
  for (let round = 0; round < 13; round++) {
    for (let p2 = 0; p2 < playerCount; p2++) hands[p2]!.push(deck.pop()!);
  }
  let indicator = deck.pop()!;
  let guard = 0;
  while (indicator.rank === 'JOKER' && guard < 200) {
    deck.unshift(indicator);
    indicator = deck.pop()!;
    guard++;
  }
  const wildRank = indicator.rank;
  const discardTop = deck.pop()!;
  return {
    hands,
    wildRank,
    wildIndicator: indicator,
    closedDeck: deck,
    discardPile: [discardTop],
  };
}

export function ensureClosedDeckNotEmpty(state: DeckState): void {
  if (state.closedDeck.length > 0) return;
  const top = state.discardPile.pop();
  state.closedDeck = shuffle(state.discardPile);
  state.discardPile = top ? [top] : [];
}

// --- Meld detection -------------------------------------------------

interface Classification {
  nonWild: Card[];
  wildCount: number;
}

// Cards whose rank equals the wild rank are ambiguous — the player can use
// them at face value OR as a joker substitute. This enumerates every way to
// classify the ambiguous cards in a candidate subset so callers can just try
// each classification.
function classifications(subset: Card[], wildRank: string): Classification[] {
  const flexIdx: number[] = [];
  for (let i = 0; i < subset.length; i++) {
    if (subset[i]!.rank === wildRank && subset[i]!.rank !== 'JOKER') flexIdx.push(i);
  }
  const n = flexIdx.length;
  const results: Classification[] = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const nonWild: Card[] = [];
    let wildCount = 0;
    for (let j = 0; j < subset.length; j++) {
      const c = subset[j]!;
      if (c.rank === 'JOKER') {
        wildCount++;
        continue;
      }
      const flexPos = flexIdx.indexOf(j);
      if (flexPos !== -1 && mask & (1 << flexPos)) {
        wildCount++;
      } else {
        nonWild.push(c);
      }
    }
    results.push({ nonWild, wildCount });
  }
  return results;
}

function isValidSet(subset: Card[], wildRank: string): boolean {
  const classes = classifications(subset, wildRank);
  for (let k = 0; k < classes.length; k++) {
    const nonWild = classes[k]!.nonWild;
    if (nonWild.length === 0) continue;
    const rank = nonWild[0]!.rank;
    let ok = true;
    const suitsSeen: Record<string, boolean> = {};
    for (let i = 0; i < nonWild.length; i++) {
      if (nonWild[i]!.rank !== rank) {
        ok = false;
        break;
      }
      const suit = nonWild[i]!.suit!;
      if (suitsSeen[suit]) {
        ok = false;
        break;
      }
      suitsSeen[suit] = true;
    }
    if (ok && nonWild.length <= 4) return true;
  }
  return false;
}

function isValidSequence(subset: Card[], wildRank: string): { pure: boolean } | false {
  const n = subset.length;
  const classes = classifications(subset, wildRank);
  for (let k = 0; k < classes.length; k++) {
    const nonWild = classes[k]!.nonWild;
    const wildCount = classes[k]!.wildCount;
    if (nonWild.length === 0) continue;
    const suit = nonWild[0]!.suit;
    let sameSuit = true;
    for (let i = 0; i < nonWild.length; i++) {
      if (nonWild[i]!.suit !== suit) {
        sameSuit = false;
        break;
      }
    }
    if (!sameSuit) continue;

    const maps = [LOW_MAP, HIGH_MAP];
    const bounds: Array<[number, number]> = [
      [1, 13],
      [2, 14],
    ];
    for (let m = 0; m < maps.length; m++) {
      const map = maps[m]!;
      const values: number[] = [];
      let dup = false;
      const seen: Record<number, boolean> = {};
      let skip = false;
      for (let j = 0; j < nonWild.length; j++) {
        const v = map[nonWild[j]!.rank];
        if (v === undefined) {
          skip = true;
          break;
        }
        if (seen[v]) {
          dup = true;
          break;
        }
        seen[v] = true;
        values.push(v);
      }
      if (skip || dup) continue;
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (max - min + 1 > n) continue;
      const [lb, ub] = bounds[m]!;
      const sLo = Math.max(lb, max - n + 1);
      const sHi = Math.min(min, ub - n + 1);
      if (sLo <= sHi) {
        return { pure: wildCount === 0 };
      }
    }
  }
  return false;
}

function meldType(subset: Card[], wildRank: string): { kind: 'sequence' | 'set'; pure: boolean } | null {
  const seq = isValidSequence(subset, wildRank);
  if (seq) return { kind: 'sequence', pure: seq.pure };
  if (isValidSet(subset, wildRank)) return { kind: 'set', pure: false };
  return null;
}

function combinationsOfIndices(n: number, k: number): number[][] {
  const result: number[][] = [];
  const combo: number[] = [];
  (function backtrack(start: number) {
    if (combo.length === k) {
      result.push(combo.slice());
      return;
    }
    for (let i = start; i < n; i++) {
      combo.push(i);
      backtrack(i + 1);
      combo.pop();
    }
  })(0);
  return result;
}

// Every valid 3- or 4-card meld found anywhere in `hand`, each tagged with
// its bitmask over hand indices, kind, purity, and point value.
export function generateAllMelds(hand: Card[], wildRank: string): Meld[] {
  const melds: Meld[] = [];
  [3, 4].forEach((k) => {
    if (hand.length < k) return;
    const combos = combinationsOfIndices(hand.length, k);
    combos.forEach((indices) => {
      const subset = indices.map((i) => hand[i]!);
      const type = meldType(subset, wildRank);
      if (!type) return;
      let mask = 0;
      indices.forEach((i) => {
        mask |= 1 << i;
      });
      const points = subset.reduce((s, c) => s + pointValue(c, wildRank), 0);
      melds.push({ indices, mask, kind: type.kind, pure: type.pure, points });
    });
  });
  return melds;
}

// --- Declare validity (winner) --------------------------------------

// 13 cards split exactly into melds (sizes only fit as three 3s + one 4), no
// leftover, >=2 sequences, >=1 pure. Returns the groups used, or null.
export function findValidDeclareGroups(hand: Card[], wildRank: string): Meld[] | null {
  const melds = generateAllMelds(hand, wildRank);
  const full = (1 << hand.length) - 1;
  let result: Meld[] | null = null;
  function dfs(remaining: number, seqCount: number, pureCount: number, chosen: Meld[]) {
    if (result) return;
    if (remaining === 0) {
      if (seqCount >= 2 && pureCount >= 1) result = chosen.slice();
      return;
    }
    const lb = remaining & -remaining;
    for (let i = 0; i < melds.length; i++) {
      if (result) return;
      const m = melds[i]!;
      if ((m.mask & lb) === 0) continue;
      if ((m.mask & remaining) !== m.mask) continue;
      chosen.push(m);
      dfs(remaining ^ m.mask, seqCount + (m.kind === 'sequence' ? 1 : 0), pureCount + (m.kind === 'sequence' && m.pure ? 1 : 0), chosen);
      chosen.pop();
    }
  }
  dfs(full, 0, 0, []);
  return result;
}

export function isValidDeclare(hand: Card[], wildRank: string): boolean {
  return findValidDeclareGroups(hand, wildRank) !== null;
}

// --- Scoring / best-grouping (losers) -------------------------------

// Maximize points removed via valid melds subject to >=1 pure sequence being
// included (real Rummy scoring rule); anything left over counts as deadwood
// at face value. No pure sequence achievable at all -> max penalty. Bitmask
// DP over the hand (<=14 cards, so <=16384 states).
export function computeBestGrouping(hand: Card[], wildRank: string): BestGrouping {
  const n = hand.length;
  const totalPoints = hand.reduce((s, c) => s + pointValue(c, wildRank), 0);
  if (n === 0) return { deadwood: 0, chosenMelds: [], ungroupedIndices: [], pureAchieved: true, totalPoints: 0 };

  const melds = generateAllMelds(hand, wildRank);
  const total = 1 << n;
  const NEG = -Infinity;
  const dp0 = new Array(total).fill(NEG);
  const dp1 = new Array(total).fill(NEG);
  const choice0: Array<Choice | null> = new Array(total).fill(null);
  const choice1: Array<Choice | null> = new Array(total).fill(null);
  dp0[0] = 0;

  for (let mask = 1; mask < total; mask++) {
    const lb = mask & -mask;
    const rest = mask ^ lb;

    if (dp0[rest] > dp0[mask]) {
      dp0[mask] = dp0[rest];
      choice0[mask] = { type: 'skip' };
    }
    if (dp1[rest] > dp1[mask]) {
      dp1[mask] = dp1[rest];
      choice1[mask] = { type: 'skip' };
    }

    for (let mi = 0; mi < melds.length; mi++) {
      const m = melds[mi]!;
      if ((m.mask & lb) === 0) continue;
      if ((m.mask & mask) !== m.mask) continue;
      const prevMask = mask & ~m.mask;

      if (m.pure) {
        const best = Math.max(dp0[prevMask], dp1[prevMask]);
        if (best !== NEG) {
          const val = best + m.points;
          if (val > dp1[mask]) {
            dp1[mask] = val;
            choice1[mask] = { type: 'meld', meld: m, fromPure: dp1[prevMask] >= dp0[prevMask] ? 1 : 0 };
          }
        }
      } else {
        if (dp0[prevMask] !== NEG) {
          const val0 = dp0[prevMask] + m.points;
          if (val0 > dp0[mask]) {
            dp0[mask] = val0;
            choice0[mask] = { type: 'meld', meld: m, fromPure: 0 };
          }
        }
        if (dp1[prevMask] !== NEG) {
          const val1 = dp1[prevMask] + m.points;
          if (val1 > dp1[mask]) {
            dp1[mask] = val1;
            choice1[mask] = { type: 'meld', meld: m, fromPure: 1 };
          }
        }
      }
    }
  }

  const full = total - 1;
  const usesPure = dp1[full];
  if (usesPure === NEG) {
    // Real rule: no pure sequence at all means the flat "full count" penalty
    // (80), regardless of what the cards actually add up to — not capped at
    // the hand's own total.
    return {
      deadwood: MAX_PENALTY,
      chosenMelds: [],
      ungroupedIndices: hand.map((_, i) => i),
      pureAchieved: false,
      totalPoints,
    };
  }

  const chosen: Meld[] = [];
  const ungrouped: number[] = [];
  let curMask = full;
  let pureFlag: 0 | 1 = 1;
  while (curMask !== 0) {
    const c: Choice | null = pureFlag ? choice1[curMask]! : choice0[curMask]!;
    if (!c || c.type === 'skip') {
      const lowBit = curMask & -curMask;
      ungrouped.push(Math.log2(lowBit));
      curMask ^= lowBit;
    } else {
      chosen.push(c.meld);
      curMask &= ~c.meld.mask;
      pureFlag = c.fromPure;
    }
  }

  return {
    // Even with a pure sequence secured, a cheap one (e.g. A-2-3) can leave
    // expensive cards ungrouped — real Rummy still caps a loser's score at
    // the flat max penalty (80), not just the no-pure-sequence case.
    deadwood: Math.min(MAX_PENALTY, totalPoints - usesPure),
    chosenMelds: chosen,
    ungroupedIndices: ungrouped,
    pureAchieved: true,
    totalPoints,
  };
}

// --- Pool Rummy ---------------------------------------------------------
// Several hands played in sequence: a loser's points accumulate across
// hands (instead of being settled after just one), and reaching the pool's
// point cap eliminates that player. Play continues among whoever's still
// active until exactly one remains, who takes the whole entry pot.
// Deliberately not modeled: re-entry/second-chance rules some real
// platforms offer — out of scope here, same as this engine not modeling
// drop/middle-drop scoring.

export function createPoolPlayers(names: string[]): PoolPlayer[] {
  return names.map((name, idx) => ({ idx, name, cumulative: 0, eliminated: false }));
}

// handPoints: an array parallel to poolPlayers with this hand's points for
// every player (0 for the hand's winner, deadwood/penalty for everyone
// else; 0 for any already-eliminated player, who didn't play). Returns a
// new array — doesn't mutate poolPlayers.
export function applyPoolHandResult(poolPlayers: PoolPlayer[], handPoints: number[], poolLimit: number): PoolPlayer[] {
  return poolPlayers.map((p, i) => {
    if (p.eliminated) return p;
    const cumulative = p.cumulative + (handPoints[i] || 0);
    return { idx: p.idx, name: p.name, cumulative, eliminated: cumulative >= poolLimit };
  });
}

export function activePoolPlayers(poolPlayers: PoolPlayer[]): PoolPlayer[] {
  return poolPlayers.filter((p) => !p.eliminated);
}

// A hand's winner always scores 0 that hand, so their cumulative can't cross
// the cap — at least one player is always still active after any hand,
// meaning this can never reach 0 (only <=1, i.e. the pool is over).
export function isPoolOver(poolPlayers: PoolPlayer[]): boolean {
  return activePoolPlayers(poolPlayers).length <= 1;
}

// The first non-eliminated seat at or after `start` (wrapping around) — used
// both to pick who opens the next hand and to skip eliminated seats when
// advancing whose turn it is. Returns -1 if nobody is active (should never
// happen if isPoolOver is checked before calling this).
export function firstActiveFrom(start: number, count: number, poolPlayers: PoolPlayer[]): number {
  for (let step = 0; step < count; step++) {
    const candidate = (start + step) % count;
    if (!poolPlayers[candidate]!.eliminated) return candidate;
  }
  return -1;
}
