import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.LEADS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'leads-')), 'leads.json');
delete process.env.DATABASE_URL;
const { addLead, listLeads, updateLead, deleteLead, saveStaff, nextAssignee } = await import('./store.js');
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

test('challans are saved on the lead with who fetched them', async () => {
  const l = await updateLead('GBN-1', { challans: [{ challanNo: 'DL1', amount: 500 }], challansSource: 'Parivahan', note: 'Fetched 1 challan' }, 'Priya', 'u1');
  assert.equal(l.challans[0].challanNo, 'DL1');
  assert.equal(l.challansBy, 'Priya');
  assert.ok(l.challansAt);
  assert.equal(l.notes[0].text, 'Fetched 1 challan');
});

test('customer-approved challans are marked on the lead', async () => {
  await updateLead('GBN-1', { challans: [{ challanNo: 'A', amount: 500 }, { challanNo: 'B', amount: 1000 }] }, 'Priya');
  const l = await updateLead('GBN-1', { approved: [1, 'x', 7] }, 'Priya');
  assert.deepEqual(l.challans.map((c) => c.approved), [false, true]);
  assert.equal(l.approvedBy, 'Priya');
  assert.equal((await updateLead('GBN-1', { feeRate: 40 }, 'Priya')).feeRate, 40);
  assert.equal((await updateLead('GBN-1', { feeRate: 10 }, 'Priya')).feeRate, 40);
});

test('WhatsApp approval records what was sent and when the customer agreed', async () => {
  const sent = await updateLead('GBN-1', { waApproval: 'sent' }, 'Priya');
  assert.deepEqual(sent.waApproval.challanNos, ['B']);
  assert.equal(sent.waApproval.total, 1000);
  assert.equal(sent.waApproval.feeRate, 40);
  const got = await updateLead('GBN-1', { waApproval: 'received' }, 'Amit');
  assert.equal(got.waApproval.state, 'received');
  assert.equal(got.waApproval.receivedBy, 'Amit');
  assert.equal((await updateLead('GBN-1', { waApproval: 'clear' }, 'Amit')).waApproval, null);
});

test('payment details sent are recorded with the amount', async () => {
  await updateLead('GBN-1', { challans: [{ challanNo: 'A', amount: 500, approved: true }, { challanNo: 'B', amount: 1000, approved: true }] }, 'Priya');
  const l = await updateLead('GBN-1', { paymentSent: true }, 'Priya');
  assert.equal(l.paymentSent.by, 'Priya');
  assert.equal(l.paymentSent.amount, 600); // 40% from the earlier feeRate test
});

test('a lead can be deleted', async () => {
  await addLead({ ref: 'GBN-9', createdAt: '2026-10-03T00:00:00Z', name: 'Z', plate: 'UP16AB9999', phone: '9876543299', status: 'New', notes: [] });
  assert.equal((await deleteLead('GBN-9')).ref, 'GBN-9');
  assert.equal(await deleteLead('GBN-9'), null);
  assert.ok(!(await listLeads()).some((l) => l.ref === 'GBN-9'));
});
