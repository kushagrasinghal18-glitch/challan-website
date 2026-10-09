import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getChallans, providerName } from './providers/index.js';
import { PLATE_RE, normalizePlate } from './plate.js';
import { sendOtp, verifyOtp, issueToken, readToken, otpMode, adminEnabled, checkAdminPassword, hashPassword, verifyPassword, issueTeamToken, readTeamToken } from './auth.js';
import { waConfigured, validSignature, parseWebhook, localPhone, saysApprove, sendText, sendTemplate, WINDOW_MS } from './whatsapp.js';
import { UPI_RE, paymentMessage, paymentAmounts, upiLink } from './payment.js';
import crypto from 'node:crypto';
import { FEE_RATES, addLead, listLeads, updateLead, deleteLead, store, STATUSES, getSettings, saveSettings, listStaff, saveStaff, nextAssignee,
  getLead, saveDoc, getDoc, removeDoc, docTypesOf, leadByDocToken } from './store.js';

try { process.loadEnvFile(); } catch { /* no .env file: use defaults */ }

const app = express();
// Behind a host's load balancer, trust X-Forwarded-For so req.ip is the customer's IP (InstantPay needs it).
const tp = process.env.TRUST_PROXY;
if (tp) app.set('trust proxy', tp === 'true' ? true : /^\d+$/.test(tp) ? Number(tp) : tp);
const jsonSmall = express.json({ limit: '20kb' }), jsonBig = express.json({ limit: '300kb' });
// The WhatsApp webhook keeps the raw body so Meta's signature can be checked.
const jsonWebhook = express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } });
app.use((req, res, next) => (req.path === '/api/whatsapp/webhook' ? jsonWebhook : req.path.endsWith('/challans') || req.path === '/api/admin/whatsapp-web' || req.path === '/api/admin/settings' ? jsonBig : jsonSmall)(req, res, next));

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

