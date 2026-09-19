# ludoPWA

A Ludo (board game) PWA with a real multiplayer backend. `design/` is the client (static
HTML/CSS/JS, deployed to GitHub Pages); `server/` is an authoritative Colyseus match server backed
by a Supabase project for auth/wallet-ledger/match-history.

## Working conventions

- **Never use the Artifact tool for anything in this project — including design mockups meant
  only for discussion, before any real change.** Explicit user preference. A mockup/prototype is a
  real file committed to `design/` (a standalone page, not wired into the app's navigation or
  data — the same pattern `rummy-lobby.html`/`rummy-board.html` themselves started as, per their
  entry below) and shipped through the normal branch → PR → merge → GitHub Pages flow like
  everything else, so it's reachable by a real URL the user can open on their own phone, not a
  claude.ai artifact link.

## Structure

- `design/styles.css` — shared stylesheet for every page. `html, body` sets
  `touch-action: pan-x pan-y` to block pinch-zoom — deliberately in CSS, not just the viewport
  meta tag every page also sets (`maximum-scale=1.0, minimum-scale=1.0, user-scalable=no`), since
  modern iOS Safari ignores that meta tag for accessibility reasons and still allows pinch-zoom
  without this; `touch-action` is enforced at the touch-input level regardless, and normal
  scrolling is unaffected since pan-x/pan-y stay allowed, only the zoom gesture is excluded.
- `design/game.js` — client rendering + the Colyseus connection (see "Client" below). No longer
  contains game rules — those live server-side now.
- `design/supabase-client.js` — shared Supabase client (publishable key, safe to expose; RLS is
  what actually protects data), plus shared helpers used by every page that shows real match/stat
  data: `ludoTimeAgo` (relative time strings), `ludoFetchStats` (games/wins/win-rate from
  `match_players`), `ludoFetchMatches` (a user's finished matches, newest first — opponent names
  are deliberately left out since `profiles`' RLS only allows reading your own row, so other
  players' `display_name` isn't resolvable client-side as things stand), and
  `ludoFetchPlayerCounts` (reconstructs each match's payout, since player count per match isn't
  stored directly), and `ludoIsAdmin` (checks `profiles.is_admin`). Loaded by every page under
  auth: `lobby.html`, `profile.html`, `history.html`, `wallet.html`, `waiting-room.html`,
  `board.html`, `admin.html`.
- `design/login.html` — real Supabase Auth (email/password signup+login only — the magic-link
  option was removed; it redirected to whatever the project's Auth → URL Configuration Site URL
  is set to, which is a stale `localhost` address, and fixing that is a dashboard/Management-API
  setting outside what this session's Supabase MCP tools can read or write, same root cause as
  the note below). Routes to `admin.html` instead of `lobby.html` after signing in if
  `ludoIsAdmin` is true. Has a "Forgot password?" button (`auth.resetPasswordForEmail`,
  `redirectTo` computed as `reset-password.html` relative to the current origin so it works both
  on GitHub Pages and local dev) — **the project's Auth → URL Configuration allowlist needs
  `reset-password.html` (or a wildcard covering it) added, or Supabase silently redirects to
  that same stale Site URL instead of landing there; not something settable via the MCP tools
  available in this session, only the dashboard or Management API.**
- `design/reset-password.html` — where the emailed reset link lands. supabase-js auto-detects the
  recovery token in the URL and establishes a session; no session means an invalid/expired link
  (shown as such, with a link back to `login.html`), not a form. On success, routes the same way
  `login.html` does (`admin.html` vs `lobby.html` via `ludoIsAdmin`).
- `design/admin.html` — same login form, no separate admin login page. Auth-guarded (redirects
  non-admins to `lobby.html`, not just non-signed-in visitors to `login.html`) dashboard: platform
  stats (`get_platform_stats()` RPC), every user with their real wallet balance and games/wins
  (plus an inline balance-adjustment form calling `admin_adjust_wallet_balance()`), and every
  match with its resolved winner name. See "Admin" under Backend for the RLS/RPC design.
- `design/lobby.html`, `profile.html`, `history.html`, `wallet.html` — all require a real session
  (redirect to `login.html` otherwise — `profile.html`/`history.html`/`wallet.html` had NO auth
  guard at all before this was fixed) and show real data: signed-in name/email, real wallet
  balance, real games-played/wins/win-rate, real per-match results (via the `supabase-client.js`
  helpers above), and a real merged transaction list on `wallet.html` (match stakes/winnings +
  real USDT deposits, time-sorted together — see "Crypto deposits" below; no more mock/fabricated
  entries in that list). `wallet.html`'s Deposit panel is a real USDT (TRC-20) address + QR code
  (fetched from the game server, not the Colyseus WS connection — see "Crypto deposits"); Withdraw
  is still the explicitly-labeled "Mock gateway" demo UI (deposits only so far, on purpose — see
  "Crypto deposits"). `profile.html`'s Log Out now actually calls `auth.signOut()` (it previously
  just navigated away, leaving the session live). The fake "✓ Verified"/"Identity Verification
  (KYC)" badges on `profile.html` were removed rather than left fabricated — no such feature
  exists anywhere in the schema or backend. `profile.html` also has a Change Password panel
  (`auth.updateUser({password})`) — works for any signed-in user, admin or not, since it's the
  same page for everyone.
- `design/stake-confirm.html` — real 2/4-player table-size picker, forwards the choice via
  `?players=` through to `waiting-room.html`. Every lobby entry point (Cash Tables, Quick Match,
  Create Room, Join Room) routes through it — none of them skip straight to `waiting-room.html`.
- `design/waiting-room.html` — joins the real Colyseus room immediately (real Supabase Auth
  session required, same as `board.html`) and renders the live player list off `room.state`
  (names, colors, connected/waiting status) — no longer a static mockup. Once every seat is
  connected it hands its live connection off to `board.html` via `room.reconnectionToken`
  (stashed in `sessionStorage`) instead of a fresh `joinOrCreate`, which would otherwise double
  up on the same room; `board.html` resumes with `client.reconnect()` and retries a few times
  since there's no hard ordering guarantee that the server's finished processing the handoff
  leave before the resume attempt lands (a bare single attempt measurably races and fails).
- `design/board.html` — the actual game; loads `game.js`, `supabase-client.js`, and the
  `colyseus.js` client SDK from CDN.
