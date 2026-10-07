import fs from 'node:fs/promises';
import path from 'node:path';

// Leads land in data/leads.json and, when LEADS_WEBHOOK_URL is set, are also
// POSTed there (e.g. a Google Sheet via Apps Script). On hosts whose disk is
// wiped on restart (Render free), the webhook is the copy that survives.
const FILE = path.resolve(process.env.LEADS_FILE || 'data/leads.json');
let queue = Promise.resolve();

export async function readLeads() {
  try { return JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { return []; }
}

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

export function addLead(lead) {
  console.log('[leads] new', lead.ref, lead.plate);
  sendToWebhook(lead);
  // Serialise writes so two submissions in the same instant don't clobber each other.
  queue = queue.then(async () => {
    const leads = await readLeads();
    leads.unshift(lead);
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(leads, null, 2));
  });
  return queue;
}
