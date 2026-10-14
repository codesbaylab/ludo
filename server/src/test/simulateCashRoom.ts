// Custom cash room checks: stake sanitising + join-by-code adopting the host's stake.
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
  const port = 27673;
  await new Promise<void>((r) => httpServer.listen(port, r));
  const client = new Client(`ws://localhost:${port}`);
  const stakeOf = async (opts: any) => {
    const r = await client.create('ludo', { name: 'H', private: true, playerCount: 2, ...opts });
    await new Promise((res) => setTimeout(res, 100));
    const s = (r.state as any).stake; const id = r.roomId;
    return { r, s, id };
  };
  const cases: [any, number][] = [[{ stake: 5 }, 5], [{ stake: 0.1 }, 0.25], [{ stake: 99999 }, 50], [{ stake: 12.7 }, 12.7], [{ stake: 1.234 }, 1.23], [{ stake: -5 }, 0], [{ stake: 'x' }, 0], [{ stake: 20, bots: true }, 0]];
  for (const [o, want] of cases) {
    const { r, s } = await stakeOf(o);
    if (s !== want) throw new Error(`stake ${JSON.stringify(o)} -> ${s}, wanted ${want}`);
    await r.leave();
  }
  // guest joins a $5 private room by code and sees the host's stake
  const host = await client.create('ludo', { name: 'Host', private: true, playerCount: 2, stake: 5 });
  const guest = await client.joinById(host.roomId, { name: 'Guest' });
  await new Promise((res) => setTimeout(res, 150));
  if ((guest.state as any).stake !== 5 || !(guest.state as any).started) throw new Error('guest did not adopt stake / start');
  console.log('PASS cash room stake rules');
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
