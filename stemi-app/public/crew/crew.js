/* Crew MDT (landscape tablet first; also desktop and portrait).
   OPEN STEMI PATHWAY → CAD NUMBER (entered manually from the dispatch / MDT information) → the case is created and linked
   to the unit's corpuls monitor → the ECG and the vital signs arrive from corpuls by themselves → the crew adds only what
   corpuls cannot know (age, sex, presenting complaint, symptom onset) → SEND TO ER → back to the patient.
   After SEND the crew mostly follows the status: CREW → ER → CARDIOLOGY → DECISION. A repeat ECG is acquired on corpuls
   and arrives by itself. The manual ECG upload and manual vital signs are the fallback when corpuls is not available.
   The unsent case and anything waiting for the connection are kept on this tablet (OFFLINE — CHANGES SAVED LOCALLY).
   Nothing here decides anything clinical. */
(() => {
  'use strict';
  const { $, $$, esc, icon, hm, hms, when, now, toast, modal, dlg, badge, conn, topbar, patch, empty, rid } = UI;
  const ROLE = 'crew', AU = UI.APP.user || {}, ME = `${AU.name}, ${AU.title}`;
  const LSK = 'stemi.crew.v2', MAXI = 4;
  const COMPLAINTS = [
    { k: 'cp', l: 'Chest pain', s: 'Chest pain' },
    { k: 'sob', l: 'Shortness of breath', s: 'Shortness of breath' },
    { k: 'epi', l: 'Epigastric pain', s: 'Epigastric pain' },
    { k: 'syn', l: 'Collapse / syncope', s: 'Collapse or syncope' },
    { k: 'pal', l: 'Palpitations', s: 'Palpitations' },
    { k: 'ecg', l: 'Abnormal ECG', s: 'Abnormal ECG' },
    { k: 'oth', l: 'Other', s: 'Other' }
  ];
  /* what the crew enters: only what corpuls cannot know */
  const FIELDS = [{ k: 'age', l: 'Age' }, { k: 'sex', l: 'Sex' }, { k: 'complaint', l: 'Presenting complaint' }, { k: 'onset', l: 'Symptom onset' }];
  /* entered only as a manual fallback, when corpuls has no values */
  const VFIELDS = [{ k: 'bp', l: 'Blood pressure' }, { k: 'hr', l: 'Heart rate' }, { k: 'spo2', l: 'SpO₂' }, { k: 'rr', l: 'Respiratory rate' }];
  const NV = { age: ['Unknown'], sex: ['Unknown'], onset: ['Unknown'] };
  const TREAT = [
    { k: 'asp', l: 'Aspirin', opts: ['Given', 'Taken before our arrival', 'Not given'] },
    { k: 'gtn', l: 'GTN', opts: ['Given', 'Not given'] },
    { k: 'ana', l: 'Analgesia', opts: ['Given', 'Not given'] },
    { k: 'oxy', l: 'Oxygen', opts: ['Given', 'Not given'] },
    { k: 'otx', l: 'Other treatment', opts: ['Given'] }
  ];
  const S = { cases: new Map(), view: 'home', cad: null, stat: null, draft: null, out: [], ecgd: {}, up: false, started: false, epoch: null,
    hist: null, histQ: '', histErr: false, sim: { find: 'border', q: 'good' }, main: '', mdTried: false, prevState: {}, shownDec: new Set() };
  let LIVE = null, seq = 0, TD = null, pickFor = null, sentPick = null;
  const p2 = n => String(n).padStart(2, '0');
  const hhmm = t => { const x = new Date(t); return `${p2(x.getHours())}:${p2(x.getMinutes())}`; };
  /* a time picked on the tablet ("HH:MM") as today's time; a time later than now means yesterday */
  const fromClock = (v, slackMs) => { const [h, m, s] = v.split(':').map(Number), x = new Date(now()); x.setHours(h || 0, m || 0, s || 0, 0); const t = x.getTime(); return t > now() + (slackMs || 60e3) ? t - 864e5 : t; };

  /* ---------- this tablet's own copy: the unsent case and whatever waits for the connection ---------- */
  let saveT = null, lastSaved = '';
  function saveLocal(immediate) {
    clearTimeout(saveT);
    const go = () => {
      try {
        const s = JSON.stringify({ user: AU.id, epoch: S.epoch, draft: S.draft, out: S.out, ecgd: S.ecgd });
        if (s !== lastSaved) { localStorage.setItem(LSK, s); lastSaved = s; }
      } catch (_) { toast('This tablet\'s storage is full: send or discard the unsent case.', 'err'); }
    };
    if (immediate) go(); else saveT = setTimeout(go, 250);
  }
  function restoreLocal() {
    try {
      const s = JSON.parse(localStorage.getItem(LSK) || 'null');
      if (!s || s.user !== AU.id) return;
      S.draft = s.draft || null; S.out = s.out || []; S.ecgd = s.ecgd || {}; S.epoch = s.epoch || null;
      const d = S.draft;
      if (d) {
        /* an unsent case saved by 0.5.0 was created on the platform only at SEND */
        if (d.created == null) d.created = !!(d.send && d.send.created);
        if (d.editCad == null) d.editCad = !d.cadOk;
        if (d.send && d.send.stage !== 'queued') d.send.stage = 'failed';
      }
    } catch (_) { /* unreadable: start clean */ }
  }

  /* ---------- the crew's minimum data: every item needs an answer; Unknown is an answer ---------- */
  const RANGE = { age: [0, 120], sys: [40, 300], dia: [20, 200], hr: [20, 300], spo2: [50, 100], rr: [3, 80] };
  const inRange = (v, [a, b]) => Number.isInteger(v) && v >= a && v <= b;
  function mdErrors(md) {
    const e = {}, a = md || {};
    if (!a.age) e.age = 'Enter the age (or an estimate), or choose Unknown.';
    else if (!a.age.nv && !inRange(a.age.v, RANGE.age)) e.age = 'Age: a whole number from 0 to 120 years.';
    if (!a.sex) e.sex = 'Choose the sex, or Unknown.';
    if (!a.complaint) e.complaint = 'Choose the presenting complaint (or the reason for the ECG).';
    else if (a.complaint.k === 'oth' && !String(a.complaint.other || '').trim()) e.complaint = 'Describe the presenting complaint.';
    if (!a.onset) e.onset = 'Enter the symptom onset time, or choose Unknown.';
    else if (!a.onset.nv && !(a.onset.t <= now() + 5 * 60e3)) e.onset = 'The onset time cannot be in the future.';
    return e;
  }
  /* manual fallback vital signs: plausible input only (no clinical thresholds) */
  function vErrors(v) {
    const e = {};
    if (v.bp) { if (!inRange(v.bp.sys, RANGE.sys) || !inRange(v.bp.dia, RANGE.dia)) e.bp = 'BP: systolic 40–300 and diastolic 20–200 mmHg.'; else if (v.bp.sys <= v.bp.dia) e.bp = 'BP: the systolic value must be higher than the diastolic.'; }
    if (v.hr && !inRange(v.hr.v, RANGE.hr)) e.hr = 'Heart rate: 20–300 bpm.';
    if (v.spo2 && !inRange(v.spo2.v, RANGE.spo2)) e.spo2 = 'SpO₂: 50–100 %.';
    if (v.rr && !inRange(v.rr.v, RANGE.rr)) e.rr = 'Respiratory rate: 3–80 /min.';
    return e;
  }
  const answered = md => FIELDS.filter(f => md && md[f.k] && !mdErrors({ [f.k]: md[f.k] })[f.k]).length;
  const onsetText = (t, approx) => `${new Date(now()).toDateString() === new Date(t).toDateString() ? '' : 'yesterday '}${hm(t)}${approx ? ' (approximate)' : ''}`;
  function mdText(k, a) {
    if (!a) return '';
    if (a.nv) return a.nv;
    switch (k) {
      case 'age': return a.est ? `≈ ${a.v} y (estimated)` : `${a.v} y`;
      case 'sex': return a.v;
      case 'complaint': { const c = COMPLAINTS.find(x => x.k === a.k); return a.k === 'oth' ? `Other: ${String(a.other || '').trim()}` : c ? c.s : a.k; }
      case 'onset': return onsetText(a.t, a.approx);
      case 'bp': return `${a.sys}/${a.dia} mmHg`;
      case 'hr': return `${a.v} bpm`;
      case 'spo2': return `${a.v} %`;
      case 'rr': return `${a.v} /min`;
    }
    return '';
  }
  /* SEND carries the four items, and manual fallback vital signs only if the crew entered any */
  const mdPayload = md => Object.fromEntries(FIELDS.map(f => f.k).concat(VFIELDS.map(f => f.k).filter(k => md[k])).map(k => [k, { v: mdText(k, md[k]), raw: md[k], t: md[k].at || now(), fb: !!md[k].fb }]));

  /* ---------- the manual ECG fallback: a photo from this tablet's camera, an image file, or a fictional test ECG ---------- */
  const variantFor = n => (n === 1 ? (S.sim.find === 'clear' ? 'clear' : 'border') : S.sim.find === 'clear' ? 'clear2' : 'evolved');
  const KINDS = ['full', 'chest', 'lower', 'full'];
  function testImage(e, i) {
    const kind = KINDS[(i - 1) % KINDS.length], q = kind === 'full' ? S.sim.q || 'good' : 'good';
    return { i, at: now(), q, kind, src: 'gen', data: window.ECG.photo(e.variant, kind, q, e.acq).url };
  }
  function fileToJpeg(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error('Choose a JPEG or PNG image.'));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('The image could not be read.'));
      fr.onload = () => {
        const im = new Image();
        im.onerror = () => reject(new Error('The image could not be opened.'));
        im.onload = () => {
          const k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
          c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.86));
        };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  /* the fallback ECG being built: the unsent case's (sent with it), or one for a sent case (keyed by its CAD number) */
  const ecgOf = where => (where === 'draft' ? S.draft && S.draft.ecg : S.ecgd[where]);
  function startEcg(e) { if (!e.imgs.length) { e.acq = now(); e.acqSet = false; e.acqWhy = ''; e.variant = e.variant || variantFor(e.n); } }
  function addImage(where, how) {
    const e = ecgOf(where); if (!e) return;
    if (e.imgs.length >= MAXI) return toast(`At most ${MAXI} images per ECG in this build.`, 'err');
    if (how === 'gen') { startEcg(e); e.imgs.push(testImage(e, e.imgs.length + 1)); return afterImage(where); }
    pickFor = where;
    const inp = $(how === 'camera' ? '#file-camera' : '#file-pick'); inp.value = ''; inp.click();
  }
  function afterImage(where) {
    const e = ecgOf(where);
    saveLocal(true);
    toast(`Image ${e.imgs.length} added to the manual fallback ECG`);
    if (where === 'draft') { modal.close(); render(); } else ecgPanel();
  }
  /* the next ECG number of a case: after what the platform has (corpuls ECGs included) */
  const nextN = cad => { const r = cad && S.cases.get(cad); return (r ? r.ecgs.length : 0) + 1; };
  function addMenu(where) {
    const e = ecgOf(where); if (!e) return;
    const n = where === 'draft' ? nextN(S.draft.created && S.draft.cad) : e.n;
    modal.open(dlg(`Manual ECG fallback · ECG ${n}`, `<p>Use this only when the ECG cannot come from corpuls (no connection, or the transmission failed): photograph the 12-lead printout. It is recorded as a <b>manual fallback</b> ECG.</p>
      <div class="addmenu"><button class="btn btn--primary btn--lg btn--block" data-act="img-camera" data-where="${esc(where)}">${icon('camera')}Take a photo</button>
      <button class="btn btn--secondary btn--lg btn--block" data-act="img-file" data-where="${esc(where)}">${icon('upload')}Choose an image file</button>
      <button class="btn btn--secondary btn--lg btn--block" data-act="img-gen" data-where="${esc(where)}">${icon('ecg')}Use a fictional test ECG image</button></div>
      <p class="xs subtle">Test build: use fictional test images only, never a real patient's ECG.</p>`, '<button class="btn btn--secondary" data-act="modal-close">Cancel</button>', { over: 'MANUAL ECG FALLBACK' }));
  }
  function shotHtml(e, x, where, locked) {
    const q = x.q === 'glare' ? 'Glare over leads I–III' : x.q === 'cut' ? 'Leads V4–V6 cut off' : x.q === 'file' ? 'Image file (not checked in this build)' : 'Fictional test image';
    return `<div class="shot"><button class="shot__img" data-act="shot-view" data-where="${esc(where)}" data-i="${x.i}" aria-label="Fallback ECG, Image ${x.i}: view full screen"><img src="${esc(x.data || x.url)}" alt=""></button>
      <div class="shot__t"><b>Image ${x.i}</b>${x.i === 1 ? '<span class="tag tag--primary">Primary</span>' : ''}<span class="muted">${hms(x.at)}</span></div>
      <span class="quality muted">${q}</span>${locked ? '' : `<div class="shot__a"><button class="btn btn--sm btn--danger-quiet" data-act="img-remove" data-where="${esc(where)}" data-i="${x.i}">${icon('trash')}Remove</button></div>`}</div>`;
  }
  const shotsHtml = (e, where) => `<div class="shots">${e.imgs.map(x => shotHtml(e, x, where)).join('')}${e.imgs.length < MAXI ? `<div class="shot shot--add"><button class="btn btn--secondary" data-act="img-add" data-where="${esc(where)}">${icon('plus')}ADD ECG IMAGE</button><span class="xs subtle" style="text-align:center">${e.imgs.length ? 'Another image of the same ECG' : 'Photo of the 12-lead ECG'}</span></div>` : ''}</div>`;
  function viewLocal(e, i) {
    const rec = { cad: S.draft && S.draft.cad || 'not sent', ecgs: [{ n: e.n, acq: e.acq, rcv: null, pri: 1, src: 'manual_fallback', imgs: e.imgs.map(x => ({ i: x.i, at: x.at, url: x.data || x.url })) }] };
    CLIN.showFull(rec, e.n, i);
  }
  function removeImage(where, i) {
    const e = ecgOf(where); if (!e) return;
    modal.open(dlg(`Remove Image ${i} of the fallback ECG?`, '<p>This image has not been sent. Removing it deletes it from this tablet.</p>',
      `<button class="btn btn--secondary" data-act="${where === 'draft' ? 'modal-close' : 'ecg-panel'}">Keep it</button><button class="btn btn--critical" data-act="img-remove-go" data-where="${esc(where)}" data-i="${i}">Remove image</button>`, { over: 'Unsent image' }), { focus: '.modal__f .btn' });
  }
  function acqDialog(where) {
    const e = ecgOf(where); if (!e || !e.imgs.length) return;
    const d = new Date(e.acq);
    modal.open(dlg('Fallback ECG acquisition time', `<p class="muted">The time the ECG was recorded. It defaults to the time of the first image.</p>
      <div class="field"><label class="label" for="acq-t">ECG acquired at</label><input class="input input--time" id="acq-t" type="time" step="1" value="${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}" style="width:200px"></div>
      <div class="field"><label class="label" for="acq-why">Why the time differs from the first image <span class="opt">(required when changed)</span></label><input class="input" id="acq-why" maxlength="200" value="${esc(e.acqWhy || '')}" placeholder="For example: photographed after the recording"><span class="field-error" id="acq-err" hidden></span></div>`,
      `<button class="btn btn--secondary" data-act="${where === 'draft' ? 'modal-close' : 'ecg-panel'}">Cancel</button><button class="btn btn--primary" data-act="acq-save" data-where="${esc(where)}">Save time</button>`, { over: 'MANUAL ECG FALLBACK' }), { focus: '#acq-t' });
  }
  function acqSave(where) {
    const e = ecgOf(where), root = modal.el(), v = root.querySelector('#acq-t').value, why = root.querySelector('#acq-why').value.trim(), er = root.querySelector('#acq-err');
    const fail = msg => { er.hidden = false; er.innerHTML = icon('alert') + `<span>${esc(msg)}</span>`; };
    if (!v) return fail('Enter the time.');
    const t = fromClock(v), first = e.imgs[0].at, changed = Math.abs(t - first) > 1000;
    if (t > first + 1000) return fail('An ECG cannot be recorded after its first photo was taken.');
    if (changed && !why) return fail('Say why the time differs from the first image.');
    e.acq = changed ? t : first; e.acqSet = changed; e.acqWhy = changed ? why : '';
    saveLocal(true);
    if (where === 'draft') { modal.close(); render(); } else ecgPanel();
  }

  /* ---------- sending: actions and images wait here, in order, until the platform has them ---------- */
  const op = (cad, k, data, t) => ({ id: `cr-${rid()}-${++seq}`, cad, k, t: t == null ? now() : t, data: data || {} });
  function queue(item) { S.out.push(item); saveLocal(true); pump(); render(); }
  let pumping = false;
  async function pump() {
    if (pumping || !S.up) return;
    pumping = true;
    try {
      while (S.out.length && S.up) {
        const it = S.out[0];
        if (it.kind === 'req') {
          try { await LIVE.request(it.method, it.url, it.body); } catch (_) { return; }
          S.out.shift(); saveLocal(true); continue;
        }
        if (it.kind === 'ecg' || it.kind === 'img') {
          for (const x of it.imgs) {
            if (x.imageId) continue;
            const r = await LIVE.upload(dataUrlToBlob(x.data), { cad: it.cad, src: x.src === 'file' ? 'file' : 'gen' }, null).catch(e => ({ err: e }));
            if (r.err) { if (r.err.status && r.err.status < 500) { drop(it, r.err.message); break; } return; }
            x.imageId = r.id; x.url = r.url; saveLocal(true);
          }
          if (S.out[0] !== it) continue;
        }
        let o = it.op;
        if (it.kind === 'ecg') o = { ...op(it.cad, 'ecg', { sendAt: it.sendAt, ecg: { n: it.n, acq: it.acq, variant: it.variant, pri: 1, same: false, timeWhy: it.acqWhy || null, imgs: it.imgs.map(x => ({ i: x.i, kind: x.kind, q: x.q, at: x.at, imageId: x.imageId })) } }, it.sendAt), id: it.id };
        if (it.kind === 'img') { const x = it.imgs[0]; o = { ...op(it.cad, 'img', { n: it.n, img: { i: x.i, kind: x.kind, q: x.q, at: x.at, imageId: x.imageId } }, it.at), id: it.id }; }
        let res;
        try { res = await LIVE.send([o]); } catch (_) { return; }
        const x = (res.results || [])[0] || {};
        if (!x.ok) drop(it, x.error); else { S.out.shift(); saveLocal(true); }
      }
    } finally { pumping = false; render(); }
  }
  function drop(it, why) {
    const i = S.out.indexOf(it); if (i >= 0) S.out.splice(i, 1);
    saveLocal(true);
    toast(`${it.kind === 'ecg' ? `Fallback ECG ${it.n}` : it.kind === 'img' ? `Image ${it.imgs[0].i} of ECG ${it.n}` : 'An entry'} was NOT accepted: ${why || 'refused by the platform'}`, 'err');
  }
  const pendingFor = cad => S.out.filter(x => x.cad === cad);
  function send(k, data) { const r = cur(); if (r) queue({ kind: 'op', cad: r.cad, op: op(r.cad, k, data) }); }

  /* ---------- the unsent case (the draft) ---------- */
  const newDraft = () => ({ cid: 't' + rid() + rid(), openedAt: now(), cad: '', cadIn: '', cadOk: false, cadChecked: false, cadHist: [], created: false, editCad: true,
    ecg: { n: 1, imgs: [], acq: null, acqSet: false, acqWhy: '', variant: null }, md: {}, send: null });
  /* the draft's record on the platform (the ECGs and the vital signs from corpuls arrive there) */
  const dRec = () => (S.draft && S.draft.created && S.draft.cad ? S.cases.get(S.draft.cad) || null : null);
  function ready(d) {
    const rec = dRec(), corp = rec ? rec.ecgs.length : 0;
    return { cad: d.cadOk && !d.editCad, ecg: corp > 0 || d.ecg.imgs.length > 0, corp, fb: d.ecg.imgs.length, md: !Object.keys(mdErrors(d.md)).length, n: answered(d.md) };
  }
  /* create the case under the CAD number and link the unit's corpuls monitor: one request */
  let creating = null;
  function ensureCreated(d) {
    if (d.created) return Promise.resolve(true);
    if (creating) return creating;
    creating = LIVE.request('POST', '/api/cases', { cad: d.cad, cid: d.cid, openedAt: d.openedAt, hist: d.cadHist, link: true }).then(x => {
      creating = null;
      if (S.draft !== d) return false;
      if (x.status === 201 || x.status === 200) { d.created = true; d.cadChecked = true; if (x.body.rec) S.cases.set(d.cad, x.body.rec); saveLocal(true); render(); return true; }
      if (x.status === 409 && x.body.code === 'exists') { d.cadOk = false; d.editCad = true; d.send = null; saveLocal(true); render(); dupDialog(d.cad, x.body.existing); return false; }
      if (x.status === 400) { d.cadOk = false; d.editCad = true; d.send = null; saveLocal(true); render(); toast(`${x.body.error} ${x.body.detail || ''}`, 'err'); return false; }
      throw new Error('HTTP ' + x.status);
    }, e => { creating = null; throw e; });
    return creating;
  }
  /* LINK CORPULS: the CAD number is checked, the case created on the platform and linked to corpuls */
  function cadContinue() {
    const d = S.draft, inp = $('#cadin'), err = $('#cad-err'), btn = $('[data-act="cad-ok"]');
    if (!d || !inp) return;
    const raw = inp.value, c = CADN.check(raw);
    d.cadIn = raw;
    const fail = (msg, detail) => { err.hidden = false; err.innerHTML = icon('alert') + `<span>${esc(msg)}${detail ? ' ' + esc(detail) : ''}</span>`; inp.setAttribute('aria-invalid', 'true'); inp.focus(); };
    if (!c.ok) return fail(c.error, c.detail);
    /* correcting the CAD number of a case already on the platform (not sent): the case and its corpuls data move with it */
    if (d.created && d.cad) {
      if (c.cad === d.cad) { d.editCad = false; saveLocal(true); return render(); }
      if (!S.up) return fail('No connection: this CAD number can be corrected when the connection returns.');
      if (btn) btn.disabled = true;
      LIVE.request('POST', '/api/cases/correct', { cad: d.cad, to: c.cad }).then(x => {
        if (btn) btn.disabled = false;
        if (x.status === 200) {
          d.cadHist.push({ v: c.cad, t: now() }); d.cad = c.cad; d.cadIn = c.cad; d.editCad = false;
          if (x.body.rec) S.cases.set(c.cad, x.body.rec);
          saveLocal(true); render(); return toast(`CAD number corrected: CAD #${c.cad}`);
        }
        if (x.status === 409 && x.body.code === 'exists') return dupDialog(c.cad, x.body.existing);
        fail(x.body.error || 'The CAD number was not corrected.', x.body.detail);
      }, () => { if (btn) btn.disabled = false; fail('No connection: the CAD number was not corrected.'); });
      return;
    }
    if (!d.cadHist.length || d.cadHist[d.cadHist.length - 1].v !== c.cad) d.cadHist.push({ v: c.cad, t: now() });
    d.cad = c.cad; d.cadIn = c.cad; d.cadOk = true; d.editCad = false; d.cadChecked = false;
    saveLocal(true);
    if (!S.up) { render(); return toast('No connection: the CAD number is kept on this tablet. The case is created and corpuls linked when the connection returns.'); }
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Linking corpuls…'; }
    const restore = () => { const b = $('[data-act="cad-ok"]'); if (b) { b.disabled = false; b.innerHTML = icon('ecg') + 'LINK CORPULS'; } };
    ensureCreated(d).then(okd => { if (okd) { render(); scrollTo(0, 0); } else restore(); }, () => { restore(); render(); toast('No connection: the case is created and corpuls linked when the connection returns.'); });
  }
  function dupDialog(cad, ex) {
    modal.open(dlg('CASE ALREADY EXISTS', `<div class="confirm-box"><span class="cad">CAD #${esc(cad)}</span><span class="muted">A STEMI case already exists under this CAD number${ex && ex.unit ? ` (${esc(ex.unit)}, opened ${when(ex.openedAt)})` : ''}${ex && ex.closedAt ? ' · its STEMI pathway is closed' : ''}.</span></div>
      <p>No second case is created and the existing case is not changed. Open the existing case, or correct the CAD number. What you entered here stays as your unsent case.</p>`,
      `<button class="btn btn--secondary" data-act="dup-fix">Correct the CAD number</button><button class="btn btn--primary" data-act="dup-open" data-cad="${esc(cad)}">OPEN EXISTING CASE</button>`, { over: 'CAD number', noClose: true }), { cls: 'dup', locked: true, focus: '[data-act="dup-fix"]' });
  }
  /* OPEN EXISTING CASE: a sent case opens on this tablet; an unsent case is taken up again as the unsent case */
  function openExisting(cad) {
    LIVE.request('POST', '/api/cases/open', { cad }).then(x => {
      modal.close();
      if (x.status !== 200) return toast(x.body.error || 'The existing case could not be opened.', 'err');
      const rec = x.body.rec, closed = rec && RULES.isClosed(rec.state);
      if (rec && rec.state === 'draft') return takeDraft(rec);
      if (S.draft && !S.draft.created) { S.draft.cadOk = false; S.draft.editCad = true; saveLocal(true); }
      if (rec && !closed) S.cases.set(cad, rec);
      openCase(cad, closed ? rec : null);
      toast(S.draft ? `Existing case CAD #${cad} opened. Your unsent case is kept on the home screen.` : `Existing case CAD #${cad} opened.`);
    }, () => toast('No connection: the existing case could not be opened.', 'err'));
  }
  function takeDraft(rec) {
    const c = S.draft, busy = c && c.cad !== rec.cad && (c.created || c.ecg.imgs.length || answered(c.md) > 0);
    if (busy) return toast(`CAD #${rec.cad} is an unsent case. Send or discard your other unsent case first, then open it again.`, 'err');
    S.cases.set(rec.cad, rec);
    S.draft = Object.assign(newDraft(), { cad: rec.cad, cadIn: rec.cad, cadOk: true, cadChecked: true, created: true, editCad: false, cadHist: [{ v: rec.cad, t: now() }] });
    saveLocal(true);
    if (!rec.monitor || rec.monitor.ended) LIVE.request('POST', '/api/corpuls/link', { cad: rec.cad }).then(x => { if (x.status === 200 && x.body.rec) { S.cases.set(rec.cad, x.body.rec); render(); } }, () => {});
    go('draft');
    toast(`Unsent case CAD #${rec.cad} taken up again`);
  }
  /* SEND TO ER: the case (created already, normally), the fallback ECG images if any, then the minimum data */
  async function sendDraft() {
    const d = S.draft; if (!d) return;
    const r = ready(d);
    if (!r.cad || !r.ecg || !r.md) {
      S.mdTried = true; mdSync(); patchDraft();
      const k = Object.keys(mdErrors(d.md))[0];
      if (k) { const f = $(`#f-${k} input:not([hidden]), #f-${k} button`); if (f) f.focus(); }
      const msg = !r.ecg ? 'No ECG yet: acquire the 12-lead on corpuls (or use the manual ECG fallback).' : `${4 - r.n} patient item${4 - r.n > 1 ? 's' : ''} still need an answer.`;
      S.readyErr = { k: r.ecg ? 'md' : 'ecg', msg };
      return toast(msg, 'err');
    }
    if (d.send && ['create', 'upload', 'submit'].includes(d.send.stage)) return;
    d.send = { stage: 'create', pct: 0, at: d.send && d.send.at || now(), tries: (d.send && d.send.tries || 0) + 1 };
    saveLocal(true); render();
    if (!S.up) return sendWait('No connection');
    try {
      if (!d.created && !(await ensureCreated(d))) return;
      const L = d.ecg.imgs;
      if (L.length) {
        d.send.stage = 'upload'; render();
        for (let k = 0; k < L.length; k++) {
          if (L[k].imageId) continue;
          const up = await LIVE.upload(dataUrlToBlob(L[k].data), { cad: d.cad, src: L[k].src === 'file' ? 'file' : 'gen' }, f => { d.send.pct = Math.round((k + f) / L.length * 100); patch('send-pct', sendPct()); });
          L[k].imageId = up.id; L[k].url = up.url; saveLocal(true);
        }
      }
      d.send.stage = 'submit'; d.send.pct = 100; render();
      const sendAt = d.send.at;
      const ecg = L.length ? { n: nextN(d.cad), acq: d.ecg.acq, variant: d.ecg.variant, pri: 1, same: false, timeWhy: d.ecg.acqSet ? d.ecg.acqWhy : null, imgs: L.map(x => ({ i: x.i, kind: x.kind, q: x.q, at: x.at, imageId: x.imageId })) } : null;
      const o = op(d.cad, 'submit', { sendAt, late: d.send.tries > 1, md: mdPayload(d.md), ecg }, sendAt);
      o.id = 'submit-' + d.cid;
      const res = await LIVE.send([o]);
      const x = (res.results || [])[0] || {};
      if (!x.ok) { d.send = { ...d.send, stage: 'failed', err: x.error }; saveLocal(true); render(); return toast(`NOT SENT: ${x.error}`, 'err'); }
      const cad = d.cad;
      S.draft = null; S.mdTried = false; saveLocal(true);
      openCase(cad);
      toast(`CAD #${cad} SENT TO ER`);
    } catch (e) { sendWait(e.message); }
  }
  function sendWait(why) {
    const d = S.draft; if (!d || !d.send) return;
    d.send.stage = 'queued'; d.send.err = why; saveLocal(true); render();
  }
  const sendPct = () => { const d = S.draft; return d && d.send ? `<div class="bar" aria-hidden="true"><span style="width:${d.send.pct || 0}%"></span></div>` : ''; };
  function discardDraft() {
    const d = S.draft; if (!d) return;
    modal.open(dlg('Discard the unsent case?', `<p>${d.cad ? `<span class="cad">CAD #${esc(d.cad)}</span>: ` : ''}nothing has been sent to the ER. What was entered on this tablet is deleted${d.ecg.imgs.length ? ', with the fallback ECG images' : ''}.${d.created ? ' The case stays on the platform as an unsent case (with anything corpuls sent), its corpuls feed ends, and OPEN EXISTING CASE can take it up again.' : ''}</p>`,
      `<button class="btn btn--secondary" data-act="modal-close">Keep it</button><button class="btn btn--critical" data-act="draft-discard-go">Discard</button>`, { over: 'Unsent case' }), { focus: '[data-act="modal-close"]' });
  }

  /* ---------- the case on screen ---------- */
  const cur = () => (S.cad && (S.cases.get(S.cad) || (S.stat && S.stat.cad === S.cad ? S.stat : null))) || null;
  const openCases = () => [...S.cases.values()].filter(r => !RULES.isClosed(r.state) && r.state !== 'draft').sort((a, b) => (b.sub ? b.sub.send : b.created) - (a.sub ? a.sub.send : a.created));
  const val = (r, k) => { const x = CLIN.cur(r, k); return x ? (CLIN.isNv(x) && (k === 'age' || k === 'sex') ? `${k === 'age' ? 'Age' : 'Sex'} ${x.v.toLowerCase()}` : x.v) : null; };
  const ptLine = r => [val(r, 'age'), val(r, 'sex'), val(r, 'complaint')].filter(Boolean).map(esc).join(' · ') || 'Patient details not entered';
  /* the crew's ECG view: one viewer, following each new ECG as it arrives */
  const viewer = new CLIN.Viewer({ follow: true, maxH: () => Math.max(260, innerHeight - (S.view === 'draft' ? 380 : 430)) });
  function mountViewer(id, rec) {
    const box = $('#' + id);
    if (!box) return;
    box.hidden = !(rec && rec.ecgs.length);
    if (box.hidden) return;
    if (viewer.el.parentNode !== box) box.appendChild(viewer.el);
    viewer.set(rec); CLIN.updateFull(rec);
  }

  /* ---------- top bar and connection: OFFLINE — CHANGES SAVED LOCALLY only when something is saved here ---------- */
  const netState = () => (!S.started ? 'wait' : S.up ? 'up' : S.out.length || S.draft ? 'offline' : 'down');
  function top() {
    const right = `<span class="tb-text only-wide"><b>${esc(AU.unit || '')}</b> · ${esc(AU.name || '')}</span><button class="tb-btn" data-act="logout">${icon('logout', 'ico-sm')}Log out</button>`;
    return topbar({ role: `Crew · ${AU.unit || ''}`, conn: conn(netState()), right, homeAct: 'home' });
  }
  function banner() {
    const st = netState();
    if (st === 'offline') return `<div class="banner banner--offline" role="status">${icon('wifi-off')}<span>Offline — changes saved locally on this tablet${S.out.length ? ` (${S.out.length} waiting to send)` : ''}. They are sent automatically when the connection returns.</span></div>`;
    if (st === 'down') return `<div class="banner banner--down" role="status">${icon('wifi-off')}<span>Connection lost — reconnecting. Case updates cannot arrive until the connection returns.</span></div>`;
    return '';
  }

  /* ---------- the corpuls connection (the monitor's link to the platform, not this tablet's) ---------- */
  /* is the manual fallback to be offered prominently? when corpuls cannot deliver, or no ECG came once the rest is done */
  function fbProminent(rec, d) {
    if (d && !d.created) return true;
    const k = CLIN.monState(rec).kind;
    if (k === 'waiting' || k === 'lost' || k === 'none' || (k === 'ended' && !RULES.isClosed(rec.state))) return true;
    return !!(d && !rec.ecgs.length && !Object.keys(mdErrors(d.md)).length);
  }
  function cbar(rec, d) {
    const cad = (rec && rec.cad) || (d && d.cad);
    const bar = (tone, ic, title, sub, action) => `<div class="cbar cbar--${tone}" role="status"><span class="cbar__ic">${ic}</span><div class="cbar__t"><b>${title}</b>${cad ? `<span class="cad">CAD #${esc(cad)}</span>` : ''}${sub ? `<span class="cbar__sub">${sub}</span>` : ''}</div>${action || ''}</div>`;
    const fbBtn = where => `<button class="btn btn--secondary" data-act="${where === 'draft' ? 'fb-draft' : 'ecg-new'}">${icon('camera')}MANUAL ECG FALLBACK</button>`;
    if (d && !d.created) return bar('warn', icon('wifi-off'), S.up ? 'LINKING CORPULS…' : 'NO CONNECTION — CORPULS NOT LINKED YET', S.up ? '' : 'The case is created and corpuls linked when the connection returns. Manual fallback available.', S.up ? '' : fbBtn('draft'));
    if (!rec) return '';
    const w = CLIN.monWords(rec, 'crew'), m = rec.monitor, where = d ? 'draft' : 'case', dev = m && m.label ? esc(m.label) + (m.simulated ? ' · simulated feed' : '') : '';
    switch (w.s.kind) {
      case 'live': case 'stale': return bar('ok', '<span class="mon__dot"></span>', 'CORPULS CONNECTED', dev);
      case 'waiting': return bar('neutral', icon('clock'), 'WAITING FOR CORPULS', `${dev} · the monitor has not connected yet`, fbBtn(where));
      case 'lost': return bar('warn', icon('wifi-off'), 'CORPULS CONNECTION LOST', `${m.last ? `Last data received ${hms(m.last)}` : 'No data received yet'} · ${m.status === 'reconnecting' ? 'reconnecting' : 'monitor disconnected'} · <b>MANUAL FALLBACK AVAILABLE</b>`, RULES.isClosed(rec.state) ? '' : fbBtn(where));
      case 'ended': return RULES.isClosed(rec.state) ? bar('neutral', icon('lock'), 'CORPULS FEED ENDED', `${m.last ? `Last data received ${hms(m.last)} · ` : ''}the last values are kept with the case`)
        : bar('warn', icon('info'), 'CORPULS FEED ENDED', `${esc(m.endWhy || '')}`, `<button class="btn btn--secondary" data-act="relink">LINK CORPULS AGAIN</button>`);
      default: return d ? bar('warn', icon('info'), 'CORPULS NOT LINKED', '', `<button class="btn btn--primary" data-act="relink">LINK CORPULS</button>`) : '';
    }
  }
  /* the live values, with the manual vital signs offered when corpuls has none */
  function monBox(rec, d) {
    if (!rec) return `<section class="mon mon--neutral"><div class="mon__h"><span class="mon__st">LIVE FROM CORPULS</span><span class="mon__sub">${S.up ? 'Linking…' : 'Not linked yet: no connection'}</span></div><div class="mtiles">${['HR', 'SpO₂', 'BP', 'RR'].map(k => `<div class="mtile is-none"><span class="mtile__k">${k}</span><span class="mtile__v">—</span><span class="mtile__u"></span></div>`).join('')}</div></section>`;
    const k = CLIN.monState(rec).kind, closed = RULES.isClosed(rec.state);
    const manual = !closed && (k === 'waiting' || k === 'lost' || k === 'none' || k === 'ended' || k === 'stale')
      ? `<div class="mon__more"><button class="btn btn--sm btn--quiet" data-act="vitals">${icon('plus', 'ico-sm')}Enter vital signs manually (fallback)</button></div>` : '';
    return CLIN.monitorPanel(rec, { role: 'crew' }).replace(/<\/section>$/, `${manual}</section>`);
  }

  /* ---------- home ---------- */
  function vHome() {
    return `<div class="home-h"><div><h1>STEMI cases</h1><p>${esc(AU.unit || '')} · ${esc(AU.emirate || '')} · ${esc(ME)}</p></div>
        <div class="home-h__go"><button class="btn btn--primary btn--xl" data-act="new-case">${icon('plus')}OPEN STEMI PATHWAY</button><span class="small muted">Enter the CAD number: the ECG and vital signs then arrive from corpuls.</span></div></div>
      <div id="h-draft"></div>
      <div class="stack" style="gap:28px">
        <section class="section" aria-labelledby="h-act"><div class="section__h"><h2 id="h-act">Active cases</h2><span id="n-act"></span></div><div id="q-act"></div></section>
        <section class="section" aria-labelledby="h-done"><div class="section__h"><h2 id="h-done">Completed cases</h2><span class="sp"></span>
          <div class="search">${icon('search')}<label class="sr-only" for="hq">Search completed cases by CAD number</label><input class="input" id="hq" type="search" placeholder="Search by CAD number" autocomplete="off" spellcheck="false" value="${esc(S.histQ)}"></div></div><div id="q-done"></div></section>
      </div>
      <p class="footnote"><span>STEMI Coordination Platform · v${esc(UI.APP.version)} · test build</span><span>Fictional test data only — never real patient information</span><span>corpuls feed simulated in this build</span><span>Not an ePCR: document in the ePCR as usual</span></p>`;
  }
  function draftCard() {
    const d = S.draft;
    if (!d) return '';
    const r = ready(d), st = d.send && d.send.stage === 'queued' ? 'NOT SENT — waiting for the connection' : d.send && d.send.stage === 'failed' ? 'NOT SENT — send again' : 'Not sent';
    const ecgT = r.corp ? `ECG ${r.corp === 1 ? '1' : '1–' + r.corp} from corpuls` : r.fb ? 'manual fallback ECG' : 'waiting for the ECG';
    return `<div class="draftcard" role="region" aria-label="Unsent case"><div class="draftcard__t"><b>Unsent case · ${d.cad ? `<span class="cad">CAD #${esc(d.cad)}</span>` : 'CAD number not entered'}</b>
      <span class="small muted">${st} · ${ecgT} · patient ${r.n} of 4 · saved on this tablet</span></div>
      <button class="btn btn--danger-quiet" data-act="draft-discard">${icon('trash')}Discard</button><button class="btn btn--primary btn--lg" data-act="draft-open">Continue the unsent case</button></div>`;
  }
  function homeRow(r) {
    const e = r.ecgs[0], d = r.dec[r.dec.length - 1], pend = pendingFor(r.cad).length;
    const metaR = r.state === 'er_reviewing' ? `ER: ${esc(r.er.name)}` : r.cardio.ack ? `Cardiologist: ${esc(r.cardio.name || '')}` : r.cardio.activated ? `Cardiology activated ${hm(r.cardio.activated)}` : `Sent ${hm(r.sub && r.sub.send)}`;
    return `<button class="qrow${r.state === 'confirmed' ? ' qrow--crit' : r.state === 'repeat_requested' ? ' qrow--warn' : ''}" data-act="open" data-cad="${esc(r.cad)}">
      <span class="qrow__cad"><span class="cad">CAD #${esc(r.cad)}</span>${badge(r.state, ROLE)}</span>
      <span class="qrow__pt"><b>${ptLine(r)}</b><span>ECG ${e ? `acquired ${hm(e.acq)}` : '–'}${r.ecgs.length > 1 ? ` · ${r.ecgs.length} ECGs` : ''}</span></span>
      <span class="qrow__meta"><span>${metaR}</span><span>${d ? `${esc(RULES.DECISIONS[d.k])} · ${hm(d.at)}` : ''}${pend ? `<span class="pendnote">${icon('upload')}${pend} waiting to send</span>` : ''}</span></span>
      <span class="qrow__act">${icon('chev-right')}</span></button>`;
  }
  function doneRow(x) {
    return `<button class="qrow" data-act="open-done" data-cad="${esc(x.cad)}"><span class="qrow__cad"><span class="cad">CAD #${esc(x.cad)}</span>${badge(x.state, ROLE)}</span>
      <span class="qrow__pt"><b>${[x.pt.age, x.pt.sex, x.pt.complaint].filter(Boolean).map(esc).join(' · ') || '–'}</b><span>ECG ${x.ecgAt ? `acquired ${hm(x.ecgAt)}` : '–'}</span></span>
      <span class="qrow__meta"><span>Closed ${when(x.closedAt)}</span><span>${x.state === 'er_closed' ? 'Cardiology not activated' : x.cardio.name ? esc(x.cardio.name) : ''}</span></span>
      <span class="qrow__act">${icon('chev-right')}</span></button>`;
  }
  function patchHome() {
    if (S.hist === null && !S.histAsked) { S.histAsked = true; setTimeout(loadHist, 0); }
    const A = openCases();
    patch('h-draft', draftCard());
    patch('n-act', A.length ? `<span class="count">${A.length}</span>` : '');
    patch('q-act', `<div class="qlist">${A.length ? A.map(homeRow).join('') : empty('ambulance', 'No active STEMI cases', 'Start one with OPEN STEMI PATHWAY.')}</div>`);
    patch('q-done', S.hist === null ? '<div class="qlist"><div class="loading"><span class="spinner"></span>Loading completed cases…</div></div>'
      : `<div class="qlist">${S.hist.length ? S.hist.map(doneRow).join('') : empty('lock', S.histQ ? 'No completed case with this CAD number' : 'No completed cases yet', S.histErr ? 'The list could not be loaded: no connection.' : '')}</div>`);
  }
  let hT = null, hSeq = 0;
  function loadHist() {
    if (!LIVE) { S.histAsked = false; return; }
    const my = ++hSeq;
    LIVE.request('GET', '/api/cases?q=' + encodeURIComponent(S.histQ.trim())).then(x => {
      if (my !== hSeq) return;
      S.hist = x.status === 200 ? x.body.cases : []; S.histErr = x.status !== 200;
      if (S.view === 'home') patchHome();
    }, () => { if (my !== hSeq) return; S.hist = S.hist || []; S.histErr = true; if (S.view === 'home') patchHome(); });
  }

  /* ---------- the unsent case: one page ---------- */
  function vDraftHead() {
    const d = S.draft;
    return `<div class="draft-h"><button class="btn btn--quiet" data-act="home" style="margin-left:-8px">${icon('chev-left')}Cases</button><h1>New STEMI case</h1>
      ${d.cadOk && !d.editCad ? `<span class="cad draft-h__cad">CAD #${esc(d.cad)}</span><button class="btn btn--sm btn--quiet" data-act="cad-edit">${icon('edit', 'ico-sm')}Change</button>` : ''}${badge('draft', ROLE)}<span class="sp"></span>
      <button class="btn btn--danger-quiet" data-act="draft-discard">${icon('trash')}Discard</button></div>`;
  }
  function vCad() {
    const d = S.draft, edit = d.created;
    return `${vDraftHead()}<section class="card cadcard"><div class="card__h"><h2>${edit ? 'Correct the CAD number' : 'CAD number'}</h2><span class="sp"></span><span class="small muted">${edit ? 'Not sent yet: the case and what corpuls sent move to the corrected number' : 'Step 1 of 2 · then the ECG and vital signs arrive from corpuls'}</span></div><div class="card__b"><div class="cadbox">
      <div class="field"><label class="label" for="cadin">CAD number</label>
        <input class="input input--lg" id="cadin" inputmode="numeric" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${CADN.EXAMPLE}" value="${esc(d.cadIn || d.cad)}" aria-describedby="cad-hint cad-err">
        <span class="hint" id="cad-hint">From the dispatch / MDT information. Accepted: CAD#${CADN.EXAMPLE}, ${CADN.EXAMPLE} or ${CADN.EXAMPLE.replace(/-/g, '')}. Checked for an existing case; locked once the case is sent.</span>
        <span class="field-error" id="cad-err" hidden></span></div>
      <div class="btn-row">${edit ? `<button class="btn btn--secondary btn--lg" data-act="cad-cancel">Cancel</button>` : ''}<button class="btn btn--primary btn--xl" data-act="cad-ok">${icon('ecg')}${edit ? 'SAVE CAD NUMBER' : 'LINK CORPULS'}</button></div>
      ${edit ? '' : `<p class="small muted">${icon('info', 'ico-sm')} The case is created under this CAD number and linked to the ${esc(AU.unit || 'unit')}'s corpuls monitor. Everything acquired on corpuls from then on attaches to it.</p>`}</div></div></section>`;
  }
  const nvBtns = (k, c) => (NV[k] || []).map(v => `<button type="button" class="choice choice--quiet" data-act="md-nv" data-k="${k}" data-v="${esc(v)}" aria-pressed="${!!(c && c.nv === v)}">${esc(v)}</button>`).join('');
  const mdRow = (k, label, control) => `<div class="mdrow" id="f-${k}"><span class="label" id="l-${k}">${label}</span><div class="mdrow__c" role="group" aria-labelledby="l-${k}" aria-describedby="e-${k}">${control}<span class="field-error" id="e-${k}" hidden></span></div></div>`;
  /* the patient: the only thing the crew enters (drawn once per visit, so typing is never interrupted) */
  function vPatient() {
    const m = S.draft.md, num = (k, v, w) => `<input class="input input--num" id="md-${k}" data-md="${k}" inputmode="numeric" maxlength="3" autocomplete="off" value="${v == null ? '' : v}" aria-label="${w}" style="width:92px">`;
    const age = m.age || {}, on = m.onset || {}, cp = m.complaint || {};
    return `<section class="card ptcard" aria-labelledby="pt-h"><div class="card__h"><h2 id="pt-h">Patient</h2><span class="sp"></span><span class="small muted" id="pt-n"></span></div>
      <div class="card__b ptform" id="mdform">
        ${mdRow('age', 'Age', `${num('age', age.nv ? '' : age.v, 'Age in years')}<span class="unit">years</span><button type="button" class="choice" data-act="md-est" aria-pressed="${!!age.est}">Estimated</button>${nvBtns('age', m.age)}`)}
        ${mdRow('sex', 'Sex', ['Male', 'Female'].map(v => `<button type="button" class="choice" data-act="md-set" data-k="sex" data-v="${v}" aria-pressed="${!!(m.sex && m.sex.v === v)}">${v}</button>`).join('') + nvBtns('sex', m.sex))}
        ${mdRow('complaint', 'Presenting complaint', COMPLAINTS.map(c => `<button type="button" class="choice" data-act="md-set" data-k="complaint" data-v="${c.k}" aria-pressed="${cp.k === c.k}">${esc(c.l)}</button>`).join('') + `<input class="input input--other" id="md-other" data-md="other" maxlength="120" placeholder="Describe the complaint" value="${esc(cp.other || '')}" aria-label="Other presenting complaint"${cp.k === 'oth' ? '' : ' hidden'}>`)}
        ${mdRow('onset', 'Symptom onset', `<input class="input input--time" id="md-onset" data-md="onset" type="time" value="${on.t ? hhmm(on.t) : ''}" aria-label="Symptom onset time">${[15, 30, 60, 120].map(n => `<button type="button" class="choice choice--quiet" data-act="md-ago" data-m="${n}">${n < 60 ? n + ' min' : n / 60 + ' h'} ago</button>`).join('')}<button type="button" class="choice" data-act="md-approx" aria-pressed="${!!on.approx}">Approximate</button>${nvBtns('onset', m.onset)}`)}
      </div>
      <div class="card__f small muted">${icon('ecg', 'ico-sm')}HR, SpO₂, blood pressure and RR come from corpuls: they are not entered here.</div></section>`;
  }
  function vDraft() {
    return `${vDraftHead()}<div class="dpage"><div id="d-bar"></div>
      <div class="dgrid"><div class="dgrid__main"><section class="card ecgcard" aria-labelledby="d-ecgh-t"><div class="card__h" id="d-ecgh"></div><div id="d-viewer" hidden></div><div id="d-ecgalt"></div></section></div>
        <div class="dgrid__side"><div id="d-mon"></div>${vPatient()}</div></div>
      <div id="d-send" class="sendwrap"></div></div>`;
  }
  /* the ECG on the unsent case: from corpuls (normally), waiting for it, or the manual fallback */
  function draftEcg() {
    const d = S.draft, rec = dRec(), L = rec && CLIN.latest(rec), fb = d.ecg.imgs.length, n = nextN(d.created && d.cad), prom = fbProminent(rec, d);
    const head = L ? `<h2 id="d-ecgh-t">${L.src === 'corpuls' ? `ECG ${L.n} RECEIVED FROM CORPULS` : `ECG ${L.n}`}</h2><span class="sp"></span><span class="small">Acquired <b class="mono">${hms(L.acq)}</b></span>`
      : fb ? `<h2 id="d-ecgh-t">MANUAL ECG FALLBACK · ECG ${n}</h2><span class="sp"></span><span class="small muted">sent with the case</span>`
      : `<h2 id="d-ecgh-t">WAITING FOR ECG FROM CORPULS</h2>`;
    const fbBlock = fb ? `<div class="fbblock"><div class="row"><span class="tag">Manual fallback</span><span class="small muted">ECG ${L ? n : n} · ${fb} image${fb > 1 ? 's' : ''} · acquired <span class="mono">${hms(d.ecg.acq)}</span> · <button type="button" class="link-btn" data-act="acq" data-where="draft">change time</button> · not sent yet: it goes with the case</span></div>${shotsHtml(d.ecg, 'draft')}</div>` : '';
    let alt;
    if (L) alt = `${fbBlock}<div class="card__f"><span class="small muted">${L.src === 'corpuls' ? `${icon('check', 'ico-sm')} Arrived from corpuls by itself — nothing to upload.` : ''}</span><span class="sp"></span>${fb ? '' : `<button class="btn btn--sm btn--quiet" data-act="fb-draft">${icon('camera', 'ico-sm')}Manual ECG fallback</button>`}</div>`;
    else if (fb) alt = `<div class="card__b">${fbBlock}</div>`;
    else alt = `<div class="ecgwait"><div class="ecgwait__ic">${icon('ecg')}</div><div class="ecgwait__t"><b>Acquire the 12-lead ECG on corpuls3.</b><span>It appears here automatically${d.created ? '' : ' once corpuls is linked'}: nothing to photograph or upload.</span></div>
        ${prom ? `<div class="ecgwait__fb"><span class="small muted">${d.created && CLIN.monState(rec).kind === 'live' ? 'No ECG has arrived from corpuls yet.' : 'corpuls cannot deliver the ECG right now.'}</span><button class="btn btn--secondary" data-act="fb-draft">${icon('camera')}MANUAL ECG FALLBACK</button></div>`
        : `<button class="btn btn--sm btn--quiet ecgwait__q" data-act="fb-draft">${icon('camera', 'ico-sm')}Manual ECG fallback</button>`}</div>`;
    return { head, alt, rec };
  }
  function sendBar() {
    const d = S.draft, r = ready(d), s = d.send;
    if (s && ['create', 'upload', 'submit'].includes(s.stage)) return `<div class="sending" role="status" aria-live="polite"><div class="row"><span class="spinner"></span><b>${{ create: 'Creating the case and linking corpuls…', upload: 'Uploading the fallback ECG images…', submit: 'Sending to the ER…' }[s.stage]}</b></div><div id="send-pct">${sendPct()}</div></div>`;
    if (s && (s.stage === 'queued' || s.stage === 'failed')) return `<div class="sendbar" style="border-color:var(--warn-line);background:var(--warn-soft)" role="alert"><div class="sendbar__t"><b>${icon('wifi-off', 'ico-sm')} NOT SENT${s.stage === 'queued' ? ' — NO CONNECTION' : ''}</b><span class="small">${s.stage === 'queued' ? 'Saved on this tablet. It is sent automatically when the connection returns.' : esc(s.err || 'The case was not sent.')} If it cannot wait, use your STEMI downtime procedure (phone).</span></div><button class="btn btn--primary btn--xl" data-act="send"${S.up ? '' : ' disabled'}>${icon('send')}SEND AGAIN</button></div>`;
    const chk = (ok, t) => `<li class="${ok ? 'is-ok' : ''}">${icon(ok ? 'check' : 'dot', 'ico-sm')}<span>${t}</span></li>`;
    const all = r.cad && r.ecg && r.md;
    return `<div class="sendbar"><ul class="readylist" aria-label="Ready to send">${chk(r.cad, d.cadOk ? `CAD #${esc(d.cad)}` : 'CAD number')}${chk(r.ecg, r.corp ? `ECG ${r.corp > 1 ? '1–' + r.corp : '1'} from corpuls` : r.fb ? 'Manual fallback ECG' : 'ECG — waiting')}${chk(r.md, `Patient ${r.n} of 4`)}<li class="is-info">${icon('info', 'ico-sm')}<span>Vital signs travel automatically</span></li></ul>
      <button class="btn btn--primary btn--xl" data-act="send"${all ? '' : ' aria-disabled="true"'}>${icon('send')}SEND TO ER</button></div>`;
  }
  /* the dynamic parts of the page (the patient form is never redrawn while the crew types) */
  function patchDraft() {
    const d = S.draft;
    if (!d || S.view !== 'draft' || d.editCad || !d.cadOk) return;
    const x = draftEcg();
    CLIN.paint('d-bar', cbar(x.rec, d));
    patch('d-ecgh', x.head);
    mountViewer('d-viewer', x.rec);
    patch('d-ecgalt', x.alt);
    CLIN.paint('d-mon', monBox(x.rec, d));
    sendBarSync();
    const n = $('#pt-n'); if (n) n.textContent = `${answered(d.md)} of 4`;
  }
  /* the errors show once SEND was pressed, and stay current as fields are fixed */
  function mdSync() {
    const d = S.draft; if (!d || S.view !== 'draft') return;
    const E = mdErrors(d.md);
    FIELDS.forEach(f => {
      const el = $('#e-' + f.k), row = $('#f-' + f.k); if (!el) return;
      const show = S.mdTried && E[f.k];
      el.hidden = !show; el.innerHTML = show ? icon('alert') + `<span>${esc(E[f.k])}</span>` : '';
      row.classList.toggle('is-err', !!show);
      row.querySelectorAll('input').forEach(i => { if (show) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid'); });
    });
    const n = $('#pt-n'); if (n) n.textContent = `${answered(d.md)} of 4`;
    sendBarSync();
  }
  /* the send bar; a "still missing" message from an earlier SEND goes once what it named is there */
  function sendBarSync() {
    patch('d-send', sendBar());
    const e = S.readyErr; if (!e || !S.draft) return;
    const r = ready(S.draft);
    if (e.k === 'ecg' ? !r.ecg : !r.md) return;
    const t = $('#toast'), sp = t && !t.hidden && t.querySelector('span');
    if (sp && sp.textContent === e.msg) UI.hideToast();
    S.readyErr = null;
  }
  function mdInput(t) {
    const m = S.draft.md, k = t.dataset.md, v = t.value.trim(), at = now();
    const int = x => (x === '' || x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x)));
    if (k === 'age') m.age = v === '' ? (m.age && m.age.est ? { v: null, est: true, at } : null) : { v: int(v), est: !!(m.age && m.age.est), at };
    else if (k === 'other') m.complaint = { k: 'oth', other: t.value, at };
    else if (k === 'onset') m.onset = v ? { t: fromClock(v, 5 * 60e3), approx: !!(m.onset && m.onset.approx), at } : null;
    if (NV[k]) $$(`[data-act="md-nv"][data-k="${k}"]`).forEach(b => b.setAttribute('aria-pressed', 'false'));
    saveLocal(); mdSync();
  }
  function mdClick(a, t) {
    const m = S.draft.md, k = t.dataset.k, v = t.dataset.v, at = now();
    if (a === 'md-nv') {
      const on = !(m[k] && m[k].nv === v);
      m[k] = on ? { nv: v, at } : null;
      $$(`[data-act="md-nv"][data-k="${k}"]`).forEach(b => b.setAttribute('aria-pressed', String(on && b.dataset.v === v)));
      if (on) {
        ({ age: ['md-age'], onset: ['md-onset'] }[k] || []).forEach(id => { const i = document.getElementById(id); if (i) i.value = ''; });
        if (k === 'sex') $$('[data-act="md-set"][data-k="sex"]').forEach(b => b.setAttribute('aria-pressed', 'false'));
        if (k === 'age') $('[data-act="md-est"]').setAttribute('aria-pressed', 'false');
        if (k === 'onset') $('[data-act="md-approx"]').setAttribute('aria-pressed', 'false');
      }
    } else if (a === 'md-set') {
      if (k === 'sex') { m.sex = { v, at }; $$('[data-act="md-nv"][data-k="sex"]').forEach(b => b.setAttribute('aria-pressed', 'false')); }
      if (k === 'complaint') { m.complaint = { k: v, other: v === 'oth' ? (m.complaint && m.complaint.other) || '' : '', at }; const o = $('#md-other'); o.hidden = v !== 'oth'; if (v === 'oth') o.focus(); }
      $$(`[data-act="md-set"][data-k="${k}"]`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    } else if (a === 'md-est') {
      const est = !(m.age && m.age.est);
      m.age = m.age && !m.age.nv ? { ...m.age, est, at } : { v: null, est, at };
      t.setAttribute('aria-pressed', String(est));
      $$('[data-act="md-nv"][data-k="age"]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    } else if (a === 'md-approx') {
      if (!m.onset || m.onset.nv) { t.setAttribute('aria-pressed', 'false'); toast('Enter the onset time first.'); return; }
      m.onset = { ...m.onset, approx: !m.onset.approx, at };
      t.setAttribute('aria-pressed', String(m.onset.approx));
    } else if (a === 'md-ago') {
      const tt = now() - Number(t.dataset.m) * 60e3;
      m.onset = { t: tt, approx: true, at };
      $('#md-onset').value = hhmm(tt);
      $('[data-act="md-approx"]').setAttribute('aria-pressed', 'true');
      $$('[data-act="md-nv"][data-k="onset"]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    }
    saveLocal(); mdSync();
  }

  /* ---------- the live case: mostly a status view ---------- */
  function vCase() {
    return `<div id="c-head"></div><div id="c-prog"></div><div id="c-bar" class="c-bar"></div><div class="ws"><div class="ws__main"><div id="c-status"></div>
      <section class="card ecgcard" aria-labelledby="c-ecgh-t"><div class="card__h" id="c-ecgh"></div><div id="c-viewer" hidden></div><div id="c-ecgalt"></div></section></div>
      <div class="ws__side"><div id="c-mon"></div>
        <section class="card"><div class="card__h"><h2>Patient</h2><span class="sp"></span><span class="small muted">sent with the case</span></div><div class="card__b" id="c-pt"></div></section>
        <div id="c-more"></div><div id="c-ai"></div>
        <details class="disc"><summary>Timeline${icon('chev-down', 'chev')}</summary><div class="disc__b" id="c-tl"></div></details></div></div>`;
  }
  function caseHead(r) {
    const closed = RULES.isClosed(r.state);
    return `<div class="case-h"><button class="btn btn--quiet case-h__back" data-act="home" aria-label="Back to cases">${icon('chev-left')}<span class="lbl">Cases</span></button>
      <span class="case-h__cad">CAD #${esc(r.cad)}</span>${badge(r.state, ROLE, true)}<span class="sp"></span>
      ${closed ? `<span class="lockline">${icon('lock')}Read-only</span>` : ''}
      <button class="btn btn--secondary btn-sum" data-act="summary" aria-label="Case Summary">${icon('file')}<span class="lbl">Case Summary</span></button></div>`;
  }
  /* what is happening now, in plain words, and what the crew can do */
  function statusPanel(r) {
    const er = r.er, cd = r.cardio, d = r.dec[r.dec.length - 1], L = CLIN.latest(r);
    const P = (tone, ic, label, sub, extra) => `<section class="status-panel ${tone}" aria-live="polite"><div class="status-panel__label">${icon(ic)}<span>${label}</span></div>${sub ? `<div class="status-panel__sub">${sub}</div>` : ''}${extra || ''}</section>`;
    switch (r.state) {
      case 'draft': return P('', 'upload', 'SENDING…', 'The case is being sent.');
      case 'sent_to_er': return P('tone-info', 'send', 'SENT TO ER', `Received by the platform at ${hm(r.sub.rcv)}. Waiting for an ER Doctor to accept the case.`, '<p class="small muted">Nothing more to do here: the ECG and the vital signs travel by themselves. Return to the patient.</p>');
      case 'er_reviewing': return P('tone-info', 'eye', 'ER DOCTOR REVIEWING', `<b>${esc(er.name)}</b> (ER Doctor) accepted the case at ${hm(er.accepted)} and is reviewing the ECG.`);
      case 'er_closed': return P('', 'lock', 'ER REVIEW COMPLETED / CARDIOLOGY NOT ACTIVATED', `ER Doctor assessment by ${esc(er.by || er.name)} at ${hm(er.at)}.`,
        `<dl class="kv" style="margin-top:6px"><dt>Reason</dt><dd>${esc(er.reason)}</dd>${er.comment ? `<dt>Comment</dt><dd>${esc(er.comment)}</dd>` : ''}</dl><p class="small muted">The STEMI screening pathway is closed and read-only. Continue standard care. The CAD incident itself is not changed.</p>`);
      case 'cardiology_activated': return P('tone-warn', 'bell', 'CARDIOLOGY ACTIVATED', `${er.assessment === 'uncertain' ? 'ER assessment: UNCERTAIN. ' : ''}${esc(er.by || er.name || 'The ER')} activated cardiology at ${hm(cd.activated)}. Waiting for the Cardiologist to acknowledge.`);
      case 'cardiologist_reviewing': return P('tone-info', 'eye', 'CARDIOLOGIST REVIEWING', `<b>${esc(cd.name || 'The Cardiologist')}</b> acknowledged the case at ${hm(cd.ack)}.`);
      case 'repeat_requested': return P('tone-warn', 'repeat', 'REPEAT ECG REQUESTED', `${esc(d.by)} (Cardiologist) at ${hm(d.at)} · on ECG ${d.on}.`,
        `${d.reasons.length || d.instr || d.within ? `<dl class="kv" style="margin-top:6px">${d.reasons.length ? `<dt>Reason</dt><dd>${esc(d.reasons.join(', '))}</dd>` : ''}${d.instr ? `<dt>Instruction</dt><dd>${esc(d.instr)}</dd>` : ''}${d.within ? `<dt>Within</dt><dd>${d.within} min</dd>` : ''}</dl>` : ''}
         <p class="status-panel__do">${icon('ecg')}<span><b>Acquire a new 12-lead on corpuls3.</b> ${fbProminent(r) ? `The corpuls connection is not live: if ECG ${L.n + 1} does not arrive, use the manual ECG fallback.` : `ECG ${L.n + 1} appears here by itself and reaches the Cardiologist silently.`}</span></p>
<p class="small muted">COMPLETE STEMI PATHWAY becomes available only after CONFIRMED STEMI.</p>`);
      case 'repeat_received': return P('tone-info', 'eye', 'REPEAT ECG SENT — CARDIOLOGIST REVIEWING', `ECG ${L.n} ${L.src === 'corpuls' ? 'received from corpuls' : 'received'} at ${hm(L.rcv)}. The Cardiologist reviews it and decides.`);
      case 'confirmed': return P('tone-crit-solid', 'alert', 'CONFIRMED STEMI', `Decision by ${esc(d.by)} (Cardiologist) at ${hm(d.at)} · on ECG ${d.on}.`,
        `${d.note ? `<p><b>Note:</b> ${esc(d.note)}</p>` : ''}<p class="small muted">When the STEMI pathway is finished for this case, press COMPLETE STEMI PATHWAY. Nothing more is documented here.</p><div class="btn-row"><button class="btn btn--secondary btn--lg" data-act="complete">${icon('check-circle')}COMPLETE STEMI PATHWAY</button></div>`);
      case 'not_stemi_closed': return P('', 'lock', 'NOT STEMI / PATHWAY CLOSED', d ? `Decision by ${esc(d.by)} (Cardiologist) at ${hm(d.at)}.` : '',
        `<dl class="kv" style="margin-top:6px">${d && d.reason ? `<dt>Reason</dt><dd>${esc(d.reason)}</dd>` : ''}${d && d.adv ? `<dt>Advice</dt><dd>${esc(d.adv)}</dd>` : ''}</dl><p class="small muted">The STEMI pathway closed automatically and is read-only. No cath-lab activation. Continue standard care. The CAD incident itself is not changed.</p>`);
      case 'completed': return P('tone-ok', 'check-circle', 'STEMI PATHWAY COMPLETED', `Completed by ${esc(r.closed.by)} at ${hm(r.closed.at)}. The case is read-only.`);
    }
    return '';
  }
  function caseEcg(r) {
    const L = CLIN.latest(r), pend = pendingFor(r.cad), pe = pend.filter(x => x.kind === 'ecg'), closed = RULES.isClosed(r.state);
    const head = L ? `<h2 id="c-ecgh-t">ECG ${L.n}${L.src === 'corpuls' ? ' · from corpuls' : L.src === 'manual_fallback' ? ' · manual fallback' : ''}</h2><span class="sp"></span><span class="small">Acquired <b class="mono">${hms(L.acq)}</b>${r.ecgs.length > 1 ? ` · ${r.ecgs.length} ECGs` : ''}</span>` : '<h2 id="c-ecgh-t">ECG</h2>';
    const pImgs = pend.filter(x => x.kind === 'img');
    const pendHtml = pe.map(x => `<div class="ecgitem"><div class="ecgitem__h"><b>Fallback ECG ${x.n}</b><span>acquired ${hms(x.acq)}</span><span class="pendnote">${icon('upload')}${S.up ? 'Sending…' : 'Saved on this tablet — waiting to send'}</span></div><div class="shots">${x.imgs.map(y => `<div class="shot"><span class="shot__img"><img src="${esc(y.data)}" alt=""></span><div class="shot__t"><b>Image ${y.i}</b></div></div>`).join('')}</div></div>`).join('')
      + pImgs.map(x => `<div class="ecgitem"><div class="ecgitem__h"><b>Image ${x.imgs[0].i} for ECG ${x.n}</b><span class="pendnote">${icon('upload')}${S.up ? 'Sending…' : 'Waiting to send'}</span></div></div>`).join('');
    /* another photo of an ECG that was itself a manual photo (never of an ECG from corpuls) */
    const addImg = L && L.src !== 'corpuls' && !closed && L.imgs.length < MAXI ? `<button class="btn btn--sm btn--quiet" data-act="img-add-sent" data-n="${L.n}">${icon('plus', 'ico-sm')}Add an image to ECG ${L.n}</button>` : '';
    const foot = closed ? '' : `<div class="card__f"><span class="small muted">${r.ecgs.some(e => e.src === 'corpuls') ? 'New ECGs acquired on corpuls appear here by themselves.' : ''}</span><span class="sp"></span>${addImg}${pe.length ? '' : `<button class="btn btn--sm ${fbProminent(r) ? 'btn--secondary' : 'btn--quiet'}" data-act="ecg-new">${icon('camera', 'ico-sm')}Manual ECG fallback</button>`}</div>`;
    return { head, alt: `${pendHtml}${L ? '' : `<div class="card__b">${empty('ecg', 'No ECG')}</div>`}${foot}` };
  }
  function moreHtml(r) {
    if (RULES.isClosed(r.state) || r.state === 'draft') return '';
    return `<div class="more"><button class="btn btn--sm btn--quiet" data-act="treat">${icon('plus', 'ico-sm')}Treatment update</button><span class="small subtle">Optional · not the ePCR</span></div>`;
  }
  function patchCase() {
    const r = cur();
    if (!r || S.view !== 'case') return;
    patch('c-head', caseHead(r));
    patch('c-prog', CLIN.progress(r));
    CLIN.paint('c-bar', cbar(r, null));
    patch('c-status', statusPanel(r));
    const x = caseEcg(r);
    patch('c-ecgh', x.head);
    mountViewer('c-viewer', r);
    patch('c-ecgalt', x.alt);
    CLIN.paint('c-mon', monBox(r, null));
    patch('c-pt', CLIN.ptDetails(r, { vitals: false }) + vitHtmlPending(r));
    patch('c-more', moreHtml(r));
    const L = CLIN.latest(r);
    patch('c-ai', L ? CLIN.aiPanel(L, { collapsible: true }) : '');
    patch('c-tl', CLIN.timelineHtml(r));
  }
  const vitHtmlPending = r => { const p = pendingFor(r.cad).filter(x => x.kind === 'op' && (x.op.k === 'md' || x.op.k === 'rec')); return p.length ? `<p class="pendnote" style="margin-top:12px">${icon('upload')}${p.length} update${p.length > 1 ? 's' : ''} saved on this tablet — ${S.up ? 'sending…' : 'waiting to send'}</p>` : ''; };
  const vSummary = r => `<div class="case-h"><button class="btn btn--quiet case-h__back" data-act="sum-back" aria-label="Back to the case">${icon('chev-left')}<span class="lbl">Back to the case</span></button><h1 style="font-size:24px">Case Summary · <span class="cad">CAD #${esc(r.cad)}</span></h1><span class="sp"></span><span class="lockline">${icon('lock')}Nothing to fill in</span></div>${CLIN.summary(r, ROLE)}`;

  /* ---------- decisions and outcomes reach the crew at once (no sound); the crew acknowledges them ---------- */
  function outcomes() {
    if (modal.isOpen() || (S.draft && S.draft.send && ['create', 'upload', 'submit'].includes(S.draft.send.stage))) return;
    for (const r of S.cases.values()) {
      const d = r.dec[r.dec.length - 1];
      if (d && !d.crewAck && !S.shownDec.has(d.id)) {
        S.shownDec.add(d.id);
        if (!d.dlv) queue({ kind: 'op', cad: r.cad, op: op(r.cad, 'decrcv', { id: d.id }) });
        return decisionModal(r, d);
      }
      if (r.state === 'er_closed' && !r.er.crewAck && !S.shownDec.has('er-' + r.cad)) { S.shownDec.add('er-' + r.cad); return erModal(r); }
    }
  }
  function decisionModal(r, d) {
    const [title, cls] = { confirm: ['CONFIRMED STEMI', 'modal--crit'], not: ['NOT STEMI / PATHWAY CLOSED', ''], repeat: ['REPEAT ECG REQUESTED', ''] }[d.k];
    const body = `<div class="confirm-box"><span class="cad">CAD #${esc(r.cad)}</span><span class="muted">Decision by ${esc(d.by)} (Cardiologist) at ${hm(d.at)} · on ECG ${d.on}</span></div>
      ${d.k === 'not' ? `${d.reason ? `<p><b>Reason:</b> ${esc(d.reason)}</p>` : ''}${d.adv ? `<p><b>Advice:</b> ${esc(d.adv)}</p>` : ''}<p class="muted">The STEMI pathway closed automatically and is read-only. No cath-lab activation. Continue standard care. The CAD incident itself is not changed.</p>` : ''}
      ${d.k === 'repeat' ? `${d.reasons.length ? `<p><b>Reason:</b> ${esc(d.reasons.join(', '))}</p>` : ''}${d.instr ? `<p><b>Instruction:</b> ${esc(d.instr)}</p>` : ''}${d.within ? `<p><b>Within:</b> ${d.within} min</p>` : ''}<p class="muted">Acquire a new 12-lead on corpuls3: ECG ${CLIN.latest(r).n + 1} reaches the Cardiologist by itself, silently.</p>` : ''}
      ${d.k === 'confirm' ? `${d.note ? `<p><b>Note:</b> ${esc(d.note)}</p>` : ''}<p class="muted">COMPLETE STEMI PATHWAY is now available on the case.</p>` : ''}`;
    modal.open(dlg(title, body, `<button class="btn ${d.k === 'confirm' ? 'btn--critical' : 'btn--primary'} btn--lg" data-act="dec-ack" data-cad="${esc(r.cad)}" data-id="${esc(d.id)}">${icon('check')}ACKNOWLEDGE</button>`, { over: 'Cardiologist decision', noClose: true }), { cls, locked: true, alert: true, focus: '[data-act="dec-ack"]' });
  }
  function erModal(r) {
    modal.open(dlg('ER REVIEW COMPLETED / CARDIOLOGY NOT ACTIVATED', `<div class="confirm-box"><span class="cad">CAD #${esc(r.cad)}</span><span class="muted">ER Doctor assessment by ${esc(r.er.by || r.er.name)} at ${hm(r.er.at)}</span></div>
      <dl class="kv"><dt>Reason</dt><dd>${esc(r.er.reason)}</dd>${r.er.comment ? `<dt>Comment</dt><dd>${esc(r.er.comment)}</dd>` : ''}</dl>
      <p class="muted">The STEMI screening pathway is closed and read-only. Continue standard care. The CAD incident itself is not changed.</p>`,
      `<button class="btn btn--primary btn--lg" data-act="er-ack" data-cad="${esc(r.cad)}">${icon('check')}ACKNOWLEDGE</button>`, { over: 'ER review', noClose: true }), { locked: true, alert: true, focus: '[data-act="er-ack"]' });
  }

  /* ---------- fallbacks and optional updates ---------- */
  /* manual vital signs: only when corpuls has no values (they are marked as entered by the crew) */
  function vitalsDialog() {
    const d = S.view === 'draft' ? S.draft : null, r = d ? dRec() : cur(); if (!d && !r) return;
    const row = (k, label, inner) => `<div class="mdrow" id="v-f-${k}"><span class="label" id="v-l-${k}">${label}</span><div class="mdrow__c" role="group" aria-labelledby="v-l-${k}">${inner}<span class="field-error" id="v-e-${k}" hidden></span></div></div>`;
    const n = (id, label) => `<input class="input input--num" id="${id}" inputmode="numeric" maxlength="3" autocomplete="off" aria-label="${label}" style="width:90px">`;
    modal.open(dlg('Vital signs — manual fallback', `<p class="muted">Only when corpuls cannot deliver them: what you enter is marked as entered by the crew, with the time now. Fill in only what was measured.</p>
      <div class="ptform">${row('bp', 'Blood pressure', `${n('v-sys', 'Systolic')}<span class="sep">/</span>${n('v-dia', 'Diastolic')}<span class="unit">mmHg</span>`)}${row('hr', 'Heart rate', `${n('v-hr', 'Heart rate')}<span class="unit">bpm</span>`)}${row('spo2', 'SpO₂', `${n('v-spo2', 'SpO2')}<span class="unit">%</span>`)}${row('rr', 'Respiratory rate', `${n('v-rr', 'Respiratory rate')}<span class="unit">/min</span>`)}</div>
      <span class="field-error" id="v-err" hidden></span>`, `<button class="btn btn--secondary" data-act="modal-close">Cancel</button><button class="btn btn--primary btn--lg" data-act="vitals-save">Add readings</button>`, { over: d ? 'Unsent case' : `CAD #${r.cad}` }), { cls: 'modal--wide', focus: '#v-sys' });
  }
  function vitalsSave() {
    const d = S.view === 'draft' ? S.draft : null, r = d ? null : cur(), root = modal.el(), g = id => { const v = root.querySelector('#' + id).value.trim(); return v === '' ? null : Math.round(Number(v)); }, at = now();
    const vals = { sys: g('v-sys'), dia: g('v-dia'), hr: g('v-hr'), spo2: g('v-spo2'), rr: g('v-rr') }, md = {};
    if (vals.sys != null || vals.dia != null) md.bp = { sys: vals.sys, dia: vals.dia, at, fb: true };
    ['hr', 'spo2', 'rr'].forEach(k => { if (vals[k] != null) md[k] = { v: vals[k], at, fb: true }; });
    const E = vErrors(md);
    ['bp', 'hr', 'spo2', 'rr'].forEach(k => { const el = root.querySelector('#v-e-' + k); el.hidden = !E[k]; el.innerHTML = E[k] ? icon('alert') + `<span>${esc(E[k])}</span>` : ''; });
    const ve = root.querySelector('#v-err');
    ve.hidden = !!Object.keys(md).length; ve.innerHTML = Object.keys(md).length ? '' : icon('alert') + '<span>Enter at least one reading.</span>';
    if (!Object.keys(md).length || Object.keys(E).length) return;
    modal.close();
    if (d) { Object.assign(d.md, md); saveLocal(true); render(); return toast('Vital signs kept with the unsent case (marked as entered by the crew)'); }
    Object.entries(md).forEach(([k, a]) => queue({ kind: 'op', cad: r.cad, op: op(r.cad, 'md', { k, v: mdText(k, a), raw: a, at, kind: 'fallback' }) }));
    toast(S.up ? 'Vital signs sent (marked as entered by the crew)' : 'Vital signs saved on this tablet: sent when the connection returns');
  }
  function treatDialog() {
    const r = cur(); if (!r) return;
    TD = { k: null, opt: null };
    modal.open(dlg('Treatment update', `<p class="muted">Optional. Shown silently to the ER and the Cardiologist; earlier entries are kept. Not the ePCR: document fully in the ePCR as usual.</p>
      <div class="field"><span class="label" id="t-k">Treatment</span><div class="choices" role="group" aria-labelledby="t-k">${TREAT.map(x => `<button type="button" class="choice" data-act="t-k" data-v="${x.k}" aria-pressed="false">${esc(x.l)}</button>`).join('')}</div></div>
      <div id="t-more"></div><span class="field-error" id="t-err" hidden></span>`, `<button class="btn btn--secondary" data-act="modal-close">Cancel</button><button class="btn btn--primary btn--lg" data-act="treat-save">Add treatment update</button>`, { over: `CAD #${r.cad}` }), { cls: 'modal--wide' });
  }
  function treatSync() {
    const root = modal.el(); if (!root || !TD) return;
    root.querySelectorAll('[data-act="t-k"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === TD.k)));
    const T = TREAT.find(x => x.k === TD.k);
    if (!T) return UI.modal.patch('#t-more', '');
    const doseNow = root.querySelector('#t-dose') ? root.querySelector('#t-dose').value : '';
    UI.modal.patch('#t-more', `<div class="field"><span class="label" id="t-o">${esc(T.l)}</span><div class="choices" role="group" aria-labelledby="t-o">${T.opts.map(o => `<button type="button" class="choice" data-act="t-o" data-v="${esc(o)}" aria-pressed="${TD.opt === o}">${esc(o)}</button>`).join('')}</div></div>
      ${TD.opt === 'Given' ? `<div class="field"><label class="label" for="t-dose">${T.k === 'otx' ? 'What was given' : 'Dose and route'} <span class="opt">(${T.k === 'otx' ? 'required' : 'optional'})</span></label><input class="input" id="t-dose" maxlength="120" value="${esc(doseNow)}"></div>
      <div class="field"><label class="label" for="t-time">Time given</label><input class="input input--time" id="t-time" type="time" value="${hhmm(now())}" style="width:170px"></div>` : ''}`);
  }
  function treatSave() {
    const r = cur(), root = modal.el(), er = root.querySelector('#t-err'), T = TREAT.find(x => x.k === (TD && TD.k));
    const fail = m => { er.hidden = false; er.innerHTML = icon('alert') + `<span>${esc(m)}</span>`; };
    if (!T) return fail('Choose the treatment.');
    if (!TD.opt) return fail('Choose what was done.');
    let at = now(), v = TD.opt;
    if (TD.opt === 'Given') {
      const dose = root.querySelector('#t-dose').value.trim(), tm = root.querySelector('#t-time').value;
      if (T.k === 'otx' && !dose) return fail('Say what was given.');
      if (tm) at = fromClock(tm);
      v = `Given${dose ? ' · ' + dose : ''}`;
    }
    queue({ kind: 'op', cad: r.cad, op: op(r.cad, 'rec', { k: T.k, label: T.l, v, at }) });
    modal.close(); TD = null;
    toast(S.up ? 'Treatment update sent' : 'Treatment update saved on this tablet: sent when the connection returns');
  }
  /* the manual ECG fallback after SEND: a photographed ECG as the next ECG (the normal one comes from corpuls) */
  function ecgNew() {
    const r = cur(); if (!r) return;
    const n = CLIN.latest(r).n + 1;
    if (!S.ecgd[r.cad] || S.ecgd[r.cad].n !== n) S.ecgd[r.cad] = { n, imgs: [], acq: null, acqSet: false, acqWhy: '', variant: null };
    saveLocal(true); ecgPanel();
  }
  function ecgPanel() {
    const r = cur(), e = r && S.ecgd[r.cad]; if (!e) return modal.close();
    const rep = r.state === 'repeat_requested';
    modal.open(dlg(`Manual ECG fallback · ECG ${e.n}`, `<p>Use this only when the ECG cannot come from corpuls: photograph the 12-lead printout. It is added as ECG ${e.n} and recorded as a <b>manual fallback</b>. ECG ${e.n - 1} and earlier stay unchanged.${rep ? ' The Cardiologist asked for a repeat ECG.' : ''}</p>
      ${e.imgs.length ? `<p class="small">Acquired <b class="mono">${hms(e.acq)}</b>${e.acqSet ? ' (set by the crew)' : ' (first image)'} · <button type="button" class="link-btn" data-act="acq" data-where="${esc(r.cad)}">change</button></p>` : ''}
      <div id="ecgd-shots">${shotsHtml(e, r.cad)}</div>`,
      `<button class="btn btn--secondary" data-act="modal-close">Close (kept on this tablet)</button><button class="btn btn--primary btn--lg" data-act="ecg-send"${e.imgs.length ? '' : ' disabled'}>${icon('send')}SEND FALLBACK ECG ${e.n}</button>`, { over: `CAD #${r.cad}` }), { cls: 'modal--wide' });
  }
  function ecgSend() {
    const r = cur(), e = r && S.ecgd[r.cad]; if (!e || !e.imgs.length) return;
    const n = CLIN.latest(r).n + 1;
    if (e.n !== n) e.n = n;
    queue({ kind: 'ecg', id: `ecg-${r.cad}-${e.n}-${rid()}`, cad: r.cad, n: e.n, acq: e.acq, acqWhy: e.acqSet ? e.acqWhy : '', variant: e.variant || variantFor(e.n), sendAt: now(), imgs: e.imgs.map(x => ({ ...x })) });
    delete S.ecgd[r.cad]; saveLocal(true); modal.close();
    toast(S.up ? `Fallback ECG ${e.n} sending: the ER and the Cardiologist get it silently` : `Fallback ECG ${e.n} saved on this tablet: sent when the connection returns`);
  }
  /* an image added to a manual ECG already sent: linked to that ECG as its next image (nothing is replaced) */
  function addImageSent(n) {
    const r = cur(), e = r && r.ecgs.find(x => x.n === n); if (!e || e.src === 'corpuls') return;
    const where = 'sent:' + n;
    S.ecgd[where] = { n, imgs: [], acq: e.acq, variant: e.variant || variantFor(n), sent: true, base: e.imgs.length + pendingFor(r.cad).filter(x => x.kind === 'img' && x.n === n).length };
    addMenu(where);
  }
  function sentImage(where, how) {
    const e = S.ecgd[where], r = cur(); if (!e || !r) return;
    const finish = x => {
      x.i = e.base + 1;
      queue({ kind: 'img', id: `img-${r.cad}-${e.n}-${x.i}-${rid()}`, cad: r.cad, n: e.n, at: now(), imgs: [x] });
      delete S.ecgd[where]; saveLocal(true); modal.close();
      toast(S.up ? `Image ${x.i} added to ECG ${e.n}: the ER and the Cardiologist get it silently` : `Image ${x.i} saved on this tablet: sent when the connection returns`);
    };
    if (how === 'gen') { const kind = KINDS[e.base % KINDS.length]; return finish({ at: now(), q: 'good', kind, src: 'gen', data: window.ECG.photo(e.variant, kind, 'good', e.acq).url }); }
    sentPick = f => fileToJpeg(f).then(data => finish({ at: now(), q: 'file', kind: 'full', src: 'file', data }), x => toast(x.message, 'err'));
    pickFor = where;
    const inp = $(how === 'camera' ? '#file-camera' : '#file-pick'); inp.value = ''; inp.click();
  }
  function fileChosen(ev) {
    const f = ev.target.files && ev.target.files[0], where = pickFor;
    pickFor = null;
    if (!f || !where) return;
    if (S.ecgd[where] && S.ecgd[where].sent) { if (sentPick) sentPick(f); sentPick = null; return; }
    fileToJpeg(f).then(data => {
      const e = ecgOf(where); if (!e || e.imgs.length >= MAXI) return;
      startEcg(e);
      e.imgs.push({ i: e.imgs.length + 1, at: now(), q: 'file', kind: 'full', src: 'file', data });
      afterImage(where);
    }, x => toast(x.message, 'err'));
  }
  function complete() {
    const r = cur(); if (!r || r.state !== 'confirmed') return;
    modal.open(dlg('COMPLETE STEMI PATHWAY?', `<p>This will close the STEMI pathway for:</p><div class="confirm-box"><span class="cad">CAD #${esc(r.cad)}</span></div><p>The STEMI case will remain available as read-only.</p>${S.up ? '' : `<div class="alert tone-crit">${icon('wifi-off')}<div class="alert__body">No connection: the pathway cannot be completed until the connection returns.</div></div>`}<span class="field-error" id="dlg-err" hidden></span>`,
      `<button class="btn btn--secondary btn--lg" data-act="modal-close">CANCEL</button><button class="btn btn--primary btn--lg" data-act="complete-go"${S.up ? '' : ' disabled'}>COMPLETE</button>`, { over: 'STEMI pathway' }), { focus: '[data-act="modal-close"]' });
  }
  function completeGo(btn) {
    const r = cur(); if (!r) return;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Completing…';
    LIVE.request('POST', '/api/cases/complete', { cad: r.cad }).then(x => {
      if (x.status === 200) { modal.close(); toast(`STEMI PATHWAY COMPLETED · CAD #${r.cad}`); return; }
      btn.disabled = false; btn.textContent = 'COMPLETE';
      const el = modal.el().querySelector('#dlg-err'); el.hidden = false; el.innerHTML = icon('alert') + `<span>${esc(x.body.error || 'Not completed.')}</span>`;
    }, () => { btn.disabled = false; btn.textContent = 'COMPLETE'; toast('No connection: the pathway was not completed.', 'err'); });
  }
  function relink() {
    const cad = S.view === 'draft' ? S.draft && S.draft.cad : S.cad; if (!cad) return;
    if (S.view === 'draft' && S.draft && !S.draft.created) return S.up ? ensureCreated(S.draft).catch(() => {}) : toast('No connection: corpuls is linked when the connection returns.', 'err');
    LIVE.request('POST', '/api/corpuls/link', { cad }).then(x => { if (x.status === 200) { if (x.body.rec) S.cases.set(cad, x.body.rec); render(); toast('corpuls linked'); } else toast(x.body.error || 'corpuls was not linked.', 'err'); }, () => toast('No connection: corpuls was not linked.', 'err'));
  }

  /* ---------- rendering ---------- */
  function setMain(key, html) { const m = $('#main'); if (S.main !== key) { m.innerHTML = html; m._h = null; S.main = key; return true; } return false; }
  function render() {
    patch('top', top());
    patch('banner', banner());
    if ((S.view === 'case' || S.view === 'summary') && !cur()) S.view = 'home';
    if (S.view === 'draft' && !S.draft) S.view = 'home';
    if (S.view === 'home') { setMain('home', vHome()); patchHome(); }
    else if (S.view === 'draft') {
      const d = S.draft;
      if (!d.cadOk || d.editCad) { if (setMain('draft-cad:' + (d.created ? d.cad : ''), vCad())) setTimeout(() => { const i = $('#cadin'); if (i && document.activeElement !== i) i.focus(); }, 0); }
      else { if (setMain('draft:' + d.cad, vDraft())) mdSync(); patchDraft(); }
    } else if (S.view === 'case') { setMain('case:' + S.cad, vCase()); patchCase(); }
    else if (S.view === 'summary') { setMain('sum:' + S.cad, ''); patch('main', vSummary(cur())); }
    outcomes();
  }
  /* the monitor parts only (a vital-signs update every few seconds) */
  function renderMonitor() {
    if (S.view === 'draft' && S.draft && S.draft.cadOk && !S.draft.editCad) { const rec = dRec(); CLIN.paint('d-bar', cbar(rec, S.draft)); CLIN.paint('d-mon', monBox(rec, S.draft)); }
    else if (S.view === 'case') { const r = cur(); if (r) { CLIN.paint('c-bar', cbar(r, null)); CLIN.paint('c-mon', monBox(r, null)); } }
  }
  function go(view) { S.view = view; UI.hideToast(); render(); scrollTo(0, 0); }
  function openCase(cad, stat) {
    S.cad = cad; S.stat = stat || null; go('case');
    const h = $('.case-h__cad'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }
  function openDone(cad) {
    LIVE.request('GET', '/api/cases/view?cad=' + encodeURIComponent(cad)).then(x => {
      if (x.status !== 200) return toast('This case could not be opened.', 'err');
      openCase(cad, x.body.rec);
    }, () => toast('No connection: the case could not be opened.', 'err'));
  }

  /* ---------- actions ---------- */
  function act(a, t) {
    const d = t.dataset;
    if (a.startsWith('md-')) return S.draft && mdClick(a, t);
    switch (a) {
      case 'home': return go('home');
      case 'logout': return window.logout();
      case 'new-case':
        if (S.draft) return modal.open(dlg('An unsent case is open', `<p>${S.draft.cad ? `<span class="cad">CAD #${esc(S.draft.cad)}</span> was` : 'A case was'} started on this tablet and not sent. Continue it, or discard it and start a new case.</p>`, '<button class="btn btn--danger-quiet" data-act="draft-discard">Discard it</button><button class="btn btn--primary" data-act="draft-open">Continue the unsent case</button>', { over: 'OPEN STEMI PATHWAY' }));
        S.draft = newDraft(); S.mdTried = false; saveLocal(true); go('draft'); return;
      case 'draft-open': modal.close(); return go('draft');
      case 'draft-discard': return discardDraft();
      case 'draft-discard-go': {
        const dd = S.draft;
        if (dd && dd.created) queue({ kind: 'req', method: 'POST', url: '/api/cases/discard', body: { cad: dd.cad }, cad: dd.cad });
        S.draft = null; S.mdTried = false; saveLocal(true); modal.close(); go('home'); return toast('Unsent case discarded');
      }
      case 'cad-ok': return cadContinue();
      case 'cad-edit': if (S.draft) { S.draft.editCad = true; S.draft.cadIn = S.draft.cad; saveLocal(true); render(); } return;
      case 'cad-cancel': if (S.draft) { S.draft.editCad = false; saveLocal(true); render(); } return;
      case 'dup-fix': modal.close(); if (S.draft) { S.draft.editCad = true; if (!S.draft.created) S.draft.cadOk = false; saveLocal(true); } go('draft'); setTimeout(() => { const i = $('#cadin'); if (i) { i.focus(); i.select(); } }, 30); return;
      case 'dup-open': return openExisting(d.cad);
      case 'relink': return relink();
      case 'fb-draft': return addMenu('draft');
      case 'img-add': return addMenu(d.where);
      case 'img-gen': case 'img-camera': case 'img-file': {
        const e = ecgOf(d.where); if (!e) return;
        const how = a === 'img-gen' ? 'gen' : a === 'img-camera' ? 'camera' : 'file';
        return e.sent ? sentImage(d.where, how) : addImage(d.where, how);
      }
      case 'img-remove': return removeImage(d.where, +d.i);
      case 'img-remove-go': {
        const e = ecgOf(d.where); if (!e) return;
        e.imgs = e.imgs.filter(x => x.i !== +d.i).map((x, k) => ({ ...x, i: k + 1 }));
        if (!e.imgs.length) { e.acq = null; e.acqSet = false; e.acqWhy = ''; }
        saveLocal(true);
        if (d.where === 'draft') { modal.close(); return render(); }
        return ecgPanel();
      }
      case 'ecg-panel': return ecgPanel();
      case 'shot-view': { const e = ecgOf(d.where); if (e) viewLocal(e, +d.i); return; }
      case 'acq': return acqDialog(d.where);
      case 'acq-save': return acqSave(d.where);
      case 'send': return sendDraft();
      case 'open': return openCase(d.cad);
      case 'open-done': return openDone(d.cad);
      case 'summary': { const r = cur(); if (r && !r.hopen && !RULES.isClosed(r.state)) send('hopen'); return go('summary'); }
      case 'sum-back': return go('case');
      case 'sum-img': case 'ecg-view': { const r = cur(); if (r) CLIN.showFull(r, +d.n, +d.i); return; }
      case 'vitals': return vitalsDialog();
      case 'vitals-save': return vitalsSave();
      case 'treat': return treatDialog();
      case 't-k': if (TD) { TD.k = d.v; TD.opt = null; treatSync(); } return;
      case 't-o': if (TD) { TD.opt = d.v; treatSync(); } return;
      case 'treat-save': return treatSave();
      case 'ecg-new': return ecgNew();
      case 'ecg-send': return ecgSend();
      case 'img-add-sent': return addImageSent(+d.n);
      case 'complete': return complete();
      case 'complete-go': return completeGo(t);
      case 'dec-ack': { const r = S.cases.get(d.cad); modal.close(); if (r) queue({ kind: 'op', cad: r.cad, op: op(r.cad, 'decack', { id: d.id }) }); setTimeout(outcomes, 50); return; }
      case 'er-ack': { const r = S.cases.get(d.cad); modal.close(); if (r) queue({ kind: 'op', cad: r.cad, op: op(r.cad, 'erack') }); setTimeout(outcomes, 50); return; }
    }
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    if (t.getAttribute('aria-disabled') === 'true' && t.dataset.act !== 'send') return;
    if (t.tagName === 'A') e.preventDefault();
    act(t.dataset.act, t);
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'hq') { S.histQ = t.value; clearTimeout(hT); hT = setTimeout(loadHist, 250); return; }
    if (t.dataset && t.dataset.md && S.draft) return mdInput(t);
    if (t.id === 'cadin' && S.draft) {
      S.draft.cadIn = t.value;
      const er = $('#cad-err'); if (er && !er.hidden) { er.hidden = true; t.removeAttribute('aria-invalid'); }
      saveLocal();
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'cadin') { e.preventDefault(); cadContinue(); } });
  $('#file-camera').addEventListener('change', fileChosen);
  $('#file-pick').addEventListener('change', fileChosen);

  /* ---------- the link to the platform ---------- */
  function onMsg(m) {
    switch (m.t) {
      case 'init':
        UI.setClock(m.now); S.started = true;
        /* the test data was reset: anything waiting for a case that no longer exists is dropped; the unsent case stays,
           to be created again */
        if (S.epoch && S.epoch !== m.epoch) { S.out = []; S.ecgd = {}; S.cases.clear(); S.hist = null; S.histAsked = false; if (S.draft) { S.draft.send = null; S.draft.created = false; } if (S.view !== 'draft') S.view = 'home'; }
        S.epoch = m.epoch; saveLocal();
        if (S.up && S.draft && S.draft.cadOk && !S.draft.created && !S.draft.editCad) ensureCreated(S.draft).catch(() => {});
        return;
      case 'cfg': S.sim = m.sim || S.sim; return;
      case 'cases': S.cases = new Map(m.list.map(r => [r.cad, r])); m.list.forEach(r => { S.prevState[r.cad] = r.state; }); break;
      case 'case': {
        const was = S.prevState[m.cad];
        if (m.rec) {
          S.cases.set(m.cad, m.rec); S.prevState[m.cad] = m.rec.state;
          if (was && was !== 'draft' && was !== m.rec.state && !(S.view === 'case' && S.cad === m.cad)) toast(`CAD #${m.cad}: ${RULES.label(m.rec.state, ROLE)[0]}`);
          if (RULES.isClosed(m.rec.state) && !RULES.isClosed(was || 'draft')) { S.hist = null; S.histAsked = false; loadHist(); }
        } else { S.cases.delete(m.cad); if (S.cad === m.cad && !S.stat) toast(`CAD #${m.cad} is no longer on this tablet (taken off by the test console).`); }
        break;
      }
      case 'monitor': { const r = S.cases.get(m.cad); if (r) { r.monitor = m.mon; renderMonitor(); } return; }
      case 'net':
        S.up = m.up;
        if (S.up) {
          pump();
          const d = S.draft;
          if (d && d.cadOk && !d.created && !d.editCad) ensureCreated(d).catch(() => {});
          if (d && d.send && d.send.stage === 'queued') setTimeout(sendDraft, 300);
        }
        break;
      case 'hb': UI.setClock(m.at); if (S.out.length) pump(); return;
      default: return;
    }
    render();
  }
  restoreLocal();
  render();
  LIVE = Live({ role: ROLE, onMsg });
  setInterval(() => { if (S.view !== 'draft') render(); outcomes(); }, 15000);
  setInterval(outcomes, 2000);
  /* the freshness of the corpuls data changes with time alone */
  setInterval(renderMonitor, 2000);
})();
