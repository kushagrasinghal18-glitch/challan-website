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
  MSG91_AUTH_KEY: 'k-test', MSG91_WA_NUMBER: '9990661629', MSG91_OLD_NUMBER: '9811100022', MSG91_WEBHOOK_SECRET: 'secret-for-tests-123',
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
    // A delivery report that repeats the text, matched by the request id saved at send time.
    { uuid: 'u5', requestId: 'r77', customerNumber: '919876500011', direction: 'outbound', status: 'delivered', text: 'Our reply' },
    { customerNumber: 'abc', text: 'ignored' },
  ]);
  assert.deepEqual(r.messages.map((m) => [m.id, m.phone, m.text, m.kind]), [['u1', '9876500011', 'Hi', 'text'], ['u2', '9876500011', 'paid', 'image']]);
  assert.equal(r.messages[1].raw.url, 'https://x/y');
  assert.deepEqual(r.outgoing.map((o) => o.text), ['Typed in MSG91']);
  assert.deepEqual(r.statuses.map((s) => [s.id, s.status]), [['u4', 'read'], ['u5', 'delivered']]);
  assert.deepEqual(r.statuses[1].ids, ['u5', 'r77']);
});

test('sends text, templates and images in the MSG91 format', async () => {
  const live = msg91Live();
  assert.equal(live.isLive(), true);
  assert.equal(await live.sendText('9876500011', 'Hello'), `r${calls.length}`);
  const c = calls.at(-1);
  assert.equal(c.path, '/whatsapp-outbound-message/');
  assert.equal(c.key, 'k-test');
  assert.deepEqual(c.body, { integrated_number: '919990661629', recipient_number: '919876500011', content_type: 'text', text: 'Hello', payload: { type: 'text', text: { body: 'Hello' } } });
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

  // Templates made in Settings: sent to MSG91, listed, and one picked for approvals replaces the Render one.
  const admin = (path, method, body) => fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
  assert.equal((await admin('/api/admin/wa-templates', 'POST', { name: 'Bad Name', body: 'x' })).status, 400);
  assert.equal((await admin('/api/admin/wa-templates', 'POST', { name: 'gap_vars', body: 'Hi {{1}} {{3}}' })).status, 400);
  const made = await admin('/api/admin/wa-templates', 'POST', { name: 'lok_reminder', category: 'UTILITY', language: 'en', header: 'Reminder 🙂', body: 'Hi {{1}}, your date is {{2}}.', samples: ['Ravi', '10 Nov'], buttons: ['OK', ''] });
  assert.equal(made.status, 200);
  // Made on both numbers (each may sit in its own Meta account).
  const made2 = calls.slice(-2);
  assert.deepEqual(made2.map((c) => [c.path, c.body.integrated_number]), [['/client-panel-template/', '919990661629'], ['/client-panel-template/', '919811100022']]);
  const sent = made2[0];
  assert.equal(sent.body.template_name, 'lok_reminder');
  assert.deepEqual(sent.body.components, [
    { type: 'HEADER', format: 'TEXT', text: 'Reminder' },
    { type: 'BODY', text: 'Hi {{1}}, your date is {{2}}.', example: { body_text: [['Ravi', '10 Nov']] } },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'OK' }] },
  ]);
  const listed = await made.json();
  assert.equal(listed.list[0].status, 'PENDING');
  assert.equal((await admin('/api/admin/wa-templates', 'POST', { name: 'lok_reminder', body: 'again' })).status, 409);
  await admin('/api/admin/wa-templates', 'PUT', { approval: 'lok_reminder' });
  assert.equal((await send({ text: 'approval', approval: true })).status, 200);
  assert.equal(calls.at(-1).body.payload.template.name, 'lok_reminder');

  // Payment received: final % and amount give the balance, and the customer gets a thank-you with all of it.
  const pay = (body) => admin(`/api/admin/leads/${lead.ref}`, 'PATCH', { paymentReceived: { confirmed: true, ...body } });
  assert.equal((await pay({ amount: 500, finalRate: 120 })).status, 400);
  assert.equal((await pay({ amount: 300, finalRate: 40, mode: 'cheque' })).status, 400);
  let pr = await (await pay({ amount: 300, finalRate: 40, date: '2026-10-14', mode: 'cash' })).json();
  assert.deepEqual([pr.lead.payment.finalAmount, pr.lead.payment.pending, pr.lead.payment.mode], [400, 100, 'cash']);
  assert.equal(pr.receipt.reason, 'window_closed'); // over 24 hours and no receipt template yet
  assert.match(pr.receipt.text, /Final amount: ₹400 \(40% of the challan amount\)[\s\S]*Amount received: ₹300[\s\S]*14 October 2026[\s\S]*Balance pending: \*₹100\*/);
  await admin('/api/admin/wa-templates', 'PUT', { receipt: 'lok_reminder' });
  pr = await (await pay({ amount: 300, finalRate: 40, date: '2026-10-14' })).json();
  assert.equal(pr.receipt.sent, true);
  const rc = calls.at(-1).body.payload.template;
  assert.equal(rc.name, 'lok_reminder');
  assert.equal(rc.to_and_components[0].components.body_6.value, '₹100');
  // Inside the window it goes as a normal message; notify:false sends nothing.
  await hook({ uuid: 'in9', customerNumber: '91' + phone, text: 'paid' });
  await settle();
  pr = await (await pay({ amount: 400, finalRate: 40 })).json();
  assert.equal(pr.receipt.sent, true);
  assert.match(calls.at(-1).body.text, /Balance pending: ₹0 \(fully paid\)/);
  const n1 = calls.length;
  pr = await (await pay({ amount: 400, finalRate: 40, notify: false })).json();
  assert.equal(pr.receipt, undefined);
  assert.equal(calls.length, n1);

  // Two numbers: replies go from the number the customer wrote to.
  assert.equal(calls.at(-3).body.integrated_number, '919990661629');
  await hook({ uuid: 'old1', customerNumber: '91' + phone, integratedNumber: '919811100022', text: 'writing to the old number' });
  await settle();
  assert.equal((await send({ text: 'Reply from the old number' })).status, 200);
  assert.equal(calls.at(-1).body.integrated_number, '919811100022');
  await hook({ uuid: 'new1', customerNumber: '91' + phone, integratedNumber: '919990661629', text: 'now the new one' });
  await settle();
  await send({ text: 'Reply from the new number' });
  assert.equal(calls.at(-1).body.integrated_number, '919990661629');
  // Delivery reports find the message by any of their ids.
  const sentId = `r${calls.length}`;
  await hook({ uuid: 'other-uuid', requestId: sentId, customerNumber: '91' + phone, direction: 'outbound', status: 'read', text: 'Reply from the new number' });
  await settle();
  assert.equal((await mine()).flatMap((l) => l.waChat).find((m) => m.id === sentId).status, 'read');
  // Conversation starter: refused until a template is picked, then sent with the challan total.
  assert.equal((await send({ starter: true })).status, 409);
  await admin('/api/admin/wa-templates', 'PUT', { starter: 'lok_reminder' });
  assert.equal((await send({ starter: true })).status, 200);
  const st = calls.at(-1).body.payload.template;
  assert.equal(st.name, 'lok_reminder');
  assert.equal(st.to_and_components[0].components.body_3.value, '₹1,000 (1 challan)');
  // Their "Know more" tap gets the full challan list, then the approval request with the I APPROVE button.
  const k0 = calls.length;
  await hook({ uuid: 'km1', customerNumber: '91' + phone, integratedNumber: '919990661629', contentType: 'button', button: JSON.stringify({ text: 'Know more', payload: 'Know more' }) });
  await settle(); await settle();
  const km = calls.slice(k0);
  assert.equal(km.length, 2);
  assert.match(km[0].body.text, /Challans we will settle for you \(1\)[\s\S]*C1/);
  assert.equal(km[1].body.content_type, 'interactive');
  assert.match(km[1].body.interactive.body.text, /tap \*I APPROVE\*/);
  assert.equal((await mine()).find((l) => l.ref === lead.ref).waApproval.state, 'sent');
  // Approved on a call: marked by the team, then the payment details go out (UPI ID needed first).
  let ap = await (await admin(`/api/admin/leads/${lead.ref}/approve`, 'POST', { how: 'call' })).json();
  assert.deepEqual([ap.lead.waApproval.state, ap.lead.waApproval.manual, ap.payment.reason], ['received', 'call', 'payment_not_set']);
  await store.saveSettings({ ...(await store.getSettings()), payment: { upiId: 'niptao@upi', payeeName: 'Niptao' } });
  const a0 = calls.length;
  ap = await (await admin(`/api/admin/leads/${lead.ref}/approve`, 'POST', { how: 'call' })).json();
  assert.equal(ap.payment.sent, true);
  assert.match(calls[a0].body.text, /niptao@upi/);
  assert.ok(ap.lead.paymentSent);
  // A customer who only chatted in the linked-phone days gets the old number; a new one the main number.
  await store.addLead({ ref: 'OLD-1', createdAt: '2026-10-01T00:00:00Z', name: 'Old', plate: 'UP16AB7777', phone: '9876500077', status: 'Contacted', notes: [],
    waChat: [{ id: '3EB0AA', dir: 'in', text: 'hi', at: '2026-10-01T10:00:00Z' }], waLastIn: new Date().toISOString() });
  assert.equal(await index.senderFor('9876500077'), '919811100022');
  assert.equal(await index.senderFor('9876500099'), '');
});

test('tapped buttons arrive as their title, also when MSG91 sends them as JSON text', () => {
  const r = parseMsg91([
    { uuid: 'b1', customerNumber: '919876500011', contentType: 'interactive', interactive: JSON.stringify({ type: 'button_reply', button_reply: { id: 'approve', title: 'I APPROVE' } }) },
    { uuid: 'b2', customerNumber: '919876500011', contentType: 'button', button: JSON.stringify({ text: 'I APPROVE', payload: 'I APPROVE' }) },
    { uuid: 'b3', customerNumber: '919876500011', messages: JSON.stringify([{ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'approve', title: 'I APPROVE' } } }]) },
  ]);
  assert.deepEqual(r.messages.map((m) => m.text), ['I APPROVE', 'I APPROVE', 'I APPROVE']);
});
