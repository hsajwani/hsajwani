/* The test console (TEST ONLY): every case on the platform, the pathway timestamps and full audit trail of a case,
   test data (a pre-filled demo case, deleting all test data), the simulations (test ECG findings, photo quality, the
   mock AI) and the devices that are connected. Nothing here is a clinical step. */
(() => {
  'use strict';
  const { $, esc, icon, hms, when, dur, toast, modal, dlg, badge, conn, topbar, patch, empty } = UI;
  const S = { live: new Map(), list: null, sel: null, rec: null, up: false, started: false, sim: {}, presence: {}, audf: 'key', info: null, health: null, q: '' };
  let LIVE = null;

  function top() {
    const right = ['crew', 'er', 'cardiologist'].map(r => `<a class="tb-btn" href="/${r}" target="_blank" rel="noopener">${{ crew: 'Crew', er: 'ER', cardiologist: 'Cardiologist' }[r]}</a>`).join('');
    return topbar({ role: 'Test console', conn: conn(S.started ? (S.up ? 'up' : 'down') : 'wait'), right, home: '/' });
  }
  function skeleton() {
    return `<div class="page-h"><div class="page-h__t"><h1>Test console</h1><p>Cases, test data and simulations for testing the STEMI pathway. Fictional test data only.</p></div></div>
    <div class="con"><div class="con__col">
      <section class="card"><div class="card__h"><h2>Cases</h2><span id="n-cases"></span><span class="sp"></span><div class="search" style="max-width:260px">${icon('search')}<label class="sr-only" for="cq">Filter by CAD number</label><input class="input" id="cq" type="search" placeholder="Filter by CAD number" autocomplete="off"></div></div>
        <div id="cases" style="overflow-x:auto"></div>
        <div class="card__f small muted">Taking a case off the screens hides it from every live screen; it stays in the database and its STEMI pathway is NOT closed. Only COMPLETE STEMI PATHWAY, NOT STEMI or the ER Doctor's NOT SUSPICIOUS FOR STEMI close a pathway.</div></section>
      <section class="card"><div class="card__h"><h2>Selected case</h2><span class="sp"></span><span id="sel-cad"></span></div><div class="card__b" id="sel"></div></section>
    </div><div class="con__col">
      <section class="card"><div class="card__h"><h2>Test data</h2></div><div class="card__b stack">
        <div class="field"><label class="label" for="demo-cad">Pre-filled demo case</label>
          <div class="row" style="flex-wrap:nowrap"><input class="input" id="demo-cad" placeholder="CAD number, e.g. 20261004-0123-1" autocomplete="off" spellcheck="false" style="font-family:var(--font-data)"><button class="btn btn--primary" data-act="demo">Send to the ER</button></div>
          <span class="hint" id="demo-msg">Sent exactly as the crew MDT would send it (ECG 1 sample image, minimum data, Ambulance 214): the ER gets the normal NEW STEMI CASE alarm. The CAD number is checked like the crew's entry; an existing number is refused.</span></div>
        <div class="decide__sep"></div>
        <div class="row"><button class="btn btn--danger-quiet" data-act="reset">${icon('trash')}Delete all test data</button><span class="small muted">Every case, image and audit event. The crew test user stays.</span></div>
      </div></section>
      <section class="card"><div class="card__h"><h2>Simulation</h2></div><div class="card__b" id="sim"></div></section>
      <section class="card"><div class="card__h"><h2>Devices and server</h2></div><div class="card__b stack-sm" id="dev"></div></section>
    </div></div>`;
  }

  /* ---------- cases ---------- */
  function casesHtml() {
    if (S.list === null) return '<div class="loading"><span class="spinner"></span>Loading…</div>';
    const q = S.q.replace(/[^0-9]/g, ''), L = S.list.filter(x => !q || x.cad.replace(/[^0-9]/g, '').includes(q));
    if (!L.length) return `<div class="card__b">${empty('list', S.list.length ? 'No case matches' : 'No cases yet', S.list.length ? '' : 'The crew opens a case on the MDT, or send a demo case.')}</div>`;
    return `<table class="ctable"><thead><tr><th>CAD</th><th>Status</th><th>Opened</th><th>Screens</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>${L.map(x => {
      const closed = RULES.isClosed(x.state);
      return `<tr data-cad="${esc(x.cad)}" class="${x.cad === S.sel ? 'sel' : ''}"><td><button class="link-btn cad" data-act="sel" data-cad="${esc(x.cad)}">CAD #${esc(x.cad)}</button>${x.legacy ? '<br><span class="xs subtle">before 0.5.0 (no ER step)</span>' : ''}</td>
        <td>${badge(x.state, 'crew')}</td><td class="nowrap small">${when(x.created)}</td>
        <td class="small ${x.active ? '' : 'off'}">${closed ? 'Closed' : x.active ? 'On screens' : 'Off screens'}</td>
        <td>${closed ? '' : `<button class="btn btn--sm btn--secondary" data-act="screens" data-cad="${esc(x.cad)}" data-on="${x.active ? '' : '1'}">${x.active ? 'Take off screens' : 'Return to screens'}</button>`}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  let lT = null;
  function loadList() {
    clearTimeout(lT);
    lT = setTimeout(() => LIVE.request('GET', '/api/control/cases').then(x => { if (x.status === 200) { S.list = x.body.cases; render(); } }, () => {}), 150);
  }

  /* ---------- the selected case: pathway timestamps and the full audit trail ---------- */
  function stamps(r) {
    const rows = [], e1 = r.ecgs[0], er = r.er || {}, cd = r.cardio || {};
    const row = (l, t, prev, note) => rows.push(`<tr><td>${l}${note ? `<br><span class="xs subtle">${esc(note)}</span>` : ''}</td><td>${t ? hms(t) : '<span class="subtle">–</span>'}</td><td>${t && prev ? '+' + dur(t - prev) : ''}</td></tr>`);
    const sec = t => rows.push(`<tr class="tsec"><td colspan="3">${t}</td></tr>`);
    sec('Crew');
    row('STEMI pathway opened', r.path && r.path.at, null, r.cadEntry && r.cadEntry.src === 'manual-test-console' ? 'demo case from the test console' : 'CAD number entered manually by the crew');
    row('ECG 1 acquired', e1 && e1.acq);
    row('Crew SEND', r.sub && r.sub.send, e1 && e1.acq);
    row('Server received · ER alerted', r.sub && r.sub.rcv, r.sub && r.sub.send);
    sec('ER Doctor');
    if (r.legacy) rows.push('<tr><td colspan="3" class="subtle">No ER step: case made before 0.5.0</td></tr>');
    else {
      row('NEW STEMI CASE shown on the ER screen · alarm started', er.shown, r.sub && r.sub.rcv);
      row('Accepted · alarm stopped', er.accepted, er.shown || (r.sub && r.sub.rcv), er.name);
      row(`ER assessment${er.assessment ? ': ' + RULES.ER_ASSESSMENTS[er.assessment] : ''}`, er.at, er.accepted, er.assessment === 'not_suspicious' ? `${er.reason}${er.comment ? ' · ' + er.comment : ''}` : er.by);
    }
    sec('Cardiology');
    if (!cd.activated) rows.push(`<tr><td colspan="3" class="subtle">${r.state === 'er_closed' ? 'Not activated (ER Doctor: not suspicious for STEMI)' : 'Not activated yet'}</td></tr>`);
    else {
      row('Cardiology activated', cd.activated, er.at || (r.sub && r.sub.rcv), cd.reason);
      row('NEW CARDIOLOGY ACTIVATION shown · alarm started', cd.shown, cd.activated);
      row('Acknowledged · alarm stopped', cd.ack, cd.shown || cd.activated, cd.name);
      r.dec.forEach((d, i) => { row(`Decision: ${RULES.DECISIONS[d.k]}`, d.at, i ? r.dec[i - 1].at : cd.ack, d.by); row('Shown on the crew tablet', d.dlv, d.at); row('Crew acknowledged', d.crewAck, d.dlv); });
    }
    sec('Closure');
    row(r.closed ? r.closed.reason : 'Not closed', r.closed && r.closed.at, null, r.closed ? `${r.closed.source} · ${r.closed.by || ''}` : '');
    if (e1 && er.accepted) rows.push(`<tr class="tsec"><td colspan="3">Intervals from ECG 1 acquisition</td></tr><tr><td>to ER acceptance</td><td></td><td>${dur(er.accepted - e1.acq)}</td></tr>`);
    if (e1 && cd.activated) rows.push(`<tr><td>to cardiology activation</td><td></td><td>${dur(cd.activated - e1.acq)}</td></tr>`);
    if (e1 && r.dec[0]) rows.push(`<tr><td>to the first Cardiologist decision</td><td></td><td>${dur(r.dec[0].at - e1.acq)}</td></tr>`);
    return `<table class="ctable ts"><tbody>${rows.join('')}</tbody></table>`;
  }
  function selHtml() {
    const r = S.rec;
    if (!S.sel) return empty('list', 'Select a case', 'Its pathway timestamps and full audit trail appear here.');
    if (!r) return '<div class="loading"><span class="spinner"></span>Loading…</div>';
    const items = r.audit.filter(a => S.audf === 'all' || a.kind === 'key').sort((a, b) => b.t - a.t || b.i - a.i);
    return `<div class="stack"><div class="row">${badge(r.state, 'crew', true)}<span class="small muted">${esc(r.unit)} · ${esc(r.crew)}</span></div>
      <div><div class="overline" style="margin-bottom:6px">Pathway timestamps</div>${stamps(r)}</div>
      <div><div class="row" style="margin-bottom:6px"><span class="overline">Audit trail · newest first</span><span class="sp"></span><span class="seg" role="group" aria-label="Audit events shown"><button data-act="audf" data-v="key" aria-pressed="${S.audf === 'key'}">Pathway events</button><button data-act="audf" data-v="all" aria-pressed="${S.audf === 'all'}">All events</button></span></div>
        <ol class="aud">${items.map(a => `<li class="${a.kind === 'view' ? 'view' : ''}"><span class="t">${hms(a.t)}</span><span>${esc(a.text)}<small>${esc(a.who || '')}${a.role ? ` · role: ${esc(a.role)}` : ''}</small></span></li>`).join('')}</ol></div></div>`;
  }
  function loadSel() {
    const cad = S.sel;
    if (!cad) return;
    if (S.live.has(cad)) { S.rec = S.live.get(cad); return render(); }
    LIVE.request('GET', '/api/cases/view?cad=' + encodeURIComponent(cad)).then(x => { if (S.sel === cad && x.status === 200) { S.rec = x.body.rec; render(); } }, () => {});
  }

  /* ---------- simulation, devices ---------- */
  const seg = (label, key, opts) => `<div class="simrow"><span class="label">${label}</span><span class="seg" role="group" aria-label="${label}">${opts.map(([v, l]) => `<button data-act="sim" data-k="${key}" data-v="${v}" aria-pressed="${String(S.sim[key]) === v}">${l}</button>`).join('')}</span></div>`;
  const simHtml = () => seg('Test ECG findings', 'find', [['border', 'Borderline, then evolving'], ['clear', 'Clear STEMI pattern']]) + seg('Next test photo', 'q', [['good', 'Good'], ['glare', 'Glare'], ['cut', 'Leads cut off']]) + seg('Mock AI', 'ai', [['ok', 'Completes'], ['down', 'Unavailable'], ['proc', 'Stays processing']]) + '<p class="small muted" style="margin-top:8px">Findings apply to test ECGs captured from now on; photo quality to the next test photo. The AI is a mock service with scripted results: no real ECG data is sent anywhere.</p>';
  function devHtml() {
    const P = S.presence || {}, f = (x, l) => { const st = x && x.up === true ? 'up' : x && x.up === false ? 'down' : ''; return `<div class="dev"><span class="dot ${st}"></span><b>${l}</b><span class="small muted">${st === 'up' ? 'connected' : st === 'down' ? `offline since ${hms(x.at)}` : 'not connected yet'}</span></div>`; };
    const u = S.info && S.info.urls && S.info.urls[0];
    const h = S.health;
    return `${f(P.crew, 'Crew MDT')}${f(P.er, 'ER Doctor screen')}${f(P.cardiologist, 'Cardiologist screen')}
      <p class="small urls" style="margin-top:8px">${u ? `On the iPhone (same Wi-Fi): <code>${esc(u.cardiologist)}</code><br>ER on another device: <code>${esc(u.er)}</code>` : 'No network address found: is this computer on Wi-Fi?'}</p>
      <p class="small muted">${h ? `Server v${esc(h.version)} · ${esc(h.environment)} · running ${dur(h.uptimeSeconds * 1000)} · pid ${h.pid}` : 'Server status…'}</p>`;
  }

  function render() {
    patch('top', top());
    patch('banner', S.started && !S.up ? `<div class="banner banner--down" role="status">${icon('wifi-off')}<span>Connection lost — reconnecting.</span></div>` : '');
    if (!$('#cases')) $('#main').innerHTML = skeleton();
    patch('n-cases', S.list ? `<span class="count">${S.list.length}</span>` : '');
    patch('cases', casesHtml());
    patch('sel-cad', S.sel ? `<span class="cad">CAD #${esc(S.sel)}</span>` : '');
    patch('sel', selHtml());
    patch('sim', simHtml());
    patch('dev', devHtml());
  }

  async function act(a, t) {
    const d = t.dataset;
    switch (a) {
      case 'sel': S.sel = d.cad; S.rec = null; render(); return loadSel();
      case 'audf': S.audf = d.v; return render();
      case 'sim': { const v = d.v; await LIVE.request('POST', '/api/control/sim', { [d.k]: v }); return; }
      case 'screens': {
        const x = await LIVE.request('POST', '/api/control/screens', { cad: d.cad, on: !!d.on }).catch(() => null);
        if (!x || x.status !== 200) toast('Not changed: no connection.', 'err'); else toast(d.on ? `CAD #${d.cad} returned to the live screens` : `CAD #${d.cad} taken off the live screens (pathway not closed)`);
        return loadList();
      }
      case 'demo': {
        const msg = $('#demo-msg'), cad = $('#demo-cad').value;
        const x = await LIVE.request('POST', '/api/control/demo-case', { cad }).catch(() => null);
        if (!x) return toast('No connection.', 'err');
        msg.className = x.status === 200 ? 'hint' : 'field-error';
        msg.textContent = x.status === 200 ? `Demo case sent to the ER under CAD #${x.body.cad}.` : (x.body.error || 'The demo case was not created.');
        if (x.status === 200) { $('#demo-cad').value = ''; S.sel = x.body.cad; S.rec = null; loadList(); setTimeout(loadSel, 400); }
        return;
      }
      case 'reset':
        return modal.open(dlg('Delete all test data?', '<p>Every test case, ECG image and audit event is deleted from the test database. The crew test user stays. Every open screen starts afresh.</p><p class="small muted">Use this only for test data. It cannot be undone.</p>',
          '<button class="btn btn--secondary" data-act="modal-close">Cancel</button><button class="btn btn--critical" data-act="reset-go">Delete all test data</button>', { over: 'TEST ONLY' }), { focus: '[data-act="modal-close"]' });
      case 'reset-go': {
        const x = await LIVE.request('POST', '/api/control/reset').catch(() => null);
        modal.close();
        if (!x || x.status !== 200) return toast('Not deleted: no connection.', 'err');
        S.sel = null; S.rec = null; S.live.clear(); toast('All test data deleted'); return loadList();
      }
    }
  }
  document.addEventListener('click', e => {
    const tr = e.target.closest('tr[data-cad]');
    const t = e.target.closest('[data-act]');
    if (t && !t.disabled) { if (t.tagName === 'A') e.preventDefault(); act(t.dataset.act, t); return; }
    if (tr) act('sel', tr);
  });
  document.addEventListener('input', e => { if (e.target.id === 'cq') { S.q = e.target.value; patch('cases', casesHtml()); } });

  function onMsg(m) {
    switch (m.t) {
      case 'init': UI.setClock(m.now); S.started = true; return;
      case 'cfg': S.sim = m.sim || {}; break;
      case 'cases': S.live = new Map(m.list.map(r => [r.cad, r])); loadList(); break;
      case 'case': if (m.rec) S.live.set(m.cad, m.rec); else S.live.delete(m.cad); if (m.cad === S.sel && m.rec) S.rec = m.rec; loadList(); break;
      case 'presence': S.presence = m.presence; break;
      case 'net': S.up = m.up; break;
      case 'hb': UI.setClock(m.at); return;
      default: return;
    }
    render();
  }
  function health() {
    fetch('/health', { cache: 'no-store' }).then(r => r.json()).then(h => { S.health = h; patch('dev', devHtml()); }, () => {});
    if (LIVE) LIVE.request('GET', '/api/info').then(x => { if (x.status === 200) { S.info = x.body; if (x.body.presence) S.presence = x.body.presence; patch('dev', devHtml()); } }, () => {});
  }
  render();
  LIVE = Live({ role: 'control', onMsg });
  health(); setInterval(health, 10000);
})();
