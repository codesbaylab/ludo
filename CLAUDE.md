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
  stored directly). Loaded by every page under auth: `lobby.html`, `profile.html`, `history.html`,
  `wallet.html`, `waiting-room.html`, `board.html`.
- `design/login.html` — real Supabase Auth (email/password signup+login, magic link).
- `design/lobby.html`, `profile.html`, `history.html`, `wallet.html` — all require a real session
  (redirect to `login.html` otherwise — `profile.html`/`history.html`/`wallet.html` had NO auth
  guard at all before this was fixed) and show real data: signed-in name/email, real wallet
  balance, real games-played/wins/win-rate, real per-match results (via the `supabase-client.js`
  helpers above), and a real derived transaction list on `wallet.html` (match stakes/winnings —
  there's no deposit/withdrawal ledger table, so those stay as the explicitly-labeled "Mock
  gateway" demo UI). `profile.html`'s Log Out now actually calls `auth.signOut()` (it previously
  just navigated away, leaving the session live). The fake "✓ Verified"/"Identity Verification
  (KYC)" badges on `profile.html` were removed rather than left fabricated — no such feature
  exists anywhere in the schema or backend.
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
- `design/manifest.json` + `design/icons/` — PWA manifest and app icons (installable to a phone
  home screen).
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
- **Known simplification**: a multi-square move now animates as one smooth CSS slide + a single
  bounce at the end (the server sends only the final position in one patch), not the old
  per-cell hop-hop-hop the local-authority version had. Still looks fine, just not identical.
- Known gotcha: don't put `filter: drop-shadow(...)` on `.dice-cube` itself — it has
  `transform-style: preserve-3d` and combining the two flattens/hides the cube in Chromium.
  The drop-shadow lives on the outer `.dice-face` button instead.
- Known gotcha: the "movable token" glow uses `filter: drop-shadow(...)`, not `box-shadow` —
  box-shadow spread on a percentage `border-radius:50%` circle renders as a square on some
  mobile browsers instead of a ring.

## Backend (`server/`)

Plan: `C:\Users\PC\.claude\plans\streamed-humming-island.md`.

- **Supabase project**: `ludo-backend` (project id `suojgcpxdelpvbfjcrfn`, region ap-south-1, org
  "Yosh Call App"). Schema: `profiles`, `wallets` (internal ledger, starts at a fake ₹240),
  `matches`, `match_players` — RLS on every table (clients can only read their own profile/wallet
  + read match history; all writes are server-side via the service role key). A
  `handle_new_user()` trigger on `auth.users` auto-creates the `profiles`/`wallets` row on
  signup (client has no insert policy on either — this is the only way those rows get created).
  No advisories/lints outstanding.
- **Colyseus server** (`server/`): an authoritative `LudoRoom` — see `server/README.md` for
  setup and `npm run test:sim` for the 4-client full-game regression check. Hosting: self-hosted
  via Docker on Render's free tier (`server/Dockerfile`, `render.yaml`) — chosen over Colyseus
  Cloud, which has no free tier.
- **Reconnection**: `onLeave` gives a disconnected player a 60s grace window
  (`this.allowReconnection(client, reconnectGraceSeconds)`, overridable via the `reconnectGraceSeconds`
  create option for tests) before giving up — the game clock pauses for everyone while a seat is
  empty, and resumes turns/timers once all seats are reconnected. `sessionUserIds` is intentionally
  never deleted on leave, since `client.sessionId` is preserved across a successful reconnect.
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
