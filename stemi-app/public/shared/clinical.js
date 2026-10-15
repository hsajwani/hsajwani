/* Shared clinical components for every role (window.CLIN):
   the ECG viewer, the AI decision-support panel, the patient data, the clinical timeline, the Case Summary, the crew's
   pathway progress, the clinician name prompt and the audible alarm.
   They only display the shared case record; nothing here decides anything clinical. */
(function () {
  'use strict';
  const { esc, icon, hm, hms, when, now, modal, dlg } = window.UI;
  const RULES = window.RULES;

  /* ---------- reading the record ---------- */
  const latest = rec => rec.ecgs[rec.ecgs.length - 1] || null;
  const ecgN = (rec, n) => rec.ecgs.find(e => e.n === n) || null;
  const imgOf = (e, i) => (e && (e.imgs.find(x => x.i === i) || e.imgs.find(x => x.i === e.pri) || e.imgs[0])) || null;
  const cur = (rec, k) => { const a = rec.pt[k]; return a && a.length ? a[a.length - 1] : null; };
  const isNv = x => !!(x && x.raw && x.raw.nv);
  const vText = x => (x ? (isNv(x) ? `<span class="nv">${esc(x.v)}</span>` : esc(x.v)) : '<span class="nv">Not entered</span>');
  const MDL = { age: 'Age', sex: 'Sex', complaint: 'Complaint', onset: 'Symptom onset', bp: 'BP', hr: 'HR', spo2: 'SpO₂', gcs: 'GCS' };
  const AIST = { proc: 'AI analysis processing', ok: 'AI analysis completed', lim: 'AI interpretation limited — ECG quality insufficient', wh: 'AI interpretation limited — ECG quality insufficient', down: 'AI interpretation unavailable' };
  const imgName = (e, x) => (x.i === e.pri ? `Image ${x.i} (Primary)` : `Image ${x.i}`);

  /* ---------- patient strip: the basics at a glance ---------- */
  function ptStrip(rec, extra) {
    const item = (k, v, data) => `<span class="pstrip__item"><span class="k">${k}</span><span class="v${data ? ' val' : ''}">${v}</span></span>`;
    const age = cur(rec, 'age'), sex = cur(rec, 'sex'), cpl = cur(rec, 'complaint'), on = cur(rec, 'onset');
    const vit = ['bp', 'hr', 'spo2', 'gcs'].map(k => { const x = cur(rec, k); return item(MDL[k], vText(x), x && !isNv(x)); }).join('');
    const e = latest(rec);
    return `<div class="pstrip" aria-label="Patient summary">${item('Age', vText(age), age && !isNv(age))}${item('Sex', vText(sex))}${item('Complaint', vText(cpl))}${item('Onset', vText(on))}${vit}${e ? item('ECG ' + e.n, `acquired <span class="val">${hm(e.acq)}</span>`) : ''}${extra || ''}</div>`;
  }

  /* ---------- the minimum data in full: latest value, its time, and every earlier value kept ---------- */
  function ptDetails(rec, o) {
    o = o || {};
    const since = o.since || Infinity;
    const isNew = x => x && x.rcv > since && x.kind !== 'sent';
    const row = (k, timed) => {
      const a = rec.pt[k] || [], c = a[a.length - 1];
      if (!c) return `<dt>${MDL[k]}</dt><dd><span class="nv">Not entered</span></dd>`;
      const earlier = a.length > 1 ? `<span class="earlier">Earlier: ${a.slice(0, -1).reverse().map(x => `${esc(x.v)} (${hm(x.t)})`).join(' · ')}</span>` : '';
      const kind = c.kind === 'correct' ? ` <span class="tag">Corrected ${hm(c.rcv)}</span>` : c.kind === 'update' ? ` <span class="tag">Updated</span>` : '';
      return `<dt>${MDL[k]}</dt><dd>${isNv(c) ? vText(c) : `<span class="${timed ? 'val' : ''}">${esc(c.v)}</span>`}${timed && !isNv(c) ? `<span class="when">${hm(c.t)}</span>` : ''}${kind}${isNew(c) ? ' <span class="tag tag--new">NEW</span>' : ''}${earlier}</dd>`;
    };
    const tx = Object.values(rec.rec || {}).flatMap(r => r.vers.map(v => ({ label: r.label, ...v }))).sort((a, b) => a.t - b.t);
    const ecgs = rec.ecgs.map(e => `<dt>ECG ${e.n}</dt><dd>acquired <span class="val">${hms(e.acq)}</span>${e.n > 1 ? `<span class="when">received ${hm(e.rcv)}</span>` : ''}${e.rcv > since && e.n > 1 ? ' <span class="tag tag--new">NEW</span>' : ''}${e.why ? `<span class="earlier">Time set by the crew: ${esc(e.why)}</span>` : ''}</dd>`).join('');
    return `<div class="kv-group"><div class="overline">Patient</div><dl class="kv">${row('age')}${row('sex')}${row('complaint')}${row('onset')}</dl></div>
      <div class="kv-group"><div class="overline">Vital signs · latest first</div><dl class="kv">${row('bp', 1)}${row('hr', 1)}${row('spo2', 1)}${row('gcs', 1)}</dl></div>
      <div class="kv-group"><div class="overline">ECG acquisition</div><dl class="kv">${ecgs || '<dt>ECG</dt><dd><span class="nv">None yet</span></dd>'}</dl></div>
      <div class="kv-group"><div class="overline">Crew / unit</div><dl class="kv"><dt>Unit</dt><dd>${esc(rec.unit)}${rec.emirate ? ` · ${esc(rec.emirate)}` : ''}</dd><dt>Crew</dt><dd>${esc(rec.crew)}</dd></dl></div>
      ${tx.length ? `<div class="kv-group"><div class="overline">Treatment updates</div><dl class="kv">${tx.map(x => `<dt>${esc(x.label)}</dt><dd>${esc(x.v)}<span class="when">${hm(x.t)}</span>${x.rcv > since ? ' <span class="tag tag--new">NEW</span>' : ''}</dd>`).join('')}</dl></div>` : ''}`;
  }

  /* ---------- AI decision support: compact and neutral; never over the ECG, never the decision ---------- */
  const STATEMENT = 'AI interpretation is decision support. The Cardiologist makes the final STEMI decision.';
  function aiStatus(a) {
    if (!a) return 'Starting';
    if (a.st === 'proc') return `Processing · started ${hms(a.start)}`;
    return `${AIST[a.st]} · ${hm(a.done)}`;
  }
  function aiBody(e) {
    const a = e.ai;
    if (!a || a.st === 'proc') return '<p class="ai__q">The AI result appears here when it is ready. The review does not wait for it.</p>';
    if (a.st === 'down') return '<p class="ai__q">AI interpretation unavailable. Continue the review with the original ECG and the patient information.</p>';
    if (a.st === 'wh') return `<p class="ai__q">${esc(a.q || 'ECG quality insufficient')}. No interpretation is given for this ECG.</p>`;
    const ser = e.n > 1 && a.ser ? `Compared with ECG ${a.ser.vs || e.n - 1}: ${a.ser.h}. ${a.ser.t}` : '';
    return `${a.q ? `<p class="ai__q">Image: ${esc(a.q)}</p>` : ''}<dl class="ai__rows">
      <dt>Rhythm</dt><dd>${esc(a.rhy || '–')}</dd><dt>Rate</dt><dd>${esc(a.rate || '–')}</dd>
      <dt>ST</dt><dd>${esc(a.ste || '–')}</dd><dt>Reciprocal</dt><dd>${esc(a.std || '–')}</dd>
      <dt>Other</dt><dd>${esc([a.cond, ser].filter(Boolean).join('. ') || '–')}</dd>
      <dt>Overall</dt><dd class="overall">${esc(a.imp || '–')}</dd></dl>`;
  }
  function aiPanel(e, o) {
    o = o || {};
    if (!e) return '';
    const head = `<span class="ai__title">AI decision support</span><span class="tag tag--sim">Simulated</span><span class="ai__st">ECG ${e.n} · ${esc(aiStatus(e.ai))}</span>`;
    const note = `<p class="ai__note">${STATEMENT}${e.ai && e.ai.conf ? ` ${esc(e.ai.conf)}.` : ''}</p>`;
    if (o.collapsible) return `<details class="ai"${o.open ? ' open' : ''}><summary class="ai__h">${head}${icon('chev-down', 'chev')}</summary>${aiBody(e)}${note}</details>`;
    return `<section class="ai" aria-label="AI decision support, ECG ${e.n}"><div class="ai__h">${head}</div>${aiBody(e)}${note}</section>`;
  }

  /* ---------- the clinical timeline: what happened, in plain words (the full audit trail stays in the test console) ---------- */
  function timeline(rec) {
    const E = [];
    const add = (t, text, kind, who) => { if (t) E.push({ t, text, kind: kind || 'key', who: who || '' }); };
    const er = rec.er || {}, cd = rec.cardio || {};
    add(rec.path && rec.path.at, `STEMI pathway opened · CAD #${rec.cad}`, 'minor', rec.crew);
    rec.ecgs.forEach(e => {
      add(e.acq, `ECG ${e.n} acquired${e.imgs.length > 1 ? ` · ${e.imgs.length} images` : ''}`, 'key');
      if (e.n > 1) add(e.rcv, `ECG ${e.n} received${e.rcv && rec.dec.some(d => d.k === 'repeat' && d.on === e.n - 1) ? ' · repeat ECG as requested' : ''}`, 'minor');
      if (e.ai && e.ai.done) add(e.ai.done, `AI decision support, ECG ${e.n}: ${AIST[e.ai.st]}`, 'minor');
    });
    if (rec.sub) add(rec.sub.send, `Sent to the ER by ${rec.unit}`, 'key', rec.crew);
    if (!rec.legacy) {
      add(er.accepted, `Accepted by ${er.name} (ER Doctor)`, 'key');
      if (er.assessment === 'activate') add(er.at, 'ER assessment: ACTIVATE CARDIOLOGIST', 'crit', er.by);
      if (er.assessment === 'uncertain') add(er.at, 'ER assessment: UNCERTAIN — cardiology activated', 'warn', er.by);
      if (er.assessment === 'not_suspicious') {
        add(er.at, `ER assessment: NOT SUSPICIOUS FOR STEMI · Reason: ${er.reason}${er.comment ? ` · ${er.comment}` : ''}`, 'key', er.by);
        add(er.at, 'Cardiology not activated', 'minor');
      }
    } else if (cd.activated) add(cd.activated, 'Sent directly to the cardiologist (case made before ER review was introduced)', 'minor');
    add(cd.ack, `Acknowledged by ${cd.name || 'the Cardiologist'} (Cardiologist)`, 'key');
    rec.dec.forEach(d => {
      add(d.at, `Cardiologist decision: ${RULES.DECISIONS[d.k]}${d.k === 'not' && d.reason ? ` · ${d.reason}` : ''}${d.k === 'repeat' && d.instr ? ` · ${d.instr}` : ''}`, d.k === 'confirm' ? 'crit' : d.k === 'repeat' ? 'warn' : 'key', d.by);
      add(d.crewAck, `Crew acknowledged: ${RULES.DECISIONS[d.k]}`, 'minor');
    });
    const sentAt = rec.sub ? rec.sub.rcv : Infinity;
    Object.entries(rec.pt).forEach(([k, a]) => a.forEach(x => { if (x.rcv > sentAt && x.kind !== 'sent') add(x.rcv, `${MDL[k]} ${x.kind === 'correct' ? 'corrected' : 'updated'}: ${x.v}`, 'minor', x.by); }));
    Object.values(rec.rec || {}).forEach(r => r.vers.forEach(v => add(v.rcv, `Treatment update — ${r.label}: ${v.v}`, 'minor', v.by)));
    if (er.crewAck) add(er.crewAck, 'Crew acknowledged the ER review outcome', 'minor');
    if (rec.closed) add(rec.closed.at, { 'er-not-activated': 'STEMI screening pathway closed following the ER Doctor assessment', 'not-stemi': 'STEMI pathway closed automatically (NOT STEMI)', completed: 'STEMI pathway completed by the crew' }[rec.closed.kind], rec.closed.kind === 'completed' ? 'ok' : 'key', rec.closed.by);
    E.sort((a, b) => a.t - b.t);
    return E;
  }
  function timelineHtml(rec, o) {
    const E = timeline(rec), L = o && o.limit ? E.slice(-o.limit) : E;
    if (!E.length) return '<p class="muted">Nothing recorded yet.</p>';
    return `<ol class="tl">${L.map(e => `<li class="k-${e.kind}"><span class="tl__t">${when(e.t)}</span><span class="tl__dot"></span><span class="tl__x">${esc(e.text)}${e.who ? `<small>${esc(e.who)}</small>` : ''}</span></li>`).join('')}</ol>`;
  }

  /* ---------- Case Summary: nothing to fill in; it never implies a step that did not happen ---------- */
  function summary(rec, role) {
    const er = rec.er || {}, cd = rec.cardio || {}, sec = (title, body) => `<section class="card"><div class="card__h"><h2>${title}</h2></div><div class="card__b">${body}</div></section>`;
    const age = cur(rec, 'age'), sex = cur(rec, 'sex'), cpl = cur(rec, 'complaint'), on = cur(rec, 'onset');
    const vit = ['bp', 'hr', 'spo2', 'gcs'].map(k => { const x = cur(rec, k); return `${MDL[k]} ${x ? (isNv(x) ? esc(x.v) : `<span class="val">${esc(x.v)}</span>`) : '–'}`; }).join(' · ');
    const caseB = `<dl class="kv kv--wide">
      <dt>CAD</dt><dd><span class="cad">CAD #${esc(rec.cad)}</span></dd>
      <dt>Status</dt><dd>${window.UI.badge(rec.state, role)}</dd>
      <dt>Patient</dt><dd>${vText(age)} · ${vText(sex)} · ${vText(cpl)}</dd>
      <dt>Symptom onset</dt><dd>${vText(on)}</dd>
      <dt>Latest vital signs</dt><dd>${vit}</dd>
      <dt>Crew / unit</dt><dd>${esc(rec.unit)} · ${esc(rec.crew)}</dd>
      <dt>Pathway opened</dt><dd>${when(rec.path && rec.path.at)}</dd>
      <dt>Sent to ER</dt><dd>${rec.sub ? when(rec.sub.send) : 'Not sent'}</dd></dl>`;
    let erB;
    if (rec.legacy) erB = '<p class="muted">No ER review: this case was sent directly to the cardiologist (it was made before ER review was introduced).</p>';
    else if (!rec.sub) erB = '<p class="muted">Not sent to the ER.</p>';
    else erB = `<dl class="kv kv--wide">
      <dt>ER Doctor</dt><dd>${er.name ? esc(er.name) : '<span class="nv">Not accepted yet</span>'}</dd>
      <dt>Accepted</dt><dd>${er.accepted ? when(er.accepted) : '–'}</dd>
      <dt>ER assessment</dt><dd>${er.assessment ? `<b>${esc(er.assessment === 'not_suspicious' ? 'NOT SUSPICIOUS FOR STEMI' : er.assessment === 'uncertain' ? 'UNCERTAIN — ACTIVATE CARDIOLOGIST' : 'ACTIVATE CARDIOLOGIST')}</b><span class="when">${when(er.at)}${er.by && er.by !== er.name ? ` · ${esc(er.by)}` : ''}</span>` : '<span class="nv">Not recorded yet</span>'}</dd>
      ${er.assessment === 'not_suspicious' ? `<dt>Reason</dt><dd>${esc(er.reason)}</dd><dt>Comment</dt><dd>${er.comment ? esc(er.comment) : '<span class="nv">None</span>'}</dd>` : ''}</dl>`;
    let cdB;
    if (!cd.activated) cdB = `<dl class="kv kv--wide"><dt>Cardiology</dt><dd><b>NOT ACTIVATED</b>${rec.state === 'er_closed' ? '<span class="earlier">The ER Doctor assessed the case as not suspicious for STEMI. No cardiologist was involved.</span>' : ''}</dd></dl>`;
    else {
      const d = rec.dec[rec.dec.length - 1], earlier = rec.dec.slice(0, -1);
      cdB = `<dl class="kv kv--wide">
        <dt>Cardiology</dt><dd><b>ACTIVATED</b><span class="when">${when(cd.activated)}</span>${cd.reason ? `<span class="earlier">${esc(cd.reason)}${cd.by ? ` · ${esc(cd.by)}` : ''}</span>` : ''}</dd>
        <dt>Cardiologist</dt><dd>${cd.name ? esc(cd.name) : '<span class="nv">Not acknowledged yet</span>'}</dd>
        <dt>Acknowledged</dt><dd>${cd.ack ? when(cd.ack) : '–'}</dd>
        <dt>${rec.closed || (d && d.k === 'confirm') ? 'Final decision' : 'Decision'}</dt><dd>${d ? `<b>${esc(RULES.DECISIONS[d.k])}</b><span class="when">${when(d.at)} · ${esc(d.by)}</span>${d.reason ? `<span class="earlier">Reason: ${esc(d.reason)}</span>` : ''}${d.note ? `<span class="earlier">Note to the crew: ${esc(d.note)}</span>` : ''}${d.adv ? `<span class="earlier">Advice: ${esc(d.adv)}</span>` : ''}${d.instr ? `<span class="earlier">Instruction: ${esc(d.instr)}</span>` : ''}` : '<span class="nv">No decision yet</span>'}</dd>
        ${earlier.length ? `<dt>Earlier decisions</dt><dd>${earlier.map(x => `${esc(RULES.DECISIONS[x.k])} <span class="when">${when(x.at)} · ${esc(x.by)}</span>`).join('<br>')}</dd>` : ''}</dl>`;
    }
    const ecgB = rec.ecgs.length ? rec.ecgs.map(e => `<div class="kv-group"><div class="row"><b>ECG ${e.n}</b><span class="muted small">acquired ${hms(e.acq)} · received ${when(e.rcv)} · ${e.imgs.length} image${e.imgs.length > 1 ? 's' : ''}</span></div>
        <div class="row" style="margin-top:8px">${e.imgs.map(x => `<button class="thumb" data-act="sum-img" data-n="${e.n}" data-i="${x.i}" aria-label="ECG ${e.n}, ${imgName(e, x)}, open full screen"><img src="${esc(x.url)}" alt="" loading="lazy"><b>${imgName(e, x)}</b><span>${hms(x.at)}</span></button>`).join('')}</div>
        <p class="small muted" style="margin-top:8px">AI decision support: ${esc(e.ai ? AIST[e.ai.st] : 'not started')}${e.ai && e.ai.imp ? ` · ${esc(e.ai.imp)}` : ''}</p></div>`).join('') : '<p class="muted">No ECG.</p>';
    const closeB = rec.closed ? sec('Pathway closure', `<dl class="kv kv--wide"><dt>Closed</dt><dd>${when(rec.closed.at)} · ${esc(rec.closed.by || '')}</dd><dt>Reason</dt><dd>${esc(rec.closed.reason)}</dd><dt>Source</dt><dd>${esc(rec.closed.source)}</dd></dl><p class="small muted" style="margin-top:12px">${icon('lock', 'ico-sm')} Read-only. Closing the STEMI pathway does not change the CAD incident.</p>`) : '';
    return `<div class="stack">${sec('Case', caseB)}${sec('ER review', erB)}${sec('Cardiology', cdB)}${sec('ECGs', ecgB)}${closeB}${sec('Timeline', timelineHtml(rec))}</div>`;
  }

  /* ---------- the crew's pathway progress: CREW → ER → CARDIOLOGY → DECISION ---------- */
  function progress(rec) {
    const st = rec.state, er = rec.er || {}, cd = rec.cardio || {}, d = rec.dec[rec.dec.length - 1];
    const step = (name, cls, ic, state, sub) => `<li class="${cls}"><span class="progress__dot">${ic}</span><span class="progress__txt"><span class="progress__name">${name}</span><span class="progress__state">${state}</span>${sub ? `<span class="progress__sub">${sub}</span>` : ''}</span></li>`;
    const ok = icon('check'), num = n => `<span>${n}</span>`;
    const crew = !rec.sub ? step('Crew', 'is-now', num(1), 'Draft — not sent', '') : step('Crew', 'is-done', ok, 'Sent', `${hm(rec.sub.send)} · ${esc(rec.unit)}`);
    let erS, cdS, decS;
    if (rec.legacy) erS = step('ER', 'is-skip', icon('minus'), 'No ER step', 'Case made before 0.5.0');
    else if (!rec.sub) erS = step('ER', 'is-wait', num(2), 'Not sent yet');
    else if (st === 'sent_to_er') erS = step('ER', 'is-attn', icon('clock'), 'Awaiting ER Doctor', `sent ${hm(rec.sub.rcv)}`);
    else if (st === 'er_reviewing') erS = step('ER', 'is-now', icon('eye'), 'ER Doctor reviewing', `${esc(er.name)} · accepted ${hm(er.accepted)}`);
    else if (er.assessment === 'not_suspicious') erS = step('ER', 'is-done', ok, 'Not suspicious for STEMI', `${esc(er.by || er.name)} · ${hm(er.at)}`);
    else erS = step('ER', 'is-done', ok, er.assessment === 'uncertain' ? 'Uncertain — cardiology activated' : 'Cardiology activated', `${esc(er.by || er.name || '')} · ${hm(er.at)}`);
    if (st === 'er_closed') cdS = step('Cardiology', 'is-skip', icon('minus'), 'Not activated', '');
    else if (!cd.activated) cdS = step('Cardiology', 'is-wait', num(3), 'Not activated yet');
    else if (!cd.ack) cdS = step('Cardiology', 'is-attn', icon('bell'), 'Activated — awaiting cardiologist', `activated ${hm(cd.activated)}`);
    else cdS = step('Cardiology', 'is-done', ok, 'Cardiologist acknowledged', `${esc(cd.name || '')} · ${hm(cd.ack)}`);
    if (st === 'er_closed') decS = step('Decision', 'is-skip', icon('minus'), 'No cardiology decision', 'ER review completed');
    else if (!cd.ack) decS = step('Decision', 'is-wait', num(4), 'Awaiting decision');
    else if (st === 'cardiologist_reviewing') decS = step('Decision', 'is-now', icon('eye'), 'Cardiologist reviewing');
    else if (st === 'repeat_requested') decS = step('Decision', 'is-attn', icon('repeat'), 'Repeat ECG requested', `${esc(d.by)} · ${hm(d.at)}`);
    else if (st === 'repeat_received') decS = step('Decision', 'is-now', icon('eye'), 'Repeat ECG sent — reviewing', `ECG ${latest(rec).n} · ${hm(latest(rec).rcv)}`);
    else if (st === 'confirmed') decS = step('Decision', 'is-crit', icon('alert'), 'CONFIRMED STEMI', `${esc(d.by)} · ${hm(d.at)}`);
    else if (st === 'not_stemi_closed') decS = step('Decision', 'is-done', ok, 'NOT STEMI — pathway closed', d ? `${esc(d.by)} · ${hm(d.at)}` : '');
    else if (st === 'completed') decS = step('Decision', 'is-done', ok, 'Confirmed STEMI — completed', rec.closed ? `completed ${hm(rec.closed.at)}` : '');
    else decS = step('Decision', 'is-wait', num(4), 'Awaiting decision');
    return `<ol class="progress" aria-label="STEMI pathway progress">${crew}${erS}${cdS}${decS}</ol>`;
  }

  /* ---------- the ECG viewer ----------
     The original ECG at full width: ECG 1 / 2 / 3 tabs, every image of each ECG, zoom and pan (buttons, keyboard, mouse
     drag and wheel, two-finger pinch), tap for full screen, serial comparison side by side. Never distorted or cropped:
     at 100 % the whole image fits. A new ECG is announced, never swapped in silently. */
  const ASPECT = 1600 / 1050, ZMAX = 4;
  class Viewer {
    constructor(o) {
      this.o = o || {};
      this.rec = null; this.n = null; this.img = {}; this.zoom = 1; this.cmp = null; this.aspect = {}; this.sig = '';
      this.el = document.createElement('div');
      this.el.className = 'ecgv';
      this.el.addEventListener('click', e => this.onClick(e));
      this.el.addEventListener('change', e => { const s = e.target.closest('[data-v="cmp-sel"]'); if (s) { this.cmp[+s.dataset.k] = +s.value; this.render(true); this.notify(); } });
      this.el.addEventListener('keydown', e => this.onKey(e));
      this.pointers();
      this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.fit()) : null;
      if (this.ro) this.ro.observe(this.el);
      else addEventListener('resize', () => this.fit());
    }
    /* the case record changed; a different case starts at its latest ECG */
    set(rec) {
      const other = !this.rec || this.rec.cad !== rec.cad;
      this.rec = rec;
      if (other) { this.n = latest(rec) ? latest(rec).n : null; this.img = {}; this.zoom = 1; this.cmp = null; }
      if (this.n == null && latest(rec)) this.n = latest(rec).n;
      this.render();
      this.notify();
    }
    show(n, i) { this.n = n; if (i) this.img[n] = i; this.zoom = 1; this.cmp = null; this.render(true); this.notify(); this.changed(); }
    changed() { if (this.o.onChange) this.o.onChange(this.n, !!this.cmp); }
    get e() { return this.rec && ecgN(this.rec, this.n); }
    get x() { return imgOf(this.e, this.img[this.n]); }
    seen(n) { return this.o.isSeen ? this.o.isSeen(n) : true; }
    /* tell the screen which images are on view (the platform records the first view of each) */
    notify() {
      if (!this.o.onView || !this.rec) return;
      if (this.cmp) this.cmp.forEach(n => { const e = ecgN(this.rec, n); if (e) this.o.onView(n, imgOf(e).i); });
      else if (this.e && this.x) this.o.onView(this.n, this.x.i);
    }
    render(force) {
      const R = this.rec, e = this.e;
      if (!R || !e) { this.el.innerHTML = `<div class="empty">${icon('ecg')}<b>No ECG yet</b></div>`; this.sig = ''; return; }
      const L = latest(R), x = this.x;
      const sig = JSON.stringify([R.cad, R.ecgs.map(g => [g.n, g.acq, g.imgs.map(y => y.i), this.seen(g.n)]), this.n, x && x.i, this.cmp, this.o.fs]);
      if (sig === this.sig && !force) { this.fit(); return; }
      this.sig = sig;
      const many = R.ecgs.length > 1;
      const tabs = R.ecgs.map(g => `<button class="ecg-tab" role="tab" aria-selected="${!this.cmp && g.n === this.n}" data-v="ecg" data-n="${g.n}">ECG ${g.n}<span class="mono">${hm(g.acq)}</span>${!this.seen(g.n) ? '<span class="tag tag--new">NEW</span>' : ''}</button>`).join('');
      const cmpBtn = many ? `<button class="ecg-tab" aria-pressed="${!!this.cmp}" data-v="cmp">${icon('compare', 'ico-sm')}Compare</button>` : '';
      const tools = this.cmp ? '' : `<div class="ecgv__tools" role="group" aria-label="Zoom">
          <button class="icon-btn" data-v="zout" aria-label="Zoom out"${this.zoom <= 1 ? ' disabled' : ''}>${icon('zoom-out')}</button>
          <span class="zoomval" aria-live="polite">${Math.round(this.zoom * 100)}%</span>
          <button class="icon-btn" data-v="zin" aria-label="Zoom in"${this.zoom >= ZMAX ? ' disabled' : ''}>${icon('zoom-in')}</button>
          <button class="icon-btn" data-v="fit" aria-label="Fit the whole ECG"${this.zoom === 1 ? ' disabled' : ''}>${icon('fit')}</button>
          ${this.o.fs ? `<button class="icon-btn" data-v="fs-close" aria-label="Close full screen">${icon('x')}</button>` : `<button class="icon-btn" data-v="fs" aria-label="Full screen">${icon('expand')}</button>`}
        </div>`;
      const closeCmp = this.cmp && this.o.fs ? `<div class="ecgv__tools"><button class="icon-btn" data-v="fs-close" aria-label="Close full screen">${icon('x')}</button></div>` : '';
      const newer = !this.cmp && L.n > this.n && !this.seen(L.n) ? `<div class="ecgv__new" role="status">${icon('info', 'ico-sm')}<span><b>NEW — ECG ${L.n} received ${hm(L.rcv)}</b> (acquired ${hm(L.acq)}). It is not shown until you open it.</span><button class="btn btn--sm btn--primary" data-v="ecg" data-n="${L.n}">View ECG ${L.n}</button></div>` : '';
      let body;
      if (this.cmp) {
        const opts = sel => R.ecgs.map(g => `<option value="${g.n}"${g.n === sel ? ' selected' : ''}>ECG ${g.n} · ${hm(g.acq)}</option>`).join('');
        body = `<div class="ecgv__panes">${this.cmp.map((n, k) => {
          const g = ecgN(R, n), y = imgOf(g);
          return `<div class="ecgv__pane"><div class="ecgv__pane-h"><label class="sr-only" for="cmp-${k}">ECG in ${k ? 'right' : 'left'} pane</label><select class="select" id="cmp-${k}" data-v="cmp-sel" data-k="${k}" style="width:auto;min-height:40px;padding:6px 10px">${opts(n)}</select><span class="muted small">acquired ${hms(g.acq)}${g.n === L.n ? ' · Latest' : ''}</span></div>
            <button class="ecgv__pane-img" data-v="pane-fs" data-n="${g.n}" aria-label="ECG ${g.n}, ${imgName(g, y)}: open full screen"><img src="${esc(y.url)}" alt="ECG ${g.n}, ${imgName(g, y)}" draggable="false"></button>
            <div class="ecgv__cap"><b>ECG ${g.n} · ${imgName(g, y)}</b><span>image ${hms(y.at)}</span></div></div>`;
        }).join('')}</div>`;
      } else {
        body = `<div class="ecgv__stage"><div class="ecgv__scroll${this.zoom > 1 ? ' is-zoomed' : ''}" tabindex="0" role="img" aria-label="ECG ${e.n}, ${imgName(e, x)}, as photographed by the crew. Zoom ${Math.round(this.zoom * 100)} percent. Plus and minus keys zoom.">
            <img src="${esc(x.url)}" alt="" draggable="false"></div>${!this.o.fs && this.zoom === 1 ? '<span class="ecgv__hint">Tap for full screen</span>' : ''}</div>
          ${e.imgs.length > 1 ? `<div class="ecgv__imgs" role="group" aria-label="Images of ECG ${e.n}">${e.imgs.map(y => `<button class="thumb" data-v="img" data-i="${y.i}" aria-pressed="${y.i === x.i}" aria-label="${imgName(e, y)}"><img src="${esc(y.url)}" alt="" loading="lazy"><b>${imgName(e, y)}${y.after ? ' <span class="tag">Added later</span>' : ''}</b><span>${hms(y.at)}</span></button>`).join('')}</div>` : ''}
          <div class="ecgv__cap"><b>ECG ${e.n} of ${R.ecgs.length} · ${imgName(e, x)}${e.imgs.length > 1 ? ` of ${e.imgs.length}` : ''}</b><span>acquired ${hms(e.acq)}</span><span>image ${hms(x.at)}</span>${e.n > 1 ? `<span>received ${hm(e.rcv)}</span>` : ''}<span>CAD #${esc(R.cad)}</span>${this.o.fs && innerWidth < 600 && innerHeight > innerWidth ? '<span>Turn the phone sideways for a larger view</span>' : ''}</div>`;
      }
      this.el.innerHTML = `<div class="ecgv__bar"><div class="ecgv__tabs" role="tablist" aria-label="ECGs in this case">${tabs}${cmpBtn}</div>${tools}${closeCmp}</div>${newer}${body}`;
      const img = this.el.querySelector('.ecgv__scroll img');
      if (img) {
        const key = x.url;
        img.addEventListener('load', () => { if (img.naturalWidth) { this.aspect[key] = img.naturalWidth / img.naturalHeight; this.fit(); } });
      }
      this.fit();
    }
    /* size the stage so the whole ECG fits at 100 %; zoom multiplies that */
    fit() {
      const st = this.el.querySelector('.ecgv__stage'), sc = this.el.querySelector('.ecgv__scroll'), img = sc && sc.querySelector('img');
      if (!st || !img || !this.x) return;
      const a = this.aspect[this.x.url] || ASPECT, w = st.clientWidth || this.el.clientWidth;
      if (!w) return;
      if (!this.o.fs) {
        const maxH = this.o.maxH ? this.o.maxH() : Infinity;
        const h = Math.round(Math.max(200, Math.min(w / a, maxH)));
        if (st.style.height !== h + 'px') st.style.height = h + 'px';
      }
      const H = st.clientHeight, base = Math.min(w, H * a);
      const px = Math.round(base * this.zoom) + 'px';
      if (img.style.width !== px) img.style.width = px;
    }
    setZoom(z, cx, cy) {
      const sc = this.el.querySelector('.ecgv__scroll');
      z = Math.max(1, Math.min(ZMAX, Math.round(z * 100) / 100));
      if (!sc || z === this.zoom) return;
      const old = this.zoom, r = sc.getBoundingClientRect();
      const ax = cx == null ? sc.clientWidth / 2 : cx - r.left, ay = cy == null ? sc.clientHeight / 2 : cy - r.top;
      const px = (sc.scrollLeft + ax) / old, py = (sc.scrollTop + ay) / old;
      this.zoom = z;
      this.fit();
      sc.scrollLeft = px * z - ax; sc.scrollTop = py * z - ay;
      sc.classList.toggle('is-zoomed', z > 1);
      const zv = this.el.querySelector('.zoomval'); if (zv) zv.textContent = Math.round(z * 100) + '%';
      const q = s => this.el.querySelector(s);
      if (q('[data-v="zout"]')) q('[data-v="zout"]').disabled = z <= 1;
      if (q('[data-v="zin"]')) q('[data-v="zin"]').disabled = z >= ZMAX;
      if (q('[data-v="fit"]')) q('[data-v="fit"]').disabled = z === 1;
      const hint = q('.ecgv__hint'); if (hint) hint.hidden = z > 1;
    }
    step(d, cx, cy) {
      const L = [1, 1.5, 2, 3, 4];
      this.setZoom(d > 0 ? (L.find(v => v > this.zoom + 0.01) || ZMAX) : ([...L].reverse().find(v => v < this.zoom - 0.01) || 1), cx, cy);
    }
    onClick(e) {
      const b = e.target.closest('[data-v]');
      if (!b || b.disabled) return;
      const v = b.dataset.v;
      if (v === 'ecg') return this.show(+b.dataset.n);
      if (v === 'img') { this.img[this.n] = +b.dataset.i; this.zoom = 1; this.render(true); this.notify(); this.changed(); return; }
      if (v === 'zin') return this.step(1);
      if (v === 'zout') return this.step(-1);
      if (v === 'fit') return this.setZoom(1);
      if (v === 'fs') return openFull(this, this.n, this.x && this.x.i);
      if (v === 'fs-close') return this.o.onClose && this.o.onClose();
      if (v === 'pane-fs') return openFull(this, +b.dataset.n);
      if (v === 'cmp') {
        if (this.cmp) { this.cmp = null; this.render(true); this.notify(); this.changed(); return; }
        const L = latest(this.rec).n;
        this.cmp = [Math.max(1, L - 1), L];
        this.render(true); this.notify(); this.changed();
        if (this.o.onCompare) this.o.onCompare(this.cmp.slice());
      }
    }
    onKey(e) {
      if (!e.target.classList || !e.target.classList.contains('ecgv__scroll')) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); this.step(1); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); this.step(-1); }
      else if (e.key === '0') { e.preventDefault(); this.setZoom(1); }
      else if (e.key === 'Enter' && !this.o.fs) { e.preventDefault(); openFull(this, this.n, this.x && this.x.i); }
    }
    /* drag to pan, two fingers to pinch, wheel + Ctrl to zoom, a tap opens full screen, a double tap zooms */
    pointers() {
      const P = new Map();
      let start = null, pinch = null, moved = false, lastTap = 0;
      const sc = () => this.el.querySelector('.ecgv__scroll');
      this.el.addEventListener('pointerdown', e => {
        const s = e.target.closest('.ecgv__scroll'); if (!s || e.button > 0) return;
        P.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { s.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
        moved = false;
        if (P.size === 1) start = { x: e.clientX, y: e.clientY, l: s.scrollLeft, t: s.scrollTop };
        if (P.size === 2) { const [a, b] = [...P.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.zoom }; }
      });
      this.el.addEventListener('pointermove', e => {
        if (!P.has(e.pointerId)) return;
        P.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const s = sc(); if (!s) return;
        if (P.size === 2 && pinch) {
          const [a, b] = [...P.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
          moved = true;
          this.setZoom(pinch.z * d / Math.max(20, pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
          return;
        }
        if (start && this.zoom > 1) {
          const dx = e.clientX - start.x, dy = e.clientY - start.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) { moved = true; s.classList.add('is-drag'); }
          s.scrollLeft = start.l - dx; s.scrollTop = start.t - dy;
        } else if (start && Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 8) moved = true;
      });
      const end = e => {
        if (!P.has(e.pointerId)) return;
        P.delete(e.pointerId);
        const s = sc(); if (s) s.classList.remove('is-drag');
        if (P.size < 2) pinch = null;
        if (P.size === 0) {
          if (!moved && e.type === 'pointerup' && start) {
            const t = Date.now();
            if (t - lastTap < 320) { lastTap = 0; this.setZoom(this.zoom > 1 ? 1 : 2, e.clientX, e.clientY); }
            else {
              lastTap = t;
              /* a single tap at 100 % opens full screen (after the double-tap window) */
              if (!this.o.fs && this.zoom === 1) setTimeout(() => { if (lastTap === t) openFull(this, this.n, this.x && this.x.i); }, 330);
            }
          }
          start = null;
        }
      };
      this.el.addEventListener('pointerup', end);
      this.el.addEventListener('pointercancel', end);
      this.el.addEventListener('wheel', e => {
        if (!(e.ctrlKey || e.metaKey) || !e.target.closest('.ecgv__scroll')) return;
        e.preventDefault();
        this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
      }, { passive: false });
    }
  }
  /* full screen: a second viewer over everything, on the same ECG */
  let FS = null;
  function openFull(src, n, i) {
    closeFull();
    const opener = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'ecgfs';
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'ECG full screen');
    const v = new Viewer({ fs: true, isSeen: src.o.isSeen, onView: src.o.onView, onClose: closeFull });
    wrap.appendChild(v.el);
    document.body.appendChild(wrap);
    document.documentElement.style.overflow = 'hidden';
    v.rec = src.rec; v.n = n || src.n; if (i) v.img[v.n] = i;
    v.render(true); v.notify();
    FS = { wrap, v, src, opener };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); closeFull(); } };
    wrap.addEventListener('keydown', key);
    const sc = wrap.querySelector('.ecgv__scroll'); if (sc) sc.style.touchAction = 'none';
    setTimeout(() => { const b = wrap.querySelector('[data-v="fs-close"]'); if (b) b.focus(); v.fit(); }, 30);
  }
  function closeFull() {
    if (!FS) return;
    const { wrap, v, src, opener } = FS;
    FS = null;
    if (v.ro) v.ro.disconnect();
    wrap.remove();
    document.documentElement.style.overflow = '';
    /* the main viewer follows what was looked at full screen */
    if (src && src.rec && !src.cmp && v.n !== src.n) src.show(v.n, v.img[v.n]);
    if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
  }
  /* the record changed while full screen is open: keep it current */
  function updateFull(rec) { if (FS && FS.v.rec && FS.v.rec.cad === rec.cad) { FS.v.rec = rec; FS.v.render(); } }
  /* full screen straight from a thumbnail (Case Summary) */
  function showFull(rec, n, i) { const v = new Viewer({}); v.rec = rec; v.n = n; openFull(v, n, i); }

  /* ---------- the clinician's name (prototype identification, not authentication) ---------- */
  function identity(role) {
    const K = 'stemi.clinician.' + role;
    return {
      get() { try { return sessionStorage.getItem(K) || ''; } catch (_) { return ''; } },
      set(n) { try { sessionStorage.setItem(K, n); } catch (_) { /* private mode */ } },
      clear() { try { sessionStorage.removeItem(K); } catch (_) { /* private mode */ } }
    };
  }
  /* ENTER YOUR NAME → the action. o: { title, over, intro, action, actionCls, value, onSubmit(name) } */
  function namePrompt(o) {
    const body = `${o.intro ? `<div>${o.intro}</div>` : ''}
      <div class="field"><label class="label" for="clin-name">Your name</label>
        <input class="input" id="clin-name" name="clinician-name" autocomplete="name" maxlength="${RULES.NAME_MAX + 20}" placeholder="e.g. Dr. Ahmed Mohammed" value="${esc(o.value || '')}" aria-describedby="clin-name-hint clin-name-err" spellcheck="false">
        <span class="hint" id="clin-name-hint">Recorded with the time against this CAD number. Remembered on this browser until it is closed.</span>
        <span class="field-error" id="clin-name-err" hidden></span></div>
      <p class="xs subtle">Prototype clinician identification only. A typed name is not secure authentication.</p>`;
    modal.open(dlg(o.title || 'Enter your name', body, `<button class="btn btn--secondary" data-act="modal-close">Cancel</button><button class="btn ${o.actionCls || 'btn--primary'} btn--lg" data-name-go>${o.action}</button>`, { over: o.over }), { focus: '#clin-name', cls: o.cls });
    const root = modal.el(), inp = root.querySelector('#clin-name'), er = root.querySelector('#clin-name-err');
    const go = () => {
      const r = RULES.cleanName(inp.value);
      if (!r.ok) { er.hidden = false; er.innerHTML = icon('alert') + `<span>${esc(r.error)}</span>`; inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
      modal.close();
      o.onSubmit(r.name);
    };
    root.querySelector('[data-name-go]').addEventListener('click', go);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    inp.addEventListener('input', () => { if (!er.hidden) { er.hidden = true; inp.removeAttribute('aria-invalid'); } });
  }

  /* ---------- the audible alarm (Web Audio in this page) ----------
     It sounds only while the screen's owner says so (a new case not yet accepted / acknowledged) and stops at once when
     that ends. Browsers block sound until a tap, hence the start screen; a blocked sound is shown, never silent.
     Production must not rely on browser sound (see docs/production-gaps.md). */
  function Alarm() {
    let AC = null, timer = null, want = false;
    const warn = () => document.getElementById('sndwarn');
    function ensure() {
      try {
        if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
        if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
        if (AC.state !== 'running') AC.resume().then(sync, () => {});
      } catch (_) { /* no Web Audio */ }
    }
    function beep(f, t0, d) {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.16, t0 + 0.012); g.gain.setValueAtTime(0.16, t0 + d - 0.03); g.gain.linearRampToValueAtTime(0, t0 + d);
      o.connect(g); g.connect(AC.destination); o.start(t0); o.stop(t0 + d + 0.02);
    }
    function pattern() { if (!AC || AC.state !== 'running') return; const t = AC.currentTime + 0.03; [[988, 0], [740, 0.2], [988, 0.4], [740, 0.6]].forEach(([f, d]) => beep(f, t + d, 0.17)); }
    function sync() {
      if (want && !timer) { pattern(); timer = setInterval(pattern, 1600); }
      if (!want && timer) { clearInterval(timer); timer = null; }
      const w = warn(); if (w) w.hidden = !(want && (!AC || AC.state !== 'running'));
    }
    ['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, ensure, true));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && AC && AC.state !== 'running') AC.resume().then(sync, () => {}); sync(); });
    setInterval(sync, 1000);
    return {
      set(v) { want = !!v; sync(); },
      /* the start screen's tap: allow sound and play one short test pattern */
      unlock() { ensure(); setTimeout(pattern, 80); sync(); },
      get on() { return !!timer; }
    };
  }

  window.CLIN = { latest, ecgN, imgOf, cur, isNv, vText, MDL, AIST, STATEMENT, ptStrip, ptDetails, aiPanel, timeline, timelineHtml, summary, progress, Viewer, showFull, updateFull, closeFull, identity, namePrompt, Alarm };
})();