- `design/rummy-rules.js` — a standalone, dependency-free Rummy rules engine (UMD-wrapped: a
  `window.RummyRules` global in the browser, `module.exports` under Node, so it's unit-testable
  outside a browser too). Implements real Indian/Points Rummy: a 2-deck + 4-printed-joker 108-card
  pack, a randomly-drawn wild-joker rank each round (any suit, plus the printed jokers), meld
  detection (pure sequences, wild-completed sequences, sets — with Ace-low **and** Ace-high
  sequences supported, e.g. both `A-2-3` and `Q-K-A`, but never the `K-A-2` wrap-around), full
  13-card declare validation (exact-cover backtracking requiring the real rule: all cards grouped
  with zero leftover, ≥2 sequences, ≥1 of them pure), and loser scoring via a bitmask DP
  (`computeBestGrouping`) that maximizes points removed subject to needing a pure sequence to
  count for anything — a hand with no achievable pure sequence takes the flat 80-point "full
  count" penalty regardless of what its cards actually add up to (a real rule, and a bug this
  session's own tests caught: an early draft capped the penalty at the hand's own total instead of
  the flat 80). Also caps deadwood at 80 even *with* a pure sequence secured (a cheap pure
  sequence can still leave 80+ points of expensive cards ungrouped — another bug the randomized
  stress test below caught). Since a card matching the wild rank is ambiguous — usable at face
  value *or* as a substitute — meld detection branches over every such card's two interpretations
  rather than assuming one. Also carries the **Pool Rummy** bookkeeping layer (see the
  `rummy-board.html` entry below for the gameplay side): `POOL_SIZES` (`[51, 101, 201]`),
  `createPoolPlayers`/`applyPoolHandResult`/`activePoolPlayers`/`isPoolOver` for cumulative
  scoring and elimination across several hands (a loser's points accumulate hand over hand;
  reaching/crossing the pool cap — `cumulative >= poolLimit`, not `>`, matching the real rule —
  eliminates that seat; last one active takes the entry-fee pot), and `firstActiveFrom(start,
  count, poolPlayers)` to pick the next non-eliminated seat both for who opens each hand and for
  turn order, wrapping around and skipping eliminated seats without needing to resize/reindex the
  players array mid-pool. Deliberately not modeled: real-platform re-entry/second-chance rules.
  **Verified with 48 automated tests** (`node design/rummy-rules.test.js` — no browser needed):
  known pure/impure/Ace-edge sequences and sets, a full valid 13-card winning hand, hands that
  fail for each real reason (only 1 sequence, zero sequences, two sequences neither pure, an
  ungroupable leftover card), deadwood math against hand-computed expected values, `dealNewRound`
  accounting for all 108 cards, a 25-round (100-hand) randomized stress test asserting every
  grouping partitions its hand exactly once with no gaps/overlaps and deadwood always lands in
  `[0, 80]` — this test is what caught both scoring bugs above — and 18 Pool-specific tests
  (accumulation, the `>=` elimination threshold, an eliminated seat's score freezing regardless of
  further hand results, `firstActiveFrom` skipping/wrapping correctly including down to a sole
  survivor, and a hand-verified 4-hand simulated pool lifecycle reaching exactly one survivor).
  Performance: ~7ms per `computeBestGrouping` call on a 14-card hand in Node, comfortably fast
  enough to run on every hand change in the browser.
