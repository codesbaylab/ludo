import http from 'http';
import express from 'express';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LudoRoom } from './rooms/LudoRoom';

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true }));

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// Keeps matchmaking from mixing players who asked for different table sizes
// or stakes into the same room (joinOrCreate would otherwise fill whatever
// open 'ludo' room it finds first, regardless of these options).
gameServer.define('ludo', LudoRoom).filterBy(['playerCount', 'stake']);

const port = Number(process.env.PORT) || 2567;
gameServer.listen(port).then(() => {
  console.log(`Ludo server listening on ws://localhost:${port}`);
});
