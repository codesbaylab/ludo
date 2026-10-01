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