- `design/rummy-lobby.html` + `design/rummy-board.html` — a **playable practice table**, with
  two selectable game modes (**Points Rummy** and **Pool Rummy**): real Rummy rules (via
  `rummy-rules.js`) against simple computer opponents, entirely client-side, no
  backend/Colyseus/Supabase involved and no real money at stake — built this way specifically so
  the rules could be verified by actually playing, rather than trusting an unplayed mockup or a
  rules explanation. A yellow banner and a "practice only, nothing touches your real wallet" note
  in the results modal(s) keep this honest on-page. Reachable from `lobby.html` via an "Other
  Games" section (a single `tile-wide` linking to `rummy-lobby.html`, reusing the same
  `.tile`/`tile-join` pattern as the "Join with code" tile above it) — this was missing for a
  while after gameplay was added (the pages started as unlinked design mockups reachable only by
  direct URL, and stayed that way past the point where that stopped making sense once they became
  a real playable feature); the wallet chip stays a static demo figure (₹250.00) since no real
  balance is touched.
  - `rummy-lobby.html`: a `.mode-picker` toggle switches between the two modes' pickers (only one
    section visible at a time, both built from the same `.tile`/`.action-grid` chrome as the rest
    of the app). **Points Rummy**: points-value picker (₹1/₹2/₹5 per point). **Pool Rummy**: a
    pool-size picker (51/101/201 — `RummyRules.POOL_SIZES`) and an entry-fee picker (₹50/₹100/₹200
    — each player's fixed buy-in into the pot, unrelated to per-hand scoring). Both modes share a
    2/4-player table-size picker (not 2/6 as originally mocked up — `rummy-board.html`'s felt
    template only has 3 opponent slots, so 4 total players is the real ceiling) and a live-updating
    summary card (max-loss-per-round for Points; pool size/entry/total pot for Pool). "Start Table"
    links to `rummy-board.html?mode=points&players=&value=` or
    `rummy-board.html?mode=pool&players=&pool=&entry=` depending on the toggle (`rummy-board.html`
    defaults to Points / 4 players / ₹1 if loaded without any params at all).
  - `rummy-board.html`'s **shared turn loop** (identical for both modes — the mode only changes
    what happens once a hand ends): `RummyRules.dealNewRound(playerCount)` deals 13 cards each;
    you draw (closed deck or discard pile), then Discard or Declare; bots (`Jilna`/`Ravi`/`Sana`,
    or just `Ravi` in 2-player mode) take their turns automatically on a short delay (`?fast=1`
    collapses this to ~15ms, used only by automated tests) using `botChooseDrawSource`/
    `botChooseDiscardIndex`/`findDeclareOption` from the rules engine, looping until control
    returns to you or someone declares. A `turnToken` counter is bumped on every new hand and
    checked inside the async bot loop so dealing a fresh hand cancels any still-running bot-turn
    loop from the previous one instead of two hands' timers racing. `advanceTurn()`/`pickStarter()`
    branch on mode: Points Rummy just does `(currentPlayerIdx + 1) % playerCount` and always starts
    with you (a deliberate simplification — real Rummy rotates the dealer); Pool Rummy instead uses
    `RummyRules.firstActiveFrom` so eliminated seats are transparently skipped in turn order — no
    other turn-loop code needed to know or care that a seat is out.
  - **Your hand is always auto-arranged, not just sorted**: every hand mutation (draw, discard, a
    fresh deal) calls `arrangeHand()`, which runs `computeBestGrouping` and reorders the hand into
    its best-found groups — pure sequences first, then other sequences, then sets, then deadwood
    — with a colored border per card (green/blue/purple/red respectively) and a small legend, plus
    a gold ring + ★ badge on any card matching the wild rank (it can be played at face value *or*
    as a substitute). This turns the hand display into a rules trainer: a player who doesn't know
    the rules can still see which of their cards go together without being told. A hint line above
    the hand reports the live deadwood total or "✓ Ready to declare!". Card selection is tracked
    by the card's own `id` (not its array index), specifically because re-arranging after every
    mutation would otherwise silently move whatever the player had selected onto a different card
    at the same index.
  - **The card you just drew gets its own highlight**, separate from the meld-color rings and the
    selected/`lifted` state — reported as confusing ("which card did I just get?") since a draw
    immediately re-arranges the whole hand into its best grouping, so the new card can land
    anywhere and visually blend into whichever group it joined. `lastDrawnCardId` (tracked by id,
    same reasoning as `selectedCardId` above) is set in `drawFor0()` right when the card is pushed
    into `state.hands[0]`, and `renderHand()` adds a `.just-drawn` class to that card wherever
    `arrangeHand()` placed it. Deliberately an `outline` rather than another `box-shadow` variant:
    every meld-color ring (`.meld-pure`/`.meld-seq`/`.meld-set`/`.deadwood`/`.wild-rank`) already
    works by fully replacing `box-shadow` on that shared class combo, so a same-mechanism
    "just drawn" ring would just get overridden by whichever meld color also applies — `outline`
    is a separate rendering layer that always shows regardless. Cleared (`lastDrawnCardId = null`)
    on discard and on a fresh deal, so it only lingers for the actual window it's useful: after a
    draw, until you've decided what to do with it — clicking around to inspect other cards first
    doesn't clear it. A brief `outline-width` pulse (2 iterations, ~2s) draws the eye to it, then
    it settles into a steady ring rather than fading away while the player's still deciding.
  - **The hand can also be manually reordered by drag**, on top of the auto-arrange — a player
    asked for this specifically so cards they'd already mentally grouped (e.g. a natural low-high
    run) could be laid out in their own preferred order rather than whatever `arrangeHand()`
    picked. Implemented with pointer events (`pointerdown`/`pointermove`/`pointerup` on
    `document`, not native HTML5 drag-and-drop, which doesn't support touch) so it works with a
    finger on the phone-width layout this app targets, not just a mouse. A `DRAG_THRESHOLD_PX`
    (8px) gate distinguishes a real drag from a plain tap — same pointerdown/up pair, decided only
    once the pointer lifts by how far it actually moved — so tap-to-select-for-discard keeps
    working unchanged as its own `click` listener; a real drag doesn't rebuild the DOM mid-gesture
    (the dragged card just gets a live `transform: translate(...)`, tracked via `findHoverIndex`'s
    nearest-card-center search over every `.pcard` on each `pointermove`), so the same element
    keeps receiving events for the whole gesture, and only on release does `state.hands[0]`
    actually get spliced into the new order. `retagHandInPlace()` (a sibling of `arrangeHand()`,
    sharing its grouping search via `computeMeldsSorted()`) recomputes each card's meld-color tag
    for whatever order the drop just produced, *without* re-sorting the array back into group
    order — reordering never changes which cards are melded together or the hand's deadwood total
    (`computeBestGrouping` works over the card set, not its order), so this can never disagree
    with what `arrangeHand()` itself would have found. The "↕ Arrange" button still calls the
    original `arrangeHand()` via `renderAll()` unchanged, so it now doubles as "reset to
    auto-order" after a manual drag. **A real bug caught while wiring this up**: a drag's release
    sometimes still triggers the browser's own trailing `click` event (which would otherwise
    re-toggle discard-selection right after a reorder) — a `suppressNextClick` flag swallows that
    one click, but a first version reset it on a fixed `setTimeout`, which raced: this drag's own
    `pointerup` handler rebuilds the hand's DOM synchronously (removing the dragged element)
    *before* the browser gets to dispatch that trailing click, so it often never arrives at all —
    leaving the flag `true` for up to 300ms and silently swallowing the *next*, entirely unrelated
    tap if it landed in that window. Caught by a scripted real-pointer-event test (drag, then
    immediately tap a different card) rather than by reasoning about the timing on paper. Fixed by
    resetting the flag at the start of every new `pointerdown` instead of on a timer — a truly new
    gesture is then never affected by a leftover flag from a previous one, however long ago.
    Verified with real `page.mouse` pointer sequences (not the FAST-mode `?fast=1` test suite,
    which selects cards via a raw DOM `.click()` call and doesn't exercise the drag path at all):
    dragging a card to a new position, a plain tap still selecting for discard afterward, and
    dragging an already-selected card elsewhere not accidentally deselecting it. Confirmed the
    full existing points/pool e2e regression suite (which does rely on that raw `.click()` path)
    still passes unchanged, since the drag layer is additive to the existing `click` listener
    rather than a replacement for it.
  - **The drag also live-highlights whichever card's spot you're about to take**, not just
    snapping into place on drop — reported as needed since dropping blind (no feedback until
    release) made it hard to tell where a card would actually land mid-gesture.
    `findHoverIndex()` (already computing `dragCtx.hoverIndex` every `pointermove` for the drop
    itself) now also returns that index's element, and a `.drag-target` class is added/removed on
    it as the hovered card changes — diffed against the *previous* hover index first, so the class
    only actually toggles when the target genuinely changes, not on every single pixel of pointer
    movement. Deliberately a `filter: drop-shadow(...)` glow rather than another `box-shadow` or
    `outline` variant: `box-shadow` is already fully claimed by the meld-color rings (each class
    combo replaces it outright, so a drag-target ring in that same mechanism would just get
    overridden by whichever meld color a card also has) and `outline` is already claimed by the
    just-drawn highlight — `filter` is a wholly separate rendering layer, so it always shows
    regardless of what else is going on with that card. No native/two hand-drawn "gap" indicator
    between cards — the glow on the target card itself is the whole indicator, kept simple since
    other cards don't visually shift out of the way until the actual drop (mid-drag reordering of
    the rest of the hand was scoped out as more complexity than the ask needed). Verified with a
    scripted drag confirming the highlight appears on the correct card as the pointer moves near
    it, moves to a new card as the pointer moves further, and clears entirely on drop — plus a
    screenshot of a real mid-drag frame showing the glow.
  - **Declare is forgiving but honest**: clicking Declare searches all 14 cards (preferring to
    keep whichever card the player tapped, if any) for a removal that makes the remaining 13 a
    valid declare (`findDeclareOption`) — the player doesn't have to manually figure out which
    card to discard to win. If no such arrangement exists, a `confirm()` dialog states plainly
    that this isn't a valid hand yet and declaring anyway costs the 80-point penalty, rather than
    silently blocking the button or silently declaring wrong.
  - **A shared `endHand()` handles every hand's conclusion** for both modes, computing
    `scoreLosers()`/the invalid-declare penalty once. **Points Rummy**: this *is* the round —
    `showPointsResultModal()` renders the final points/₹ breakdown immediately, with Play Again /
    Back to Rummy Lobby. **Pool Rummy**: the hand's points fold into `poolPlayers` via
    `RummyRules.applyPoolHandResult` (an already-eliminated seat's contribution is forced to 0,
    checked against the *pre-hand* eliminated snapshot so a seat crossing the cap on this very
    hand still counts its real points for it) and the match continues:
    - A **Pool Standings panel** (`#pool-standings`, above the felt, visible for the whole match)
      lists every player's running total and pool cap, with eliminated rows struck through — the
      one piece of UI that makes Pool Rummy's defining mechanic (accumulation + elimination)
      actually visible while playing, not just at the end.
    - If `RummyRules.isPoolOver(poolPlayers)` (exactly one seat still active), `showPoolCompleteModal()`
      shows the sole survivor, final per-player point totals, and the real payout (survivor
      `+₹(entryFee × playerCount)`, everyone else `-₹entryFee` flat — pot-based, not proportional
      to how badly they lost), with New Pool (resets `poolPlayers` fresh via
      `createPoolPlayers` and deals) / Back to Rummy Lobby.
    - Otherwise `showHandResultModal()` shows this hand's result and, if **you're** still active,
      a "Next Hand →" button; if you were just eliminated, no button — a short readable pause
      (`?fast=1`-aware, ~30ms in tests vs. 1800ms live) then auto-continues to the next hand as a
      spectator, since bot-only hands need no input from you. Once you're eliminated,
      `renderAll()` hides your entire hand/action-bar (`#hand-section-content`) behind a
      `#you-eliminated-banner` ("watching the rest play out…") instead of showing a dead, unusable
      hand — and opponent felt slots get an `.eliminated` (dimmed) treatment + an "OUT" label in
      place of their card count, driven by the same `poolPlayers[i].eliminated` flag.
  - **Deck exhaustion**: `ensureClosedDeckNotEmpty` reshuffles the discard pile (minus its top
    card) back into the closed deck whenever the closed deck runs dry — never a hard crash, since
    closed-deck-count + discard-pile-count is a fixed invariant (the 108-card pack minus the 52
    cards currently in hands and the 1 wild indicator) that can only be zero on *both* sides
    simultaneously if the whole pack were gone, which the game's flow makes impossible (every turn
    always nets exactly one card into the discard pile).
  - **Animation + sound**: shuffle/deal at the start of every hand, and every draw/discard
    (yours and every bot's) fly a card between two on-screen points instead of the state just
    snapping — plus a full synthesized sound set (shuffle riffle, deal flick, card-move flick, win
    chime, elimination tone) built the same way `design/game.js`'s dice sounds already are: plain
    Web Audio oscillators/noise bursts, no audio files.
    - `dealHand()` (now `async`) plays a ~650ms shuffle jitter (`.closed-deck.shuffling`, a CSS
      keyframe rotating/translating the card-back stack) with the shuffle sound, *then* deals —
      generic card-back clones fly from the deck **round-robin to every seat**, one card at a time
      going around the table 13 times (`playerCount * 13` flights total, `~38ms` apart, several in
      flight at once) with a deal-flick sound each — not just into your own hand while opponents'
      piles silently jump to their final count. Each opponent's mini card-back stack/count grows
      live as their cards land (`backsHtml(round + 1)` / `${round + 1} cards`, reset to 0 at the
      start of the deal); only once every seat has all 13 does your own, fully-arranged hand get
      revealed in one shot (still not animated card-by-card into its exact final post-arrangement
      slot — that part stays a reveal, not a flight). An earlier version only flew cards into your
      own hand and left opponents' piles snapping straight to their final count — reported as "the
      shuffle only shows to me," fixed by this round-robin loop.
    - `flyCard(fromEl, toEl, innerHtml, durationMs)` is the shared primitive: a temporary
      `position:fixed`, `pointer-events:none` clone (`.flying-card`) transitions from one element's
      `getBoundingClientRect()` to another's, then removes itself. Your own discard flies the real,
      face-up selected card; every other flight (draws, bot discards) flies a generic card-back,
      since the source/destination piles are already either hidden (opponents' hands) or already
      visible (the deck/discard pile itself).
    - A `uiBusy` lock guards your three action entry points (draw via deck/discard-pile click,
      Discard, Declare) against a rapid double-click firing the same action twice while its flight
      is still in progress — `phase` itself only flips *after* the animation resolves, so without
      this a second click landing mid-flight would read the still-stale `phase` and race a second
      draw/discard against the first.
    - **Everything collapses to genuinely instant under `?fast=1`** (the flag the automated test
      suite already used) — `flyCard` returns `Promise.resolve()` immediately with no DOM clone at
      all, and every `sfx*()` call no-ops. This isn't just a nice-to-have: a first attempt kept a
      fixed `durationMs + 20` `setTimeout` buffer (to let a CSS transition finish before removing
      the clone) plus a `requestAnimationFrame` hop *even under FAST*, and that alone — several
      real milliseconds of unavoidable wall-clock time per flight — was enough to break the
      existing e2e test scripts' fixed short `sleep()`-after-click margins, intermittently
      selecting/discarding a card before the draw's hand-mutation had actually landed. Caught by
      rerunning the standing test suite after adding animations (not by reasoning about the
      timings on paper) and fixed by making the FAST path skip the animation machinery outright
      rather than just shortening its duration.
    - **Shuffle sound reliably plays now, not just card-move sounds**: `getAudioCtx()` lazily
      creates and caches a single `AudioContext`, and browsers start any `AudioContext` in a
      `suspended` state until a real user gesture has happened on the page. `dealHand()` fires
      automatically on page load with no gesture behind it, so that very first shuffle's sound is
      unavoidably silent (expected, harmless — one hand's worth of silence) — but because the
      *same cached, still-suspended* context was being reused for every later shuffle too (Play
      Again / Next Hand / New Pool), and nothing ever actually resumed it, shuffle sound stayed
      silent for the rest of the session even though draw/discard sounds worked fine (those play
      from click handlers that happen to also be the moment a browser *would* auto-resume a
      context passed through `.resume()` — shuffle's own `sfxShuffle()` call had no such resume
      anywhere near it). Fixed with a one-time `pointerdown` listener on `document` that resumes
      the context on the page's first tap/click, so it's already `running` well before any
      post-load shuffle plays. Also bumped the shuffle noise bursts' `peak` gain (0.06/0.05/0.04 →
      0.09/0.08/0.07) so it's clearly audible against the (louder) card-move sounds rather than
      easy to miss as "no sound" even once it was actually playing.
    - A `trophy-bounce` CSS keyframe (scale+rotate+fade-in, `.5s`) on the modal's icon runs on
      every result modal (win, invalid-declare, pool-complete) for a bit of impact on the moment a
      hand/pool concludes.
    - Verified in real (non-`?fast=1`) headless Chromium: screenshotted the shuffle jitter, the
      deal (multiple card-backs genuinely mid-flight at once), a real face-up card mid-flight on
      your own discard, a bot's flight to/from its felt slot, and the settled win modal with the
      trophy-bounce class applied — zero page/console errors in every run. Also timed a bot's full
      turn end-to-end in real mode (~1.8–2s: two `STEP_MS` pauses plus two ~280ms flights, matching
      the constants exactly) to confirm consecutive bot turns were genuinely progressing and not
      stalled — an earlier debugging pass mistook this for a stuck game purely because a test
      script's own "unchanged status text" stall-detector fired before a bot's turn had had time to
      naturally complete.
  - **Bug caught building Pool Rummy**: the "Last hand: …" line in the pool-complete modal stripped
    the leading trophy/cross emoji with `headline.replace(/^[🏆❌]\s*/, '')` — a regex *character
    class* containing multi-code-unit emoji without the `u` flag splits each into its separate
    surrogate units, so the class only ever matched half of one, corrupting the string into `�` at
    render time in every real browser run. Fixed by switching to an alternation
    (`/^(🏆|❌)\s*/`), which matches each emoji as a whole literal substring regardless of the `u`
    flag — caught by actually reading a real Chromium-rendered playthrough's text, not by the
    regex looking reasonable in isolation.
  - **Verified end-to-end in real headless Chromium**, not just unit-tested. Points Rummy: scripted
    full playthroughs (`?fast=1`) in both 4-player and 2-player mode, each running until the
    round-end modal opens, checking the score-row math sums correctly against the displayed payout
    and that "Play Again" deals a genuinely fresh round (reset deck count, hand size); a dedicated
    run forcing the "declare anyway?" invalid-declare path end-to-end including the confirm()
    dialog; repeated runs (10+) with zero console/page errors and turn counts varying naturally (4
    to 70+) confirming the bots aren't stuck in a fixed pattern. Pool Rummy: scripted full pools
    (4-player and 2-player, 51-point cap for a fast-resolving test) played hand-by-hand to actual
    completion multiple times — confirming the standings panel updates correctly each hand, a
    seat's cumulative score freezes exactly at its elimination hand and matches the engine's own
    unit-tested math, the "Next Hand"/spectator-auto-continue branching triggers correctly
    depending on whether seat 0 is still active, the pool always resolves to exactly one survivor
    with correct final pot payouts — 2-player pools always end the instant either seat crosses the
    cap (the only possible outcome once one of two seats is eliminated), but *how many hands* that
    takes varies with the actual scores and isn't always 1; an earlier version of this note
    over-claimed "resolves in exactly 1 hand" from only having observed short runs — a later run
    legitimately took 40+ hands without either side crossing 51, which turned out to be real
    variance (confirmed by watching cumulative scores keep climbing over more hands, not a stuck
    game) rather than a bug — and "New Pool" genuinely resets cumulative
    scores/elimination state before dealing again; a dedicated repeated-seed run specifically to
    capture the "you're eliminated, mid-pool" spectator banner and confirm the eliminated felt
    slot's dimmed/"OUT" treatment renders correctly. No horizontal overflow at 390/420px in any
    mode/player-count combination tested. Page-scoped CSS for the card/felt rendering lives in each
    file's own
    `<style>` block rather than `styles.css`, since a playing-card table shares little visually
    with the Ludo board grid. **Fixed while building this** (from the earlier mockup phase, still
    true): `.rummy-page`
  (`rummy-board.html`) originally had only `max-width:720px; margin:0 auto;` with no explicit
  `width` — since it's a flex item of `.app` (`display:flex; flex-direction:column`), the auto
  side-margins disable flexbox's default cross-axis stretch (per spec, auto margins on a flex
  item's cross axis override `align-items:stretch`), so it was shrink-to-fitting to its widest
  child's content instead of the viewport — overflowing the page horizontally on mobile. Fixed by
  adding an explicit `width:100%` (plus `box-sizing:border-box` for the padding), verified by
  measuring `document.body.scrollWidth` against `window.innerWidth` before/after in a real
  headless-Chromium run at 390px and 420px widths (390/420 clean after the fix, was 502 before) —
  this exact shrink-to-fit trap doesn't affect any other page in the app, since no other page
  combines a flex `.app` ancestor with an unconstrained-width block using `margin:0 auto`
  centering. **The hand itself renders as two explicit rows, not one horizontally-scrolling
  row**: it originally used a single `overflow-x:auto` flex row (matching `.players-panel`'s
  established scroll-strip pattern elsewhere in the app), but for a 13-14 card rummy hand that
  hid roughly half the hand off-screen behind a scroll gesture — fine for a strip of player
  avatars, not for cards the player needs to see all of at once to plan a discard. `renderHand()`
  now splits `hand` into two roughly-even halves (`Math.ceil(hand.length / 2)` so an odd count
  puts the extra card on top, e.g. 7/6 for 13 cards) and renders each half as its own `.hand-line`
  flex row with its own independent overlap (`margin-left:-14px`, reset to 0 on each line's own
  first card — letting the CSS wrap a single flex row instead would overlap the first card of
  row 2 under the last card of row 1, since the negative margin doesn't know a wrap happened).
  Group gaps and click-to-select indices are computed per-line but still index into the flat
  `hand` array correctly (`lineOffset + j`). Re-splits automatically on every re-render, so
  drawing a 14th card rebalances to 7/7 rather than leaving a lopsided 7/7-turned-8/6. Verified in
  a real headless-Chromium run: no horizontal overflow at 390px, correct 7/6 → 7/7 split across a
  draw, and selecting a card in the second row still lifts the right one.
- `design/rummy-board-landscape-mockup.html` — a **standalone visual mockup**, not wired into the
  app (no `game.js`/`rummy-rules.js`/real state — hardcoded example hand/opponents/deck), proposing
  a landscape-orientation table layout (a player suggested something closer to how RummyCircle's
  own landscape table looks) for discussion before touching `rummy-board.html` for real. Reuses
  `styles.css`'s color tokens and the existing `.pcard`/`.card-back` visual language so it reads as
  a real variant of this app rather than a generic wireframe, but is otherwise self-contained.
  Shows a phone-frame preview at any viewport size, and a "rotate your phone" prompt in an actual
  portrait viewport (`@media (orientation: portrait)`) so the layout it's proposing is only ever
  seen the way it's meant to be seen. Key layout decisions it's proposing, for discussion: opponents
  move from a `players-panel` scroll-strip (portrait) to a slim always-visible row across the top;
  the hand renders as a single row of large cards instead of the portrait two-row split (landscape
  width easily fits all 13-14 overlapped big cards without wrapping); and the action buttons
  (Arrange/Discard/Declare) move from a full-width bar under the hand to a slim column docked
  beside it, since landscape has width to spare but very little height. Deliberately not linked
  from anywhere in the live app's navigation — reachable only by direct URL, the same way
  `rummy-lobby.html`/`rummy-board.html` themselves started out (see their own entries above) —
  since it's a conversation piece, not a shipped feature.
- `design/index.html` — no longer the design-mockup index (removed); a silent redirect stub to
  `login.html`, since GitHub Pages serves `index.html` for the bare site root regardless of what
  `manifest.json` says.
- `design/manifest.json` + `design/icons/` — PWA manifest and app icons (installable to a phone
  home screen). `start_url` is `login.html`, not `index.html`.
- `server/` — the Colyseus + Supabase-persistence backend (see `server/README.md`).
- `.github/workflows/pages.yml` — deploys `design/` to GitHub Pages on every push to `main`.
  Live at https://codesbaylab.github.io/ludo/ (client only — see "Running the backend" below for
  why multiplayer won't actually work there without a running server).

## Client (`design/game.js`)

Purely a renderer + network client now — **all game rules moved server-side** (`server/src/rules.ts`
+ `server/src/rooms/LudoRoom.ts`). `game.js` still owns:
- Grid/board rendering, the 3D dice cube visual + synthesized Web Audio sounds, `RING`/`COLORS`/
  `coordFor` (grid-coordinate math only — the server doesn't know or care about (row,col), just
  abstract ring positions).
- Connecting to the Colyseus room (`ws://localhost:2567` by default; override with `?server=`),
  Supabase Auth session lookup (redirects to `login.html` if missing), and rendering off
  `room.state.toJSON()` snapshots — it diffs the previous vs. new snapshot per token to decide
  which cosmetic effect to play (hop, capture flash, dice spin), then re-renders everything from
  the new snapshot. It never mutates game state locally.
- Sending `room.send('roll')` / `room.send('selectToken', {tokenIndex})` — that's the entire
  client -> server API surface now.
- A cosmetic 15s countdown that mirrors the server's real auto-roll/auto-pick timeout (see
  `LudoRoom`) — purely decorative, the client is never trusted to enforce it.
- Auto-reconnect on a dropped connection: `room.onLeave` distinguishes an intentional
  `room.leave()` (Colyseus close code 4000/CONSENTED — no retry) from anything else, and retries
  `client.reconnect(room.reconnectionToken)` every 3s for up to 20 attempts, matching the
  server's reconnection grace window (see `LudoRoom` below) instead of just showing a dead-end
  "Disconnected" message.
- **Per-cell move animation restored**: the server only ever sends a token's final resting
  position (it has no notion of "board cells", just an abstract path index — see `rules.ts`), so a
  multi-square move used to render as one smooth CSS slide straight from A to B — reported as the
  coin "jumping straight to the destination" instead of visibly walking each square. `applySnapshot`
  now reconstructs the intermediate path itself (`coordFor` for every position between the old and
  new one) and steps through it via `animateTokenSteps`, one cell at a time with its own `hop()`
  bounce + sound (`STEP_MS` per cell), matching the old locally-authoritative version's feel.
  Guarded by `MAX_STEP_ANIMATE_DELTA` (6, the longest a single roll can move a token): anything
  bigger snaps instead of crawling cell-by-cell, since a bigger jump means the "previous" snapshot
  being diffed against is actually stale (e.g. the first `onStateChange` after a reconnect,
  compared against whatever was on screen before the drop) rather than a real single move. A yard
  entry (pos -1 → 0) has no path to walk yet either, so it also just gets the immediate bump. A
  capture only flashes after the capturing token's own step animation finishes (`await
  Promise.all(moverPromises)` before `capturedEls.forEach(flashCapture)`), so the "captured!" flash
  lands when the token visibly arrives, not before. Verified with a standalone test of the exact
  diff/sequencing logic (step count, capture-after-arrival ordering, yard-entry and oversized-jump
  snapping) since the sandbox can't drive a real browser against the live board.
- `renderAll(snapshot)` wraps the per-snapshot render calls in try/catch — a bad snapshot logs and
  moves on instead of freezing the board. The wider `applySnapshot(snapshot)` (see below) also
  wraps its own diff loop the same way and always advances `prevSnapshot` in a `finally`, even if
  something threw, specifically because of a real bug this caught: `FINISHED_POS` used to be
  57 server-side (`server/src/rules.ts`) while `coordFor` here only has coordinates up to pos 55
  ring/home-column, treating 56 as its own "finished" — so the server would broadcast an 'active'
  token at pos 56, `coordFor` returned `null`, and destructuring it threw. Without the safety net
  that skipped updating `prevSnapshot`, which fed the same broken snapshot into every subsequent
  diff, permanently freezing that token's movable glow/click handling for the rest of the match.
  Fixed at the source (`FINISHED_POS` corrected to 56), but the try/catch stays as a general
  guard against the next client/server position mismatch, whatever it turns out to be.
- **Dice reveal now gates the move it caused**: `handleStateChange` only updates connectivity
  state (the connecting overlay) immediately; everything else — the token diff, `renderAll`, the
  status log, game-over — goes through `applySnapshot(snapshot)`, chained onto a single
  `renderQueue` promise so snapshots are always applied one at a time, in order. When a snapshot's
  `rollSeq` changed (see below for why that, not `diceValue`), `applySnapshot` calls `revealDice()`
  and then `await`s `DICE_REVEAL_MS` (1550ms, matching the cube's own CSS animation) before
  touching anything else. Root cause this
  fixes: the server can move a token (or even pass the turn) in the very same patch as the roll
  that caused it (e.g. a single valid move gets auto-applied in `resolveRoll` itself), and
  rendering that patch immediately made the token teleport to its destination — hop sound and all
  — while the dice was still visibly mid-spin, before the player had actually seen what they
  rolled. `applySnapshot`'s try/catch wraps its *entire* body (not just `renderAll`), specifically
  because chaining through `renderQueue` means an uncaught throw would now reject that link and
  silently freeze every future render for the rest of the match, not just skip one bad frame —
  worse than the pre-chaining bug above. Verified with a standalone test of the exact
  queuing/timing/error-isolation pattern (a bad snapshot mid-stream doesn't block snapshots after
  it, and a roll's render is provably ordered after its reveal, not concurrent with it).
- `hop()` tracks its cleanup `setTimeout` per element in a `WeakMap` — with per-cell stepping
  those now fire back to back (`STEP_MS` apart, barely wider than the 170ms cleanup), so an
  untracked stale timer clipped mid-walk bounces short.
- **`rollSeq`, not `diceValue`, detects "a new roll happened"**: a die only has 6 faces, so two
  consecutive rolls landing on the same number is a 1-in-6 event on *every single turn* — common
  enough to hit repeatedly during the early "everyone needs a 6" phase of a fresh game. The client
  used to detect a fresh roll by comparing `diceValue` itself
  (`snapshot.diceValue !== prevSnapshot.diceValue`), which silently misses that case: no
  `revealDice()`, no `DICE_REVEAL_MS` wait, so the roll's real consequences (the move, the turn
  passing, the "No valid moves for X."/"X's turn." message) all landed with zero animation or
  visible feedback — looked exactly like the game had frozen or skipped a turn, reported as such
  from a real screenshot even though the underlying "No valid moves" logic itself was independently
  verified correct (`movableTokenIndices` cross-checked against 2,033 real turns across 15 full
  simulated games, zero false positives). Fixed by adding `LudoState.rollSeq`, bumped once inside
  `resolveRoll` every time a real roll happens regardless of its face value; `applySnapshot` keys
  its reveal on that instead. Reproduced against the old logic with a rigged-timing 2-client test
  forcing a same-value-back-to-back roll and confirming the old check would have missed it while
  `rollSeq` catches it every time.
- `revealDice` cancels and clears any pending roll-cleanup `setTimeout` before starting a new roll
  (plus the same reflow-restart trick `hop()` uses). Rolling a 6 grants an extra roll, so
  back-to-back rolls are common — without this, a second roll landing inside the first roll's
  1550ms `.rolling` animation window had its cleanup timer fire mid-spin and cut the CSS animation
  short instead of letting each roll finish its own full spin. Found via a proactive smoothness
  audit, not a user report.
- **Exit shows a "Leaving match…" overlay immediately**: the exit-link handler awaits
  `room.leave(true)` before navigating to `lobby.html` — deliberately, so navigation can't cut the
  WebSocket off before the `LEAVE_ROOM` message actually reaches the server (a bare fire-and-forget
  call raced and lost this way when first tried for the waiting-room → board handoff; skipping the
  await would make the exit look like an unconsented drop to the other player — a 60s reconnect
  grace period and "X disconnected — reconnecting…" instead of "X left the game."). That round
  trip is genuinely fast (a few ms locally; real-world it's just normal network latency to Render,
  not anything server-side — `LudoRoom.onLeave`'s consented-leave branch does no awaited work), but
  with nothing on screen acknowledging the click, the board sat there unchanged the whole time and
  then jumped straight to the lobby — reported as an unexplained delay. Reusing the
  connecting-overlay for "Leaving match…" the instant the confirm dialog closes doesn't shorten the
  (already tiny) wait, it just makes clear the app is actually doing something.
- Known gotcha: don't put `filter: drop-shadow(...)` on `.dice-cube` itself — it has
  `transform-style: preserve-3d` and combining the two flattens/hides the cube in Chromium.
  The drop-shadow lives on the outer `.dice-face` button instead.
- Known gotcha: the "movable token" glow uses `filter: drop-shadow(...)`, not `box-shadow` —
  box-shadow spread on a percentage `border-radius:50%` circle renders as a square on some
  mobile browsers instead of a ring.

## Backend (`server/`)

Plan: `C:\Users\PC\.claude\plans\streamed-humming-island.md`.

- **Supabase project**: `ludo-backend` (project id `suojgcpxdelpvbfjcrfn`, region ap-south-1, org
  "Yosh Call App"). Schema: `profiles` (includes `is_admin bool`), `wallets` (internal ledger,
  starts at a fake ₹240), `matches`, `match_players`, `crypto_deposit_addresses`, `crypto_deposits`,
  `crypto_settings` (see "Crypto deposits" below) — RLS on every table (clients can only read
  their own profile/wallet/deposit-address/deposit-history + read match history, unless `is_admin`;
  all writes are server-side via the service role key, except the two admin RPCs below). A
  `handle_new_user()` trigger on `auth.users` auto-creates the `profiles`/`wallets` row on signup
  (client has no insert policy on either — this is the only way those rows get created). No
  advisories/lints outstanding.
- **Admin**: `profiles.is_admin` gates access — a `before update` trigger
  (`prevent_is_admin_self_update`) silently reverts any attempt to change it from a non-
  `service_role` connection, so a plain client `.update()` can never touch it. `is_admin(uid)` is a
  `SECURITY DEFINER` helper (needed so the `profiles`/`wallets` RLS policies checking "is the
  caller an admin" don't query `profiles` from within a `profiles` policy — that recurses
  infinitely; caught by testing, not theoretical). All admin RPCs have `EXECUTE` revoked from
  `anon`/`public`, granted only to `authenticated` — the linter still flags them as "callable by
  authenticated users" but that's intentional, since the admin (an authenticated user) is who's
  supposed to call them; the in-function `is_admin(auth.uid())` check is the real gate, not the
  grant. `design/admin.html` is the only client of any of these:
  - `admin_adjust_wallet_balance(user_id, delta)` — atomic, same single-`UPDATE` pattern as
    `increment_wallet_balance`.
  - `get_platform_stats()` — total users/matches/fee revenue in one query.
  - `admin_set_usdt_rate(rate)` — updates `crypto_settings.usdt_inr_rate` (which otherwise has no
    UPDATE policy for anyone — this RPC is the only way to change it, on purpose, so it's never a
    stray client `.update()` call).
  - `admin_set_user_banned(user_id, banned)` — toggles `profiles.is_banned`. Enforced server-side
    in `LudoRoom.onJoin` (see "Colyseus server" below), not just hidden client-side.
  - `admin_set_is_admin(user_id, is_admin)` — the actual UI for promoting/demoting admins (the
    dashboard/service-role path above still works too, just isn't the only way anymore). Getting
    past `prevent_is_admin_self_update` from a real admin's own JWT needs one specific trick:
    `auth.role()` reflects the *original caller's* JWT for the whole transaction regardless of the
    function's own `SECURITY DEFINER` privileges, so the RPC does
    `perform set_config('request.jwt.claim.role', 'service_role', true)` (transaction-scoped,
    reverts automatically) right before the `UPDATE`, satisfying the trigger's check without
    weakening it for any other caller or table. Also refuses to let an admin demote themselves
    (avoids a last-admin lockout). Both the bypass and the self-demotion guard were verified
    directly against the real database, inside a transaction rolled back afterward: promoting a
    real test user actually stuck (not silently reverted by the trigger), a non-admin caller was
    rejected, and a self-demotion attempt was rejected — all with zero persisted side effects.
  - `crypto_deposit_addresses`/`crypto_deposits` also each got an `is_admin(auth.uid())` SELECT
    policy (same pattern as `wallets_select_admin`) so `admin.html` can show every user's USDT
    deposit history — neither table had any admin visibility before this.
  `admin.html` itself now also has: a Crypto Deposits section (the current rate + an edit form
  calling `admin_set_usdt_rate`, and every deposit across all users); a search box over Users &
  Wallets plus Ban/Unban and Promote/Demote buttons per row (the promote/demote button is disabled
  on the signed-in admin's own row, mirroring the RPC's own guard); and a tap-to-expand player
  breakdown (color, name, win/lose) on each row in All Matches, reusing the `match_players` data
  already fetched for the games/wins stats rather than a second query. Verified end-to-end in a
  real Chromium browser with a mocked Supabase client (search filtering, rate update, ban/promote
  state changes, match drill-down, and the self-row guard all confirmed rendering correctly).
- **Colyseus server** (`server/`): an authoritative `LudoRoom` — see `server/README.md` for
  setup and `npm run test:sim` for the 4-client full-game regression check. Hosting: self-hosted
  via Docker on Render's free tier (`server/Dockerfile`, `render.yaml`) — chosen over Colyseus
  Cloud, which has no free tier.
- **Ban enforcement**: `onJoin` is now `async` and checks `profiles.is_banned` for `options.userId`
  (via `getSupabase()`) *before* reserving a seat — same `client.leave()` rejection the "room is
  full" case already used, so a banned user can never occupy a slot even briefly. Deliberately
  enforced here (the authoritative room), not only by hiding the "Play" buttons client-side, since
  real stakes are on the line. `getSupabase()` returning `null` (no service role key configured)
  no-ops this the same way it already no-ops `persistResult` — never crashes, just quietly doesn't
  check. **Not verified against a live Supabase connection from this project's dev sandbox**: that
  network path is blocked here the same way the crypto-deposit TronGrid calls are (see "Crypto
  deposits" below) — `is_banned` and the `admin_set_user_banned` RPC that flips it *were* verified
  directly against the real database, but the `onJoin` code path itself is a straightforward
  `select` + boolean check reviewed rather than live-tested end-to-end.
- **Reconnection & leaving mid-game**: `onLeave` gives a disconnected player a 60s grace window
  (`this.allowReconnection(client, reconnectGraceSeconds)`, overridable via the `reconnectGraceSeconds`
  create option for tests) before giving up. The game does **not** pause for everyone else while
  that plays out — `LudoState.started` (true once every seat has connected at least once) gates
  this: pre-`started`, a leave is just an incomplete lobby; once `started`, the existing roll/select
  timers (which never checked connection status) keep cycling through whoever's turn it is
  regardless of who's connected, so the remaining players just keep playing. `checkForfeitWin`
  runs once someone's confirmed gone for good (consented leave, or the grace period expiring) —
  if that leaves exactly one player connected, they win by forfeit via the same `declareWinner`
  path a normal 4-tokens-home win uses (including `persistResult`); with 2+ still connected, the
  game simply continues. `handleRoll`/`handleSelectToken` no longer require every player to be
  connected — only that the sender is the current player. `design/game.js` mirrors this:
  `snapshot.started` (not "is everyone connected") gates the dice button and the full-board
  overlay, and the overlay only blocks for *my own* connection being the problem, not someone
  else's — another player leaving now shows as a status message + player-row "(disconnected)"/
  turn-banner "(away)" tag, not a frozen board. `sessionUserIds` is intentionally never deleted on
  leave, since `client.sessionId` is preserved across a successful reconnect.
- **Turn-pass delay**: a roll that ends the turn without a move (no valid moves, or three 6s in a
  row) no longer calls `passTurn()` synchronously in the same tick as `resolveRoll()` — it schedules
  it via `schedulePassTurn()` after `turnPassDelayMs` (1200ms in prod, overridable for tests). Root
  cause: Colyseus batches every schema mutation made within one JS tick into a single outgoing
  patch, so the old synchronous `passTurn()` overwrote `statusMessage` ("No valid moves for X.")
  with "Y's turn." and flipped `currentPlayerIdx` before either value was ever broadcast — a player
  (most visibly one who got auto-rolled by the idle timeout, but a manual roll with no valid move
  hit the same path) saw the turn jump straight to the other player with no visible "you rolled a
  4, no valid moves" beat, i.e. looked like the dice never rolled at all. `LudoState.turnPassPending`
  (true for that window) is synced so `design/game.js` can disable the dice button and hide the
  cosmetic countdown during it instead of leaving them looking live. Reproduced and verified via a
  real timed 2-client test (idle player, timer-driven auto-roll) before shipping.
- **Every move sets a status message**: `applyMove` used to set `statusMessage` only for a yard
  entry, a capture, or a token reaching home — a plain ring move set none at all. For a
  turn-ending move `passTurn()` overwrote it anyway so nothing showed, but on an **extra turn**
  (rolling a 6, capturing, or finishing a token) `passTurn()` never runs, so whatever was there
  before stayed frozen on screen: players were left staring at "X, choose a token to move." with
  nothing selectable while the game was actually waiting on them to roll again (reported from a
  real screenshot, reproduced in a 2-client test). It also meant plain moves never reached the
  game log, which only logs on a message change. Now every branch builds a `moveMessage`
  (including a plain `X moved N.`) and extra turns get `… Roll again!` appended. The
  non-extra-turn branch goes through `schedulePassTurn()` rather than `passTurn()` for the same
  Colyseus same-tick-batching reason as the turn-pass delay above — otherwise the move message
  would be overwritten before it was ever broadcast. That delay is mostly absorbed by the
  client's own dice-reveal/step animation for the same patch, so it doesn't add dead time.
- **`turnSeq` / `turnTimeoutMs`**: `LudoState.turnSeq` bumps (via `startTurnCountdown`) every time
  `armRollTimer`/`armSelectTimer` starts a fresh window, and `turnTimeoutMs` carries the real
  timeout. `design/game.js`'s cosmetic countdown keys off `turnSeq` instead of
  `currentPlayerIdx:awaitingMove` — neither of those changes on an extra turn, so the countdown
  used to stay stuck mid-tick from the previous window (or stay hidden, if that one had already
  expired) while the server had quietly armed a whole new 15s. The client also counts down from
  when the snapshot *arrived* (`renderingArrivedAt`), not from when it renders: rendering now
  deliberately lags arrival by the dice reveal plus the per-cell step animation (~2.6s worst
  case) while the server's timer runs the whole time, so counting from render time showed a full
  15s that then got auto-rolled out from under the player with seconds still on the clock.
- **Atomic wallet updates**: `persistResult` calls the `increment_wallet_balance(p_user_id,
  p_delta)` Postgres RPC (migration `add_atomic_increment_wallet_balance_rpc`, `SECURITY DEFINER`,
  execute revoked from anon/authenticated — only `service_role` can call it) instead of a
  read-then-write, so concurrent matches finishing for the same user can no longer race.
- **Table size**: rooms support 2 or 4 players (`playerCount` create option, default 4) — 2p uses
  colors yellow/red (opposite corners on the ring). `index.ts` registers `filterBy(['playerCount',
  'stake'])` so matchmaking never mixes players who asked for different table sizes or stakes into
  the same room. All entry points (`lobby.html`'s Cash Tables, Quick Match, Create Room, and Join
  Room) route through `stake-confirm.html`'s player-count picker before `waiting-room.html`/
  `board.html` — nothing joins a room without the player explicitly choosing table size first.
- **Client integration done** (Phase C): `design/game.js` talks to a running Colyseus server
  instead of running its own rules locally; `login.html`/`lobby.html` use real Supabase Auth.
- **Live server**: deployed on Render's free tier at `wss://ludo-x96u.onrender.com` (spins down
  after ~15 min idle; first connection after that has a ~30-60s cold start). `design/game.js`
  now defaults to this URL; `?server=` still overrides it for local dev.
- **Not yet done**: no spectator handling; no real withdrawal path (deposits are real now — see
  "Crypto deposits" below — but `wallet.html`'s Withdraw UI is still an explicitly-labeled mock).
- **Open decision, deferred**: match history doesn't show opponent names (just your own
  color/result/stake/time) because `profiles`' RLS only lets a client read its own row. Showing
  real opponent names would mean adding a policy that makes `display_name` readable by any
  authenticated user, not just its owner — a deliberate privacy/product call to revisit later,
  not something to change as a side effect of another task.

## Crypto deposits (USDT / TRC-20)

Custodial, no third-party payment gateway (explicit product decision — the alternative would be a
service like CoinPayments/BitPay, which the user wanted to avoid). Self-hosted: this app's own
server holds the key material and derives/watches addresses itself, rather than a vault/custody
service holding it on the app's behalf — a deliberate simple-to-start tradeoff (real risk: a
compromised server means a compromised hot wallet) accepted for v1, with mitigations noted below.

