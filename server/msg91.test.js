import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { parseMsg91, webhookOk, msg91Live } from './msg91.js';

// A stand-in for the MSG91 API that records every call.
const calls = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls.push({ path: req.url, key: req.headers.authkey, body: JSON.parse(body || '{}') });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(calls.at(-1).body.recipient_number === '910000000000' ? { type: 'error', message: 'bad number' } : { type: 'success', request_id: `r${calls.length}` }));
  });
});
await new Promise((r) => fake.listen(0, r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niptao-msg91-'));
Object.assign(process.env, {
  LEADS_FILE: path.join(dir, 'leads.json'), PORT: String(20000 + Math.floor(Math.random() * 20000)), ADMIN_PASSWORD: 'test-pass-123',
  MSG91_AUTH_KEY: 'k-test', MSG91_WA_NUMBER: '9990661629', MSG91_WEBHOOK_SECRET: 'secret-for-tests-123',
  MSG91_BASE_URL: `http://127.0.0.1:${fake.address().port}`, MSG91_APPROVAL_TEMPLATE: 'approval_request',
});
delete process.env.DATABASE_URL;
delete process.env.GEMINI_API_KEY;

test('webhook secret must match and be long enough', () => {
  assert.ok(webhookOk('secret-for-tests-123'));
  assert.ok(!webhookOk('secret-for-tests-12'));
  assert.ok(!webhookOk(''));
  assert.ok(!webhookOk('short', { MSG91_WEBHOOK_SECRET: 'short' }));
});

test('parses incoming, our own and delivery events', () => {
  const r = parseMsg91([
    { uuid: 'u1', customerNumber: '919876500011', customerName: 'Ravi', text: 'Hi', contentType: 'text', requestedAt: '2026-10-14T10:00:00Z' },
    { uuid: 'u2', customerNumber: '919876500011', contentType: 'image', messages: JSON.stringify([{ type: 'image', image: { caption: 'paid', url: 'https://x/y', mime_type: 'image/png' } }]) },
    { uuid: 'u3', customerNumber: '919876500011', messageType: 'outbound', text: 'Typed in MSG91' },
    { uuid: 'u4', customerNumber: '919876500011', direction: 'outbound', status: 'read' },
    { customerNumber: 'abc', text: 'ignored' },
  ]);
  assert.deepEqual(r.messages.map((m) => [m.id, m.phone, m.text, m.kind]), [['u1', '9876500011', 'Hi', 'text'], ['u2', '9876500011', 'paid', 'image']]);
  assert.equal(r.messages[1].raw.url, 'https://x/y');
  assert.deepEqual(r.outgoing.map((o) => o.text), ['Typed in MSG91']);
  assert.deepEqual(r.statuses.map((s) => [s.id, s.status]), [['u4', 'read']]);
});

test('sends text, templates and images in the MSG91 format', async () => {
  const live = msg91Live();
  assert.equal(live.isLive(), true);
  assert.equal(await live.sendText('9876500011', 'Hello'), `r${calls.length}`);
  const c = calls.at(-1);
  assert.equal(c.path, '/whatsapp-outbound-message/');
  assert.equal(c.key, 'k-test');
  assert.deepEqual(c.body, { integrated_number: '919990661629', recipient_number: '919876500011', content_type: 'text', text: 'Hello' });
  await assert.rejects(live.sendImage('9876500011', Buffer.alloc(1), 'QR'), { code: 'no_link' });
  await live.sendImage('9876500011', null, 'QR', { url: 'https://site/qr' });
  assert.equal(calls.at(-1).body.attachment_url, 'https://site/qr');
  assert.equal(calls.at(-1).body.caption, 'QR');
  await assert.rejects(live.sendText('0000000000', 'x'), /bad number/);
  assert.equal(live.status().sentLastHour, 2);
});

test('webhook → lead and chat; panel replies go through MSG91; template outside 24 hours', async (t) => {
  const index = await import('./index.js');
  t.after(() => { index.server.close(); fake.close(); });
  const store = await import('./store.js');
  await new Promise((r) => (index.server.listening ? r() : index.server.once('listening', r)));
  const base = `http://127.0.0.1:${index.server.address().port}`;
  const hook = (body, secret = 'secret-for-tests-123') => fetch(`${base}/api/whatsapp/msg91/${secret}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const settle = () => new Promise((r) => setTimeout(r, 150));
  const phone = '9876500022';
  const mine = async () => (await store.listLeads()).filter((l) => l.phone === phone);

  assert.equal((await hook({ customerNumber: '91' + phone, text: 'x' }, 'wrong-secret-xxxx')).status, 404);
  assert.match(await (await fetch(`${base}/api/whatsapp/msg91/secret-for-tests-123`)).text(), /Webhook OK/);
  assert.equal((await fetch(`${base}/api/whatsapp/msg91/nope-nope-nope-nope`)).status, 404);
  // A form post, and JSON sent as plain text, are read too.
  await fetch(`${base}/api/whatsapp/msg91/secret-for-tests-123`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ uuid: 'f1', customerNumber: '919876500033', text: 'form hello' }) });
  await fetch(`${base}/api/whatsapp/msg91/secret-for-tests-123`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ uuid: 't1', customerNumber: '919876500044', text: 'text hello' }) });
  await settle();
  const all = await store.listLeads();
  assert.ok(all.some((l) => l.phone === '9876500033' && l.waChat?.[0]?.text === 'form hello'));
  assert.ok(all.some((l) => l.phone === '9876500044' && l.waChat?.[0]?.text === 'text hello'));
  assert.equal((await hook({ uuid: 'in1', customerNumber: '91' + phone, customerName: 'Meena', text: 'Challan on UP16AB4321', contentType: 'text' })).status, 200);
  await settle();
  const [lead] = await mine();
  assert.equal(lead.plate, 'UP16AB4321');
  assert.equal(lead.name, 'Meena');
  assert.equal(lead.waUnread, 1);
  assert.equal(index.autopilot.provider, 'msg91');

  const status = await (await fetch(`${base}/api/admin/status`)).json();
  assert.equal(status.whatsappProvider, 'msg91');
  assert.equal(status.whatsappLive, false);

  const { token } = await (await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'test-pass-123' }) })).json();
  const send = (body) => fetch(`${base}/api/admin/leads/${lead.ref}/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const r = await send({ text: 'We will check and revert.' });
  assert.equal(r.status, 200);
  assert.equal(calls.at(-1).body.recipient_number, '91' + phone);
  assert.equal(calls.at(-1).body.text, 'We will check and revert.');
  // MSG91 reports that same send back: it is not saved twice. A message typed in MSG91 itself is.
  await hook({ uuid: 'echo1', customerNumber: '91' + phone, messageType: 'outbound', text: 'We will check and revert.' });
  await hook({ uuid: 'dash1', customerNumber: '91' + phone, messageType: 'outbound', text: 'Sent from the MSG91 dashboard' });
  await hook({ uuid: 'in1', customerNumber: '91' + phone, customerName: 'Meena', text: 'Challan on UP16AB4321', contentType: 'text' }); // resent webhook
  await settle();
  const chat = (await mine())[0].waChat;
  assert.deepEqual(chat.map((m) => [m.dir, m.text]), [['in', 'Challan on UP16AB4321'], ['out', 'We will check and revert.'], ['out', 'Sent from the MSG91 dashboard']]);
  assert.equal(chat[2].by, 'MSG91');

  // Inside the window the approval goes with a tap-to-reply "I APPROVE" button; a tap marks it approved.
  await store.updateLead(lead.ref, { challans: [{ challanNo: 'C1', amount: 1000, approved: true }] }, 'test');
  assert.equal((await send({ text: 'Please approve 1 challan for ₹500.', approval: true })).status, 200);
  const btn = calls.at(-1).body;
  assert.equal(btn.content_type, 'interactive');
  assert.equal(btn.interactive.body.text, 'Please approve 1 challan for ₹500.');
  assert.deepEqual(btn.interactive.action.buttons, [{ type: 'reply', reply: { id: 'approve', title: 'I APPROVE' } }]);
  assert.equal((await mine())[0].waApproval.state, 'sent');
  const long = 'x'.repeat(1100);
  const n0 = calls.length;
  assert.equal((await send({ text: long, approval: true })).status, 200);
  assert.equal(calls.length, n0 + 2);
  assert.equal(calls.at(-2).body.text, long);
  assert.equal(calls.at(-1).body.content_type, 'interactive');
  await hook({ uuid: 'tap1', customerNumber: '91' + phone, contentType: 'interactive', interactive: JSON.stringify({ type: 'button_reply', button_reply: { id: 'approve', title: 'I APPROVE' } }) });
  await settle();
  assert.equal((await mine())[0].waApproval.state, 'received');

  // More than 24 hours since the customer wrote: free text refused, approval goes as the template.
  const leads = JSON.parse(fs.readFileSync(process.env.LEADS_FILE, 'utf8'));
  const list = Array.isArray(leads) ? leads : leads.leads;
  for (const l of list) if (l.phone === phone) l.waLastIn = new Date(Date.now() - 25 * 3600e3).toISOString();
  fs.writeFileSync(process.env.LEADS_FILE, JSON.stringify(leads));
  assert.equal((await send({ text: 'hello again' })).status, 409);
  const before = calls.length;
  assert.equal((await send({ text: 'approval', approval: true })).status, 200);
  assert.equal(calls.length, before + 1);
  const tpl = calls.at(-1).body;
  assert.equal(tpl.payload.template.name, 'approval_request');
  assert.deepEqual(tpl.payload.template.to_and_components[0].to, ['91' + phone]);
  assert.equal(tpl.payload.template.to_and_components[0].components.body_5.value, lead.ref);
});

test('tapped buttons arrive as their title, also when MSG91 sends them as JSON text', () => {
  const r = parseMsg91([
    { uuid: 'b1', customerNumber: '919876500011', contentType: 'interactive', interactive: JSON.stringify({ type: 'button_reply', button_reply: { id: 'approve', title: 'I APPROVE' } }) },
    { uuid: 'b2', customerNumber: '919876500011', contentType: 'button', button: JSON.stringify({ text: 'I APPROVE', payload: 'I APPROVE' }) },
    { uuid: 'b3', customerNumber: '919876500011', messages: JSON.stringify([{ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'approve', title: 'I APPROVE' } } }]) },
  ]);
  assert.deepEqual(r.messages.map((m) => m.text), ['I APPROVE', 'I APPROVE', 'I APPROVE']);
});
