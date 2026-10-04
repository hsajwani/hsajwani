/* The CAD number: entered manually by the crew (EMT) from the MDT / dispatch information.
   One module for the crew tablet and the server, so both normalise and check the number the same way.
   Canonical stored format: YYYYMMDD-NNNN-N (for example 20261004-0123-1), the format already used in the database.
   Shown on every screen as "CAD #20261004-0123-1".
   Accepted input: "CAD#20261004-0123-1", "cad # 20261004-0123-1", " 20261004-0123-1 ", "2026100401231".
   The real CAD format is an open decision (Q-51); change PATTERN here and both sides follow. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CADN = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PATTERN = /^(\d{4})(\d{2})(\d{2})-(\d{4})-(\d{1,3})$/;
  const EXAMPLE = '20261004-0123-1';
  const MSG = 'Enter a valid CAD number before continuing.';

  /* trim, drop every space, drop a leading "CAD" / "CAD#" / "#" in any case, unify dashes */
  function normalize(input) {
    let s = String(input == null ? '' : input).replace(/\s+/g, '').replace(/[‐-―−]/g, '-');
    s = s.replace(/^cad#?/i, '').replace(/^#/, '');
    /* typed without dashes on a numeric keypad: 8 + 4 + 1 digits */
    if (/^\d{13}$/.test(s)) s = `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12)}`;
    return s.toUpperCase();
  }

  /* → { ok: true, cad } or { ok: false, cad, error, detail } */
  function check(input) {
    const cad = normalize(input);
    if (!cad) return { ok: false, cad, error: MSG, detail: 'The CAD number is empty.' };
    const m = PATTERN.exec(cad);
    const bad = { ok: false, cad, error: MSG, detail: `Incomplete or not a CAD number. Expected format: ${EXAMPLE}` };
    if (!m) return bad;
    const mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return { ...bad, detail: `The date part ${m[1]}${m[2]}${m[3]} is not a valid date. Expected format: ${EXAMPLE}` };
    return { ok: true, cad };
  }

  const display = cad => 'CAD #' + cad;

  return { normalize, check, display, EXAMPLE, MSG };
});
