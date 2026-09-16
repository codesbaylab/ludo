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

gameServer.define('ludo', LudoRoom);

const port = Number(process.env.PORT) || 2567;
gameServer.listen(port).then(() => {
  console.log(`Ludo server listening on ws://localhost:${port}`);
});
