/* Test authentication: email + password for the two test users, then a signed session cookie.
   Kept deliberately small so it can be replaced by National Ambulance identity / SSO: everything else only calls
   currentUser(req) and gets back { id, email, role, name, title, org, unit, emirate }. */
const crypto = require('node:crypto');
const D = require('./db');
const cfg = require('./config');

const COOKIE = 'stemi_sid';
const b64u = b => Buffer.from(b).toString('base64url');
const sign = s => crypto.createHmac('sha256', cfg.SESSION_SECRET).update(s).digest('base64url');

function issue(user) {
  const body = b64u(JSON.stringify({ u: user.id, exp: Date.now() + cfg.SESSION_HOURS * 3600e3 }));
  return `${body}.${sign(body)}`;
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function currentUser(req) {
  const v = cookies(req)[COOKIE];
  if (!v) return null;
  const [body, sig] = v.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let s; try { s = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (_) { return null; }
  if (!s.exp || s.exp < Date.now()) return null;
  const u = D.get('SELECT id,email,role,name,title,org,unit,emirate FROM users WHERE id=?', s.u);
  return u || null;
}
function login(email, password) {
  const u = D.get('SELECT * FROM users WHERE email=?', String(email || '').trim().toLowerCase());
  if (!u || !D.checkPassword(String(password || ''), u.password_hash)) return null;
  return { user: u, cookie: `${COOKIE}=${issue(u)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${cfg.SESSION_HOURS * 3600}` };
}
const logoutCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

module.exports = { currentUser, login, logoutCookie };
