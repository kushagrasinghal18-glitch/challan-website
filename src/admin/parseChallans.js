// Turns challan text copied from any website (Park+, Parivahan, Delhi Traffic Police…)
// into rows staff can check before saving. It's a best guess: every row stays editable.

const CHALLAN_NO = /\b[A-Z]{2}\d{6,}[A-Z0-9]*\b/g;
const AMOUNT = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:\/-|rupees)/i;
const DATE = /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?:[ ,T]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*,?\s+\d{4}(?:[ ,]+\d{1,2}:\d{2}(?:\s*[AP]M)?)?)\b/i;
const STATUS = /\b(pending|unpaid|paid|disposed|sent to (?:virtual |regular )?court|virtual court|in court|court)\b/i;
const OFFENCE_HINT = /speed|helmet|seat ?belt|signal|red ?light|park|licen[cs]e|insurance|puc|pollution|wrong ?side|lane|mobile|phone|triple|overload|dangerous|drunk|number ?plate|tint|stop ?line|zebra|horn|permit|fitness|registration|u-?turn|obstruct|section|sec\.|mv act|rule/i;
const LABEL = /^(challan|challan no\.?|challan number|date|time|amount|fine|status|offen[cs]e|violation|location|place|vehicle|owner|rto|state)\s*[:\-]?\s*/i;

const clean = (s) => s.replace(/\s+/g, ' ').trim();

function parseBlock(no, text) {
  const lines = text.split(/\n|\t|\s{3,}/).map((l) => clean(l)).filter(Boolean);
  const amountM = text.match(AMOUNT);
  const dateM = text.match(DATE);
  const statusM = text.match(STATUS);
  const rest = lines
    .map((l) => l.replace(LABEL, ''))
    .filter((l) => l && !l.includes(no) && !(dateM && l === dateM[0]) && !(amountM && l === amountM[0]) && !/^[\d,.₹\s/-]+$/.test(l) && !STATUS.test(l) || OFFENCE_HINT.test(l));
  const offence = rest.find((l) => OFFENCE_HINT.test(l) && !l.includes(no)) || rest.sort((a, b) => b.length - a.length)[0] || '';
  const location = rest.find((l) => l !== offence && /road|marg|chowk|sector|nagar|flyover|crossing|near|delhi|noida|ghaziabad|gurugram|ncr|highway|expressway/i.test(l)) || '';
  return {
    challanNo: no,
    date: dateM ? clean(dateM[0]) : '',
    offence: clean(offence).slice(0, 300),
    location: clean(location).slice(0, 200),
    amount: amountM ? Number((amountM[1] || amountM[2]).replace(/,/g, '')) || 0 : 0,
    status: statusM ? statusM[0].replace(/^\w/, (c) => c.toUpperCase()) : '',
  };
}

export function parseChallans(text) {
  const t = String(text || '');
  const hits = [...t.matchAll(CHALLAN_NO)].filter((m, i, all) => all.findIndex((x) => x[0] === m[0]) === i);
  if (!hits.length) return [];
  return hits.map((m, i) => parseBlock(m[0], t.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : undefined)));
}
