import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChallans } from '../src/admin/parseChallans.js';

test('pulls challan rows out of copied text', () => {
  const text = `Challan No: DL116798240922112233
Date: 14-08-2026 10:22
Over Speeding (Sec 183 MV Act)
Ring Road, near ITO, Delhi
₹2,000   Pending

Challan No: UP16798240000123
12 Jul 2026
Driving without helmet
Rs. 1000 Paid`;
  const rows = parseChallans(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].challanNo, 'DL116798240922112233');
  assert.equal(rows[0].amount, 2000);
  assert.equal(rows[0].date, '14-08-2026 10:22');
  assert.match(rows[0].offence, /Over Speeding/);
  assert.match(rows[0].location, /Ring Road/);
  assert.equal(rows[0].status, 'Pending');
  assert.equal(rows[1].amount, 1000);
  assert.match(rows[1].offence, /helmet/);
  assert.equal(rows[1].status, 'Paid');
  assert.deepEqual(parseChallans('nothing here'), []);
});
