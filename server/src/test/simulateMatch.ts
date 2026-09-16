// Full-game smoke test: spins up a real Colyseus server in-process, connects
// 4 real colyseus.js clients, and plays a complete game using only the
// public message API (`roll`) — token selection is left to the server's own
// auto-pick-on-timeout, with tiny timeouts here so the whole game finishes
// in seconds instead of minutes. Verifies the server reaches a valid
// game-over state without throwing, which is the main thing worth checking
// after porting the client's rules into a from-scratch authoritative room.

import http from 'http';
import express from 'express';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, Room } from 'colyseus.js';
import { LudoRoom } from '../rooms/LudoRoom';

async function main() {
  const app = express();
  const httpServer = http.createServer(app);
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define('ludo', LudoRoom);

  const port = 27671;
  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  console.log(`[sim] test server listening on :${port}`);

  const client = new Client(`ws://localhost:${port}`);
  const rooms: Room[] = [];
  for (let i = 0; i < 4; i++) {
    const room = await client.joinOrCreate('ludo', {
      name: `Bot${i}`,
      rollTimeoutMs: 25,
      selectTimeoutMs: 25,
    });
    rooms.push(room);
    console.log(`[sim] bot ${i} joined as sessionId=${room.sessionId}`);
  }

  const handled = rooms.map(() => false);
  let lastLoggedTurn = -1;
  let finalState: any = null;

  // Only room 0 decides when the game is "done", and we use the exact state
  // snapshot from that callback (not a re-read afterward) — different
  // clients' sockets can be a patch or two out of sync with each other at
  // any instant, so mixing "gameOver from client A" with "a later read of
  // client B's state" produces a stale/misleading snapshot even though the
  // server itself was never wrong.
  const winnerColor = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('simulation timed out after 60s')), 60_000);

    rooms.forEach((room, i) => {
      room.onStateChange((state: any) => {
        if (state.gameOver) {
          if (i === 0) {
            clearTimeout(timeout);
            finalState = state;
            resolve(state.winnerColor);
          }
          return;
        }
        if (i === 0 && state.currentPlayerIdx !== lastLoggedTurn) {
          lastLoggedTurn = state.currentPlayerIdx;
          console.log(`[sim] turn -> player ${state.currentPlayerIdx} (${state.players[state.currentPlayerIdx].color})`);
        }

        const isMyTurn = state.currentPlayerIdx === i && !state.awaitingMove && !state.gameOver;
        if (isMyTurn && !handled[i]) {
          handled[i] = true;
          room.send('roll');
        } else if (!isMyTurn) {
          handled[i] = false;
        }
      });
    });
  });

  console.log(`[sim] game finished — winner color: ${winnerColor}`);

  const homeCounts = finalState.players.map((p: any) => `${p.color}:${p.homeCount}`).join(' ');
  console.log(`[sim] final home counts — ${homeCounts}`);
  if (!finalState.players.some((p: any) => p.homeCount === 4)) {
    throw new Error('game reported over but no player has 4 tokens home');
  }

  rooms.forEach((r) => r.leave());
  httpServer.close();
  console.log('[sim] PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error('[sim] FAILED:', err);
  process.exit(1);
});
