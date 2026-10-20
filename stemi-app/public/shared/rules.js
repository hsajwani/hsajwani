/* The STEMI pathway's shared rules, as every screen uses them for instant feedback and wording. The server's rules are
   the authority (C#, src/Masar.Domain: Rules/ClinicianName.cs, Rules/ErAssessmentRules.cs, Pathway/*): keep both in
   step (the LEGACY Node.js server also loads this file).
   - the clinician's name (prototype identification only: a typed name, NOT authentication)
   - the ER Doctor's reasons for NOT SUSPICIOUS FOR STEMI
   - the pathway states and how each screen words them
   No clinical criteria live here: the platform never decides anything clinical. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RULES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- the clinician's name ---------- */
  const NAME_MIN = 2, NAME_MAX = 80, TEXT_MAX = 500;
  /* trimmed, inner spaces collapsed, no control characters, 2 to 80 characters, at least one letter */
  function cleanName(input) {
    const s = String(input == null ? '' : input).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return { ok: false, name: '', error: 'Enter your name.' };
    if (s.length < NAME_MIN) return { ok: false, name: s, error: `Enter your full name (at least ${NAME_MIN} characters).` };
    if (s.length > NAME_MAX) return { ok: false, name: s, error: `The name is too long (at most ${NAME_MAX} characters).` };
    if (!/\p{L}/u.test(s)) return { ok: false, name: s, error: 'Enter a name that contains letters.' };
    return { ok: true, name: s };
  }
  /* free text: control characters removed (line breaks kept), trimmed, at most 500 characters */
  const cleanText = (input, max) => String(input == null ? '' : input).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max || TEXT_MAX);

  /* ---------- ER Doctor: NOT SUSPICIOUS FOR STEMI needs a reason ---------- */
  const ER_REASONS = [
    { k: 'criteria', label: 'ECG DOES NOT MEET STEMI CRITERIA' },
    { k: 'alternative', label: 'ALTERNATIVE DIAGNOSIS SUSPECTED' },
    { k: 'not-acute', label: 'ECG CHANGES NOT CONSISTENT WITH ACUTE STEMI' },
    { k: 'clinical', label: 'CLINICAL PRESENTATION NOT CONSISTENT WITH STEMI' },
    { k: 'quality', label: 'POOR ECG QUALITY — NOT DIAGNOSTIC' },
    { k: 'other', label: 'OTHER' }
  ];
  const erReason = k => ER_REASONS.find(r => r.k === k) || null;
  /* → { ok, reason (label), comment } or { ok:false, field:'reason'|'comment', error } */
  function checkNotSuspicious(reasonKey, comment) {
    const r = erReason(reasonKey);
    if (!r) return { ok: false, field: 'reason', error: 'Select the reason why cardiology is not activated.' };
    const c = cleanText(comment);
    if (r.k === 'other' && !c) return { ok: false, field: 'comment', error: 'OTHER needs an explanation: describe the reason.' };
    return { ok: true, reason: r.label, comment: c };
  }

  /* ---------- the pathway states (the server derives the state: src/Masar.Domain/Pathway/PathwayStateMachine.cs) ----------
     tone: crit (urgent / confirmed STEMI) · warn (uncertain, pending) · ok (completed) · info (in progress) · neutral */
  const STATES = {
    draft: { crew: ['DRAFT — NOT SENT', 'neutral'] },
    sent_to_er: { crew: ['SENT TO ER', 'info'], er: ['NEW — AWAITING ACCEPTANCE', 'crit'], cardiologist: ['AT ER — CARDIOLOGY NOT ACTIVATED', 'neutral'] },
    er_reviewing: { crew: ['ER DOCTOR REVIEWING', 'info'], er: ['ER REVIEW IN PROGRESS', 'info'], cardiologist: ['AT ER — CARDIOLOGY NOT ACTIVATED', 'neutral'] },
    er_closed: { crew: ['ER REVIEW COMPLETED — CARDIOLOGY NOT ACTIVATED', 'neutral'], er: ['CARDIOLOGY NOT ACTIVATED — CLOSED', 'neutral'], cardiologist: ['CARDIOLOGY NOT ACTIVATED', 'neutral'] },
    cardiology_activated: { crew: ['CARDIOLOGY ACTIVATED', 'warn'], er: ['CARDIOLOGY ACTIVATED — AWAITING CARDIOLOGIST', 'warn'], cardiologist: ['NEW CARDIOLOGY ACTIVATION', 'crit'] },
    cardiologist_reviewing: { crew: ['CARDIOLOGIST REVIEWING', 'info'], er: ['CARDIOLOGIST REVIEWING', 'info'], cardiologist: ['REVIEW IN PROGRESS', 'info'] },
    repeat_requested: { crew: ['REPEAT ECG REQUESTED', 'warn'], er: ['REPEAT ECG REQUESTED', 'warn'], cardiologist: ['REPEAT ECG REQUESTED', 'warn'] },
    repeat_received: { crew: ['REPEAT ECG SENT — CARDIOLOGIST REVIEWING', 'info'], er: ['REPEAT ECG RECEIVED — CARDIOLOGIST REVIEWING', 'info'], cardiologist: ['REPEAT ECG RECEIVED — REVIEW', 'warn'] },
    confirmed: { crew: ['CONFIRMED STEMI', 'crit-solid'], er: ['CONFIRMED STEMI', 'crit-solid'], cardiologist: ['CONFIRMED STEMI', 'crit-solid'] },
    not_stemi_closed: { crew: ['NOT STEMI — PATHWAY CLOSED', 'neutral'], er: ['NOT STEMI — PATHWAY CLOSED', 'neutral'], cardiologist: ['NOT STEMI — PATHWAY CLOSED', 'neutral'] },
    completed: { crew: ['STEMI PATHWAY COMPLETED', 'ok'], er: ['STEMI PATHWAY COMPLETED', 'ok'], cardiologist: ['STEMI PATHWAY COMPLETED', 'ok'] }
  };
  const CLOSED = ['er_closed', 'not_stemi_closed', 'completed'];
  const ACTIVATED = ['cardiology_activated', 'cardiologist_reviewing', 'repeat_requested', 'repeat_received', 'confirmed'];
  /* [label, tone] of a state as a screen shows it */
  function label(state, role) {
    const s = STATES[state] || STATES.draft;
    return s[role] || s.crew || ['UNKNOWN', 'neutral'];
  }
  const isClosed = st => CLOSED.includes(st);

  /* the cardiologist's decisions (unchanged since 0.4) */
  const DECISIONS = { confirm: 'CONFIRMED STEMI', not: 'NOT STEMI', repeat: 'UNCLEAR — REPEAT ECG REQUESTED' };
  const ER_ASSESSMENTS = { activate: 'ACTIVATE CARDIOLOGIST', uncertain: 'UNCERTAIN — ACTIVATE CARDIOLOGIST', not_suspicious: 'NOT SUSPICIOUS FOR STEMI' };

  return { NAME_MAX, TEXT_MAX, cleanName, cleanText, ER_REASONS, erReason, checkNotSuspicious, STATES, CLOSED, ACTIVATED, label, isClosed, DECISIONS, ER_ASSESSMENTS };
});
