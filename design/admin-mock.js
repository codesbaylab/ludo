/* Admin analytics MOCKUP helpers — shell/navigation, SVG charts and deterministic fake data.
   Standalone: nothing here talks to Supabase or the game server. */
(function () {
  const COLORS = { orange: '#ff8a3d', pink: '#ff5c8a', green: '#2ecc71', blue: '#4da3ff', yellow: '#ffc93c', purple: '#9b7bff', red: '#ff5c5c', teal: '#26a69a', gray: '#b8a996' };
  const AVC = ['#ff5c5c', '#2ecc71', '#4da3ff', '#ffc93c', '#9b7bff', '#ff8a3d'];

  const NAV = [
    ['dashboard', '📊', 'Dashboard', 'admin-mock-dashboard.html'],
    ['users', '👥', 'Users', 'admin-mock-users.html'],
    ['finance', '💰', 'Finance', 'admin-mock-finance.html', '3'],
    ['games', '🎲', 'Games', 'admin-mock-games.html'],
    ['referrals', '🎁', 'Referrals', 'admin-mock-referrals.html'],
    ['risk', '🛡️', 'Risk & Fraud', 'admin-mock-risk.html', '5'],
    ['reports', '🧾', 'Reports', 'admin-mock-reports.html'],
    ['audit', '📜', 'Audit & Roles', 'admin-mock-audit.html'],
    ['settings', '⚙️', 'Settings & System', 'admin-mock-settings.html'],
  ];

  // ---------- deterministic fake data ----------
  function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function series(n, base, vol, trend, seed, weekly) {
    const r = rng(seed); const out = [];
    for (let i = 0; i < n; i++) {
      const wk = weekly ? 1 + 0.18 * Math.sin((i / 7) * Math.PI * 2 + 1) : 1;
      out.push(Math.max(0, Math.round((base + trend * i) * wk * (1 + (r() - 0.5) * vol))));
    }
    return out;
  }
  function dayLabels(n) {
    const end = new Date(2026, 9, 1); const out = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(end); d.setDate(end.getDate() - i); out.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })); }
    return out;
  }
  const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
  const num = (n) => Math.round(n).toLocaleString('en-IN');
  const short = (n) => n >= 1e7 ? (n / 1e7).toFixed(1) + 'Cr' : n >= 1e5 ? (n / 1e5).toFixed(1) + 'L' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(Math.round(n));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const NAMES = ['aghilraj11', 'Ravi K', 'Sana M', 'Jilna P', 'Arjun D', 'Meera S', 'Kabir A', 'Divya R', 'Nikhil T', 'Pooja V', 'Sameer H', 'Anita B', 'Rohit G', 'Lakshmi N', 'Imran Q', 'Tara C'];
  const PID = (i) => { const al = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; const r = rng(i * 97 + 13); let s = ''; for (let k = 0; k < 8; k++) s += al[Math.floor(r() * al.length)]; return s; };
  const av = (name, i) => `<span class="av" style="background:${AVC[(i || 0) % AVC.length]}">${name[0].toUpperCase()}</span>`;
  const who = (name, i, sub) => `<span class="who">${av(name, i)}<span>${name}${sub ? `<small>${sub}</small>` : ''}</span></span>`;
  const chip = (t, c) => `<span class="chip ${c || ''}">${t}</span>`;

  // ---------- SVG charts ----------
  function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
  let gid = 0;
  function spark(values, color, w, h) {
    w = w || 92; h = h || 34; const mx = Math.max.apply(null, values), mn = Math.min.apply(null, values); const rg = mx - mn || 1;
    const pts = values.map((v, i) => [i * (w / (values.length - 1)), h - 3 - ((v - mn) / rg) * (h - 8)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const id = 'sp' + (gid++);
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function frame(el, W, H, pad, maxV, fmt, labels) {
    const yt = 4; let g = '';
    for (let i = 0; i <= yt; i++) {
      const y = pad.t + (H - pad.t - pad.b) * (1 - i / yt);
      g += `<line class="gridl" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${(fmt || short)(maxV * i / yt)}</text>`;
    }
    const n = labels.length, step = Math.max(1, Math.round(n / 7));
    labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) g += `<text x="${xAt(i, n, W, pad)}" y="${H - 6}" text-anchor="middle">${l}</text>`; });
    return g;
  }
  function xAt(i, n, W, pad) { return n === 1 ? (pad.l + W - pad.r) / 2 : pad.l + (W - pad.l - pad.r) * i / (n - 1); }
  function tooltip(el, svgW, H, pad, labels, series, fmt, bandMode) {
    const tip = document.createElement('div'); tip.className = 'tip'; el.appendChild(tip);
    const svg = el.querySelector('svg'); const guide = svg.querySelector('.guide');
    svg.addEventListener('mousemove', (e) => {
      const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * svgW;
      const n = labels.length; let i;
      if (bandMode) { i = Math.floor((px - pad.l) / ((svgW - pad.l - pad.r) / n)); } else { i = Math.round((px - pad.l) / ((svgW - pad.l - pad.r) / Math.max(1, n - 1))); }
      i = Math.max(0, Math.min(n - 1, i));
      const x = bandMode ? pad.l + (svgW - pad.l - pad.r) * (i + .5) / n : xAt(i, n, svgW, pad);
      if (guide) { guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.style.opacity = 1; }
      tip.innerHTML = `<b>${labels[i]}</b>` + series.map((s) => `<div><i style="background:${s.color}"></i>${s.name}: ${(fmt || num)(s.values[i])}</div>`).join('');
      tip.style.left = (x / svgW * r.width) + 'px'; tip.style.top = '14px'; tip.style.opacity = 1;
    });
    svg.addEventListener('mouseleave', () => { tip.style.opacity = 0; if (guide) guide.style.opacity = 0; });
  }
  function line(el, o) {
    const W = o.w || 720, H = o.h || 250, pad = { l: 46, r: 12, t: 12, b: 26 };
    const all = o.series.reduce((a, s) => a.concat(s.values), []); const mx = niceMax(Math.max.apply(null, all) * 1.05);
    const n = o.labels.length; let body = '';
    o.series.forEach((s) => {
      const pts = s.values.map((v, i) => [xAt(i, n, W, pad), pad.t + (H - pad.t - pad.b) * (1 - v / mx)]);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      const id = 'ln' + (gid++);
      if (s.area !== false) body += `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".22"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L${pts[n - 1][0]} ${H - pad.b} L${pts[0][0]} ${H - pad.b} Z" fill="url(#${id})"/>`;
      body += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="6 5"' : ''}/>`;
    });
    el.classList.add('chart');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${frame(el, W, H, pad, mx, o.yfmt, o.labels)}${body}<line class="guide" y1="${pad.t}" y2="${H - pad.b}" stroke="${COLORS.gray}" stroke-width="1.5" style="opacity:0"/></svg>` +
      (o.legend === false ? '' : `<div class="legend">${o.series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`);
    tooltip(el, W, H, pad, o.labels, o.series, o.fmt, false);
  }
  function bars(el, o) {
    const W = o.w || 720, H = o.h || 250, pad = { l: 46, r: 12, t: 12, b: 26 };
    const n = o.labels.length; const stacked = !!o.stacked;
    const totals = o.labels.map((_, i) => stacked ? sum(o.series.map((s) => s.values[i])) : Math.max.apply(null, o.series.map((s) => s.values[i])));
    const mx = niceMax(Math.max.apply(null, totals) * 1.05); const band = (W - pad.l - pad.r) / n; const gap = Math.min(10, band * .25);
    let body = '';
    o.labels.forEach((_, i) => {
      let acc = 0; const bw = stacked ? band - gap : (band - gap) / o.series.length;
      o.series.forEach((s, k) => {
        const v = s.values[i]; const h = (H - pad.t - pad.b) * (v / mx);
        const x = pad.l + band * i + gap / 2 + (stacked ? 0 : bw * k); const y = stacked ? H - pad.b - acc - h : H - pad.b - h;
        body += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - (stacked ? 0 : 1)).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="${Math.min(5, bw / 3).toFixed(1)}" fill="${s.color}"/>`;
        acc += h;
      });
    });
    let g = ''; const yt = 4;
    for (let i = 0; i <= yt; i++) { const y = pad.t + (H - pad.t - pad.b) * (1 - i / yt); g += `<line class="gridl" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/><text x="${pad.l - 8}" y="${y + 4}" text-anchor="end">${(o.yfmt || short)(mx * i / yt)}</text>`; }
    const step = Math.max(1, Math.round(n / 8));
    o.labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) g += `<text x="${pad.l + band * (i + .5)}" y="${H - 6}" text-anchor="middle">${l}</text>`; });
    el.classList.add('chart');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}${body}<line class="guide" y1="${pad.t}" y2="${H - pad.b}" stroke="${COLORS.gray}" stroke-width="1.5" style="opacity:0"/></svg>` +
      (o.legend === false ? '' : `<div class="legend">${o.series.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>`);
    tooltip(el, W, H, pad, o.labels, o.series, o.fmt, true);
  }
  function donut(el, parts, center, sub) {
    const total = sum(parts.map((p) => p.value)); const R = 54, C = 2 * Math.PI * R; let off = 0, segs = '';
    parts.forEach((p) => { const len = C * p.value / total; segs += `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${p.color}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"/>`; off += len; });
    el.classList.add('chart');
    el.innerHTML = `<div class="donut-wrap"><svg viewBox="0 0 140 140" style="width:150px;height:150px"><circle cx="70" cy="70" r="${R}" fill="none" stroke="#f6e7da" stroke-width="22"/>${segs}<text x="70" y="68" text-anchor="middle" style="font-size:18px;font-weight:800;fill:var(--text)">${center || ''}</text><text x="70" y="85" text-anchor="middle" style="font-size:10px">${sub || ''}</text></svg>` +
      `<div class="donut-legend">${parts.map((p) => `<div><i style="background:${p.color}"></i>${p.label}<span>${p.fmt ? p.fmt : Math.round(p.value / total * 100) + '%'}</span></div>`).join('')}</div></div>`;
  }
  function heat(el, o) {
    const mx = Math.max.apply(null, o.data.reduce((a, r) => a.concat(r), []));
    el.innerHTML = `<div class="heat" style="grid-template-columns:42px repeat(${o.cols.length},1fr)"><span></span>${o.cols.map((c, i) => `<span style="text-align:center">${i % 2 === 0 ? c : ''}</span>`).join('')}` +
      o.rows.map((r, ri) => `<span>${r}</span>` + o.data[ri].map((v) => `<div class="cell" title="${v}" style="opacity:${(0.08 + 0.92 * v / mx).toFixed(2)}"></div>`).join('')).join('') + `</div>`;
  }
  function funnel(el, steps) {
    const mx = steps[0].value;
    el.className = (el.className || '') + ' funnel';
    el.innerHTML = steps.map((s, i) => `<div class="step"><div class="bar" style="width:${Math.max(26, s.value / mx * 100)}%;background:${s.color}"><span>${s.label}</span><span>${num(s.value)}</span></div>${i ? `<div class="conv">↳ ${(s.value / steps[i - 1].value * 100).toFixed(1)}% of previous · ${(s.value / mx * 100).toFixed(1)}% of start</div>` : ''}</div>`).join('');
  }
  function table(el, cols, rows, o) {
    o = o || {};
    el.innerHTML = `<div class="tbl-wrap"><table class="tbl${o.wide ? ' wide' : ''}"><thead><tr>${cols.map((c) => `<th class="${c.a || ''}">${c.l}</th>`).join('')}</tr></thead><tbody>` +
      rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.a || ''}">${typeof c.k === 'function' ? c.k(r) : (r[c.k] === undefined ? '' : r[c.k])}</td>`).join('')}</tr>`).join('') + `</tbody></table></div>` +
      (o.pager ? `<div class="pager"><span>Showing 1–${rows.length} of ${o.pager}</span><div class="pg"><button>‹</button><button class="on">1</button><button>2</button><button>3</button><span>…</span><button>›</button></div></div>` : '');
  }

  // ---------- interactions ----------
  function range(onChange) {
    const wrap = document.querySelector('.am-pills[data-range]'); let n = 30;
    if (wrap) wrap.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); n = Number(b.dataset.n); onChange(n);
    }));
    onChange(n);
  }
  function tabs(root) {
    root = root || document;
    root.querySelectorAll('.am-tabs[data-tabs]').forEach((bar) => {
      const group = bar.dataset.tabs;
      bar.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        bar.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
        document.querySelectorAll(`[data-tab-group="${group}"]`).forEach((p) => { p.style.display = p.dataset.tab === b.dataset.t ? '' : 'none'; });
      }));
    });
  }
  function chips(root) {
    (root || document).querySelectorAll('.seg-chips').forEach((bar) => bar.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      bar.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
    })));
  }
  function toggles() { document.querySelectorAll('.switch').forEach((s) => s.addEventListener('click', () => s.classList.toggle('on'))); }

  // ---------- page shell ----------
  function shell() {
    const b = document.body; b.classList.add('am');
    const page = b.dataset.page, title = b.dataset.title || '', sub = b.dataset.sub || '';
    const content = document.getElementById('page'); const tools = document.getElementById('tools');
    const nav = NAV.map((n) => `<a href="${n[3]}" class="${n[0] === page ? 'active' : ''}"><span class="ic">${n[1]}</span>${n[2]}${n[4] ? `<span class="count">${n[4]}</span>` : ''}</a>`).join('');
    const showRange = b.dataset.range !== 'off';
    const rangeHtml = showRange ? `<div class="am-pills" data-range><button data-n="7">7D</button><button data-n="30" class="on">30D</button><button data-n="90">90D</button><button data-n="180">6M</button></div>` : '';
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="am-banner">Design mockup only — fake data, not connected to the app. Click around to review the layout.</div>
      <div class="am-shell"><aside class="am-side">
        <div class="am-brand"><div class="dice">🛠️</div><div><b>Ludo Admin</b><span>Analytics & control</span></div></div>
        <nav class="am-nav">${nav}</nav>
        <div class="am-side-foot"><span class="av" style="background:#ff8a3d">A</span><div class="who">aghilraj11<small>Super admin</small></div>
          <a class="icon-btn" href="admin-mock-dashboard.html" title="Log out" aria-label="Log out"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></a></div>
      </aside><main class="am-main"><div class="am-top"><div><h1>${title}</h1><p>${sub}</p></div><div class="am-tools">${rangeHtml}<span id="tools-slot"></span></div></div><div id="mount"></div></main></div>`;
    document.body.insertBefore(wrap, document.body.firstChild);
    while (wrap.firstChild) document.body.insertBefore(wrap.firstChild, wrap);
    wrap.remove();
    document.getElementById('mount').appendChild(content); content.style.display = '';
    if (tools) document.getElementById('tools-slot').appendChild(tools);
    document.querySelectorAll('.am-pills[data-range]').forEach(function (w) { w.querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { w.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); }); b.classList.add('on'); }); }); });
    tabs(); chips(); toggles();
  }
  document.addEventListener('DOMContentLoaded', shell);

  window.AM = { COLORS, AVC, rng, series, dayLabels, inr, num, short, sum, NAMES, PID, av, who, chip, spark, line, bars, donut, heat, funnel, table, range, tabs, chips };
})();
