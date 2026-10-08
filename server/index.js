import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChallans, providerName } from './providers/index.js';
import { PLATE_RE, normalizePlate } from './plate.js';
import { sendOtp, verifyOtp, issueToken, readToken, otpMode, adminEnabled, checkAdminPassword, hashPassword, verifyPassword, issueTeamToken, readTeamToken } from './auth.js';
import { addLead, listLeads, updateLead, store, STATUSES, getSettings, saveSettings, listStaff, saveStaff, nextAssignee } from './store.js';

try { process.loadEnvFile(); } catch { /* no .env file: use defaults */ }

const app = express();
// Behind a host's load balancer, trust X-Forwarded-For so req.ip is the customer's IP (InstantPay needs it).
const tp = process.env.TRUST_PROXY;
if (tp) app.set('trust proxy', tp === 'true' ? true : /^\d+$/.test(tp) ? Number(tp) : tp);
app.use(express.json({ limit: '20kb' }));

const PHONE_RE = /^[6-9]\d{9}$/;
const CITY_CODES = { noida: 'GBN', ghaziabad: 'GZB', delhi: 'DEL', gurugram: 'GGN' };

// Tiny fixed-window limiter, per IP + route.
const hits = new Map();
const limit = (max, windowMs) => (req, res, next) => {
  const key = req.ip + req.path, now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
  else if (++h.n > max) return res.status(429).json({ error: 'too_many_requests' });
  next();
};

// Signed-in team member. Staff accounts are re-checked on every request so a
// deactivated account or changed role takes effect immediately.
const requireUser = async (req, res, next) => {
  const t = readTeamToken(req.get('authorization'));
  if (!t) return res.status(401).json({ error: 'not_signed_in' });
  if (t.uid === 'super') {
    if (!adminEnabled()) return res.status(401).json({ error: 'not_signed_in' });
    req.user = { uid: 'super', name: t.name, role: 'admin' };
    return next();
  }
  try {
    const u = (await listStaff()).find((x) => x.id === t.uid);
    if (!u?.active || u.tokenVer !== t.ver) return res.status(401).json({ error: 'not_signed_in' });
    req.user = { uid: u.id, name: u.name, role: u.role };
    next();
  } catch (err) { console.error('[admin] staff read failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
};
const requireAdmin = [requireUser, (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'admins_only' }))];

const requireSession = (req, res, next) => {
  const s = readToken(req.get('authorization'));
  if (s?.kind === 'team') return res.status(401).json({ error: 'not_verified' });
  if (!s) return res.status(401).json({ error: 'not_verified' });
  req.session = s;
  next();
};

app.get('/api/config', (req, res) => {
  res.json({ otpMode: otpMode(), challanSource: providerName() });
});

app.post('/api/otp/send', limit(5, 10 * 60_000), (req, res) => {
  const phone = String(req.body?.phone || '');
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'invalid_phone' });
  sendOtp(phone);
  res.json({ ok: true, resendAfter: 30 });
});

app.post('/api/otp/verify', limit(10, 10 * 60_000), (req, res) => {
  const { phone, code } = req.body || {};
  if (!PHONE_RE.test(String(phone)) || !verifyOtp(String(phone), String(code))) {
    return res.status(400).json({ error: 'invalid_otp' });
  }
  res.json({ token: issueToken(String(phone)) });
});

app.get('/api/challans', limit(20, 10 * 60_000), requireSession, async (req, res) => {
  const plate = normalizePlate(req.query.plate);
  if (!PLATE_RE.test(plate)) return res.status(400).json({ error: 'invalid_plate' });
  try {
    const { source, challans } = await getChallans(plate, process.env, { ip: req.ip });
    res.json({ plate, source, fetchedAt: new Date().toISOString(), challans });
  } catch (err) {
    console.error('[challans]', plate, err.message);
    res.status(502).json({ error: 'provider_unavailable' });
  }
});