const MAX_VEHICLES = 5;
// Saves a lead under a fresh reference like GBN-2612345, retrying the rare duplicate.
async function saveNewLead(code, lead) {
  for (let attempt = 0; ; attempt++) {
    const ref = `${code}-26${String(Math.floor(10000 + Math.random() * 89999))}`;
    try { await addLead({ ref, ...lead }); return ref; }
    catch (err) { if (err.code === '23505' && attempt < 3) continue; throw err; }
  }
}
async function autoAssign(lead) {
  try {
    if ((await getSettings()).autoAssign) {
      const pick = await nextAssignee();
      if (pick) Object.assign(lead, { agent: pick.name, agentId: pick.id });
    }
  } catch (err) { console.error('[leads] auto-assign failed', err.message); }
  return lead;
}
// Lead capture: name + vehicle + phone. No OTP or challan lookup for now.
app.post('/api/leads', limit(10, 10 * 60_000), async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ref: 'OK' }); // honeypot field only bots fill in
  const plate = normalizePlate(b.plate);
  const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
  const name = String(b.name || '').trim().slice(0, 120);
  if (!PLATE_RE.test(plate)) return res.status(400).json({ error: 'invalid_plate' });
  // More vehicles from the same customer: each becomes its own lead, linked by groupRef.
  const extra = (Array.isArray(b.extraPlates) ? b.extraPlates : []).slice(0, MAX_VEHICLES - 1).map(normalizePlate);
  if (extra.some((p) => !PLATE_RE.test(p))) return res.status(400).json({ error: 'invalid_plate' });
  const plates = [...new Set([plate, ...extra])];
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'invalid_phone' });
  if (!name || b.consent !== true) return res.status(400).json({ error: 'missing_fields' });
  const code = CITY_CODES[b.city] || 'GBN';
  // Optional promo code: must be one from Settings; it sets the share the customer pays.
  let promo = null;
  const promoIn = String(b.promoCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (promoIn) {
    try { promo = promoCodes(await getSettings()).find((c) => c.code === promoIn); } catch { /* storage down: ignore code */ }
    if (!promo) return res.status(400).json({ error: 'invalid_promo' });
  }
  const base = {
    createdAt: new Date().toISOString(), city: CITY_CODES[b.city] ? b.city : 'noida',
    name, phone, lang: b.lang === 'hi' ? 'hi' : 'en', status: 'New', agent: '', agentId: '', notes: [],
    ...(promo ? { promoCode: promo.code, feeRate: promo.pays } : {}),
  };
  await autoAssign(base);
  const refs = [];
  for (const p of plates) {
    const extraFields = plates.length > 1 ? { groupRef: refs[0] || null, vehicles: plates.length } : {};
    for (let attempt = 0; ; attempt++) {
      const ref = `${code}-26${String(Math.floor(10000 + Math.random() * 89999))}`;
      try { await addLead({ ref, ...base, plate: p, ...extraFields, ...(plates.length > 1 && !refs.length ? { groupRef: ref } : {}) }); refs.push(ref); break; }
      catch (err) {
        // Retry on the rare duplicate reference; anything else is a real failure.
        if (err.code === '23505' && attempt < 3) continue;
        if (refs.length) return res.json({ ref: refs[0], refs, plates: plates.slice(0, refs.length) });
        return res.status(500).json({ error: 'save_failed' });
      }
    }
  }
  res.json({ ref: refs[0], refs, plates });
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
  const codes = [];
  for (const c of (Array.isArray(b.promoCodes) ? b.promoCodes : []).slice(0, 20)) {
    const code = String(c.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    if (!code) return { error: 'invalid_code' };
    if (codes.some((x) => x.code === code)) return { error: 'duplicate_code' };
    codes.push({ code, title: String(c.title || '').trim().slice(0, 80), pays: FEE_RATES.includes(Number(c.pays)) ? Number(c.pays) : 50, show: c.show !== false });
  }
  // Exclusive offer banner: a code plus a real end time (no fake, self-resetting timers).
  const o = b.offer || {};
  const offerCode = String(o.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (offerCode && !codes.some((c) => c.code === offerCode)) return { error: 'offer_code_missing' };
  const endsAt = o.endsAt && !isNaN(new Date(o.endsAt)) ? new Date(o.endsAt).toISOString() : '';
  const offer = { on: o.on === true && !!offerCode, code: offerCode, endsAt };
  // Payment details sent on WhatsApp after approval. The QR is a small image kept as a data URL.
  const p = b.payment || {};
  const upiId = String(p.upiId || '').trim();
  if (upiId && !UPI_RE.test(upiId)) return { error: 'invalid_upi' };
  const qr = String(p.qr || '');
  if (qr && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(qr) || qr.length > 700_000)) return { error: 'invalid_qr' };
  const payment = { upiId, payeeName: String(p.payeeName || '').trim().slice(0, 60), qr };
  // Documents the team collects from each customer; each gets its own upload button on a lead.
  const docTypes = [];
  for (const t of (Array.isArray(b.docTypes) ? b.docTypes : []).slice(0, 20)) {
    const name = String(t?.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name) return { error: 'invalid_doc_type' };
    let id = String(t.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
    if (!id || docTypes.some((x) => x.id === id)) id = crypto.randomBytes(4).toString('hex');
    if (docTypes.some((x) => x.name.toLowerCase() === name.toLowerCase())) return { error: 'duplicate_doc_type' };
    docTypes.push({ id, name, required: t.required !== false });
  }
  return { value: { whatsapp, phone, autoAssign: b.autoAssign === true, lokAdalatDates: dates, promoCodes: codes, offer, payment, docTypes } };
}

// Promo codes from Settings; FLAT50 until the admin saves their own list.
const DEFAULT_CODES = [{ code: 'FLAT50', title: 'Flat 50% off your challans', pays: 50, show: true }];
const promoCodes = (s) => (Array.isArray(s.promoCodes) ? s.promoCodes : DEFAULT_CODES);
// The offer ends at the time set in Settings, else at the next Lok Adalat, else it shows without a timer.
function publicOffer(s) {
  const o = s.offer || (s.promoCodes ? null : { on: true, code: 'FLAT50', endsAt: '' });
  if (!o?.on || !promoCodes(s).some((c) => c.code === o.code)) return null;
  const next = (s.lokAdalatDates || []).find((d) => d.date >= todayIST());
  const endsAt = o.endsAt && new Date(o.endsAt) > new Date() ? o.endsAt
    : next ? new Date(`${next.date}T${next.time || '10:00'}:00+05:30`).toISOString() : '';
  const c = promoCodes(s).find((x) => x.code === o.code);
  return { code: c.code, title: c.title, pays: c.pays, endsAt };
}

// Public: check a promo code typed on the website.
app.get('/api/promo/:code', limit(30, 10 * 60_000), async (req, res) => {
  try {
    const c = promoCodes(await getSettings()).find((x) => x.code === String(req.params.code).toUpperCase().replace(/[^A-Z0-9]/g, ''));
    if (!c) return res.status(404).json({ error: 'invalid_promo' });
    res.json({ code: c.code, title: c.title, pays: c.pays });
  } catch { res.status(500).json({ error: 'storage_unavailable' }); }
});

// Search engines: allow the site, keep the admin panel and API out.
const siteUrl = (req) => (process.env.SITE_URL || (process.env.NODE_ENV === 'production' ? 'https://www.niptao.co.in' : `${req.protocol}://${req.get('host')}`)).replace(/\/$/, '');
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /upload/\n\nSitemap: ${siteUrl(req)}/sitemap.xml\n`);
});
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteUrl(req)}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>${siteUrl(req)}/privacy.html</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>
</urlset>
`);
});

