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

  // "2 hours ago" / "yesterday" style relative time, shared by every page
  // that lists real match/transaction activity.
  window.ludoTimeAgo = function (isoString) {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return new Date(isoString).toLocaleDateString();
  };

  // Real games-played/wins/win-rate for a user, from match_players — used by
  // lobby.html, profile.html, and history.html instead of hardcoded numbers.
  window.ludoFetchStats = async function (userId) {
    const [{ count: games }, { count: wins }] = await Promise.all([
      window.ludoSupabase.from('match_players').select('*', { count: 'exact', head: true }).eq('user_id', userId),
      window.ludoSupabase.from('match_players').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('result', 'win'),
    ]);
    const gamesPlayed = games ?? 0;
    const winCount = wins ?? 0;
    const winRate = gamesPlayed > 0 ? Math.round((winCount / gamesPlayed) * 100) : 0;
    return { gamesPlayed, wins: winCount, winRate };
  };

  // Real finished-match rows for a user (color/result/stake/time), newest
  // first. Opponent names are intentionally left out: match_players'
  // RLS policy lets any authenticated client read match rows generally, but
  // profiles' RLS only allows reading your OWN row, so opponents' display
  // names aren't resolvable from the client as things stand.
  window.ludoFetchMatches = async function (userId, limit) {
    const { data, error } = await window.ludoSupabase
      .from('match_players')
      .select('color, result, matches!inner(id, stake, finished_at, status)')
      .eq('user_id', userId)
      .eq('matches.status', 'finished')
      .order('finished_at', { foreignTable: 'matches', ascending: false })
      .limit(limit || 50);
    if (error) { console.error('[ludo] failed to fetch match history:', error); return []; }
    return data;
  };

  // How many players were actually at each of the given match ids — needed
  // to reconstruct the exact payout (pot = stake * playerCount, minus the
  // 10% fee), since that count isn't stored directly on matches itself.
  window.ludoFetchPlayerCounts = async function (matchIds) {
    if (matchIds.length === 0) return {};
    const { data, error } = await window.ludoSupabase
      .from('match_players')
      .select('match_id')
      .in('match_id', matchIds);
    if (error) { console.error('[ludo] failed to fetch match player counts:', error); return {}; }
    const counts = {};
    data.forEach(row => { counts[row.match_id] = (counts[row.match_id] || 0) + 1; });
    return counts;
  };
})();
