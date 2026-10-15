/* Cardiologist screen (phone first; tablet and desktop too).
   Only cases where an ER Doctor activated cardiology arrive here. NEW CARDIOLOGY ACTIVATION covers the screen with an
   audible alarm until ACKNOWLEDGE & OPEN (with the cardiologist's name, remembered for this browser session and recorded
   against the CAD number). Acknowledging is not a decision. The original ECG and the decision dominate the screen; the AI
   result is decision support only. Decisions (unchanged): CONFIRMED STEMI · NOT STEMI (closes the pathway automatically)
   · UNCLEAR — REQUEST REPEAT ECG. Nothing after the acknowledgement makes a sound. */
(() => {
  'use strict';
  const { $, esc, icon, hm, when, dur, now, toast, modal, dlg, badge, conn, topbar, patch, empty } = UI;
  const ROLE = 'cardiologist';
  const ID = CLIN.identity(ROLE);
  const alarm = CLIN.Alarm();
  const NOT_REASONS = ['No acute ischaemic changes', 'Old changes / known LBBB', 'Pericarditis pattern', 'Other (free text)'];
  const REP_REASONS = ['Repeat due to ongoing symptoms', 'Poor ECG quality', 'Dynamic changes suspected', 'Additional lead clarification'];
  const S = { cases: new Map(), view: 'queue', cad: null, stat: null, up: false, started: false, gate: true, acking: new Set(), shown: new Set(), hist: null, histQ: '', histErr: false, since: {}, main: '' };
  let LIVE = null, seq = 0, D = null;

  const seenKey = cad => 'stemi.card.seen.' + cad;
  const seenSet = cad => { try { return new Set(JSON.parse(localStorage.getItem(seenKey(cad)) || '[]')); } catch (_) { return new Set(); } };
  const markSeen = (cad, n) => { const s = seenSet(cad); if (s.has(n)) return false; s.add(n); try { localStorage.setItem(seenKey(cad), JSON.stringify([...s])); } catch (_) { /* storage blocked */ } return true; };

  const cur = () => (S.cad && (S.cases.get(S.cad) || (S.stat && S.stat.cad === S.cad ? S.stat : null))) || null;
  const all = () => [...S.cases.values()];
  const pending = () => all().filter(r => r.state === 'cardiology_activated').sort((a, b) => a.cardio.activated - b.cardio.activated);
  const review = () => all().filter(r => r.state === 'cardiologist_reviewing' || r.state === 'repeat_received');
  const active = () => all().filter(r => r.state === 'repeat_requested' || r.state === 'confirmed');
  const MDL = { age: 'Age', sex: 'Sex' };
  const val = (r, k) => { const x = CLIN.cur(r, k); return x ? (CLIN.isNv(x) && MDL[k] ? `${MDL[k]} ${x.v.toLowerCase()}` : x.v) : null; };
  const ptLine = r => [val(r, 'age'), val(r, 'sex'), val(r, 'complaint')].filter(Boolean).map(esc).join(' · ') || 'Patient details not entered';
  const erAssess = r => (r.legacy ? 'Sent directly (case made before ER review)' : r.er.assessment === 'uncertain' ? 'UNCERTAIN — ACTIVATE CARDIOLOGIST' : 'ACTIVATE CARDIOLOGIST');

  function send(cad, k, data) {
    const o = { id: `cd-${UI.rid()}-${++seq}`, cad, k, t: now(), data: data || {} };
    return LIVE.send([o]).then(r => {
      const x = (r.results || [])[0] || {};
      if (!x.ok) throw Object.assign(new Error(x.error || 'The platform did not accept this.'), { server: true });
      return x;
    }, () => { throw new Error('No connection: nothing was sent.'); });
  }

  const viewedSent = new Set();
  const viewer = new CLIN.Viewer({
    isSeen: n => !S.cad || seenSet(S.cad).has(n),
    onView: (n, i) => {
      const r = cur(); if (!r) return;
      if (markSeen(r.cad, n)) setTimeout(() => { viewer.render(true); patchCase(); }, 0);
      const k = `${r.cad}|${n}|${i}`;
      if (!r.cardio.ack || viewedSent.has(k) || (r.views && r.views.cardiologist && r.views.cardiologist[n + '|' + i]) || !S.up) return;
      viewedSent.add(k);
      send(r.cad, 'viewed', { n, i, name: ID.get() }).catch(() => viewedSent.delete(k));
    },
    onChange: () => patchCase(),
    onCompare: ns => { const r = cur(); if (r && r.cardio.activated) send(r.cad, 'compare', { ns, name: ID.get() }).catch(() => {}); },
    maxH: () => (innerWidth <= 900 ? Infinity : Math.max(320, innerHeight - 300))
  });

  /* ---------- the alarm: only for an activation not yet acknowledged ---------- */
  function syncAlarm() {
    const P = pending().filter(r => !S.acking.has(r.cad));
    alarm.set(!S.gate && P.length > 0);
    if (!S.gate && S.up) P.forEach(r => { if (!r.cardio.shown && !S.shown.has(r.cad)) { S.shown.add(r.cad); send(r.cad, 'shown').catch(() => S.shown.delete(r.cad)); } });
  }

  /* ---------- NEW CARDIOLOGY ACTIVATION: its own layer above everything until ACKNOWLEDGE & OPEN ---------- */
  function alertHtml() {
    const P = pending().filter(r => !S.acking.has(r.cad));
    if (!P.length) return '';
    const r = P[0], e = r.ecgs[0], name = ID.get();
    return `<div class="activation" role="alertdialog" aria-modal="true" aria-labelledby="act-h" aria-describedby="act-d">
      <div class="activation__h"><div><span class="overline">Activated by the ER · ${P.length > 1 ? `1 of ${P.length} waiting` : 'audible alarm'}</span><h1 id="act-h">${icon('bell')}NEW CARDIOLOGY ACTIVATION</h1></div></div>
      <div class="activation__b" id="act-d">
        <div class="stack-sm"><span class="cad-big">CAD #${esc(r.cad)}</span><span style="font-weight:600;font-size:18px">${ptLine(r)}</span></div>
        <div class="card"><div class="card__b"><dl class="kv">
          <dt>ER Doctor</dt><dd>${r.er.name ? esc(r.er.by || r.er.name) : '<span class="nv">No ER step</span>'}</dd>
          <dt>ER assessment</dt><dd><b>${esc(erAssess(r))}</b></dd>
          <dt>Activated</dt><dd><span class="val">${hm(r.cardio.activated)}</span><span class="when">${dur(now() - r.cardio.activated)} ago</span></dd>
          <dt>ECG acquired</dt><dd><span class="val">${e ? hm(e.acq) : '–'}</span>${r.ecgs.length > 1 ? `<span class="when">${r.ecgs.length} ECGs</span>` : ''}</dd>
          <dt>Unit</dt><dd>${esc(r.unit)}</dd></dl></div></div>
        ${P.length > 1 ? `<div class="activation__more"><span class="overline">Also waiting</span>${P.slice(1).map(x => `<div class="alert tone-crit">${icon('bell')}<div class="alert__body"><span class="alert__title cad">CAD #${esc(x.cad)}</span><span>${ptLine(x)} · activated ${hm(x.cardio.activated)}</span></div></div>`).join('')}</div>` : ''}
      </div>
      <div class="activation__f"><div>
        <button class="btn btn--critical btn--xl btn--block" data-act="ack" data-cad="${esc(r.cad)}">${icon('check')}ACKNOWLEDGE &amp; OPEN</button>
        <p class="dockbar__note">Acknowledging is not a decision. The alarm stops when you acknowledge.${name ? ` As <b>${esc(name)}</b> · <button class="link-btn" data-act="clinician">change</button>` : ''}</p>
      </div></div></div>`;
  }
  function renderAlert() {
    const el = $('#alert'), h = alertHtml(), first = h && !el._h;
    if (patch(el, h) && h) {
      document.documentElement.style.overflow = 'hidden';
      if (first || !el.contains(document.activeElement)) { const b = el.querySelector('[data-act="ack"]'); if (b) b.focus({ preventScroll: true }); }
    }
    if (!h && !modal.isOpen()) document.documentElement.style.overflow = '';
  }

  /* ---------- top bar ---------- */
  function top() {
    return topbar({ role: 'Cardiologist', conn: conn(S.started ? (S.up ? 'up' : 'down') : 'wait'), homeAct: 'queue' });
  }
  const banner = () => (S.started && !S.up ? `<div class="banner banner--down" role="alert">${icon('wifi-off')}<span>Connection lost — reconnecting. No activation can arrive and no decision can be sent until the connection returns.</span></div>` : '');

  /* ---------- queue ---------- */
  function vQueue() {
    return `<div class="page-h"><div class="page-h__t"><h1>Cardiology</h1><p id="q-clin"></p></div></div>
    <div class="stack" style="gap:26px">
      <section class="section" aria-labelledby="h-new"><div class="section__h"><h2 id="h-new">New cardiology activations</h2><span id="n-new"></span></div><div id="q-new"></div></section>
      <section class="section" aria-labelledby="h-rev"><div class="section__h"><h2 id="h-rev">Active review</h2><span id="n-rev"></span></div><div id="q-rev"></div></section>
      <section class="section" aria-labelledby="h-act"><div class="section__h"><h2 id="h-act">Repeat ECG requested / active</h2><span id="n-act"></span></div><div id="q-act"></div></section>
      <section class="section" aria-labelledby="h-done"><div class="section__h"><h2 id="h-done">Completed cardiology cases</h2><span class="sp"></span>
        <div class="search">${icon('search')}<label class="sr-only" for="hq">Search completed cases by CAD number</label><input class="input" id="hq" type="search" placeholder="Search by CAD number" autocomplete="off" spellcheck="false" value="${esc(S.histQ)}"></div></div><div id="q-done"></div></section>
    </div>
    <p class="footnote"><span>STEMI Coordination Platform · v${esc(UI.APP.version)} · test build</span><span>Fictional test data only</span><span>Clinician identification is a typed name: a prototype, not secure authentication</span></p>`;
  }
  function meta(r) {
    const d = r.dec[r.dec.length - 1];
    if (r.state === 'cardiology_activated') return `<span>Activated ${hm(r.cardio.activated)}</span><span>${r.er.name ? `ER: ${esc(r.er.by || r.er.name)}` : ''}</span>`;
    return `<span>${esc(r.cardio.name || '')}${r.cardio.ack ? ` · acknowledged ${hm(r.cardio.ack)}` : ''}</span><span>${d ? `${esc(RULES.DECISIONS[d.k])} · ${hm(d.at)}` : 'No decision yet'}</span>`;
  }
  function row(r) {
    const e = r.ecgs[0], pend = r.state === 'cardiology_activated';
    const inner = `<span class="qrow__cad"><span class="cad">CAD #${esc(r.cad)}</span>${badge(r.state, ROLE)}</span>
      <span class="qrow__pt"><b>${ptLine(r)}</b><span>ECG ${e ? `acquired ${hm(e.acq)}` : '–'}${r.ecgs.length > 1 ? ` · ${r.ecgs.length} ECGs` : ''} · ${esc(r.unit)}</span></span>
      <span class="qrow__meta">${meta(r)}</span>`;
    return pend ? `<div class="qrow qrow--crit">${inner}<span class="qrow__act"><button class="btn btn--critical" data-act="ack" data-cad="${esc(r.cad)}">ACKNOWLEDGE &amp; OPEN</button></span></div>`
      : `<button class="qrow${r.state === 'repeat_received' ? ' qrow--warn' : ''}" data-act="open" data-cad="${esc(r.cad)}">${inner}<span class="qrow__act">${icon('chev-right')}</span></button>`;
  }
  function hrow(x) {
    return `<button class="qrow" data-act="open-done" data-cad="${esc(x.cad)}"><span class="qrow__cad"><span class="cad">CAD #${esc(x.cad)}</span>${badge(x.state, ROLE)}</span>
      <span class="qrow__pt"><b>${[x.pt.age, x.pt.sex, x.pt.complaint].filter(Boolean).map(esc).join(' · ') || '–'}</b><span>ECG ${x.ecgAt ? `acquired ${hm(x.ecgAt)}` : '–'} · ${esc(x.unit)}</span></span>
      <span class="qrow__meta"><span>Closed ${when(x.closedAt)}</span><span>${x.state === 'er_closed' ? 'CARDIOLOGY NOT ACTIVATED' : x.cardio.name ? esc(x.cardio.name) : ''}</span></span>
      <span class="qrow__act">${icon('chev-right')}</span></button>`;
  }
  const list = (L, fn, ic, t1, t2) => `<div class="qlist">${L.length ? L.map(fn).join('') : empty(ic, t1, t2)}</div>`;
  const count = (n, crit) => (n ? `<span class="count${crit ? ' count--crit' : ''}">${n}</span>` : '');
  function patchQueue() {
    if (S.hist === null && !S.histAsked) { S.histAsked = true; setTimeout(loadHist, 0); }
    const P = pending(), Rv = review(), A = active(), name = ID.get();
    patch('q-clin', name ? `Clinician: <b>${esc(name)}</b> · <button class="link-btn" data-act="clinician">Change clinician</button>` : 'You enter your name when you acknowledge a case. <button class="link-btn" data-act="clinician">Enter name now</button>');
    patch('n-new', count(P.length, true)); patch('n-rev', count(Rv.length)); patch('n-act', count(A.length));
    patch('q-new', list(P, row, 'bell', 'No new activations', 'A case activated by the ER arrives here with an audible alarm.'));
    patch('q-rev', list(Rv, row, 'eye', 'No case under review'));
    patch('q-act', list(A, row, 'repeat', 'No repeat ECG requested and no active confirmed STEMI'));
    patch('q-done', S.hist === null ? '<div class="qlist"><div class="loading"><span class="spinner"></span>Loading completed cases…</div></div>'
      : list(S.hist, hrow, 'lock', S.histQ ? 'No completed case with this CAD number' : 'No completed cardiology cases yet', S.histErr ? 'The list could not be loaded: no connection.' : ''));
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

  /* ---------- the case: ECG and decision first ---------- */
  function vCase() {
    return `<div id="c-head"></div>
      <div class="review"><div class="review__main"><div id="c-er" class="o-1"></div><div id="c-viewer" class="o-2"></div><div id="c-strip" class="o-3"></div><div id="c-ai" class="o-5"></div></div>
      <div class="review__side"><div id="c-decide" class="only-wide"></div>
        <details class="disc o-4" open><summary>Clinical information${icon('chev-down', 'chev')}</summary><div class="disc__b" id="c-details"></div></details>
        <details class="disc o-6"><summary>Timeline${icon('chev-down', 'chev')}</summary><div class="disc__b" id="c-tl"></div></details></div></div>
      <div class="dockbar only-narrow" id="c-dock"></div>`;
  }
  function caseHead(r) {
    return `<div class="case-h"><button class="btn btn--quiet case-h__back" data-act="queue" aria-label="Back to cases">${icon('chev-left')}<span class="lbl">Cases</span></button>
      <span class="case-h__cad">CAD #${esc(r.cad)}</span>${badge(r.state, ROLE, true)}<span class="sp"></span>
      <button class="btn btn--secondary btn--sm btn-sum" data-act="summary" aria-label="Case Summary">${icon('file')}<span class="lbl">Case Summary</span></button></div>`;
  }
  function erCard(r) {
    if (!r.cardio.activated) return `<div class="alert">${icon('minus-circle')}<div class="alert__body"><span class="alert__title">CARDIOLOGY NOT ACTIVATED</span><span>ER assessment: NOT SUSPICIOUS FOR STEMI · ${esc(r.er.reason || '')}. No cardiologist was involved.</span></div></div>`;
    if (r.legacy) return `<div class="alert">${icon('info')}<div class="alert__body"><span class="alert__title">No ER review</span><span>Sent directly to the cardiologist (case made before ER review was introduced).</span></div></div>`;
    const unc = r.er.assessment === 'uncertain';
    return `<div class="alert ${unc ? 'tone-warn' : 'tone-info'}">${icon(unc ? 'question' : 'er')}<div class="alert__body"><span class="alert__title">ER: ${esc(erAssess(r))}</span>
      <span>${esc(r.er.by || r.er.name)} · accepted ${hm(r.er.accepted)} · activated ${hm(r.cardio.activated)}${r.cardio.ack ? ` · you acknowledged ${hm(r.cardio.ack)}` : ''}</span></div></div>`;
  }
  /* the decision: on a wide screen beside the ECG; on a phone docked at the bottom */
  const decState = r => {
    if (RULES.isClosed(r.state)) return 'closed';
    if (r.state === 'cardiology_activated') return 'ack';
    if (r.state === 'cardiologist_reviewing' || r.state === 'repeat_received') return 'decide';
    return 'after';
  };
  function guard(r) {
    const L = CLIN.latest(r);
    if (!S.up) return `<div class="alert tone-crit">${icon('wifi-off')}<div class="alert__body"><span class="alert__title">No connection</span><span>A decision cannot be sent until the connection returns.</span></div></div>`;
    if (!seenSet(r.cad).has(L.n)) return `<div class="alert tone-info">${icon('info')}<div class="alert__body"><span class="alert__title">${L.n > 1 ? `NEW — ECG ${L.n} received` : `View ECG ${L.n}`}</span><span>A decision covers the latest ECG: view ECG ${L.n} first.</span><button class="btn btn--sm btn--primary" data-act="view-latest" style="align-self:flex-start;margin-top:6px">View ECG ${L.n}</button></div></div>`;
    return '';
  }
  function lastDecLine(r) {
    const d = r.dec[r.dec.length - 1];
    return d ? `${esc(RULES.DECISIONS[d.k])} · ${hm(d.at)} · ${esc(d.by)}` : '';
  }
  function decideCard(r) {
    const st = decState(r), L = CLIN.latest(r), ready = S.up && seenSet(r.cad).has(L.n), dis = ready ? '' : ' aria-disabled="true"';
    if (st === 'closed') return closedCard(r);
    if (st === 'ack') return `<section class="card card--crit"><div class="card__h"><h2>New activation</h2></div><div class="card__b decide"><p>Acknowledge to open the case. The alarm continues until then.</p><button class="btn btn--critical btn--xl btn--block" data-act="ack" data-cad="${esc(r.cad)}">ACKNOWLEDGE &amp; OPEN</button></div></section>`;
    if (st === 'decide') return `<section class="card" aria-labelledby="dec-h"><div class="card__h"><h2 id="dec-h">Decision</h2><span class="sp"></span><span class="small muted">on ECG ${L.n} · acquired ${hm(L.acq)}</span></div>
      <div class="card__b decide"><p class="decide__note">Acknowledging the case was not a decision. Choose one.</p>${guard(r)}
        <button class="btn btn--critical btn--xl btn--block" data-act="d" data-k="confirm"${dis}>${icon('alert')}CONFIRMED STEMI</button>
        <button class="btn btn--secondary btn--lg btn--block" data-act="d" data-k="not"${dis}>NOT STEMI</button>
        <button class="btn btn--secondary btn--lg btn--block" data-act="d" data-k="repeat"${dis}>${icon('repeat')}UNCLEAR — REQUEST REPEAT ECG</button>
        ${r.dec.length ? `<p class="small muted">Earlier: ${lastDecLine(r)}</p>` : ''}</div></section>`;
    /* CONFIRMED STEMI (active) or a repeat ECG requested: the decision stands; a new one can be recorded */
    const d = r.dec[r.dec.length - 1];
    const tone = r.state === 'confirmed' ? 'tone-crit-solid' : 'tone-warn';
    return `<section class="card"><div class="card__h"><h2>Decision</h2></div><div class="card__b stack-sm">
      <div class="outcome ${tone}"><span class="outcome__label">${esc(RULES.label(r.state, ROLE)[0])}</span><span class="small">${lastDecLine(r)}</span></div>
      ${r.state === 'repeat_requested' ? `<p class="small muted">When the repeat ECG arrives it shows here as NEW, with no alarm${d.instr ? ` · instruction sent: ${esc(d.instr)}` : ''}.</p>` : '<p class="small muted">The crew completes the STEMI pathway. New information keeps arriving here, silently.</p>'}
      ${guard(r)}<button class="btn btn--secondary btn--block" data-act="decide-new"${dis}>Record a new decision</button></div></section>`;
  }
  function closedCard(r) {
    const d = r.dec[r.dec.length - 1];
    const label = r.state === 'er_closed' ? 'CARDIOLOGY NOT ACTIVATED' : RULES.label(r.state, ROLE)[0];
    return `<section class="card"><div class="card__h"><h2>Outcome</h2></div><div class="card__b stack-sm">
      <div class="outcome ${r.state === 'completed' ? 'tone-ok' : ''}"><span class="outcome__label">${esc(label)}</span>${d ? `<span class="small muted">${lastDecLine(r)}</span>` : ''}</div>
      <p class="lockline">${icon('lock')}Read-only · the CAD incident itself is not changed</p></div></section>`;
  }
  function dock(r) {
    const st = decState(r), L = CLIN.latest(r), ready = S.up && seenSet(r.cad).has(L.n), dis = ready ? '' : ' aria-disabled="true"';
    if (st === 'closed') return `<p class="lockline" style="justify-content:center">${icon('lock')}${esc(r.state === 'er_closed' ? 'Cardiology not activated' : RULES.label(r.state, ROLE)[0])} · read-only</p>`;
    if (st === 'ack') return `<button class="btn btn--critical btn--xl btn--block" data-act="ack" data-cad="${esc(r.cad)}">ACKNOWLEDGE &amp; OPEN</button>`;
    const g = guard(r);
    if (st === 'decide') return `${g}<button class="btn btn--primary btn--xl btn--block" data-act="decide"${dis}>DECIDE · ECG ${L.n}</button>`;
    return `${g}<div class="btn-row"><span class="badge ${r.state === 'confirmed' ? 'tone-crit-solid' : 'tone-warn'} badge--lg" style="justify-content:center">${esc(RULES.label(r.state, ROLE)[0])}</span><button class="btn btn--secondary" data-act="decide-new"${dis}>New decision</button></div>`;
  }
  function patchCase() {
    const r = cur();
    if (!r || S.view !== 'case') return;
    patch('c-head', caseHead(r));
    patch('c-er', erCard(r));
    viewer.set(r); CLIN.updateFull(r);
    patch('c-strip', CLIN.ptStrip(r));
    patch('c-ai', viewer.cmp ? '' : CLIN.aiPanel(viewer.e || CLIN.latest(r), { collapsible: innerWidth <= 900 }));
    patch('c-decide', decideCard(r));
    patch('c-dock', dock(r));
    patch('c-details', CLIN.ptDetails(r, { since: S.since[r.cad] }));
    patch('c-tl', CLIN.timelineHtml(r));
    if (D && D.cad === r.cad) decDyn(r);
  }
  function vSummary(r) {
    return `<div class="case-h"><button class="btn btn--quiet case-h__back" data-act="sum-back">${icon('chev-left')}Back to the case</button><span class="sp"></span><span class="lockline">${icon('lock')}Read-only</span></div>
      <div class="page-h" style="margin-top:-8px"><div class="page-h__t"><h1>Case Summary · <span class="cad">CAD #${esc(r.cad)}</span></h1></div></div>${CLIN.summary(r, ROLE)}`;
  }

  /* ---------- rendering ---------- */
  function setMain(key, html) { const m = $('#main'); if (S.main !== key) { m.innerHTML = html; m._h = null; S.main = key; return true; } return false; }
  function render() {
    patch('top', top());
    patch('banner', banner());
    if ((S.view === 'case' || S.view === 'summary') && !cur()) { S.view = 'queue'; S.cad = null; }
    if (S.view === 'queue') { setMain('queue', vQueue()); patchQueue(); }
    else if (S.view === 'case') { const r = cur(); if (setMain('case:' + r.cad, vCase())) $('#c-viewer').appendChild(viewer.el); patchCase(); }
    else if (S.view === 'summary') { setMain('sum', ''); patch('main', vSummary(cur())); }
    renderAlert();
    syncAlarm();
  }
  function goQueue() {
    if (S.cad && S.view === 'case') S.since[S.cad] = now();
    S.view = 'queue'; S.cad = null; S.stat = null; CLIN.closeFull(); render(); scrollTo(0, 0);
    if (S.hist === null) loadHist();
  }
  function openCase(cad, stat) {
    if (S.cad && S.cad !== cad && S.view === 'case') S.since[S.cad] = now();
    S.cad = cad; S.stat = stat || null; S.view = 'case';
    const r = cur();
    if (r && S.since[cad] == null) S.since[cad] = r.cardio.ack || now();
    render(); scrollTo(0, 0);
  }

  /* ---------- ACKNOWLEDGE & OPEN: the only thing that stops the alarm; not a decision ---------- */
  function ack(cad) {
    const r = S.cases.get(cad);
    if (!r) return;
    if (r.state !== 'cardiology_activated') return openCase(cad);
    if (!S.up) return toast('No connection: the case cannot be acknowledged yet. The alarm continues.', 'err');
    const go = name => {
      S.acking.add(cad); syncAlarm();
      openCase(cad);
      send(cad, 'ack', { name }).then(() => { S.acking.delete(cad); render(); }, e => { S.acking.delete(cad); render(); toast(`NOT acknowledged: ${e.message} The alarm continues.`, 'err'); });
    };
    const n = ID.get();
    if (n) return go(n);
    CLIN.namePrompt({ title: 'Enter your name', over: `Acknowledge CAD #${cad}`, action: 'ACKNOWLEDGE &amp; OPEN', actionCls: 'btn--critical', cls: '', onSubmit: v => { ID.set(v); go(v); } });
  }
  function changeClinician() {
    CLIN.namePrompt({ title: 'Change clinician', over: 'Cardiologist', action: 'Save name', intro: '<p class="muted">The next case you acknowledge is recorded under this name. Cases already acknowledged keep the name recorded then.</p>', onSubmit: v => { ID.set(v); render(); toast(`Clinician: ${v}`); } });
  }

  /* ---------- decisions: two steps, so an accidental decision is hard ---------- */
  function canDecide(r) {
    const L = CLIN.latest(r);
    if (!S.up) { toast('No connection: the decision cannot be sent yet.', 'err'); return false; }
    if (!seenSet(r.cad).has(L.n)) { toast(`View ECG ${L.n} before deciding.`, 'err'); return false; }
    return true;
  }
  function choose() {
    const r = cur(); if (!r || !canDecide(r)) return;
    const L = CLIN.latest(r);
    modal.open(dlg(`Decision on ECG ${L.n}`, `<p class="muted">Acquired ${hm(L.acq)} · CAD #${esc(r.cad)}. Acknowledging the case was not a decision. Choose one; you confirm it on the next step.</p>
      <div class="btn-col"><button class="btn btn--critical btn--xl btn--block" data-act="d" data-k="confirm">${icon('alert')}CONFIRMED STEMI</button>
      <button class="btn btn--secondary btn--lg btn--block" data-act="d" data-k="not">NOT STEMI</button>
      <button class="btn btn--secondary btn--lg btn--block" data-act="d" data-k="repeat">${icon('repeat')}UNCLEAR — REQUEST REPEAT ECG</button></div>`, `<button class="btn btn--secondary" data-act="modal-close">Cancel</button>`, { over: 'Cardiologist decision' }), {});
  }
  const alsoSeen = r => { const L = CLIN.latest(r), s = seenSet(r.cad); return r.ecgs.filter(e => e.n < L.n && s.has(e.n)).map(e => e.n); };
  function decBox(r) {
    const L = CLIN.latest(r), also = alsoSeen(r);
    return `<div class="confirm-box"><span class="cad">CAD #${esc(r.cad)}</span><span class="muted">${ptLine(r)}</span><span><b>Decision on ECG ${L.n}</b> · acquired ${hm(L.acq)}${also.length ? ` · also reviewed: ${also.map(n => 'ECG ' + n).join(', ')}` : ''}</span></div>`;
  }
  function decideDialog(k) {
    const r = cur(); if (!r || !canDecide(r)) return;
    D = { cad: r.cad, k, why: k === 'repeat' ? [] : null, other: '', note: '', adv: '', ins: '', within: null, ai: null, tried: false, on: CLIN.latest(r).n };
    const aiOk = (() => { const a = CLIN.latest(r).ai; return !!a && (a.st === 'ok' || a.st === 'lim'); })();
    let title, body, foot;
    if (k === 'confirm') {
      title = 'Record CONFIRMED STEMI?';
      body = `${decBox(r)}<p>The crew sees <b>CONFIRMED STEMI</b> at once, and can then complete the STEMI pathway. The ER sees it too.</p>
        <div class="field"><label class="label" for="d-note">Note to the crew <span class="opt">(optional)</span></label><textarea class="textarea" id="d-note" rows="2" maxlength="${RULES.TEXT_MAX}"></textarea></div>
        ${aiOk ? `<div class="field"><span class="label" id="d-ai-l">Did you agree with the AI decision support? <span class="opt">(optional)</span></span><div class="choices" role="group" aria-labelledby="d-ai-l">${['Agree', 'Disagree', 'Did not use'].map(v => `<button type="button" class="choice" data-act="d-ai" data-v="${v}" aria-pressed="false">${v}</button>`).join('')}</div></div>` : ''}
        <div id="d-dyn"></div><span class="field-error" id="dlg-err" hidden></span>`;
      foot = `<button class="btn btn--secondary" data-act="modal-close">Cancel</button><button class="btn btn--critical btn--lg" data-act="d-go">CONFIRM — CONFIRMED STEMI</button>`;
    } else if (k === 'not') {
      title = 'Record NOT STEMI?';
      body = `${decBox(r)}
        <fieldset><legend class="label" id="d-why-l">Reason <span class="opt">(required)</span></legend><div class="radio-list" role="radiogroup" aria-labelledby="d-why-l" aria-describedby="d-why-err" style="margin-top:8px">${NOT_REASONS.map(x => `<button type="button" class="radio" role="radio" aria-checked="false" data-act="d-why" data-v="${esc(x)}"><span class="radio__dot"></span>${esc(x)}</button>`).join('')}</div><span class="field-error" id="d-why-err" hidden></span></fieldset>
        <div class="field" id="d-other-f" hidden><label class="label" for="d-other">Describe the reason <span class="opt">(required)</span></label><textarea class="textarea" id="d-other" rows="2" maxlength="300" aria-describedby="d-other-err"></textarea><span class="field-error" id="d-other-err" hidden></span></div>
        <div class="field"><label class="label" for="d-adv">Advice to the crew <span class="opt">(optional)</span></label><textarea class="textarea" id="d-adv" rows="2" maxlength="${RULES.TEXT_MAX}"></textarea></div>
        <div class="alert">${icon('lock')}<div class="alert__body"><span>NOT STEMI closes the STEMI pathway automatically: no cath-lab activation, and the case becomes read-only. The CAD incident itself is not changed; the crew continues standard care.</span></div></div>
        <div id="d-dyn"></div><span class="field-error" id="dlg-err" hidden></span>`;
      foot = `<button class="btn btn--secondary" data-act="modal-close">Cancel</button><button class="btn btn--primary btn--lg" data-act="d-go" aria-disabled="true">CONFIRM — NOT STEMI</button>`;
    } else {
      title = 'Unclear — request a repeat ECG';
      body = `${decBox(r)}<p>The crew sees <b>REPEAT ECG REQUESTED</b> at once. The repeat arrives here silently as ECG ${CLIN.latest(r).n + 1}.</p>
        <div class="field"><span class="label" id="d-rep-l">Reason <span class="opt">(optional, one or more)</span></span><div class="choices" role="group" aria-labelledby="d-rep-l">${REP_REASONS.map(x => `<button type="button" class="choice" data-act="d-rep" data-v="${esc(x)}" aria-pressed="false">${esc(x)}</button>`).join('')}</div></div>
        <div class="field"><label class="label" for="d-ins">Instruction to the crew <span class="opt">(optional)</span></label><textarea class="textarea" id="d-ins" rows="2" maxlength="300" placeholder="For example: add V7 to V9"></textarea></div>
        <div class="field"><span class="label" id="d-within-l">Repeat within <span class="opt">(optional)</span></span><div class="choices" role="group" aria-labelledby="d-within-l">${[[null, 'Not set'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min']].map(([v, l]) => `<button type="button" class="choice" data-act="d-within" data-v="${v == null ? '' : v}" aria-pressed="${v == null}">${l}</button>`).join('')}</div></div>
        <div id="d-dyn"></div><span class="field-error" id="dlg-err" hidden></span>`;
      foot = `<button class="btn btn--secondary" data-act="modal-close">Cancel</button><button class="btn btn--escalate btn--lg" data-act="d-go">SEND REPEAT ECG REQUEST</button>`;
    }
    modal.open(dlg(title, body, foot, { over: 'Cardiologist decision' }), { cls: 'modal--wide', onClose: () => { D = null; } });
    decDyn(r);
  }
  /* what changes in the open dialog while it is open (a new ECG, the connection), without touching what is typed */
  function decDyn(r) {
    const root = modal.el();
    if (!D || !root || !root.querySelector('#d-dyn')) return;
    const L = CLIN.latest(r), q = s => root.querySelector(s);
    const stale = L.n !== D.on, notOk = D.k === 'not' && (!D.why || (D.why === 'Other (free text)' && !D.other.trim()));
    UI.modal.patch('#d-dyn', stale ? `<div class="alert tone-info">${icon('info')}<div class="alert__body"><span class="alert__title">NEW — ECG ${L.n} received</span><span>The decision must cover the latest ECG. Close this, view ECG ${L.n}, then decide.</span></div></div>`
      : !S.up ? `<div class="alert tone-crit">${icon('wifi-off')}<div class="alert__body"><span class="alert__title">No connection</span><span>The decision cannot be sent yet.</span></div></div>` : '');
    const go = q('[data-act="d-go"]');
    if (go) go.setAttribute('aria-disabled', String(stale || !S.up || notOk));
    if (D.k === 'not') {
      root.querySelectorAll('[data-act="d-why"]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === D.why)));
      q('#d-other-f').hidden = D.why !== 'Other (free text)';
      const e1 = q('#d-why-err'), e2 = q('#d-other-err'), s1 = D.tried && !D.why, s2 = D.tried && D.why === 'Other (free text)' && !D.other.trim();
      e1.hidden = !s1; e1.innerHTML = s1 ? icon('alert') + '<span>Select the reason.</span>' : '';
      e2.hidden = !s2; e2.innerHTML = s2 ? icon('alert') + '<span>Describe the reason.</span>' : '';
    }
    if (D.k === 'repeat') {
      root.querySelectorAll('[data-act="d-rep"]').forEach(b => b.setAttribute('aria-pressed', String(D.why.includes(b.dataset.v))));
      root.querySelectorAll('[data-act="d-within"]').forEach(b => b.setAttribute('aria-pressed', String(String(D.within == null ? '' : D.within) === b.dataset.v)));
    }
    if (D.k === 'confirm') root.querySelectorAll('[data-act="d-ai"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === D.ai)));
  }
  function decideGo(btn) {
    const r = cur(); if (!D || !r) return;
    const L = CLIN.latest(r);
    if (btn.getAttribute('aria-disabled') === 'true') {
      D.tried = true; decDyn(r);
      if (D.k === 'not') { const f = modal.el().querySelector(!D.why ? '.radio' : '#d-other'); if (f) f.focus(); }
      return;
    }
    const k = D.k, data = { k, on: L.n, also: alsoSeen(r), name: ID.get() };
    if (k === 'confirm') Object.assign(data, { note: D.note.trim(), ai: D.ai });
    if (k === 'not') Object.assign(data, { reason: D.why === 'Other (free text)' ? D.other.trim() : D.why, adv: D.adv.trim() });
    if (k === 'repeat') Object.assign(data, { reasons: D.why.slice(), instr: D.ins.trim(), within: D.within });
    const label = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Sending…';
    send(r.cad, 'decision', data).then(() => {
      modal.close();
      toast(k === 'confirm' ? 'CONFIRMED STEMI sent to the crew' : k === 'not' ? 'NOT STEMI recorded — the STEMI pathway is closed' : 'Repeat ECG request sent to the crew');
    }, e => {
      btn.disabled = false; btn.textContent = label;
      const el = modal.el() && modal.el().querySelector('#dlg-err');
      if (el) { el.hidden = false; el.innerHTML = icon('alert') + `<span>The decision was NOT recorded: ${esc(e.message)}</span>`; } else toast('The decision was NOT recorded: ' + e.message, 'err');
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
      case 'ack': return ack(d.cad);
      case 'open': return openCase(d.cad);
      case 'open-done': return openDone(d.cad);
      case 'clinician': return changeClinician();
      case 'decide': case 'decide-new': return choose();
      case 'd': { const r = cur(); if (!r || !canDecide(r)) return; modal.close(); return decideDialog(d.k); }
      case 'd-go': return decideGo(t);
      case 'd-why': if (D) { D.why = d.v; decDyn(cur()); } return;
      case 'd-rep': if (D) { const i = D.why.indexOf(d.v); if (i < 0) D.why.push(d.v); else D.why.splice(i, 1); decDyn(cur()); } return;
      case 'd-within': if (D) { D.within = d.v ? +d.v : null; decDyn(cur()); } return;
      case 'd-ai': if (D) { D.ai = D.ai === d.v ? null : d.v; decDyn(cur()); } return;
      case 'summary': S.view = 'summary'; render(); scrollTo(0, 0); return;
      case 'sum-back': S.view = 'case'; render(); return;
      case 'sum-img': { const r = cur(); if (r) CLIN.showFull(r, +d.n, +d.i); return; }
      case 'view-latest': { const r = cur(); if (!r) return; modal.close(); viewer.show(CLIN.latest(r).n); const v = $('#c-viewer'); if (v) v.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    }
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    if (t.tagName === 'A') e.preventDefault();
    if (t.getAttribute('aria-disabled') === 'true' && !['d-go', 'd', 'decide', 'decide-new'].includes(t.dataset.act)) return;
    act(t.dataset.act, t);
  });
  document.addEventListener('input', e => {
    const id = e.target.id;
    if (id === 'hq') { S.histQ = e.target.value; clearTimeout(hT); hT = setTimeout(loadHist, 250); return; }
    if (!D) return;
    const k = { 'd-note': 'note', 'd-other': 'other', 'd-adv': 'adv', 'd-ins': 'ins' }[id];
    if (k) { D[k] = e.target.value; decDyn(cur()); }
  });
  $('#gate-go').addEventListener('click', () => { alarm.unlock(); $('#gate').hidden = true; S.gate = false; render(); });
  $('#sndwarn').addEventListener('click', () => alarm.unlock());
  addEventListener('resize', () => { if (S.view === 'case') { const el = $('#c-ai'); if (el) el._h = null; patchCase(); } });

  function onMsg(m) {
    switch (m.t) {
      case 'init': UI.setClock(m.now); S.started = true; if (m.fresh) { S.cases.clear(); S.hist = null; S.histAsked = false; S.view = 'queue'; S.cad = null; } return;
      case 'cases': S.cases = new Map(m.list.map(r => [r.cad, r])); break;
      case 'case': {
        const was = S.cases.get(m.cad);
        if (m.rec) S.cases.set(m.cad, m.rec); else S.cases.delete(m.cad);
        if (!m.rec && S.cad === m.cad && !S.stat) toast(`CAD #${m.cad} is no longer on this screen (taken off by the test console).`);
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
