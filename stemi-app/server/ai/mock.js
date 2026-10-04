/* MOCK ECG AI. Simulated, scripted results for the fictional test ECGs. NOT a clinical model, and it does not look at
   the image: it returns the scripted findings for the test ECG it is given. Wording is the approved prototype's
   (round 3 v0.2, shell.js AIT/SER/QTXT). Decision support only; the cardiologist makes the STEMI decision. */
const VERSION = 'SIMULATED AI (mock service, test build) · not a clinical model';

const AIT = {
  clear: { rhy: 'Sinus rhythm', rate: '84 bpm', ste: 'V2 3.0 mm, V3 4.0 mm, V4 3.4 mm, V5 2.1 mm; smaller in V1, I and aVL', steL: 'V2 3.0 mm, V3 4.0 mm, V4 3.4 mm, V5 2.1 mm; smaller in V1 and aVL. Limb leads I, II and III not assessed',
    std: 'Reciprocal ST depression III 1.7 mm, aVF 1.5 mm, II 1.1 mm', stdL: 'Reciprocal ST depression aVF 1.5 mm. II and III not assessed',
    imp: 'Sinus rhythm. ST elevation in V2 to V5 with reciprocal inferior ST depression. Pattern concerning for acute anterior STEMI.',
    impL: 'Sinus rhythm. ST elevation in V2 to V5. Limb leads I, II and III could not be assessed, so the inferior leads are only partly reported. Pattern concerning for acute anterior STEMI.', conf: 'Model confidence for anterior ST elevation: high' },
  border: { rhy: 'Sinus rhythm', rate: '84 bpm', ste: 'V2 1.0 mm, V3 1.2 mm, V4 1.2 mm, with tall T waves V2 to V4', steL: 'V2 1.0 mm, V3 1.2 mm, V4 1.2 mm, with tall T waves V2 to V4. Limb leads I, II and III not assessed',
    std: 'No reciprocal ST depression of 1 mm or more', stdL: 'None of 1 mm or more in aVF. II and III not assessed',
    imp: 'Sinus rhythm. Borderline ST elevation in V2 to V4 with tall T waves, without reciprocal change. Early evolving anterior STEMI not excluded; a serial ECG may help.',
    impL: 'Sinus rhythm. Borderline ST elevation in V2 to V4 with tall T waves. Limb leads I, II and III could not be assessed. Early evolving anterior STEMI not excluded; a serial ECG may help.', conf: 'Model confidence for anterior ST elevation: low' },
  evolved: { rhy: 'Sinus rhythm', rate: '92 bpm', ste: 'V2 1.4 mm, V3 3.2 mm, V4 3.0 mm, V5 1.2 mm', steL: 'V2 1.4 mm, V3 3.2 mm, V4 3.0 mm, V5 1.2 mm. Limb leads I, II and III not assessed',
    std: 'Reciprocal ST depression III 1.2 mm, aVF 1.0 mm', stdL: 'Reciprocal ST depression aVF 1.0 mm. II and III not assessed',
    imp: 'Sinus rhythm. ST elevation in V2 to V5, greatest in V3 and V4, with reciprocal inferior ST depression. Pattern concerning for evolving acute anterior STEMI.',
    impL: 'Sinus rhythm. ST elevation in V2 to V5, greatest in V3 and V4. Limb leads I, II and III could not be assessed. Pattern concerning for evolving acute anterior STEMI.', conf: 'Model confidence for anterior ST elevation: high' },
  clear2: { rhy: 'Sinus rhythm', rate: '88 bpm', ste: 'V2 3.2 mm, V3 4.2 mm, V4 3.6 mm, V5 2.2 mm; smaller in V1, I and aVL', steL: 'V2 3.2 mm, V3 4.2 mm, V4 3.6 mm, V5 2.2 mm; smaller in V1 and aVL. Limb leads I, II and III not assessed',
    std: 'Reciprocal ST depression III 1.8 mm, aVF 1.6 mm, II 1.2 mm', stdL: 'Reciprocal ST depression aVF 1.6 mm. II and III not assessed',
    imp: 'Sinus rhythm. ST elevation in V2 to V5 with reciprocal inferior ST depression. Pattern concerning for acute anterior STEMI.',
    impL: 'Sinus rhythm. ST elevation in V2 to V5. Limb leads I, II and III could not be assessed. Pattern concerning for acute anterior STEMI.', conf: 'Model confidence for anterior ST elevation: high' }
};
const SER = {
  evolved: { h: 'Dynamic change detected', t: p => `Compared with ECG ${p}, there is new ST elevation in V3 and V4 (V3 +2.0 mm, V4 +1.8 mm) with new reciprocal ST depression in III and aVF.` },
  clear2: { h: 'No significant change', t: p => `Compared with ECG ${p}, the ST elevation in V2 to V5 persists at a similar level, and the reciprocal ST depression is unchanged.` },
  same: { h: 'No significant change', t: p => `Compared with ECG ${p}, this ECG is similar.` }
};
const QTXT = {
  ok: 'Suitable: all 12 leads, calibration pulse and rhythm strip visible',
  lim: 'Limited: glare over limb leads I, II and III',
  wh: 'Not suitable: leads V4 to V6 cut off at the edge of the image',
  file: 'Not assessed: uploaded image file. The simulated AI does not read images; these are the scripted test findings'
};

function serial(ecg, st, prev) {
  if (!prev) return null;
  const base = { vs: prev.n, vsAcq: prev.acq };
  const pa = prev.ai;
  if (!pa || pa.st === 'proc' || pa.st === 'down') return { ...base, h: 'Cannot compare', t: `There is no AI analysis of ECG ${prev.n}.` };
  if (pa.st === 'wh') return { ...base, h: 'Cannot compare', t: `The image of ECG ${prev.n} was not suitable for analysis (leads V4 to V6 cut off).` };
  const s = SER[ecg.same ? 'same' : ecg.variant] || SER.same;
  let t = s.t(prev.n);
  if (pa.st === 'lim') t += ` Limb leads I, II and III of ECG ${prev.n} could not be assessed.`;
  if (st === 'lim') t += ` Limb leads I, II and III of ECG ${ecg.n} were not compared.`;
  return { ...base, h: s.h, t };
}

/* analyse({ecg:{n,acq,variant,same,pri,primary:{quality,source}}, previous:{n,acq,ai}|null, unavailable})
   → {st, result}. st: ok | lim (limited by quality) | wh (not suitable) | down (unavailable) */
async function analyse({ ecg, previous, unavailable }) {
  const q = ecg.primary.quality, file = ecg.primary.source === 'file';
  const st = unavailable ? 'down' : q === 'glare' ? 'lim' : q === 'cut' ? 'wh' : 'ok';
  const T = AIT[ecg.variant] || AIT.clear, lim = st === 'lim';
  const out = { q: file ? QTXT.file : QTXT[st] || null, ver: VERSION, pri: ecg.pri, provider: 'mock' };
  if (st === 'ok' || st === 'lim') {
    Object.assign(out, {
      rhy: T.rhy, rate: T.rate, ste: lim ? T.steL : T.ste, std: lim ? T.stdL : T.std, cond: 'No bundle branch block or AV block',
      ser: serial(ecg, st, previous), imp: lim ? T.impL : T.imp,
      conf: `${lim ? 'Model confidence: moderate, limited by image quality' : T.conf}. ${file ? 'Scripted test result for an uploaded file' : 'Read from a photograph of the printout'}`,
      lim: lim ? { ste: 1, std: 1, imp: 1 } : {}
    });
  }
  return { st, result: out };
}

module.exports = { name: 'mock', version: VERSION, analyse };