- **One deposit address per user, deterministically derived.** `server/src/crypto/tron.ts` reads
  a single BIP39 mnemonic from `TRON_MASTER_SEED` (a server-only env var, never in the database,
  never logged) and derives a Tron address + private key per user via `TronWeb.fromMnemonic(seed,
  "m/44'/195'/0'/0/{index}")` — standard BIP44, Tron's coin type 195. Critically, **no private key
  is ever stored anywhere** — every one is perfectly reproducible on demand from the seed + that
  user's `derivation_index` alone (verified deterministic: same index always derives the same
  address/key). Losing the database loses no money; losing the seed (without a separate backup of
  the mnemonic) means every address it controls becomes permanently unsweepable.
- **Race-free index allocation.** `crypto_deposit_index_seq` (a Postgres sequence) plus the
  `next_crypto_deposit_index()` RPC hands out each user's index atomically — no address is ever
  derived twice for two different users, and sequence gaps (e.g. from an aborted request) are
  harmless by design.
- **`server/src/crypto/depositAddress.ts`** — `getOrCreateDepositAddress(userId)`: reads
  `crypto_deposit_addresses` first: existing user, existing row (Postgres `PRIMARY KEY (user_id)`
  is the idempotency guard) — return it. New user — reserve an index, derive off-chain, insert.
  Handles the insert racing against a concurrent request for the same user (Postgres error code
  `23505`, unique violation) by simply reading back whatever the other request already wrote,
  rather than erroring — verified directly against the real database (a duplicate insert for the
  same `user_id` does hit `23505`, exactly as the retry branch expects).
