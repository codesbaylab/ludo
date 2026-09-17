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

## What this does NOT do yet (known scope gaps)

- **No client integration.** `design/game.js` still runs its own local copy
  of the rules entirely client-side — nothing in `design/` talks to this
  server yet. That's Phase C.
- **No auth wiring.** `onJoin` accepts an optional `userId` (meant to be a
  Supabase auth user id) but nothing sets it yet, so `persistResult` always
  skips writing to Supabase until Phase C's client auth exists.
- **No reconnection handling.** If a player disconnects mid-game, the room
  just pauses (clears timers, sets a status message) and waits — there's no
  grace-period reconnect flow or bot takeover.
- **Wallet updates aren't atomic.** `persistResult`'s balance update is a
  plain read-then-write, which has a race condition under concurrent
  matches finishing for the same user. Fine for solo testing, not for
  production — replace with a Postgres RPC that increments the balance in
  one statement before this handles real money.
- **Hosting is decided but only Dockerized, not yet actually deployed
  live.** See "Deploying" above — `Dockerfile` + `render.yaml` exist; someone
  still needs to click through the Render dashboard, set the env vars, and
  give the client the real `wss://` URL.
