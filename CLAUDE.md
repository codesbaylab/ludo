# ludoPWA

A Ludo (board game) PWA with a real multiplayer backend. `design/` is the client (static
HTML/CSS/JS, deployed to GitHub Pages); `server/` is an authoritative Colyseus match server backed
by a Supabase project for auth/wallet-ledger/match-history.

## Structure

- `design/styles.css` — shared stylesheet for every page.
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
  helpers above), and a real derived transaction list on `wallet.html` (match stakes/winnings —
  there's no deposit/withdrawal ledger table, so those stay as the explicitly-labeled "Mock
  gateway" demo UI). `profile.html`'s Log Out now actually calls `auth.signOut()` (it previously
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
  `diceValue` changed, `applySnapshot` calls `revealDice()` and then `await`s `DICE_REVEAL_MS`
  (1550ms, matching the cube's own CSS animation) before touching anything else. Root cause this
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
- `revealDice` cancels and clears any pending roll-cleanup `setTimeout` before starting a new roll
  (plus the same reflow-restart trick `hop()` uses). Rolling a 6 grants an extra roll, so
  back-to-back rolls are common — without this, a second roll landing inside the first roll's
  1550ms `.rolling` animation window had its cleanup timer fire mid-spin and cut the CSS animation
  short instead of letting each roll finish its own full spin. Found via a proactive smoothness
  audit, not a user report.
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
  starts at a fake ₹240), `matches`, `match_players` — RLS on every table (clients can only read
  their own profile/wallet + read match history, unless `is_admin`; all writes are server-side via
  the service role key, except the two admin RPCs below). A `handle_new_user()` trigger on
  `auth.users` auto-creates the `profiles`/`wallets` row on signup (client has no insert policy on
  either — this is the only way those rows get created). No advisories/lints outstanding.
- **Admin**: `profiles.is_admin` gates access — a `before update` trigger
  (`prevent_is_admin_self_update`) silently reverts any attempt to change it from a non-
  `service_role` connection, so it can only be toggled via the dashboard/service role, never by a
  client. `is_admin(uid)` is a `SECURITY DEFINER` helper (needed so the `profiles`/`wallets` RLS
  policies checking "is the caller an admin" don't query `profiles` from within a `profiles`
  policy — that recurses infinitely; caught by testing, not theoretical). Two admin-gated RPCs:
  `admin_adjust_wallet_balance(user_id, delta)` (atomic, same single-`UPDATE` pattern as
  `increment_wallet_balance`) and `get_platform_stats()` (total users/matches/fee revenue in one
  query). All four new functions have `EXECUTE` revoked from `anon`/`public`, granted only to
  `authenticated` — the linter still flags them as "callable by authenticated users" but that's
  intentional, since the admin (an authenticated user) is who's supposed to call them; the
  in-function `is_admin(auth.uid())` check is the real gate, not the grant. `design/admin.html` is
  the only client of these. To make someone an admin: `update public.profiles set is_admin = true
  where id = '<their auth.users id>';` via the Supabase SQL editor or MCP tools — there's no UI
  for it by design.
- **Colyseus server** (`server/`): an authoritative `LudoRoom` — see `server/README.md` for
  setup and `npm run test:sim` for the 4-client full-game regression check. Hosting: self-hosted
  via Docker on Render's free tier (`server/Dockerfile`, `render.yaml`) — chosen over Colyseus
  Cloud, which has no free tier.
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
- **Not yet done**: no spectator handling; no real deposit/withdrawal (payment gateway)
  integration — `wallet.html`'s deposit/withdraw UI is still an explicitly-labeled mock.
- **Open decision, deferred**: match history doesn't show opponent names (just your own
  color/result/stake/time) because `profiles`' RLS only lets a client read its own row. Showing
  real opponent names would mean adding a policy that makes `display_name` readable by any
  authenticated user, not just its owner — a deliberate privacy/product call to revisit later,
  not something to change as a side effect of another task.

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
