// Automatic WhatsApp: ties the linked number (baileys.js) and the AI (ai.js) to the leads.
// It only ever replies. Nobody gets a first message from it, which keeps the number safe from bans.
//   • Every customer message is saved on their lead; a new number becomes a lead (as before).
//   • The AI answers, asks for the vehicle number and name, and those go on the lead.
//   • The approval message is sent from the lead in the admin panel; "I APPROVE" is marked by itself.
//   • Right after "I APPROVE", the payment details and QR go out by themselves.
//   • A payment screenshot (or "I have paid") is saved and flagged on the lead for the team to confirm.
import crypto from 'node:crypto';
import { listLeads, updateLead, getSettings, getKV, setKV, saveDoc, getDoc } from './store.js';
import { saysApprove } from './whatsapp.js';
import { paymentMessage, paymentAmounts } from './payment.js';
import { aiConfigured, aiAnswer } from './ai.js';
import * as realLive from './baileys.js';

export const BOT = 'Niptao AI';
export const AUTO = 'Auto';
const HUMAN_QUIET_MS = 2 * 3600e3; // after a team member writes in a chat, the AI stays out of it this long
const REPLY_WITHIN_MS = 12 * 3600e3; // don't answer messages older than this (e.g. after a long sleep)
const AI_PER_CHAT_HOUR = 20;
const DEBOUNCE_MS = 5000; // customers often send several short messages in a row: answer once
const PROOF_MAX = 5 * 1024 * 1024;

// on: the master switch. Off = nothing automatic, the number is disconnected, the panel works as before.
const defaults = { on: true, ai: true, autoPayment: true, notes: '' };
export const getBot = async () => ({ ...defaults, ...(await getKV('bot', {})) });
const todayIST = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
const inr = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

