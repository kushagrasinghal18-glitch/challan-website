import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LEADS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'leads-')), 'leads.json');
delete process.env.DATABASE_URL;
const { addLead, listLeads, updateLead, saveStaff, nextAssignee } = await import('./store.js');
const { hashPassword, verifyPassword } = await import('./auth.js');

test('file store adds, lists newest first and updates leads', async () => {
  await addLead({ ref: 'GBN-1', createdAt: '2026-10-01T00:00:00Z', name: 'A', plate: 'UP16AB1234', phone: '9876543210', status: 'New', notes: [] });
  await addLead({ ref: 'GBN-2', createdAt: '2026-10-02T00:00:00Z', name: 'B', plate: 'UP16AB1235', phone: '9876543211', status: 'New', notes: [] });
  assert.deepEqual((await listLeads()).map((l) => l.ref), ['GBN-2', 'GBN-1']);

  const l = await updateLead('GBN-1', { status: 'Contacted', assign: { id: 'u1', name: 'Priya' }, note: 'Called' }, 'Kushagra');
  assert.equal(l.status, 'Contacted');
  assert.equal(l.agent, 'Priya');
  assert.equal(l.agentId, 'u1');
  assert.equal(l.notes[0].by, 'Kushagra');
  assert.equal(l.notes[0].text, 'Called');

  assert.equal((await updateLead('GBN-1', { status: 'Not a status' }, 'K')).status, 'Contacted');
  assert.equal(await updateLead('NOPE', { status: 'Lost' }, 'K'), null);
});

test('staff can only update leads assigned to them', async () => {
  await assert.rejects(updateLead('GBN-2', { status: 'Lost' }, 'Priya', 'u1'), { code: 'forbidden' });
  assert.equal((await updateLead('GBN-1', { status: 'Scheduled' }, 'Priya', 'u1')).status, 'Scheduled');
});

test('auto-assign rotates through active staff only', async () => {
  await saveStaff([
    { id: 'a', name: 'A', role: 'staff', active: true },
    { id: 'b', name: 'B', role: 'staff', active: false },
    { id: 'c', name: 'C', role: 'staff', active: true },
    { id: 'd', name: 'D', role: 'admin', active: true },
  ]);
  const picks = [];
  for (let i = 0; i < 4; i++) picks.push((await nextAssignee()).id);
  assert.deepEqual(picks, ['a', 'c', 'a', 'c']);
  await saveStaff([]);
  assert.equal(await nextAssignee(), null);
});

test('passwords are hashed and verified', () => {
  const h = hashPassword('secret-123');
  assert.ok(h.startsWith('scrypt$') && !h.includes('secret-123'));
  assert.equal(verifyPassword('secret-123', h), true);
  assert.equal(verifyPassword('wrong', h), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
});