// Public: what the website needs. Only upcoming dates are sent.
app.get('/api/settings', async (req, res) => {
  try {
    const s = await getSettings();
    res.set('Cache-Control', 'no-store');
    res.json({
      whatsapp: s.whatsapp || '', phone: s.phone || s.whatsapp || '',
      lokAdalatDates: (s.lokAdalatDates || []).filter((d) => d.date >= todayIST()),
      promoCodes: promoCodes(s).filter((c) => c.show).map(({ code, title, pays }) => ({ code, title, pays })),
      offer: publicOffer(s),
    });
  } catch (err) {
    console.error('[settings] read failed', err.message);
    res.status(500).json({ error: 'storage_unavailable' });
  }
});

// ── Admin panel API ─────────────────────────────────────
app.get('/api/admin/status', (req, res) => res.json({ enabled: adminEnabled(), storage: store().name, statuses: STATUSES, whatsappApi: waConfigured() }));

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
    res.json({ leads, storage: store().name, docTypes: docTypesOf(await getSettings()) });
  } catch (err) { console.error('[admin] list failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try { const s = await getSettings(); res.json({ ...s, docTypes: docTypesOf(s) }); }
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

// Challans read from Parivahan (by the Niptao Lead Filler add-on) and saved on the lead.
// body: { challans: [{ challanNo, date, offence, location, amount, status }], source?, ownerName? }
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
app.post('/api/admin/leads/:ref/challans', requireUser, async (req, res) => {
  const list = req.body?.challans;
  if (!Array.isArray(list) || list.length > 300) return res.status(400).json({ error: 'invalid_challans' });
  const challans = list.map((c) => ({
    challanNo: clip(c?.challanNo, 60), date: clip(c?.date, 40), offence: clip(c?.offence, 300),
    location: clip(c?.location, 200), status: clip(c?.status, 80), approved: c?.approved === true,
    amount: Math.max(0, Math.round(Number(String(c?.amount ?? '').replace(/[^\d.]/g, '')) || 0)),
  })).filter((c) => c.challanNo || c.offence || c.amount);
  const total = challans.reduce((n, c) => n + c.amount, 0);
  const source = clip(req.body.source, 40) || 'Parivahan';
  const ownerName = clip(req.body.ownerName, 120);
  const note = `Fetched ${challans.length} challan${challans.length === 1 ? '' : 's'} from ${source}`
    + (total ? `, total ₹${total.toLocaleString('en-IN')}` : '') + '.';
  try {
    const lead = await updateLead(req.params.ref, { challans, challansSource: source, note, ...(ownerName ? { rcOwner: { name: ownerName, source } } : {}) },
      req.user.name, req.user.role === 'admin' ? null : req.user.uid);
    if (!lead) return res.status(404).json({ error: 'not_found' });
    res.json({ lead, count: challans.length, total });
  } catch (err) {
    if (err.code === 'forbidden') return res.status(403).json({ error: 'not_your_lead' });
    console.error('[admin] challans save failed', err.message); res.status(500).json({ error: 'storage_unavailable' });
  }
});

// ── Customer documents ──────────────────────────────────
// Upload: the file is the raw request body, ?type=<doc type id>&name=<file name>. Only signed-in team
// members can upload or open them, and staff only on leads assigned to them. Never served publicly.
const DOC_MAX = 5 * 1024 * 1024;
const DOCS_PER_LEAD = 40;
const DOC_KINDS = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// Check the file really is what it says, from its first bytes.
function sniff(buf) {
  if (buf.length < 12) return '';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return '';
}
const canSee = (lead, user) => user.role === 'admin' || lead.agentId === user.uid;
const rawDoc = express.raw({ type: () => true, limit: DOC_MAX });

// Checks and stores one uploaded file on a lead. Returns { lead } or { status, error }.
async function acceptDoc(lead, typeId, buf, fileName, by, { onlyFor = null, fromCustomer = false } = {}) {
  const mime = sniff(buf);
  if (!mime) return { status: 400, error: 'file_type_not_allowed' };
  const types = docTypesOf(await getSettings());
  const type = types.find((t) => t.id === String(typeId || ''));
  if (!type) return { status: 400, error: 'unknown_doc_type' };
  if ((lead.docs || []).length >= DOCS_PER_LEAD) return { status: 400, error: 'too_many_docs' };
  const base = String(fileName || '').replace(/[^\w .()-]/g, '').replace(/\.[^.]*$/, '').trim().slice(0, 60) || type.name;
  const id = lead.ref.toLowerCase().replace(/[^a-z0-9]/g, '') + crypto.randomBytes(8).toString('hex');
  await saveDoc(id, lead.ref, mime, buf);
  let updated;
  try {
    updated = await updateLead(lead.ref, { addDoc: { id, type: type.id, typeName: type.name, name: `${base}.${DOC_KINDS[mime]}`, mime, size: buf.length },
      docTypes: types, fromCustomer, ...(fromCustomer ? { note: `Customer uploaded ${type.name} using the upload link.` } : {}) }, by, onlyFor);
  } catch (err) { await removeDoc(id).catch(() => {}); throw err; }
  if (!updated) { await removeDoc(id).catch(() => {}); return { status: 404, error: 'not_found' }; }
  console.log('[docs] uploaded', lead.ref, type.id, buf.length, fromCustomer ? '(customer)' : '');
  return { lead: updated };
}
const readDoc = (req, res, next) => rawDoc(req, res, (err) => {
  if (err) return res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: err.type === 'entity.too.large' ? 'file_too_large' : 'bad_upload' });
  next();
});

