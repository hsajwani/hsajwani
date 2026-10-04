/* Test users. Every name and unit here is fictional.
   There is no simulated CAD feed any more: the crew (EMT) enters the CAD number manually when opening the STEMI pathway,
   and the case is created under that number (Q-70: CAD integration is a later phase). */
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

/* the active case (one at a time in this build: Q-69, Q-73), or null when none is open */
function activeCad() {
  const r = D.get('SELECT cad FROM cases WHERE active=1 ORDER BY created_at DESC LIMIT 1');
  return r ? r.cad : null;
}

module.exports = { ensureUsers, activeCad, USERS };
