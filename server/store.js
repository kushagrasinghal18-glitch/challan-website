import fs from 'node:fs/promises';
import path from 'node:path';

// Lead storage. With DATABASE_URL set, leads live in Postgres (survives restarts
// and redeploys). Without it they go to data/leads.json, which is fine locally but
// is wiped on hosts with throwaway disks such as Render's free plan.
// Every new lead is also POSTed to LEADS_WEBHOOK_URL when set (e.g. a Google Sheet).

// Share of the approved challan total the customer pays. 50% is the advertised default.
export const FEE_RATES = [50, 40, 30];

export const STATUSES = ['New', 'Contacted', 'Documents received', 'Scheduled', 'Settled', 'Lost'];

// ── File backend ────────────────────────────────────────
const file = () => path.resolve(process.env.LEADS_FILE || 'data/leads.json');
let queue = Promise.resolve();

async function readFile() {
  try { return JSON.parse(await fs.readFile(file(), 'utf8')); } catch { return []; }
}

// Serialise read-modify-write so two requests in the same instant don't clobber each other.
function withFile(fn) {
  const run = queue.then(async () => {
    const leads = await readFile();
    const out = fn(leads);
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(file(), JSON.stringify(leads, null, 2));
    return out;
  });
  queue = run.catch(() => {});
  return run;
}

const fileStore = {
  name: 'file',
  add: (lead) => withFile((leads) => { leads.unshift(lead); }),
  list: () => readFile(),
  update: (ref, fn) => withFile((leads) => {
    const lead = leads.find((l) => l.ref === ref);
    return lead ? Object.assign(lead, fn(lead)) : null;
  }),
  remove: (ref) => withFile((leads) => {
    const i = leads.findIndex((l) => l.ref === ref);
    return i >= 0 ? leads.splice(i, 1)[0] : null;
  }),
};

// ── Postgres backend ────────────────────────────────────
let pool;
async function db() {
  if (!pool) {
    const { default: pg } = await import('pg');
    const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
    await pool.query(`CREATE TABLE IF NOT EXISTS leads (
      ref text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      data jsonb NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    )`);
  }
  return pool;
}

const pgStore = {
  name: 'postgres',
  async add(lead) {
    await (await db()).query('INSERT INTO leads (ref, created_at, data) VALUES ($1, $2, $3)', [lead.ref, lead.createdAt, lead]);
  },
  async list() {
    const { rows } = await (await db()).query('SELECT data FROM leads ORDER BY created_at DESC LIMIT 5000');
    return rows.map((r) => r.data);
  },
  async remove(ref) {
    const { rows } = await (await db()).query('DELETE FROM leads WHERE ref = $1 RETURNING data', [ref]);
    return rows[0]?.data || null;
  },
  async update(ref, fn) {
    const client = await (await db()).connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT data FROM leads WHERE ref = $1 FOR UPDATE', [ref]);
      if (!rows[0]) { await client.query('ROLLBACK'); return null; }
      const lead = { ...rows[0].data, ...fn(rows[0].data) };
      await client.query('UPDATE leads SET data = $2 WHERE ref = $1', [ref, lead]);
      await client.query('COMMIT');
      return lead;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally { client.release(); }
  },
};

export const store = () => (process.env.DATABASE_URL ? pgStore : fileStore);

// ── Public API ──────────────────────────────────────────
async function sendToWebhook(lead) {
  const url = process.env.LEADS_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lead),
      redirect: 'follow', signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    // Keep the full lead in the log so nothing is lost if the webhook is down.
    console.error('[leads] webhook failed:', err.message, JSON.stringify(lead));
  }
}

export async function addLead(lead) {
  try {
    await store().add(lead);
  } catch (err) {
    if (err.code !== '23505') { // not a duplicate ref: keep the lead somewhere
      console.error('[leads] save failed:', err.message, JSON.stringify(lead));
      sendToWebhook(lead);
    }
    throw err;
  }
  console.log('[leads] new', lead.ref, lead.plate);
  sendToWebhook(lead);
}

export const listLeads = () => store().list();
export const deleteLead = (ref) => store().remove(ref);