app.post('/api/admin/leads/:ref/docs', requireUser, readDoc, async (req, res) => {
  try {
    const lead = await getLead(req.params.ref);
    if (!lead) return res.status(404).json({ error: 'not_found' });
    if (!canSee(lead, req.user)) return res.status(403).json({ error: 'not_your_lead' });
    const r = await acceptDoc(lead, req.query.type, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.query.name, req.user.name,
      { onlyFor: req.user.role === 'admin' ? null : req.user.uid });
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json({ lead: r.lead });
  } catch (err) {
    if (err.code === 'forbidden') return res.status(403).json({ error: 'not_your_lead' });
    console.error('[docs] upload failed', err.message); res.status(500).json({ error: 'storage_unavailable' });
  }
});

// Upload link for the customer: create (or replace) it, or switch it off.
const LINK_DAYS = 14;
app.post('/api/admin/leads/:ref/doclink', requireUser, async (req, res) => {
  const off = req.body?.off === true;
  try {
    const link = off ? null : { token: crypto.randomBytes(18).toString('base64url'), expiresAt: new Date(Date.now() + LINK_DAYS * 864e5).toISOString() };
    const lead = await updateLead(req.params.ref, { docLink: link, note: off ? 'Customer upload link switched off.' : `Customer upload link created (works for ${LINK_DAYS} days).` },
      req.user.name, req.user.role === 'admin' ? null : req.user.uid);
    if (!lead) return res.status(404).json({ error: 'not_found' });
    res.json({ lead });
  } catch (err) {
    if (err.code === 'forbidden') return res.status(403).json({ error: 'not_your_lead' });
    console.error('[docs] link failed', err.message); res.status(500).json({ error: 'storage_unavailable' });
  }
});