// All messages with this customer across their leads (each vehicle is its own lead), oldest first.
export function mergedChat(leads) {
  const seen = new Set(), all = [];
  for (const l of leads) for (const m of l.waChat || []) if (!seen.has(m.id)) { seen.add(m.id); all.push(m); }
  return all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// Has someone from the team written in this chat lately (typed on the phone or in the panel)?
export const humanRecently = (chat, now = Date.now()) =>
  chat.some((m) => m.dir === 'out' && ![BOT, AUTO].includes(m.by) && m.kind !== 'approval' && now - new Date(m.at) < HUMAN_QUIET_MS);

// The approved challans or rate changed after the approval went out (same check as the panel).
export function approvalStale(l) {
  const w = l.waApproval;
  if (!w) return true;
  const { ok, total, rate } = paymentAmounts(l);
  return w.feeRate !== rate || w.total !== total || ok.map((c) => c.challanNo || '').join('|') !== (w.challanNos || []).join('|');
}

export const saysPaid = (text) => /\b(paid|payment (is )?(done|made|sent)|done payment|transferred|pay kar (diya|di)ya?|payment kar (diya|di))\b/i.test(text || '')
  || /(भुगतान|पेमेंट)\s*(कर\s*)?(दिया|दी|हो\s*गया)/.test(text || '');

// Check a file really is an image or PDF from its first bytes.
function sniff(buf) {
  if (buf.length < 12) return '';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return '';
}

const hindi = (leads) => leads.some((l) => l.lang === 'hi');

export function mountAutopilot(app, deps) {
  const { handleWhatsApp, enqueue, attachPlates, requireUser, requireAdmin, canSee } = deps;
  // Tests pass stand-ins for the WhatsApp connection and the AI.
  const live = deps.live || realLive;
  const ai = { ready: deps.aiConfigured || aiConfigured, answer: deps.aiAnswer || aiAnswer };
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS;
  const byPhone = async (phone) => (await listLeads()).filter((l) => l.phone === phone);
  const lastJid = new Map(); // phone → chat id the customer last wrote from (WhatsApp may use a private id)
  const aiSent = new Map(); // phone → times of AI replies, for the per-chat cap
  const timers = new Map();
  // What happened lately, shown in Settings so the team can see why the AI did or didn't answer.
  const activity = [];
  const mask = (p) => (p ? `${p.slice(0, 2)}••••${p.slice(-4)}` : '');
  const log = (phone, text, bad = false) => {
    activity.unshift({ at: new Date().toISOString(), who: mask(phone), text, bad });
    activity.length = Math.min(activity.length, 40);
    if (bad) console.log('[wa]', mask(phone), text);
  };

  // Send and keep the message on the lead. by: BOT, AUTO, or a team member's name.
  async function say(phone, ref, text, by, kind = 'text') {
    const id = await live.sendText(phone, text, { jid: lastJid.get(phone) });
    await updateLead(ref, { waMsg: { id, dir: 'out', text, at: new Date().toISOString(), by, status: 'sent', kind } }, by);
    return id;
  }

  // Payment details for leads the customer just approved, then the QR once.
  async function sendPayment(phone, leads) {
    const site = await getSettings();
    const pay = site.payment || {};
    if (!pay.upiId) {
      for (const l of leads) await updateLead(l.ref, { note: 'Customer approved, but the payment details were not sent automatically: add the UPI ID in Settings → Payment details, then send them from this lead.' }, AUTO);
      return false;
    }
    const dates = (site.lokAdalatDates || []).filter((d) => d.date >= todayIST());
    let sent = 0;
    for (const l of leads) {
      const { payable } = paymentAmounts(l);
      if (approvalStale(l) || !payable) {
        await updateLead(l.ref, { note: 'Customer approved, but the payment details were not sent automatically because the approved challans or amount changed after the approval message. Check and send them from this lead.' }, AUTO);
        continue;
      }
      await say(phone, l.ref, paymentMessage(l, pay, dates), AUTO, 'payment');
      await updateLead(l.ref, { paymentSent: true, note: `Payment details sent automatically on WhatsApp after "I APPROVE": ${inr(payable)} to ${pay.upiId}.` }, AUTO);
      sent++;
    }
    if (sent && pay.qr) {
      const buf = Buffer.from(pay.qr.split(',')[1] || '', 'base64');
      const id = await live.sendImage(phone, buf, 'Scan to pay with any UPI app', { jid: lastJid.get(phone) });
      await updateLead(leads[0].ref, { waMsg: { id, dir: 'out', text: '[QR code] Scan to pay with any UPI app', at: new Date().toISOString(), by: AUTO, status: 'sent', kind: 'payment' } }, AUTO);
    }
    return sent > 0;
  }

  // A photo or PDF while payment is awaited is taken as the payment screenshot.
  async function takeProof(m, waiting) {
    let buf;
    try { buf = await live.download(m.raw); } catch (err) { console.error('[wa] media download failed', err.message); }
    const mime = buf && buf.length <= PROOF_MAX ? sniff(buf) : '';
    let proofId = '';
    if (mime) {
      proofId = waiting[0].ref.toLowerCase().replace(/[^a-z0-9]/g, '') + crypto.randomBytes(8).toString('hex');
      await saveDoc(proofId, waiting[0].ref, mime, buf);
    }
    for (const l of waiting) {
      await updateLead(l.ref, { paymentClaim: { text: m.text.slice(0, 300), proofId, mime, source: 'screenshot' },
        note: `Customer sent ${proofId ? 'a payment screenshot' : 'a file they say is the payment (it could not be saved, check WhatsApp)'}. Check your account, then mark Payment received.` }, 'WhatsApp');
    }
  }

  async function onMessage(m) {
    if ((await getBot()).on === false) return; // switched off: the connection is closed anyway
    if (m.jid) lastJid.set(m.phone, m.jid);
    const msg = { id: m.id, from: `91${m.phone}`, name: m.name, text: m.text, at: m.at, ...(m.fromMe ? { dir: 'out' } : {}) };
    // Typed on the phone (or WhatsApp Web) by the team: keep it on the lead; the AI then stays quiet a while.
    if (m.fromMe) { log(m.phone, 'Team message typed on the phone. The AI stays quiet in this chat for 2 hours.'); return enqueue(() => handleWhatsApp({ messages: [msg] }, { by: 'Phone' })); }
    log(m.phone, `Message received: "${m.text.slice(0, 60)}"`);
    let handled = false;
    await enqueue(async () => {
      const before = await byPhone(m.phone);
      await handleWhatsApp({ messages: [msg] });
      const leads = await byPhone(m.phone);
      const bot = await getBot();
      // "I APPROVE" just marked: send the payment details straight away.
      const approvedNow = leads.filter((l) => l.waApproval?.state === 'received' && before.find((b) => b.ref === l.ref)?.waApproval?.state === 'sent' && !l.paymentSent);
      if (approvedNow.length && saysApprove(m.text) && bot.autoPayment && live.isLive()) {
        handled = true;
        await sendPayment(m.phone, approvedNow).catch((err) => console.error('[wa] payment send failed', err.message));
      }
      // Screenshot (or a PDF) while payment is awaited.
      const waiting = leads.filter((l) => l.paymentSent && !l.payment);
      if (!handled && waiting.length && (m.kind === 'image' || m.kind === 'document')) {
        handled = true;
        await takeProof(m, waiting);
        if (bot.autoPayment && live.isLive() && !leads.some((l) => l.botPaused)) {
          const text = hindi(leads) ? 'धन्यवाद! आपका पेमेंट स्क्रीनशॉट मिल गया है। हमारी टीम जाँच करके यहीं कन्फ़र्म करेगी। 🙏'
            : 'Thank you! We have received your payment screenshot. Our team will check it and confirm here shortly. 🙏';
          await say(m.phone, waiting[0].ref, text, AUTO).catch((err) => console.error('[wa] reply failed', err.message));
        }
      }
    });
    if (!handled) schedule(m.phone);
  }

  function schedule(phone) {
    clearTimeout(timers.get(phone));
    timers.set(phone, setTimeout(() => { timers.delete(phone); aiTurn(phone).catch((err) => log(phone, `AI did not reply: ${err.message}`, true)); }, debounceMs));
  }

  async function aiTurn(phone) {
    const bot = await getBot();
    if (bot.on === false) return log(phone, 'No AI reply: Automatic WhatsApp is switched off.');
    if (!bot.ai) return log(phone, 'No AI reply: "AI replies" is unticked in Settings.', true);
    if (!ai.ready()) return log(phone, 'No AI reply: GEMINI_API_KEY is not set in Render.', true);
    if (!live.isLive()) return log(phone, 'No AI reply: the WhatsApp number is not connected.', true);
    const leads = await byPhone(phone);
    if (!leads.length) return log(phone, 'No AI reply: no lead was found for this number.', true);
    if (leads.some((l) => l.botPaused)) return log(phone, 'No AI reply: AI is paused on this chat (Turn AI back on in the lead).');
    const chat = mergedChat(leads);
    const last = chat[chat.length - 1];
    if (!last || last.dir !== 'in') return;
    if (Date.now() - new Date(last.at) > REPLY_WITHIN_MS) return log(phone, 'No AI reply: the message is more than 12 hours old.');
    if (humanRecently(chat)) return log(phone, 'No AI reply: someone from the team wrote in this chat in the last 2 hours.');
    const recent = (aiSent.get(phone) || []).filter((t) => t > Date.now() - 3600e3);
    if (recent.length >= AI_PER_CHAT_HOUR) return log(phone, 'No AI reply: 20 AI replies to this chat in the last hour already.', true);
    const answer = await ai.answer({ chat, leads, site: await getSettings(), notes: bot.notes });
    if (!answer) return;
    await enqueue(async () => {
      const now = await byPhone(phone);
      const latest = mergedChat(now);
      if (latest[latest.length - 1]?.id !== last.id) return; // the customer wrote again meanwhile: that turn answers
      const named = (await attachPlates(phone, answer.plates, answer.name)) || [];
      const home = now.find((l) => (l.waChat || []).some((c) => c.id === last.id)) || now[0];
      const waiting = now.filter((l) => l.paymentSent && !l.payment && !l.paymentClaim);
      if (answer.paid || saysPaid(last.text)) {
        for (const l of waiting) await updateLead(l.ref, { paymentClaim: { text: last.text.slice(0, 300), source: 'message' }, note: `Customer says they paid: "${last.text.slice(0, 200)}". Check your account, then mark Payment received.` }, 'WhatsApp');
      }
      await say(phone, home.ref, answer.reply, BOT);
      aiSent.set(phone, [...recent, Date.now()]);
      log(phone, `AI replied${named.length ? ` and added ${named.join(', ')}` : ''}.`);
      if (named.length) console.log('[wa] AI added vehicles', named.join(','));
      if (answer.handoff) {
        for (const l of now) await updateLead(l.ref, { botPaused: { by: BOT, reason: 'handoff' }, ...(l.ref === home.ref ? { note: 'The AI handed this chat to the team (the customer asked for a person or something it could not answer). AI replies are paused on this chat. Reply on WhatsApp, then turn AI back on from this lead if you want.' } : {}) }, BOT);
      }
    });
  }

  const handlers = {
    onMessage,
    onSkip: (text) => log('', text, true),
    onStatus: (st) => enqueue(async () => {
      for (const l of await byPhone(st.phone)) if ((l.waChat || []).some((c) => c.id === st.id)) await updateLead(l.ref, { waStatus: st }, 'WhatsApp');
    }),
  };
  getBot().then((b) => live.startLive(handlers, { connectNow: b.on !== false })).catch((err) => console.error('[wa] start failed', err.message));

  // ── Admin routes ──
  const view = async () => ({ ...live.status(), enabled: live.liveEnabled(), aiReady: ai.ready(), settings: await getBot(), activity });
  const fail = (res, err) => {
    if (err.code === 'live_off') return res.status(503).json({ error: 'live_off' });
    if (err.code === 'crm_off') return res.status(409).json({ error: 'crm_off' });
    console.error('[wa] admin action failed', err.message); res.status(500).json({ error: 'failed' });
  };

  app.get('/api/admin/wa-live', requireAdmin, async (req, res) => { try { res.json(await view()); } catch (err) { fail(res, err); } });

  // { phone? }: with a 10-digit phone, a pairing code is shown instead of only the QR.
  app.post('/api/admin/wa-live/link', requireAdmin, async (req, res) => {
    const phone = String(req.body?.phone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (phone && !/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'invalid_phone' });
    try {
      if ((await getBot()).on === false) throw Object.assign(new Error('switched off'), { code: 'crm_off' });
      await live.link(phone);
      // Give WhatsApp a moment to send the first QR (or the pairing code).
      for (let i = 0; i < 20 && !live.status().qr && !(phone && live.status().pairCode) && !live.isLive(); i++) await new Promise((r) => setTimeout(r, 500));
      res.json(await view());
    } catch (err) { fail(res, err); }
  });

  app.post('/api/admin/wa-live/logout', requireAdmin, async (req, res) => {
    try { await live.logout(); console.log('[wa] unlinked by', req.user.name); res.json(await view()); } catch (err) { fail(res, err); }
  });

  app.put('/api/admin/wa-live/settings', requireAdmin, async (req, res) => {
    const b = req.body || {};
    try {
      await setKV('bot', { ...(await getBot()), ai: b.ai !== false, autoPayment: b.autoPayment !== false, notes: String(b.notes || '').slice(0, 4000) });
      res.json(await view());
    } catch (err) { fail(res, err); }
  });

  // Master switch { on: boolean }. Off disconnects the number (the login is kept) and stops every
  // automatic message; the admin panel goes back to the WhatsApp buttons and add-on as before.
  app.put('/api/admin/wa-live/power', requireAdmin, async (req, res) => {
    const on = req.body?.on === true;
    try {
      await setKV('bot', { ...(await getBot()), on });
      if (on) await live.resume(); else await live.pause();
      console.log('[wa] automatic WhatsApp switched', on ? 'on' : 'off', 'by', req.user.name);
      res.json(await view());
    } catch (err) { fail(res, err); }
  });

  // Settings → "Try the AI": a pretend customer chat. Nothing is sent on WhatsApp and no lead changes.
  // { chat: [{ dir: 'in' | 'out', text }], notes, name, plates } → the AI's answer.
  app.post('/api/admin/wa-live/test', requireAdmin, async (req, res) => {
    if (!ai.ready()) return res.status(409).json({ error: 'ai_not_ready' });
    const b = req.body || {};
    const chat = (Array.isArray(b.chat) ? b.chat : []).slice(-30).map((m, i) => ({ id: `t${i}`, dir: m?.dir === 'out' ? 'out' : 'in', text: String(m?.text || '').slice(0, 1500), at: new Date().toISOString() })).filter((m) => m.text);
    if (!chat.length || chat[chat.length - 1].dir !== 'in') return res.status(400).json({ error: 'empty' });
    const name = String(b.name || '').slice(0, 80) || 'WhatsApp customer';
    const plates = (Array.isArray(b.plates) ? b.plates : []).slice(0, 20).map(String);
    const leads = plates.length ? plates.map((plate) => ({ name, plate, status: 'New' })) : [{ name, plate: '', status: 'New' }];
    try {
      const answer = await ai.answer({ chat, leads, site: await getSettings(), notes: typeof b.notes === 'string' ? b.notes.slice(0, 4000) : (await getBot()).notes });
      if (!answer) return res.status(502).json({ error: 'no_answer' });
      res.json(answer);
    } catch (err) { console.error('[wa] AI test failed', err.message); res.status(502).json({ error: 'ai_failed', detail: err.message.slice(0, 300) }); }
  });

  // Pause or resume AI replies for this customer (all their vehicles): { paused: boolean }.
  app.post('/api/admin/leads/:ref/bot', requireUser, async (req, res) => {
    try {
      const lead = (await listLeads()).find((l) => l.ref === req.params.ref);
      if (!lead) return res.status(404).json({ error: 'not_found' });
      if (!canSee(lead, req.user)) return res.status(403).json({ error: 'not_your_lead' });
      const paused = req.body?.paused === true;
      const leads = (await byPhone(lead.phone)).filter((l) => canSee(l, req.user));
      for (const l of leads) {
        await updateLead(l.ref, { botPaused: paused ? { by: req.user.name, reason: 'team' } : null,
          ...(l.ref === lead.ref ? { note: paused ? 'AI replies paused on this chat.' : 'AI replies turned back on for this chat.' } : {}) }, req.user.name);
      }
      res.json({ leads: (await byPhone(lead.phone)).filter((l) => canSee(l, req.user)) });
    } catch (err) { console.error('[wa] bot toggle failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
  });

  // The payment screenshot a customer sent on WhatsApp.
  app.get('/api/admin/leads/:ref/proof', requireUser, async (req, res) => {
    try {
      const lead = (await listLeads()).find((l) => l.ref === req.params.ref);
      const id = lead?.paymentClaim?.proofId;
      if (!id) return res.status(404).json({ error: 'not_found' });
      if (!canSee(lead, req.user)) return res.status(403).json({ error: 'not_your_lead' });
      const doc = await getDoc(id);
      if (!doc) return res.status(404).json({ error: 'not_found' });
      res.set({ 'Content-Type': lead.paymentClaim.mime || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      res.send(Buffer.from(doc.data));
    } catch (err) { console.error('[wa] proof read failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
  });

  return { isLive: live.isLive, send: (phone, text) => live.sendText(phone, text, { jid: lastJid.get(phone) }) };
}
