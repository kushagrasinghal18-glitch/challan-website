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
    offence: clean(offence).replace(/\s*\.\s*$/, '').slice(0, 300),
    location: clean(location).slice(0, 200),
    amount: amountM ? Number((amountM[1] || amountM[2]).replace(/,/g, '')) || 0 : 0,
    status,
  };
}

// A challan number on its own line: letters + digits (UP16…, DL21…) or digits only
// (Delhi Traffic Police notices such as 64473267).
const NO_LINE = /^(?:[A-Z]{2,4}\d{6,}[A-Z0-9]*|\d{7,14})$/;

export function parseChallans(text) {
  const t = String(text || '').replace(/\r/g, '');
  // 1) Numbers that sit on their own line (Park+, CarInfo and similar card layouts).
  let hits = [];
  let pos = 0;
  for (const line of t.split('\n')) {
    const l = line.trim();
    if (NO_LINE.test(l)) hits.push({ no: l, index: t.indexOf(line, pos) });
    pos += line.length + 1;
  }
  // 2) Otherwise, challan numbers inside running text (tables, Parivahan).
  if (!hits.length) hits = [...t.matchAll(CHALLAN_NO)].map((m) => ({ no: m[0], index: m.index }));
  hits = hits.filter((h, i, all) => all.findIndex((x) => x.no === h.no) === i);
  return hits.map((h, i) => parseBlock(h.no, t.slice(h.index, i + 1 < hits.length ? hits[i + 1].index : undefined)));
}