// Lead capture: name + vehicle + phone. No OTP or challan lookup for now.
app.post('/api/leads', limit(10, 10 * 60_000), async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ref: 'OK' }); // honeypot field only bots fill in
  const plate = normalizePlate(b.plate);
  const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
  const name = String(b.name || '').trim().slice(0, 120);
  if (!PLATE_RE.test(plate)) return res.status(400).json({ error: 'invalid_plate' });
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'invalid_phone' });
  if (!name || b.consent !== true) return res.status(400).json({ error: 'missing_fields' });
  const code = CITY_CODES[b.city] || 'GBN';
  const base = {
    createdAt: new Date().toISOString(), city: CITY_CODES[b.city] ? b.city : 'noida',
    name, plate, phone, lang: b.lang === 'hi' ? 'hi' : 'en', status: 'New', agent: '', agentId: '', notes: [],
  };
  try {
    if ((await getSettings()).autoAssign) {
      const pick = await nextAssignee();
      if (pick) Object.assign(base, { agent: pick.name, agentId: pick.id });
    }
  } catch (err) { console.error('[leads] auto-assign failed', err.message); }
  let ref;
  for (let attempt = 0; ; attempt++) {
    ref = `${code}-26${String(Math.floor(10000 + Math.random() * 89999))}`;
    try { await addLead({ ref, ...base }); break; }
    catch (err) {
      // Retry on the rare duplicate reference; anything else is a real failure.
      if (err.code === '23505' && attempt < 3) continue;
      return res.status(500).json({ error: 'save_failed' });
    }
  }
  res.json({ ref });
});

// ── Site settings ───────────────────────────────────────
const MOBILE_RE = /^[6-9]\d{9}$/;
const todayIST = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);

function cleanSettings(b) {
  const digits = (v) => String(v || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  const whatsapp = digits(b.whatsapp), phone = digits(b.phone);
  if (whatsapp && !MOBILE_RE.test(whatsapp)) return { error: 'invalid_whatsapp' };
  if (phone && !MOBILE_RE.test(phone)) return { error: 'invalid_phone' };
  const dates = (Array.isArray(b.lokAdalatDates) ? b.lokAdalatDates : []).slice(0, 50).map((d) => ({
    id: String(d.id || Math.random().toString(36).slice(2, 10)).slice(0, 20),
    date: String(d.date || ''), time: /^\d{2}:\d{2}$/.test(d.time) ? d.time : '10:00',
    city: CITY_CODES[d.city] ? d.city : 'noida', note: String(d.note || '').trim().slice(0, 200),
  }));
  if (dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || isNaN(new Date(d.date)))) return { error: 'invalid_date' };
  dates.sort((a, b2) => (a.date + a.time).localeCompare(b2.date + b2.time));
  return { value: { whatsapp, phone, autoAssign: b.autoAssign === true, lokAdalatDates: dates } };
}

// Public: what the website needs. Only upcoming dates are sent.
app.get('/api/settings', async (req, res) => {
  try {
    const s = await getSettings();
    res.set('Cache-Control', 'no-store');
    res.json({
      whatsapp: s.whatsapp || '', phone: s.phone || s.whatsapp || '',
      lokAdalatDates: (s.lokAdalatDates || []).filter((d) => d.date >= todayIST()),
    });
  } catch (err) {
    console.error('[settings] read failed', err.message);
    res.status(500).json({ error: 'storage_unavailable' });
  }
});

// ── Admin panel API ─────────────────────────────────────
app.get('/api/admin/status', (req, res) => res.json({ enabled: adminEnabled(), storage: store().name, statuses: STATUSES }));

