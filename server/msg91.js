// Official WhatsApp Business API through MSG91. Switched on only when these are set in the server
// environment (Render → Environment), never in code:
//   MSG91_AUTH_KEY          MSG91 → Settings → Authkey
//   MSG91_WA_NUMBER         the WhatsApp number connected in MSG91, with country code (91XXXXXXXXXX)
//   MSG91_WEBHOOK_SECRET    any long secret phrase; it is part of the webhook URL pasted in MSG91
//   MSG91_APPROVAL_TEMPLATE (optional) approved template for the approval request outside the 24-hour window
//   MSG91_TEMPLATE_LANG     (optional) template language code, default en
// When it is on, it replaces the linked phone (baileys.js): the same AI, approval and payment steps run
// on the official API, and every message shows in the admin panel's WhatsApp tab.
import crypto from 'node:crypto';
import { localPhone } from './whatsapp.js';

// MSG91_BASE_URL only for local testing against a stand-in server.
const base = (env) => env.MSG91_BASE_URL || 'https://api.msg91.com/api/v5/whatsapp';
export const msg91Configured = (env = process.env) => !!(env.MSG91_AUTH_KEY && env.MSG91_WA_NUMBER);
const waNumber = (env) => String(env.MSG91_WA_NUMBER || '').replace(/\D/g, '').replace(/^(?=[6-9]\d{9}$)/, '91');
const to91 = (phone) => { const d = String(phone || '').replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };

// The webhook URL carries the secret, since MSG91 does not sign its calls.
export function webhookOk(given, env = process.env) {
  const want = String(env.MSG91_WEBHOOK_SECRET || '');
  if (want.length < 12 || !given) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

async function post(path, body, env) {
  const res = await fetch(base(env) + path, {
    method: 'POST',
    headers: { authkey: env.MSG91_AUTH_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
  if (data.type === 'success' || data.status === 'success' || data.hasError === false) {
    return String(data.request_id || data.data?.message_uuid || data.data?.request_id || data.message_uuid || `msg91:${Date.now()}`);
  }
  const msg = typeof data.message === 'string' ? data.message : data.errors ? JSON.stringify(data.errors) : `HTTP ${res.status}`;
  throw Object.assign(new Error(msg.slice(0, 300)), { code: 'send_failed' });
}

export function sendText(phone, text, env = process.env) {
  if (!msg91Configured(env)) return Promise.reject(Object.assign(new Error('MSG91 not set up'), { code: 'not_connected' }));
  return post('/whatsapp-outbound-message/', {
    integrated_number: waNumber(env), recipient_number: to91(phone), content_type: 'text',
    payload: { type: 'text', text: { body: String(text).slice(0, 4096) } },
  }, env);
}

// An image at a public link (WhatsApp fetches it from there).
export function sendImage(phone, link, caption = '', env = process.env) {
  if (!msg91Configured(env)) return Promise.reject(Object.assign(new Error('MSG91 not set up'), { code: 'not_connected' }));
  return post('/whatsapp-outbound-message/', {
    integrated_number: waNumber(env), recipient_number: to91(phone), content_type: 'image',
    payload: { type: 'image', image: { link, ...(caption ? { caption } : {}) } },
  }, env);
}

// Text with up to three tap-to-reply buttons ({ id, title }; titles up to 20 characters). WhatsApp
// caps the text of a button message at 1024 characters.
export const BUTTON_BODY_MAX = 1024;
export function sendButtons(phone, text, buttons, env = process.env) {
  if (!msg91Configured(env)) return Promise.reject(Object.assign(new Error('MSG91 not set up'), { code: 'not_connected' }));
  return post('/whatsapp-outbound-message/', {
    integrated_number: waNumber(env), recipient_number: to91(phone), content_type: 'interactive',
    interactive: {
      type: 'button', body: { text: String(text).slice(0, BUTTON_BODY_MAX) },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: String(b.id).slice(0, 256), title: String(b.title).slice(0, 20) } })) },
    },
  }, env);
}

// Template parameters can't hold new lines, tabs or long runs of spaces.
export function sendTemplate(phone, name, params = [], env = process.env) {
  if (!msg91Configured(env)) return Promise.reject(Object.assign(new Error('MSG91 not set up'), { code: 'not_connected' }));
  const components = {};
  params.forEach((p, i) => { components[`body_${i + 1}`] = { type: 'text', value: String(p).replace(/\s+/g, ' ').trim().slice(0, 300) || '-' }; });
  return post('/whatsapp-outbound-message/bulk/', {
    integrated_number: waNumber(env), content_type: 'template',
    payload: {
      messaging_product: 'whatsapp', type: 'template',
      template: { name, language: { code: env.MSG91_TEMPLATE_LANG || 'en', policy: 'deterministic' }, to_and_components: [{ to: [to91(phone)], components }] },
    },
  }, env);
}

