/* The ECG AI service interface. The platform calls analyse() once per ECG and sends the same result to every screen.
   To connect the validated AI service later, add a provider module with the same analyse() contract and set AI_PROVIDER.
   Contract: analyse({ cad, ecg: { n, acq, variant, same, pri, primary: { quality, source, filePath } },
                       previous: { n, acq, ai } | null, unavailable: boolean })
             → Promise<{ st: 'ok'|'lim'|'wh'|'down', result: { q, rhy, rate, ste, std, cond, ser, imp, conf, lim, ver } }>
   An AI failure must never block the case: the platform records "AI interpretation unavailable" and carries on. */
const cfg = require('../config');

const PROVIDERS = { mock: () => require('./mock') };

function provider() {
  const p = PROVIDERS[cfg.AI_PROVIDER];
  if (!p) throw new Error(`Unknown AI_PROVIDER "${cfg.AI_PROVIDER}". Only "mock" exists in this build.`);
  return p();
}

module.exports = { provider };
