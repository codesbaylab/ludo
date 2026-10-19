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

  // A user's own confirmed USDT deposits, newest first — wallet.html's
  // deposit history. RLS on crypto_deposits only allows reading your own
  // rows (same pattern as match_players), so this is exactly what actually
  // got credited to this user's wallet, not a claim/pending list.
  window.ludoFetchCryptoDeposits = async function (userId, limit) {
    const { data, error } = await window.ludoSupabase
      .from('crypto_deposits')
      .select('tx_hash, amount_usdt, inr_credited, detected_at, asset, chain')
      .eq('user_id', userId)
      .order('detected_at', { ascending: false })
      .limit(limit || 20);
    if (error) { console.error('[ludo] failed to fetch crypto deposits:', error); return []; }
    return data;
  };

  // Records a login/app-open for fraud checks (shared device/IP) and activity charts.
  // A random per-install device id lives in localStorage; failures never matter to the player.
  window.ludoLogEvent = async function (event) {
    try {
      let dev = null;
      try { dev = localStorage.getItem('ludo_device_id'); if (!dev) { dev = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); localStorage.setItem('ludo_device_id', dev); } } catch (e) { /* storage blocked */ }
      await Promise.race([window.ludoSupabase.rpc('log_player_event', { p_event: event, p_device_id: dev }), new Promise((r) => setTimeout(r, 1500))]);
    } catch (e) { /* analytics must never block the app */ }
  };

  // Admin announcement banner (app_settings.announcement), inserted at the top of .app.
  window.ludoShowAnnouncement = async function () {
    try {
      const { data } = await window.ludoSupabase.from('app_settings').select('announcement, announcement_on, announcement_tone').eq('id', true).single();
      if (!data || !data.announcement_on || !data.announcement) return;
      const tones = { info: ['#e8f3ff', '#4da3ff', 'ℹ️'], warn: ['#fff6dc', '#ffc93c', '⚠️'], ok: ['#e6f9ee', '#2ecc71', '✅'] };
      const t = tones[data.announcement_tone] || tones.info; const app = document.querySelector('.app'); if (!app) return;
      const el = document.createElement('div'); el.setAttribute('role', 'status');
      el.style.cssText = 'margin:0 0 12px;padding:10px 14px;border-radius:14px;border:2px solid ' + t[1] + ';background:' + t[0] + ';color:#4a3a2a;font-weight:700;font-size:14px;line-height:1.35';
      el.textContent = t[2] + ' ' + data.announcement; const tb = app.querySelector('.topbar'); if (tb) tb.after(el); else app.prepend(el);
    } catch (e) { /* optional */ }
  };

  // Is this user an admin? Used by login.html to route to admin.html instead
  // of lobby.html, and by admin.html itself to bounce non-admins away.
  window.ludoIsAdmin = async function (userId) {
    const { data } = await window.ludoSupabase.from('profiles').select('is_admin').eq('id', userId).single();
    return !!data?.is_admin;
  };
})();

