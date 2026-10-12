// vs-Computer smoke test: one real client plays seat 0 (rolling, picking the
// first movable token) against 3 server-driven bots until the game ends.
import http from 'http';
import express from 'express';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client } from 'colyseus.js';
import { LudoRoom } from '../rooms/LudoRoom';

async function main() {
  const httpServer = http.createServer(express());
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define('ludo', LudoRoom);
  const port = 27672;
  await new Promise<void>((r) => httpServer.listen(port, r));

  const client = new Client(`ws://localhost:${port}`);
  const room = await client.create('ludo', { name: 'Human', bots: true, playerCount: 4, stake: 50, botDelayMs: 5, rollTimeoutMs: 40, selectTimeoutMs: 40, turnPassDelayMs: 5 });
  let botTurns = 0, last = -1;
  const done = new Promise<any>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), 120_000);
    room.onStateChange((s: any) => {
      if (s.gameOver) { clearTimeout(t); resolve(s.toJSON()); return; }
      if (!s.started) return;
      if (s.currentPlayerIdx !== 0 && s.rollSeq !== last) { last = s.rollSeq; botTurns++; }
      if (s.currentPlayerIdx !== 0) return;
      if (s.awaitingMove) {
        const i = s.players[0].tokens.findIndex((tk: any) => tk.movable);
        if (i >= 0) room.send('selectToken', { tokenIndex: i });
      } else if (!s.turnPassPending) room.send('roll');
    });
  });
  const s = await done;
  const names = s.players.map((p: any) => p.name);
  console.log('names:', names.join(', '), '| stake:', s.stake, '| winner:', s.winnerColor, '| bot rolls seen:', botTurns);
  if (s.stake !== 0) throw new Error('bot table must be free');
  if (!names.slice(1).every((n: string) => n.startsWith('Bot'))) throw new Error('missing bots');
  if (botTurns < 10) throw new Error('bots did not play');
  console.log('PASS');
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
