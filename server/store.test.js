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

test('documents: all needed ones move the lead to Documents received', async () => {
  const { saveDoc, getDoc, getLead, DEFAULT_DOC_TYPES } = await import('./store.js');
  await addLead({ ref: 'DOC-1', createdAt: '2026-10-09T00:00:00Z', name: 'Rahul Kumar', plate: 'UP16AB1111', phone: '9876500000', status: 'Contacted', notes: [] });
  const types = [{ id: 'rc', name: 'RC', required: true }, { id: 'dl', name: 'DL', required: true }, { id: 'x', name: 'Other', required: false }];
  const add = (id, type) => updateLead('DOC-1', { addDoc: { id, type, typeName: type, name: `${type}.pdf`, mime: 'application/pdf', size: 10 }, docTypes: types }, 'Priya');
  let l = await add('doc1aaaaaaaa', 'x');
  assert.equal(l.status, 'Contacted');
  l = await add('doc1bbbbbbbb', 'rc');
  assert.equal(l.status, 'Contacted');
  l = await add('doc1cccccccc', 'dl');
  assert.equal(l.status, 'Documents received');
  assert.match(l.notes[0].text, /All documents uploaded/);
  assert.equal(l.docs.length, 3);
  assert.equal(l.docs[2].by, 'Priya');

  // Payment received comes before documents, so it moves on too.
  await addLead({ ref: 'DOC-P', createdAt: '2026-10-09T00:00:00Z', name: 'Asha Rao', plate: 'UP16AB2222', phone: '9876500001', status: 'Payment received', notes: [] });
  const one = [{ id: 'rc', name: 'RC', required: true }];
  l = await updateLead('DOC-P', { addDoc: { id: 'docpaaaaaaaa', type: 'rc', typeName: 'RC', name: 'rc.pdf', mime: 'application/pdf', size: 10 }, docTypes: one }, 'Priya');
  assert.equal(l.status, 'Documents received');

  // Already further along: never moved back.
  await updateLead('DOC-1', { status: 'Scheduled', removeDoc: 'doc1cccccccc' }, 'K');
  l = await add('doc1dddddddd', 'dl');
  assert.equal(l.status, 'Scheduled');

  await saveDoc('doc1bbbbbbbb', 'DOC-1', 'application/pdf', Buffer.from('%PDF-1.4 test'));
  assert.equal((await getDoc('doc1bbbbbbbb')).data.toString(), '%PDF-1.4 test');
  assert.equal(await getDoc('../etc/passwd'), null);
  assert.equal((await getLead('DOC-1')).ref, 'DOC-1');
  assert.ok(DEFAULT_DOC_TYPES.length >= 1);
  await deleteLead('DOC-1');
  assert.equal(await getDoc('doc1bbbbbbbb'), null);
});

test('name on RC: set by hand, or filled in by a matching Parivahan name', async () => {
  await addLead({ ref: 'RC-1', createdAt: '2026-10-09T00:00:00Z', name: 'Rahul Kumar', plate: 'UP16AB2222', phone: '9876500001', status: 'New', notes: [] });
  let l = await updateLead('RC-1', { rcName: { same: false, name: '  Suresh   Verma ' } }, 'K');
  assert.deepEqual([l.rcName.same, l.rcName.name], [false, 'Suresh Verma']);
  // A Parivahan match does not overwrite what staff set.
  l = await updateLead('RC-1', { rcOwner: { name: 'RA*** KUMAR', source: 'Parivahan' } }, 'K');
  assert.equal(l.rcName.name, 'Suresh Verma');

  await addLead({ ref: 'RC-2', createdAt: '2026-10-09T00:00:00Z', name: 'Rahul Kumar', plate: 'UP16AB3333', phone: '9876500002', status: 'New', notes: [] });
  l = await updateLead('RC-2', { rcOwner: { name: 'RA*** KUMAR', source: 'Parivahan' } }, 'K');
  assert.equal(l.rcName.same, true);
  assert.equal(l.rcName.by, 'Parivahan check');
});

