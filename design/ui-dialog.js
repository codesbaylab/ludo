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


  // ludoForm({ tone, icon, title, message, fields: [{ name, label, type, placeholder, value, required, options, rows, hint }], confirmText, cancelText })
  // -> resolves { name: value, ... } or null if cancelled. Required fields keep the confirm button disabled until filled.
  function ludoForm(o) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'dlg-overlay';
      const dlg = document.createElement('div');
      dlg.className = 'dlg tone-' + (o.tone || 'accent');
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      const icon = document.createElement('div'); icon.className = 'dlg-icon'; icon.textContent = o.icon || DEFAULT_ICONS[o.tone || 'accent'] || 'ℹ️'; dlg.appendChild(icon);
      const h = document.createElement('h3'); h.textContent = o.title || ''; dlg.appendChild(h);
      if (o.message) { const p = document.createElement('p'); p.className = 'dlg-msg'; p.textContent = o.message; dlg.appendChild(p); }
      const form = document.createElement('div'); form.className = 'dlg-form';
      const inputs = {};
      (o.fields || []).forEach((f) => {
        const wrap = document.createElement('label'); wrap.className = 'dlg-field';
        const lab = document.createElement('span'); lab.textContent = f.label + (f.required ? ' *' : ''); wrap.appendChild(lab);
        let el;
        if (f.type === 'select') {
          el = document.createElement('select');
          (f.options || []).forEach(([v, text]) => { const op = document.createElement('option'); op.value = v; op.textContent = text; el.appendChild(op); });
        } else if (f.type === 'textarea') {
          el = document.createElement('textarea'); el.rows = f.rows || 3;
        } else {
          el = document.createElement('input'); el.type = f.type || 'text';
          if (f.step) el.step = f.step;
        }
        if (f.placeholder) el.placeholder = f.placeholder;
        if (f.value !== undefined) el.value = f.value;
        el.className = 'input';
        wrap.appendChild(el);
        if (f.hint) { const hint = document.createElement('small'); hint.textContent = f.hint; wrap.appendChild(hint); }
        inputs[f.name] = el; form.appendChild(wrap);
      });
      dlg.appendChild(form);
      const actions = document.createElement('div'); actions.className = 'dlg-actions';
      const cancel = document.createElement('button'); cancel.className = 'btn btn-secondary'; cancel.textContent = o.cancelText || 'Cancel';
      const ok = document.createElement('button'); ok.className = 'btn btn-primary'; ok.textContent = o.confirmText || 'Confirm';
      actions.append(cancel, ok); dlg.appendChild(actions); overlay.appendChild(dlg);
      const valid = () => (o.fields || []).every((f) => !f.required || String(inputs[f.name].value).trim() !== '');
      const refresh = () => { ok.disabled = !valid(); };
      Object.values(inputs).forEach((el) => el.addEventListener('input', refresh));
      function close(value) { document.removeEventListener('keydown', onKey, true); overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); resolve(value); }
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(null); } }
      cancel.addEventListener('click', () => close(null));
      ok.addEventListener('click', () => { if (!valid()) return; const out = {}; Object.keys(inputs).forEach((k) => { out[k] = inputs[k].value; }); close(out); });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('open'));
      refresh();
      const first = Object.values(inputs)[0]; if (first) first.focus();
    });
  }
  window.ludoForm = ludoForm;

  window.ludoDialog = ludoDialog;
  window.ludoConfirm = (opts) => ludoDialog({ cancelText: 'Cancel', confirmText: 'Confirm', ...opts });
  window.ludoAlert = (opts) => ludoDialog(typeof opts === 'string' ? { tone: 'info', title: 'Notice', message: opts } : { tone: 'info', ...opts });
  window.ludoError = (message) => ludoDialog({ tone: 'danger', title: 'Something went wrong', message: String(message || 'Unknown error'), confirmText: 'Got it' });
})();