// patch: { status?, assign?: { id, name }, note? } — note is appended with who wrote it and when.
// onlyFor: a staff id; the update is refused unless the lead is assigned to them.
export function updateLead(ref, patch, by, onlyFor) {
  return store().update(ref, (lead) => {
    if (onlyFor && lead.agentId !== onlyFor) throw Object.assign(new Error('not your lead'), { code: 'forbidden' });
    const out = {};
    if (STATUSES.includes(patch.status)) out.status = patch.status;
    if (patch.assign) { out.agentId = patch.assign.id; out.agent = patch.assign.name; }
    if (FEE_RATES.includes(patch.feeRate)) out.feeRate = patch.feeRate;
    // approved: indexes into lead.challans that the customer agreed to settle.
    if (Array.isArray(patch.approved) && Array.isArray(lead.challans)) {
      const pick = new Set(patch.approved.filter(Number.isInteger));
      out.challans = lead.challans.map((c, i) => ({ ...c, approved: pick.has(i) }));
      out.approvedAt = new Date().toISOString();
      out.approvedBy = by;
    }
    // Written approval over WhatsApp: 'sent' snapshots what was asked for, 'received' records the customer's yes.
    if (patch.waApproval === 'sent') {
      const ok = (lead.challans || []).filter((c) => c.approved);
      out.waApproval = { state: 'sent', sentAt: new Date().toISOString(), sentBy: by, challanNos: ok.map((c) => c.challanNo || ''),
        total: ok.reduce((n, c) => n + (c.amount || 0), 0), feeRate: FEE_RATES.includes(lead.feeRate) ? lead.feeRate : 50 };
    } else if (patch.waApproval === 'received' && lead.waApproval) {
      out.waApproval = { ...lead.waApproval, state: 'received', receivedAt: new Date().toISOString(), receivedBy: by };
    } else if (patch.waApproval === 'clear') {
      out.waApproval = null;
    }
    if (typeof patch.plate === 'string' && patch.plate) out.plate = patch.plate;
    // WhatsApp chat kept on the lead (latest 200 messages).
    if (patch.waMsg) {
      if ((lead.waChat || []).some((m) => m.id && m.id === patch.waMsg.id)) return {}; // Meta can resend a webhook
      out.waChat = [...(lead.waChat || []), patch.waMsg].slice(-200);
      if (patch.waMsg.dir === 'in') { out.waLastIn = patch.waMsg.at; if (!patch.waMsg.seen) out.waUnread = (lead.waUnread || 0) + 1; }
    }
    if (patch.waStatus && Array.isArray(lead.waChat)) {
      const rank = { sent: 1, delivered: 2, read: 3, failed: 4 };
      out.waChat = lead.waChat.map((m) => (m.id === patch.waStatus.id && (rank[patch.waStatus.status] || 0) > (rank[m.status] || 0)
        ? { ...m, status: patch.waStatus.status, ...(patch.waStatus.error ? { error: patch.waStatus.error } : {}) } : m));
    }
    if (patch.waRead) out.waUnread = 0;
    if (patch.paymentSent) {
      const ok = (lead.challans || []).filter((c) => c.approved);
      const rate = FEE_RATES.includes(lead.feeRate) ? lead.feeRate : 50;
      out.paymentSent = { at: new Date().toISOString(), by, amount: Math.round((ok.reduce((n, c) => n + (c.amount || 0), 0) * rate) / 100) };
    }
    if (Array.isArray(patch.challans)) {
      out.challans = patch.challans;
      out.challansAt = new Date().toISOString();
      out.challansBy = by;
      out.challansSource = patch.challansSource || '';
    }
    if (typeof patch.note === 'string' && patch.note.trim()) {
      out.notes = [{ by, at: new Date().toISOString(), text: patch.note.trim().slice(0, 2000) }, ...(lead.notes || [])];
    }
    out.updatedAt = new Date().toISOString();
    return out;
  });
}

// ── Key/value records: site settings, staff accounts ───
// 'site'  → { whatsapp, phone, autoAssign, lokAdalatDates: [{ id, date, time, city, note }] }
// 'staff' → [{ id, name, username, passHash, role: 'admin' | 'staff', active, createdAt }]
// 'rr'    → { lastId } round-robin pointer for auto-assign
const kvFile = (key) => path.join(path.dirname(file()), key === 'site' ? 'settings.json' : `${key}.json`);

export async function getKV(key, fallback) {
  if (process.env.DATABASE_URL) {
    const { rows } = await (await db()).query('SELECT value FROM settings WHERE key = $1', [key]);
    return rows[0]?.value ?? fallback;
  }
  try { return JSON.parse(await fs.readFile(kvFile(key), 'utf8')); } catch { return fallback; }
}

export async function setKV(key, value) {
  if (process.env.DATABASE_URL) {
    await (await db()).query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]);
    return value;
  }
  await fs.mkdir(path.dirname(kvFile(key)), { recursive: true });
  await fs.writeFile(kvFile(key), JSON.stringify(value, null, 2));
  return value;
}

export const getSettings = () => getKV('site', {});
export const saveSettings = (value) => setKV('site', value);
export const listStaff = () => getKV('staff', []);
export const saveStaff = (list) => setKV('staff', list);

// Next active staff member after the last one who got a lead, or null when nobody is active.
export async function nextAssignee() {
  const staff = (await listStaff()).filter((u) => u.active && u.role === 'staff');
  if (!staff.length) return null;
  const { lastId } = await getKV('rr', {});
  const i = staff.findIndex((u) => u.id === lastId);
  const pick = staff[(i + 1) % staff.length];
  await setKV('rr', { lastId: pick.id });
  return pick;
}
