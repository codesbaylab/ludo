import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LudoRoom } from './rooms/LudoRoom';
import { RummyRoom } from './rooms/RummyRoom';
import { getSupabase, releaseAllHolds } from './supabase';
import { getOrCreateDepositAddress } from './crypto/depositAddress';
import { cryptoDepositsEnabled } from './crypto/solana';
import { getWatcherStatus } from './crypto/depositWatcher';
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

const bootedAt = Date.now();

// Live server facts for the admin System page. Admin-only: verified with the caller's Supabase token.
app.get('/api/admin/status', async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const supabase = getSupabase();
  if (!supabase) { res.status(503).json({ error: 'database not configured' }); return; }
  const { data: me } = await supabase.from('profiles').select('is_admin').eq('id', userId).single();
  if (!me?.is_admin) { res.status(403).json({ error: 'admins only' }); return; }
  try {
    const listings = await matchMaker.query({});
    let players = 0;
    let inPlay = 0;
    const rooms = listings.map((r: any) => {
      const m = r.metadata ?? {};
      const clients = Number(r.clients ?? 0);
      players += clients;
      if (r.name === 'ludo') inPlay += Number(m.stake ?? 0) * clients;
      if (r.name === 'rummy' && !m.free) inPlay += Number(m.mode === 'pool' ? m.entryFee ?? 0 : (m.pointValue ?? 0) * 80) * clients;
      return { id: r.roomId, game: r.name, clients, maxClients: r.maxClients, private: !!r.private, locked: !!r.locked, stake: m.stake ?? null, mode: m.mode ?? null, free: !!m.free, playerCount: m.playerCount ?? null };
    });
    const mem = process.memoryUsage();
    res.json({
      ok: true,
      uptime_s: Math.round((Date.now() - bootedAt) / 1000),
      started_at: new Date(bootedAt).toISOString(),
      version: (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').slice(0, 7) || 'unknown',
      node: process.version,
      memory_mb: Math.round(mem.rss / 1048576),
      players, tables: rooms.length, in_play_inr: inPlay, rooms,
      watcher: { ...getWatcherStatus(), configured: cryptoDepositsEnabled() },
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error)?.message ?? err) });
  }
});

app.post('/api/crypto/deposit-address', async (req, res) => {
  if (!cryptoDepositsEnabled()) {
    res.status(503).json({ error: 'crypto deposits are not enabled on this server' });
    return;
  }
  const userId = await requireUser(req, res);
  if (!userId) return;
  try {
    const address = await getOrCreateDepositAddress(userId);
    res.json({ address, chain: 'solana', asset: 'USDT (Solana)' });
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
// Same reasoning as 'ludo' above — a real-money Rummy table must only ever
// matchmake players who asked for the exact same mode and stake shape.
// pointValue/poolLimit/entryFee are 0 (a consistent, mode-irrelevant
// default — see RummyRoom.onCreate) for whichever mode doesn't use them, so
// two same-mode tables still match on the fields that actually matter.
gameServer.define('rummy', RummyRoom).filterBy(['mode', 'playerCount', 'pointValue', 'poolLimit', 'entryFee', 'free']);

const port = Number(process.env.PORT) || 2567;
gameServer.listen(port).then(async () => {
  // No room survives a restart, so every reserved stake is stale (see supabase.ts).
  await releaseAllHolds();
  console.log(`Ludo server listening on ws://localhost:${port}`);
});

// No-ops with a warning if SOLANA_MASTER_SEED/Supabase aren't configured —
// same pattern as getSupabase() — so local dev without crypto env vars set
// still runs the game normally.
startDepositWatcher();
