/* Admin core: auth guard, role handling, RPC helpers, formatting, SVG charts and the page shell.
   Every admin page loads this after supabase-client.js and ui-dialog.js, then calls AD.boot({...}). */
(function () {
  const sb = window.ludoSupabase;
  const COLORS = { orange: '#ff8a3d', pink: '#ff5c8a', green: '#2ecc71', blue: '#4da3ff', yellow: '#ffc93c', purple: '#9b7bff', red: '#ff5c5c', teal: '#26a69a', gray: '#b8a996' };
  const AVC = ['#ff5c5c', '#2ecc71', '#4da3ff', '#ffc93c', '#9b7bff', '#ff8a3d'];
  const NAV = [
    ['dashboard', '📊', 'Dashboard', 'admin.html'],
    ['users', '👥', 'Users', 'admin-users.html'],
    ['finance', '💰', 'Finance', 'admin-finance.html'],
    ['games', '🎲', 'Games', 'admin-games.html'],
    ['referrals', '🎁', 'Referrals', 'admin-referrals.html'],
    ['risk', '🛡️', 'Risk & Fraud', 'admin-risk.html'],
    ['reports', '🧾', 'Reports', 'admin-reports.html'],
    ['audit', '📜', 'Audit & Roles', 'admin-audit.html'],
    ['settings', '⚙️', 'Settings & System', 'admin-settings.html'],
  ];
  const ROLE_LABEL = { super: 'Super admin', finance: 'Finance', support: 'Support', analyst: 'Analyst (read-only)' };

  // ---------- formatting ----------
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Math.round(Number(n || 0)).toLocaleString('en-IN');
  const inr = (n) => { n = Number(n || 0); const neg = n < 0; return (neg ? '−' : '') + '₹' + Math.abs(Math.round(n * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }); };
  const short = (n) => { n = Number(n || 0); return n >= 1e7 ? (n / 1e7).toFixed(1) + 'Cr' : n >= 1e5 ? (n / 1e5).toFixed(1) + 'L' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n)); };
  const sum = (a) => (a || []).reduce((x, y) => x + Number(y || 0), 0);
  const dt = (ts) => ts ? new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  const dtFull = (ts) => ts ? new Date(ts).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  const ago = (ts) => {
    if (!ts) return '—'; const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 2) return 'yesterday'; if (s < 86400 * 30) return Math.floor(s / 86400) + ' d ago'; return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };
  const delta = (cur, prev) => {
    cur = Number(cur || 0); prev = Number(prev || 0);
    if (prev === 0) return cur === 0 ? { t: '0%', c: 'flat' } : { t: 'new', c: 'up' };
    const p = (cur - prev) / prev * 100; return { t: (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1) + '%', c: Math.abs(p) < 0.05 ? 'flat' : p > 0 ? 'up' : 'down' };
  };
  const av = (name, i) => `<span class="av" style="background:${AVC[(i || String(name || '?').length) % AVC.length]}">${esc((name || '?')[0].toUpperCase())}</span>`;
  const who = (name, i, sub) => `<span class="who">${av(name, i)}<span>${esc(name)}${sub ? `<small>${sub}</small>` : ''}</span></span>`;
  const chip = (t, c) => `<span class="chip ${c || ''}">${esc(t)}</span>`;
  const kpiCard = (label, value, d, metaText, spark) =>
    `<div class="am-card kpi"><div class="lbl">${esc(label)}</div><div class="val">${value}</div><div class="meta">${d ? `<span class="delta ${d.c}">${d.t}</span>` : ''}${esc(metaText || '')}</div>${spark || ''}</div>`;

  // ---------- data ----------
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error(error.message);
    return data;
  }
  // run an async admin action; show a friendly popup instead of throwing
  async function run(fn, o) {
    o = o || {};
    try { return await fn(); }
    catch (err) { console.error('[admin]', err); await ludoError(err && err.message ? err.message : err); return undefined; }
  }

  // ---------- SVG charts ----------
  let gid = 0;
  const niceMax = (v) => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
  const xAt = (i, n, W, pad) => (n === 1 ? (pad.l + W - pad.r) / 2 : pad.l + (W - pad.l - pad.r) * i / (n - 1));
  function spark(values, color, w, h) {
    values = (values && values.length > 1) ? values : [0, 0]; w = w || 92; h = h || 34;
    const mx = Math.max.apply(null, values), mn = Math.min.apply(null, values), rg = mx - mn || 1;
    const pts = values.map((v, i) => [i * (w / (values.length - 1)), h - 3 - ((v - mn) / rg) * (h - 8)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '); const id = 'sp' + (gid++);
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function tooltip(el, W, pad, labels, series, fmt, band) {
    const tip = document.createElement('div'); tip.className = 'tip'; el.appendChild(tip);
    const svg = el.querySelector('svg'); const guide = svg.querySelector('.guide');
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W; const n = labels.length; let i;
      i = band ? Math.floor((px - pad.l) / ((W - pad.l - pad.r) / n)) : Math.round((px - pad.l) / ((W - pad.l - pad.r) / Math.max(1, n - 1)));
      i = Math.max(0, Math.min(n - 1, i));
      const x = band ? pad.l + (W - pad.l - pad.r) * (i + .5) / n : xAt(i, n, W, pad);
      if (guide) { guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.style.opacity = 1; }
      tip.innerHTML = `<b>${esc(labels[i])}</b>` + series.map((s) => `<div><i style="background:${s.color}"></i>${esc(s.name)}: ${(fmt || num)(s.values[i])}</div>`).join('');
      tip.style.left = (x / W * r.width) + 'px'; tip.style.top = '14px'; tip.style.opacity = 1;
    });
    svg.addEventListener('mouseleave', () => { tip.style.opacity = 0; if (guide) guide.style.opacity = 0; });
  }
  function grid(W, H, pad, mx, yfmt, labels, band) {
    let g = ''; const yt = 4;
    for (let i = 0; i <= yt; i++) { const y = pad.t + (H - pad.t - pad.b) * (1 - i / yt); g += `<line class="gridl" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${(yfmt || short)(mx * i / yt)}</text>`; }
    const n = labels.length, step = Math.max(1, Math.round(n / (band ? 8 : 7)));
    labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) g += `<text x="${band ? pad.l + (W - pad.l - pad.r) * (i + .5) / n : xAt(i, n, W, pad)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; });
    return g;
  }
  function line(el, o) {
    if (!o.labels || !o.labels.length) { el.innerHTML = '<div class="empty-note">No data for this period yet.</div>'; return; }
    const W = o.w || 720, H = o.h || 250, pad = { l: 46, r: 12, t: 12, b: 26 };
    const all = o.series.reduce((a, s) => a.concat(s.values), []); const mx = niceMax(Math.max.apply(null, all.concat([1])) * 1.05); const n = o.labels.length; let body = '';
    o.series.forEach((s) => {
      const pts = s.values.map((v, i) => [xAt(i, n, W, pad), pad.t + (H - pad.t - pad.b) * (1 - v / mx)]);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '); const id = 'ln' + (gid++);
      if (s.area !== false) body += `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".22"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${pts[n - 1][0]} ${H - pad.b} L${pts[0][0]} ${H - pad.b} Z" fill="url(#${id})"/>`;
      body += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="6 5"' : ''}/>`;
    });
    el.classList.add('chart');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${grid(W, H, pad, mx, o.yfmt, o.labels, false)}${body}<line class="guide" y1="${pad.t}" y2="${H - pad.b}" stroke="${COLORS.gray}" stroke-width="1.5" style="opacity:0"/></svg>` +
      (o.legend === false ? '' : `<div class="legend">${o.series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`);
    tooltip(el, W, pad, o.labels, o.series, o.fmt, false);
  }
  function bars(el, o) {
    if (!o.labels || !o.labels.length) { el.innerHTML = '<div class="empty-note">No data for this period yet.</div>'; return; }
    const W = o.w || 720, H = o.h || 250, pad = { l: 46, r: 12, t: 12, b: 26 }; const n = o.labels.length; const stacked = !!o.stacked;
    const totals = o.labels.map((_, i) => stacked ? sum(o.series.map((s) => s.values[i])) : Math.max.apply(null, o.series.map((s) => Number(s.values[i] || 0))));
    const mx = niceMax(Math.max.apply(null, totals.concat([1])) * 1.05); const band = (W - pad.l - pad.r) / n; const gap = Math.min(10, band * .25); let body = '';
    o.labels.forEach((_, i) => {
      let acc = 0; const bw = stacked ? band - gap : (band - gap) / o.series.length;
      o.series.forEach((s, k) => {
        const v = Number(s.values[i] || 0); const h = (H - pad.t - pad.b) * (v / mx);
        const x = pad.l + band * i + gap / 2 + (stacked ? 0 : bw * k); const y = stacked ? H - pad.b - acc - h : H - pad.b - h;
        body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - (stacked ? 0 : 1)).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="${Math.min(5, bw / 3).toFixed(1)}" fill="${s.color}"/>`; acc += h;
      });
    });
    el.classList.add('chart');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${grid(W, H, pad, mx, o.yfmt, o.labels, true)}${body}<line class="guide" y1="${pad.t}" y2="${H - pad.b}" stroke="${COLORS.gray}" stroke-width="1.5" style="opacity:0"/></svg>` +
      (o.legend === false ? '' : `<div class="legend">${o.series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`);
    tooltip(el, W, pad, o.labels, o.series, o.fmt, true);
  }
  function donut(el, parts, center, sub) {
    const total = sum(parts.map((p) => p.value));
    if (!total) { el.innerHTML = '<div class="empty-note">Nothing to show yet.</div>'; return; }
    const R = 54, C = 2 * Math.PI * R; let off = 0, segs = '';
    parts.forEach((p) => { const len = C * p.value / total; segs += `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${p.color}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"/>`; off += len; });
    el.classList.add('chart');
    el.innerHTML = `<div class="donut-wrap"><svg viewBox="0 0 140 140" style="width:150px;height:150px"><circle cx="70" cy="70" r="${R}" fill="none" stroke="#f6e7da" stroke-width="22"/>${segs}<text x="70" y="68" text-anchor="middle" style="font-size:18px;font-weight:800;fill:var(--text)">${esc(center || '')}</text><text x="70" y="85" text-anchor="middle" style="font-size:10px">${esc(sub || '')}</text></svg>` +
      `<div class="donut-legend">${parts.map((p) => `<div><i style="background:${p.color}"></i>${esc(p.label)}<span>${p.fmt ? esc(p.fmt) : Math.round(p.value / total * 100) + '%'}</span></div>`).join('')}</div></div>`;
  }
  function heat(el, o) {
    const flat = o.data.reduce((a, r) => a.concat(r), []); const mx = Math.max.apply(null, flat.concat([1]));
    el.innerHTML = `<div class="heat" style="grid-template-columns:42px repeat(${o.cols.length},1fr)"><span></span>${o.cols.map((c, i) => `<span style="text-align:center">${i % 2 === 0 ? esc(c) : ''}</span>`).join('')}` +
      o.rows.map((r, ri) => `<span>${esc(r)}</span>` + o.data[ri].map((v) => `<div class="cell" title="${v}" style="opacity:${(0.06 + 0.94 * v / mx).toFixed(2)}"></div>`).join('')).join('') + `</div>`;
  }
  function funnel(el, steps) {
    const mx = Math.max(1, steps[0].value); el.classList.add('funnel');
    el.innerHTML = steps.map((s, i) => `<div class="step"><div class="bar" style="width:${Math.max(30, s.value / mx * 100)}%;background:${s.color}"><span>${esc(s.label)}</span><span>${num(s.value)}</span></div>${i ? `<div class="conv">↳ ${steps[i - 1].value ? (s.value / steps[i - 1].value * 100).toFixed(1) : '0.0'}% of previous · ${(s.value / mx * 100).toFixed(1)}% of start</div>` : ''}</div>`).join('');
  }
  // columns: [{ l: 'Label', a: 'r'|'c', k: row => html }]; every k() must escape user text itself (use AD.esc / AD.who)
  function table(el, cols, rows, o) {
    o = o || {};
    if (!rows.length) { el.innerHTML = `<div class="empty-note">${esc(o.empty || 'Nothing here yet.')}</div>`; return; }
    el.innerHTML = `<div class="tbl-wrap"><table class="tbl${o.wide ? ' wide' : ''}"><thead><tr>${cols.map((c) => `<th class="${c.a || ''}">${c.l}</th>`).join('')}</tr></thead><tbody>` +
      rows.map((r, ri) => `<tr${o.rowAttr ? ' ' + o.rowAttr(r, ri) : ''}>${cols.map((c) => `<td class="${c.a || ''}">${typeof c.k === 'function' ? c.k(r, ri) : esc(r[c.k])}</td>`).join('')}</tr>`).join('') + `</tbody></table></div>`;
  }
  function pager(el, o) { // o: { total, offset, limit, onPage }
    const pages = Math.max(1, Math.ceil(o.total / o.limit)); const cur = Math.floor(o.offset / o.limit) + 1;
    const from = o.total ? o.offset + 1 : 0, to = Math.min(o.total, o.offset + o.limit);
    const nums = []; for (let p = Math.max(1, cur - 2); p <= Math.min(pages, cur + 2); p++) nums.push(p);
    el.innerHTML = `<div class="pager"><span>Showing ${from}–${to} of ${num(o.total)}</span><div class="pg"><button data-p="${cur - 1}" ${cur <= 1 ? 'disabled' : ''}>‹</button>${nums.map((p) => `<button data-p="${p}" class="${p === cur ? 'on' : ''}">${p}</button>`).join('')}<button data-p="${cur + 1}" ${cur >= pages ? 'disabled' : ''}>›</button></div></div>`;
    el.querySelectorAll('button[data-p]').forEach((b) => b.addEventListener('click', () => { const p = Number(b.dataset.p); if (p >= 1 && p <= pages && p !== cur) o.onPage((p - 1) * o.limit); }));
  }

  // ---------- export ----------
  function csv(filename, columns, rows) {
    const q = (v) => { v = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const text = [columns.map((c) => q(c.label)).join(',')].concat(rows.map((r) => columns.map((c) => q(r[c.key])).join(','))).join('\r\n');
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- UI bits ----------
  function tabs(root) {
    (root || document).querySelectorAll('.am-tabs[data-tabs]').forEach((bar) => {
      const group = bar.dataset.tabs;
      bar.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        bar.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
        document.querySelectorAll(`[data-tab-group="${group}"]`).forEach((p) => { p.style.display = p.dataset.tab === b.dataset.t ? '' : 'none'; });
        if (AD.onTab) AD.onTab(group, b.dataset.t);
      }));
    });
  }
  function can(roles) { return AD.role === 'super' || (roles || []).indexOf(AD.role) >= 0; }
  function range(cb) {
    const wrap = document.querySelector('.am-pills[data-range]'); let n = 30;
    if (wrap) wrap.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); n = Number(b.dataset.n); cb(n);
    }));
    return n;
  }
  const GAME_SERVER_HTTP = (new URLSearchParams(location.search).get('server') || 'wss://ludo-x96u.onrender.com').replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  async function serverStatus() {
    const { data: { session } } = await sb.auth.getSession();
    // Render's free tier can take a minute to wake — don't let the page hang on it.
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 9000);
    try {
      const res = await fetch(GAME_SERVER_HTTP + '/api/admin/status', { headers: { Authorization: 'Bearer ' + session.access_token }, signal: ctl.signal });
      if (!res.ok) throw new Error('game server answered ' + res.status);
      return await res.json();
    } catch (e) { throw new Error(e && e.name === 'AbortError' ? 'no answer after 9 s (server asleep or restarting)' : e.message); }
    finally { clearTimeout(timer); }
  }

  // ---------- boot / shell ----------
  async function boot(cfg) {
    document.body.classList.add('am');
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = 'login.html'; return; }
    const { data: me } = await sb.from('profiles').select('id, display_name, is_admin, admin_role').eq('id', session.user.id).single();
    if (!me || !me.is_admin) {
      document.body.innerHTML = '<div style="padding:60px 20px;text-align:center;font-weight:800">Admins only — taking you back…</div>';
      setTimeout(() => { location.href = 'lobby.html'; }, 1200); return;
    }
    AD.me = me; AD.role = me.admin_role || 'super'; AD.session = session;
    const b = document.body; const page = b.dataset.page; const title = cfg.title || b.dataset.title || ''; const sub = cfg.sub || b.dataset.sub || '';
    const content = document.getElementById('page'); const tools = document.getElementById('tools');
    const nav = NAV.map((n) => `<a href="${n[3]}" class="${n[0] === page ? 'active' : ''}"><span class="ic">${n[1]}</span>${n[2]}<span class="count" data-badge="${n[0]}" style="display:none"></span></a>`).join('');
    const rangeHtml = cfg.range === false ? '' : `<div class="am-pills" data-range><button data-n="7">7D</button><button data-n="30" class="on">30D</button><button data-n="90">90D</button><button data-n="180">6M</button></div>`;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="am-shell"><aside class="am-side">
        <div class="am-brand"><div class="dice">🛠️</div><div><b>Ludo Admin</b><span>Analytics &amp; control</span></div></div>
        <nav class="am-nav">${nav}</nav>
        <div class="am-side-foot"><span class="av" style="background:#ff8a3d">${esc((me.display_name || 'A')[0].toUpperCase())}</span><div class="who">${esc(me.display_name)}<small>${esc(ROLE_LABEL[AD.role] || AD.role)}</small></div>
          <a class="icon-btn" id="ad-logout" href="#" title="Log out" aria-label="Log out"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></a></div>
      </aside><main class="am-main"><div class="am-top"><div><h1 id="ad-title">${esc(title)}</h1><p id="ad-sub">${esc(sub)}</p></div><div class="am-tools">${rangeHtml}<span id="tools-slot"></span></div></div><div id="mount"></div></main></div>`;
    while (wrap.firstChild) document.body.insertBefore(wrap.firstChild, document.body.firstChild);
    document.getElementById('mount').appendChild(content); content.style.display = '';
    if (tools) document.getElementById('tools-slot').appendChild(tools);
    document.getElementById('ad-logout').addEventListener('click', async (e) => {
      e.preventDefault();
      if (!(await ludoConfirm({ tone: 'info', icon: '👋', title: 'Log out?', message: 'You’ll need to log in again to open the admin area.', confirmText: 'Log out', cancelText: 'Stay' }))) return;
      await sb.auth.signOut(); location.href = 'login.html';
    });
    tabs();
    loadBadges();
    if (cfg.init) await run(() => cfg.init(AD));
  }
  async function loadBadges() {
    try {
      const [{ count: wd }, { count: rk }, { count: ap }] = await Promise.all([
        sb.from('crypto_withdrawals').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        sb.from('risk_alerts').select('*', { count: 'exact', head: true }).in('status', ['open', 'investigating']),
        sb.from('admin_approvals').select('*', { count: 'exact', head: true }).eq('status', 'pending')]);
      const set = (k, n) => { const el = document.querySelector(`[data-badge="${k}"]`); if (el && n) { el.textContent = n; el.style.display = ''; } };
      set('finance', (wd || 0) + (ap || 0)); set('risk', rk || 0);
    } catch (e) { /* badges are a nicety */ }
  }

  const AD = { sb, COLORS, AVC, esc, num, inr, short, sum, dt, dtFull, ago, delta, av, who, chip, kpiCard, rpc, run, spark, line, bars, donut, heat, funnel, table, pager, csv, tabs, can, range, serverStatus, boot, ROLE_LABEL, role: 'analyst', me: null };
  window.AD = AD;
})();
