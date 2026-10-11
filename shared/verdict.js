// Can Niptao take up a challan? The team marks each one in the lead: c.canDo true (can be resolved),
// false (cannot, with c.notReason) or unset (not checked yet). Used by the panel, the server and the AI.
export const NOT_REASONS = {
  area: {
    label: 'Outside our service area',
    customer: 'This challan is from outside the area we serve right now. We are expanding soon and will let you know as soon as we can take it up.',
    ai: 'outside the area Niptao serves right now (expanding soon, team will inform)',
  },
  court: {
    label: 'Still not in court',
    customer: 'This challan has not reached the court yet, so it cannot be settled at the Lok Adalat right now. We are keeping an eye on it and will let you know once it can be settled.',
    ai: 'not in court yet, so it cannot be settled at the Lok Adalat yet (team will inform once it can)',
  },
};
export const notReason = (c) => NOT_REASONS[c?.notReason] || NOT_REASONS.area;
export const cannotDo = (c) => c?.canDo === false;
// Same challan from two sites (Park+, Parivahan) is matched on its number, ignoring spaces, dashes and case.
export const challanKey = (c) => String(c?.challanNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Adds a new fetch to the challans already on a lead: a known number is updated in place (blank fields
// keep the old value), a new one is added at the end. Nothing already there is dropped.
export function mergeChallans(old = [], fresh = []) {
  const out = old.map((c) => ({ ...c }));
  const at = new Map(out.map((c, i) => [challanKey(c), i]).filter(([k]) => k));
  let added = 0, matched = 0;
  for (const c of fresh) {
    const k = challanKey(c);
    const same = k ? at.get(k) : out.findIndex((o) => !challanKey(o) && o.offence === c.offence && o.amount === c.amount && o.date === c.date);
    if (same !== undefined && same >= 0) {
      const filled = Object.fromEntries(Object.entries(c).filter(([key, v]) => v !== '' && v !== undefined && v !== null && !(key === 'amount' && !v)));
      out[same] = { ...out[same], ...filled, challanNo: out[same].challanNo }; // tokens point at the number as first saved
      matched++;
    } else {
      if (k) at.set(k, out.length);
      out.push({ ...c });
      added++;
    }
  }
  return { challans: out, added, matched };
}
