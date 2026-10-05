// Client for the server in /server. The browser never talks to the challan
// provider directly, so provider keys stay on the server.
export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

let token = null;

async function call(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body && JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'unknown');
  return data;
}

export const getConfig = () => call('/api/config');
export const sendOtp = (phone) => call('/api/otp/send', { method: 'POST', body: { phone } });
export async function verifyOtp(phone, code) {
  const r = await call('/api/otp/verify', { method: 'POST', body: { phone, code } });
  token = r.token;
}
export const fetchChallans = (plate) => call(`/api/challans?plate=${encodeURIComponent(plate.replace(/\s/g, ''))}`);
export const createLead = (lead) => call('/api/leads', { method: 'POST', body: lead });
