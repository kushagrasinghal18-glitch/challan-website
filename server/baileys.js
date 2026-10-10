// WhatsApp through a linked device (Baileys), like WhatsApp Web. The number keeps working on the phone;
// this server is one more linked device on it. Scan the QR (or type the pairing code) once from
// Settings → Automatic WhatsApp; the login is kept by waAuth.js so restarts reconnect by themselves.
// WA_BAILEYS=off switches it off completely.
import QRCode from 'qrcode';
import { makeWASocket, Browsers, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, getContentType,
  normalizeMessageContent, isLidUser, jidDecode } from 'baileys';
import { useStoredAuthState, hasSavedLogin, clearLogin } from './waAuth.js';

const quiet = { level: 'silent', child() { return quiet; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

export const liveEnabled = (env = process.env) => env.WA_BAILEYS !== 'off';

// Send caps across the whole number, on top of WhatsApp's own limits. Replies only, never cold messages.
const PER_HOUR = () => Number(process.env.WA_MAX_PER_HOUR) || 60;
const PER_DAY = () => Number(process.env.WA_MAX_PER_DAY) || 400;
const sentAt = [];

let sock = null, state = 'off', qr = null, pairCode = null, pairPhone = '', me = '', lastError = '', retry = 0, timer = null;
let onMessage = () => {}, onStatus = () => {}, onSkip = () => {};
const ours = new Map(); // message id → phone, for messages this server sent (so they aren't saved twice)

export function status() {
  return { state, qr, pairCode, me, error: lastError, sentLastHour: sentAt.filter((t) => t > Date.now() - 3600e3).length };
}
export const isLive = () => state === 'open' && !!sock;

// "919876543210@s.whatsapp.net" (or a device jid) → "9876543210"; anything else → ''.
export function phoneOf(jid) {
  const user = jidDecode(jid || '')?.user || '';
  return /^91[6-9]\d{9}$/.test(user) ? user.slice(2) : '';
}
const jidOf = (phone) => `91${phone}@s.whatsapp.net`;

// Text and kind of a WhatsApp message, with captions, replies and disappearing-message wrappers unpacked.
export function readMessage(message) {
  const m = normalizeMessageContent(message);
  if (!m) return null;
  const type = getContentType(m);
  if (!type || ['protocolMessage', 'reactionMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'pollUpdateMessage'].includes(type)) return null;
  const c = m[type] || {};
  const kinds = { imageMessage: 'image', documentMessage: 'document', documentWithCaptionMessage: 'document', audioMessage: 'audio', videoMessage: 'video', stickerMessage: 'sticker', locationMessage: 'location', contactMessage: 'contact' };
  const kind = kinds[type] || 'text';
  const text = m.conversation || m.extendedTextMessage?.text || c.caption || m.buttonsResponseMessage?.selectedDisplayText
    || m.listResponseMessage?.title || m.templateButtonReplyMessage?.selectedDisplayText || '';
  const label = { image: '[photo]', document: `[document${c.fileName ? `: ${c.fileName}` : ''}]`, audio: '[voice message]', video: '[video]', sticker: '[sticker]', location: '[location]', contact: '[contact]' }[kind];
  return { kind, text: String(label && text ? `${label} ${text}` : label || text).slice(0, 4000), mime: c.mimetype || '', size: Number(c.fileLength || 0) };
}

async function resolvePhone(key) {
  const jid = key.remoteJid || '';
  if (!isLidUser(jid)) return phoneOf(jid);
  if (key.remoteJidAlt) return phoneOf(key.remoteJidAlt);
  try { return phoneOf(await sock?.signalRepository?.lidMapping?.getPNForLID(jid)); } catch { return ''; }
}

async function handleUpsert({ messages, type }) {
  if (type !== 'notify') return; // history sync, not new messages
  for (const msg of messages) {
    const jid = msg.key?.remoteJid || '';
    if (!msg.message || !/@(s\.whatsapp\.net|lid)$/.test(jid)) continue; // groups, status, channels
    if (msg.key.fromMe && ours.has(msg.key.id)) continue;
    const body = readMessage(msg.message);
    if (!body) continue;
    const phone = await resolvePhone(msg.key);
    if (!phone || phone === me) {
      console.log('[wa] skipped message from', jid.replace(/\d(?=\d{4})/g, '•'));
      onSkip(phone ? 'Message from this same number ignored.' : 'Message ignored: WhatsApp did not share an Indian mobile number for this chat.');
      continue;
    }
    const at = new Date(Number(msg.messageTimestamp || 0) * 1000 || Date.now()).toISOString();
    try {
      await onMessage({ id: msg.key.id, phone, jid, fromMe: !!msg.key.fromMe, name: msg.pushName || '', at, ...body, raw: msg });
    } catch (err) { console.error('[wa] message handling failed', err.message); onSkip(`Message could not be handled: ${err.message}`); }
  }
}

function handleUpdates(updates) {
  const names = { 3: 'delivered', 4: 'read', 5: 'read' };
  for (const { key, update } of updates) {
    const st = names[update?.status];
    if (st && ours.has(key?.id)) onStatus({ id: key.id, phone: ours.get(key.id), status: st, at: new Date().toISOString() });
  }
}

async function connect() {
  clearTimeout(timer);
  if (sock || !liveEnabled()) return;
  state = 'connecting'; lastError = '';
  const { state: auth, saveCreds } = await useStoredAuthState();
  let version;
  try { version = (await fetchLatestBaileysVersion()).version; } catch { /* use the built-in version */ }
  const s = makeWASocket({
    auth, logger: quiet, browser: Browsers.macOS('Chrome'), markOnlineOnConnect: false, syncFullHistory: false,
    ...(version ? { version } : {}), getMessage: async () => undefined,
  });
  sock = s;
  s.ev.on('creds.update', saveCreds);
  s.ev.on('messages.upsert', (u) => { if (sock === s) handleUpsert(u); });
  s.ev.on('messages.update', (u) => { if (sock === s) handleUpdates(u); });
  s.ev.on('connection.update', async (u) => {
    if (sock !== s) return;
    if (u.qr) {
      state = 'qr';
      qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 280 }).catch(() => null);
      if (pairPhone && !pairCode) {
        try { pairCode = await s.requestPairingCode(`91${pairPhone}`); } catch (err) { lastError = 'pairing_failed'; console.error('[wa] pairing code failed', err.message); }
      }
    }
    if (u.connection === 'open') {
      state = 'open'; qr = null; pairCode = null; pairPhone = ''; retry = 0; lastError = '';
      me = phoneOf(s.user?.id) || '';
      console.log('[wa] connected', me ? `as ${me.slice(0, 2)}••••${me.slice(-4)}` : '');
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      sock = null; qr = null;
      try { s.ev.removeAllListeners(); } catch { /* already gone */ }
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession || code === DisconnectReason.multideviceMismatch) {
        state = 'off'; me = ''; pairCode = null; lastError = 'logged_out';
        console.log('[wa] logged out', code);
        await clearLogin().catch(() => {});
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        // Another copy of this server (a new deploy) took over the same login.
        state = 'replaced'; lastError = 'replaced';
        console.log('[wa] replaced by another connection');
        return;
      }
      state = 'connecting';
      const wait = code === DisconnectReason.restartRequired ? 500 : Math.min(60_000, 2000 * 2 ** retry++);
      console.log('[wa] closed', code, `retrying in ${Math.round(wait / 1000)}s`);
      timer = setTimeout(() => connect().catch((err) => console.error('[wa] reconnect failed', err.message)), wait);
    }
  });
}

// On server start: reconnect when a number was linked before (unless switched off in Settings).
export async function startLive(handlers, { connectNow = true } = {}) {
  onMessage = handlers.onMessage || onMessage;
  onStatus = handlers.onStatus || onStatus;
  onSkip = handlers.onSkip || onSkip;
  if (connectNow) await resume();
}

// Switched off in Settings: disconnect but keep the login, so switching on again needs no new scan.
export async function pause() {
  clearTimeout(timer);
  const s = sock; sock = null;
  if (s) { try { s.ev.removeAllListeners(); s.end?.(undefined); } catch { /* already closed */ } }
  state = 'off'; qr = null; pairCode = null; pairPhone = ''; lastError = '';
}

// Switched on again: reconnect with the saved login, if there is one.
export async function resume() {
  if (liveEnabled() && await hasSavedLogin()) await connect().catch((err) => console.error('[wa] start failed', err.message));
}

// From Settings: show a QR, or with a phone number get an 8-character pairing code instead.
export async function link(phone = '') {
  if (!liveEnabled()) throw Object.assign(new Error('switched off'), { code: 'live_off' });
  if (state === 'open') return;
  if (phone) {
    pairPhone = phone; pairCode = null;
    // A pairing code needs a fresh socket that hasn't shown a QR yet.
    if (sock && state === 'qr') { const s = sock; sock = null; try { s.ev.removeAllListeners(); s.end?.(undefined); } catch { /* ignore */ } }
  }
  if (state === 'replaced') state = 'off';
  await connect();
}

export async function logout() {
  clearTimeout(timer);
  const s = sock; sock = null;
  if (s) { try { await s.logout(); } catch { /* already logged out */ } try { s.ev.removeAllListeners(); } catch { /* ignore */ } }
  await clearLogin();
  state = 'off'; qr = null; pairCode = null; pairPhone = ''; me = ''; lastError = '';
}

function takeSendSlot() {
  const now = Date.now();
  while (sentAt.length && sentAt[0] < now - 864e5) sentAt.shift();
  if (sentAt.length >= PER_DAY() || sentAt.filter((t) => t > now - 3600e3).length >= PER_HOUR()) {
    throw Object.assign(new Error('send limit reached'), { code: 'send_limit' });
  }
  sentAt.push(now);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends like a person would: shows "typing…" for a moment first. Returns the message id.
export async function sendText(phone, text, { jid, typing = true } = {}) {
  if (!isLive()) throw Object.assign(new Error('not connected'), { code: 'not_connected' });
  takeSendSlot();
  const to = jid || jidOf(phone);
  if (typing) {
    try { await sock.presenceSubscribe(to); await sock.sendPresenceUpdate('composing', to); } catch { /* not important */ }
    await wait(Math.min(6000, 1500 + String(text).length * 25));
    try { await sock.sendPresenceUpdate('paused', to); } catch { /* not important */ }
  }
  if (!isLive()) throw Object.assign(new Error('not connected'), { code: 'not_connected' });
  const sent = await sock.sendMessage(to, { text: String(text).slice(0, 4096) });
  remember(sent?.key?.id, phone);
  return sent?.key?.id || '';
}

export async function sendImage(phone, buffer, caption = '', { jid } = {}) {
  if (!isLive()) throw Object.assign(new Error('not connected'), { code: 'not_connected' });
  takeSendSlot();
  const sent = await sock.sendMessage(jid || jidOf(phone), { image: buffer, caption });
  remember(sent?.key?.id, phone);
  return sent?.key?.id || '';
}

function remember(id, phone) {
  if (!id) return;
  ours.set(id, phone);
  if (ours.size > 5000) ours.delete(ours.keys().next().value);
}

export async function download(raw) {
  return downloadMediaMessage(raw, 'buffer', {}, { logger: quiet, reuploadRequest: sock?.updateMediaMessage });
}