// Dollar amount for display ($1,234.50): decimals only when the amount has cents. Wallet unit = 1 USDT = $1.
function ludoMoney(n) {
  const v = Number(n) || 0;
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

// Visible countdown for a reconnect attempt: writes "<label> m:ss" into el every half second and calls onExpire() at 0.
// reset() restarts the full window (used when the page comes back to the foreground - timers are throttled while hidden,
// so the time spent in the background must not eat the player's chance to reconnect).
function ludoCountdown(el, label, seconds, onExpire) {
  let end = Date.now() + seconds * 1000, done = false;
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const tick = () => {
    if (done) return;
    const left = end - Date.now();
    el.textContent = `${label} ${fmt(left)}`;
    if (left <= 0) { done = true; clearInterval(timer); onExpire(); }
  };
  const timer = setInterval(tick, 500);
  tick();
  return {
    stop() { done = true; clearInterval(timer); },
    reset() { if (!done) { end = Date.now() + seconds * 1000; tick(); } },
  };
}

// Remember the seat in a live room so a page the phone OS discarded (backgrounded PWA) can resume it on reopen.
// Key is per game ('ludoSeat' / 'rummySeat'); stale after 15 min; cleared on leave, game end, or any lobby tap.
function ludoSaveSeat(key, room) {
  try { if (room && room.reconnectionToken) localStorage.setItem(key, JSON.stringify({ token: room.reconnectionToken, ts: Date.now() })); } catch (e) { /* storage blocked */ }
}
function ludoReadSeat(key) {
  try {
    const s = JSON.parse(localStorage.getItem(key) || 'null');
    if (s && s.token && Date.now() - s.ts < 15 * 60 * 1000) return s;
  } catch (e) { /* ignore */ }
  return null;
}
function ludoClearSeat(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }

// Markup for an icon-only copy button; wire it up with ludoCopy().
const LUDO_COPY_BTN_INNER =
  '<svg class="ic-copy" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="3"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>' +
  '<svg class="ic-check" viewBox="0 0 24 24" aria-hidden="true"><polyline points="5 12.5 10 17.5 19 7"/></svg>';

/** Copy text to the clipboard and flash the button's check state. Returns true on success. */
async function ludoCopy(btn, text) {
  let ok = true;
  try { await navigator.clipboard.writeText(text); } catch { ok = false; }
  if (btn) {
    btn.classList.toggle('copied', ok);
    btn.setAttribute('aria-label', ok ? 'Copied' : 'Copy failed');
    setTimeout(() => { btn.classList.remove('copied'); btn.setAttribute('aria-label', 'Copy'); }, 1500);
  }
  return ok;
}

// Compact dollar amount for tight spots (stat tiles): $1.2K, $5.1M; small amounts use ludoMoney.
function ludoMoneyShort(n) {
  const v = Math.abs(Number(n) || 0);
  const trim = (x) => String(Math.round(x * 100) / 100);
  if (v >= 1e9) return '$' + trim(v / 1e9) + 'B';
  if (v >= 1e6) return '$' + trim(v / 1e6) + 'M';
  if (v >= 1e4) return '$' + trim(v / 1e3) + 'K';
  return ludoMoney(v);
}

function ludoEscapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Everything that moved this user's money, newest first, merged from four sources:
 * cash match results, USDT/USDC deposits, withdrawal requests and player transfers.
 * Each entry: { type: 'match'|'deposit'|'withdrawal'|'sent'|'received', time, icon, iconBg, title, detail, delta }.
 * (delta is in dollars, signed.) Shared by wallet.html and history.html.
 */
async function ludoFetchTransactions(userId, limit) {
  const n = limit || 50;
  const [matches, deposits, wd, tr] = await Promise.all([
    ludoFetchMatches(userId, n),
    ludoFetchCryptoDeposits(userId, n),
    window.ludoSupabase.from('crypto_withdrawals').select('amount_inr, destination_address, status, tx_hash, requested_at').eq('user_id', userId).order('requested_at', { ascending: false }).limit(n),
    window.ludoSupabase.rpc('my_transfers', { p_limit: n }),
  ]);
  const staked = matches.filter((m) => m.matches.stake > 0);
  const counts = await ludoFetchPlayerCounts(staked.map((m) => m.matches.id));
  const entries = [];
  staked.forEach((m) => {
    const won = m.result === 'win';
    const stake = Number(m.matches.stake);
    const pot = stake * (counts[m.matches.id] || 2);
    const payout = pot - Math.round(pot * 0.1);
    entries.push({
      type: 'match', time: m.matches.finished_at, icon: won ? '🏆' : '🎲',
      iconBg: won ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'linear-gradient(135deg, var(--red), #c93a3a)',
      title: won ? 'Match Winnings' : 'Table Stake', detail: `${ludoMoney(stake)} table`,
      delta: won ? payout - stake : -stake,
    });
  });
  deposits.forEach((d) => {
    if (!(Number(d.inr_credited) > 0)) return; // dust that credited nothing
    entries.push({
      type: 'deposit', time: d.detected_at, icon: '💵', iconBg: 'linear-gradient(135deg, #26a17b, #178a4c)',
      title: (d.asset || 'USDT') + ' Deposit', detail: `${Number(d.amount_usdt).toFixed(2)} ${d.asset || 'USDT'} (${d.chain === 'solana' ? 'Solana' : 'BSC'})`,
      delta: Number(d.inr_credited),
    });
  });
  (wd.data || []).forEach((w) => {
    const label = w.status === 'pending' ? '⏳ Pending' : w.status === 'paid' ? '✅ Paid' : '❌ Rejected (refunded)';
    const a = w.destination_address;
    entries.push({
      type: 'withdrawal', time: w.requested_at, icon: '⬆️', iconBg: 'linear-gradient(135deg, #ff8a3d, #ff5c8a)',
      title: 'USDT Withdrawal', detail: `${a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : a} · ${label}`,
      delta: -Number(w.amount_inr),
    });
  });
  (tr.data || []).forEach((t) => {
    const sent = t.direction === 'sent';
    entries.push({
      type: sent ? 'sent' : 'received', time: t.created_at, icon: sent ? '➡️' : '⬅️',
      iconBg: sent ? 'linear-gradient(135deg, #8ec5ff, #4da3ff)' : 'linear-gradient(135deg, #7fe3a6, #2ecc71)',
      title: sent ? `Sent to ${ludoEscapeHtml(t.counterparty)}` : `Received from ${ludoEscapeHtml(t.counterparty)}`,
      detail: 'Player transfer', delta: sent ? -Number(t.amount) : Number(t.amount),
    });
  });
  entries.sort((a, b) => new Date(b.time) - new Date(a.time));
  return entries;
}

/** One transaction row (shared markup for wallet.html and history.html). */
function ludoTxRowHtml(e) {
  return `
    <div class="avatar" style="width:34px; height:34px; font-size:15px; background:${e.iconBg};">${e.icon}</div>
    <div style="min-width:0;">
      <div class="name">${e.title}</div>
      <div class="status">${ludoTimeAgo(e.time)} · ${e.detail}</div>
    </div>
    <span class="badge ${e.delta >= 0 ? 'badge-ready' : 'badge-waiting'}">${e.delta >= 0 ? '+' : '−'}${ludoMoney(Math.abs(e.delta))}</span>`;
}

// Practice games vs the computer (own rows only; written by the game server).
async function ludoFetchBotMatches(userId, limit) {
  const { data, error } = await window.ludoSupabase
    .from('bot_matches')
    .select('color, result, player_count, finished_at')
    .eq('user_id', userId)
    .order('finished_at', { ascending: false })
    .limit(limit || 50);
  if (error) { console.error('[ludo] failed to fetch practice games:', error); return []; }
  return data;
}
