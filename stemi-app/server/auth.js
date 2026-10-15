/* Who is acting. PROTOTYPE ONLY: none of this is secure authentication.
   - Crew MDT: email + password for the crew test user, then a signed session cookie (unchanged since 0.1).
   - ER Doctor, Cardiologist and the test console: no login. Opening the page gives the browser a signed prototype device
     session for that role. The clinician types their name when accepting / acknowledging a case; the name is recorded
     against that CAD number. A typed name gives no identity assurance: production needs the organisation's identity
     provider (SSO, e.g. Microsoft Entra ID, with staff ID, badge or PIN) — see docs/production-gaps.md.
   Everything else only calls actor(req, role) and gets back { role, id, device, name, title, unit, emirate } or null. */
const crypto = require('node:crypto');
const D = require('./db');
const cfg = require('./config');

const COOKIE = 'stemi_sid';
const DEVICE_ROLES = ['er', 'cardiologist', 'control'];
const DEVICE_DAYS = 30;
const devCookie = role => `stemi_dev_${role}`;
const b64u = b => Buffer.from(b).toString('base64url');
const sign = s => crypto.createHmac('sha256', cfg.SESSION_SECRET).update(s).digest('base64url');

function issue(payload) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}
/* a signed value → its payload, or null when the signature is wrong or it has expired */
function verify(v) {
  if (!v) return null;
  const [body, sig] = String(v).split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let s; try { s = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (_) { return null; }
  return s && s.exp && s.exp > Date.now() ? s : null;
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}

/* ---------- crew: test login ---------- */
function currentUser(req) {
  const s = verify(cookies(req)[COOKIE]);
  if (!s) return null;
  return D.get("SELECT id,email,role,name,title,org,unit,emirate FROM users WHERE id=? AND role='crew'", s.u) || null;
}
function login(email, password) {
  const u = D.get('SELECT * FROM users WHERE email=?', String(email || '').trim().toLowerCase());
  if (!u || !D.checkPassword(String(password || ''), u.password_hash)) return { error: 'Email or password not recognised' };
  if (u.role !== 'crew') return { error: 'This login is for the crew MDT only. The ER Doctor and Cardiologist screens need no login: open /er or /cardiologist.' };
  const v = issue({ u: u.id, exp: Date.now() + cfg.SESSION_HOURS * 3600e3 });
  return { user: u, cookie: `${COOKIE}=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${cfg.SESSION_HOURS * 3600}` };
}
const logoutCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

/* ---------- ER Doctor, Cardiologist, test console: prototype device sessions ---------- */
function device(req, role) {
  const s = verify(cookies(req)[devCookie(role)]);
  return s && s.r === role ? s.d : null;
}
/* a new device session for this role, as a Set-Cookie header value */
function deviceCookie(role) {
  const v = issue({ r: role, d: crypto.randomBytes(6).toString('hex'), exp: Date.now() + DEVICE_DAYS * 864e5 });
  return `${devCookie(role)}=${v}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DEVICE_DAYS * 86400}`;
}

/* the actor of a request. role: the screen the request comes from (X-Stemi-Role header, or ?role= for the event
   stream). A device role needs that role's device session; anything else is the logged-in crew user */
function actor(req, role) {
  if (DEVICE_ROLES.includes(role)) {
    const d = device(req, role);
    return d ? { role, id: null, device: d, name: null, title: role === 'er' ? 'ER Doctor' : role === 'cardiologist' ? 'Cardiologist' : 'Test console', unit: null, emirate: null } : null;
  }
  const u = currentUser(req);
  return u ? { ...u, device: null } : null;
}
/* any valid session at all (stored ECG images are shown on every role's screen) */
const anySession = req => !!currentUser(req) || DEVICE_ROLES.some(r => device(req, r));

module.exports = { currentUser, login, logoutCookie, device, deviceCookie, actor, anySession, DEVICE_ROLES };