// ── Customer upload page (public, but only with the lead's secret link) ──
// The customer sees which documents are still needed and can add files. They can never see,
// download or delete files, so a forwarded link can't expose anything.
const CLOSED = ['Settled', 'Lost'];
async function linkLead(token) {
  const lead = await leadByDocToken(token);
  if (!lead?.docLink || lead.docLink.token !== token) return { error: 'link_not_found' };
  if (new Date(lead.docLink.expiresAt) < new Date() || CLOSED.includes(lead.status)) return { error: 'link_expired' };
  return { lead };
}
const maskPlate = (p) => (p ? fmtPlateServer(p).replace(/\d(?=\d{2})/g, '•') : '');
const fmtPlateServer = (p) => String(p || '').replace(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/, (m, a, b, c, d) => [a, b, c, d].filter(Boolean).join(' '));

app.get('/api/upload/:token', limit(60, 10 * 60_000), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { lead, error } = await linkLead(req.params.token);
    if (error) return res.status(error === 'link_expired' ? 410 : 404).json({ error });
    const types = docTypesOf(await getSettings());
    const have = (id) => (lead.docs || []).filter((d) => d.type === id).length;
    res.json({
      name: String(lead.name || '').split(' ')[0], plate: maskPlate(lead.plate), lang: lead.lang === 'hi' ? 'hi' : 'en',
      expiresAt: lead.docLink.expiresAt,
      docs: types.map((t) => ({ id: t.id, name: t.name, required: t.required, uploaded: have(t.id) })),
    });
  } catch (err) { console.error('[upload] read failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

app.post('/api/upload/:token', limit(40, 10 * 60_000), readDoc, async (req, res) => {
  try {
    const { lead, error } = await linkLead(req.params.token);
    if (error) return res.status(error === 'link_expired' ? 410 : 404).json({ error });
    const r = await acceptDoc(lead, req.query.type, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.query.name, 'Customer', { fromCustomer: true });
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true, uploaded: (r.lead.docs || []).filter((d) => d.type === req.query.type).length });
  } catch (err) { console.error('[upload] failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

app.get('/api/admin/leads/:ref/docs/:id', requireUser, async (req, res) => {
  try {
    const lead = await getLead(req.params.ref);
    const meta = lead?.docs?.find((d) => d.id === req.params.id);
    if (!meta) return res.status(404).json({ error: 'not_found' });
    if (!canSee(lead, req.user)) return res.status(403).json({ error: 'not_your_lead' });
    const doc = await getDoc(meta.id);
    if (!doc) return res.status(404).json({ error: 'not_found' });
    res.set({ 'Content-Type': meta.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${meta.name.replace(/"/g, '')}"` });
    res.send(Buffer.from(doc.data));
  } catch (err) { console.error('[docs] read failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

app.delete('/api/admin/leads/:ref/docs/:id', requireUser, async (req, res) => {
  try {
    const lead = await getLead(req.params.ref);
    const meta = lead?.docs?.find((d) => d.id === req.params.id);
    if (!meta) return res.status(404).json({ error: 'not_found' });
    const updated = await updateLead(lead.ref, { removeDoc: meta.id, note: `Removed ${meta.typeName}: ${meta.name}` },
      req.user.name, req.user.role === 'admin' ? null : req.user.uid);
    await removeDoc(meta.id);
    res.json({ lead: updated });
  } catch (err) {
    if (err.code === 'forbidden') return res.status(403).json({ error: 'not_your_lead' });
    console.error('[docs] delete failed', err.message); res.status(500).json({ error: 'storage_unavailable' });
  }
});

// Permanently delete a lead. Only the super admin (username "admin") can do this.
app.delete('/api/admin/leads/:ref', requireUser, async (req, res) => {
  if (req.user.uid !== 'super') return res.status(403).json({ error: 'super_admin_only' });
  try {
    const lead = await deleteLead(req.params.ref);
    if (!lead) return res.status(404).json({ error: 'not_found' });
    console.log('[admin] lead deleted', lead.ref, lead.plate);
    res.json({ ok: true });
  } catch (err) { console.error('[admin] delete failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

// Leads: anyone can change status and add notes on leads they can see; only admins reassign.
app.patch('/api/admin/leads/:ref', requireUser, async (req, res) => {
  const b = req.body || {};
  const patch = { status: b.status, note: b.note, approved: Array.isArray(b.approved) ? b.approved.slice(0, 300) : undefined, feeRate: Number(b.feeRate) || undefined,
    waApproval: ['sent', 'received', 'clear'].includes(b.waApproval) ? b.waApproval : undefined, waRead: b.waRead === true, docsSeen: b.docsSeen === true,
    paymentSent: b.paymentSent === true };
  if (b.plate !== undefined) {
    const p = normalizePlate(b.plate);
    if (!PLATE_RE.test(p)) return res.status(400).json({ error: 'invalid_plate' });
    patch.plate = p;
  }
  if (b.rcName !== undefined) {
    const same = b.rcName?.same === true, name = String(b.rcName?.name || '').trim();
    if (!same && name.length < 2) return res.status(400).json({ error: 'rc_name_required' });
    patch.rcName = { same, name };
  }
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

// Payment request for an approved lead: message text, UPI pay link and QR (from Settings).
app.get('/api/admin/leads/:ref/payment', requireUser, async (req, res) => {
  try {
    const lead = (await listLeads()).find((l) => l.ref === req.params.ref);
    if (!lead) return res.status(404).json({ error: 'not_found' });
    if (req.user.role !== 'admin' && lead.agentId !== req.user.uid) return res.status(403).json({ error: 'not_your_lead' });
    const s = await getSettings();
    const pay = s.payment || {};
    if (!pay.upiId) return res.status(409).json({ error: 'payment_not_set' });
    const dates = (s.lokAdalatDates || []).filter((d) => d.date >= todayIST());
    const { payable } = paymentAmounts(lead);
    res.json({ text: paymentMessage(lead, pay, dates), upiId: pay.upiId, payeeName: pay.payeeName || '', upiLink: upiLink(pay, payable, lead.ref), amount: payable, qr: pay.qr || null });
  } catch (err) { console.error('[payment] failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
});

// ── WhatsApp Business Platform ──────────────────────────
// Meta checks the webhook once with GET, then POSTs every incoming message and delivery update.
app.get('/api/whatsapp/webhook', (req, res) => {
  const ok = req.query['hub.mode'] === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN && req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN;
  if (!ok) return res.sendStatus(403);
  res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
});

app.post('/api/whatsapp/webhook', async (req, res) => {
  if (!validSignature(req.rawBody, req.get('x-hub-signature-256'), process.env.WHATSAPP_APP_SECRET)) return res.sendStatus(401);
  res.sendStatus(200); // answer Meta at once; work continues below
  // One webhook at a time, so quick back-to-back messages don't each start a new lead.
  const batch = parseWebhook(req.body);
  waQueue = waQueue.then(() => handleWhatsApp(batch)).catch((err) => console.error('[whatsapp] webhook failed', err.message));
});
let waQueue = Promise.resolve();

// Incoming message → find the customer's lead by mobile (or a lead for a new vehicle number in the
// text), keep the message on it, and mark "I APPROVE" replies. Unknown numbers become new leads.
// opts.by: who captured it (WhatsApp Web add-on); opts.assign: { id, name } for leads it starts.
export async function handleWhatsApp({ messages = [], statuses = [] }, opts = {}) {
  const touched = new Set();
  for (const m of messages) {
    const phone = localPhone(m.from);
    if (!phone) continue;
    const out = m.dir === 'out';
    const mine = (await listLeads()).filter((l) => l.phone === phone);
    if (out && !mine.length) continue; // our own messages never start a lead
    const plateIn = (m.text.toUpperCase().replace(/[^A-Z0-9]/g, ' ').match(/\b[A-Z]{2}\s?\d{1,2}\s?[A-Z]{0,3}\s?\d{4}\b/) || [])[0];
    const plate = plateIn ? normalizePlate(plateIn) : '';
    let lead = (plate && mine.find((l) => l.plate === plate)) || (!plate && mine[0]) || null;
    if (!lead) {
      // Fill in a WhatsApp lead that has no vehicle yet before starting another one.
      const blank = plate && mine.find((l) => !l.plate && l.source === 'WhatsApp');
      if (blank) lead = await updateLead(blank.ref, { plate, note: `Vehicle ${plate} received on WhatsApp.` }, 'WhatsApp');
    }
    if (!lead && out) lead = mine[0];
    if (!lead) {
      const fields = {
        createdAt: m.at, city: mine[0]?.city || 'noida', name: (m.name || mine[0]?.name || 'WhatsApp customer').slice(0, 120), plate: PLATE_RE.test(plate) ? plate : '',
        phone, lang: /[\u0900-\u097F]/.test(m.text) ? 'hi' : 'en', status: 'New', agent: '', agentId: '', notes: [], source: 'WhatsApp',
        ...(mine[0]?.groupRef ? { groupRef: mine[0].groupRef } : {}),
      };
      const base = opts.assign ? { ...fields, agent: opts.assign.name, agentId: opts.assign.id } : await autoAssign(fields);
      const ref = await saveNewLead(CITY_CODES[base.city] || 'GBN', base);
      lead = { ref };
    }
    touched.add(lead.ref);
    await updateLead(lead.ref, { waMsg: { id: m.id, dir: out ? 'out' : 'in', text: m.text, at: m.at, by: out ? (opts.by || 'Team') : (m.name || 'Customer'), ...(out ? { status: 'sent' } : {}), ...(opts.by ? { seen: true } : {}) } }, opts.by || 'WhatsApp');
    if (!out && saysApprove(m.text)) {
      for (const l of mine.filter((x) => x.waApproval?.state === 'sent')) {
        await updateLead(l.ref, { waApproval: 'received', note: `Customer replied on WhatsApp: "${m.text.slice(0, 200)}"` }, 'WhatsApp');
        touched.add(l.ref);
      }
    }
  }
  if (statuses.length) {
    const leads = await listLeads();
    for (const st of statuses) {
      const l = leads.find((x) => (x.waChat || []).some((c) => c.id === st.id));
      if (l) await updateLead(l.ref, { waStatus: st }, 'WhatsApp');
    }
  }
  return [...touched];
}

// WhatsApp Web add-on: a team member opens a chat and presses "Save chat to Niptao". The visible
// messages come here; new customers become leads assigned to whoever saved them (staff) or the
// usual auto-assign (admins). Same matching and "I APPROVE" handling as the API webhook.
app.post('/api/admin/whatsapp-web', requireUser, limit(120, 60_000), async (req, res) => {
  const b = req.body || {};
  const phone = localPhone(String(b.phone || '').replace(/\D/g, '').replace(/^0/, ''));
  if (!phone || !PHONE_RE.test(phone)) return res.status(400).json({ error: 'invalid_phone' });
  const messages = (Array.isArray(b.messages) ? b.messages : []).slice(-60).map((m) => ({
    id: 'web:' + String(m.id || '').slice(0, 120), from: '91' + phone, name: String(b.name || '').slice(0, 120), dir: m.dir === 'out' ? 'out' : 'in',
    text: String(m.text || '').slice(0, 4000), at: !isNaN(new Date(m.at)) ? new Date(m.at).toISOString() : new Date().toISOString(),
  })).filter((m) => m.id !== 'web:' && m.text);
  if (!messages.length && b.create !== true) return res.status(400).json({ error: 'no_messages' });
  // "Add as lead" with nothing to save still needs one line so the lead is created.
  if (!messages.length) messages.push({ id: `web:start:${phone}:${Date.now()}`, from: '91' + phone, name: String(b.name || '').slice(0, 120), dir: 'in', text: '[Lead added from WhatsApp Web]', at: new Date().toISOString() });
  try {
    const assign = req.user.role === 'admin' ? null : { id: req.user.uid, name: req.user.name };
    const run = waQueue.then(() => handleWhatsApp({ messages }, { by: req.user.name, assign }));
    waQueue = run.catch(() => {});
    await run;
    const leads = (await listLeads()).filter((l) => l.phone === phone && (req.user.role === 'admin' || l.agentId === req.user.uid));
    const upiSet = !!(await getSettings()).payment?.upiId;
    res.json({ leads: leads.map((l) => ({ ref: l.ref, name: l.name, plate: l.plate, status: l.status, agent: l.agent, waApproval: l.waApproval?.state || '',
      paymentReady: upiSet && l.waApproval?.state === 'received', paymentSent: !!l.paymentSent })) });
  } catch (err) {
    console.error('[whatsapp-web] save failed', err.message);
    res.status(500).json({ error: 'storage_unavailable' });
  }
});

// Send from the admin panel through the API. Free text only inside the 24-hour window that opens
// when the customer last wrote; outside it, only the approved approval template can be sent.
app.post('/api/admin/leads/:ref/whatsapp', requireUser, limit(60, 60_000), async (req, res) => {
  if (!waConfigured()) return res.status(503).json({ error: 'whatsapp_not_set_up' });
  const b = req.body || {};
  const text = String(b.text || '').trim().slice(0, 4000);
  if (!text) return res.status(400).json({ error: 'empty' });
  try {
    const lead = (await listLeads()).find((l) => l.ref === req.params.ref);
    if (!lead) return res.status(404).json({ error: 'not_found' });
    if (req.user.role !== 'admin' && lead.agentId !== req.user.uid) return res.status(403).json({ error: 'not_your_lead' });
    const open = lead.waLastIn && Date.now() - new Date(lead.waLastIn) < WINDOW_MS;
    const to = '91' + lead.phone;
    let id, sentText = text, kind = 'text';
    if (open) id = await sendText(to, text);
    else if (b.approval && process.env.WHATSAPP_APPROVAL_TEMPLATE) {
      const ok = (lead.challans || []).filter((c) => c.approved);
      const total = ok.reduce((n, c) => n + (c.amount || 0), 0);
      const rate = FEE_RATES.includes(lead.feeRate) ? lead.feeRate : 50;
      const pay = '₹' + Math.round((total * rate) / 100).toLocaleString('en-IN');
      const params = [lead.name, lead.plate, String(ok.length), pay, lead.ref];
      id = await sendTemplate(to, process.env.WHATSAPP_APPROVAL_TEMPLATE, params);
      sentText = `[Approval template] ${lead.name} · ${lead.plate} · ${ok.length} challan(s) · ${pay} · ${lead.ref}`;
      kind = 'template';
    } else return res.status(409).json({ error: 'window_closed' });
    let out = await updateLead(lead.ref, { waMsg: { id, dir: 'out', text: sentText, at: new Date().toISOString(), by: req.user.name, status: 'sent', kind } }, req.user.name);
    if (b.approval) out = await updateLead(lead.ref, { waApproval: 'sent', note: `Sent approval request on WhatsApp (${kind === 'template' ? 'template' : 'full list'}).` }, req.user.name);
    res.json({ lead: out });
  } catch (err) {
    console.error('[whatsapp] send failed', err.message);
    res.status(502).json({ error: 'send_failed', detail: err.message.slice(0, 200) });
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist, { index: false }));
  app.get('/admin', (req, res) => res.sendFile(path.join(dist, 'admin.html')));
  app.get('/upload/:token', (req, res) => { res.set({ 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' }); res.sendFile(path.join(dist, 'upload.html')); });
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`API on http://localhost:${port} · challans: ${providerName()} · otp: ${otpMode()}`));
