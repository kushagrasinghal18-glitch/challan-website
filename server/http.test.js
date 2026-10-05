import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, fetchChallans } from './providers/http.js';
import { classify } from './offences.js';

test('normalize maps common provider field names', () => {
  const c = normalize({ challan_no: 'UP123', challan_date: '14-08-2026 10:22', offence_name: 'Over Speeding', place: 'Sector 62', amount: '₹2,000', challan_status: 'Pending' });
  assert.deepEqual(c, { challanNo: 'UP123', date: '2026-08-14', offence: 'Over Speeding', location: 'Sector 62', amount: 2000, status: 'Pending' });
});

test('classify marks drunk driving, court and paid challans', () => {
  assert.equal(classify({ offence: 'Drunken driving', status: 'Pending' }).eligibility, 'not');
  assert.equal(classify({ offence: 'Over speeding', status: 'Sent to Virtual Court' }).reason, 'court');
  assert.equal(classify({ offence: 'Over speeding', status: 'Disposed' }).eligibility, 'paid');
  assert.equal(classify({ offence: 'No helmet', status: 'Pending' }).eligibility, 'eligible');
});

test('fetchChallans calls the configured endpoint with key header', async (t) => {
  let seen;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    seen = { url, opts };
    return new Response(JSON.stringify({ result: { list: [{ challan_no: 'A1', amount: 500, offence: 'Parking' }] } }));
  });
  const rows = await fetchChallans('UP16AB1234', {
    CHALLAN_API_URL: 'https://p.example/v1?veh={plate}', CHALLAN_API_KEY: 'k', CHALLAN_API_KEY_HEADER: 'Authorization',
    CHALLAN_API_KEY_PREFIX: 'Bearer ', CHALLAN_API_LIST_PATH: 'result.list',
  });
  assert.equal(seen.url, 'https://p.example/v1?veh=UP16AB1234');
  assert.equal(seen.opts.headers.Authorization, 'Bearer k');
  assert.equal(rows[0].challanNo, 'A1');
});
