/* Picks the corpuls provider (CORPULS_PROVIDER in .env): "mock" — the simulated feed (the default and the only working
   one) — or "corpuls-mission" — the placeholder for the real corpuls.mission interface (not implemented).
   The rest of the platform sees only the provider interface and the normalized events of contract.js. */
const cfg = require('../../config');
const contract = require('./contract');

function create(o) {
  o = o || {};
  if (cfg.CORPULS_PROVIDER === 'corpuls-mission') return new (require('./real-provider'))();
  return new (require('./mock-provider'))({ tickMs: cfg.CORPULS_SIM_TICK_MS, nibpSeconds: cfg.CORPULS_SIM_NIBP_SECONDS, store: o.store, onSim: o.onSim });
}

module.exports = { create, ...contract };
