# Ludo server (Colyseus)

The authoritative realtime match server. Each 4-player game is a Colyseus
`LudoRoom` holding the canonical game state; clients send intents (`roll`,
`selectToken`) and the room validates + broadcasts the result. The rules
ported here (`src/rules.ts`, `src/rooms/LudoRoom.ts`) mirror the client
engine in `design/game.js` — turn order, movement, captures, safe squares,
home-column entry, win detection, and the same auto-roll/auto-pick timeout
behavior — just now enforced server-side instead of trusted from the client.

See `C:\Users\PC\.claude\plans\streamed-humming-island.md` for the full
phased backend plan this is Phase B of.

## Setup

```
npm install
cp .env.example .env   # fill in SUPABASE_SERVICE_ROLE_KEY from the Supabase dashboard
npm run dev            # runs on ws://localhost:2567
```

`SUPABASE_SERVICE_ROLE_KEY` is optional for local dev — without it, the
server still plays a full game correctly, it just skips writing the match
result/wallet update at the end (and logs a warning once).

## Testing

`npm run test:sim` spins up a real server in-process, connects 4 real
`colyseus.js` clients, and plays a complete game using only the public
`roll` message (token selection is left to the server's own auto-pick, with
short timeouts so it finishes in a few seconds). It asserts the game reaches
a valid game-over state with a winner at exactly 4 tokens home. This is the
main regression check after touching `rules.ts` or `LudoRoom.ts` — run it
after any change to either.

There's no unit-test framework wired up yet; `rules.ts` is written as pure
functions specifically so it's easy to add one later without touching
`LudoRoom.ts`.

## Deploying (self-hosted, Render free tier)

Decision: self-hosted via Docker on Render's free tier (no credit card required,
750 free instance-hours/month, real WebSocket support). Colyseus Cloud was
considered but has no free tier ($15/mo minimum); Render's only real tradeoff
is that a free instance spins down after ~15 min idle, so the next connection
after a quiet period has a ~30-60s cold start. Fine for pre-launch traffic —
upgrade to a paid Render instance (or move the same Dockerfile to Fly.io/any
other Docker host) later with zero code changes, since the app already reads
`PORT` from the environment and exposes `/health`.

1. Push this repo to GitHub (Render deploys from a connected repo).
2. In the Render dashboard: **New -> Blueprint**, point it at this repo. Render
   picks up `render.yaml` at the repo root, which builds `server/Dockerfile`.
   (No Blueprint access? **New -> Web Service** instead, set the Dockerfile
   path to `server/Dockerfile` and the Docker build context to `server`
   manually, plan **Free**.)
3. Set the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars in the
   Render dashboard (marked `sync: false` in `render.yaml` on purpose — never
   commit the service role key). `PORT` is injected by Render automatically;
   don't set it yourself.
4. Once deployed, Render gives you a `https://<service>.onrender.com` URL —
   the Colyseus WebSocket endpoint is the same host with `wss://`, e.g.
   `wss://ludo-server.onrender.com`. Point the client at it with
   `board.html?server=wss://ludo-server.onrender.com`.
5. Verify with `curl https://<service>.onrender.com/health` -> `{"ok":true}`.

Local Docker sanity check before pushing: `docker build -t ludo-server ./server
&& docker run -p 2567:2567 ludo-server`.

## Reconnection

`onLeave` gives a disconnected player a grace window (`reconnectGraceSeconds`
create option, default 60s) via `this.allowReconnection(client, seconds)`
before giving up — the game clock pauses for everyone while any seat is
empty, and resumes the current player's roll/select timer once every seat is
reconnected. `client.sessionId` is preserved across a successful
`client.reconnect()`, so `sessionUserIds` is intentionally never cleared on
leave (needed by `persistResult` if the game finishes after they're back).

`design/waiting-room.html` hands its live connection to `design/board.html`
this same way on purpose (stashing `room.reconnectionToken` in
`sessionStorage` before navigating) instead of a fresh `joinOrCreate`, which
would otherwise double up on the same room. There's no hard ordering
guarantee that the server's processed that handoff leave before the resume
attempt lands, so `board.html` retries the reconnect a few times rather than
treating a single failure as final.

## Crypto deposits (USDT / TRC-20)

Custodial USDT deposits, no third-party payment gateway — see `CLAUDE.md`'s
"Crypto deposits" section for the full design rationale. In short:

- One permanent Tron address per user, deterministically derived from a
  single server-side master seed (`TRON_MASTER_SEED`, a BIP39 mnemonic) plus
  a per-user index — `src/crypto/tron.ts`. No private key is ever stored
  anywhere; every one is re-derivable on demand from the seed + index alone.
- `src/crypto/depositAddress.ts` + the `POST /api/crypto/deposit-address`
  route in `index.ts` hand out (creating on first call) a user's address,
  authenticated via their Supabase session token.
- `src/crypto/depositWatcher.ts` polls TronGrid every 30s for confirmed
  USDT transfers to known addresses and credits them atomically via the
  `credit_crypto_deposit` Postgres RPC (idempotent on the transaction hash —
  see the migration `add_crypto_usdt_deposits`).
- Both env-gated the same way `SUPABASE_SERVICE_ROLE_KEY` already is: unset
  `TRON_MASTER_SEED` and the server logs one warning and runs everything
  else completely normally.

**To generate a master seed** (do this once, keep the output somewhere safe,
set it as `TRON_MASTER_SEED` in Render's dashboard — never in `.env`, never
committed, never logged):
```
node -e "console.log(require('tronweb').TronWeb.createRandom().mnemonic.phrase)"
```

**Important, unverified from this repo's dev environment:** the TronGrid API
calls in `depositWatcher.ts` could not be exercised against a real network
response while building this — outbound requests to `api.trongrid.io` are
blocked by that sandbox's network policy. The code is written against
TronGrid's documented API shape and the database-level crediting/idempotency
logic *has* been verified directly against the real Supabase project, but
the TronGrid integration itself needs a real run before it's trusted with
real funds. `USDT_CONTRACT_ADDRESS_OVERRIDE` + `TRONGRID_API_BASE` exist
specifically to let this be rehearsed end-to-end against Tron's Shasta/Nile
testnet (using a test TRC-20 token) first.

**Not built yet, on purpose (see CLAUDE.md):** withdrawals, automated
sweeping to cold storage (do this manually/periodically for now — funds sit
in each user's own deposit address until swept), and live USD/INR pricing
(`crypto_settings.usdt_inr_rate` is a plain admin-editable column, no
price-feed dependency).

## What this does NOT do yet (known scope gaps)

- **No spectator handling.** Every seat is a required active player;
  there's no read-only observer mode.
