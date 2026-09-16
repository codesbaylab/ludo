# ludoPWA

A Ludo (board game) PWA. The frontend (`design/`) is a fully playable hotseat game deployed as a
static site; a real multiplayer backend is being scoped/built incrementally (see below).

## Structure

- `design/styles.css` — shared stylesheet for every page.
- `design/game.js` — the Ludo game engine + board rendering (see "Game engine" below).
- `design/index.html`, `login.html`, `lobby.html`, `waiting-room.html`, `stake-confirm.html`,
  `wallet.html`, `history.html`, `profile.html` — still static markup only, not wired to any
  backend or real session state.
- `design/board.html` — the in-game board screen; loads `game.js`.
- `design/manifest.json` + `design/icons/` — PWA manifest and app icons (installable to a phone
  home screen).
- `.github/workflows/pages.yml` — deploys `design/` to GitHub Pages on every push to `main`.
  Live at https://codesbaylab.github.io/ludo/

## Game engine (`design/game.js`)

Fully playable **hotseat** (one device, 4 players take turns) Ludo:
- Real turn order, dice roll (genuine CSS 3D cube + synthesized Web Audio sounds), movement,
  captures, safe squares (entry + star cells), home-column entry, win detection.
- `RING` (52-cell canonical board loop) + `COLORS` (per-color entry index / home column
  coordinates) define the path math — verified against the entry/star cell markup.
- 15s auto-roll timer and auto-pick-a-token timer so a stalled hotseat player doesn't block
  the game; single-legal-move situations auto-play immediately.
- `?stake=<rupees>` query param (read from `location.search`) drives the win screen's payout
  math and the header wallet chip; `?stake=0` is a free match. `lobby.html` → `stake-confirm.html`
  → `waiting-room.html` → `board.html` pass this through the chain via links/query params.
- Known gotcha: don't put `filter: drop-shadow(...)` on `.dice-cube` itself — it has
  `transform-style: preserve-3d` and combining the two flattens/hides the cube in Chromium.
  The drop-shadow lives on the outer `.dice-face` button instead.
- Known gotcha: the "movable token" glow uses `filter: drop-shadow(...)`, not `box-shadow` —
  box-shadow spread on a percentage `border-radius:50%` circle renders as a square on some
  mobile browsers instead of a ring.

## Backend (in progress)

Plan: `C:\Users\PC\.claude\plans\streamed-humming-island.md` (Colyseus for realtime authoritative
multiplayer + Supabase for auth/wallet-ledger/match-history; real payments explicitly deferred).

- **Supabase project provisioned**: `ludo-backend` (project id `suojgcpxdelpvbfjcrfn`, region
  ap-south-1, org "Yosh Call App"). Schema applied: `profiles`, `wallets` (internal ledger only,
  starts at a fake ₹240), `matches`, `match_players` — all with RLS enabled (clients can only
  read their own profile/wallet and read match history; writes are server-side/service-role only).
  No advisories/lints outstanding as of setup.
- **Not yet started**: the Colyseus realtime match server (porting `RING`/`COLORS`/`coordFor`/
  `movableTokens`/capture logic from `design/game.js` into an authoritative `LudoRoom`), and
  swapping the client's local state mutation for a Colyseus connection.

## Running it

No dev server config exists for the frontend. To preview a page, serve `design/` statically, e.g.
`python -m http.server` from `design/`, then open the page in a browser. Or just use the deployed
GitHub Pages site.
