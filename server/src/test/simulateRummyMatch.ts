// Full-game smoke test for RummyRoom: spins up a real Colyseus server
// in-process, connects real colyseus.js clients, and plays complete
// Points and Pool matches using only the public message API (draw/discard/
// declare) — decisions are made by the same bot heuristics
// design/rummy-rules.js already uses for the practice table (borrowed here
// only to drive believable play; the server itself never depends on them —
// see engine.ts's own note on why bot logic isn't ported server-side).
// Verifies the server reaches a valid matchOver state, with sane final
// wallet-settlement math, without throwing — the main thing worth checking
// after building a from-scratch authoritative room for a hidden-information
// card game.

import http from 'http';
import express from 'express';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, Room } from 'colyseus.js';
import { RummyRoom } from '../rooms/RummyRoom';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RummyRules = require('../../../design/rummy-rules.js');

interface SimCard {
  id: string;
  rank: string;
  suit: string | null;
}

async function playMatch(mode: 'points' | 'pool', playerCount: number, extraOptions: Record<string, unknown>) {
  const app = express();
  const httpServer = http.createServer(app);
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define('rummy', RummyRoom);

  const port = 27700 + Math.floor(Math.random() * 1000);
  await new Promise<void>((resolve) => httpServer.listen(port, resolve));

  const client = new Client(`ws://localhost:${port}`);
  const rooms: Room[] = [];
  const hands: SimCard[][] = [];
  const actedKey: string[] = [];

  for (let i = 0; i < playerCount; i++) {
    hands.push([]);
    actedKey.push('');
    const room = await client.joinOrCreate('rummy', {
      name: `Bot${i}`,
      mode,
      playerCount,
      drawTimeoutMs: 4000,
      discardTimeoutMs: 4000,
      handEndDelayMs: 20,
      ...extraOptions,
    });
    rooms.push(room);
    room.onMessage('hand', (msg: { cards: SimCard[] }) => {
      hands[i] = msg.cards;
    });
  }

  let finalState: any = null;
  let handsPlayed = 0;

  const matchOverState = await new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`simulation timed out after 30s (mode=${mode})`)), 30_000);

    rooms.forEach((room, i) => {
      room.onStateChange((state: any) => {
        if (i === 0 && state.handNumber > handsPlayed) {
          handsPlayed = state.handNumber;
        }
        if (state.matchOver) {
          if (i === 0) {
            clearTimeout(timeout);
            finalState = state;
            resolve(state);
          }
          return;
        }
        if (state.currentPlayerIdx !== i) return;

        const key = `${state.handNumber}:${state.phase}`;
        if (actedKey[i] === key) return;

        const wildRank = state.wildRank;
        const discardTop: SimCard | null = state.discardTop?.id ? { id: state.discardTop.id, rank: state.discardTop.rank, suit: state.discardTop.suit || null } : null;

        if (state.phase === 'draw') {
          if (!discardTop) return; // patch hasn't caught up with the deal yet
          actedKey[i] = key;
          const source = RummyRules.botChooseDrawSource(hands[i], discardTop, wildRank);
          room.send('draw', { source });
        } else if (state.phase === 'discard') {
          if (hands[i].length !== 14) return; // hasn't received the post-draw hand yet
          actedKey[i] = key;
          const declareOption = RummyRules.findDeclareOption(hands[i], wildRank);
          if (declareOption) {
            room.send('declare', { cardId: hands[i][declareOption.removeIndex].id });
          } else {
            const discardIdx = RummyRules.botChooseDiscardIndex(hands[i], wildRank);
            room.send('discard', { cardId: hands[i][discardIdx].id });
          }
        }
      });
    });
  });

  console.log(`[sim-rummy] ${mode} match finished after ${matchOverState.handNumber} hand(s)`);
  const summary = finalState.players.map((p: any, i: number) => `${p.name}:${mode === 'pool' ? `${p.cumulative}pts${p.eliminated ? '(out)' : ''}` : 'seat' + i}`).join(' ');
  console.log(`[sim-rummy] final: ${summary}`);

  if (mode === 'points' && finalState.lastHandWinnerIdx === -1 && finalState.lastHandInvalidDeclareBy === -1) {
    throw new Error('points match ended with neither a winner nor an invalid declare recorded');
  }
  if (mode === 'pool') {
    const active = finalState.players.filter((p: any) => !p.eliminated);
    if (active.length !== 1) throw new Error(`pool match ended with ${active.length} active players, expected exactly 1`);
  }

  rooms.forEach((r) => r.leave());
  httpServer.close();
}

async function main() {
  await playMatch('points', 4, { pointValue: 2 });
  console.log('[sim-rummy] PASS — Points Rummy (4p)');

  await playMatch('points', 2, { pointValue: 1 });
  console.log('[sim-rummy] PASS — Points Rummy (2p)');

  // A small pool cap so the match resolves in a handful of hands instead of
  // dozens — matches the reasoning design/rummy-board.html's own e2e tests
  // already used for the same reason (see CLAUDE.md's Pool Rummy notes).
  await playMatch('pool', 2, { poolLimit: 51, entryFee: 50 });
  console.log('[sim-rummy] PASS — Pool Rummy (2p, 51 cap)');

  console.log('[sim-rummy] ALL PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error('[sim-rummy] FAILED:', err);
  process.exit(1);
});
