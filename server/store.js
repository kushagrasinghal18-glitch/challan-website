import fs from 'node:fs/promises';
import path from 'node:path';

// Lead storage. With DATABASE_URL set, leads live in Postgres (survives restarts
// and redeploys). Without it they go to data/leads.json, which is fine locally but
// is wiped on hosts with throwaway disks such as Render's free plan.
// Every new lead is also POSTed to LEADS_WEBHOOK_URL when set (e.g. a Google Sheet).

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

// patch: { status?, assign?: { id, name }, note? } — note is appended with who wrote it and when.
// onlyFor: a staff id; the update is refused unless the lead is assigned to them.
export function updateLead(ref, patch, by, onlyFor) {
  return store().update(ref, (lead) => {
    if (onlyFor && lead.agentId !== onlyFor) throw Object.assign(new Error('not your lead'), { code: 'forbidden' });
    const out = {};
    if (STATUSES.includes(patch.status)) out.status = patch.status;
    if (patch.assign) { out.agentId = patch.assign.id; out.agent = patch.assign.name; }
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
