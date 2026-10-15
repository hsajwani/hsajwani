/* The test console (TEST ONLY): every case on the platform, the pathway timestamps and full audit trail of a case,
   the CORPULS SIMULATOR (the simulated monitor of a case: connection, vital signs, 12-lead ECGs), test data (a pre-filled
   demo case, deleting all test data), the other simulations (manual-fallback test images, the mock AI) and the devices
   that are connected. Nothing here is a clinical step. */
(() => {
  'use strict';
  const { $, esc, icon, hms, when, dur, toast, modal, dlg, badge, conn, topbar, patch, empty } = UI;
  const S = { live: new Map(), list: null, sel: null, rec: null, up: false, started: false, sim: {}, presence: {}, audf: 'key', info: null, health: null, q: '',
    corp: null, corpCad: null, sample: null, corpMsg: null, corpVitKey: '' };
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
      <section class="card simcard" aria-labelledby="corp-h"><div class="card__h"><h2 id="corp-h">CORPULS SIMULATOR — TEST ONLY</h2><span class="sp"></span><span class="tag">MockCorpulsProvider</span></div>
        <div class="card__b stack">
          <p class="small muted">Plays the crew's corpuls3 for one case: what it does here reaches the platform exactly as the simulated corpuls feed would send it. Fictional data only; no real monitor or corpuls.mission is connected. To show WAITING FOR CORPULS, disconnect the monitor first: the next case the crew links stays waiting until CONNECT MONITOR.</p>
          <div class="field"><label class="label" for="corp-cad">Case and its simulated monitor</label><div id="corp-sel"></div></div>
          <div id="corp-st"></div>
          <div class="simgroup"><span class="label">Connection</span><div id="corp-conn" class="btn-wrap"></div></div>
          <div class="simgroup"><span class="label">Vital signs</span><div id="corp-vit"></div>
            <p class="xs subtle">SET changes the value the simulated monitor moves towards: HR and SpO₂ gradually, BP at the next measurement, RR at its next update. SEND VITALS UPDATE sends the set values at once, with a new BP measurement.</p></div>
          <div class="simgroup"><span class="label">12-lead ECG</span><div id="corp-ecg"></div>
            <p class="xs subtle">TRIGGER ECG = the crew acquires a 12-lead on corpuls3: it reaches the case as the next ECG, by itself. Samples A, B and C are fictional test ECGs, not a validated diagnosis.</p></div>
          <p id="corp-msg" class="small" role="status" aria-live="polite"></p>
        </div></section>
      <section class="card"><div class="card__h"><h2>Test data</h2></div><div class="card__b stack">
        <div class="field"><label class="label" for="demo-cad">Pre-filled demo case</label>
          <div class="row" style="flex-wrap:nowrap"><input class="input" id="demo-cad" placeholder="CAD number, e.g. 20261004-0123-1" autocomplete="off" spellcheck="false" style="font-family:var(--font-data)"><button class="btn btn--primary" data-act="demo">Send to the ER</button></div>
          <span class="hint" id="demo-msg">Sent the way the crew's case goes (Ambulance 214): created under the CAD number, linked to a simulated corpuls monitor of its own, ECG 1 acquired on it, the minimum data, SEND. The ER gets the normal NEW STEMI CASE alarm. The CAD number is checked like the crew's entry; an existing number is refused.</span></div>
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

  /* ---------- the corpuls simulator (TEST ONLY) ---------- */
  const STL = { waiting: ['WAITING', 'tone-neutral'], connected: ['CONNECTED', 'tone-ok'], reconnecting: ['RECONNECTING — SIGNAL LOST', 'tone-warn'], disconnected: ['DISCONNECTED', 'tone-warn'], idle: ['NOT LINKED', 'tone-neutral'] };
  const corpCase = () => S.corp && S.corp.cases.find(c => c.cad === S.corpCad);
  const corpDev = () => { const c = corpCase(); return c && S.corp.devices.find(d => d.id === c.device) || null; };
  function corpDefault() {
    if (!S.corp) return;
    const open = S.corp.cases.filter(c => !c.closed && !c.ended);
    if (!S.corpCad || !S.corp.cases.some(c => c.cad === S.corpCad)) S.corpCad = (open[0] || S.corp.cases[0] || {}).cad || null;
  }
  function corpSel() {
    if (!S.corp) return '<div class="loading"><span class="spinner"></span>Loading…</div>';
    if (!S.corp.simulated) return `<p class="field-error">${icon('alert')}<span>The corpuls provider is "${esc(S.corp.provider)}" (not implemented): there is nothing to simulate.</span></p>`;
    if (!S.corp.cases.length) return `<p class="small muted">No case is linked to a corpuls monitor yet: the crew opens a case (OPEN STEMI PATHWAY → CAD number → LINK CORPULS), or send a demo case.</p>`;
    return `<select class="select" id="corp-cad" data-act-change="corp-cad">${S.corp.cases.map(c => {
      const r = S.live.get(c.cad), st = c.closed ? 'closed' : c.ended ? 'feed ended' : (STL[c.status] || ['–'])[0].toLowerCase();
      return `<option value="${esc(c.cad)}"${c.cad === S.corpCad ? ' selected' : ''}>CAD #${esc(c.cad)} · ${r ? esc(RULES.label(r.state, 'crew')[0]) : c.sent ? 'sent' : 'not sent'} · corpuls ${esc(st)}</option>`; }).join('')}</select>`;
  }
  function corpStatus() {
    const c = corpCase(), d = corpDev();
    if (!c) return '';
    const off = c.closed || c.ended;
    const [l, tone] = off ? ['FEED ENDED', 'tone-neutral'] : STL[c.status] || STL.idle;
    const v = d && d.cur, bp = d && d.bp;
    return `<div class="simstat"><span class="badge ${tone}">${esc(l)}</span><span class="small"><b>${esc(c.label || c.device || '')}</b></span>
      <span class="small muted">${c.last ? `last data ${hms(c.last)}` : 'no data yet'}${d && d.paused ? ' · DATA PAUSED' : ''}${d && d.held ? ` · ${d.held} ECG held on the monitor` : ''}</span>
      ${v && !off ? `<span class="small mono">now HR ${v.hr} · SpO₂ ${v.spo2} · BP ${bp ? `${bp.sys}/${bp.dia} (${hms(bp.at)})` : '–'} · RR ${v.rr}</span>` : ''}
      ${off ? `<span class="small field-error" style="font-weight:600">${icon('lock')}<span>${c.closed ? 'This case is closed (read-only).' : 'This case is no longer linked.'} Data sent now is a late event: the platform must refuse it.</span></span>` : ''}</div>`;
  }
  const B = (act, label, cls, dis) => `<button class="btn btn--sm ${cls || 'btn--secondary'}" data-act="corp" data-k="${act}"${dis ? ' disabled' : ''}>${label}</button>`;
  function corpConn() {
    const c = corpCase(), d = corpDev();
    if (!c || c.closed || c.ended || !d) return '<span class="small muted">—</span>';
    const st = c.status;
    return [B('connect', 'CONNECT MONITOR', 'btn--primary', st === 'connected'), B('disconnect', 'DISCONNECT MONITOR', '', st === 'disconnected'), B('reconnect', 'RECONNECT', '', st === 'connected'),
      B('signal-loss', 'SIMULATE SIGNAL LOSS', '', st !== 'connected'), B('restore-signal', 'RESTORE SIGNAL', '', st !== 'reconnecting'),
      d.paused ? B('resume', 'RESUME DATA') : B('pause', 'PAUSE DATA', '', st !== 'connected')].join('');
  }
  function corpVit() {
    const c = corpCase(), d = corpDev(), T = (d && d.target) || {}, off = !c || !d;
    const f = (k, label, unit) => `<div class="simvit"><label class="label" for="cv-${k}">${label}</label><div class="row" style="flex-wrap:nowrap;gap:6px"><input class="input input--num" id="cv-${k}" inputmode="numeric" maxlength="3" value="${T[k] == null ? '' : T[k]}" style="width:84px"${off ? ' disabled' : ''}><span class="small muted">${unit}</span>${B('set', `SET ${label}`, 'btn--quiet', off).replace('data-k="set"', `data-k="set" data-f="${k}"`)}</div></div>`;
    return `<div class="simvits">${f('hr', 'HR', 'bpm')}${f('spo2', 'SpO₂', '%')}${f('sys', 'BP systolic', 'mmHg')}${f('dia', 'BP diastolic', 'mmHg')}${f('rr', 'RR', '/min')}</div>
      <div class="btn-row" style="margin-top:8px">${B('send-vitals', 'SEND VITALS UPDATE', 'btn--primary', !c)}</div>`;
  }
  function corpEcg() {
    const c = corpCase();
    if (!c) return '<span class="small muted">—</span>';
    const r = S.live.get(c.cad) || (S.rec && S.rec.cad === c.cad ? S.rec : null), n = (r ? r.ecgs.length : 0) + 1, smp = S.sample || (n === 1 ? 'A' : n === 2 ? 'B' : 'C');
    const btns = [];
    for (let k = 1; k <= Math.max(3, n); k++) btns.push(k < n ? `<button class="btn btn--sm btn--quiet" disabled>${icon('check', 'ico-sm')}ECG ${k} received</button>` : B('trigger-ecg', `TRIGGER ECG ${k}`, k === n ? 'btn--primary' : '', k !== n).replace('data-k="trigger-ecg"', `data-k="trigger-ecg" data-n="${k}"`));
    return `<div class="row" style="margin-bottom:8px"><span class="small muted">Sample</span><span class="seg" role="group" aria-label="ECG sample">${['A', 'B', 'C'].map(x => `<button data-act="corp-sample" data-v="${x}" aria-pressed="${smp === x}">ECG Sample ${x}</button>`).join('')}</span></div><div class="btn-wrap">${btns.join('')}</div>`;
  }
  function renderCorp() {
    corpDefault();
    patch('corp-sel', corpSel());
    patch('corp-st', corpStatus());
    patch('corp-conn', corpConn());
    /* the inputs are drawn once per case, so typing is never interrupted */
    const key = S.corpCad + '|' + (corpDev() ? corpDev().id : '');
    if (key !== S.corpVitKey) { S.corpVitKey = key; patch('corp-vit', corpVit()); }
    patch('corp-ecg', corpEcg());
  }
  function loadCorp() { LIVE.request('GET', '/api/control/corpuls').then(x => { if (x.status === 200) { S.corp = x.body; renderCorp(); } }, () => {}); }
  async function corpAct(k, t) {
    const c = corpCase(); if (!c) return;
    const body = { cad: c.cad };
    if (k === 'set') { const f = t.dataset.f, v = $('#cv-' + f).value.trim(); if (v === '') return corpSay('Enter a value first.', true); body[f] = v; }
    if (k === 'send-vitals') ['hr', 'spo2', 'sys', 'dia', 'rr'].forEach(f => { const v = $('#cv-' + f) && $('#cv-' + f).value.trim(); if (v) body[f] = v; });
    if (k === 'trigger-ecg') body.sample = S.sample || ({ 1: 'A', 2: 'B' }[t.dataset.n] || 'C');
    t.disabled = true;
    try {
      if (k === 'send-vitals') { const x = await LIVE.request('POST', '/api/control/corpuls/set', body); if (x.status !== 200) return corpSay(x.body.error || 'Not set.', true); }
      const x = await LIVE.request('POST', '/api/control/corpuls/' + k, k === 'send-vitals' ? { cad: c.cad } : body);
      if (x.body && x.body.sim) S.corp = x.body.sim;
      const ok = x.status === 200 && x.body.ok !== false;
      corpSay(ok ? ({ connect: 'Monitor connected.', disconnect: 'Monitor disconnected: the screens show the last values with their time.', reconnect: 'Reconnecting…', 'signal-loss': 'Signal lost: the feed is reconnecting; a 12-lead acquired now is held on the monitor.', 'restore-signal': 'Signal restored: the feed resumes (anything held is sent; resends are stored once).',
        pause: 'Data paused: the monitor stays connected but sends nothing.', resume: 'Data resumed.', set: `${Object.keys(body).filter(f => f !== 'cad').map(f => f.toUpperCase()).join(', ')} set.`, 'send-vitals': 'Vitals update sent.' }[k]
        || (x.body.held ? 'ECG acquired while the monitor is not connected: held on the monitor, sent once it connects.' : x.body.dup ? 'Already received: stored once.' : `ECG received by the platform as ECG ${x.body.n}.`))
        : `Refused by the platform: ${x.body.error || 'not accepted'}`, !ok);
    } catch (_) { corpSay('No connection.', true); } finally { t.disabled = false; renderCorp(); }
  }
  function corpSay(m, err) { S.corpMsg = { m, err }; const el = $('#corp-msg'); if (el) { el.className = 'small' + (err ? ' field-error' : ' simok'); el.textContent = m; } }

  /* ---------- simulation, devices ---------- */
  const seg = (label, key, opts) => `<div class="simrow"><span class="label">${label}</span><span class="seg" role="group" aria-label="${label}">${opts.map(([v, l]) => `<button data-act="sim" data-k="${key}" data-v="${v}" aria-pressed="${String(S.sim[key]) === v}">${l}</button>`).join('')}</span></div>`;
  const simHtml = () => seg('Manual fallback test ECG', 'find', [['border', 'Borderline, then evolving'], ['clear', 'Clear STEMI pattern']]) + seg('Next fallback test photo', 'q', [['good', 'Good'], ['glare', 'Glare'], ['cut', 'Leads cut off']]) + seg('Mock AI', 'ai', [['ok', 'Completes'], ['down', 'Unavailable'], ['proc', 'Stays processing']]) + '<p class="small muted" style="margin-top:8px">The first two apply to the fictional test images of the manual ECG fallback (and the demo case\'s ECG sample). The AI is a mock service with scripted results: no ECG data is sent anywhere.</p>';
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
    renderCorp();
  }

  async function act(a, t) {
    const d = t.dataset;
    switch (a) {
      case 'sel': S.sel = d.cad; S.rec = null; if (S.corp && S.corp.cases.some(c => c.cad === d.cad)) { S.corpCad = d.cad; S.sample = null; } render(); return loadSel();
      case 'corp': return corpAct(d.k, t);
      case 'corp-sample': S.sample = d.v; return renderCorp();
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
        if (x.status === 200) { $('#demo-cad').value = ''; S.sel = x.body.cad; S.rec = null; S.corpCad = x.body.cad; S.sample = null; loadList(); loadCorp(); setTimeout(loadSel, 400); }
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
  document.addEventListener('change', e => { if (e.target.id === 'corp-cad') { S.corpCad = e.target.value; S.sample = null; S.corpVitKey = ''; corpSay('', false); renderCorp(); } });

  function onMsg(m) {
    switch (m.t) {
      case 'init': UI.setClock(m.now); S.started = true; return;
      case 'cfg': S.sim = m.sim || {}; break;
      case 'cases': S.live = new Map(m.list.map(r => [r.cad, r])); loadList(); break;
      case 'case': if (m.rec) S.live.set(m.cad, m.rec); else S.live.delete(m.cad); if (m.cad === S.sel && m.rec) S.rec = m.rec; loadList(); break;
      case 'presence': S.presence = m.presence; break;
      case 'corpuls': S.corp = m.sim; renderCorp(); return;
      case 'monitor': { const r = S.live.get(m.cad); if (r) r.monitor = m.mon; if (S.rec && S.rec.cad === m.cad) S.rec.monitor = m.mon; return; }
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
  loadCorp(); setInterval(loadCorp, 5000);
})();
