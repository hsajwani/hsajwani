/* The live link from a screen to the platform server.
   Down: Server-Sent Events — init (server clock, data epoch), cfg (test simulation), cases (every case this screen may
   see, on connecting), case (one case changed; rec null = no longer on this screen), presence (test console), hb.
   Up: each action is POSTed to /api/ops with a unique id; the server stores it once, so a resend is harmless.
   Every request names the screen's role (X-Stemi-Role), which the server checks against the screen's session.
   The screen is told the link is down when the stream errors or no heartbeat arrives for STALE_MS. */
(function () {
  'use strict';
  const STALE_MS = 12000;

  function Live(opts) {
    const onMsg = opts.onMsg, role = opts.role;
    const H = { 'X-Stemi-Role': role };
    let es = null, up = false, last = 0, epoch = null;

    const set = v => { if (v === up) return; up = v; onMsg({ t: 'net', up: v }); };
    const seen = () => { last = Date.now(); };
    /* the session is gone: the crew logs in again; any other screen reloads and gets a new device session */
    const reauth = () => { if (role === 'crew') location.href = '/login?next=' + encodeURIComponent(location.pathname); else location.reload(); };

    function connect() {
      if (es) es.close();
      es = new EventSource('/api/stream?role=' + encodeURIComponent(role));
      es.addEventListener('init', e => {
        const d = JSON.parse(e.data); seen();
        const fresh = epoch !== null && d.epoch !== epoch;
        epoch = d.epoch;
        onMsg({ t: 'init', now: d.now, epoch: d.epoch, fresh });
        set(true);
      });
      es.addEventListener('cfg', e => { seen(); onMsg({ t: 'cfg', sim: JSON.parse(e.data).sim }); });
      es.addEventListener('cases', e => { seen(); set(true); const d = JSON.parse(e.data); onMsg({ t: 'cases', list: d.list, at: d.at }); });
      es.addEventListener('case', e => { seen(); set(true); const d = JSON.parse(e.data); onMsg({ t: 'case', cad: d.cad, rec: d.rec, at: d.at }); });
      es.addEventListener('presence', e => { seen(); onMsg({ t: 'presence', presence: JSON.parse(e.data) }); });
      es.addEventListener('hb', e => { seen(); set(true); onMsg({ t: 'hb', at: JSON.parse(e.data).at }); });
      es.onerror = () => {
        set(false);
        /* a closed stream (server restarted, or the session expired) is reopened by hand; check the session first */
        if (es.readyState === 2) setTimeout(() => fetch('/api/me', { cache: 'no-store', headers: H }).then(r => { if (r.status === 401) reauth(); else connect(); }, () => setTimeout(connect, 2000)), 1500);
      };
    }
    setInterval(() => { if (up && Date.now() - last > STALE_MS) { set(false); connect(); } }, 2000);
    /* a phone pauses a page in the background; on return, check the link at once rather than trusting old data */
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - last > 6000) { set(false); connect(); } });
    addEventListener('online', () => connect());
    addEventListener('offline', () => set(false));

    const handle = r => { if (r.status === 401) { reauth(); throw new Error('session'); } return r; };
    /* a request that cannot reach the server means the link is down, whatever the event stream last said: the screen
       shows it at once, and the next heartbeat (or a reconnection) brings it back */
    const lost = e => { set(false); if (!es || es.readyState === 2) setTimeout(connect, 1500); throw e; };
    /* send actions in order. Resolves with the server's per-action results; rejects when the server cannot be reached */
    function send(ops) {
      return fetch('/api/ops', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ ops }), cache: 'no-store' })
        .then(handle, lost).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    }
    /* upload one image (Blob) with progress; resolves {id, url} */
    function upload(blob, params, onProgress) {
      return new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('POST', '/api/images?' + new URLSearchParams(params));
        x.setRequestHeader('Content-Type', blob.type || 'image/jpeg');
        x.setRequestHeader('X-Stemi-Role', role);
        x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
        x.onload = () => {
          if (x.status === 200) return resolve(JSON.parse(x.responseText));
          let m = ''; try { m = JSON.parse(x.responseText).error; } catch (_) { /* not JSON */ }
          reject(Object.assign(new Error(m || 'Upload failed: HTTP ' + x.status), { status: x.status }));
        };
        x.onerror = () => { set(false); reject(new Error('Upload failed: no connection')); };
        x.timeout = 30000; x.ontimeout = () => reject(new Error('Upload timed out'));
        x.send(blob);
      });
    }
    /* a JSON request that needs the server's answer at once. Resolves { status, body }; rejects when unreachable */
    function request(method, url, body) {
      return fetch(url, { method, headers: { ...H, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
        .then(handle, lost).then(r => r.json().catch(() => ({})).then(b => ({ status: r.status, body: b })));
    }

    connect();
    return { send, upload, request, isUp: () => up, epoch: () => epoch, lastAt: () => last };
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
