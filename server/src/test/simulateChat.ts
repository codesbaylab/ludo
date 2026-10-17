// Quick chat: only whitelisted ids are relayed, and spam is rate-limited.
import http from 'http';
import express from 'express';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client } from 'colyseus.js';
import { LudoRoom } from '../rooms/LudoRoom';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const httpServer = http.createServer(express());
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define('ludo', LudoRoom);
  const port = 27675;
  await new Promise<void>((r) => httpServer.listen(port, r));
  const client = new Client(`ws://localhost:${port}`);
  const a = await client.create('ludo', { name: 'A', private: true, playerCount: 2 });
  const b = await client.joinById(a.roomId, { name: 'B' });
  const got: any[] = [];
  b.onMessage('chat', (m) => got.push(m));
  a.send('chat', { id: 'gg' });
  a.send('chat', { id: '<script>hi' }); // not whitelisted
  a.send('chat', { id: 'nice' });       // inside cooldown
  await sleep(300);
  if (got.length !== 1 || got[0].id !== 'gg' || got[0].name !== 'A') throw new Error('bad relay: ' + JSON.stringify(got));
  await sleep(1300);
  a.send('chat', { id: 'nice' });
  await sleep(300);
  if (got.length !== 2 || got[1].id !== 'nice') throw new Error('second msg missing: ' + JSON.stringify(got));
  console.log('PASS chat whitelist + rate limit');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
