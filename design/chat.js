// Quick chat: a 💬 button opens a tray of emoji + preset phrases; messages appear as short bubbles for everyone.
// The server only accepts the ids below (see server/src/chat.ts), so keep the two lists in sync.
(function () {
  const EMOJI = ['👍', '😂', '😮', '😡', '👏', '🔥', '😎', '🙏'];               // ids e0..e7
  const PHRASES = [['gg', 'Good game!'], ['nice', 'Nice move!'], ['oops', 'Oops!'], ['hurry', 'Hurry up!'],
    ['wp', 'Well played'], ['thanks', 'Thanks!'], ['hello', 'Hello 👋'], ['unlucky', 'Unlucky!']];
  const textOf = (id) => {
    const m = /^e(\d)$/.exec(id);
    if (m) return { text: EMOJI[Number(m[1])] || '', big: true };
    const p = PHRASES.find((x) => x[0] === id);
    return { text: p ? p[1] : '', big: false };
  };
  let room = null, btn, tray, feed, muteBtn, cooling = false, built = false;
  const muted = () => { try { return localStorage.getItem('ludoChatMuted') === '1'; } catch (e) { return false; } };

  function build(opts) {
    if (built) return; built = true;
    const host = document.querySelector('.app') || document.body;
    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'chat-btn chat-' + (opts.anchor || 'br'); btn.setAttribute('aria-label', 'Quick chat'); btn.textContent = '💬';
    tray = document.createElement('div'); tray.className = 'chat-tray chat-' + (opts.anchor || 'br');
    tray.innerHTML = '<div class="chat-emoji"></div><div class="chat-phrases"></div><button type="button" class="chat-mute"></button>';
    feed = document.createElement('div'); feed.className = 'chat-feed';
    host.append(btn, tray, feed);
    const eRow = tray.querySelector('.chat-emoji'), pRow = tray.querySelector('.chat-phrases');
    EMOJI.forEach((e, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = e; b.addEventListener('click', () => send('e' + i)); eRow.appendChild(b); });
    PHRASES.forEach(([id, t]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.addEventListener('click', () => send(id)); pRow.appendChild(b); });
    muteBtn = tray.querySelector('.chat-mute');
    const paintMute = () => { muteBtn.textContent = muted() ? '🔇 Chat is muted — tap to unmute' : '🔊 Mute other players\' chat'; btn.classList.toggle('muted', muted()); };
    muteBtn.addEventListener('click', () => { try { localStorage.setItem('ludoChatMuted', muted() ? '0' : '1'); } catch (e) {} paintMute(); });
    paintMute();
    btn.addEventListener('click', () => tray.classList.toggle('open'));
    document.addEventListener('pointerdown', (e) => { if (tray.classList.contains('open') && !tray.contains(e.target) && !btn.contains(e.target)) tray.classList.remove('open'); });
  }

  function send(id) {
    if (!room || cooling) return;
    cooling = true; tray.classList.add('cooling'); setTimeout(() => { cooling = false; tray.classList.remove('cooling'); }, 1200);
    try { room.send('chat', { id }); } catch (e) { /* offline: ignore */ }
    tray.classList.remove('open');
  }

  function show(msg) {
    if (!msg || !msg.id) return;
    const mine = room && msg.sid === room.sessionId;
    if (!mine && muted()) return;
    const t = textOf(msg.id); if (!t.text) return;
    const el = document.createElement('div');
    el.className = 'chat-bubble' + (t.big ? ' big' : '') + (mine ? ' mine' : '');
    const who = document.createElement('b'); who.textContent = mine ? 'You' : String(msg.name || 'Player').slice(0, 20);
    const body = document.createElement('span'); body.textContent = t.text;
    el.append(who, body);
    feed.appendChild(el);
    while (feed.children.length > 3) feed.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
  }

  window.ludoChat = {
    // Call once per page (anchor: 'br' bottom-right, 'tl' top-left) and again with each new room object after a reconnect.
    attach(r, opts) { build(opts || {}); room = r; r.onMessage('chat', show); },
  };
})();
