// Generic adapter for a challan data provider (any aggregator that exposes
// vehicle-number → e-challan list over HTTP). Configure it entirely from env;
// see .env.example. If your provider's field names differ from the common
// ones below, add them to PICK.
const PICK = {
  challanNo: ['challan_no', 'challanNo', 'challan_number', 'challanNumber', 'notice_no', 'id'],
  date: ['challan_date', 'challanDate', 'date', 'offence_date', 'date_time', 'challan_date_time'],
  offence: ['offence', 'offence_name', 'offenceName', 'offense', 'violation', 'offence_details', 'offences'],
  location: ['place', 'location', 'challan_place', 'address', 'area'],
  amount: ['amount', 'fine', 'fine_amount', 'penalty', 'total_amount', 'challan_amount'],
  status: ['status', 'challan_status', 'challanStatus', 'payment_status', 'state'],
};

const first = (obj, keys) => keys.map((k) => obj?.[k]).find((v) => v != null && v !== '');
const getPath = (obj, path) => (path ? path.split('.').reduce((o, k) => o?.[k], obj) : obj);

function toText(v) {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? first(x, ['offence_name', 'name', 'offence']) : x)).filter(Boolean).join(', ');
  return v == null ? '' : String(v);
}

function toIsoDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); // 14-08-2026 style, common in Indian APIs
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

export function normalize(row) {
  return {
    challanNo: toText(first(row, PICK.challanNo)),
    date: toIsoDate(first(row, PICK.date)),
    offence: toText(first(row, PICK.offence)) || 'Traffic offence',
    location: toText(first(row, PICK.location)),
    amount: Number(String(first(row, PICK.amount) ?? 0).replace(/[^\d.]/g, '')) || 0,
    status: toText(first(row, PICK.status)) || 'Pending',
  };
}

export async function fetchChallans(plate, env = process.env) {
  if (!env.CHALLAN_API_URL) throw new Error('CHALLAN_API_URL is not set');
  const fill = (s) => s.replaceAll('{plate}', encodeURIComponent(plate));
  const method = (env.CHALLAN_API_METHOD || 'GET').toUpperCase();
  const headers = { Accept: 'application/json' };
  if (env.CHALLAN_API_KEY) headers[env.CHALLAN_API_KEY_HEADER || 'x-api-key'] = (env.CHALLAN_API_KEY_PREFIX || '') + env.CHALLAN_API_KEY;

  let body;
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    body = (env.CHALLAN_API_BODY || '{"vehicle_number":"{plate}"}').replaceAll('{plate}', plate);
  }

  const res = await fetch(fill(env.CHALLAN_API_URL), {
    method, headers, body,
    signal: AbortSignal.timeout(Number(env.CHALLAN_API_TIMEOUT_MS) || 15000),
  });
  if (!res.ok) throw new Error(`Challan provider responded ${res.status}`);
  const json = await res.json();
  const list = getPath(json, env.CHALLAN_API_LIST_PATH ?? 'data');
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error(`Expected an array at "${env.CHALLAN_API_LIST_PATH}"`);
  return list.map(normalize);
}
