/* The live link from a screen to the platform server.
   Down: Server-Sent Events (init, cfg, snap = the whole shared case record, hb = heartbeat).
   Up: each action is POSTed to /api/ops with a unique id; the server stores it once, so a resend is harmless.
   The screen is told the link is down when the stream errors or no heartbeat arrives for STALE_MS. */
(function () {
  'use strict';
  const STALE_MS = 12000;

  function Live(opts) {
    const onMsg = opts.onMsg, view = opts.view || '';
    let es = null, up = false, last = 0, cad = null, epoch = null, started = false;

    const set = v => { if (v === up) return; up = v; onMsg({ t: 'net', up: v }); };
    const seen = () => { last = Date.now(); };

    function connect() {
      if (es) es.close();
      es = new EventSource('/api/stream' + (view ? '?view=' + view : ''));
      es.addEventListener('init', e => {
        const d = JSON.parse(e.data); seen();
        /* a reconnection to the same case is not a fresh start; a new incident or a reset is */
        if (!started || d.cad !== cad || d.epoch !== epoch) {
          started = true; cad = d.cad; epoch = d.epoch;
          onMsg({ t: 'init', T0: d.now, base: Date.now(), cad: d.cad, epoch: d.epoch });
        } else onMsg({ t: 'clock', T0: d.now, base: Date.now() });
        set(true);
      });
      es.addEventListener('cfg', e => { seen(); onMsg({ t: 'cfg', sim: JSON.parse(e.data).sim }); });
      es.addEventListener('snap', e => { seen(); const d = JSON.parse(e.data); set(true); onMsg({ t: 'snap', rec: d.rec, at: d.at }); });
      es.addEventListener('hb', e => { seen(); set(true); onMsg({ t: 'hb', at: JSON.parse(e.data).at }); });
      es.onerror = () => {
        set(false);
        /* a closed stream (server restarted, or the login expired) is reopened by hand; check the login first */
        if (es.readyState === 2) setTimeout(() => fetch('/api/me', { cache: 'no-store' }).then(r => { if (r.status === 401) location.href = '/login?next=' + encodeURIComponent(location.pathname); else connect(); }, () => setTimeout(connect, 2000)), 1500);
      };
    }
    setInterval(() => { if (up && Date.now() - last > STALE_MS) { set(false); connect(); } }, 2000);
    /* Safari pauses a page in the background; on return, check the link at once rather than trusting old data */
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - last > 6000) { set(false); connect(); } });
    addEventListener('online', () => connect());
    addEventListener('offline', () => set(false));

    /* send actions in order. Resolves with the server's per-action results; rejects when the server cannot be reached */
    function send(ops) {
      return fetch('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops }), cache: 'no-store' })
        .then(r => {
          if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname); throw new Error('login'); }
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
    }

    /* upload one image (Blob) with progress; resolves {id, url} */
    function upload(blob, params, onProgress) {
      return new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('POST', '/api/images?' + new URLSearchParams(params));
        x.setRequestHeader('Content-Type', blob.type || 'image/jpeg');
        x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
        x.onload = () => { if (x.status === 200) resolve(JSON.parse(x.responseText)); else reject(new Error('Upload failed: HTTP ' + x.status + ' ' + x.responseText)); };
        x.onerror = () => reject(new Error('Upload failed: no connection'));
        x.timeout = 30000; x.ontimeout = () => reject(new Error('Upload timed out'));
        x.send(blob);
      });
    }

    connect();
    return { send, upload, isUp: () => up, cad: () => cad, epoch: () => epoch };
  }

  window.Live = Live;
  window.dataUrlToBlob = function (u) {
    const [h, b] = u.split(','), mime = (h.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(b), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: mime });
  };
  window.logout = function () { fetch('/api/logout', { method: 'POST' }).finally(() => { location.href = '/login'; }); };
})();
