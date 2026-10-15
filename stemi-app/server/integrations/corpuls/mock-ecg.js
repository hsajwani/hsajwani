/* Synthetic 12-lead ECGs for the simulated corpuls feed (MockCorpulsProvider). FICTIONAL, NOT A PATIENT ECG.
   Drawn here as an SVG (a digital transmission, not a photo of a printout): 3 × 4 leads and a lead II rhythm strip at
   25 mm/s and 10 mm/mV, on ECG paper, marked as simulated test data. The waveform model is the one of the crew's
   fictional test ECG generator (public/shared/ecg.js), so every test ECG in the build looks alike.
   The samples are labelled internally (ECG Sample A / B / C) and are not a validated diagnosis of anything: they only
   give the scripted mock AI something to describe. */

/* internal test samples → waveform variant (the mock AI's scripted findings follow the variant) */
const SAMPLES = {
  A: { label: 'ECG Sample A', variant: 'border' },
  B: { label: 'ECG Sample B', variant: 'evolved' },
  C: { label: 'ECG Sample C', variant: 'clear' }
};
/* Sample C after an earlier ECG in the same case uses the variant scripted for a later ECG */
const variantOf = (sample, n) => (sample === 'C' && n > 1 ? 'clear2' : (SAMPLES[sample] || SAMPLES.A).variant);

const W = 2160, H = 1180, PX = 8, X0 = 110, SPS = 25 * PX, MV = 10 * PX, ROWS = [292, 542, 792, 1042], STEP = 0.004;
const GRID_TOP = 100, GRID_BOTTOM = 1128;
const LAY = [['I', 'aVR', 'V1', 'V4'], ['II', 'aVL', 'V2', 'V5'], ['III', 'aVF', 'V3', 'V6']];
const BASE = {
  I: { p: .10, q: -.04, r: .70, s: -.10, t: .26 }, II: { p: .15, q: -.05, r: 1.05, s: -.18, t: .16 }, III: { p: .06, q: -.03, r: .45, s: -.24, t: .02 },
  aVR: { p: -.12, q: .03, r: -.78, s: .10, t: -.22 }, aVL: { p: .03, q: -.05, r: .46, s: -.26, t: .20 }, aVF: { p: .10, q: -.04, r: .74, s: -.21, t: .06 },
  V1: { p: .07, q: 0, r: .20, s: -.95, t: .14 }, V2: { p: .08, q: 0, r: .38, s: -1.12, t: .52 }, V3: { p: .08, q: 0, r: .60, s: -.78, t: .60 },
  V4: { p: .08, q: -.03, r: .95, s: -.48, t: .56 }, V5: { p: .08, q: -.05, r: 1.12, s: -.27, t: .42 }, V6: { p: .08, q: -.06, r: .94, s: -.14, t: .28 }
};
const VAR = {
  clear: { hr: 84, st: { I: .10, II: -.11, III: -.17, aVR: 0, aVL: .12, aVF: -.15, V1: .12, V2: .30, V3: .40, V4: .34, V5: .21, V6: .06 } },
  border: { hr: 84, st: { I: .03, II: -.02, III: -.03, aVR: 0, aVL: .04, aVF: -.02, V1: .04, V2: .10, V3: .12, V4: .12, V5: .04, V6: .01 }, t: { V2: .64, V3: .74, V4: .68 } },
  evolved: { hr: 92, st: { I: .06, II: -.05, III: -.12, aVR: 0, aVL: .07, aVF: -.10, V1: .05, V2: .14, V3: .32, V4: .30, V5: .12, V6: .03 }, t: { V2: .60, V3: .70, V4: .64 } },
  clear2: { hr: 88, st: { I: .11, II: -.12, III: -.18, aVR: 0, aVL: .13, aVF: -.16, V1: .12, V2: .32, V3: .42, V4: .36, V5: .22, V6: .07 } }
};
/* the drawing stays readable from 40 to 150 /min */
const rateOf = (hr, dflt) => (Number.isFinite(hr) ? Math.max(40, Math.min(150, Math.round(hr))) : dflt);
const sig = x => 1 / (1 + Math.exp(-x));
function beat(d, p) {
  const g = (m, s, a) => a * Math.exp(-0.5 * ((d - m) / s) ** 2);
  let v = g(0.085, 0.024, p.p) + g(0.178, 0.0085, p.q) + g(0.2, 0.0115, p.r) + g(0.226, 0.0105, p.s);
  v += p.t * Math.exp(-0.5 * ((d - 0.45) / (d < 0.45 ? 0.062 : 0.042)) ** 2);
  v += p.st * sig((d - 0.242) / 0.006) * sig((0.47 - d) / 0.028);
  return v;
}

