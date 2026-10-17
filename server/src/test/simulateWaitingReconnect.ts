// A waiting-room player whose socket drops (backgrounded app) must keep their seat, and a stranger must not be able to take it.
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
  const port = 27674;
  await new Promise<void>((r) => httpServer.listen(port, r));
  const client = new Client(`ws://localhost:${port}`);

  const host = await client.create('ludo', { name: 'Host', private: true, playerCount: 2, preStartGraceSeconds: 30 });
  const code = host.roomId;
  const token = host.reconnectionToken;
  // Simulate the OS killing the socket (no consented leave).
  (host.connection as any).transport.ws.terminate?.() ?? (host.connection as any).transport.ws.close();
  await sleep(500);

  // The host's seat must still be held: the table must not fill up from outside.
  const friend = await client.joinById(code, { name: 'Friend' });
  await sleep(300);
  const seats = (friend.state as any).players.map((p: any) => `${p.name}:${p.connected}`);
  if ((friend.state as any).started) throw new Error('table started without the host');
  console.log('after friend joined:', seats.join(' '));

  const back = await client.reconnect(token);
  await sleep(500);
  const s = (back.state as any);
  if (!s.players.every((p: any) => p.connected) || !s.started) throw new Error('host did not get the seat back: ' + JSON.stringify(s.players.map((p: any) => [p.name, p.connected])));
  if (s.players[0].name !== 'Host') throw new Error('host lost seat 0');
  console.log('PASS waiting-room reconnect keeps the seat');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
