import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LudoRoom } from './rooms/LudoRoom';
import { getSupabase } from './supabase';
import { getOrCreateDepositAddress } from './crypto/depositAddress';
import { cryptoDepositsEnabled } from './crypto/tron';
import { startDepositWatcher } from './crypto/depositWatcher';

const app = express();
// Only the two crypto-deposit routes below need this — the game itself is
// pure WebSocket (Colyseus), not HTTP. Wide open on origin since the actual
// access control is the bearer token, not the calling origin (same as any
// public REST API fronted by JWT auth); GitHub Pages, local dev, and any
// future domain all need to reach this without maintaining an allowlist.
app.use(cors());
app.get('/health', (_req, res) => res.json({ ok: true }));

// Verifies the caller's Supabase session from an Authorization: Bearer
// <access_token> header — the same token supabase-js already attaches to
// every request the client makes, just forwarded here manually since this
// is a plain Express route, not a Supabase Edge Function.
async function requireUser(req: express.Request, res: express.Response): Promise<string | null> {
  const supabase = getSupabase();
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!supabase || !token) {
    res.status(401).json({ error: 'not authenticated' });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'not authenticated' });
    return null;
  }
  return data.user.id;
}

app.post('/api/crypto/deposit-address', async (req, res) => {
  if (!cryptoDepositsEnabled()) {
    res.status(503).json({ error: 'crypto deposits are not enabled on this server' });
    return;
  }
  const userId = await requireUser(req, res);
  if (!userId) return;
  try {
    const address = await getOrCreateDepositAddress(userId);
    res.json({ address, chain: 'tron', asset: 'USDT (TRC-20)' });
  } catch (err) {
    console.error('[crypto] failed to get/create deposit address:', err);
    res.status(500).json({ error: 'failed to get deposit address' });
  }
});

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

// No-ops with a warning if TRON_MASTER_SEED/Supabase aren't configured —
// same pattern as getSupabase() — so local dev without crypto env vars set
// still runs the game normally.
startDepositWatcher();
