// Keeps installed-app (PWA) pages from running stale code.
//
// An iPhone home-screen app freezes the last page in memory and resumes it as-is, and a cold
// start can reuse a cached copy for up to GitHub Pages' 10-minute max-age — so after a deploy
// the installed app can keep showing the OLD UI until it is force-quit. On open, and every time
// the app comes back to the foreground, compare this page's Last-Modified (document.lastModified)
// with the server's current one and reload once if the server's is newer.
//
// Deliberately NOT loaded on game boards / waiting rooms: reloading mid-match would drop the player.
(function () {
  var GUARD = 'ludoUpdateReload';
  function reloadOnce() {
    // Never loop: at most one automatic reload per minute, even if a cache keeps serving the old copy.
    var last = Number(sessionStorage.getItem(GUARD) || 0);
    if (Date.now() - last < 60000) return;
    sessionStorage.setItem(GUARD, String(Date.now()));
    location.reload();
  }
  // Deployed pages have their asset links stamped "?v=<commit>" and the deploy writes the same commit to
  // version.txt. That works on any host (Cloudflare Pages etc. don't all send Last-Modified), so prefer it.
  async function checkVersion(mine) {
    var res = await fetch(new URL('version.txt', location.href).href + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return false;
    var latest = (await res.text()).trim();
    if (/^[0-9a-f]{6,40}$/.test(latest) && latest !== mine) reloadOnce();
    return true;
  }
  async function check() {
    try {
      var link = document.querySelector('link[href*="styles.css?v="]');
      var m = link && /[?&]v=([0-9a-f]+)/.exec(link.getAttribute('href'));
      if (m && await checkVersion(m[1])) return;
      var res = await fetch(location.pathname + location.search, { method: 'HEAD', cache: 'no-store' });
      var lm = res.headers.get('last-modified');
      if (!lm) return;
      var server = Date.parse(lm);
      var mine = Date.parse(document.lastModified);
      if (!isFinite(server) || !isFinite(mine) || server - mine < 2000) return;
      reloadOnce();
    } catch (e) { /* offline or storage blocked: just keep running what we have */ }
  }
  check();
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) check(); });
})();
