import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChallans, providerName } from './providers/index.js';
import { PLATE_RE, normalizePlate } from './plate.js';
import { sendOtp, verifyOtp, issueToken, readToken, otpMode } from './auth.js';
import { addLead } from './store.js';

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

const requireSession = (req, res, next) => {
  const s = readToken(req.get('authorization'));
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

app.post('/api/leads', limit(10, 10 * 60_000), requireSession, async (req, res) => {
  const b = req.body || {};
  const kind = ['booking', 'manual', 'alert'].includes(b.kind) ? b.kind : 'booking';
  const plate = normalizePlate(b.plate);
  if (!PLATE_RE.test(plate)) return res.status(400).json({ error: 'invalid_plate' });
  if (kind !== 'alert' && (!String(b.name || '').trim() || b.consent !== true)) {
    return res.status(400).json({ error: 'missing_fields' });
  }
  const code = CITY_CODES[b.city] || 'GBN';
  const ref = `${code}-26${String(Math.floor(10000 + Math.random() * 89999))}`;
  await addLead({
    ref, kind, createdAt: new Date().toISOString(), city: b.city || 'noida',
    plate, phone: req.session.phone,
    name: String(b.name || '').trim().slice(0, 120), email: String(b.email || '').trim().slice(0, 200),
    vtype: b.vtype, lang: b.lang,
    challans: Array.isArray(b.challans) ? b.challans.slice(0, 50) : [],
    status: 'New',
  });
  res.json({ ref });
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`API on http://localhost:${port} · challans: ${providerName()} · otp: ${otpMode()}`));
