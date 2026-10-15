/* Crew MDT (landscape tablet first; also desktop and portrait).
   OPEN STEMI PATHWAY → CAD NUMBER (entered manually from the dispatch / MDT information) → ECG → MINIMUM DATA → SEND.
   The case goes to the ER first; the ER Doctor decides whether the Cardiologist is activated. The crew follows the case
   live: CREW → ER → CARDIOLOGY → DECISION. After SEND the CAD number and the sent data are locked; new vital signs,
   treatment updates and serial ECGs are added, never replacing anything. The unsent case and anything waiting for the
   connection are kept on this tablet (OFFLINE — CHANGES SAVED LOCALLY). Nothing here decides anything clinical. */
(() => {
  'use strict';
  const { $, $$, esc, icon, hm, hms, when, now, toast, modal, dlg, badge, conn, topbar, patch, empty, rid } = UI;
  const ROLE = 'crew', AU = UI.APP.user || {}, ME = `${AU.name}, ${AU.title}`;
  const LSK = 'stemi.crew.v2', MAXI = 4;
  const COMPLAINTS = [
    { k: 'cp', l: 'Chest pain or discomfort', s: 'Chest pain' },
    { k: 'sob', l: 'Shortness of breath', s: 'Shortness of breath' },
    { k: 'epi', l: 'Epigastric or upper abdominal pain', s: 'Epigastric pain' },
    { k: 'syn', l: 'Collapse or syncope', s: 'Collapse or syncope' },
    { k: 'pal', l: 'Palpitations', s: 'Palpitations' },
    { k: 'ecg', l: 'Abnormal ECG on the monitor', s: 'Abnormal ECG' },
    { k: 'oth', l: 'Other (describe)', s: 'Other' }
  ];
  const FIELDS = [
    { k: 'age', l: 'Age' }, { k: 'sex', l: 'Sex' }, { k: 'complaint', l: 'Presenting complaint' }, { k: 'onset', l: 'Symptom onset' },
    { k: 'bp', l: 'Blood pressure' }, { k: 'hr', l: 'Heart rate' }, { k: 'spo2', l: 'SpO₂' }, { k: 'gcs', l: 'GCS' }
  ];
  const NV = { age: ['Unknown'], sex: ['Unknown'], onset: ['Unknown'], bp: ['Not obtained', 'Unable to obtain'], hr: ['Not obtained', 'Unable to obtain'], spo2: ['Not obtained', 'Unable to obtain'], gcs: ['Not obtained', 'Unable to assess'] };
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
      if (S.draft && S.draft.send && S.draft.send.stage !== 'queued') S.draft.send.stage = 'failed';
    } catch (_) { /* unreadable: start clean */ }
  }

  /* ---------- the minimum data: every item needs an answer; Unknown / Not obtained / Unable are answers ---------- */
  const RANGE = { age: [0, 120], sys: [40, 300], dia: [20, 200], hr: [20, 300], spo2: [50, 100], gcs: [3, 15] };
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
    if (!a.bp) e.bp = 'Enter the BP, or choose Not obtained / Unable to obtain.';
    else if (!a.bp.nv) {
      if (!inRange(a.bp.sys, RANGE.sys) || !inRange(a.bp.dia, RANGE.dia)) e.bp = 'BP: systolic 40–300 and diastolic 20–200 mmHg.';
      else if (a.bp.sys <= a.bp.dia) e.bp = 'BP: the systolic value must be higher than the diastolic.';
    }
    if (!a.hr) e.hr = 'Enter the heart rate, or choose Not obtained / Unable to obtain.'; else if (!a.hr.nv && !inRange(a.hr.v, RANGE.hr)) e.hr = 'Heart rate: 20–300 bpm.';
    if (!a.spo2) e.spo2 = 'Enter the SpO₂, or choose Not obtained / Unable to obtain.'; else if (!a.spo2.nv && !inRange(a.spo2.v, RANGE.spo2)) e.spo2 = 'SpO₂: 50–100 %.';
    if (!a.gcs) e.gcs = 'Enter the GCS, or choose Not obtained / Unable to assess.'; else if (!a.gcs.nv && !inRange(a.gcs.v, RANGE.gcs)) e.gcs = 'GCS: 3 to 15.';
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
      case 'gcs': return String(a.v);
    }
    return '';
  }
  const mdPayload = md => Object.fromEntries(FIELDS.map(f => [f.k, { v: mdText(f.k, md[f.k]), raw: md[f.k], t: md[f.k].at || now() }]));

  /* ---------- ECG images: a photo from this tablet's camera, an image file, or a fictional test ECG ---------- */
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
  /* the ECG being built before it is sent: the draft's ECG 1, or a serial ECG of a sent case (keyed by its CAD number) */
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
    toast(`Image ${e.imgs.length} added to ECG ${e.n}`);
    if (where === 'draft') { modal.close(); rerender(); } else ecgPanel();
  }
  function addMenu(where) {
    const e = ecgOf(where); if (!e) return;
    modal.open(dlg(`Add an image to ECG ${e.n}`, `<p class="muted">Another photo of the same ECG printout (for example a closer view). It stays part of ECG ${e.n}; a new recording is a new ECG.</p>
      <div class="addmenu"><button class="btn btn--primary btn--lg btn--block" data-act="img-camera" data-where="${esc(where)}">${icon('camera')}Take a photo</button>
      <button class="btn btn--secondary btn--lg btn--block" data-act="img-file" data-where="${esc(where)}">${icon('upload')}Choose an image file</button>
      <button class="btn btn--secondary btn--lg btn--block" data-act="img-gen" data-where="${esc(where)}">${icon('ecg')}Use a fictional test ECG image</button></div>
      <p class="xs subtle">Test build: use fictional test images only, never a real patient's ECG.</p>`, '<button class="btn btn--secondary" data-act="modal-close">Cancel</button>', { over: 'ECG image' }));
  }
  function shotHtml(e, x, where, locked) {
    const q = x.q === 'glare' ? 'Glare over leads I–III' : x.q === 'cut' ? 'Leads V4–V6 cut off' : x.q === 'file' ? 'Image file (not checked in this build)' : 'Fictional test image';
    return `<div class="shot"><button class="shot__img" data-act="shot-view" data-where="${esc(where)}" data-i="${x.i}" aria-label="ECG ${e.n}, Image ${x.i}: view full screen"><img src="${esc(x.data || x.url)}" alt=""></button>
      <div class="shot__t"><b>Image ${x.i}</b>${x.i === 1 ? '<span class="tag tag--primary">Primary</span>' : ''}<span class="muted">${hms(x.at)}</span></div>
      <span class="quality muted">${q}</span>${locked ? '' : `<div class="shot__a"><button class="btn btn--sm btn--danger-quiet" data-act="img-remove" data-where="${esc(where)}" data-i="${x.i}">${icon('trash')}Remove</button></div>`}</div>`;
  }
  const shotsHtml = (e, where) => `<div class="shots">${e.imgs.map(x => shotHtml(e, x, where)).join('')}${e.imgs.length < MAXI ? `<div class="shot shot--add"><button class="btn btn--primary" data-act="img-add" data-where="${esc(where)}">${icon('plus')}ADD ECG IMAGE</button><span class="xs subtle" style="text-align:center">${e.imgs.length ? 'Another image of the same ECG' : 'Photo of the 12-lead ECG'}</span></div>` : ''}</div>`;
  function viewLocal(e, i) {
    const rec = { cad: S.draft && S.draft.cad || 'not sent', ecgs: [{ n: e.n, acq: e.acq, rcv: null, pri: 1, imgs: e.imgs.map(x => ({ i: x.i, at: x.at, url: x.data || x.url })) }] };
    CLIN.showFull(rec, e.n, i);
  }
  function removeImage(where, i) {
    const e = ecgOf(where); if (!e) return;
    modal.open(dlg(`Remove Image ${i} from ECG ${e.n}?`, '<p>This image has not been sent. Removing it deletes it from this tablet.</p>',
      `<button class="btn btn--secondary" data-act="${where === 'draft' ? 'modal-close' : 'ecg-panel'}">Keep it</button><button class="btn btn--critical" data-act="img-remove-go" data-where="${esc(where)}" data-i="${i}">Remove image</button>`, { over: 'Unsent image' }), { focus: '.modal__f .btn' });
  }
  function acqDialog(where) {
    const e = ecgOf(where); if (!e || !e.imgs.length) return;
    const d = new Date(e.acq);
    modal.open(dlg(`ECG ${e.n} acquisition time`, `<p class="muted">The time the ECG was recorded. It defaults to the time of the first image.</p>
      <div class="field"><label class="label" for="acq-t">ECG acquired at</label><input class="input input--time" id="acq-t" type="time" step="1" value="${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}" style="width:180px"></div>
      <div class="field"><label class="label" for="acq-why">Why the time differs from the first image <span class="opt">(required when changed)</span></label><input class="input" id="acq-why" maxlength="200" value="${esc(e.acqWhy || '')}" placeholder="For example: photographed after the recording"><span class="field-error" id="acq-err" hidden></span></div>`,
      `<button class="btn btn--secondary" data-act="${where === 'draft' ? 'modal-close' : 'ecg-panel'}">Cancel</button><button class="btn btn--primary" data-act="acq-save" data-where="${esc(where)}">Save time</button>`, { over: 'ECG' }), { focus: '#acq-t' });
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
    if (where === 'draft') { modal.close(); rerender(); } else ecgPanel();
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
        if (it.kind === 'ecg') o = { ...op(it.cad, 'ecg', { sendAt: it.sendAt, ecg: { n: it.n, acq: it.acq, variant: it.variant, pri: 1, same: it.n > 2, timeWhy: it.acqWhy || null, imgs: it.imgs.map(x => ({ i: x.i, kind: x.kind, q: x.q, at: x.at, imageId: x.imageId })) } }, it.sendAt), id: it.id };
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
    toast(`${it.kind === 'ecg' ? `ECG ${it.n}` : it.kind === 'img' ? `Image ${it.imgs[0].i} of ECG ${it.n}` : 'An entry'} was NOT accepted: ${why || 'refused by the platform'}`, 'err');
  }
  const pendingFor = cad => S.out.filter(x => x.cad === cad);
  function send(k, data) { const r = cur(); if (r) queue({ kind: 'op', cad: r.cad, op: op(r.cad, k, data) }); }

  /* ---------- the unsent case (the draft) ---------- */
  const newDraft = () => ({ cid: 't' + rid() + rid(), openedAt: now(), step: 'cad', cad: '', cadIn: '', cadOk: false, cadChecked: false, cadHist: [],
    ecg: { n: 1, imgs: [], acq: null, acqSet: false, acqWhy: '', variant: null }, md: {}, send: null });
  const dReady = d => ({ cad: d.cadOk, ecg: d.ecg.imgs.length > 0, md: !Object.keys(mdErrors(d.md)).length });
  function goStep(k) {
    const d = S.draft; if (!d) return;
    if (k !== 'cad' && !d.cadOk) { toast('Enter the CAD number first.', 'err'); k = 'cad'; }
    d.step = k; S.mdTried = false; saveLocal(); S.view = 'draft'; render(); scrollTo(0, 0);
    const f = $(k === 'cad' ? '#cadin' : '.draft__body h2'); if (f) { if (k !== 'cad') f.setAttribute('tabindex', '-1'); f.focus({ preventScroll: true }); }
  }
  function cadContinue() {
    const d = S.draft, inp = $('#cadin'), err = $('#cad-err');
    if (!d || !inp || inp.disabled) return d && goStep('ecg');
    const raw = inp.value, c = CADN.check(raw);
    d.cadIn = raw;
    const fail = (msg, detail) => { err.hidden = false; err.innerHTML = icon('alert') + `<span>${esc(msg)}${detail ? ' ' + esc(detail) : ''}</span>`; inp.setAttribute('aria-invalid', 'true'); inp.focus(); };
    if (!c.ok) return fail(c.error, c.detail);
    const accept = checked => {
      if (!d.cadHist.length || d.cadHist[d.cadHist.length - 1].v !== c.cad) d.cadHist.push({ v: c.cad, t: now() });
      d.cad = c.cad; d.cadIn = c.cad; d.cadOk = true; d.cadChecked = checked;
      if (!checked) toast('No connection: the CAD number is checked for an existing case when you send.');
      goStep(d.ecg.imgs.length ? (dReady(d).md ? 'review' : 'md') : 'ecg');
    };
    if (!S.up) return accept(false);
    const btn = $('[data-act="cad-ok"]'); if (btn) btn.disabled = true;
    LIVE.request('GET', '/api/cases/check?cad=' + encodeURIComponent(c.cad)).then(x => {
      if (btn) btn.disabled = false;
      if (x.status !== 200) return accept(false);
      if (!x.body.ok) return fail(x.body.error, x.body.detail);
      if (x.body.exists) return dupDialog(c.cad, x.body.existing);
      accept(true);
    }, () => { if (btn) btn.disabled = false; accept(false); });
  }
  function dupDialog(cad, ex) {
    modal.open(dlg('CASE ALREADY EXISTS', `<div class="confirm-box"><span class="cad">CAD #${esc(cad)}</span><span class="muted">A STEMI case already exists under this CAD number${ex && ex.unit ? ` (${esc(ex.unit)}, opened ${when(ex.openedAt)})` : ''}${ex && ex.closedAt ? ' · its STEMI pathway is closed' : ''}.</span></div>
      <p>No second case is created and the existing case is not changed. Open the existing case, or correct the CAD number. What you entered here stays as your unsent case.</p>`,
      `<button class="btn btn--secondary" data-act="dup-fix">Correct the CAD number</button><button class="btn btn--primary" data-act="dup-open" data-cad="${esc(cad)}">OPEN EXISTING CASE</button>`, { over: 'CAD number', noClose: true }), { cls: 'dup', locked: true, focus: '[data-act="dup-fix"]' });
  }
  function openExisting(cad) {
    LIVE.request('POST', '/api/cases/open', { cad }).then(x => {
      modal.close();
      if (x.status !== 200) return toast(x.body.error || 'The existing case could not be opened.', 'err');
      if (S.draft) { S.draft.cadOk = false; S.draft.step = 'cad'; saveLocal(true); }
      const rec = x.body.rec, closed = rec && RULES.isClosed(rec.state);
      if (rec && !closed) S.cases.set(cad, rec);
      openCase(cad, closed ? rec : null);
      toast(`Existing case CAD #${cad} opened. Your unsent case is kept on the home screen.`);
    }, () => toast('No connection: the existing case could not be opened.', 'err'));
  }
  /* SEND: create the case under the CAD number, upload ECG 1, then send it with the minimum data */
  async function sendDraft() {
    const d = S.draft; if (!d) return;
    const r = dReady(d);
    if (!r.cad || !r.ecg || !r.md) return toast('The case is not complete: see the steps still marked as missing.', 'err');
    if (d.send && ['create', 'upload', 'submit'].includes(d.send.stage)) return;
    d.send = { stage: 'create', pct: 0, at: d.send && d.send.at || now(), tries: (d.send && d.send.tries || 0) + 1, created: !!(d.send && d.send.created) };
    saveLocal(true); render();
    if (!S.up) return sendWait('No connection');
    try {
      if (!d.send.created) {
        const x = await LIVE.request('POST', '/api/cases', { cad: d.cad, cid: d.cid, openedAt: d.openedAt, hist: d.cadHist });
        if (x.status === 409 && x.body.code === 'exists') { d.send = null; d.cadOk = false; d.step = 'cad'; saveLocal(true); render(); return dupDialog(d.cad, x.body.existing); }
        if (x.status === 400) { d.send = null; d.cadOk = false; d.step = 'cad'; saveLocal(true); render(); return toast(`${x.body.error} ${x.body.detail || ''}`, 'err'); }
        if (x.status !== 200 && x.status !== 201) throw new Error('HTTP ' + x.status);
        d.send.created = true; saveLocal(true);
        if (x.body.rec) S.cases.set(d.cad, x.body.rec);
      }
      d.send.stage = 'upload'; render();
      const L = d.ecg.imgs;
      for (let k = 0; k < L.length; k++) {
        if (L[k].imageId) continue;
        const up = await LIVE.upload(dataUrlToBlob(L[k].data), { cad: d.cad, src: L[k].src === 'file' ? 'file' : 'gen' }, f => { d.send.pct = Math.round((k + f) / L.length * 100); patch('send-pct', sendPct()); });
        L[k].imageId = up.id; L[k].url = up.url; saveLocal(true);
      }
      d.send.stage = 'submit'; d.send.pct = 100; render();
      const sendAt = d.send.at;
      const o = op(d.cad, 'submit', { sendAt, late: d.send.tries > 1, md: mdPayload(d.md), ecg: { n: 1, acq: d.ecg.acq, variant: d.ecg.variant, pri: 1, same: false, timeWhy: d.ecg.acqSet ? d.ecg.acqWhy : null, imgs: L.map(x => ({ i: x.i, kind: x.kind, q: x.q, at: x.at, imageId: x.imageId })) } }, sendAt);
      o.id = 'submit-' + d.cid;
      const res = await LIVE.send([o]);
      const x = (res.results || [])[0] || {};
      if (!x.ok) { d.send = { ...d.send, stage: 'failed', err: x.error }; saveLocal(true); render(); return toast(`NOT SENT: ${x.error}`, 'err'); }
      const cad = d.cad;
      S.draft = null; saveLocal(true);
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
    modal.open(dlg('Discard the unsent case?', `<p>${d.cad ? `<span class="cad">CAD #${esc(d.cad)}</span>: ` : ''}${d.ecg.imgs.length} ECG image${d.ecg.imgs.length === 1 ? '' : 's'} and the minimum data entered on this tablet are deleted. Nothing was sent${d.send && d.send.created ? ' (the case number was registered on the platform, but no ECG or data reached the ER)' : ''}.</p>`,
      `<button class="btn btn--secondary" data-act="modal-close">Keep it</button><button class="btn btn--critical" data-act="draft-discard-go">Discard</button>`, { over: 'Unsent case' }), { focus: '[data-act="modal-close"]' });
  }

  /* ---------- the case on screen ---------- */
  const cur = () => (S.cad && (S.cases.get(S.cad) || (S.stat && S.stat.cad === S.cad ? S.stat : null))) || null;
  const openCases = () => [...S.cases.values()].filter(r => !RULES.isClosed(r.state) && r.state !== 'draft').sort((a, b) => (b.sub ? b.sub.send : b.created) - (a.sub ? a.sub.send : a.created));
  const val = (r, k) => { const x = CLIN.cur(r, k); return x ? (CLIN.isNv(x) && (k === 'age' || k === 'sex') ? `${k === 'age' ? 'Age' : 'Sex'} ${x.v.toLowerCase()}` : x.v) : null; };
  const ptLine = r => [val(r, 'age'), val(r, 'sex'), val(r, 'complaint')].filter(Boolean).map(esc).join(' · ') || 'Patient details not entered';

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

  /* ---------- home ---------- */
  function vHome() {
    return `<div class="home-h"><div><h1>STEMI cases</h1><p>${esc(AU.unit || '')} · ${esc(AU.emirate || '')} · ${esc(ME)}</p></div>
        <button class="btn btn--primary btn--xl" data-act="new-case">${icon('plus')}NEW STEMI CASE</button></div>
      <div id="h-draft"></div>
      <div class="stack" style="gap:28px">
        <section class="section" aria-labelledby="h-act"><div class="section__h"><h2 id="h-act">Active cases</h2><span id="n-act"></span></div><div id="q-act"></div></section>
        <section class="section" aria-labelledby="h-done"><div class="section__h"><h2 id="h-done">Completed cases</h2><span class="sp"></span>
          <div class="search">${icon('search')}<label class="sr-only" for="hq">Search completed cases by CAD number</label><input class="input" id="hq" type="search" placeholder="Search by CAD number" autocomplete="off" spellcheck="false" value="${esc(S.histQ)}"></div></div><div id="q-done"></div></section>
      </div>
      <p class="footnote"><span>STEMI Coordination Platform · v${esc(UI.APP.version)} · test build</span><span>Fictional test data only — never real patient information</span><span>Not an ePCR: document in the ePCR as usual</span></p>`;
  }
  function draftCard() {
    const d = S.draft;
    if (!d) return '';
    const st = d.send && d.send.stage === 'queued' ? 'NOT SENT — waiting for the connection' : d.send && d.send.stage === 'failed' ? 'NOT SENT — send again' : 'Not sent';
    return `<div class="draftcard" role="region" aria-label="Unsent case"><div class="draftcard__t"><b>Unsent case · ${d.cad ? `<span class="cad">CAD #${esc(d.cad)}</span>` : 'CAD number not entered'}</b>
      <span class="small muted">${st} · ${d.ecg.imgs.length} ECG image${d.ecg.imgs.length === 1 ? '' : 's'} · minimum data ${answered(d.md)} of 8 · saved on this tablet</span></div>
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
    patch('q-act', `<div class="qlist">${A.length ? A.map(homeRow).join('') : empty('ambulance', 'No active STEMI cases', 'Start one with NEW STEMI CASE.')}</div>`);
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

  /* ---------- the new case: one pathway in four steps ---------- */
  function vDraft() {
    const d = S.draft, r = dReady(d), n = answered(d.md);
    const step = (k, i, title, sub, ok, disabled) => `<li><button class="step${ok ? ' is-done' : ''}" data-act="step" data-k="${k}"${d.step === k ? ' aria-current="step"' : ''}${disabled ? ' disabled' : ''}><span class="step__n">${ok ? icon('check') : i}</span><span class="step__t"><b>${title}</b><span>${sub}</span></span></button></li>`;
    const steps = `<ol class="steps" aria-label="New STEMI case steps">${step('cad', 1, 'CAD number', d.cadOk ? `CAD #${esc(d.cad)}` : 'Not entered', d.cadOk)}
      ${step('ecg', 2, 'ECG', d.ecg.imgs.length ? `ECG 1 · ${d.ecg.imgs.length} image${d.ecg.imgs.length > 1 ? 's' : ''}` : 'Not captured', r.ecg, !d.cadOk)}
      ${step('md', 3, 'Minimum data', `${n} of 8`, r.md, !d.cadOk)}
      ${step('review', 4, 'Review and send', d.send && d.send.stage === 'queued' ? 'Waiting for connection' : 'SEND TO ER', false, !d.cadOk)}</ol>`;
    const body = { cad: vCad, ecg: vEcgStep, md: vMd, review: vReview }[d.step]();
    return `<div class="draft-h"><button class="btn btn--quiet" data-act="home" style="margin-left:-8px">${icon('chev-left')}Cases</button><h1>New STEMI case</h1>${d.cadOk ? `<span class="cad">CAD #${esc(d.cad)}</span>` : ''}${badge('draft', ROLE)}<span class="sp"></span><button class="btn btn--danger-quiet" data-act="draft-discard">${icon('trash')}Discard</button></div>
      <div class="draft">${steps}<div class="draft__body" id="d-body">${body}</div></div>`;
  }
  const foot = (back, next) => `<div class="draft__foot">${back ? `<button class="btn btn--secondary btn--lg" data-act="step" data-k="${back}">${icon('chev-left')}Back</button>` : '<span></span>'}<span class="small muted">${icon('check', 'ico-sm')} Saved on this tablet</span><div class="btn-row">${next}</div></div>`;
  function vCad() {
    const d = S.draft, locked = !!(d.send && d.send.created);
    return `<section class="card"><div class="card__h"><h2>1 · CAD number</h2></div><div class="card__b"><div class="cadbox">
      <div class="field"><label class="label" for="cadin">CAD number</label>
        <input class="input input--lg" id="cadin" inputmode="numeric" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${CADN.EXAMPLE}" value="${esc(d.cadIn || d.cad)}" aria-describedby="cad-hint cad-err"${locked ? ' disabled' : ''}>
        <span class="hint" id="cad-hint">Enter the CAD number from the dispatch / MDT information. Accepted: CAD#${CADN.EXAMPLE}, ${CADN.EXAMPLE} or ${CADN.EXAMPLE.replace(/-/g, '')}. It is checked for an existing case, and locked once the case is sent.</span>
        <span class="field-error" id="cad-err" hidden></span></div>
      ${locked ? `<p class="lockline">${icon('lock')}The case was already created under this number: it cannot be changed.</p>` : ''}</div></div></section>
      ${foot(null, `<button class="btn btn--primary btn--lg" data-act="cad-ok">Continue${icon('arrow-right')}</button>`)}`;
  }
  function vEcgStep() {
    const e = S.draft.ecg;
    return `<section class="card"><div class="card__h"><h2>2 · ECG 1</h2><span class="sp"></span>${e.imgs.length ? `<span class="small muted">acquired <span class="mono">${hms(e.acq)}</span>${e.acqSet ? ' (set by the crew)' : ' (first image)'}</span><button class="btn btn--sm btn--quiet" data-act="acq" data-where="draft">${icon('clock', 'ico-sm')}Change time</button>` : ''}</div>
      <div class="card__b stack"><p class="muted">Photograph the whole 12-lead ECG printout. Add more images of the same ECG if useful (for example a closer view of the chest leads). Nothing is replaced or deleted after SEND.</p>${shotsHtml(e, 'draft')}</div></section>
      ${foot('cad', `<button class="btn btn--primary btn--lg" data-act="step" data-k="md"${e.imgs.length ? '' : ' disabled'}>Continue${icon('arrow-right')}</button>`)}`;
  }
  const nvBtns = (k, c) => (NV[k] || []).map(v => `<button type="button" class="choice choice--quiet" data-act="md-nv" data-k="${k}" data-v="${esc(v)}" aria-pressed="${!!(c && c.nv === v)}">${esc(v)}</button>`).join('');
  const mdRow = (k, label, control, hint) => `<div class="mdrow" id="f-${k}"><div class="mdrow__l"><span class="label" id="l-${k}">${label}</span>${hint ? `<span class="hint">${hint}</span>` : ''}</div><div class="mdrow__c" role="group" aria-labelledby="l-${k}" aria-describedby="e-${k}">${control}<span class="field-error" id="e-${k}" hidden></span></div></div>`;
  function vMd() {
    const d = S.draft, m = d.md, num = (k, v, w) => `<input class="input input--num" id="md-${k}" data-md="${k}" inputmode="numeric" maxlength="3" autocomplete="off" value="${v == null ? '' : v}" aria-label="${w}" style="width:96px">`;
    const age = m.age || {}, bp = m.bp || {}, on = m.onset || {}, cp = m.complaint || {};
    const e1 = d.ecg.imgs.length ? `ECG 1 acquired <b class="mono">${hms(d.ecg.acq)}</b> · <button type="button" class="link-btn" data-act="acq" data-where="draft">change</button>` : '<span class="nv">No ECG yet</span>';
    return `<div class="stack" id="mdform">
      <section class="mdsec"><div class="mdsec__h"><h2>3 · Minimum data — patient</h2><span>Every item needs an answer; Unknown is an answer.</span></div>
        ${mdRow('age', 'Age', `${num('age', age.nv ? '' : age.v, 'Age in years')}<span class="unit">years</span><button type="button" class="choice" data-act="md-est" aria-pressed="${!!age.est}">Estimated</button><span class="vline"></span>${nvBtns('age', m.age)}`)}
        ${mdRow('sex', 'Sex', ['Male', 'Female'].map(v => `<button type="button" class="choice" data-act="md-set" data-k="sex" data-v="${v}" aria-pressed="${!!(m.sex && m.sex.v === v)}">${v}</button>`).join('') + '<span class="vline"></span>' + nvBtns('sex', m.sex))}
        ${mdRow('complaint', 'Presenting complaint', COMPLAINTS.map(c => `<button type="button" class="choice" data-act="md-set" data-k="complaint" data-v="${c.k}" aria-pressed="${cp.k === c.k}">${esc(c.l)}</button>`).join('') + `<input class="input input--other" id="md-other" data-md="other" maxlength="120" placeholder="Describe the complaint" value="${esc(cp.other || '')}" aria-label="Other presenting complaint"${cp.k === 'oth' ? '' : ' hidden'}>`, 'or the reason for the ECG')}
        ${mdRow('onset', 'Symptom onset', `<input class="input input--time" id="md-onset" data-md="onset" type="time" value="${on.t ? hhmm(on.t) : ''}" aria-label="Symptom onset time">${[15, 30, 60, 120].map(n => `<button type="button" class="choice choice--quiet" data-act="md-ago" data-m="${n}">${n < 60 ? n + ' min' : n / 60 + ' h'} ago</button>`).join('')}<button type="button" class="choice" data-act="md-approx" aria-pressed="${!!on.approx}">Approximate</button><span class="vline"></span>${nvBtns('onset', m.onset)}`)}
      </section>
      <section class="mdsec"><div class="mdsec__h"><h2>Vital signs</h2><span>If obtainable — otherwise choose Not obtained or Unable.</span></div>
        ${mdRow('bp', 'Blood pressure', `${num('sys', bp.nv ? '' : bp.sys, 'Systolic blood pressure')}<span class="sep">/</span>${num('dia', bp.nv ? '' : bp.dia, 'Diastolic blood pressure')}<span class="unit">mmHg</span><span class="vline"></span>${nvBtns('bp', m.bp)}`)}
        ${mdRow('hr', 'Heart rate', `${num('hr', m.hr && !m.hr.nv ? m.hr.v : '', 'Heart rate')}<span class="unit">bpm</span><span class="vline"></span>${nvBtns('hr', m.hr)}`)}
        ${mdRow('spo2', 'SpO₂', `${num('spo2', m.spo2 && !m.spo2.nv ? m.spo2.v : '', 'Oxygen saturation')}<span class="unit">%</span><span class="vline"></span>${nvBtns('spo2', m.spo2)}`)}
        ${mdRow('gcs', 'GCS', `${num('gcs', m.gcs && !m.gcs.nv ? m.gcs.v : '', 'Glasgow Coma Scale')}<span class="unit">3–15</span><span class="vline"></span>${nvBtns('gcs', m.gcs)}`)}
      </section>
      <section class="mdsec"><div class="mdsec__h"><h2>Crew and ECG</h2></div>
        <div class="mdrow"><div class="mdrow__l"><span class="label">Crew / unit</span></div><div class="ro">${esc(AU.unit || '')} · ${esc(ME)} <span class="small muted">(MDT login)</span></div></div>
        <div class="mdrow"><div class="mdrow__l"><span class="label">ECG acquisition</span></div><div class="ro">${e1}</div></div>
      </section></div>
      ${foot('ecg', `<button class="btn btn--primary btn--lg" data-act="md-done">Review${icon('arrow-right')}</button>`)}`;
  }
  /* the errors show once the crew pressed Review, and stay current as fields are fixed */
  function mdSync() {
    const d = S.draft; if (!d || d.step !== 'md') return;
    const E = mdErrors(d.md);
    FIELDS.forEach(f => {
      const el = $('#e-' + f.k), row = $('#f-' + f.k); if (!el) return;
      const show = S.mdTried && E[f.k];
      el.hidden = !show; el.innerHTML = show ? icon('alert') + `<span>${esc(E[f.k])}</span>` : '';
      row.classList.toggle('is-err', !!show);
      row.querySelectorAll('input').forEach(i => { if (show) i.setAttribute('aria-invalid', 'true'); else i.removeAttribute('aria-invalid'); });
    });
    const st = $$('.step')[2];
    if (st) { const b = st.querySelector('.step__t span'); if (b) b.textContent = `${answered(d.md)} of 8`; st.classList.toggle('is-done', !Object.keys(E).length); }
  }
  function mdInput(t) {
    const m = S.draft.md, k = t.dataset.md, v = t.value.trim(), at = now();
    const int = x => (x === '' || x == null || !Number.isFinite(Number(x)) ? null : Math.round(Number(x)));
    if (k === 'age') m.age = v === '' ? (m.age && m.age.est ? { v: null, est: true, at } : null) : { v: int(v), est: !!(m.age && m.age.est), at };
    else if (k === 'sys' || k === 'dia') {
      const s = int($('#md-sys').value.trim()), dd = int($('#md-dia').value.trim());
      m.bp = s == null && dd == null ? null : { sys: s, dia: dd, at };
    } else if (k === 'hr' || k === 'spo2' || k === 'gcs') m[k] = v === '' ? null : { v: int(v), at };
    else if (k === 'other') m.complaint = { k: 'oth', other: t.value, at };
    else if (k === 'onset') m.onset = v ? { t: fromClock(v, 5 * 60e3), approx: !!(m.onset && m.onset.approx), at } : null;
    const nvK = k === 'sys' || k === 'dia' ? 'bp' : k;
    if (NV[nvK]) $$(`[data-act="md-nv"][data-k="${nvK}"]`).forEach(b => b.setAttribute('aria-pressed', 'false'));
    saveLocal(); mdSync();
  }
  function mdClick(a, t) {
    const m = S.draft.md, k = t.dataset.k, v = t.dataset.v, at = now();
    if (a === 'md-nv') {
      const on = !(m[k] && m[k].nv === v);
      m[k] = on ? { nv: v, at } : null;
      $$(`[data-act="md-nv"][data-k="${k}"]`).forEach(b => b.setAttribute('aria-pressed', String(on && b.dataset.v === v)));
      if (on) {
        ({ age: ['md-age'], bp: ['md-sys', 'md-dia'], onset: ['md-onset'] }[k] || ['md-' + k]).forEach(id => { const i = document.getElementById(id); if (i) i.value = ''; });
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
  function vReview() {
    const d = S.draft, e = d.ecg, E = mdErrors(d.md), ok = d.cadOk && e.imgs.length && !Object.keys(E).length, s = d.send;
    const rows = FIELDS.map(f => `<dt>${f.l}</dt><dd>${d.md[f.k] && !E[f.k] ? (d.md[f.k].nv ? `<span class="nv">${esc(d.md[f.k].nv)}</span>` : `<span class="${['age', 'bp', 'hr', 'spo2', 'gcs'].includes(f.k) ? 'val' : ''}">${esc(mdText(f.k, d.md[f.k]))}</span>`) : `<span class="field-error">${icon('alert')}Missing</span>`}</dd>`).join('');
    let box;
    if (s && ['create', 'upload', 'submit'].includes(s.stage)) box = `<div class="sending" role="status" aria-live="polite"><div class="row"><span class="spinner"></span><b>${{ create: 'Creating the case under the CAD number…', upload: 'Uploading the ECG images…', submit: 'Sending to the ER…' }[s.stage]}</b></div><div id="send-pct">${sendPct()}</div></div>`;
    else if (s && (s.stage === 'queued' || s.stage === 'failed')) box = `<div class="sendbar" style="border-color:var(--warn-line);background:var(--warn-soft)" role="alert"><div class="sendbar__t"><b>${icon('wifi-off', 'ico-sm')} NOT SENT${s.stage === 'queued' ? ' — NO CONNECTION' : ''}</b><span class="small">${s.stage === 'queued' ? 'Saved on this tablet. It is sent automatically when the connection returns.' : esc(s.err || 'The case was not sent.')} If it cannot wait, use your STEMI downtime procedure (phone).</span></div><button class="btn btn--primary btn--xl" data-act="send"${S.up ? '' : ' disabled'}>${icon('send')}SEND AGAIN</button></div>`;
    else box = `<div class="sendbar"><div class="sendbar__t"><b>Send to the ER</b><span class="small muted">The ER is alerted at once. The Cardiologist is alerted only if an ER Doctor activates cardiology. After SEND the CAD number and the sent data are locked.</span></div><button class="btn btn--primary btn--xl" data-act="send"${ok ? '' : ' disabled'}>${icon('send')}SEND TO ER</button></div>`;
    return `<section class="card"><div class="card__h"><h2>4 · Review and send</h2></div><div class="card__b"><div class="review-list">
        <div class="stack-sm"><div class="overline">Case</div><dl class="kv"><dt>CAD</dt><dd>${d.cadOk ? `<span class="cad">CAD #${esc(d.cad)}</span>${d.cadChecked ? '' : '<span class="earlier">Checked for an existing case when you send</span>'}` : `<span class="field-error">${icon('alert')}Missing</span>`}</dd><dt>Crew / unit</dt><dd>${esc(AU.unit || '')} · ${esc(ME)}</dd><dt>ECG 1</dt><dd>acquired <span class="val">${e.imgs.length ? hms(e.acq) : '–'}</span> · ${e.imgs.length} image${e.imgs.length === 1 ? '' : 's'}</dd></dl>
          <div class="shots shots--sm">${e.imgs.map(x => shotHtml(e, x, 'draft', true)).join('')}</div></div>
        <div class="stack-sm"><div class="overline">Minimum data</div><dl class="kv">${rows}</dl></div></div></div></section>
      ${box}${foot('md', '')}`;
  }

  /* ---------- the live case ---------- */
  function vCase() {
    return `<div id="c-head"></div><div id="c-prog"></div><div class="ws"><div class="ws__main"><div id="c-status"></div><section class="card"><div class="card__h"><h2>ECGs</h2><span class="sp"></span><span id="c-ecgact"></span></div><div id="c-ecgs"></div></section>
      <section class="card"><div class="card__h"><h2>Timeline</h2></div><div class="card__b" id="c-tl"></div></section></div>
      <div class="ws__side"><section class="card"><div class="card__h"><h2>Patient and vital signs</h2><span class="sp"></span><span id="c-vitact"></span></div><div class="card__b" id="c-pt"></div></section>
      <div id="c-ai"></div></div></div>`;
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
      case 'sent_to_er': return P('tone-info', 'send', 'SENT TO ER', `Received by the platform at ${hm(r.sub.rcv)}. Waiting for an ER Doctor to accept the case.`);
      case 'er_reviewing': return P('tone-info', 'eye', 'ER DOCTOR REVIEWING', `<b>${esc(er.name)}</b> (ER Doctor) accepted the case at ${hm(er.accepted)} and is reviewing the ECG.`);
      case 'er_closed': return P('', 'lock', 'ER REVIEW COMPLETED / CARDIOLOGY NOT ACTIVATED', `ER Doctor assessment by ${esc(er.by || er.name)} at ${hm(er.at)}.`,
        `<dl class="kv" style="margin-top:6px"><dt>Reason</dt><dd>${esc(er.reason)}</dd>${er.comment ? `<dt>Comment</dt><dd>${esc(er.comment)}</dd>` : ''}</dl><p class="small muted">The STEMI screening pathway is closed and read-only. Continue standard care. The CAD incident itself is not changed.</p>`);
      case 'cardiology_activated': return P('tone-warn', 'bell', 'CARDIOLOGY ACTIVATED', `${er.assessment === 'uncertain' ? 'ER assessment: UNCERTAIN. ' : ''}${esc(er.by || er.name || 'The ER')} activated cardiology at ${hm(cd.activated)}. Waiting for the Cardiologist to acknowledge.`);
      case 'cardiologist_reviewing': return P('tone-info', 'eye', 'CARDIOLOGIST REVIEWING', `<b>${esc(cd.name || 'The Cardiologist')}</b> acknowledged the case at ${hm(cd.ack)}.`);
      case 'repeat_requested': return P('tone-warn', 'repeat', 'REPEAT ECG REQUESTED', `${esc(d.by)} (Cardiologist) at ${hm(d.at)} · on ECG ${d.on}.`,
        `${d.reasons.length || d.instr || d.within ? `<dl class="kv" style="margin-top:6px">${d.reasons.length ? `<dt>Reason</dt><dd>${esc(d.reasons.join(', '))}</dd>` : ''}${d.instr ? `<dt>Instruction</dt><dd>${esc(d.instr)}</dd>` : ''}${d.within ? `<dt>Within</dt><dd>${d.within} min</dd>` : ''}</dl>` : ''}
         <div class="btn-row"><button class="btn btn--primary btn--lg" data-act="ecg-new">${icon('ecg')}TAKE REPEAT ECG (ECG ${L.n + 1})</button></div><p class="small muted">COMPLETE STEMI PATHWAY becomes available only after CONFIRMED STEMI.</p>`);
      case 'repeat_received': return P('tone-info', 'eye', 'REPEAT ECG SENT — CARDIOLOGIST REVIEWING', `ECG ${L.n} received at ${hm(L.rcv)}. The Cardiologist reviews it and decides.`);
      case 'confirmed': return P('tone-crit-solid', 'alert', 'CONFIRMED STEMI', `Decision by ${esc(d.by)} (Cardiologist) at ${hm(d.at)} · on ECG ${d.on}.`,
        `${d.note ? `<p><b>Note:</b> ${esc(d.note)}</p>` : ''}<p class="small muted">When the STEMI pathway is finished for this case, press COMPLETE STEMI PATHWAY. Nothing more is documented here.</p><div class="btn-row"><button class="btn btn--secondary btn--lg" data-act="complete">${icon('check-circle')}COMPLETE STEMI PATHWAY</button></div>`);
      case 'not_stemi_closed': return P('', 'lock', 'NOT STEMI / PATHWAY CLOSED', d ? `Decision by ${esc(d.by)} (Cardiologist) at ${hm(d.at)}.` : '',
        `<dl class="kv" style="margin-top:6px">${d && d.reason ? `<dt>Reason</dt><dd>${esc(d.reason)}</dd>` : ''}${d && d.adv ? `<dt>Advice</dt><dd>${esc(d.adv)}</dd>` : ''}</dl><p class="small muted">The STEMI pathway closed automatically and is read-only. No cath-lab activation. Continue standard care. The CAD incident itself is not changed.</p>`);
      case 'completed': return P('tone-ok', 'check-circle', 'STEMI PATHWAY COMPLETED', `Completed by ${esc(r.closed.by)} at ${hm(r.closed.at)}. The case is read-only.`);
    }
    return '';
  }
  function ecgsHtml(r) {
    const closed = RULES.isClosed(r.state), pend = pendingFor(r.cad);
    const items = r.ecgs.map(e => {
      const pImgs = pend.filter(x => x.kind === 'img' && x.n === e.n), L = CLIN.latest(r);
      return `<div class="ecgitem"><div class="ecgitem__h"><b>ECG ${e.n}</b><span>acquired ${hms(e.acq)} · received ${hm(e.rcv)}${e.n === L.n && r.ecgs.length > 1 ? ' · latest' : ''}</span><span>${e.ai ? esc(CLIN.AIST[e.ai.st]) : 'AI analysis starting'}</span></div>
        <div class="shots">${e.imgs.map(x => `<div class="shot"><button class="shot__img" data-act="ecg-view" data-n="${e.n}" data-i="${x.i}" aria-label="ECG ${e.n}, Image ${x.i}: view full screen"><img src="${esc(x.url)}" alt="" loading="lazy"></button><div class="shot__t"><b>Image ${x.i}</b>${x.i === e.pri ? '<span class="tag tag--primary">Primary</span>' : ''}${x.after ? '<span class="tag">Added later</span>' : ''}<span class="muted">${hms(x.at)}</span></div></div>`).join('')}
          ${pImgs.map(x => `<div class="shot"><span class="shot__img"><img src="${esc(x.imgs[0].data)}" alt=""></span><div class="shot__t"><b>Image ${x.imgs[0].i}</b></div><span class="pendnote">${icon('upload')}${S.up ? 'Sending…' : 'Waiting to send'}</span></div>`).join('')}
          ${!closed && e.imgs.length + pImgs.length < MAXI ? `<div class="shot shot--add" style="min-height:150px"><button class="btn btn--secondary" data-act="img-add-sent" data-n="${e.n}">${icon('plus')}ADD ECG IMAGE</button><span class="xs subtle" style="text-align:center">Same ECG, another image</span></div>` : ''}</div></div>`;
    });
    pend.filter(x => x.kind === 'ecg').forEach(x => items.push(`<div class="ecgitem"><div class="ecgitem__h"><b>ECG ${x.n}</b><span>acquired ${hms(x.acq)}</span><span class="pendnote">${icon('upload')}${S.up ? 'Sending…' : 'Saved on this tablet — waiting to send'}</span></div><div class="shots">${x.imgs.map(y => `<div class="shot"><span class="shot__img"><img src="${esc(y.data)}" alt=""></span><div class="shot__t"><b>Image ${y.i}</b></div></div>`).join('')}</div></div>`));
    return items.join('') || `<div class="card__b">${empty('ecg', 'No ECG')}</div>`;
  }
  function vitHtml(r) {
    const pend = pendingFor(r.cad).filter(x => x.kind === 'op' && (x.op.k === 'md' || x.op.k === 'rec'));
    return `${CLIN.ptDetails(r)}${pend.length ? `<p class="pendnote" style="margin-top:12px">${icon('upload')}${pend.length} update${pend.length > 1 ? 's' : ''} saved on this tablet — ${S.up ? 'sending…' : 'waiting to send'}</p>` : ''}`;
  }
  function patchCase() {
    const r = cur();
    if (!r || S.view !== 'case') return;
    const closed = RULES.isClosed(r.state), L = CLIN.latest(r), pendE = pendingFor(r.cad).some(x => x.kind === 'ecg');
    patch('c-head', caseHead(r));
    patch('c-prog', CLIN.progress(r));
    patch('c-status', statusPanel(r));
    patch('c-ecgact', closed || pendE || r.state === 'draft' || r.state === 'repeat_requested' ? '' : `<button class="btn btn--sm btn--primary" data-act="ecg-new">${icon('plus')}NEW ECG (ECG ${L ? L.n + 1 : 1})</button>`);
    patch('c-ecgs', ecgsHtml(r));
    patch('c-vitact', closed || r.state === 'draft' ? '' : `<div class="btn-row" style="gap:6px"><button class="btn btn--sm btn--secondary" data-act="vitals">${icon('plus')}Vital signs</button><button class="btn btn--sm btn--secondary" data-act="treat">${icon('plus')}Treatment</button></div>`);
    patch('c-pt', vitHtml(r));
    patch('c-ai', L ? CLIN.aiPanel(L) : '');
    patch('c-tl', CLIN.timelineHtml(r));
    CLIN.updateFull(r);
  }
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
      ${d.k === 'repeat' ? `${d.reasons.length ? `<p><b>Reason:</b> ${esc(d.reasons.join(', '))}</p>` : ''}${d.instr ? `<p><b>Instruction:</b> ${esc(d.instr)}</p>` : ''}${d.within ? `<p><b>Within:</b> ${d.within} min</p>` : ''}<p class="muted">Take ECG ${CLIN.latest(r).n + 1} and send it: it reaches the Cardiologist silently.</p>` : ''}
      ${d.k === 'confirm' ? `${d.note ? `<p><b>Note:</b> ${esc(d.note)}</p>` : ''}<p class="muted">COMPLETE STEMI PATHWAY is now available on the case.</p>` : ''}`;
    modal.open(dlg(title, body, `<button class="btn ${d.k === 'confirm' ? 'btn--critical' : 'btn--primary'} btn--lg" data-act="dec-ack" data-cad="${esc(r.cad)}" data-id="${esc(d.id)}">${icon('check')}ACKNOWLEDGE</button>`, { over: 'Cardiologist decision', noClose: true }), { cls, locked: true, alert: true, focus: '[data-act="dec-ack"]' });
  }
  function erModal(r) {
    modal.open(dlg('ER REVIEW COMPLETED / CARDIOLOGY NOT ACTIVATED', `<div class="confirm-box"><span class="cad">CAD #${esc(r.cad)}</span><span class="muted">ER Doctor assessment by ${esc(r.er.by || r.er.name)} at ${hm(r.er.at)}</span></div>
      <dl class="kv"><dt>Reason</dt><dd>${esc(r.er.reason)}</dd>${r.er.comment ? `<dt>Comment</dt><dd>${esc(r.er.comment)}</dd>` : ''}</dl>
      <p class="muted">The STEMI screening pathway is closed and read-only. Continue standard care. The CAD incident itself is not changed.</p>`,
      `<button class="btn btn--primary btn--lg" data-act="er-ack" data-cad="${esc(r.cad)}">${icon('check')}ACKNOWLEDGE</button>`, { over: 'ER review', noClose: true }), { locked: true, alert: true, focus: '[data-act="er-ack"]' });
  }

  /* ---------- after SEND: vital signs, treatments, serial ECGs, completing ---------- */
  function vitalsDialog() {
    const r = cur(); if (!r) return;
    const row = (k, label, inner) => `<div class="mdrow" id="v-f-${k}"><div class="mdrow__l"><span class="label" id="v-l-${k}">${label}</span></div><div class="mdrow__c" role="group" aria-labelledby="v-l-${k}">${inner}<span class="field-error" id="v-e-${k}" hidden></span></div></div>`;
    const n = (id, label) => `<input class="input input--num" id="${id}" inputmode="numeric" maxlength="3" autocomplete="off" aria-label="${label}" style="width:90px">`;
    modal.open(dlg('Update vital signs', `<p class="muted">New readings are added with the time now; earlier readings are kept. Fill in only what was measured.</p>
      <div class="mdsec">${row('bp', 'Blood pressure', `${n('v-sys', 'Systolic')}<span class="sep">/</span>${n('v-dia', 'Diastolic')}<span class="unit">mmHg</span>`)}${row('hr', 'Heart rate', `${n('v-hr', 'Heart rate')}<span class="unit">bpm</span>`)}${row('spo2', 'SpO₂', `${n('v-spo2', 'SpO2')}<span class="unit">%</span>`)}${row('gcs', 'GCS', `${n('v-gcs', 'GCS')}<span class="unit">3–15</span>`)}</div>
      <span class="field-error" id="v-err" hidden></span>`, `<button class="btn btn--secondary" data-act="modal-close">Cancel</button><button class="btn btn--primary btn--lg" data-act="vitals-save">Add readings</button>`, { over: `CAD #${r.cad}` }), { cls: 'modal--wide', focus: '#v-sys' });
  }
  function vitalsSave() {
    const r = cur(), root = modal.el(), g = id => { const v = root.querySelector('#' + id).value.trim(); return v === '' ? null : Math.round(Number(v)); }, at = now();
    const vals = { sys: g('v-sys'), dia: g('v-dia'), hr: g('v-hr'), spo2: g('v-spo2'), gcs: g('v-gcs') }, md = {}, errs = {};
    if (vals.sys != null || vals.dia != null) md.bp = { sys: vals.sys, dia: vals.dia, at };
    ['hr', 'spo2', 'gcs'].forEach(k => { if (vals[k] != null) md[k] = { v: vals[k], at }; });
    const E = mdErrors(md);
    Object.keys(md).forEach(k => { if (E[k]) errs[k] = E[k]; });
    ['bp', 'hr', 'spo2', 'gcs'].forEach(k => { const el = root.querySelector('#v-e-' + k); el.hidden = !errs[k]; el.innerHTML = errs[k] ? icon('alert') + `<span>${esc(errs[k])}</span>` : ''; });
    const ve = root.querySelector('#v-err');
    ve.hidden = !!Object.keys(md).length; ve.innerHTML = Object.keys(md).length ? '' : icon('alert') + '<span>Enter at least one reading.</span>';
    if (!Object.keys(md).length || Object.keys(errs).length) return;
    Object.entries(md).forEach(([k, a]) => queue({ kind: 'op', cad: r.cad, op: op(r.cad, 'md', { k, v: mdText(k, a), raw: a, at, kind: 'update' }) }));
    modal.close();
    toast(S.up ? 'Vital signs sent: the ER and the Cardiologist see them silently' : 'Vital signs saved on this tablet: sent when the connection returns');
  }
  function treatDialog() {
    const r = cur(); if (!r) return;
    TD = { k: null, opt: null };
    modal.open(dlg('Treatment update', `<p class="muted">Shown silently to the ER and the Cardiologist; earlier entries are kept. Not the ePCR: document fully in the ePCR as usual.</p>
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
      <div class="field"><label class="label" for="t-time">Time given</label><input class="input input--time" id="t-time" type="time" value="${hhmm(now())}" style="width:150px"></div>` : ''}`);
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
  /* a serial ECG (ECG 2, 3 …), for example the repeat ECG the Cardiologist asked for */
  function ecgNew() {
    const r = cur(); if (!r) return;
    const n = CLIN.latest(r).n + 1;
    if (!S.ecgd[r.cad] || S.ecgd[r.cad].n !== n) S.ecgd[r.cad] = { n, imgs: [], acq: null, acqSet: false, acqWhy: '', variant: null };
    saveLocal(true); ecgPanel();
  }
  function ecgPanel() {
    const r = cur(), e = r && S.ecgd[r.cad]; if (!e) return modal.close();
    const rep = r.state === 'repeat_requested';
    modal.open(dlg(`${rep ? 'Repeat ECG' : 'New ECG'} · ECG ${e.n}`, `<p class="muted">A new recording of the 12-lead ECG, added to the case as ECG ${e.n}. ECG ${e.n - 1} and earlier stay unchanged.${rep ? ' The Cardiologist asked for it.' : ''}</p>
      ${e.imgs.length ? `<p class="small">Acquired <b class="mono">${hms(e.acq)}</b>${e.acqSet ? ' (set by the crew)' : ' (first image)'} · <button type="button" class="link-btn" data-act="acq" data-where="${esc(r.cad)}">change</button></p>` : ''}
      <div id="ecgd-shots">${shotsHtml(e, r.cad)}</div>`,
      `<button class="btn btn--secondary" data-act="modal-close">Close (kept on this tablet)</button><button class="btn btn--primary btn--lg" data-act="ecg-send"${e.imgs.length ? '' : ' disabled'}>${icon('send')}SEND ECG ${e.n}</button>`, { over: `CAD #${r.cad}` }), { cls: 'modal--wide' });
  }
  function ecgSend() {
    const r = cur(), e = r && S.ecgd[r.cad]; if (!e || !e.imgs.length) return;
    const n = CLIN.latest(r).n + 1;
    if (e.n !== n) e.n = n;
    queue({ kind: 'ecg', id: `ecg-${r.cad}-${e.n}-${rid()}`, cad: r.cad, n: e.n, acq: e.acq, acqWhy: e.acqSet ? e.acqWhy : '', variant: e.variant || variantFor(e.n), sendAt: now(), imgs: e.imgs.map(x => ({ ...x })) });
    delete S.ecgd[r.cad]; saveLocal(true); modal.close();
    toast(S.up ? `ECG ${e.n} sending: the ER and the Cardiologist get it silently` : `ECG ${e.n} saved on this tablet: sent when the connection returns`);
  }
  /* an image added to an ECG already sent: uploaded, then linked to that ECG as its next image (nothing is replaced) */
  function addImageSent(n) {
    const r = cur(), e = r && r.ecgs.find(x => x.n === n); if (!e) return;
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

  /* ---------- rendering ---------- */
  function setMain(key, html) { const m = $('#main'); if (S.main !== key) { m.innerHTML = html; m._h = null; S.main = key; return true; } return false; }
  function render() {
    patch('top', top());
    patch('banner', banner());
    if ((S.view === 'case' || S.view === 'summary') && !cur()) S.view = 'home';
    if (S.view === 'draft' && !S.draft) S.view = 'home';
    if (S.view === 'home') { setMain('home', vHome()); patchHome(); }
    else if (S.view === 'draft') {
      const d = S.draft, key = 'draft:' + d.step;
      /* the minimum data form is drawn once per visit, so typing is never interrupted */
      if (d.step === 'md') { if (setMain(key, vDraft())) mdSync(); }
      else { setMain(key, ''); if (!(document.activeElement && document.activeElement.id === 'cadin')) patch('main', vDraft()); }
    } else if (S.view === 'case') { setMain('case:' + S.cad, vCase()); patchCase(); }
    else if (S.view === 'summary') { setMain('sum:' + S.cad, ''); patch('main', vSummary(cur())); }
    outcomes();
  }
  /* after an image was added or removed, redraw the step (not the minimum data form, which keeps what is typed) */
  function rerender() { if (S.view === 'draft' && S.draft && S.draft.step !== 'md') S.main = ''; render(); }
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
    if (a.startsWith('md-') && a !== 'md-done') return S.draft && mdClick(a, t);
    switch (a) {
      case 'home': return go('home');
      case 'logout': return window.logout();
      case 'new-case':
        if (S.draft) return modal.open(dlg('An unsent case is open', `<p>${S.draft.cad ? `<span class="cad">CAD #${esc(S.draft.cad)}</span> was` : 'A case was'} started on this tablet and not sent. Continue it, or discard it and start a new case.</p>`, '<button class="btn btn--danger-quiet" data-act="draft-discard">Discard it</button><button class="btn btn--primary" data-act="draft-open">Continue the unsent case</button>', { over: 'NEW STEMI CASE' }));
        S.draft = newDraft(); saveLocal(true); go('draft'); setTimeout(() => { const i = $('#cadin'); if (i) i.focus(); }, 30); return;
      case 'draft-open': modal.close(); return go('draft');
      case 'draft-discard': return discardDraft();
      case 'draft-discard-go': S.draft = null; saveLocal(true); modal.close(); go('home'); return toast('Unsent case discarded');
      case 'step': return goStep(d.k);
      case 'cad-ok': return cadContinue();
      case 'dup-fix': modal.close(); if (S.draft) { S.draft.cadOk = false; S.draft.step = 'cad'; saveLocal(true); } go('draft'); setTimeout(() => { const i = $('#cadin'); if (i) { i.focus(); i.select(); } }, 30); return;
      case 'dup-open': return openExisting(d.cad);
      case 'md-done': {
        S.mdTried = true; mdSync();
        const E = mdErrors(S.draft.md), k = Object.keys(E)[0];
        if (k) { const f = $(`#f-${k} input:not([hidden]), #f-${k} button`); if (f) f.focus(); return toast(`${Object.keys(E).length} item${Object.keys(E).length > 1 ? 's' : ''} still need an answer.`, 'err'); }
        return goStep('review');
      }
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
        if (d.where === 'draft') { modal.close(); return rerender(); }
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
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    if (t.tagName === 'A') e.preventDefault();
    act(t.dataset.act, t);
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'hq') { S.histQ = t.value; clearTimeout(hT); hT = setTimeout(loadHist, 250); return; }
    if (t.dataset && t.dataset.md && S.draft) return mdInput(t);
    if (t.id === 'cadin' && S.draft) {
      S.draft.cadIn = t.value; S.draft.cadOk = false;
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
        /* the test data was reset: anything waiting for a case that no longer exists is dropped; the unsent case stays */
        if (S.epoch && S.epoch !== m.epoch) { S.out = []; S.ecgd = {}; S.cases.clear(); S.hist = null; S.histAsked = false; if (S.draft) S.draft.send = null; if (S.view !== 'draft') S.view = 'home'; }
        S.epoch = m.epoch; saveLocal(); return;
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
      case 'net':
        S.up = m.up;
        if (S.up) { pump(); if (S.draft && S.draft.send && S.draft.send.stage === 'queued') setTimeout(sendDraft, 300); }
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
})();