const p2 = n => String(n).padStart(2, '0');
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const stamp = t => { const d = new Date(t); return `${p2(d.getDate())}-${MON[d.getMonth()]}-${d.getFullYear()}  ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
/* a coordinate step in tenths of a pixel, written as short as SVG allows */
const tenth = n => { const s = (n / 10).toString(); return s.replace(/^(-?)0\./, '$1.'); };

/* render(variant, acquiredAt, hr) → SVG text. hr: the heart rate the monitor measured at acquisition (the sample's own
   rate when not given); the sample decides the morphology only */
function render(variant, acq, hr) {
  const base = VAR[variant] || VAR.border, cfg = { ...base, hr: rateOf(hr, base.hr) }, RR = 60 / cfg.hr, on = [];
  for (let t = 0.16, k = 0; t < 10.8; k++) { on.push(t); t += RR + Math.sin(k * 1.7 + (acq % 7)) * 0.012; }
  const lp = ld => ({ ...BASE[ld], st: cfg.st[ld] || 0, t: cfg.t && cfg.t[ld] != null ? cfg.t[ld] : BASE[ld].t });
  /* a monitor's digital ECG: little baseline wander or noise */
  const volt = (ld, t, p) => {
    let s = 0;
    for (const o of on) { const d = t - o; if (d > -0.1 && d < 0.8) s += beat(d, p); }
    return s + 0.012 * Math.sin(2 * Math.PI * 0.23 * t + ld.length) + 0.003 * Math.sin(t * 913.7 + ld.length * 7.1) * Math.sin(t * 377.3);
  };
  const trace = (ld, t1, t2, y) => {
    const p = lp(ld), n = Math.round((t2 - t1) / STEP);
    let d = '', px = 0, py = 0;
    for (let k = 0; k <= n; k++) {
      const t = t1 + k * STEP, x = Math.round((X0 + t * SPS) * 10), yy = Math.round((y - volt(ld, t, p) * MV) * 10);
      if (k === 0) d += `M${x / 10} ${yy / 10}`;
      else { const dy = tenth(yy - py); d += `l${tenth(x - px)}${dy.startsWith('-') ? '' : ' '}${dy}`; }
      px = x; py = yy;
    }
    return `<path d="${d}"/>`;
  };
  const cal = y => `<path d="M34 ${y}H50V${y - MV}H90V${y}H${X0}"/>`;
  const label = (ld, t1, y) => `<text x="${X0 + t1 * SPS + 12}" y="${y - 92}">${ld}</text>`;
  const out = [];
  for (let r = 0; r < 3; r++) {
    out.push(cal(ROWS[r]));
    for (let k = 0; k < 4; k++) {
      const ld = LAY[r][k], t1 = k * 2.5;
      out.push(trace(ld, t1, t1 + 2.5, ROWS[r]));
      out.push(label(ld, t1, ROWS[r]));
      if (k) out.push(`<path d="M${X0 + t1 * SPS} ${ROWS[r] - 20}V${ROWS[r] + 20}"/>`);
    }
  }
  out.push(cal(ROWS[3]), trace('II', 0, 10, ROWS[3]), label('II', 0, ROWS[3]));
  const traces = out.filter(s => s.startsWith('<path')).join(''), labels = out.filter(s => s.startsWith('<text')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fictional simulated 12-lead ECG">
<defs><pattern id="s" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M8 0H0V8" fill="none" stroke="#efb2aa" stroke-width="1"/></pattern>
<pattern id="b" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="url(#s)"/><path d="M40 0H0V40" fill="none" stroke="#dc7d74" stroke-width="1.6"/></pattern></defs>
<rect width="${W}" height="${H}" fill="#ffffff"/><rect y="${GRID_TOP}" width="${W}" height="${GRID_BOTTOM - GRID_TOP}" fill="#fff7f5"/><rect y="${GRID_TOP}" width="${W}" height="${GRID_BOTTOM - GRID_TOP}" fill="url(#b)"/>
<g font-family="'Courier New',Courier,monospace" fill="#1b1b1b">
<text x="40" y="42" font-size="26" font-weight="700">12-LEAD ECG · SIMULATED MONITOR TRANSMISSION</text><text x="${W - 40}" y="42" font-size="24" font-weight="700" text-anchor="end" fill="#9a2a1f">FICTIONAL TEST DATA · NOT A PATIENT</text>
<text x="40" y="82" font-size="28" font-weight="700">${stamp(acq)}</text><text x="640" y="82" font-size="28" font-weight="700">HR ${cfg.hr} /min</text><text x="${W - 40}" y="82" font-size="24" font-weight="600" text-anchor="end">25 mm/s   10 mm/mV   0.05-150 Hz</text>
<g font-size="32" font-weight="700">${labels}</g>
<text x="40" y="${H - 18}" font-size="22" fill="#5d6b7e">Simulated corpuls feed · STEMI Coordination Platform test build · synthetic waveform, not a diagnosis</text></g>
<g fill="none" stroke="#151515" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">${traces}</g>
</svg>`;
}

/* the image of one simulated acquisition. hr: the simulated monitor's heart rate at that moment, so the 12-lead and the
   live HR agree. nominal: the rate the sample was scripted at (the simulated HR drifts towards it afterwards) */
function sampleEcg(sample, n, acquiredAt, hr) {
  const s = SAMPLES[sample] ? sample : 'A', variant = variantOf(s, n), nominal = (VAR[variant] || VAR.border).hr, rate = rateOf(hr, nominal);
  return { sample: s, label: SAMPLES[s].label, variant, rate, nominal, mime: 'image/svg+xml', data: Buffer.from(render(variant, acquiredAt, rate)) };
}

module.exports = { SAMPLES, variantOf, sampleEcg, render };
