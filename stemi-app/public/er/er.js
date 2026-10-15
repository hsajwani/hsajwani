/* ER Doctor screen (desktop and tablet).
   New STEMI cases from the crews arrive here first, with an audible alarm that continues until an ER Doctor accepts the
   case (ACCEPT CASE → their name, remembered for this browser session → recorded against the CAD number).
   The ER Doctor reviews the original ECG and the minimum data and records a screening decision, not a STEMI diagnosis:
   ACTIVATE CARDIOLOGIST · UNCERTAIN — ACTIVATE CARDIOLOGIST · NOT SUSPICIOUS FOR STEMI (reason required, closes the
   screening pathway; the Cardiologist is never notified). Nothing after the acceptance makes a sound here. */
(() => {
  'use strict';
  const { $, esc, icon, hm, when, dur, now, toast, modal, dlg, badge, conn, topbar, patch, empty } = UI;
  const ROLE = 'er';
  const ID = CLIN.identity(ROLE);
  const alarm = CLIN.Alarm();
  const S = { cases: new Map(), view: 'queue', cad: null, back: 'queue', stat: null, up: false, started: false, gate: true, accepting: new Set(), shown: new Set(), hist: null, histQ: '', histErr: false, since: {}, main: '' };
  let LIVE = null, seq = 0, NS = null;

  /* ---------- this screen's own memory of which ECGs it has shown (NEW markers) ---------- */
  const seenKey = cad => 'stemi.er.seen.' + cad;
  const seenSet = cad => { try { return new Set(JSON.parse(localStorage.getItem(seenKey(cad)) || '[]')); } catch (_) { return new Set(); } };
  const markSeen = (cad, n) => { const s = seenSet(cad); if (s.has(n)) return false; s.add(n); try { localStorage.setItem(seenKey(cad), JSON.stringify([...s])); } catch (_) { /* storage blocked */ } return true; };

  /* ---------- the case on screen ---------- */
  const cur = () => (S.cad && (S.cases.get(S.cad) || (S.stat && S.stat.cad === S.cad ? S.stat : null))) || null;
  const all = () => [...S.cases.values()];
  const pending = () => all().filter(r => r.state === 'sent_to_er').sort((a, b) => a.sub.rcv - b.sub.rcv);
  const reviewing = () => all().filter(r => r.state === 'er_reviewing').sort((a, b) => b.er.accepted - a.er.accepted);
  const ongoing = () => all().filter(r => RULES.ACTIVATED.includes(r.state)).sort((a, b) => (b.cardio.activated || 0) - (a.cardio.activated || 0));
  const MDL = { age: 'Age', sex: 'Sex' };
  const val = (r, k) => { const x = CLIN.cur(r, k); return x ? (CLIN.isNv(x) && MDL[k] ? `${MDL[k]} ${x.v.toLowerCase()}` : x.v) : null; };
  const ptLine = r => [val(r, 'age'), val(r, 'sex'), val(r, 'complaint')].filter(Boolean).map(esc).join(' · ') || 'Patient details not entered';

  /* ---------- the platform ---------- */
  function send(cad, k, data) {
    const o = { id: `er-${UI.rid()}-${++seq}`, cad, k, t: now(), data: data || {} };
    return LIVE.send([o]).then(r => {
      const x = (r.results || [])[0] || {};
      if (!x.ok) throw Object.assign(new Error(x.error || 'The platform did not accept this.'), { server: true });
      return x;
    }, () => { throw new Error('No connection: nothing was sent.'); });
  }

  /* ---------- the ECG viewer: one for the case on screen ---------- */
  const viewedSent = new Set();
  const viewer = new CLIN.Viewer({
    isSeen: n => !S.cad || seenSet(S.cad).has(n),
    onView: (n, i) => {
      const r = cur(); if (!r) return;
      if (markSeen(r.cad, n)) setTimeout(() => { viewer.render(true); patchCase(); }, 0);
      const k = `${r.cad}|${n}|${i}`;
      if (viewedSent.has(k) || (r.views && r.views.er && r.views.er[n + '|' + i]) || !S.up) return;
      viewedSent.add(k);
      send(r.cad, 'viewed', { n, i, name: ID.get() }).catch(() => viewedSent.delete(k));
    },
    onChange: () => patchCase(),
    onCompare: ns => { if (S.cad) send(S.cad, 'compare', { ns, name: ID.get() }).catch(() => {}); },
    maxH: () => Math.max(320, innerHeight - 320)
  });

  /* ---------- the alarm: only for a new case not yet accepted ---------- */
  function syncAlarm() {
    const P = pending().filter(r => !S.accepting.has(r.cad));
    alarm.set(!S.gate && P.length > 0);
    if (!S.gate && S.up) P.forEach(r => { if (!r.er.shown && !S.shown.has(r.cad)) { S.shown.add(r.cad); send(r.cad, 'er_shown').catch(() => S.shown.delete(r.cad)); } });
  }

  /* ---------- top bar, connection banner, the new-case alert band ---------- */
  function top() {
    const name = ID.get(), reviewingNow = S.view === 'case' && cur() && cur().state === 'er_reviewing';
    const right = `<div class="tb-clin">${icon('user', 'ico-sm')}<span class="tb-clin__name">${name ? esc(name) : 'No clinician name yet'}</span>${reviewingNow ? '' : `<button class="tb-btn" data-act="clinician">${name ? 'Change clinician' : 'Enter name'}</button>`}</div>`;
    return topbar({ role: 'ER Doctor', conn: conn(S.started ? (S.up ? 'up' : 'down') : 'wait'), right, homeAct: 'queue' });
  }
  const banner = () => (S.started && !S.up ? `<div class="banner banner--down" role="alert">${icon('wifi-off')}<span>Connection lost — reconnecting. New cases cannot arrive and nothing can be sent until the connection returns.</span></div>` : '');
  function alarmBand() {
    const P = pending();
    if (!P.length) return '';
    const name = ID.get();
    return `<section class="alarmband" role="alert" aria-label="New STEMI cases awaiting ER acceptance"><div class="alarmband__in">
      <div class="alarmband__h">${icon('bell')}<span>NEW STEMI CASE${P.length > 1 ? 'S' : ''} — AWAITING ER ACCEPTANCE</span>${P.length > 1 ? `<span class="count">${P.length}</span>` : ''}<small>The alarm continues until the case is accepted</small></div>
      ${P.map(r => { const e = r.ecgs[0]; return `<div class="alarmcase"><div class="alarmcase__main"><span class="alarmcase__cad">CAD #${esc(r.cad)}</span><span class="alarmcase__pt">${ptLine(r)}</span>
        <span class="alarmcase__meta">ECG acquired <b>${e ? hm(e.acq) : '–'}</b> · ${esc(r.unit)} · sent ${hm(r.sub.send)} · waiting ${dur(now() - r.sub.rcv)}</span></div>
        <button class="btn btn--critical btn--lg" data-act="accept" data-cad="${esc(r.cad)}"${S.accepting.has(r.cad) ? ' disabled' : ''}>${icon('check')}ACCEPT CASE</button></div>`; }).join('')}
      <div class="alarmband__foot">${name ? `Accepting as <b>${esc(name)}</b> · <button class="link-btn" data-act="clinician">Not you? Change clinician</button>` : 'You enter your name when you accept the case.'}</div>
    </div></section>`;
  }

  /* ---------- queue ---------- */
  function vQueue() {
    return `<div class="page-h"><div class="page-h__t"><h1>STEMI cases</h1><p>Sent by the crews. Accept a new case, review the ECG, and decide whether the Cardiologist is activated.</p></div></div>
    <div class="stack" style="gap:28px">
      <section class="section" aria-labelledby="h-new"><div class="section__h"><h2 id="h-new">New — awaiting acceptance</h2><span id="n-new"></span></div><div id="q-new"></div></section>
      <section class="section" aria-labelledby="h-act"><div class="section__h"><h2 id="h-act">Active review</h2><span id="n-act"></span></div><div id="q-act"></div></section>
      <section class="section" aria-labelledby="h-on"><div class="section__h"><h2 id="h-on">Cardiology activated / ongoing</h2><span id="n-on"></span></div><div id="q-on"></div></section>
      <section class="section" aria-labelledby="h-done"><div class="section__h"><h2 id="h-done">Completed</h2><span class="sp"></span>
        <div class="search">${icon('search')}<label class="sr-only" for="hq">Search completed cases by CAD number</label><input class="input" id="hq" type="search" placeholder="Search by CAD number" autocomplete="off" spellcheck="false" value="${esc(S.histQ)}"></div></div><div id="q-done"></div></section>
    </div>
    <p class="footnote"><span>STEMI Coordination Platform · v${esc(UI.APP.version)} · test build</span><span>Fictional test data only</span><span>Clinician identification is a typed name: a prototype, not secure authentication</span></p>`;
  }
  function meta(r) {
    if (r.state === 'sent_to_er') return `<span>Sent ${hm(r.sub.send)}</span><span>waiting ${dur(now() - r.sub.rcv)}</span>`;
    if (r.state === 'er_reviewing') return `<span>Accepted by ${esc(r.er.name)}</span><span>at ${hm(r.er.accepted)}</span>`;
    const d = r.dec[r.dec.length - 1];
    return `<span>Activated ${when(r.cardio.activated)}${r.er.by ? ` · ${esc(r.er.by)}` : ''}</span><span>${d ? `${esc(RULES.DECISIONS[d.k])} · ${hm(d.at)}` : r.cardio.ack ? `${esc(r.cardio.name)} reviewing` : 'Awaiting the Cardiologist'}</span>`;
  }
  function row(r) {
    const e = r.ecgs[0], pend = r.state === 'sent_to_er';
    const inner = `<span class="qrow__cad"><span class="cad">CAD #${esc(r.cad)}</span>${badge(r.state, ROLE)}</span>
      <span class="qrow__pt"><b>${ptLine(r)}</b><span>ECG ${e ? `acquired ${hm(e.acq)}` : '–'} · ${esc(r.unit)}${r.legacy ? ' · no ER step (older case)' : ''}</span></span>
      <span class="qrow__meta">${meta(r)}</span>`;
    return pend ? `<div class="qrow qrow--crit">${inner}<span class="qrow__act"><button class="btn btn--critical" data-act="accept" data-cad="${esc(r.cad)}"${S.accepting.has(r.cad) ? ' disabled' : ''}>ACCEPT CASE</button></span></div>`
      : `<button class="qrow" data-act="open" data-cad="${esc(r.cad)}">${inner}<span class="qrow__act">${icon('chev-right')}</span></button>`;
  }
  function hrow(x) {
    return `<button class="qrow" data-act="open-done" data-cad="${esc(x.cad)}"><span class="qrow__cad"><span class="cad">CAD #${esc(x.cad)}</span>${badge(x.state, ROLE)}</span>
      <span class="qrow__pt"><b>${[x.pt.age, x.pt.sex, x.pt.complaint].filter(Boolean).map(esc).join(' · ') || '–'}</b><span>ECG ${x.ecgAt ? `acquired ${hm(x.ecgAt)}` : '–'} · ${esc(x.unit)}</span></span>
      <span class="qrow__meta"><span>Closed ${when(x.closedAt)}</span><span>${x.er.name ? `ER: ${esc(x.er.name)}` : 'No ER step'}${x.state === 'er_closed' ? ' · cardiology not activated' : x.cardio.name ? ` · ${esc(x.cardio.name)}` : ''}</span></span>
      <span class="qrow__act">${icon('chev-right')}</span></button>`;
  }
  const list = (L, fn, ic, t1, t2) => `<div class="qlist">${L.length ? L.map(fn).join('') : empty(ic, t1, t2)}</div>`;
  const count = (n, crit) => (n ? `<span class="count${crit ? ' count--crit' : ''}">${n}</span>` : '');
  function patchQueue() {
    if (S.hist === null && !S.histAsked) { S.histAsked = true; setTimeout(loadHist, 0); }
    const P = pending(), A = reviewing(), O = ongoing();
    patch('n-new', count(P.length, true)); patch('n-act', count(A.length)); patch('n-on', count(O.length));
    patch('q-new', list(P, row, 'bell', 'No new cases', 'A new case from a crew appears here, with an audible alarm.'));
    patch('q-act', list(A, row, 'eye', 'No case under ER review'));
    patch('q-on', list(O, row, 'steth', 'No case with cardiology activated'));
    patch('q-done', S.hist === null ? '<div class="qlist"><div class="loading"><span class="spinner"></span>Loading completed cases…</div></div>'
      : list(S.hist, hrow, 'lock', S.histQ ? 'No completed case with this CAD number' : 'No completed cases yet', S.histErr ? 'The list could not be loaded: no connection.' : ''));
  }
  let hT = null, hSeq = 0;
  function loadHist() {
    if (!LIVE) { S.histAsked = false; return; }
    const my = ++hSeq;
    LIVE.request('GET', '/api/cases?q=' + encodeURIComponent(S.histQ.trim())).then(x => {
      if (my !== hSeq) return;
      S.hist = x.status === 200 ? x.body.cases : []; S.histErr = x.status !== 200;
      if (S.view === 'queue') patchQueue();
    }, () => { if (my !== hSeq) return; S.hist = S.hist || []; S.histErr = true; if (S.view === 'queue') patchQueue(); });
  }

  /* ---------- the case review ---------- */
  function vCase() {
    return `<div id="c-head"></div><div id="c-strip" style="margin-bottom:16px"></div>
      <div class="review"><div class="review__main"><div id="c-viewer" class="o-1"></div><div id="c-ai" class="o-4"></div></div>
      <div class="review__side"><div id="c-decide" class="o-2"></div>
        <section class="card o-3"><div class="card__h"><h2>Clinical information</h2><span class="sp"></span><span class="small muted">from the crew · read only</span></div><div class="card__b" id="c-details"></div></section>
        <section class="card o-5"><div class="card__h"><h2>Timeline</h2></div><div class="card__b" id="c-tl"></div></section></div></div>`;
  }
  function caseHead(r) {
    const er = r.er;
    return `<div class="case-h"><button class="btn btn--quiet case-h__back" data-act="queue" aria-label="Back to all cases">${icon('chev-left')}<span class="lbl">All cases</span></button>
      <span class="case-h__cad">CAD #${esc(r.cad)}</span>${badge(r.state, ROLE, true)}<span class="sp"></span>
      ${er.accepted ? `<div class="accepted"><b>ACCEPTED BY ${esc(er.name)}</b><span>Accepted at ${hm(er.accepted)}</span></div>` : ''}
      <button class="btn btn--secondary btn-sum" data-act="summary" aria-label="Case Summary">${icon('file')}<span class="lbl">Case Summary</span></button></div>`;
  }
  function decideCard(r) {
    const L = CLIN.latest(r);
    if (r.state === 'sent_to_er') return `<section class="card card--crit"><div class="card__h"><h2>New case</h2></div><div class="card__b decide"><p>Accept the case to review it. The alarm continues until it is accepted.</p><button class="btn btn--critical btn--xl btn--block" data-act="accept" data-cad="${esc(r.cad)}">${icon('check')}ACCEPT CASE</button></div></section>`;
    if (r.state !== 'er_reviewing') return statusCard(r);
    const seen = seenSet(r.cad).has(L.n), dis = !S.up || !seen ? ' aria-disabled="true"' : '';
    const why = !S.up ? `<div class="alert tone-crit">${icon('wifi-off')}<div class="alert__body"><span class="alert__title">No connection</span><span>The assessment cannot be sent until the connection returns.</span></div></div>`
      : !seen ? `<div class="alert tone-info">${icon('info')}<div class="alert__body"><span class="alert__title">ECG ${L.n} has arrived</span><span>View ECG ${L.n} before recording the assessment.</span><button class="btn btn--sm btn--primary" data-act="view-latest" style="align-self:flex-start;margin-top:6px">View ECG ${L.n}</button></div></div>` : '';
    return `<section class="card" aria-labelledby="dec-h"><div class="card__h"><h2 id="dec-h">ER assessment</h2><span class="sp"></span><span class="small muted">on ECG ${L.n} · acquired ${hm(L.acq)}</span></div>
      <div class="card__b decide">
        <p class="decide__note">Should the Cardiologist review this case? A screening decision, not a STEMI diagnosis.</p>${why}
        <button class="btn btn--critical btn--xl btn--block" data-act="assess" data-k="activate"${dis}>${icon('bell')}ACTIVATE CARDIOLOGIST</button>
        <button class="btn btn--escalate btn--lg btn--block" data-act="assess" data-k="uncertain"${dis}>${icon('escalate')}UNCERTAIN — ACTIVATE CARDIOLOGIST</button>
        <div class="decide__sep"></div>
        <button class="btn btn--secondary btn--block" data-act="assess" data-k="not_suspicious"${dis}>${icon('minus-circle')}NOT SUSPICIOUS FOR STEMI</button>
      </div></section>`;
  }
  /* after the ER assessment: what happened next, read-only, arriving silently */
  function statusCard(r) {
    const er = r.er, cd = r.cardio, d = r.dec[r.dec.length - 1], lock = `<p class="lockline">${icon('lock')}Read-only · closing the STEMI pathway does not change the CAD incident</p>`;
    if (r.state === 'er_closed') return `<section class="card"><div class="card__h"><h2>ER review completed</h2></div><div class="card__b stack-sm">
      <div class="outcome"><span class="outcome__label">CARDIOLOGY NOT ACTIVATED</span><span>ER assessment: NOT SUSPICIOUS FOR STEMI · ${esc(er.by || er.name)} · ${when(er.at)}</span></div>
      <dl class="kv"><dt>Reason</dt><dd>${esc(er.reason)}</dd><dt>Comment</dt><dd>${er.comment ? esc(er.comment) : '<span class="nv">None</span>'}</dd></dl>${lock}</div></section>`;
    const erLine = r.legacy ? 'Sent directly to the cardiologist (case made before ER review was introduced)' : `ER assessment: ${er.assessment === 'uncertain' ? 'UNCERTAIN — cardiology activated' : 'ACTIVATE CARDIOLOGIST'} · ${esc(er.by || er.name || '')} · ${when(er.at)}`;
    const tone = r.state === 'confirmed' ? 'tone-crit-solid' : r.state === 'repeat_requested' ? 'tone-warn' : r.state === 'completed' ? 'tone-ok' : RULES.isClosed(r.state) ? '' : 'tone-info';
    const head = { cardiology_activated: 'CARDIOLOGY ACTIVATED — AWAITING CARDIOLOGIST', cardiologist_reviewing: 'CARDIOLOGIST REVIEWING', repeat_requested: 'REPEAT ECG REQUESTED', repeat_received: 'REPEAT ECG RECEIVED — CARDIOLOGIST REVIEWING', confirmed: 'CONFIRMED STEMI', not_stemi_closed: 'NOT STEMI — PATHWAY CLOSED', completed: 'STEMI PATHWAY COMPLETED' }[r.state] || '';
    return `<section class="card"><div class="card__h"><h2>Cardiology</h2></div><div class="card__b stack-sm">
      <div class="outcome ${tone}"><span class="outcome__label">${head}</span><span class="${tone === 'tone-crit-solid' ? '' : 'muted'} small">${erLine}</span></div>
      <dl class="kv"><dt>Activated</dt><dd>${when(cd.activated)}</dd><dt>Cardiologist</dt><dd>${cd.ack ? `${esc(cd.name)} · acknowledged ${hm(cd.ack)}` : '<span class="nv">Awaiting acknowledgement</span>'}</dd>
        <dt>Decision</dt><dd>${d ? `${esc(RULES.DECISIONS[d.k])} · ${hm(d.at)} · ${esc(d.by)}` : '<span class="nv">None yet</span>'}</dd></dl>
      ${RULES.isClosed(r.state) ? lock : `<p class="lockline">${icon('info')}Updates arrive here silently.</p>`}</div></section>`;
  }
  function patchCase() {
    const r = cur();
    if (!r || S.view !== 'case') return;
    patch('c-head', caseHead(r));
    patch('c-strip', CLIN.ptStrip(r));
    viewer.set(r); CLIN.updateFull(r);
    patch('c-ai', viewer.cmp ? '' : CLIN.aiPanel(viewer.e || CLIN.latest(r)));
    patch('c-decide', decideCard(r));
    patch('c-details', CLIN.ptDetails(r, { since: S.since[r.cad] }));
    patch('c-tl', CLIN.timelineHtml(r));
  }

  /* ---------- Case Summary ---------- */
  function vSummary(r) {
    return `<div class="case-h"><button class="btn btn--quiet case-h__back" data-act="sum-back">${icon('chev-left')}Back to the case</button><span class="sp"></span><span class="lockline">${icon('lock')}Read-only · nothing to fill in</span></div>
      <div class="page-h" style="margin-top:-8px"><div class="page-h__t"><h1>Case Summary · <span class="cad">CAD #${esc(r.cad)}</span></h1></div></div>${CLIN.summary(r, ROLE)}`;
  }

  /* ---------- rendering ---------- */
  function setMain(key, html) { const m = $('#main'); if (S.main !== key) { m.innerHTML = html; m._h = null; S.main = key; return true; } return false; }
  function render() {
    patch('top', top());
    patch('banner', banner());
    patch('alarm', alarmBand());
    if (S.view === 'case' && !cur()) { S.view = 'queue'; S.cad = null; }
    if (S.view === 'queue') { setMain('queue', vQueue()); patchQueue(); }
    else if (S.view === 'case') {
      const r = cur();
      if (setMain('case:' + r.cad, vCase())) $('#c-viewer').appendChild(viewer.el);
      patchCase();
    } else if (S.view === 'summary') { const r = cur(); setMain('sum', ''); patch('main', vSummary(r)); }
    syncAlarm();
  }
  function goQueue() {
    if (S.cad && S.view === 'case') S.since[S.cad] = now();
    S.view = 'queue'; S.cad = null; S.stat = null; CLIN.closeFull(); render(); $('#main').focus({ preventScroll: true }); scrollTo(0, 0);
    if (S.hist === null) loadHist();
  }
  function openCase(cad, stat) {
    if (S.cad && S.cad !== cad && S.view === 'case') S.since[S.cad] = now();
    S.cad = cad; S.stat = stat || null; S.view = 'case';
    const r = cur();
    if (r && S.since[cad] == null) S.since[cad] = r.er.accepted || now();
    render(); scrollTo(0, 0);
    const h = $('.case-h__cad'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  /* ---------- actions ---------- */
  function withName(title, action, cls, then) {
    const n = ID.get();
    if (n) return then(n);
    CLIN.namePrompt({ title: 'Enter your name', over: title, action, actionCls: cls, onSubmit: v => { ID.set(v); render(); then(v); } });
  }
  function accept(cad) {
    const r = S.cases.get(cad);
    if (!r) return;
    if (r.state !== 'sent_to_er') return openCase(cad);
    if (!S.up) return toast('No connection: the case cannot be accepted yet. The alarm continues.', 'err');
    withName(`Accept CAD #${cad}`, 'ACCEPT CASE', 'btn--critical', name => {
      S.accepting.add(cad); syncAlarm();
      openCase(cad);
      send(cad, 'er_accept', { name }).then(() => { S.accepting.delete(cad); render(); }, e => {
        S.accepting.delete(cad); render();
        toast(`The case was NOT accepted: ${e.message} The alarm continues.`, 'err');
      });
    });
  }
  function changeClinician() {
    CLIN.namePrompt({ title: 'Change clinician', over: 'ER Doctor', action: 'Save name', value: '', intro: '<p class="muted">The next case you accept is recorded under this name. Cases already accepted keep the name recorded then.</p>', onSubmit: v => { ID.set(v); render(); toast(`Clinician: ${v}`); } });
  }
  function assess(k) {
    const r = cur();
    if (!r || r.state !== 'er_reviewing') return;
    const L = CLIN.latest(r);
    if (!S.up) return toast('No connection: the assessment cannot be sent yet.', 'err');
    if (!seenSet(r.cad).has(L.n)) return toast(`View ECG ${L.n} before recording the assessment.`, 'err');
    withName('ER assessment', 'Continue', 'btn--primary', () => {
      if (k === 'not_suspicious') return notSuspicious(r);
      const act = k === 'activate';
      modal.open(dlg(act ? 'Activate cardiologist?' : 'Uncertain — activate cardiologist?', `
        <div class="confirm-box"><span class="cad">CAD #${esc(r.cad)}</span><span class="muted">${ptLine(r)} · ECG ${L.n} acquired ${hm(L.acq)}</span></div>
        <p>${act ? 'The Cardiologist on call is alerted at once, with an alarm, and receives this same case.' : 'Your assessment is recorded as <b>UNCERTAIN</b> and cardiology is activated at once: the Cardiologist on call is alerted, with an alarm, and receives this same case.'}</p>
        <p class="small muted">The crew sees CARDIOLOGY ACTIVATED. Recorded as ${esc(ID.get())} (ER Doctor).</p><span class="field-error" id="dlg-err" hidden></span>`,
        `<button class="btn btn--secondary" data-act="modal-close">Cancel</button><button class="btn ${act ? 'btn--critical' : 'btn--escalate'} btn--lg" data-act="assess-go" data-k="${k}">${act ? 'ACTIVATE CARDIOLOGIST' : 'UNCERTAIN — ACTIVATE CARDIOLOGIST'}</button>`, { over: 'ER assessment' }), { focus: '[data-act="assess-go"]' });
    });
  }
  function notSuspicious(r) {
    const L = CLIN.latest(r);
    NS = { cad: r.cad, reason: null, comment: '', tried: false };
    const reasons = RULES.ER_REASONS.map(x => `<button type="button" class="radio" role="radio" aria-checked="false" tabindex="-1" data-act="ns-reason" data-k="${x.k}"><span class="radio__dot"></span>${esc(x.label)}</button>`).join('');
    modal.open(dlg('NOT SUSPICIOUS FOR STEMI — REASON REQUIRED', `
      <div class="confirm-box"><span class="cad">CAD #${esc(r.cad)}</span><span class="muted">${ptLine(r)} · ECG ${L.n} acquired ${hm(L.acq)}</span></div>
      <fieldset><legend class="label" id="ns-lab">Reason <span class="opt">(required)</span></legend>
        <div class="radio-list" role="radiogroup" aria-labelledby="ns-lab" aria-describedby="ns-reason-err" style="margin-top:8px">${reasons}</div>
        <span class="field-error" id="ns-reason-err" hidden></span></fieldset>
      <div class="field"><label class="label" for="ns-comment">Comment <span class="opt" id="ns-opt">(optional)</span></label>
        <textarea class="textarea" id="ns-comment" maxlength="${RULES.TEXT_MAX}" rows="3" aria-describedby="ns-comment-err ns-count"></textarea>
        <span class="counter" id="ns-count">0 / ${RULES.TEXT_MAX}</span><span class="field-error" id="ns-comment-err" hidden></span></div>
      <div id="ns-sum"></div><span class="field-error" id="dlg-err" hidden></span>`,
      `<button class="btn btn--secondary" data-act="modal-close">CANCEL</button><button class="btn btn--primary btn--lg" data-act="ns-go" aria-disabled="true">CONFIRM</button>`, { over: 'ER assessment' }), { cls: 'modal--wide' });
    const first = modal.el().querySelector('.radio'); first.tabIndex = 0; first.focus();
    nsSync();
  }
  function nsSync() {
    const root = modal.el();
    if (!NS || !root || !root.querySelector('#ns-sum')) return;
    const chk = RULES.checkNotSuspicious(NS.reason, NS.comment), q = s => root.querySelector(s);
    root.querySelectorAll('.radio').forEach(b => { const on = b.dataset.k === NS.reason; b.setAttribute('aria-checked', String(on)); if (NS.reason) b.tabIndex = on ? 0 : -1; });
    q('#ns-opt').textContent = NS.reason === 'other' ? '(required for OTHER)' : '(optional)';
    q('#ns-count').textContent = `${NS.comment.length} / ${RULES.TEXT_MAX}`;
    q('[data-act="ns-go"]').setAttribute('aria-disabled', String(!chk.ok));
    const err = (id, field, inp) => {
      const el = q(id), show = NS.tried && !chk.ok && chk.field === field;
      el.hidden = !show; el.innerHTML = show ? icon('alert') + `<span>${esc(chk.error)}</span>` : '';
      if (inp) { if (show) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
    };
    err('#ns-reason-err', 'reason'); err('#ns-comment-err', 'comment', q('#ns-comment'));
    const lab = NS.reason ? RULES.erReason(NS.reason).label : null, c = RULES.cleanText(NS.comment);
    UI.modal.patch('#ns-sum', `<div class="confirm-box" aria-live="polite"><b>ER REVIEW — CARDIOLOGY NOT ACTIVATED</b><span>Reason: ${lab ? `<b>${esc(lab)}</b>` : '<span class="nv">select a reason</span>'}</span><span>Comment: ${c ? esc(c) : '<span class="nv">none</span>'}</span></div>
      <p class="small muted" style="margin-top:8px">On CONFIRM the STEMI screening pathway closes and becomes read-only. The Cardiologist is not notified. The crew sees ER REVIEW COMPLETED — CARDIOLOGY NOT ACTIVATED. The CAD incident is not changed.</p>`);
  }
  function doAssess(k, extra, btn) {
    const r = cur();
    if (!r) return;
    const L = CLIN.latest(r), errEl = modal.el() && modal.el().querySelector('#dlg-err');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Sending…'; }
    send(r.cad, 'er_assess', { kind: k, on: L.n, name: ID.get(), ...(extra || {}) }).then(() => {
      modal.close(); NS = null;
      toast(k === 'not_suspicious' ? 'ER review completed — cardiology not activated' : 'Cardiology activated: the Cardiologist is being alerted');
    }, e => {
      if (btn) { btn.disabled = false; btn.textContent = k === 'not_suspicious' ? 'CONFIRM' : k === 'activate' ? 'ACTIVATE CARDIOLOGIST' : 'UNCERTAIN — ACTIVATE CARDIOLOGIST'; }
      if (errEl) { errEl.hidden = false; errEl.innerHTML = icon('alert') + `<span>Not recorded: ${esc(e.message)}</span>`; } else toast('Not recorded: ' + e.message, 'err');
    });
  }
  function openDone(cad) {
    LIVE.request('GET', '/api/cases/view?cad=' + encodeURIComponent(cad)).then(x => {
      if (x.status !== 200) return toast('This case could not be opened.', 'err');
      openCase(cad, x.body.rec);
    }, () => toast('No connection: the case could not be opened.', 'err'));
  }

  function act(a, t) {
    const d = t.dataset;
    switch (a) {
      case 'queue': return goQueue();
      case 'accept': return accept(d.cad);
      case 'open': return openCase(d.cad);
      case 'open-done': return openDone(d.cad);
      case 'clinician': return changeClinician();
      case 'assess': return assess(d.k);
      case 'assess-go': return doAssess(d.k, null, t);
      case 'ns-reason': if (NS) { NS.reason = d.k; nsSync(); t.focus(); } return;
      case 'ns-go': {
        if (!NS) return;
        const chk = RULES.checkNotSuspicious(NS.reason, NS.comment);
        if (!chk.ok) { NS.tried = true; nsSync(); const f = modal.el().querySelector(chk.field === 'reason' ? '.radio' : '#ns-comment'); if (f) f.focus(); return; }
        return doAssess('not_suspicious', { reason: NS.reason, comment: NS.comment }, t);
      }
      case 'summary': S.view = 'summary'; S.back = 'case'; render(); scrollTo(0, 0); return;
      case 'sum-back': S.view = 'case'; render(); return;
      case 'sum-img': { const r = cur(); if (r) CLIN.showFull(r, +d.n, +d.i); return; }
      case 'view-latest': { const r = cur(); if (r) viewer.show(CLIN.latest(r).n); return; }
    }
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    if (t.tagName === 'A') e.preventDefault();
    if (t.getAttribute('aria-disabled') === 'true' && !['ns-go', 'assess'].includes(t.dataset.act)) return;
    act(t.dataset.act, t);
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'hq') { S.histQ = e.target.value; clearTimeout(hT); hT = setTimeout(loadHist, 250); }
    if (e.target.id === 'ns-comment' && NS) { NS.comment = e.target.value; nsSync(); }
  });
  /* the reason list is a radio group: arrow keys move and select */
  document.addEventListener('keydown', e => {
    const b = e.target.closest && e.target.closest('.radio');
    if (!b || !NS || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', ' '].includes(e.key)) return;
    e.preventDefault();
    const L = [...b.parentNode.querySelectorAll('.radio')], i = L.indexOf(b);
    const n = e.key === ' ' ? b : L[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : L.length - 1)) % L.length];
    NS.reason = n.dataset.k; nsSync(); n.focus();
  });
  $('#gate-go').addEventListener('click', () => { alarm.unlock(); $('#gate').hidden = true; S.gate = false; render(); $('#main').focus({ preventScroll: true }); });
  $('#sndwarn').addEventListener('click', () => alarm.unlock());

  /* ---------- the link to the platform ---------- */
  function onMsg(m) {
    switch (m.t) {
      case 'init': UI.setClock(m.now); S.started = true; if (m.fresh) { S.cases.clear(); S.hist = null; S.histAsked = false; S.view = 'queue'; S.cad = null; } return;
      case 'cases': S.cases = new Map(m.list.map(r => [r.cad, r])); break;
      case 'case': {
        const was = S.cases.get(m.cad);
        if (m.rec) S.cases.set(m.cad, m.rec); else S.cases.delete(m.cad);
        if (!m.rec && S.cad === m.cad && !S.stat) toast(`CAD #${m.cad} is no longer on the ER screens (taken off by the test console).`);
        if (m.rec && RULES.isClosed(m.rec.state) && (!was || !RULES.isClosed(was.state))) { S.hist = S.hist && S.hist.filter(x => x.cad !== m.cad); loadHist(); }
        break;
      }
      case 'net': S.up = m.up; break;
      case 'hb': UI.setClock(m.at); return;
      default: return;
    }
    render();
  }
  render();
  LIVE = Live({ role: ROLE, onMsg });
  setInterval(render, 15000);
})();
