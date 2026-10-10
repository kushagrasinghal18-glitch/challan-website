import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergedChat, humanRecently, saysPaid, approvalStale, BOT, AUTO } from './autopilot.js';
import { parseAnswer, toContents, customerFacts } from './ai.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'niptao-auto-'));
process.env.LEADS_FILE = path.join(dir, 'leads.json');
process.env.PORT = String(20000 + Math.floor(Math.random() * 20000));
delete process.env.DATABASE_URL;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const QR = `data:image/png;base64,${PNG.toString('base64')}`;

test('AI answer parsing keeps only valid plates and a clean name', () => {
  const a = parseAnswer('```json\n{"reply":"Thanks Ravi!","plates":["up 16 ab 1234","hello","DL3CAB1234"],"name":"Ravi 😀 Kumar","paid":false,"handoff":false}\n```');
  assert.deepEqual(a.plates, ['UP16AB1234', 'DL3CAB1234']);
  assert.equal(a.name, 'Ravi Kumar');
  assert.equal(parseAnswer('not json'), null);
  assert.equal(parseAnswer('{"reply":""}'), null);
});

test('chat turns start with the customer and join same-side messages', () => {
  const c = toContents([{ dir: 'out', text: 'hello from us' }, { dir: 'in', text: 'hi' }, { dir: 'in', text: 'UP16AB1234' }, { dir: 'out', text: 'ok' }]);
  assert.deepEqual(c.map((x) => x.role), ['user', 'model']);
  assert.equal(c[0].parts[0].text, 'hi\nUP16AB1234');
});

test('customer facts give amounts only from the lead', () => {
  const f = customerFacts([{ name: 'Ravi', plate: 'UP16AB1234', status: 'Contacted', feeRate: 50, challans: [{ challanNo: 'A', amount: 2000, approved: true }],
    waApproval: { state: 'sent' } }], { lokAdalatDates: [{ city: 'noida', date: '2099-01-10' }] }, '2026-10-10');
  assert.match(f, /waiting for "I APPROVE" \(1 challan\(s\), customer pays ₹1,000\)/);
  assert.match(f, /Noida 2099-01-10/);
});

test('helpers: merged chat, human takeover, paid wording', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const chat = mergedChat([{ waChat: [{ id: 'b', at: '2026-10-10T11:00:00Z', dir: 'in' }] }, { waChat: [{ id: 'a', at: '2026-10-10T10:30:00Z', dir: 'out', by: 'Asha' }, { id: 'b', at: '2026-10-10T11:00:00Z' }] }]);
  assert.deepEqual(chat.map((m) => m.id), ['a', 'b']);
  assert.equal(humanRecently(chat, now), true);
  assert.equal(humanRecently([{ dir: 'out', by: BOT, at: '2026-10-10T11:59:00Z' }, { dir: 'out', by: 'Asha', kind: 'approval', at: '2026-10-10T11:59:00Z' }], now), false);
  assert.ok(saysPaid('I have paid the amount') && saysPaid('payment kar diya') && saysPaid('पेमेंट कर दिया'));
  assert.ok(!saysPaid('how do I pay?'));
  assert.equal(approvalStale({ challans: [{ challanNo: 'A', amount: 100, approved: true }], waApproval: { feeRate: 50, total: 100, challanNos: ['A'] } }), false);
});

