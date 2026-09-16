// Shared Supabase client for every page that needs auth/data access.
// Requires the supabase-js UMD bundle (window.supabase) to already be
// loaded via a <script> tag before this file.
//
// The publishable/anon key below is meant to be public — it's safe to ship
// in client code by design (RLS on every table is what actually protects
// data, not keeping this key secret). See CLAUDE.md / the ludo-backend
// Supabase project for the schema and its RLS policies.
(function () {
  const SUPABASE_URL = 'https://suojgcpxdelpvbfjcrfn.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_GKRep4bhOEs4TmQZ1cQ6nA_p-Chhret';
  window.ludoSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
})();
