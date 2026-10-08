// WhatsApp Business Platform (Meta Cloud API). Switched on only when these are set in the server
// environment (Render → Environment), never in code:
//   WHATSAPP_TOKEN            permanent access token (System User token)
//   WHATSAPP_PHONE_ID         phone number ID of the business number
//   WHATSAPP_VERIFY_TOKEN     any secret phrase, also typed into Meta's webhook settings
//   WHATSAPP_APP_SECRET       app secret, used to check that webhook calls really come from Meta
//   WHATSAPP_APPROVAL_TEMPLATE (optional) approved utility template used outside the 24-hour reply window
//   WHATSAPP_TEMPLATE_LANG    (optional) template language code, default en
import crypto from 'node:crypto';

// WHATSAPP_GRAPH_URL only for local testing against a stand-in server.
const graph = (env) => env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com/v21.0';
export const WINDOW_MS = 24 * 3600_000;

export const waConfigured = (env = process.env) => !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID);

// Meta signs each webhook body with the app secret (X-Hub-Signature-256: sha256=<hex>).
export function validSignature(raw, header, secret) {
  if (!secret || !raw || !header?.startsWith('sha256=')) return false;
  const want = Buffer.from(crypto.createHmac('sha256', secret).update(raw).digest('hex'));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// Webhook body → flat lists of incoming messages and delivery updates.
export function parseWebhook(body) {
  const messages = [], statuses = [];
  for (const entry of body?.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || '']));
      for (const m of v.messages || []) {
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
          ?? m.image?.caption ?? m.document?.caption ?? (m.type ? `[${m.type}]` : '');
        messages.push({ id: m.id, from: String(m.from || ''), name: names[m.from] || '', text: String(text).slice(0, 4000),
          at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString() });
      }
      for (const s of v.statuses || []) {
        statuses.push({ id: s.id, status: s.status, at: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString(),
          error: s.errors?.[0]?.title || s.errors?.[0]?.message || '' });
      }
    }
  }
  return { messages, statuses };
}

// "919876543210" → "9876543210"; Indian numbers only.
export const localPhone = (waId) => {
  const d = String(waId || '').replace(/\D/g, '');
  return d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 10 ? d : '';
};

export const saysApprove = (text) => /\bI\s*APPROVE\b/i.test(text || '') || /^\s*(मैं\s*)?(सहमत|मंज़ूर|मंजूर)/.test(text || '');

async function post(payload, env) {
  const res = await fetch(`${graph(env)}/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || `HTTP ${res.status}`), { code: data.error?.code });
  return data.messages?.[0]?.id || '';
}

export const sendText = (to, text, env = process.env) =>
  post({ to, type: 'text', text: { body: String(text).slice(0, 4096), preview_url: false } }, env);

// Template parameters can't hold new lines, tabs or long runs of spaces.
export const sendTemplate = (to, name, params, env = process.env) => post({
  to, type: 'template',
  template: {
    name, language: { code: env.WHATSAPP_TEMPLATE_LANG || 'en' },
    components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p).replace(/\s+/g, ' ').trim().slice(0, 300) || '-' })) }],
  },
}, env);
