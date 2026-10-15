/* Picks the corpuls provider (CORPULS_PROVIDER in .env): "mock" — the simulated feed (the default and the only working
   one; with CORPULS_DEMO_MODE, on by default, it runs the prototype demonstration by itself) — or "corpuls-mission" —
   the placeholder for the real corpuls.mission interface (not implemented).
   The rest of the platform sees only the provider interface and the normalized events of contract.js. */
const cfg = require('../../config');
const contract = require('./contract');

function create(o) {
  o = o || {};
  if (cfg.CORPULS_PROVIDER === 'corpuls-mission') return new (require('./real-provider'))();
  return new (require('./mock-provider'))({ tickMs: cfg.CORPULS_SIM_TICK_MS, nibpSeconds: cfg.CORPULS_SIM_NIBP_SECONDS, connectMs: cfg.CORPULS_SIM_CONNECT_MS, store: o.store, onSim: o.onSim,
    demo: cfg.CORPULS_DEMO_MODE, demoEcgSeconds: cfg.CORPULS_DEMO_ECG_SECONDS });
}

module.exports = { create, ...contract };
