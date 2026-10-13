// The only place with deployment-specific addresses. Changing domain/host = edit this file.
// (Pages still accept a ?server= query override for local dev and testing.)
window.LUDO_CONFIG = {
  // Colyseus game server + crypto API (wss:// for WebSocket; https:// is derived from it where needed).
  SERVER_URL: 'wss://ludo-x96u.onrender.com',
};