// Super admin: username "admin" + ADMIN_PASSWORD. Everyone else: a staff account.
app.post('/api/admin/login', limit(10, 15 * 60_000), async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!adminEnabled()) return res.status(503).json({ error: 'admin_disabled' });
  if (username === 'admin') {
    if (!checkAdminPassword(password)) return res.status(401).json({ error: 'wrong_password' });
    const user = { uid: 'super', name: 'Admin', role: 'admin' };
    return res.json({ token: issueTeamToken(user), user });
  }
  try {
    const u = (await listStaff()).find((x) => x.username === username);
    if (!u?.active || !verifyPassword(password, u.passHash)) return res.status(401).json({ error: 'wrong_password' });
    const user = { uid: u.id, name: u.name, role: u.role };
    res.json({ token: issueTeamToken({ ...user, ver: u.tokenVer }), user });
  } catch (err) { console.error('[admin] login failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

app.get('/api/admin/me', requireUser, (req, res) => res.json({ user: req.user }));

// Staff only see the leads assigned to them.
app.get('/api/admin/leads', requireUser, async (req, res) => {
  try {
    let leads = await listLeads();
    if (req.user.role !== 'admin') leads = leads.filter((l) => l.agentId === req.user.uid);
    res.json({ leads, storage: store().name });
  } catch (err) { console.error('[admin] list failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try { res.json(await getSettings()); }
  catch (err) { console.error('[admin] settings read failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  const { value, error } = cleanSettings(req.body || {});
  if (error) return res.status(400).json({ error });
  try { res.json(await saveSettings(value)); }
  catch (err) { console.error('[admin] settings save failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

// ── Staff accounts (admins manage them) ─────────────────
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const publicStaff = (u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, active: u.active, createdAt: u.createdAt });

app.get('/api/admin/staff', requireUser, async (req, res) => {
  try {
    const list = (await listStaff()).map(publicStaff);
    // Staff only need names for display; usernames are for admins.
    res.json({ staff: req.user.role === 'admin' ? list : list.map(({ id, name, role, active }) => ({ id, name, role, active })) });
  } catch (err) { console.error('[admin] staff read failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

app.post('/api/admin/staff', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 60);
  const username = String(b.username || '').trim().toLowerCase();
  const password = String(b.password || '');
  if (!name) return res.status(400).json({ error: 'missing_name' });
  if (!USERNAME_RE.test(username) || username === 'admin') return res.status(400).json({ error: 'invalid_username' });
  if (password.length < 8) return res.status(400).json({ error: 'short_password' });
  try {
    const list = await listStaff();
    if (list.some((u) => u.username === username)) return res.status(409).json({ error: 'username_taken' });
    const u = {
      id: 'u' + Math.random().toString(36).slice(2, 10), name, username, passHash: hashPassword(password),
      role: b.role === 'admin' ? 'admin' : 'staff', active: true, tokenVer: 1, createdAt: new Date().toISOString(),
    };
    await saveStaff([...list, u]);
    res.json({ staff: publicStaff(u) });
  } catch (err) { console.error('[admin] staff save failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

// patch: { name?, role?, active?, password? } — a new password signs that person out everywhere.
app.patch('/api/admin/staff/:id', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (b.password !== undefined && String(b.password).length < 8) return res.status(400).json({ error: 'short_password' });
  try {
    const list = await listStaff();
    const u = list.find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: 'not_found' });
    if (req.user.uid === u.id && (b.active === false || b.role === 'staff')) return res.status(400).json({ error: 'cannot_demote_self' });
    if (typeof b.name === 'string' && b.name.trim()) u.name = b.name.trim().slice(0, 60);
    if (b.role === 'admin' || b.role === 'staff') u.role = b.role;
    if (typeof b.active === 'boolean') { u.active = b.active; if (!b.active) u.tokenVer = (u.tokenVer || 1) + 1; }
    if (b.password !== undefined) { u.passHash = hashPassword(String(b.password)); u.tokenVer = (u.tokenVer || 1) + 1; }
    await saveStaff(list);
    res.json({ staff: publicStaff(u) });
  } catch (err) { console.error('[admin] staff save failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

// Leads: anyone can change status and add notes on leads they can see; only admins reassign.
app.patch('/api/admin/leads/:ref', requireUser, async (req, res) => {
  const b = req.body || {};
  const patch = { status: b.status, note: b.note };
  try {
    if (b.assignTo !== undefined) {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'admins_only' });
      if (b.assignTo === '') patch.assign = { id: '', name: '' };
      else {
        const u = (await listStaff()).find((x) => x.id === b.assignTo && x.active);
        if (!u) return res.status(400).json({ error: 'unknown_staff' });
        patch.assign = { id: u.id, name: u.name };
      }
    }
    const lead = await updateLead(req.params.ref, patch, req.user.name, req.user.role === 'admin' ? null : req.user.uid);
    if (!lead) return res.status(404).json({ error: 'not_found' });
    res.json({ lead });
  } catch (err) {
    if (err.code === 'forbidden') return res.status(403).json({ error: 'not_your_lead' });
    console.error('[admin] update failed', err.message); res.status(500).json({ error: 'storage_unavailable' });
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist, { index: false }));
  app.get('/admin', (req, res) => res.sendFile(path.join(dist, 'admin.html')));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`API on http://localhost:${port} · challans: ${providerName()} · otp: ${otpMode()}`));
