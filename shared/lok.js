// Which Lok Adalat date a customer's challans go to. Each challan is settled in the state that issued it
// (read from the challan number), so a lead with Delhi and UP challans gets both states' dates.
// Used by the server (payment message) and the admin panel (approval message).

const CITY_STATE = { noida: 'UP', ghaziabad: 'UP', delhi: 'DL', gurugram: 'HR' };
const STATE_LABEL = { UP: 'UP', DL: 'Delhi', HR: 'Haryana' };

// State code from the challan number: Delhi Traffic Police numbers are digits only, others start with the state (UP…, HR…).
export function challanStateCode(c) {
  const no = String(c?.challanNo || '').toUpperCase().replace(/\s/g, '');
  if (/^\d{6,}$/.test(no)) return 'DL';
  return /^[A-Z]{2}/.test(no) ? no.slice(0, 2) : '';
}

// dates: upcoming Lok Adalat dates, sorted soonest first. Returns [{ state, label, lok }], one per state
// that has a date, soonest first. A state with no upcoming date is left out. Challans with no readable
// state (or no challans at all) fall back to the lead's city, else the soonest date, as before.
export function lokPlan(lead, challans = [], dates = []) {
  const states = [...new Set(challans.map(challanStateCode))];
  const out = new Map();
  for (const st of states.length ? states : ['']) {
    const lok = !st
      ? dates.find((d) => d.city === lead.city) || dates[0]
      : (CITY_STATE[lead.city] === st && dates.find((d) => d.city === lead.city)) || dates.find((d) => CITY_STATE[d.city] === st);
    if (!lok) continue;
    const key = CITY_STATE[lok.city] || lok.city;
    if (!out.has(key)) out.set(key, { state: key, label: STATE_LABEL[key] || key, lok });
  }
  return [...out.values()].sort((a, b) => (a.lok.date + (a.lok.time || '')).localeCompare(b.lok.date + (b.lok.time || '')));
}

const at = (lok) => new Date(`${lok.date}T${lok.time || '10:00'}:00+05:30`);
export const lokLong = (lok) => at(lok).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const lokShort = (lok) => at(lok).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
