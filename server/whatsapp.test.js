import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validSignature, parseWebhook, localPhone, saysApprove } from './whatsapp.js';

const sample = {
  entry: [{ changes: [{ value: {
    contacts: [{ wa_id: '919876500044', profile: { name: 'Ravi' } }],
    messages: [{ id: 'wamid.1', from: '919876500044', timestamp: '1759920000', type: 'text', text: { body: 'I approve' } }],
    statuses: [{ id: 'wamid.out1', status: 'read', timestamp: '1759920100' }],
  } }] }],
};

test('webhook signature must match the app secret', () => {
  const raw = Buffer.from(JSON.stringify(sample));
  const sig = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(raw).digest('hex');
  assert.ok(validSignature(raw, sig, 's3cret'));
  assert.ok(!validSignature(raw, sig, 'other'));
  assert.ok(!validSignature(raw, 'sha256=00', 's3cret'));
  assert.ok(!validSignature(raw, sig, ''));
});

test('webhook body is read into messages and delivery updates', () => {
  const { messages, statuses } = parseWebhook(sample);
  assert.equal(messages[0].from, '919876500044');
  assert.equal(messages[0].name, 'Ravi');
  assert.equal(messages[0].text, 'I approve');
  assert.equal(statuses[0].status, 'read');
});

test('phone numbers and approval replies', () => {
  assert.equal(localPhone('919876500044'), '9876500044');
  assert.equal(localPhone('14155550100'), '');
  assert.ok(saysApprove('i APPROVE ✅'));
  assert.ok(saysApprove('IAPPROVE'));
  assert.ok(!saysApprove('I do not approve yet? call me'.replace('approve', 'agree')));
});