- **`POST /api/crypto/deposit-address`** (`server/src/index.ts`) — the one HTTP route on an
  otherwise pure-WebSocket server (Colyseus doesn't need this; only crypto deposits do). Verifies
  the caller via `Authorization: Bearer <supabase access_token>` (the same token supabase-js
  already attaches to its own requests, just forwarded manually since this is a plain Express
  route, not a Supabase Edge Function) using `supabase.auth.getUser(token)`. `cors()` is wide open
  on origin here — deliberately: the actual access control is the bearer token, not the calling
  origin, and this needs to be reachable from GitHub Pages, local dev, and any future domain
  without maintaining an allowlist.
- **`server/src/crypto/depositWatcher.ts`** — polls TronGrid (`GET
  /v1/accounts/{address}/transactions/trc20?contract_address={USDT}&only_to=true&only_confirmed=true`)
  every 30s for every known deposit address (small batches, `POLL_CONCURRENCY = 5`, to stay under
  TronGrid's free-tier rate limit as the user base grows — add `TRONGRID_API_KEY` and raise this if
  it ever needs to scale further). `only_confirmed=true` queries TronGrid's "solidity" node
  specifically, which only ever exposes blocks Tron's own consensus already considers irreversible
  (~19 blocks / ~1 minute behind the tip — the industry-standard "safe" threshold for TRC-20 USDT),
  so nothing here does its own block-counting on top of that.
  - **Contract-address check is the real security boundary.** USDT is itself just a token contract
    on Tron; a transfer's `token_info.address` is checked against the one true USDT contract
    (`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, `USDT_CONTRACT_ADDRESS` in `tron.ts`) before anything is
    credited. Skipping this would let anyone send a worthless look-alike token with USDT's name/
    symbol and get real ₹ credited for it — verified with a unit test asserting a scam-contract
    transfer alongside a genuine one only ever credits the genuine one.
  - **Idempotent by design, not by accident.** `credit_crypto_deposit(...)` (the Postgres RPC —
    migration `add_crypto_usdt_deposits`) does `insert into crypto_deposits (..., tx_hash, ...) on
    conflict (tx_hash) do nothing` and only credits `wallets.balance` if that insert actually
    happened (checked via PL/pgSQL's `FOUND`, which `on conflict do nothing` correctly sets false
    when the row already existed) — so a transaction TronGrid's history surfaces again on a later
    poll (the steady-state common case, not an error) is a costless no-op, never a double-credit.
    Verified directly against the real database: crediting the same `tx_hash` twice credits the
    wallet once, returns `credited: false` the second time, and leaves the balance unchanged.
  - **USDT → ₹ conversion**: `crypto_settings.usdt_inr_rate` (a plain singleton-row table,
    admin-editable via SQL/dashboard) — no live price-feed dependency, on purpose, for v1.
- **`design/wallet.html`**: the Deposit panel calls the server endpoint above (lazily — only once
  actually opened, since it's a network round trip that can hit Render's cold-start delay) and
  renders the returned address as both text (with a Copy button) and a QR code (`qrcode-generator`
  from jsdelivr — a plain dependency-free script, not a build-step library, so it works the same
  way `colyseus.js`/`supabase-js` already do from CDN). A clear warning that TRC-20 is the *only*
  supported network sits above the address, since funds sent on any other network are unrecoverable.
  "Transaction History" now merges two real sources — match results and `crypto_deposits` (via the
  new `ludoFetchCryptoDeposits` helper in `supabase-client.js`) — sorted together by time; no more
  mock/fabricated entries anywhere in that list.
- **Not built yet, on purpose**: withdrawals (a separate, harder problem — sending funds back out);
  automated sweeping of collected USDT out of per-user hot addresses into cold storage (do this as
  a manual/periodic admin action for now, keeping v1 simpler and the blast radius of a server
  compromise limited to whatever hasn't been swept out yet); live USD/INR pricing.
- **Verification note**: `api.trongrid.io` is blocked by this project's own dev sandbox's network
  policy (only a handful of package registries are allowlisted there), so the TronGrid HTTP
  integration itself could only be written against its documented API shape and unit-tested with a
  mocked `fetch` — not exercised against a real response from this environment. Everything else
  (address derivation determinism, the atomic-credit/idempotency RPC, the deposit-panel UI
  end-to-end with a mocked server response) *was* verified for real — directly against the live
  Supabase project for the database logic, and in a real Chromium browser for the UI. Rehearse the
  TronGrid piece specifically against Tron's Shasta/Nile testnet (`USDT_CONTRACT_ADDRESS_OVERRIDE`
  + `TRONGRID_API_BASE` exist for exactly this) before this touches real mainnet funds.
- **Legal note**: accepting/custodying crypto deposits for users can plausibly make this platform
  a "Virtual Asset Service Provider" under Indian law (FIU-IND/PMLA registration, TDS deduction
  duties under Section 194S) — a second, separate layer of legal exposure on top of the real-money
  Ludo question already flagged elsewhere in this file. Not something resolved here; flagged for
  whenever this goes further than internal testing.

## Running it

Frontend alone (no live multiplayer): serve `design/` statically, e.g. `python -m http.server`
from `design/`, or use the deployed GitHub Pages site — but the board will sit on "Connecting…"
forever without a running Colyseus server.

Full stack locally:
```
cd server && npm install && npm run dev     # ws://localhost:2567
# separately, serve design/ (e.g. `python -m http.server` from design/) and open board.html
```
`design/game.js` defaults to the live Render deployment (`wss://ludo-x96u.onrender.com`); pass
`?server=ws://localhost:2567` (or any other host) to override it for local dev.
