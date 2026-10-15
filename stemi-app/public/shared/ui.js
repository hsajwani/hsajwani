/* Shared screen helpers for every role (design system: public/shared/ds.css).
   Small and dependency-free: escaping, the server clock, icons, status badges, dialogs, toasts, the top bar and the
   connection status. Exposed as window.UI. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const APP = window.APP || {};

  /* ---------- the server's clock: every time on every screen is the platform's time ---------- */
  let off = 0;
  const now = () => Date.now() + off;
  const setClock = serverNow => { off = serverNow - Date.now(); };
  const p2 = n => String(n).padStart(2, '0');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hm = t => { if (!t) return '–'; const d = new Date(t); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const hms = t => { if (!t) return '–'; const d = new Date(t); return hm(t) + ':' + p2(d.getSeconds()); };
  const day = t => { const d = new Date(t); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  /* "10:42", or "14 Oct 10:42" when it was not today */
  const when = t => { if (!t) return '–'; return sameDay(t, now()) ? hm(t) : `${new Date(t).getDate()} ${MON[new Date(t).getMonth()]} ${hm(t)}`; };
  function dur(ms) {
    ms = Math.max(0, ms); const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${p2(m % 60)} min`;
  }
  const ago = t => (t ? `${dur(now() - t)} ago` : '');
  const rid = () => Math.random().toString(36).slice(2, 10);

  /* ---------- icons (24 × 24, stroked) ---------- */
  const P = {
    ecg: '<path d="M2 12h4l2-5 4 10 2.5-7L16 12h6"/>',
    alert: '<path d="M12 3.5 2.5 20h19L12 3.5z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.7L16.5 9"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    'chev-left': '<path d="m15 5-7 7 7 7"/>',
    'chev-right': '<path d="m9 5 7 7-7 7"/>',
    'chev-down': '<path d="m5 9 7 7 7-7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    'zoom-in': '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
    'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    fit: '<path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"/><rect x="8" y="9" width="8" height="6" rx="1"/>',
    compare: '<rect x="3" y="5" width="7.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="7.5" height="14" rx="1.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    'wifi-off': '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.5a10 10 0 0 1 4.2-2.4M19 12.5a10 10 0 0 0-3-2"/><path d="M12 20h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    escalate: '<path d="M7 17 17 7M8 7h9v9"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 16-5-5-9 8"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    send: '<path d="M4 12 20 4l-5 16-3-7z"/><path d="m12 13 8-9"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
    'x-circle': '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    steth: '<path d="M6 3v6a5 5 0 0 0 10 0V3"/><path d="M11 14v2a4 4 0 0 0 8 0v-2"/><circle cx="19" cy="12" r="2"/>',
    er: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
    ambulance: '<path d="M3 7h10v9H3zM13 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/><path d="M8 9.5v4M6 11.5h4"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7v.5M12 17v.01"/>',
    home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
    dot: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
    'minus-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    timeline: '<path d="M6 4v16"/><circle cx="6" cy="7" r="2"/><circle cx="6" cy="17" r="2"/><path d="M11 7h9M11 17h9M11 12h6"/>',
    console: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9l3 2.5L7 14M12 14h5"/><path d="M8 21h8"/>'
  };
  const icon = (name, cls) => `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || P.dot}</svg>`;

  /* ---------- status badges ---------- */
  const STATE_ICON = { draft: 'edit', sent_to_er: 'send', er_reviewing: 'eye', er_closed: 'lock', cardiology_activated: 'bell', cardiologist_reviewing: 'eye',
    repeat_requested: 'repeat', repeat_received: 'ecg', confirmed: 'alert', not_stemi_closed: 'lock', completed: 'check-circle', sending: 'upload' };
  function badge(state, role, lg) {
    const [l, tone] = state === 'sending' ? ['SENDING…', 'info'] : window.RULES.label(state, role);
    return `<span class="badge tone-${tone}${lg ? ' badge--lg' : ''}">${icon(STATE_ICON[state] || 'dot')}<span>${esc(l)}</span></span>`;
  }

  /* ---------- toast ---------- */
  let toastT = null;
  function toast(msg, kind) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    t.className = 'toast' + (kind === 'err' ? ' toast--err' : '');
    t.innerHTML = icon(kind === 'err' ? 'alert' : 'check-circle') + `<span>${esc(msg)}</span>`;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 6000 : 3200);
  }

  const hideToast = () => { const t = $('#toast'); if (t) t.hidden = true; clearTimeout(toastT); };

  /* ---------- dialogs: focus kept inside, Escape and the backdrop close unless the dialog is locked,
     focus returns to what opened it. A bottom sheet on a phone (CSS). ---------- */
  const modal = (() => {
    let root = null, opener = null, opts = {};
    function open(html, o) {
      const wasOpen = isOpen();
      opts = o || {};
      if (!wasOpen) opener = document.activeElement;
      if (!root) { root = document.createElement('div'); root.id = 'modal-root'; document.body.appendChild(root); }
      root.className = 'modal-root';
      root.hidden = false;
      root.innerHTML = `<div class="modal-backdrop" data-modal-backdrop></div><div class="modal${opts.cls ? ' ' + opts.cls : ''}" role="${opts.alert ? 'alertdialog' : 'dialog'}" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">${html}</div>`;
      const m = root.querySelector('.modal'), f = opts.focus && root.querySelector(opts.focus);
      (f || m).focus({ preventScroll: true });
      document.documentElement.style.overflow = 'hidden';
    }
    function close() {
      if (!isOpen()) return;
      root.hidden = true; root.innerHTML = '';
      document.documentElement.style.overflow = '';
      const cb = opts.onClose; opts = {};
      if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
      opener = null;
      if (cb) cb();
    }
    const isOpen = () => !!root && !root.hidden && !!root.innerHTML;
    /* replace one part of the open dialog (keeps the focus and what is typed elsewhere in it) */
    function patch(sel, html) { const el = isOpen() && root.querySelector(sel); if (el && el._h !== html) { el.innerHTML = html; el._h = html; } }
    document.addEventListener('keydown', e => {
      if (!isOpen()) return;
      if (e.key === 'Escape' && !opts.locked) { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        const f = $$('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])', root.querySelector('.modal')).filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === a || !root.contains(document.activeElement))) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest) return;
      if (e.target.closest('[data-act="modal-close"]') || (e.target.closest('[data-modal-backdrop]') && !opts.locked)) close();
    });
    return { open, close, isOpen, patch, el: () => root, opts: () => opts };
  })();
  /* a dialog body: title, content, footer */
  const dlg = (title, body, foot, o) => `<div class="modal__h"><div style="flex:1;min-width:0">${o && o.over ? `<div class="overline">${o.over}</div>` : ''}<h2 id="modal-title">${title}</h2></div>${o && o.noClose ? '' : `<button class="icon-btn modal__close" data-act="modal-close" aria-label="Close">${icon('x')}</button>`}</div><div class="modal__b">${body}</div>${foot ? `<div class="modal__f">${foot}</div>` : ''}`;

  /* ---------- the connection status, only claiming what is true ---------- */
  function conn(state) {
    if (state === 'up') return '<span class="conn" role="status">Connected</span>';
    if (state === 'offline') return '<span class="conn conn--offline" role="status">Offline — changes saved locally</span>';
    if (state === 'wait') return '<span class="conn conn--wait" role="status">Connecting…</span>';
    return '<span class="conn conn--down" role="status">Connection lost — reconnecting</span>';
  }
  /* the top bar shared by every role */
  function topbar(o) {
    return `<header class="topbar"><div class="topbar__in">
      <a class="brand" href="${o.home || '#'}" ${o.homeAct ? `data-act="${o.homeAct}"` : ''} aria-label="STEMI Coordination · ${esc(o.role)} · home"><span class="brand__mark">${icon('ecg')}</span><span class="brand__name">STEMI Coordination</span><span class="brand__role">${esc(o.role)}</span></a>
      <span class="topbar__sp"></span>
      <span id="tb-conn">${o.conn == null ? conn('wait') : o.conn}</span>
      ${o.right || ''}
      <span class="tb-version" title="Test build · fictional data only">TEST · v${esc(APP.version || '')}</span>
    </div></header>`;
  }
  const empty = (ic, title, text) => `<div class="empty">${icon(ic)}<b>${title}</b>${text ? `<span>${text}</span>` : ''}</div>`;

  /* patch an element's HTML only when it changed (keeps scroll position and focus elsewhere) */
  function patch(el, html) { if (typeof el === 'string') el = document.getElementById(el); if (el && el._h !== html) { el.innerHTML = html; el._h = html; return true; } return false; }

  window.UI = { $, $$, esc, now, setClock, hm, hms, day, when, dur, ago, rid, icon, badge, toast, hideToast, modal, dlg, conn, topbar, empty, patch, APP };
})();
