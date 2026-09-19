// Real Indian (Points) Rummy rules — hand validation, scoring, and simple bot
// decision-making. Pure logic, no DOM/UI here, so it can be unit-tested with
// plain Node in addition to running in the browser (see the UMD wrapper).
//
// Game shape implemented:
//  - 2 standard 52-card decks + 4 printed jokers (108 cards total) — the
//    usual real-world Rummy pack, since one deck alone can't deal 13 cards
//    to 4 players AND leave cards for a draw pile.
//  - One "wild joker" rank is drawn at random each round; every card of
//    that rank (any suit) is wild, in addition to the printed joker cards.
//  - To validly declare: all 13 cards grouped into melds with zero leftover,
//    at least 2 sequences, and at least 1 of those sequences pure (no wild
//    cards used in it). This is the standard Indian Rummy declare rule.
//  - Losing players are scored by their best possible grouping that still
//    includes at least one pure sequence (if none is possible at all, they
//    take the max penalty); everything left outside that grouping counts
//    at face value (A=1, number=face, J/Q/K=10, any wild card=0 always).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RummyRules = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SUITS = ['♠', '♥', '♦', '♣'];
  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var SUIT_COLOR = { '♠': 'black', '♣': 'black', '♥': 'red', '♦': 'red' };
  var MAX_PENALTY = 80;

  var LOW_MAP = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13 };
  var HIGH_MAP = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };

  function buildDoubleDeck() {
    var cards = [];
    var counter = 0;
    for (var deckIdx = 0; deckIdx < 2; deckIdx++) {
      for (var s = 0; s < SUITS.length; s++) {
        for (var r = 0; r < RANKS.length; r++) {
          cards.push({ id: 'c' + counter++, rank: RANKS[r], suit: SUITS[s] });
        }
      }
      cards.push({ id: 'c' + counter++, rank: 'JOKER', suit: null });
      cards.push({ id: 'c' + counter++, rank: 'JOKER', suit: null });
    }
    return cards;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function isWildCard(card, wildRank) {
    return card.rank === 'JOKER' || card.rank === wildRank;
  }

  function pointValue(card, wildRank) {
    if (isWildCard(card, wildRank)) return 0;
    if (card.rank === 'A') return 1;
    if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
    return Number(card.rank);
  }

  function dealNewRound(playerCount) {
    var deck = shuffle(buildDoubleDeck());
    var hands = [];
    for (var p = 0; p < playerCount; p++) hands.push([]);
    for (var round = 0; round < 13; round++) {
      for (var p2 = 0; p2 < playerCount; p2++) hands[p2].push(deck.pop());
    }
    var indicator = deck.pop();
    var guard = 0;
    while (indicator.rank === 'JOKER' && guard < 200) {
      deck.unshift(indicator);
      indicator = deck.pop();
      guard++;
    }
    var wildRank = indicator.rank;
    var discardTop = deck.pop();
    return {
      hands: hands,
      wildRank: wildRank,
      wildIndicator: indicator,
      closedDeck: deck,
      discardPile: [discardTop],
    };
  }

  function ensureClosedDeckNotEmpty(state) {
    if (state.closedDeck.length > 0) return;
    var top = state.discardPile.pop();
    state.closedDeck = shuffle(state.discardPile);
    state.discardPile = top ? [top] : [];
  }

  // --- Meld detection -------------------------------------------------

  // Cards whose rank equals the wild rank are ambiguous — the player can
  // use them at face value OR as a joker substitute. This enumerates every
  // way to classify the ambiguous cards in a candidate subset so callers
  // can just try each classification.
  function classifications(subset, wildRank) {
    var flexIdx = [];
    for (var i = 0; i < subset.length; i++) {
      if (subset[i].rank === wildRank && subset[i].rank !== 'JOKER') flexIdx.push(i);
    }
    var n = flexIdx.length;
    var results = [];
    for (var mask = 0; mask < (1 << n); mask++) {
      var nonWild = [];
      var wildCount = 0;
      for (var j = 0; j < subset.length; j++) {
        var c = subset[j];
        if (c.rank === 'JOKER') { wildCount++; continue; }
        var flexPos = flexIdx.indexOf(j);
        if (flexPos !== -1 && (mask & (1 << flexPos))) { wildCount++; }
        else nonWild.push(c);
      }
      results.push({ nonWild: nonWild, wildCount: wildCount });
    }
    return results;
  }

  function isValidSet(subset) {
    var classes = classifications(subset, subset._wildRank);
    for (var k = 0; k < classes.length; k++) {
      var nonWild = classes[k].nonWild;
      if (nonWild.length === 0) continue;
      var rank = nonWild[0].rank;
      var ok = true;
      var suitsSeen = {};
      for (var i = 0; i < nonWild.length; i++) {
        if (nonWild[i].rank !== rank) { ok = false; break; }
        if (suitsSeen[nonWild[i].suit]) { ok = false; break; }
        suitsSeen[nonWild[i].suit] = true;
      }
      if (ok && nonWild.length <= 4) return true;
    }
    return false;
  }

  function isValidSequence(subset) {
    var n = subset.length;
    var classes = classifications(subset, subset._wildRank);
    for (var k = 0; k < classes.length; k++) {
      var nonWild = classes[k].nonWild;
      var wildCount = classes[k].wildCount;
      if (nonWild.length === 0) continue;
      var suit = nonWild[0].suit;
      var sameSuit = true;
      for (var i = 0; i < nonWild.length; i++) {
        if (nonWild[i].suit !== suit) { sameSuit = false; break; }
      }
      if (!sameSuit) continue;

      var maps = [LOW_MAP, HIGH_MAP];
      var bounds = [[1, 13], [2, 14]];
      for (var m = 0; m < maps.length; m++) {
        var map = maps[m];
        var values = [];
        var dup = false;
        var seen = {};
        for (var j = 0; j < nonWild.length; j++) {
          var v = map[nonWild[j].rank];
          if (v === undefined) { dup = 'skip'; break; }
          if (seen[v]) { dup = true; break; }
          seen[v] = true;
          values.push(v);
        }
        if (dup) continue;
        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);
        if (max - min + 1 > n) continue;
        var lb = bounds[m][0], ub = bounds[m][1];
        var sLo = Math.max(lb, max - n + 1);
        var sHi = Math.min(min, ub - n + 1);
        if (sLo <= sHi) {
          return { pure: wildCount === 0 };
        }
      }
    }
    return false;
  }

  function meldType(subset, wildRank) {
    subset._wildRank = wildRank;
    var seq = isValidSequence(subset);
    if (seq) return { kind: 'sequence', pure: seq.pure };
    if (isValidSet(subset)) return { kind: 'set', pure: false };
    return null;
  }

  function combinationsOfIndices(n, k) {
    var result = [];
    var combo = [];
    (function backtrack(start) {
      if (combo.length === k) { result.push(combo.slice()); return; }
      for (var i = start; i < n; i++) {
        combo.push(i);
        backtrack(i + 1);
        combo.pop();
      }
    })(0);
    return result;
  }

  // Every valid 3- or 4-card meld found anywhere in `hand`, each tagged
  // with its bitmask over hand indices, kind, purity, and point value.
  function generateAllMelds(hand, wildRank) {
    var melds = [];
    [3, 4].forEach(function (k) {
      if (hand.length < k) return;
      var combos = combinationsOfIndices(hand.length, k);
      combos.forEach(function (indices) {
        var subset = indices.map(function (i) { return hand[i]; });
        var type = meldType(subset, wildRank);
        if (!type) return;
        var mask = 0;
        indices.forEach(function (i) { mask |= (1 << i); });
        var points = subset.reduce(function (s, c) { return s + pointValue(c, wildRank); }, 0);
        melds.push({ indices: indices, mask: mask, kind: type.kind, pure: type.pure, points: points });
      });
    });
    return melds;
  }

  // --- Declare validity (winner) --------------------------------------

  // 13 cards split exactly into melds (sizes only fit as three 3s + one 4),
  // no leftover, >=2 sequences, >=1 pure. Returns the groups used, or null.
  function findValidDeclareGroups(hand, wildRank) {
    var melds = generateAllMelds(hand, wildRank);
    var full = (1 << hand.length) - 1;
    var result = null;
    function dfs(remaining, seqCount, pureCount, chosen) {
      if (result) return;
      if (remaining === 0) {
        if (seqCount >= 2 && pureCount >= 1) result = chosen.slice();
        return;
      }
      var lb = remaining & (-remaining);
      for (var i = 0; i < melds.length; i++) {
        if (result) return;
        var m = melds[i];
        if ((m.mask & lb) === 0) continue;
        if ((m.mask & remaining) !== m.mask) continue;
        chosen.push(m);
        dfs(
          remaining ^ m.mask,
          seqCount + (m.kind === 'sequence' ? 1 : 0),
          pureCount + (m.kind === 'sequence' && m.pure ? 1 : 0),
          chosen
        );
        chosen.pop();
      }
    }
    dfs(full, 0, 0, []);
    return result;
  }

  function isValidDeclare(hand, wildRank) {
    return findValidDeclareGroups(hand, wildRank) !== null;
  }

  // Tries removing each card from a 14-card hand to find a valid 13-card
  // declare. Prefers keeping `preferRemoveIdx` (the card the player tapped)
  // if that alone works, otherwise scans every option.
  function findDeclareOption(hand14, wildRank, preferRemoveIdx) {
    function tryRemove(i) {
      var trial = hand14.slice(0, i).concat(hand14.slice(i + 1));
      var groups = findValidDeclareGroups(trial, wildRank);
      if (!groups) return null;
      return { removeIndex: i, groups: groups, hand13: trial };
    }
    if (preferRemoveIdx !== undefined && preferRemoveIdx !== null) {
      var preferred = tryRemove(preferRemoveIdx);
      if (preferred) return preferred;
    }
    for (var i = 0; i < hand14.length; i++) {
      if (i === preferRemoveIdx) continue;
      var found = tryRemove(i);
      if (found) return found;
    }
    return null;
  }

  // --- Scoring / best-grouping (losers) -------------------------------

  // Maximize points removed via valid melds subject to >=1 pure sequence
  // being included (real Rummy scoring rule); anything left over counts as
  // deadwood at face value. No pure sequence achievable at all -> max
  // penalty. Bitmask DP over the hand (<=14 cards, so <=16384 states).
  function computeBestGrouping(hand, wildRank) {
    var n = hand.length;
    var totalPoints = hand.reduce(function (s, c) { return s + pointValue(c, wildRank); }, 0);
    if (n === 0) return { deadwood: 0, chosenMelds: [], ungroupedIndices: [], pureAchieved: true, totalPoints: 0 };

    var melds = generateAllMelds(hand, wildRank);
    var total = 1 << n;
    var NEG = -Infinity;
    var dp0 = new Array(total).fill(NEG);
    var dp1 = new Array(total).fill(NEG);
    var choice0 = new Array(total).fill(null);
    var choice1 = new Array(total).fill(null);
    dp0[0] = 0;

    for (var mask = 1; mask < total; mask++) {
      var lb = mask & (-mask);
      var rest = mask ^ lb;

      if (dp0[rest] > dp0[mask]) { dp0[mask] = dp0[rest]; choice0[mask] = { type: 'skip' }; }
      if (dp1[rest] > dp1[mask]) { dp1[mask] = dp1[rest]; choice1[mask] = { type: 'skip' }; }

      for (var mi = 0; mi < melds.length; mi++) {
        var m = melds[mi];
        if ((m.mask & lb) === 0) continue;
        if ((m.mask & mask) !== m.mask) continue;
        var prevMask = mask & ~m.mask;

        if (m.pure) {
          var best = Math.max(dp0[prevMask], dp1[prevMask]);
          if (best !== NEG) {
            var val = best + m.points;
            if (val > dp1[mask]) {
              dp1[mask] = val;
              choice1[mask] = { type: 'meld', meld: m, fromPure: dp1[prevMask] >= dp0[prevMask] ? 1 : 0 };
            }
          }
        } else {
          if (dp0[prevMask] !== NEG) {
            var val0 = dp0[prevMask] + m.points;
            if (val0 > dp0[mask]) { dp0[mask] = val0; choice0[mask] = { type: 'meld', meld: m, fromPure: 0 }; }
          }
          if (dp1[prevMask] !== NEG) {
            var val1 = dp1[prevMask] + m.points;
            if (val1 > dp1[mask]) { dp1[mask] = val1; choice1[mask] = { type: 'meld', meld: m, fromPure: 1 }; }
          }
        }
      }
    }

    var full = total - 1;
    var usesPure = dp1[full];
    if (usesPure === NEG) {
      // Real rule: no pure sequence at all means the flat "full count"
      // penalty (80), regardless of what the cards actually add up to —
      // not capped at the hand's own total.
      return { deadwood: MAX_PENALTY, chosenMelds: [], ungroupedIndices: hand.map(function (_, i) { return i; }), pureAchieved: false, totalPoints: totalPoints };
    }

    var chosen = [];
    var ungrouped = [];
    var curMask = full;
    var pureFlag = 1;
    while (curMask !== 0) {
      var c = pureFlag ? choice1[curMask] : choice0[curMask];
      if (c.type === 'skip') {
        var lowBit = curMask & (-curMask);
        ungrouped.push(Math.log2(lowBit));
        curMask ^= lowBit;
      } else {
        chosen.push(c.meld);
        curMask &= ~c.meld.mask;
        pureFlag = c.fromPure;
      }
    }

    return {
      // Even with a pure sequence secured, a cheap one (e.g. A-2-3) can
      // leave expensive cards ungrouped — real Rummy still caps a loser's
      // score at the flat max penalty (80), not just the no-pure-sequence
      // case.
      deadwood: Math.min(MAX_PENALTY, totalPoints - usesPure),
      chosenMelds: chosen,
      ungroupedIndices: ungrouped,
      pureAchieved: true,
      totalPoints: totalPoints,
    };
  }

  // --- Bot AI -----------------------------------------------------------

  function botChooseDrawSource(hand, discardTop, wildRank) {
    var baseline = computeBestGrouping(hand, wildRank).deadwood;
    var withDiscard = hand.concat([discardTop]);
    var bestAfter = Infinity;
    for (var i = 0; i < withDiscard.length; i++) {
      var trial = withDiscard.slice(0, i).concat(withDiscard.slice(i + 1));
      var d = computeBestGrouping(trial, wildRank).deadwood;
      if (d < bestAfter) bestAfter = d;
    }
    return bestAfter < baseline ? 'discard' : 'closed';
  }

  function botChooseDiscardIndex(hand14, wildRank) {
    var bestIdx = 0;
    var bestDeadwood = Infinity;
    for (var i = 0; i < hand14.length; i++) {
      var trial = hand14.slice(0, i).concat(hand14.slice(i + 1));
      var d = computeBestGrouping(trial, wildRank).deadwood;
      if (d < bestDeadwood) { bestDeadwood = d; bestIdx = i; }
    }
    return bestIdx;
  }

  // --- Pool Rummy ---------------------------------------------------------
  // Several hands played in sequence: a loser's points accumulate across
  // hands (instead of being settled after just one), and reaching the
  // pool's point cap eliminates that player. Play continues among whoever's
  // still active until exactly one remains, who takes the whole entry pot.
  // Deliberately not modeled: re-entry/second-chance rules some real
  // platforms offer — out of scope here, same as this engine not modeling
  // drop/middle-drop scoring.
  var POOL_SIZES = [51, 101, 201];

  function createPoolPlayers(names) {
    return names.map(function (name, idx) {
      return { idx: idx, name: name, cumulative: 0, eliminated: false };
    });
  }

  // handPoints: an array parallel to poolPlayers with this hand's points
  // for every player (0 for the hand's winner, deadwood/penalty for
  // everyone else; 0 for any already-eliminated player, who didn't play).
  // Returns a new array — doesn't mutate poolPlayers.
  function applyPoolHandResult(poolPlayers, handPoints, poolLimit) {
    return poolPlayers.map(function (p, i) {
      if (p.eliminated) return p;
      var cumulative = p.cumulative + (handPoints[i] || 0);
      return { idx: p.idx, name: p.name, cumulative: cumulative, eliminated: cumulative >= poolLimit };
    });
  }

  function activePoolPlayers(poolPlayers) {
    return poolPlayers.filter(function (p) { return !p.eliminated; });
  }

  // A hand's winner always scores 0 that hand, so their cumulative can't
  // cross the cap — at least one player is always still active after any
  // hand, meaning this can never reach 0 (only <=1, i.e. the pool is over).
  function isPoolOver(poolPlayers) {
    return activePoolPlayers(poolPlayers).length <= 1;
  }

  // The first non-eliminated seat at or after `start` (wrapping around) —
  // used both to pick who opens the next hand and to skip eliminated seats
  // when advancing whose turn it is. Returns -1 if nobody is active (should
  // never happen if isPoolOver is checked before calling this).
  function firstActiveFrom(start, count, poolPlayers) {
    for (var step = 0; step < count; step++) {
      var candidate = (start + step) % count;
      if (!poolPlayers[candidate].eliminated) return candidate;
    }
    return -1;
  }

  return {
    SUITS: SUITS,
    RANKS: RANKS,
    SUIT_COLOR: SUIT_COLOR,
    MAX_PENALTY: MAX_PENALTY,
    POOL_SIZES: POOL_SIZES,
    shuffle: shuffle,
    buildDoubleDeck: buildDoubleDeck,
    isWildCard: isWildCard,
    pointValue: pointValue,
    dealNewRound: dealNewRound,
    ensureClosedDeckNotEmpty: ensureClosedDeckNotEmpty,
    generateAllMelds: generateAllMelds,
    findValidDeclareGroups: findValidDeclareGroups,
    isValidDeclare: isValidDeclare,
    findDeclareOption: findDeclareOption,
    computeBestGrouping: computeBestGrouping,
    botChooseDrawSource: botChooseDrawSource,
    botChooseDiscardIndex: botChooseDiscardIndex,
    createPoolPlayers: createPoolPlayers,
    applyPoolHandResult: applyPoolHandResult,
    activePoolPlayers: activePoolPlayers,
    isPoolOver: isPoolOver,
    firstActiveFrom: firstActiveFrom,
  };
});
