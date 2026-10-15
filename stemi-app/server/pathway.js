/* The STEMI pathway's state machine. The server is the authority: every action from a screen is checked here before
   it is stored, and the state each screen shows is derived here from the stored record.

   DRAFT → SENT TO ER → ER REVIEWING → either
     ER REVIEW COMPLETED — CARDIOLOGY NOT ACTIVATED (closed), or
     CARDIOLOGY ACTIVATED → CARDIOLOGIST REVIEWING → one of
       CONFIRMED STEMI (active) → COMPLETE STEMI PATHWAY → COMPLETED (closed)
       NOT STEMI → PATHWAY CLOSED (closed automatically)
       REPEAT ECG REQUESTED → repeat ECG received → CARDIOLOGIST REVIEWING → next decision

   The STEMI pathway status is not the ICCC / CAD incident status: closing the pathway never changes the CAD incident.
   Cases made before 0.5.0 went straight to the cardiologist (no ER step): they are read as already cardiology-activated. */
const RULES = require('../public/shared/rules.js');

/* the three ways a STEMI pathway closes */
const CLOSE = {
  er: { reason: 'ER Doctor assessment: NOT SUSPICIOUS FOR STEMI', source: 'ER Doctor screening decision', kind: 'er-not-activated' },
  not: { reason: 'Cardiologist decision: NOT STEMI', source: 'automatic following Cardiologist decision', kind: 'not-stemi' },
  crew: { reason: 'STEMI pathway completed', source: 'crew', kind: 'completed' }
};
const closedKind = C => (C.closure_reason === CLOSE.er.reason ? CLOSE.er.kind : C.closure_reason === CLOSE.not.reason ? CLOSE.not.kind : CLOSE.crew.kind);

/* F: { C (cases row), activated, acked, lastDec, nEcg } → state */
function state(F) {
  const C = F.C;
  if (C.closed_at) return { 'er-not-activated': 'er_closed', 'not-stemi': 'not_stemi_closed', completed: 'completed' }[closedKind(C)];
  if (!C.server_received_at) return 'draft';
  if (!F.activated) return C.er_accepted_at ? 'er_reviewing' : 'sent_to_er';
  if (!F.acked) return 'cardiology_activated';
  const d = F.lastDec;
  if (!d) return 'cardiologist_reviewing';
  if (d.kind === 'confirm') return 'confirmed';
  if (d.kind === 'repeat') return F.nEcg > (d.on_ecg || 0) ? 'repeat_received' : 'repeat_requested';
  return 'cardiologist_reviewing';
}

/* what a closed (read-only) case still accepts: viewing it, and confirming a decision or outcome has been seen */
const READ_ONLY_OK = new Set(['viewed', 'seen', 'compare', 'decrcv', 'decack', 'erack', 'hopen', 'er_shown', 'shown']);
const CREW_AFTER_SEND = new Set(['ecg', 'img', 'md', 'rec', 'note', 'hopen', 'decrcv', 'decack', 'erack']);

/* null when the action is allowed in this state, otherwise the reason it is refused */
function guard(role, k, F) {
  const st = F.state;
  if (RULES.isClosed(st) && !READ_ONLY_OK.has(k)) return 'This STEMI pathway is closed: it is read-only.';
  if (role === 'crew') {
    if (CREW_AFTER_SEND.has(k) && st === 'draft') return 'Send the case before adding to it.';
    return null;
  }
  if (role === 'er') {
    if (st === 'draft') return 'This case has not been sent to the ER.';
    if (k === 'er_assess') {
      if (st === 'sent_to_er') return 'Accept the case before recording the ER assessment.';
      if (st !== 'er_reviewing') return 'The ER assessment for this case is already recorded.';
    }
    return null;
  }
  if (role === 'cardiologist') {
    if (!F.activated) return 'Cardiology has not been activated for this case: no cardiologist action can be recorded.';
    if (k === 'decision' && st === 'cardiology_activated') return 'Acknowledge the case before recording a decision.';
    return null;
  }
  return 'This is not an action for this screen.';
}

module.exports = { CLOSE, closedKind, state, guard, READ_ONLY_OK };
