// Run with: node design/rummy-rules.test.js
// Plain Node, no test framework/build step — matches how rummy-rules.js
// itself has zero dependencies. Exits non-zero on any failure.
const RummyRules = require('./rummy-rules.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

let uid = 0;
function c(rank, suit) { return { id: 't' + uid++, rank, suit }; }
function joker() { return { id: 'j' + uid++, rank: 'JOKER', suit: null }; }

// --- Meld primitives via generateAllMelds on a small hand -------------
{
  const hand = [c('4','♠'), c('5','♠'), c('6','♠')];
  const melds = RummyRules.generateAllMelds(hand, 'K');
  ok('pure sequence 4-5-6 spades detected', melds.some(m => m.kind === 'sequence' && m.pure && m.mask === 0b111), melds);
}
{
  const hand = [c('7','♦'), c('7','♣'), c('7','♠')];
  const melds = RummyRules.generateAllMelds(hand, 'K');
  ok('set 7-7-7 distinct suits detected', melds.some(m => m.kind === 'set' && m.mask === 0b111), melds);
}
{
  // duplicate suit should NOT be a valid set
  const hand = [c('7','♦'), c('7','♦'), c('7','♠')];
  const melds = RummyRules.generateAllMelds(hand, 'K');
  ok('set with duplicate suit rejected', !melds.some(m => m.kind === 'set' && m.mask === 0b111), melds);
}
{
  // joker-completed sequence (impure)
  const hand = [c('9','♥'), c('10','♥'), joker()];
  const melds = RummyRules.generateAllMelds(hand, 'K');
  const m = melds.find(m => m.mask === 0b111);
  ok('joker sequence detected as impure', m && m.kind === 'sequence' && m.pure === false, m);
}
{
  // Ace-low sequence
  const hand = [c('A','♠'), c('2','♠'), c('3','♠')];
  const melds = RummyRules.generateAllMelds(hand, 'K');
  ok('A-2-3 valid low sequence', melds.some(m => m.kind === 'sequence' && m.pure && m.mask === 0b111), melds);
}
{
  // Ace-high sequence
  const hand = [c('Q','♠'), c('K','♠'), c('A','♠')];
  const melds = RummyRules.generateAllMelds(hand, 'K');
  ok('Q-K-A valid high sequence', melds.some(m => m.kind === 'sequence' && m.pure && m.mask === 0b111), melds);
}
{
  // wrap-around should be INVALID (wildRank deliberately not K/A/2, so
  // none of these cards are ambiguous wild substitutes here)
  const hand = [c('K','♠'), c('A','♠'), c('2','♠')];
  const melds = RummyRules.generateAllMelds(hand, '7');
  ok('K-A-2 wrap-around rejected', !melds.some(m => m.kind === 'sequence' && m.mask === 0b111), melds);
}
{
  // wild-rank card used naturally in a same-suit run (not as substitute)
  const hand = [c('4','♠'), c('5','♠'), c('6','♠')]; // wildRank = '5', card 5♠ present naturally
  const melds = RummyRules.generateAllMelds(hand, '5');
  const m = melds.find(m => m.mask === 0b111 && m.kind === 'sequence');
  ok('wild-rank card usable naturally still forms pure sequence', m && m.pure === true, m);
}
{
  // wild-rank card used AS a substitute to complete a run missing a card
  const hand = [c('4','♠'), c('6','♠'), c('5','♥')]; // wildRank='5' -> 5♥ can sub for 5♠
  const melds = RummyRules.generateAllMelds(hand, '5');
  const m = melds.find(m => m.mask === 0b111 && m.kind === 'sequence');
  ok('wild-rank card usable as substitute to fill a gap', m && m.pure === false, m);
}

// --- Full-hand declare validity ----------------------------------------
{
  // 3+3+3+4 = 13, two pure sequences, one set, one 4-card set -> valid (>=2 seq, >=1 pure)
  const hand = [
    c('4','♠'), c('5','♠'), c('6','♠'),          // pure seq
    c('9','♥'), c('10','♥'), c('J','♥'),          // pure seq
    c('7','♦'), c('7','♣'), c('7','♠'),          // set
    c('Q','♥'), c('Q','♦'), c('Q','♣'), c('Q','♠'), // 4-card set
  ];
  const groups = RummyRules.findValidDeclareGroups(hand, 'K');
  ok('valid 13-card winning hand declares', groups !== null, groups);
  if (groups) {
    const covered = groups.reduce((s, m) => s | m.mask, 0);
    ok('winning groups cover all 13 cards with no overlap', covered === (1 << 13) - 1 &&
      groups.reduce((s, m) => s + (1 << 0) * 0 + m.indices.length, 0) === 13);
  }
}
{
  // Same cards but only ONE sequence total (rest are sets) -> must be invalid
  const hand = [
    c('4','♠'), c('5','♠'), c('6','♠'),          // pure seq (only 1)
    c('9','♥'), c('9','♦'), c('9','♣'),          // set
    c('7','♦'), c('7','♣'), c('7','♠'),          // set
    c('Q','♥'), c('Q','♦'), c('Q','♣'), c('Q','♠'), // set
  ];
  ok('hand with only 1 sequence (need >=2) is invalid', !RummyRules.isValidDeclare(hand, 'K'), hand);
}
{
  // Fully covered by 4 sets, zero sequences -> invalid
  const hand = [
    c('4','♠'), c('4','♥'), c('4','♦'),
    c('9','♥'), c('9','♦'), c('9','♣'),
    c('7','♦'), c('7','♣'), c('7','♠'),
    c('Q','♥'), c('Q','♦'), c('Q','♣'), c('Q','♠'),
  ];
  ok('hand with zero sequences is invalid even fully covered', !RummyRules.isValidDeclare(hand, 'K'), hand);
}
{
  // Two sequences but NEITHER pure (both rely on jokers) -> invalid
  const hand = [
    c('4','♠'), c('5','♠'), joker(),               // impure seq
    c('9','♥'), c('10','♥'), joker(),               // impure seq
    c('7','♦'), c('7','♣'), c('7','♠'),             // set
    c('Q','♥'), c('Q','♦'), c('Q','♣'), c('Q','♠'), // set
  ];
  ok('two sequences but no pure sequence is invalid', !RummyRules.isValidDeclare(hand, 'K'), hand);
}
{
  // One leftover ungrouped card -> invalid regardless
  const hand = [
    c('4','♠'), c('5','♠'), c('6','♠'),
    c('9','♥'), c('10','♥'), c('J','♥'),
    c('7','♦'), c('7','♣'), c('7','♠'),
    c('Q','♥'), c('Q','♦'), c('Q','♣'),
    c('2','♦'), // 13th card, doesn't fit anywhere
  ];
  ok('hand with an ungroupable leftover card is invalid', !RummyRules.isValidDeclare(hand, 'K'), hand);
}

// --- Scoring / bestGrouping ---------------------------------------------
{
  // Pure sequence + 4 deadwood cards (10 cards total, not a full hand, just
  // testing the scoring math in isolation)
  const hand = [
    c('4','♠'), c('5','♠'), c('6','♠'), // pure seq, 0 deadwood contribution
    c('K','♦'), c('9','♣'), c('2','♥'), c('A','♠'), // deadwood: 10+9+2+1=22
  ];
  const g = RummyRules.computeBestGrouping(hand, '3'); // wildRank '3' overlaps none of these cards
  ok('deadwood scoring sums correctly with one pure sequence', g.pureAchieved === true && g.deadwood === 22, g);
}
{
  // No pure sequence possible anywhere -> max penalty (80)
  const hand = [
    c('2','♠'), c('K','♦'), c('9','♣'), c('J','♥'), c('7','♠'), c('3','♦'),
  ];
  const g = RummyRules.computeBestGrouping(hand, 'Q'); // wildRank overlaps none of these cards
  ok('hand with no possible pure sequence gets flat 80 penalty (not capped at hand total)', g.pureAchieved === false && g.deadwood === 80, g);
}
{
  // Wild/joker cards should never count as deadwood even when ungrouped —
  // tested against a realistic 13-card-shaped hand (a secured pure
  // sequence + a mix of an ungrouped joker and real deadwood cards),
  // since real hands are always dealt at 13/14 cards, not 2.
  const hand = [
    c('4','♠'), c('5','♠'), c('6','♠'), // pure seq, 0 deadwood
    c('K','♦'), joker(), c('9','♣'),     // K=10, joker=0, 9=9 -> 19 deadwood
  ];
  const g = RummyRules.computeBestGrouping(hand, '5');
  ok('ungrouped joker contributes 0 deadwood alongside real deadwood cards', g.pureAchieved === true && g.deadwood === 19, g);
}
{
  // chosenMelds + ungrouped must exactly partition the hand (no double count, no gaps)
  const hand = [
    c('4','♠'), c('5','♠'), c('6','♠'),
    c('9','♥'), c('9','♦'), c('K','♣'), c('3','♦'),
  ];
  const g = RummyRules.computeBestGrouping(hand, 'K');
  const meldIdx = new Set();
  g.chosenMelds.forEach(m => m.indices.forEach(i => meldIdx.add(i)));
  g.ungroupedIndices.forEach(i => meldIdx.add(i));
  ok('bestGrouping partition covers every card exactly once', meldIdx.size === hand.length, { size: meldIdx.size, expected: hand.length });
}

// --- Dealing ---------------------------------------------------------
{
  const state = RummyRules.dealNewRound(4);
  ok('deals 13 cards to each of 4 players', state.hands.every(h => h.length === 13), state.hands.map(h => h.length));
  ok('wildRank is set and is not JOKER', state.wildRank && state.wildRank !== 'JOKER', state.wildRank);
  ok('discard pile starts with exactly 1 card', state.discardPile.length === 1);
  const totalAccounted = state.hands.reduce((s, h) => s + h.length, 0) + 1 /*indicator*/ + state.closedDeck.length + state.discardPile.length;
  ok('every one of the 108 cards is accounted for', totalAccounted === 108, totalAccounted);
}
{
  const state2 = RummyRules.dealNewRound(2);
  ok('deals 13 cards to each of 2 players', state2.hands.every(h => h.length === 13), state2.hands.map(h => h.length));
}

// --- Bot decisions on a real dealt hand (smoke test, no exceptions, sane output) ---
{
  const state = RummyRules.dealNewRound(4);
  const hand = state.hands[1];
  const discardTop = state.discardPile[state.discardPile.length - 1];
  const src = RummyRules.botChooseDrawSource(hand, discardTop, state.wildRank);
  ok('botChooseDrawSource returns a valid source', src === 'discard' || src === 'closed', src);

  const hand14 = hand.concat([state.closedDeck[state.closedDeck.length - 1]]);
  const idx = RummyRules.botChooseDiscardIndex(hand14, state.wildRank);
  ok('botChooseDiscardIndex returns an in-range index', idx >= 0 && idx < 14, idx);
}

// --- Randomized stress test: many real deals, verify no exceptions and internal consistency ---
{
  let ranOk = true;
  let checkedDeclareShape = 0;
  for (let trial = 0; trial < 25; trial++) {
    const state = RummyRules.dealNewRound(4);
    for (let p = 0; p < 4; p++) {
      try {
        const g = RummyRules.computeBestGrouping(state.hands[p], state.wildRank);
        const covered = new Set();
        g.chosenMelds.forEach(m => m.indices.forEach(i => covered.add(i)));
        g.ungroupedIndices.forEach(i => covered.add(i));
        if (covered.size !== 13) { ranOk = false; console.log('partition mismatch', covered.size); }
        if (g.deadwood < 0 || g.deadwood > 80) { ranOk = false; console.log('deadwood out of range', g.deadwood); }

        const declareCheck = RummyRules.isValidDeclare(state.hands[p], state.wildRank);
        if (declareCheck) checkedDeclareShape++;
        if (declareCheck && g.deadwood !== 0) { ranOk = false; console.log('declared hand should have 0 deadwood', g.deadwood); }
      } catch (e) {
        ranOk = false;
        console.log('EXCEPTION during stress test:', e.message);
      }
    }
  }
  ok('25 random 4-player deals (100 hands) process without exceptions and stay internally consistent', ranOk);
  console.log(`  (info: ${checkedDeclareShape} of 100 random freshly-dealt hands happened to already be valid declares, as expected this should be rare/zero)`);
}


// --- findDeclareOption on a 14-card hand --------------------------------
{
  let uid2 = 1000;
  function d(rank, suit) { return { id: 'd' + uid2++, rank, suit }; }
  const hand14 = [
    d('4','♠'), d('5','♠'), d('6','♠'),
    d('9','♥'), d('10','♥'), d('J','♥'),
    d('7','♦'), d('7','♣'), d('7','♠'),
    d('Q','♥'), d('Q','♦'), d('Q','♣'), d('Q','♠'),
    d('2','♦'), // the 14th card — no valid declare includes this one
  ];
  const option = RummyRules.findDeclareOption(hand14, 'K');
  ok('findDeclareOption finds the 14th (extra) card to remove', option !== null && option.removeIndex === 13, option);
}
{
  // no valid declare exists among any of the 14 removals
  let uid3 = 2000;
  function d(rank, suit) { return { id: 'e' + uid3++, rank, suit }; }
  const hand14 = [
    d('2','♠'), d('4','♥'), d('6','♦'), d('8','♣'), d('10','♠'), d('Q','♥'),
    d('3','♠'), d('5','♥'), d('7','♦'), d('9','♣'), d('J','♠'), d('K','♥'), d('A','♦'), d('A','♣'),
  ];
  const option = RummyRules.findDeclareOption(hand14, '9');
  ok('findDeclareOption correctly returns null for an unwinnable hand', option === null, option);
}

// --- performance: computeBestGrouping must stay fast enough for UI use ---
{
  const state = RummyRules.dealNewRound(4);
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    RummyRules.computeBestGrouping(state.hands[0].concat([state.closedDeck[0]]), state.wildRank); // 14-card
  }
  const elapsedMs = Date.now() - t0;
  ok(`computeBestGrouping on a 14-card hand: 20 runs took ${elapsedMs}ms (want well under 2000ms)`, elapsedMs < 2000, elapsedMs);
}