test('customer upload link: found by token, counts new customer uploads', async () => {
  const { leadByDocToken } = await import('./store.js');
  await addLead({ ref: 'LNK-1', createdAt: '2026-10-09T00:00:00Z', name: 'Rahul', plate: 'UP16AB4444', phone: '9876500003', status: 'New', notes: [] });
  const token = 'abcdefghijklmnopqrstuvwx';
  let l = await updateLead('LNK-1', { docLink: { token, expiresAt: '2099-01-01T00:00:00Z' } }, 'Priya');
  assert.equal(l.docLink.by, 'Priya');
  assert.equal((await leadByDocToken(token)).ref, 'LNK-1');
  assert.equal(await leadByDocToken('short'), null);
  assert.equal(await leadByDocToken('zzzzzzzzzzzzzzzzzzzzzzzzzz'), null);
  l = await updateLead('LNK-1', { addDoc: { id: 'lnk1aaaaaaaa', type: 'rc', typeName: 'RC', name: 'rc.jpg', mime: 'image/jpeg', size: 5 }, docTypes: [], fromCustomer: true }, 'Customer');
  assert.equal(l.docsNew, 1);
  assert.equal((await updateLead('LNK-1', { docsSeen: true }, 'Priya')).docsNew, 0);
  l = await updateLead('LNK-1', { docLink: null }, 'Priya');
  assert.equal(l.docLink, null);
  assert.equal(await leadByDocToken(token), null);
});

test('registered mobile on the RC', async () => {
  await addLead({ ref: 'RM-1', createdAt: '2026-10-09T00:00:00Z', name: 'A', plate: 'UP16AB5555', phone: '9876500009', status: 'New', notes: [] });
  let l = await updateLead('RM-1', { rcMobile: { same: false, phone: '9811122233' } }, 'K');
  assert.deepEqual([l.rcMobile.same, l.rcMobile.phone, l.phone], [false, '9811122233', '9876500009']);
  l = await updateLead('RM-1', { rcMobile: { same: true, phone: '9811122233' } }, 'K');
  assert.deepEqual([l.rcMobile.same, l.rcMobile.phone], [true, '']);
});

test('stage changes are logged with time and person', async () => {
  await addLead({ ref: 'SL-1', createdAt: '2026-10-09T00:00:00Z', name: 'A', plate: 'UP16AB6666', phone: '9876500010', status: 'New', notes: [] });
  await updateLead('SL-1', { status: 'Contacted' }, 'Priya');
  await updateLead('SL-1', { status: 'Contacted', note: 'again' }, 'Priya');
  const l = await updateLead('SL-1', { status: 'Settled' }, 'Amit');
  assert.deepEqual(l.statusLog.map((x) => [x.status, x.by]), [['Contacted', 'Priya'], ['Settled', 'Amit']]);
});

test('tokens: uploading one moves an open lead to Scheduled', async () => {
  await addLead({ ref: 'TOK-1', createdAt: '2026-10-09T00:00:00Z', name: 'Ravi Jain', plate: 'DL3CAB1234', phone: '9876500002', status: 'Documents verified', notes: [] });
  const tok = (id, date) => ({ id, date, number: 'T-55', name: 'token.pdf', mime: 'application/pdf', size: 10 });
  let l = await updateLead('TOK-1', { addToken: tok('tok1aaaaaaaa', '2026-10-25') }, 'Priya');
  assert.equal(l.status, 'Scheduled');
  assert.equal(l.tokens[0].date, '2026-10-25');
  assert.equal(l.tokens[0].by, 'Priya');
  assert.match(l.notes[1].text, /Token uploaded for 2026-10-25 \(T-55\)/);
  assert.equal(l.statusLog.at(-1).status, 'Scheduled');

  // A settled lead stays settled.
  l = await updateLead('TOK-1', { status: 'Settled' }, 'Priya');
  l = await updateLead('TOK-1', { addToken: tok('tok1bbbbbbbb', '2026-11-02') }, 'Priya');
  assert.equal(l.status, 'Settled');
  assert.equal(l.tokens.length, 2);

  // A challan moves to the token it was last given to.
  l = await updateLead('TOK-1', { tokenChallans: { id: 'tok1aaaaaaaa', challans: ['C1', 'C2'] } }, 'Priya');
  l = await updateLead('TOK-1', { addToken: { ...tok('tok1cccccccc', '2026-11-03'), challans: ['C2', 'C3'] } }, 'Priya');
  assert.deepEqual(l.tokens.map((t) => t.challans || []), [['C1'], [], ['C2', 'C3']]);
  assert.match(l.notes[0].text, /challans C2, C3/);

  l = await updateLead('TOK-1', { removeToken: 'tok1aaaaaaaa' }, 'Priya');
  assert.deepEqual(l.tokens.map((t) => t.id), ['tok1bbbbbbbb', 'tok1cccccccc']);
});

