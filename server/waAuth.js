// Where the WhatsApp login (Baileys keys) is kept, so a restart or redeploy doesn't need a new QR scan.
// With DATABASE_URL: the wa_auth table in Postgres. Without it: data/wa-auth.json (fine for local testing).
// Everything is cached in memory; writes go through to storage.
import fs from 'node:fs/promises';
import path from 'node:path';
import { BufferJSON, initAuthCreds, proto } from 'baileys';
import { db } from './store.js';

const authFile = () => path.join(path.dirname(path.resolve(process.env.LEADS_FILE || 'data/leads.json')), 'wa-auth.json');

function pgBackend() {
  let made;
  const ready = async () => {
    const pool = await db();
    if (!made) made = pool.query('CREATE TABLE IF NOT EXISTS wa_auth (id text PRIMARY KEY, data text NOT NULL)').catch((err) => { made = null; throw err; });
    await made;
    return pool;
  };
  return {
    async loadAll() {
      const { rows } = await (await ready()).query('SELECT id, data FROM wa_auth');
      return new Map(rows.map((r) => [r.id, r.data]));
    },
    async write(sets, dels) {
      const pool = await ready();
      if (sets.length) {
        // One statement for the whole batch: the first login writes several hundred keys.
        await pool.query(`INSERT INTO wa_auth (id, data) SELECT * FROM unnest($1::text[], $2::text[])
          ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [sets.map((s) => s[0]), sets.map((s) => s[1])]);
      }
      if (dels.length) await pool.query('DELETE FROM wa_auth WHERE id = ANY($1::text[])', [dels]);
    },
    async clear() { await (await ready()).query('DELETE FROM wa_auth'); },
  };
}

function fileBackend() {
  let all = null, saving = Promise.resolve();
  const save = () => (saving = saving.then(async () => {
    await fs.mkdir(path.dirname(authFile()), { recursive: true });
    await fs.writeFile(authFile(), JSON.stringify(Object.fromEntries(all)));
  }).catch((err) => console.error('[wa] auth save failed', err.message)));
  return {
    async loadAll() {
      try { all = new Map(Object.entries(JSON.parse(await fs.readFile(authFile(), 'utf8')))); } catch { all = new Map(); }
      return new Map(all);
    },
    async write(sets, dels) {
      for (const [id, data] of sets) all.set(id, data);
      for (const id of dels) all.delete(id);
      await save();
    },
    async clear() { all = new Map(); await save(); },
  };
}

const backend = () => (process.env.DATABASE_URL ? pgBackend() : fileBackend());

// Has a WhatsApp number been linked before (so the server should reconnect by itself on start)?
export async function hasSavedLogin() {
  try { return (await backend().loadAll()).has('creds'); } catch { return false; }
}

export async function clearLogin() { await backend().clear(); }

// Same shape as Baileys' useMultiFileAuthState.
export async function useStoredAuthState() {
  const store = backend();
  const raw = await store.loadAll();
  const read = (id) => (raw.has(id) ? JSON.parse(raw.get(id), BufferJSON.reviver) : null);
  const creds = read('creds') || initAuthCreds();
  // Writes are queued so they reach storage in the order Baileys made them.
  let queue = Promise.resolve();
  const write = (sets, dels) => {
    for (const [id, data] of sets) raw.set(id, data);
    for (const id of dels) raw.delete(id);
    queue = queue.then(() => store.write(sets, dels)).catch((err) => console.error('[wa] auth write failed', err.message));
    return queue;
  };
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          for (const id of ids) {
            let value = read(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            out[id] = value;
          }
          return out;
        },
        set: async (data) => {
          const sets = [], dels = [];
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id];
              if (value) sets.push([`${type}-${id}`, JSON.stringify(value, BufferJSON.replacer)]);
              else dels.push(`${type}-${id}`);
            }
          }
          await write(sets, dels);
        },
      },
    },
    saveCreds: () => write([['creds', JSON.stringify(creds, BufferJSON.replacer)]], []),
  };
}
