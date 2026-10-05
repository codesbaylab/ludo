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

## Crypto deposits (USDT on Solana)

Custodial USDT (SPL) deposits, no third-party payment gateway - see `CLAUDE.md`'s
"Crypto deposits" section. Tron/TRC-20 was removed (gas cost too high for small deposits).

- One permanent Solana address per user, derived from a single server-side BIP39 master seed
  (`SOLANA_MASTER_SEED`; `TRON_MASTER_SEED` is still accepted so an existing phrase keeps working) at
  `m/44'/501'/{index}'/0'` - `src/crypto/solana.ts`. No private key is stored; index 0 is the gas wallet.
- `src/crypto/depositAddress.ts` + `POST /api/crypto/deposit-address` hand out a user's address.
- `src/crypto/depositWatcher.ts` polls the RPC every 30s: finalized transactions on each address's USDT token
  account, credited via the idempotent `credit_crypto_deposit` RPC (keyed on the tx signature).
- Env: `SOLANA_MASTER_SEED` (required), `SOLANA_RPC_URL` (set a Helius/QuickNode-style URL in production; the
  public RPC is rate-limited), `USDT_MINT_OVERRIDE` (devnet rehearsal), `MIN_DEPOSIT_USDT` (default 1).
- Whoever sends USDT creates the recipient's token account (~0.002 SOL rent); exchanges normally do this.

**Generate a seed** once, keep it safe, set it in Render's dashboard only:
```
node -e "console.log(require('bip39').generateMnemonic())"
```

**Not yet exercised against a live Solana RPC** from the dev sandbox - the derivation and the transfer parsing
are unit-checked; rehearse on devnet (`SOLANA_RPC_URL` + `USDT_MINT_OVERRIDE`) before real funds.

**Not built yet, on purpose (see CLAUDE.md):** withdrawals, automated
sweeping to cold storage (do this manually/periodically for now — funds sit
in each user's own deposit address until swept), and live USD/INR pricing
(`crypto_settings.usdt_inr_rate` is a plain admin-editable column, no
price-feed dependency).

## What this does NOT do yet (known scope gaps)

- **No spectator handling.** Every seat is a required active player;
  there's no read-only observer mode.
