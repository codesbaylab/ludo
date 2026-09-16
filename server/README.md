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
- **No deployment/hosting decision made yet.** Needs Colyseus Cloud vs.
  self-hosted Docker, per the plan.
