import crypto from 'node:crypto';

// One-time passwords and the short-lived session token that unlocks challan data.
const OTP_TTL = 5 * 60_000;
const SESSION_TTL = 30 * 60_000;
const MAX_ATTEMPTS = 5;
const pending = new Map(); // phone → { hash, exp, attempts }

const secret = () => process.env.SESSION_SECRET || 'dev-only-secret';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const otpMode = () => (process.env.OTP_MODE === 'console' ? 'console' : 'demo');

export function sendOtp(phone) {
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  pending.set(phone, { hash: sha(phone + code), exp: Date.now() + OTP_TTL, attempts: 0 });
  // Swap this for your SMS / WhatsApp gateway call when going live.
  if (otpMode() === 'console') console.log(`[otp] ${phone} → ${code}`);
}

export function verifyOtp(phone, code) {
  if (!/^\d{6}$/.test(code || '')) return false;
  if (otpMode() === 'demo') return true;
  const p = pending.get(phone);
  if (!p || p.exp < Date.now() || p.attempts >= MAX_ATTEMPTS) return false;
  p.attempts++;
  if (p.hash !== sha(phone + code)) return false;
  pending.delete(phone);
  return true;
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

export function issueToken(phone) {
  const payload = b64(JSON.stringify({ phone, exp: Date.now() + SESSION_TTL }));
  return `${payload}.${sign(payload)}`;
}

export function readToken(header) {
  const token = (header || '').replace(/^Bearer\s+/i, '');
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return data.exp > Date.now() ? data : null;
}
