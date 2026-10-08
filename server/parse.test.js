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

test('reads the Park+ card layout (made-up numbers)', () => {
  const text = `UP100000260101000001

Verified

₹1500

Violation of parking rules.

Issued on 16 Apr, 2026

Location: Sector 18, noida, uttar pradesh 201301, india
Medium: Online
Source: Parivahan
Updated 7 days ago

View details

Challan may move to court in

7 day(s)
DL10000250101000002

Verified

₹6000

Not using seat-belt

Issued on 05 Apr, 2025

Location: Ito
Medium: Court
Source: Parivahan
Updated 2 days ago

View details`;
  const [a, b] = parseChallans(text);
  assert.deepEqual(a, { challanNo: 'UP100000260101000001', date: '16 Apr, 2026', offence: 'Violation of parking rules',
    location: 'Sector 18, noida, uttar pradesh 201301, india', amount: 1500, status: 'Pending · may move to court in 7 days' });
  assert.deepEqual(b, { challanNo: 'DL10000250101000002', date: '05 Apr, 2025', offence: 'Not using seat-belt',
    location: 'Ito', amount: 6000, status: 'In court' });
});

test('reads number-only Delhi challan numbers next to state ones (made-up numbers)', () => {
  const text = `12345678

Verified

₹200

Stop sign on road surface : violating stop line

Issued on 26 Mar, 2025

Location: Ring road
Medium: Court
Source: Delhi
Updated 7 days ago

View details

UP100000250101000003

Verified

₹2000

Disobedience of any direction lawful given by the authority .

Issued on 21 Apr, 2025

Location: Indirapuram, ghaziabad
Medium: Court
Source: Parivahan
Updated now

View details`;
  const rows = parseChallans(text);
  assert.deepEqual(rows.map((r) => [r.challanNo, r.amount, r.status]), [['12345678', 200, 'In court'], ['UP100000250101000003', 2000, 'In court']]);
  assert.equal(rows[0].offence, 'Stop sign on road surface : violating stop line');
  assert.equal(rows[1].offence, 'Disobedience of any direction lawful given by the authority');
});