// --- Pool Rummy: elimination bookkeeping --------------------------------
{
  const players = RummyRules.createPoolPlayers(['You', 'Jilna', 'Ravi', 'Sana']);
  ok('createPoolPlayers starts everyone at 0, not eliminated', players.every(p => p.cumulative === 0 && !p.eliminated), players);
}
{
  // Below the cap: accumulates but nobody's eliminated yet.
  let players = RummyRules.createPoolPlayers(['You', 'Jilna', 'Ravi', 'Sana']);
  players = RummyRules.applyPoolHandResult(players, [0, 40, 25, 10], 101);
  ok('sub-cap points accumulate without eliminating anyone', players.every(p => !p.eliminated) && players[1].cumulative === 40, players);
}
{
  // At or over the cap: eliminated. Real rule is >= the limit, not just >.
  let players = RummyRules.createPoolPlayers(['You', 'Jilna', 'Ravi', 'Sana']);
  players = RummyRules.applyPoolHandResult(players, [0, 101, 80, 50], 101);
  ok('a score landing exactly on the cap eliminates (>=, not just >)', players[1].eliminated === true, players[1]);
  ok('a score under the cap does not eliminate', players[3].eliminated === false, players[3]);
}
{
  // Multi-hand accumulation across separate applyPoolHandResult calls.
  let players = RummyRules.createPoolPlayers(['You', 'Jilna']);
  players = RummyRules.applyPoolHandResult(players, [0, 60], 101);
  players = RummyRules.applyPoolHandResult(players, [30, 0], 101);
  players = RummyRules.applyPoolHandResult(players, [0, 45], 101);
  ok('points accumulate correctly across multiple hands', players[1].cumulative === 105 && players[1].eliminated, players);
  ok('a player who never crossed the cap keeps their own running total', players[0].cumulative === 30 && !players[0].eliminated, players[0]);
}
{
  // Once eliminated, further hand results for that seat are ignored (they
  // didn't play) rather than accumulating further or un-eliminating them.
  let players = RummyRules.createPoolPlayers(['You', 'Jilna']);
  players = RummyRules.applyPoolHandResult(players, [0, 101], 101);
  players = RummyRules.applyPoolHandResult(players, [0, 999], 101); // should be ignored/impossible in practice, but must stay safe
  ok('an eliminated player is frozen at their elimination score', players[1].cumulative === 101 && players[1].eliminated, players[1]);
}
{
  const players = RummyRules.createPoolPlayers(['You', 'Jilna', 'Ravi']);
  ok('a fresh pool with everyone active is not over', !RummyRules.isPoolOver(players));
  const afterOneLeft = [
    { idx: 0, name: 'You', cumulative: 0, eliminated: false },
    { idx: 1, name: 'Jilna', cumulative: 120, eliminated: true },
    { idx: 2, name: 'Ravi', cumulative: 150, eliminated: true },
  ];
  ok('a pool with only one active player left is over', RummyRules.isPoolOver(afterOneLeft));
  ok('activePoolPlayers returns exactly the non-eliminated ones', RummyRules.activePoolPlayers(afterOneLeft).length === 1 && RummyRules.activePoolPlayers(afterOneLeft)[0].name === 'You');
}
{
  // firstActiveFrom must skip eliminated seats and wrap around correctly.
  const players = [
    { idx: 0, name: 'A', cumulative: 0, eliminated: false },
    { idx: 1, name: 'B', cumulative: 0, eliminated: true },
    { idx: 2, name: 'C', cumulative: 0, eliminated: true },
    { idx: 3, name: 'D', cumulative: 0, eliminated: false },
  ];
  ok('firstActiveFrom skips an eliminated seat', RummyRules.firstActiveFrom(1, 4, players) === 3, RummyRules.firstActiveFrom(1, 4, players));
  ok('firstActiveFrom wraps around past the end', RummyRules.firstActiveFrom(2, 4, players) === 3, RummyRules.firstActiveFrom(2, 4, players));
  ok('firstActiveFrom returns the seat itself when it is already active', RummyRules.firstActiveFrom(0, 4, players) === 0);
  const allEliminatedButOne = [
    { idx: 0, name: 'A', cumulative: 0, eliminated: true },
    { idx: 1, name: 'B', cumulative: 0, eliminated: true },
    { idx: 2, name: 'C', cumulative: 0, eliminated: false },
  ];
  ok('firstActiveFrom finds the sole survivor regardless of start position', RummyRules.firstActiveFrom(0, 3, allEliminatedButOne) === 2);
}
{
  // Simulate a realistic short pool end-to-end using only the bookkeeping
  // helpers (no card dealing needed) to confirm the whole lifecycle is
  // internally consistent: accumulate -> eliminate -> continue among the
  // rest -> stop at exactly one survivor. Hand data below is hand-verified
  // arithmetic (each player's own running total), not just plausible-looking
  // numbers.
  let players = RummyRules.createPoolPlayers(['You', 'Jilna', 'Ravi', 'Sana']);
  const hands = [
    [20, 0, 15, 25],   // Jilna wins hand 1 -> cum: You20  Jilna0   Ravi15  Sana25
    [30, 40, 0, 35],   // Ravi wins hand 2  -> cum: You50  Jilna40  Ravi15  Sana60
    [0, 65, 20, 35],   // You win hand 3    -> cum: You50  Jilna105 Ravi35  Sana95   (Jilna eliminated, 3 active remain)
    [60, 0, 0, 15],    // Ravi wins hand 4  -> cum: You110 Jilna—   Ravi35  Sana110  (You AND Sana eliminated, 1 active remains)
  ];
  let handsPlayed = 0;
  while (!RummyRules.isPoolOver(players) && handsPlayed < hands.length) {
    players = RummyRules.applyPoolHandResult(players, hands[handsPlayed], 101);
    handsPlayed++;
  }
  ok('simulated pool played all 4 scripted hands before resolving', handsPlayed === 4, handsPlayed);
  ok('simulated pool eliminates Jilna once her cumulative crosses 101 (hand 3)', players[1].eliminated && players[1].cumulative === 105, players[1]);
  ok('simulated pool ends with exactly one survivor (Ravi)', RummyRules.isPoolOver(players) && RummyRules.activePoolPlayers(players).length === 1 && RummyRules.activePoolPlayers(players)[0].name === 'Ravi', players);
  ok('the survivor\'s own cumulative score is preserved correctly', players[2].cumulative === 35, players[2]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
