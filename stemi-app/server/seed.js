/* The crew test user. Every name and unit here is fictional.
   Only the crew MDT logs in. The ER Doctor and the Cardiologist need no account: they type their name when they accept
   or acknowledge a case (prototype identification only, see server/auth.js). A cardiologist test account made by an
   earlier version stays in the database untouched; it can no longer log in.
   There is no simulated CAD feed: the crew (EMT) enters the CAD number manually when opening the STEMI pathway. */
const D = require('./db');
const cfg = require('./config');

const USERS = [
  { id: 'u-crew-1', email: 'crew@test.local', role: 'crew', name: 'K. Ahmed', title: 'Paramedic', unit: 'Ambulance 214', emirate: 'Ras Al Khaimah' }
];

function ensureUsers() {
  for (const u of USERS) {
    const row = D.get('SELECT id, password_hash FROM users WHERE email=?', u.email);
    if (!row) {
      D.run('INSERT INTO users(id,email,password_hash,role,name,title,org,unit,emirate) VALUES(?,?,?,?,?,?,?,?,?)',
        u.id, u.email, D.hashPassword(cfg.TEST_PASSWORD), u.role, u.name, u.title, u.org || null, u.unit || null, u.emirate || null);
    } else if (!D.checkPassword(cfg.TEST_PASSWORD, row.password_hash)) {
      /* TEST_USER_PASSWORD changed in .env: the test account follows it */
      D.run('UPDATE users SET password_hash=? WHERE id=?', D.hashPassword(cfg.TEST_PASSWORD), row.id);
    }
  }
}
const crewUser = () => D.get("SELECT * FROM users WHERE role='crew' ORDER BY id LIMIT 1");

module.exports = { ensureUsers, crewUser, USERS };
