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
