import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LEADS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'leads-')), 'leads.json');
delete process.env.DATABASE_URL;
const { addLead, listLeads, updateLead } = await import('./store.js');

test('file store adds, lists newest first and updates leads', async () => {
  await addLead({ ref: 'GBN-1', createdAt: '2026-10-01T00:00:00Z', name: 'A', plate: 'UP16AB1234', phone: '9876543210', status: 'New', notes: [] });
  await addLead({ ref: 'GBN-2', createdAt: '2026-10-02T00:00:00Z', name: 'B', plate: 'UP16AB1235', phone: '9876543211', status: 'New', notes: [] });
  assert.deepEqual((await listLeads()).map((l) => l.ref), ['GBN-2', 'GBN-1']);

  const l = await updateLead('GBN-1', { status: 'Contacted', agent: ' Priya ', note: 'Called' }, 'Kushagra');
  assert.equal(l.status, 'Contacted');
  assert.equal(l.agent, 'Priya');
  assert.equal(l.notes[0].by, 'Kushagra');
  assert.equal(l.notes[0].text, 'Called');

  assert.equal((await updateLead('GBN-1', { status: 'Not a status' }, 'K')).status, 'Contacted');
  assert.equal(await updateLead('NOPE', { status: 'Lost' }, 'K'), null);
});
