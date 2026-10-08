import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChallans, providerName } from './providers/index.js';
import { PLATE_RE, normalizePlate } from './plate.js';
import { sendOtp, verifyOtp, issueToken, readToken, otpMode, adminEnabled, checkAdminPassword, issueAdminToken, readAdminToken } from './auth.js';
import { addLead, listLeads, updateLead, store, STATUSES, getSettings, saveSettings } from './store.js';

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

const requireAdmin = (req, res, next) => {
  const a = readAdminToken(req.get('authorization'));
  if (!a) return res.status(401).json({ error: 'not_signed_in' });
  req.admin = a;
  next();
};

const requireSession = (req, res, next) => {
  const s = readToken(req.get('authorization'));
  if (s?.role === 'admin') return res.status(401).json({ error: 'not_verified' });
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
    name, plate, phone, lang: b.lang === 'hi' ? 'hi' : 'en', status: 'New', agent: '', notes: [],
  };
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
  return { value: { whatsapp, phone, lokAdalatDates: dates } };
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

app.post('/api/admin/login', limit(10, 15 * 60_000), (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!adminEnabled()) return res.status(503).json({ error: 'admin_disabled' });
  if (!name || !checkAdminPassword(req.body?.password)) return res.status(401).json({ error: 'wrong_password' });
  res.json({ token: issueAdminToken(name), name });
});

app.get('/api/admin/leads', requireAdmin, async (req, res) => {
  try { res.json({ leads: await listLeads(), storage: store().name }); }
  catch (err) { console.error('[admin] list failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
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

app.patch('/api/admin/leads/:ref', requireAdmin, async (req, res) => {
  try {
    const lead = await updateLead(req.params.ref, req.body || {}, req.admin.name);
    if (!lead) return res.status(404).json({ error: 'not_found' });
    res.json({ lead });
  } catch (err) { console.error('[admin] update failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist, { index: false }));
  app.get('/admin', (req, res) => res.sendFile(path.join(dist, 'admin.html')));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`API on http://localhost:${port} · challans: ${providerName()} · otp: ${otpMode()}`));
