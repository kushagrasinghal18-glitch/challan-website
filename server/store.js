import fs from 'node:fs/promises';
import path from 'node:path';

// Leads land in data/leads.json, one record per booking / manual-check / alert
// request. Fine for a pilot; move to a database before real traffic.
const FILE = path.resolve(process.env.LEADS_FILE || 'data/leads.json');
let queue = Promise.resolve();

export async function readLeads() {
  try { return JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { return []; }
}

export function addLead(lead) {
  // Serialise writes so two submissions in the same instant don't clobber each other.
  queue = queue.then(async () => {
    const leads = await readLeads();
    leads.unshift(lead);
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(leads, null, 2));
  });
  return queue;
}
