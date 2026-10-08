import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentMessage, upiLink, UPI_RE } from './payment.js';

const lead = { ref: 'GBN-2612345', name: 'Ravi', plate: 'UP16AB1234', city: 'noida', feeRate: 50,
  challans: [{ challanNo: 'UP1', amount: 2000, approved: true, offence: 'Overspeeding' }, { challanNo: 'UP2', amount: 500 }] };
const pay = { upiId: 'niptao@okaxis', payeeName: 'Niptao' };

test('payment message lists approved challans, amount, UPI and the refund note', () => {
  const t = paymentMessage(lead, pay, [{ city: 'noida', date: '2026-11-08', time: '10:00' }]);
  assert.match(t, /Challan UP1/);
  assert.doesNotMatch(t, /Challan UP2/);
  assert.match(t, /Amount to pay \(50%\): ₹1,000/);
  assert.match(t, /niptao@okaxis/);
  assert.match(t, /100% of the amount will be refunded after the Lok Adalat date \(Sun, 8 Nov, 2026\)/);
});

test('UPI link carries the amount and reference', () => {
  const u = upiLink(pay, 1000, 'GBN-2612345');
  assert.match(u, /^upi:\/\/pay\?pa=niptao%40okaxis&pn=Niptao&am=1000&cu=INR&tn=Niptao%20GBN-2612345$/);
  assert.ok(UPI_RE.test('9990661629@ybl'));
  assert.ok(!UPI_RE.test('not a upi'));
});
