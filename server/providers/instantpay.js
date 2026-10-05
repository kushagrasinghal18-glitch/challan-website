// InstantPay Vehicle Challan API
// https://developers.instantpay.in/reference/identity-verification-vehicle-challan
// Each successful call is debited from your InstantPay pool balance, so results
// are cached per plate for a short while (see providers/index.js).
import crypto from 'node:crypto';

const DEFAULT_URL = 'https://api.instantpay.in/identity/vehicleChallan';

// InstantPay wants the end customer's IPv4/IPv6 without the "::ffff:" prefix.
const cleanIp = (ip) => String(ip || '').replace(/^::ffff:/, '') || '127.0.0.1';

export function normalize(row) {
  const offences = Array.isArray(row.offences) ? row.offences : [];
  return {
    challanNo: String(row.challanNumber ?? row.challanId ?? ''),
    date: row.challanDate ? String(row.challanDate).slice(0, 10) : null,
    offence: offences.map((o) => o.offenceName).filter(Boolean).join(', ') || 'Traffic offence',
    location: '', // not returned by InstantPay
    amount: Number(String(row.challanAmount ?? 0).replace(/[^\d.]/g, '')) || 0,
    status: row.challanStatus || 'Pending',
  };
}

export async function fetchChallans(plate, env = process.env, ctx = {}) {
  if (!env.INSTANTPAY_CLIENT_ID || !env.INSTANTPAY_CLIENT_SECRET) {
    throw new Error('INSTANTPAY_CLIENT_ID / INSTANTPAY_CLIENT_SECRET are not set');
  }
  const res = await fetch(env.INSTANTPAY_API_URL || DEFAULT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Ipay-Auth-Code': '1',
      'X-Ipay-Client-Id': env.INSTANTPAY_CLIENT_ID,
      'X-Ipay-Client-Secret': env.INSTANTPAY_CLIENT_SECRET,
      'X-Ipay-Endpoint-Ip': cleanIp(ctx.ip),
    },
    body: JSON.stringify({
      vehicleRegistrationNumber: plate,
      consent: 'Y',
      latitude: env.INSTANTPAY_LATITUDE || '28.5355',
      longitude: env.INSTANTPAY_LONGITUDE || '77.3910',
      externalRef: 'NPT' + Date.now() + crypto.randomInt(1000, 9999),
    }),
    signal: AbortSignal.timeout(Number(env.CHALLAN_API_TIMEOUT_MS) || 20000),
  });

  const json = await res.json().catch(() => ({}));
  if (json.statuscode === 'TXN') {
    const rows = json.data?.vehicalData; // sic: InstantPay's spelling
    return Array.isArray(rows) ? rows.map(normalize) : [];
  }
  // A plate with no challans may come back as a non-TXN "not found" rather than an empty list.
  if (/no (record|challan|data)|not found/i.test(json.status || '')) return [];
  throw new Error(`InstantPay ${res.status} ${json.statuscode || ''}: ${json.status || 'no response body'}`);
}
