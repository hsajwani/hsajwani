/* Test users and the simulated CAD incident. Every name, unit and number here is fictional.
   In this build the test console stands in for the CAD feed: how the CAD number reaches the tablet in V1 is still open (Q-70). */
const D = require('./db');
const cfg = require('./config');

const USERS = [
  { id: 'u-crew-1', email: 'crew@test.local', role: 'crew', name: 'K. Ahmed', title: 'Paramedic', unit: 'Ambulance 214', emirate: 'Ras Al Khaimah' },
  { id: 'u-cardio-1', email: 'cardio@test.local', role: 'cardiologist', name: 'Dr X', title: 'Cardiologist', org: 'PCI Hospital A' }
];

function ensureUsers() {
  for (const u of USERS) {
    const row = D.get('SELECT id, password_hash FROM users WHERE email=?', u.email);
    if (!row) {
      D.run('INSERT INTO users(id,email,password_hash,role,name,title,org,unit,emirate) VALUES(?,?,?,?,?,?,?,?,?)',
        u.id, u.email, D.hashPassword(cfg.TEST_PASSWORD), u.role, u.name, u.title, u.org || null, u.unit || null, u.emirate || null);
    } else if (!D.checkPassword(cfg.TEST_PASSWORD, row.password_hash)) {
      /* TEST_USER_PASSWORD changed in .env: the test accounts follow it */
      D.run('UPDATE users SET password_hash=? WHERE id=?', D.hashPassword(cfg.TEST_PASSWORD), row.id);
    }
  }
}

const p2 = n => String(n).padStart(2, '0');
/* CAD#YYYYMMDD-NNNN-1, the format of the example in the brief. The day's first incident is NNNN 0123 (CAD#20261004-0123-1
   on 4 October 2026, the brief's example); later ones are random and fictional */
function newCad() {
  const d = new Date();
  const day = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  if (!D.get('SELECT cad FROM cases WHERE cad=?', `${day}-0123-1`)) return `${day}-0123-1`;
  for (;;) {
    const cad = `${day}-${String(Math.floor(Math.random() * 9000) + 100).padStart(4, '0')}-1`;
    if (!D.get('SELECT cad FROM cases WHERE cad=?', cad)) return cad;
  }
}

/* a new simulated incident from CAD: chest pain, dispatched 11 minutes ago, crew at patient 3 minutes ago */
function newIncident() {
  const crew = D.get("SELECT * FROM users WHERE role='crew' ORDER BY id LIMIT 1");
  const t = Date.now(), cad = newCad(), crewT = `${crew.name}, ${crew.title}`;
  D.tx(() => {
    D.run('UPDATE cases SET active=0 WHERE active=1');
    D.run(`INSERT INTO cases(cad,active,unit,emirate,crew_name,incident_type,dispatched_at,at_patient_at,created_at)
           VALUES(?,1,?,?,?,?,?,?,?)`, cad, crew.unit, crew.emirate, crewT, 'Chest pain / heart problem', t - 11 * 60000 - 20000, t - 3 * 60000 - 5000, t);
    D.run('INSERT INTO audit_events(cad,at,actor,role,action,kind) VALUES(?,?,?,?,?,?)', cad, t - 11 * 60000 - 20000, 'CAD (simulated feed)', 'cad-feed', `CAD ${cad} dispatched to ${crew.unit}`, 'key');
    D.run('INSERT INTO audit_events(cad,at,actor,role,action,kind) VALUES(?,?,?,?,?,?)', cad, t - 3 * 60000 - 5000, 'CAD (crew status button, simulated)', 'cad-feed', `${crew.unit} at patient`, 'key');
  });
  D.bumpEpoch();
  return cad;
}

function activeCad() {
  const r = D.get('SELECT cad FROM cases WHERE active=1 ORDER BY created_at DESC LIMIT 1');
  return r ? r.cad : newIncident();
}

module.exports = { ensureUsers, newIncident, activeCad, USERS };