test('payment received: records the amount and moves an early lead on', async () => {
  await addLead({ ref: 'PAY-1', createdAt: '2026-10-10T00:00:00Z', name: 'Kiran', plate: 'UP16AB3333', phone: '9876500003', status: 'Contacted', notes: [] });
  let l = await updateLead('PAY-1', { paymentReceived: { amount: 1500 } }, 'Priya');
  assert.equal(l.status, 'Payment received');
  assert.deepEqual([l.payment.amount, l.payment.by], [1500, 'Priya']);
  assert.match(l.notes[0].text, /Payment received: ₹1,500 \(confirmed by Priya\)/);
  // Recorded later on a lead that is further along: amount saved, stage kept.
  l = await updateLead('PAY-1', { status: 'Scheduled' }, 'Priya');
  l = await updateLead('PAY-1', { paymentReceived: { amount: 1600 } }, 'Amit');
  assert.equal(l.status, 'Scheduled');
  assert.equal(l.payment.amount, 1600);
});

test('challans can be marked can / cannot be resolved, and the marks survive a re-fetch', async () => {
  await addLead({ ref: 'GBN-9', createdAt: '2026-10-03T00:00:00Z', name: 'C', plate: 'DL3CAB1234', phone: '9876543219', status: 'New', notes: [] });
  await updateLead('GBN-9', { challans: [{ challanNo: 'DL1', amount: 1000 }, { challanNo: 'HR2', amount: 500 }, { challanNo: 'UP3', amount: 300 }] }, 'K');
  await updateLead('GBN-9', { approved: [0, 1] }, 'K');
  let l = await updateLead('GBN-9', { challanVerdict: { index: 1, canDo: false, reason: 'area' } }, 'K');
  assert.deepEqual(l.challans[1], { challanNo: 'HR2', amount: 500, approved: false, canDo: false, notReason: 'area' });
  l = await updateLead('GBN-9', { challanVerdict: { index: 0, canDo: true } }, 'K');
  assert.equal(l.challans[0].canDo, true);
  assert.equal(l.challans[0].approved, true);
  // A cannot challan can't be approved.
  l = await updateLead('GBN-9', { approved: [0, 1, 2] }, 'K');
  assert.deepEqual(l.challans.map((c) => c.approved), [true, false, true]);
  // Fetched again (no marks sent): the marks stay on the same challan numbers.
  l = await updateLead('GBN-9', { challans: [{ challanNo: 'HR2', amount: 500 }, { challanNo: 'DL1', amount: 1000 }, { challanNo: 'NEW', amount: 1 }] }, 'K');
  assert.deepEqual(l.challans.map((c) => [c.challanNo, c.canDo, c.notReason]), [['HR2', false, 'area'], ['DL1', true, undefined], ['NEW', undefined, undefined]]);
  // Clearing the check.
  l = await updateLead('GBN-9', { challanVerdict: { index: 0, canDo: null } }, 'K');
  assert.equal('canDo' in l.challans[0], false);
});
