import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchChallans } from './providers/instantpay.js';

const ENV = { INSTANTPAY_CLIENT_ID: 'cid', INSTANTPAY_CLIENT_SECRET: 'sec' };

// Response shape copied from the InstantPay reference page.
const SAMPLE = {
  statuscode: 'TXN', actcode: null, status: 'Transaction Successful',
  data: {
    vehicalData: [
      { rcRegistrationNumber: 'UP16AB1234', challanNumber: 'UP1234567890', challanId: 1, challanDate: '2026-08-14', challanStatus: 'Pending', challanAmount: '2000',
        offences: [{ offenceName: 'Over Speeding', offenceFine: null, motorVehicleAct: '183' }] },
      { rcRegistrationNumber: 'UP16AB1234', challanNumber: 'UP1234567891', challanId: 2, challanDate: '2026-03-08', challanStatus: 'Paid', challanAmount: '500',
        offences: [{ offenceName: 'Parking', motorVehicleAct: '122' }, { offenceName: 'No PUC', motorVehicleAct: '190' }] },
    ],
  },
  environment: 'SANDBOX',
};

test('sends the documented headers and body, maps vehicalData', async (t) => {
  let seen;
  t.mock.method(globalThis, 'fetch', async (url, opts) => { seen = { url, opts }; return new Response(JSON.stringify(SAMPLE)); });
  const rows = await fetchChallans('UP16AB1234', ENV, { ip: '::ffff:49.36.10.2' });
  assert.equal(seen.url, 'https://api.instantpay.in/identity/vehicleChallan');
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers['X-Ipay-Auth-Code'], '1');
  assert.equal(seen.opts.headers['X-Ipay-Client-Id'], 'cid');
  assert.equal(seen.opts.headers['X-Ipay-Client-Secret'], 'sec');
  assert.equal(seen.opts.headers['X-Ipay-Endpoint-Ip'], '49.36.10.2');
  const body = JSON.parse(seen.opts.body);
  assert.equal(body.vehicleRegistrationNumber, 'UP16AB1234');
  assert.equal(body.consent, 'Y');
  assert.ok(body.latitude && body.longitude && body.externalRef);
  assert.deepEqual(rows[0], { challanNo: 'UP1234567890', date: '2026-08-14', offence: 'Over Speeding', location: '', amount: 2000, status: 'Pending' });
  assert.equal(rows[1].offence, 'Parking, No PUC');
});

test('empty list and "not found" give no challans; other errors throw', async (t) => {
  const reply = (body, status = 200) => t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status }));
  reply({ statuscode: 'TXN', data: { vehicalData: [] } });
  assert.deepEqual(await fetchChallans('UP16AB1234', ENV), []);
  reply({ statuscode: 'ERR', status: 'No Record Found' }, 400);
  assert.deepEqual(await fetchChallans('UP16AB1234', ENV), []);
  reply({ statuscode: 'IAC', status: 'Invalid Access Credentials' }, 400);
  await assert.rejects(fetchChallans('UP16AB1234', ENV), /Invalid Access Credentials/);
});

test('refuses to call without credentials', async () => {
  await assert.rejects(fetchChallans('UP16AB1234', {}), /INSTANTPAY_CLIENT_ID/);
});

test('daily cap stops paid lookups and cached plates do not count', async (t) => {
  const { getChallans } = await import('./providers/index.js');
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ statuscode: 'TXN', data: { vehicalData: [] } })); });
  const env = { ...ENV, CHALLAN_PROVIDER: 'instantpay', MAX_LIVE_LOOKUPS_PER_DAY: '2' };
  await getChallans('UP16AB0001', env);
  await getChallans('UP16AB0001', env); // cached
  await getChallans('UP16AB0002', env);
  await assert.rejects(getChallans('UP16AB0003', env), /cap/);
  assert.equal(calls, 2);
});