const STATUSES = ['sent', 'delivered', 'read', 'failed'];
const when = (v) => {
  if (v == null || v === '') return new Date().toISOString();
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
  return isNaN(d) ? new Date().toISOString() : d.toISOString();
};

// One MSG91 webhook call (a flat object, or a list of them) → incoming messages, our own sends seen
// by MSG91 (e.g. typed in the MSG91 dashboard), and delivery updates.
export function parseMsg91(body) {
  const messages = [], outgoing = [], statuses = [];
  for (const p of Array.isArray(body) ? body : [body]) {
    if (!p || typeof p !== 'object') continue;
    const phone = localPhone(p.customerNumber || p.recipient_number || p.mobile || '');
    if (!phone) continue;
    const dir = String(p.direction || p.messageType || '').toLowerCase();
    const id = String(p.uuid || p.message_uuid || p.requestId || p.request_id || `msg91:${phone}:${Date.now()}`).slice(0, 160);
    const st = String(p.status || p.eventName || '').toLowerCase();
    let raw = null;
    try { raw = typeof p.messages === 'string' ? JSON.parse(p.messages)?.[0] : Array.isArray(p.messages) ? p.messages[0] : null; } catch { raw = null; }
    const kind = String(raw?.type || p.contentType || 'text').toLowerCase();
    // MSG91 may pass the tapped button as a JSON string.
    const obj = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };
    const inter = obj(p.interactive) || raw?.interactive, btn = obj(p.button) || raw?.button;
    const media = raw?.[kind] && typeof raw[kind] === 'object' ? raw[kind] : null;
    let text = p.text || raw?.text?.body || btn?.text || inter?.button_reply?.title || inter?.list_reply?.title || media?.caption || p.caption || '';
    if (typeof text !== 'string') text = String(text || '');
    if (!text && kind !== 'text') text = `[${kind}]`;
    const at = when(p.requestedAt || p.timestamp || raw?.timestamp || p.date);
    if (dir === 'outbound' || dir === 'out') {
      if (STATUSES.includes(st) && !p.text) statuses.push({ id, phone, status: st, at, error: String(p.reason || p.failureReason || '').slice(0, 200) });
      else if (text) outgoing.push({ id, phone, text: text.slice(0, 4000), at });
      continue;
    }
    if (STATUSES.includes(st) && !text) { statuses.push({ id, phone, status: st, at, error: String(p.reason || '').slice(0, 200) }); continue; }
    if (!text) continue;
    messages.push({ id, phone, name: String(p.customerName || '').slice(0, 120), text: text.slice(0, 4000), at,
      kind: ['image', 'document'].includes(kind) ? kind : 'text', raw: media ? { url: media.url || media.link || '', mime: media.mime_type || '' } : null });
  }
  return { messages, outgoing, statuses };
}

// Same shape as baileys.js, so autopilot.js runs unchanged on MSG91. Nothing to link: the number
// lives in MSG91. Opts on sendImage: { url } (MSG91 sends images by link, not by upload).
export function msg91Live(env = process.env) {
  const sentAt = [];
  const count = (id) => { sentAt.push(Date.now()); while (sentAt.length && sentAt[0] < Date.now() - 3600e3) sentAt.shift(); return id; };
  const none = () => Promise.reject(Object.assign(new Error('Nothing to link: the number is connected in MSG91.'), { code: 'msg91' }));
  return {
    RECEIVE_ONLY: false,
    provider: 'msg91',
    isLive: () => msg91Configured(env),
    liveEnabled: () => true,
    status: () => ({ state: msg91Configured(env) ? 'open' : 'off', provider: 'msg91', me: localPhone(waNumber(env)), qr: null, pairCode: null, error: null,
      sentLastHour: sentAt.filter((t) => t > Date.now() - 3600e3).length }),
    startLive: async () => {},
    pause: async () => {},
    resume: async () => {},
    link: none,
    logout: none,
    sendText: async (phone, text) => count(await sendText(phone, text, env)),
    sendButtons: async (phone, text, buttons) => count(await sendButtons(phone, text, buttons, env)),
    sendImage: async (phone, _buf, caption, opts = {}) => {
      if (!opts.url) throw Object.assign(new Error('no public image link'), { code: 'no_link' });
      return count(await sendImage(phone, opts.url, caption, env));
    },
    // Media on MSG91 comes as a link that needs the auth key.
    download: async (raw) => {
      if (!raw?.url) throw new Error('no media link in the webhook');
      const res = await fetch(raw.url, { headers: { authkey: env.MSG91_AUTH_KEY }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`media HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
