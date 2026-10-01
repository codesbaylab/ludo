// Shared popup dialogs — replaces the browser's plain confirm()/alert().
// Styles live in styles.css (.dlg-*). All text is set via textContent, so
// callers can pass raw error messages / user names safely.
//
//   const ok = await ludoConfirm({ tone, icon, title, message, detail, confirmText, cancelText });
//   ludoAlert({ tone, icon, title, message, confirmText })   // or ludoAlert('message')
//   ludoError('message')                                     // red "Something went wrong"
//
// `detail` is an optional list of [label, value] rows. Resolves true on the
// confirm button / Enter, false on cancel / Escape / backdrop tap.
(function () {
  const DEFAULT_ICONS = { accent: '👑', danger: '❌', warn: '⚠️', success: '✅', info: 'ℹ️' };

  function ludoDialog({ tone = 'accent', icon, title, message, detail = [], confirmText = 'OK', cancelText = null }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'dlg-overlay';

      const dlg = document.createElement('div');
      dlg.className = 'dlg tone-' + tone;
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');

      const iconEl = document.createElement('div');
      iconEl.className = 'dlg-icon';
      iconEl.textContent = icon || DEFAULT_ICONS[tone] || 'ℹ️';
      dlg.appendChild(iconEl);

      const h = document.createElement('h3');
      h.textContent = title || '';
      dlg.appendChild(h);

      const p = document.createElement('p');
      p.className = 'dlg-msg';
      p.textContent = message || '';
      dlg.appendChild(p);

      if (detail.length) {
        const box = document.createElement('div');
        box.className = 'dlg-detail';
        detail.forEach(([label, value]) => {
          const row = document.createElement('div');
          row.className = 'row';
          const a = document.createElement('span'); a.textContent = label;
          const b = document.createElement('span'); b.textContent = value;
          row.append(a, b);
          box.appendChild(row);
        });
        dlg.appendChild(box);
      }

      const actions = document.createElement('div');
      actions.className = 'dlg-actions';
      if (cancelText) {
        const cancel = document.createElement('button');
        cancel.className = 'btn btn-secondary';
        cancel.textContent = cancelText;
        cancel.addEventListener('click', () => close(false));
        actions.appendChild(cancel);
      }
      const ok = document.createElement('button');
      ok.className = 'btn btn-primary';
      ok.textContent = confirmText;
      ok.addEventListener('click', () => close(true));
      actions.appendChild(ok);
      dlg.appendChild(actions);

      overlay.appendChild(dlg);

      function close(value) {
        document.removeEventListener('keydown', onKey, true);
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
        resolve(value);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(false); }
        else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); }
      }
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('open'));
      ok.focus();
    });
  }

  window.ludoDialog = ludoDialog;
  window.ludoConfirm = (opts) => ludoDialog({ cancelText: 'Cancel', confirmText: 'Confirm', ...opts });
  window.ludoAlert = (opts) => ludoDialog(typeof opts === 'string' ? { tone: 'info', title: 'Notice', message: opts } : { tone: 'info', ...opts });
  window.ludoError = (message) => ludoDialog({ tone: 'danger', title: 'Something went wrong', message: String(message || 'Unknown error'), confirmText: 'Got it' });
})();