test('end to end: AI chat → lead with vehicle → approval → payment details → screenshot', async (t) => {
  const index = await import('./index.js');
  t.after(() => index.server.close());
  const { mountAutopilot } = await import('./autopilot.js');
  const store = await import('./store.js');
  await store.saveSettings({ payment: { upiId: 'niptao@upi', payeeName: 'Niptao', qr: QR } });

  // Stand-in WhatsApp connection: records what would be sent and replays incoming messages.
  const sent = [];
  let handlers;
  const live = {
    startLive: async (h) => { handlers = h; }, isLive: () => true, liveEnabled: () => true, status: () => ({ state: 'open' }),
    sendText: async (phone, text) => { sent.push({ phone, text }); return `out${sent.length}`; },
    sendImage: async (phone, buf, caption) => { sent.push({ phone, image: true, caption }); return `out${sent.length}`; },
    download: async () => PNG,
  };
  const answers = [];
  const routes = {};
  const app = new Proxy({}, { get: () => (p, ...fns) => { routes[p] = fns[fns.length - 1]; } });
  mountAutopilot(app, {
    handleWhatsApp: index.handleWhatsApp, enqueue: index.enqueueWa, attachPlates: index.attachPlates,
    requireUser: [], requireAdmin: [], canSee: () => true, live, debounceMs: 10,
    aiConfigured: () => true, aiAnswer: async ({ chat }) => answers.shift()?.(chat) ?? null,
  });
  await new Promise((r) => setTimeout(r, 50)); // the connection starts once the saved switch is read
  const phone = '9876500077';
  let n = 0;
  const incoming = (text, extra = {}) => handlers.onMessage({ id: `in${++n}`, phone, jid: `91${phone}@s.whatsapp.net`, fromMe: false, name: 'Ravi', at: new Date().toISOString(), kind: 'text', text, ...extra });
  const settle = () => new Promise((r) => setTimeout(r, 120));
  const leads = async () => (await store.listLeads()).filter((l) => l.phone === phone);

  // 1. A new customer writes; the AI answers and asks for the vehicle number.
  answers.push(() => ({ reply: 'Hi! Please share your vehicle number.', plates: [], name: '', paid: false, handoff: false }));
  await incoming('Hello, I have challans');
  await settle();
  assert.equal((await leads()).length, 1);
  assert.equal(sent.at(-1).text, 'Hi! Please share your vehicle number.');
  assert.equal((await leads())[0].waChat.at(-1).by, BOT);

  // 2. They give two vehicles in a way the plain pattern misses; the AI picks them up.
  answers.push(() => ({ reply: 'Thanks! Our team will check both.', plates: ['UP16AB1234', 'DL3CAB1234'], name: 'Ravi Kumar', paid: false, handoff: false }));
  await incoming('cars are up-16-ab-1234 and dl-3c-ab-1234');
  await settle();
  const two = await leads();
  assert.deepEqual(two.map((l) => l.plate).sort(), ['DL3CAB1234', 'UP16AB1234']);
  assert.ok(two.every((l) => l.groupRef && l.vehicles === 2));

  // 3. The team sends the approval (from the panel), the customer replies I APPROVE: payment details go out.
  const up = two.find((l) => l.plate === 'UP16AB1234');
  await store.updateLead(up.ref, { challans: [{ challanNo: 'UP123', amount: 3000 }] }, 'Asha');
  await store.updateLead(up.ref, { approved: [0] }, 'Asha');
  await store.updateLead(up.ref, { waApproval: 'sent' }, 'Asha');
  const before = sent.length;
  await incoming('I APPROVE');
  await settle();
  const paid = (await leads()).find((l) => l.ref === up.ref);
  assert.equal(paid.waApproval.state, 'received');
  assert.equal(paid.paymentSent.amount, 1500);
  assert.match(sent[before].text, /niptao@upi/);
  assert.equal(sent[before + 1].image, true);
  assert.equal(sent.length, before + 2, 'no AI reply on top of the payment message');

  // 4. A screenshot comes in: saved and flagged, customer thanked.
  await incoming('[photo]', { kind: 'image', raw: {} });
  await settle();
  const claim = (await leads()).find((l) => l.ref === up.ref).paymentClaim;
  assert.equal(claim.source, 'screenshot');
  assert.ok(claim.proofId);
  assert.ok((await store.getDoc(claim.proofId)).data.length);
  assert.match(sent.at(-1).text, /payment screenshot/);
  assert.equal((await leads()).find((l) => l.ref === up.ref).payment, undefined, 'payment itself is left for the team to confirm');

  // 5. A team member types on the phone: the AI stays out of the chat.
  await handlers.onMessage({ id: 'p1', phone, fromMe: true, at: new Date().toISOString(), kind: 'text', text: 'Calling you now' });
  const count = sent.length;
  answers.push(() => ({ reply: 'should not be sent', plates: [], name: '', paid: false, handoff: false }));
  await incoming('ok');
  await settle();
  assert.equal(sent.length, count);
  assert.ok(routes['/api/admin/wa-live'] && routes['/api/admin/leads/:ref/proof'] && routes['/api/admin/wa-live/power']);

  // 5b. Settings → Try the AI: answers from a pretend chat, sends nothing and changes no lead.
  const sentNow = sent.length, allBefore = JSON.stringify(await store.listLeads());
  let seen;
  answers.length = 0; // step 5's answer was never used: the AI stayed quiet
  answers.push((c) => { seen = c; return { reply: 'Test reply', plates: ['MH12AB1234'], name: '', paid: false, handoff: false }; });
  const out = await new Promise((resolve) => routes['/api/admin/wa-live/test'](
    { body: { chat: [{ dir: 'in', text: 'hi' }, { dir: 'out', text: 'hello' }, { dir: 'in', text: 'MH12AB1234' }], notes: 'try notes' } },
    { status() { return this; }, json: resolve }));
  assert.equal(out.reply, 'Test reply');
  assert.deepEqual(seen.map((m) => m.text), ['hi', 'hello', 'MH12AB1234']);
  assert.equal(sent.length, sentNow);
  assert.equal(JSON.stringify(await store.listLeads()), allBefore);

  // 6. Switched off in Settings: messages are ignored and nothing is sent, as before the CRM.
  await store.setKV('bot', { on: false });
  const leadsBefore = JSON.stringify(await leads());
  const sentBefore = sent.length;
  answers.push(() => ({ reply: 'should not be sent either', plates: ['HR26AB1234'], name: '', paid: false, handoff: false }));
  await handlers.onMessage({ id: 'x1', phone: '9876500099', fromMe: false, name: 'New', at: new Date().toISOString(), kind: 'text', text: 'hi HR26AB1234' });
  await settle();
  assert.equal(sent.length, sentBefore);
  assert.equal((await store.listLeads()).filter((l) => l.phone === '9876500099').length, 0);
  assert.equal(JSON.stringify(await leads()), leadsBefore);
});
