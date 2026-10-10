import fs from 'node:fs/promises';
import path from 'node:path';
import { nameMatch } from './names.js';

// Lead storage. With DATABASE_URL set, leads live in Postgres (survives restarts
// and redeploys). Without it they go to data/leads.json, which is fine locally but
// is wiped on hosts with throwaway disks such as Render's free plan.
// Every new lead is also POSTed to LEADS_WEBHOOK_URL when set (e.g. a Google Sheet).

// Share of the approved challan total the customer pays. 50% is the advertised default.
export const FEE_RATES = [50, 40, 30];

export const STATUSES = ['New', 'Contacted', 'Payment received', 'Documents received', 'Documents verified', 'Scheduled', 'Settled', 'Lost'];
// Stages a lead can be in and still be moved on to "Documents received" by itself once every document is in.
const BEFORE_DOCS = ['New', 'Contacted', 'Payment received'];

// Document types the team collects, set in Settings. These are used until the admin saves their own list.
export const DEFAULT_DOC_TYPES = [
  { id: 'rc', name: 'RC (registration certificate)', required: true },
  { id: 'dl', name: 'Driving licence', required: true },
  { id: 'aadhaar', name: 'Aadhaar card', required: true },
];
export const docTypesOf = (site) => (Array.isArray(site?.docTypes) ? site.docTypes : DEFAULT_DOC_TYPES);
// Required types that have no file yet.
export const docsMissing = (lead, types) => types.filter((t) => t.required && !(lead.docs || []).some((d) => d.type === t.id));

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
let pool, ready;
// Tables are created on first use. If that fails (database asleep or unreachable), the next call tries again.
async function db() {
  if (!ready) ready = (async () => {
    const { default: pg } = await import('pg');
    if (!pool) {
      const local = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
    }
    await pool.query(`CREATE TABLE IF NOT EXISTS leads (
      ref text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      data jsonb NOT NULL
    )`);
    // Customers' documents. Only the admin API reads these, never a public route.
    await pool.query(`CREATE TABLE IF NOT EXISTS lead_docs (
      id text PRIMARY KEY,
      ref text NOT NULL,
      mime text NOT NULL,
      data bytea NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query('CREATE INDEX IF NOT EXISTS lead_docs_ref ON lead_docs (ref)');
    await pool.query(`CREATE TABLE IF NOT EXISTS settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    )`);
  })().catch((err) => { ready = null; throw err; });
  await ready;
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

export async function getLead(ref) {
  if (process.env.DATABASE_URL) {
    const { rows } = await (await db()).query('SELECT data FROM leads WHERE ref = $1', [ref]);
    return rows[0]?.data || null;
  }
  return (await readFile()).find((l) => l.ref === ref) || null;
}

// The lead a customer upload link belongs to (the token is long and random).
export async function leadByDocToken(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token || '')) return null;
  if (process.env.DATABASE_URL) {
    const { rows } = await (await db()).query("SELECT data FROM leads WHERE data->'docLink'->>'token' = $1 LIMIT 1", [token]);
    return rows[0]?.data || null;
  }
  return (await readFile()).find((l) => l.docLink?.token === token) || null;
}

export async function deleteLead(ref) {
  const lead = await store().remove(ref);
  if (lead) await removeDocsFor(ref).catch((err) => console.error('[docs] cleanup failed', ref, err.message));
  return lead;
}

// ── Document files ──────────────────────────────────────
// Postgres when DATABASE_URL is set (survives redeploys), else data/docs/ next to leads.json.
const docDir = () => path.join(path.dirname(file()), 'docs');
const safeId = (id) => /^[a-z0-9]{8,40}$/.test(id);

export async function saveDoc(id, ref, mime, data) {
  if (!safeId(id)) throw new Error('bad doc id');
  if (process.env.DATABASE_URL) {
    await (await db()).query('INSERT INTO lead_docs (id, ref, mime, data) VALUES ($1, $2, $3, $4)', [id, ref, mime, data]);
    return;
  }
  await fs.mkdir(docDir(), { recursive: true });
  await fs.writeFile(path.join(docDir(), id), data);
}

export async function getDoc(id) {
  if (!safeId(id)) return null;
  if (process.env.DATABASE_URL) {
    const { rows } = await (await db()).query('SELECT ref, mime, data FROM lead_docs WHERE id = $1', [id]);
    return rows[0] || null;
  }
  try { return { data: await fs.readFile(path.join(docDir(), id)) }; } catch { return null; }
}

export async function removeDoc(id) {
  if (!safeId(id)) return;
  if (process.env.DATABASE_URL) { await (await db()).query('DELETE FROM lead_docs WHERE id = $1', [id]); return; }
  await fs.rm(path.join(docDir(), id), { force: true });
}

async function removeDocsFor(ref) {
  if (process.env.DATABASE_URL) { await (await db()).query('DELETE FROM lead_docs WHERE ref = $1', [ref]); return; }
  // File backend: the lead record is already gone, so files are matched by the id prefix set at upload.
  const prefix = ref.toLowerCase().replace(/[^a-z0-9]/g, '');
  const names = await fs.readdir(docDir()).catch(() => []);
  await Promise.all(names.filter((n) => n.startsWith(prefix)).map((n) => fs.rm(path.join(docDir(), n), { force: true })));
}

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
    // Vehicles from the same customer are separate leads linked by groupRef; vehicles = how many in the group.
    if (patch.group) { out.groupRef = patch.group.groupRef; out.vehicles = patch.group.vehicles; }
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
    // Money actually received, as entered and confirmed by the team. Moves an early lead to Payment received.
    if (patch.paymentReceived) {
      out.payment = { amount: patch.paymentReceived.amount, at: new Date().toISOString(), by };
      if (['New', 'Contacted'].includes(out.status || lead.status)) out.status = 'Payment received';
    }
    if (patch.paymentSent) {
      const ok = (lead.challans || []).filter((c) => c.approved);
      const rate = FEE_RATES.includes(lead.feeRate) ? lead.feeRate : 50;
      out.paymentSent = { at: new Date().toISOString(), by, amount: Math.round((ok.reduce((n, c) => n + (c.amount || 0), 0) * rate) / 100) };
    }
    // Vehicle owner's name as shown on Parivahan, with how it compares to the name the customer gave.
    if (patch.rcOwner && typeof patch.rcOwner.name === 'string' && patch.rcOwner.name.trim()) {
      const name = patch.rcOwner.name.trim().slice(0, 120);
      out.rcOwner = { name, at: new Date().toISOString(), source: patch.rcOwner.source || 'Parivahan', match: nameMatch(lead.name, name) };
      // A clear match fills in "RC is in the customer's name" unless someone already set the RC name.
      if (out.rcOwner.match === 'match' && !lead.rcName) out.rcName = { same: true, name: '', at: out.rcOwner.at, by: `${out.rcOwner.source} check` };
    }
    // Name on the RC. Messages to the customer always use lead.name.
    if (patch.rcName && typeof patch.rcName === 'object') {
      const same = patch.rcName.same === true;
      out.rcName = { same, name: same ? '' : String(patch.rcName.name || '').replace(/\s+/g, ' ').trim().slice(0, 120), at: new Date().toISOString(), by };
    }
    // Mobile number registered on the RC (the one Parivahan/VAHAN OTPs go to). Messages still use lead.phone.
    if (patch.rcMobile && typeof patch.rcMobile === 'object') {
      const same = patch.rcMobile.same === true;
      out.rcMobile = { same, phone: same ? '' : String(patch.rcMobile.phone || ''), at: new Date().toISOString(), by };
    }
    // Uploaded documents (only the details here; the file itself is kept by saveDoc).
    const autoNotes = [];
    if (patch.addDoc) {
      out.docs = [...(lead.docs || []), { ...patch.addDoc, at: new Date().toISOString(), by }];
      if (patch.fromCustomer) out.docsNew = (lead.docsNew || 0) + 1;
      const types = patch.docTypes || [];
      const status = out.status || lead.status;
      if (types.some((t) => t.required) && !docsMissing({ docs: out.docs }, types).length && BEFORE_DOCS.includes(status)) {
        out.status = 'Documents received';
        autoNotes.push('All documents uploaded. Moved to Documents received.');
      }
    }
    // Court tokens: { id, date (YYYY-MM-DD), number, challans: [challan numbers], name, mime, size }. The file is kept by saveDoc like documents.
    // A challan belongs to one token at most, so giving it to a token takes it off any other.
    const claim = (tokens, id, nos) => tokens.map((t) => (t.id === id ? { ...t, challans: nos } : { ...t, challans: (t.challans || []).filter((n) => !nos.includes(n)) }));
    if (patch.addToken) {
      out.tokens = claim([...(lead.tokens || []), { ...patch.addToken, at: new Date().toISOString(), by }], patch.addToken.id, patch.addToken.challans || []);
      const status = out.status || lead.status;
      autoNotes.push(`Token uploaded for ${patch.addToken.date}${patch.addToken.number ? ` (${patch.addToken.number})` : ''}${patch.addToken.challans?.length ? `, challans ${patch.addToken.challans.join(', ')}` : ''}.`);
      if (!['Scheduled', 'Settled', 'Lost'].includes(status)) {
        out.status = 'Scheduled';
        autoNotes.push('Moved to Scheduled.');
      }
    }
    if (patch.tokenChallans && (lead.tokens || []).some((t) => t.id === patch.tokenChallans.id)) {
      out.tokens = claim(lead.tokens, patch.tokenChallans.id, patch.tokenChallans.challans || []);
    }
    if (patch.removeToken) out.tokens = (lead.tokens || []).filter((t) => t.id !== patch.removeToken);
    if (patch.paymentReceived) autoNotes.push(`Payment received: ₹${patch.paymentReceived.amount.toLocaleString('en-IN')} (confirmed by ${by}).`);
    if (patch.docsSeen) out.docsNew = 0;
    // Private upload link for the customer: { token, expiresAt } or null to switch it off.
    if (patch.docLink !== undefined) out.docLink = patch.docLink ? { ...patch.docLink, at: new Date().toISOString(), by } : null;
    if (patch.removeDoc) out.docs = (lead.docs || []).filter((d) => d.id !== patch.removeDoc);
    if (Array.isArray(patch.challans)) {
      out.challans = patch.challans;
      out.challansAt = new Date().toISOString();
      out.challansBy = by;
      out.challansSource = patch.challansSource || '';
    }
    if (typeof patch.note === 'string' && patch.note.trim()) autoNotes.unshift(patch.note.trim().slice(0, 2000));
    if (autoNotes.length) {
      out.notes = [...autoNotes.reverse().map((text) => ({ by, at: new Date().toISOString(), text })), ...(lead.notes || [])];
    }
    // When each stage was reached, for analytics (time to settle, settled this month).
    if (out.status && out.status !== lead.status) {
      out.statusLog = [...(lead.statusLog || []), { status: out.status, at: new Date().toISOString(), by }].slice(-50);
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
