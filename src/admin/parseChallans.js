// Turns challan text copied from any website (Park+, Parivahan, Delhi Traffic Police…)
// into rows staff can check before saving. It's a best guess: every row stays editable.

const CHALLAN_NO = /\b[A-Z]{2}\d{6,}[A-Z0-9]*\b/g;
const AMOUNT = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:\/-|rupees)/i;
const DATE = /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?:[ ,T]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*,?\s+\d{4}(?:[ ,]+\d{1,2}:\d{2}(?:\s*[AP]M)?)?)\b/i;
const STATUS = /\b(pending|unpaid|paid|disposed|sent to (?:virtual |regular )?court|virtual court)\b/i;
const OFFENCE_HINT = /speed|helmet|seat ?-?belt|signal|red ?light|park|licen[cs]e|insurance|puc|pollution|wrong ?side|lane|mobile|phone|triple|overload|dangerous|drunk|number ?plate|tint|stop ?line|zebra|horn|permit|fitness|registration|u-?turn|obstruct|section|sec\.|mv act|rule|violat|contravention|without/i;
// "Label: value" lines. Only stripped when there is a colon, so "Violation of parking rules" stays whole.
const LABELED = /^(challan(?: no\.?| number)?|date|issued on|time|amount|fine|status|offen[cs]e|violation|location|place|medium|source|vehicle|owner|rto|state)\s*[:\-]\s*(.*)$/i;
// Page furniture copied along with the challans (Park+, Parivahan and similar).
const NOISE = /^(verified|unverified|view details|pay now|pay|details|updated .*|source\s*:.*|challan may move to court in.*|\d+\s*day\(?s\)?|issued on.*|medium\s*:.*|location\s*:.*|[\d,.₹\s/-]+|rs\.?\s*[\d,.]+)$/i;

const clean = (s) => s.replace(/\s+/g, ' ').trim();

function parseBlock(no, text) {
  const lines = text.split(/\n|\t|\s{3,}/).map((l) => clean(l)).filter((l) => l && l !== no);
  const labeled = {};
  for (const l of lines) {
    const m = l.match(LABELED);
    if (m) labeled[m[1].toLowerCase().replace(/\s.*/, '')] ??= clean(m[2]);
  }
  const issued = text.match(/issued on\s*:?\s*([^\n]+)/i);
  const dateM = (issued && issued[1].match(DATE)) || text.match(DATE);
  const amountM = text.match(AMOUNT);
  const courtIn = text.match(/move to court in\s*(\d+)\s*day/i);
  const medium = labeled.medium || '';
  const statusM = text.match(STATUS);
  const status = statusM ? statusM[0].replace(/^\w/, (c) => c.toUpperCase())
    : /court/i.test(medium) ? 'In court'
    : courtIn ? `Pending · may move to court in ${courtIn[1]} days`
    : labeled.status || '';

  const free = lines.filter((l) => !NOISE.test(l) && !LABELED.test(l) && !(dateM && l === dateM[0]));
  const offence = labeled.offence || labeled.offense || labeled.violation
    || free.find((l) => OFFENCE_HINT.test(l)) || free.sort((a, b) => b.length - a.length)[0] || '';
  const location = labeled.location || labeled.place
    || free.find((l) => l !== offence && /road|marg|chowk|sector|nagar|flyover|crossing|near|delhi|noida|ghaziabad|gurugram|highway|expressway|expy/i.test(l)) || '';
  return {
    challanNo: no,
    date: dateM ? clean(dateM[0]) : '',
    offence: clean(offence).replace(/\.$/, '').slice(0, 300),
    location: clean(location).slice(0, 200),
    amount: amountM ? Number((amountM[1] || amountM[2]).replace(/,/g, '')) || 0 : 0,
    status,
  };
}

export function parseChallans(text) {
  const t = String(text || '');
  const hits = [...t.matchAll(CHALLAN_NO)].filter((m, i, all) => all.findIndex((x) => x[0] === m[0]) === i);
  if (!hits.length) return [];
  return hits.map((m, i) => parseBlock(m[0], t.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : undefined)));
}
