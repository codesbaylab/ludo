# ludoPWA

A Ludo (board game) PWA with a real multiplayer backend. `design/` is the client (static
HTML/CSS/JS, deployed to GitHub Pages); `server/` is an authoritative Colyseus match server backed
by a Supabase project for auth/wallet-ledger/match-history.

## Structure

- `design/styles.css` — shared stylesheet for every page.
- `design/game.js` — client rendering + the Colyseus connection (see "Client" below). No longer
  contains game rules — those live server-side now.
- `design/supabase-client.js` — shared Supabase client (publishable key, safe to expose; RLS is
  what actually protects data). Loaded by `login.html`, `lobby.html`, `board.html`.
- `design/login.html` — real Supabase Auth (email/password signup+login, magic link).
- `design/lobby.html` — requires a session (redirects to `login.html` otherwise); shows the real
  signed-in display name + wallet balance. Games-played/wins/win-rate stats are still fake —
  wiring real match history into the lobby/profile/history pages hasn't been done yet.
- `design/waiting-room.html`, `stake-confirm.html` — still static/query-param-driven mockup, not
  backed by the real Colyseus room's player list yet.
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
  setup, `npm run test:sim` for the 4-client full-game regression check, and known gaps
  (no reconnection handling, wallet updates aren't atomic yet, no hosting decision made).
- **Client integration done** (Phase C): `design/game.js` talks to a running Colyseus server
  instead of running its own rules locally; `login.html`/`lobby.html` use real Supabase Auth.
- **Not yet done**: `waiting-room.html`/`stake-confirm.html` still don't reflect the real Colyseus
  room's player list (they're the pre-multiplayer mockup); no reconnection/spectator handling;
  wallet updates on match end aren't atomic; no production hosting decision for the Colyseus
  server (Colyseus Cloud vs. self-hosted).

## Running it

Frontend alone (no live multiplayer): serve `design/` statically, e.g. `python -m http.server`
from `design/`, or use the deployed GitHub Pages site — but the board will sit on "Connecting…"
forever without a running Colyseus server.

Full stack locally:
```
cd server && npm install && npm run dev     # ws://localhost:2567
# separately, serve design/ (e.g. `python -m http.server` from design/) and open board.html
```
`design/game.js` defaults to `ws://localhost:2567`; pass `?server=wss://your-host` to point it
elsewhere once the server is actually deployed somewhere.
