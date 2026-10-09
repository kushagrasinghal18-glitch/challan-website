import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentMessage, upiLink, UPI_RE } from './payment.js';

const lead = { ref: 'GBN-2612345', name: 'Ravi', plate: 'UP16AB1234', city: 'noida', feeRate: 50,
  challans: [{ challanNo: 'UP1', amount: 2000, approved: true, offence: 'Overspeeding' }, { challanNo: 'UP2', amount: 500 }] };
const pay = { upiId: 'niptao@okaxis', payeeName: 'Niptao' };

test('payment message lists approved challans, amount, UPI and the refund note', () => {
  const t = paymentMessage(lead, pay, [{ city: 'noida', date: '2026-11-08', time: '10:00' }]);
  assert.match(t, /^1\. UP1\n   Overspeeding\n   ₹2,000$/m);
  assert.doesNotMatch(t, /UP2/);
  assert.match(t, /Challans to settle \(1\)/);
  assert.match(t, /\*You pay \(50%\): ₹1,000\*/);
  assert.match(t, /^UPI ID:\nniptao@okaxis\nName: Niptao\nAmount: ₹1,000\nRemark: GBN-2612345$/m);
  assert.match(t, /Lok Adalat:\* Sun, 8 Nov, 2026$/m);
  assert.doesNotMatch(t, /Court/);
  assert.match(t, /refunded after the Lok Adalat date \(8 Nov\)\./);
  // Without a date or payee name those lines are left out.
  const u = paymentMessage(lead, { upiId: 'x@ybl' });
  assert.doesNotMatch(u, /Lok Adalat:|Name:|\(8 Nov\)/);
});

test('UPI link carries the amount and reference', () => {
  const u = upiLink(pay, 1000, 'GBN-2612345');
  assert.match(u, /^upi:\/\/pay\?pa=niptao%40okaxis&pn=Niptao&am=1000&cu=INR&tn=Niptao%20GBN-2612345$/);
  assert.ok(UPI_RE.test('9990661629@ybl'));
  assert.ok(!UPI_RE.test('not a upi'));
});

test('Lok Adalat date follows the state each approved challan was issued in', () => {
  const dates = [{ city: 'ghaziabad', date: '2026-10-25' }, { city: 'delhi', date: '2026-11-14' }, { city: 'noida', date: '2026-12-13' }];
  const mixed = { ...lead, city: 'noida', challans: [{ challanNo: 'UP16798240000123', amount: 1000, approved: true }, { challanNo: '12345678', amount: 500, approved: true }] };
  const t = paymentMessage(mixed, pay, dates);
  // UP challan: the lead's own UP city date wins over the sooner Ghaziabad one. Delhi challan: the Delhi date.
  assert.match(t, /📅 \*Lok Adalat:\* Delhi – Sat, 14 Nov, 2026 · UP – Sun, 13 Dec, 2026$/m);
  assert.match(t, /refunded after the Lok Adalat dates \(14 Nov, 13 Dec\)\./);

  const delhiOnly = { ...mixed, challans: [mixed.challans[1]] };
  assert.match(paymentMessage(delhiOnly, pay, dates), /Lok Adalat:\* Sat, 14 Nov, 2026$/m);

  // No upcoming date for the challan's state: that state is left out.
  const hr = { ...mixed, challans: [{ challanNo: 'HR5512345', amount: 900, approved: true }] };
  assert.doesNotMatch(paymentMessage(hr, pay, dates), /Lok Adalat:|\(\d+ \w+\)/);
});
