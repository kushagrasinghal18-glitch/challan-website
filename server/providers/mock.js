// Deterministic sample data so every plate gives the same answer on every check.
// Plates ending in 0000 have no challans; plates ending in 9999 simulate an outage.
const POOL = [
  { offence: 'Over-speeding', amount: 2000 },
  { offence: 'Red-light jumping', amount: 5000 },
  { offence: 'Driving without seatbelt', amount: 1000 },
  { offence: 'Drunk driving', amount: 10000 },
  { offence: 'Parking in no-parking zone', amount: 500 },
  { offence: 'Riding without helmet', amount: 1000 },
  { offence: 'Wrong-side driving', amount: 5000 },
  { offence: 'Pollution certificate not carried', amount: 500 },
];
const PLACES = ['Sector 62, Noida', 'Pari Chowk, Greater Noida', 'Noida–Greater Noida Expressway', 'Sector 18, Noida', 'DND Flyway', 'Film City, Sector 16A'];

function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
}

export async function fetchChallans(plate) {
  await new Promise((r) => setTimeout(r, 900));
  if (plate.endsWith('0000')) return [];
  if (plate.endsWith('9999')) throw new Error('Mock provider: simulated outage');

  const rnd = seeded(plate);
  const count = 2 + Math.floor(rnd() * 4);
  const start = Math.floor(rnd() * POOL.length);
  const today = new Date('2026-09-30');
  return Array.from({ length: count }, (_, i) => {
    const pick = POOL[(start + i * 3) % POOL.length];
    const daysAgo = 20 + i * 45 + Math.floor(rnd() * 30);
    const d = new Date(today - daysAgo * 864e5);
    return {
      challanNo: plate.slice(0, 2) + String(54783000000000 + Math.floor(rnd() * 1e9)),
      date: d.toISOString().slice(0, 10),
      offence: pick.offence,
      location: PLACES[Math.floor(rnd() * PLACES.length)],
      amount: pick.amount,
      status: i === count - 1 && rnd() > 0.5 ? 'Paid' : 'Pending',
    };
  });
}
