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
