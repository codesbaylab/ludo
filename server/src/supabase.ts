import { createClient, SupabaseClient } from '@supabase/supabase-js';

// The game server is the only thing allowed to write match results/wallet
// changes (RLS on `matches`/`match_players`/`wallets` only allows client
// reads — see the migration applied to the `ludo-backend` Supabase project).
// That means this must use the service role key, never the publishable/anon
// key, and that key must only ever live in server-side env vars.
let client: SupabaseClient | null = null;
let warned = false;

export function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    if (!warned) {
      console.warn(
        '[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — match results will not be persisted.'
      );
      warned = true;
    }
    return null;
  }
  if (!client) {
    client = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  return client;
}

export type JoinCheck =
  | { ok: true; userId?: string }
  | { ok: false; reason: 'banned' | 'pro_required' | 'auth_required' };

/**
 * Shared join gate for every room. `requirePro` is true for anything that
 * moves real money (Ludo tables with a stake, every Rummy cash table).
 *
 * Real-money joins must present a Supabase access token, which is verified
 * here — a bare client-supplied `userId` is NOT trusted for them, since a
 * free user could otherwise claim a Pro user's id. Free play keeps accepting
 * the legacy unverified `userId` (it only labels the seat; no money moves).
 * With no service-role key configured (local dev/tests) nothing can be
 * checked, so this no-ops exactly like `persistResult` does.
 */
export async function authorizeJoin(
  options: { userId?: string; accessToken?: string },
  requirePro: boolean
): Promise<JoinCheck> {
  const supabase = getSupabase();
  if (!supabase) return { ok: true, userId: options.userId };

  let userId = options.userId;
  if (options.accessToken) {
    const { data, error } = await supabase.auth.getUser(options.accessToken);
    if (error || !data.user) return { ok: false, reason: 'auth_required' };
    userId = data.user.id;
  } else if (requirePro) {
    return { ok: false, reason: 'auth_required' };
  }

  if (userId) {
    const { data } = await supabase.from('profiles').select('is_banned, is_pro').eq('id', userId).single();
    if (data?.is_banned) return { ok: false, reason: 'banned' };
    if (requirePro && !data?.is_pro) return { ok: false, reason: 'pro_required' };
  }
  return { ok: true, userId };
}

// ---- Stake holds ---------------------------------------------------------
// A real-money seat RESERVES its worst-case loss when the player joins
// (wallets.held), instead of being debited only at the very end. Available
// funds (balance - held) are all a player can transfer / withdraw / spend on Pro
// meanwhile, so nobody can walk away from a stake they're sitting on. The hold
// is released at settlement (settle_wallet applies the result and releases it
// in one statement), when a seat empties before the game starts, or when the
// room is disposed without settling (anything left over is refunded by simply
// releasing it — balance was never touched).

export interface Hold { userId: string; amount: number }

/** Reserve `amount`; false if the player doesn't have it available. */
export async function holdFunds(userId: string, amount: number): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return true; // nothing can be checked without a service key (local dev/tests)
  const { error } = await supabase.rpc('hold_funds', { p_user_id: userId, p_amount: amount });
  if (error) {
    if (/insufficient available balance/i.test(error.message)) return false;
    throw new Error(`hold_funds failed: ${error.message}`);
  }
  return true;
}

export async function releaseFunds(userId: string, amount: number): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.rpc('release_funds', { p_user_id: userId, p_amount: amount });
  if (error) console.error(`[holds] failed to release ${amount} for ${userId}:`, error);
}

/** Apply a match result (`delta`) and release this match's hold atomically. */
export async function settleWallet(userId: string, delta: number, release: number): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.rpc('settle_wallet', { p_user_id: userId, p_delta: delta, p_release: release });
  if (error) console.error(`[holds] failed to settle wallet for ${userId}:`, error);
}

/** Rooms only live in this process's memory, so after a restart every hold is stale. */
export async function releaseAllHolds(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.rpc('release_all_holds');
  if (error) console.error('[holds] failed to release stale holds at boot:', error);
}
