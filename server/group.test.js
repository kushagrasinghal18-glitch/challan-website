import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LEADS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'niptao-group-')), 'leads.json');
process.env.PORT = String(20000 + Math.floor(Math.random() * 20000));
delete process.env.DATABASE_URL;

test('one customer\'s vehicles are linked by phone, however they came in', async (t) => {
  const store = await import('./store.js');
  const lead = (ref, plate, at, extra = {}) => ({ ref, createdAt: at, name: 'Shubham', phone: '9811100001', plate, status: 'New', notes: [], ...extra });
  // Sent separately before linking existed, plus an old settled case that stays apart.
  await store.addLead(lead('GBN-1', 'DL1CAA1111', '2026-10-01T00:00:00Z', { agent: 'Asha', agentId: 'a1' }));
  await store.addLead(lead('GBN-2', 'DL1CAA2222', '2026-10-02T00:00:00Z'));
  await store.addLead(lead('GBN-0', 'DL1CAA0000', '2026-09-01T00:00:00Z', { status: 'Settled' }));
  await store.addLead({ ...lead('GBN-9', 'UP16AB9999', '2026-10-02T00:00:00Z'), phone: '9811100002' });

  const index = await import('./index.js');
  t.after(() => index.server.close());
  await new Promise((r) => setTimeout(r, 100)); // linking runs on start
  const mine = async () => (await store.listLeads()).filter((l) => l.phone === '9811100001');
  let open = (await mine()).filter((l) => l.status !== 'Settled');
  assert.deepEqual(open.map((l) => [l.groupRef, l.vehicles]), [['GBN-1', 2], ['GBN-1', 2]]);
  assert.equal((await mine()).find((l) => l.ref === 'GBN-0').groupRef, undefined);

  // The same customer fills the website form again with two more cars: all four in one group, same person.
  const res = await fetch(`http://localhost:${process.env.PORT}/api/leads`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Shubham Kansal', phone: '9811100001', plate: 'DL1CAA3333', extraPlates: ['DL1CAA4444'], consent: true, city: 'delhi' }) });
  assert.equal(res.status, 200);
  open = (await mine()).filter((l) => l.status !== 'Settled');
  assert.equal(open.length, 4);
  assert.ok(open.every((l) => l.groupRef === 'GBN-1' && l.vehicles === 4));
  assert.ok(open.filter((l) => !['GBN-1', 'GBN-2'].includes(l.ref)).every((l) => l.agentId === 'a1'));
  assert.equal((await store.listLeads()).find((l) => l.ref === 'GBN-9').groupRef, undefined);
});
