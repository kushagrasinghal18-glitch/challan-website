// Payment request sent on WhatsApp once the customer has approved: approved challans, amount,
// UPI ID / pay link and the refund promise. Used by the admin drawer and the WhatsApp Web add-on.
const FEE_RATES = [50, 40, 30];
const CITY_COURT = { noida: 'District Court, Surajpur', ghaziabad: 'District Court, Ghaziabad', delhi: 'Delhi court complex', gurugram: 'District Court, Gurugram' };
const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmtPlate = (p) => String(p || '').replace(/^([A-Z]{2}\d{1,2})([A-Z]{0,3})(\d{4})$/, (m, a, b, c) => [a, b, c].filter(Boolean).join(' '));

export const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

export function paymentAmounts(lead) {
  const ok = (lead.challans || []).filter((c) => c.approved);
  const total = ok.reduce((n, c) => n + (c.amount || 0), 0);
  const rate = FEE_RATES.includes(lead.feeRate) ? lead.feeRate : 50;
  return { ok, total, rate, payable: Math.round((total * rate) / 100) };
}

// Next Lok Adalat for the lead's city, else the soonest anywhere. dates: upcoming only, sorted.
export const lokFor = (lead, dates = []) => dates.find((d) => d.city === lead.city) || dates[0] || null;

export function upiLink(pay, amount, ref) {
  const q = new URLSearchParams({ pa: pay.upiId, pn: pay.payeeName || 'Niptao', am: String(amount), cu: 'INR', tn: `Niptao ${ref}` });
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}

// WhatsApp formatting: *bold*, _italic_. Each challan is its own short block and the UPI ID sits
// on a line by itself so it can be long-pressed and copied.
export function paymentMessage(lead, pay, dates = []) {
  const { ok, total, rate, payable } = paymentAmounts(lead);
  const lok = lokFor(lead, dates);
  const lokAt = lok ? new Date(`${lok.date}T${lok.time || '10:00'}:00+05:30`) : null;
  const day = (opts) => lokAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', ...opts });
  const lokDate = lok ? day({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const lokShort = lok ? day({ day: 'numeric', month: 'short' }) : '';
  const offence = (c) => { const o = String(c.offence || '').replace(/\s+/g, ' ').trim(); return o.length > 60 ? `${o.slice(0, 59)}…` : o; };
  const block = (c, i) => [
    `${i + 1}. ${c.challanNo || '-'}${c.date ? ` · ${c.date}` : ''}`,
    ...(offence(c) ? [`   ${offence(c)}`] : []),
    `   ${inr(c.amount || 0)}`,
  ].join('\n');
  return [
    `Hi ${lead.name} 👋`,
    '',
    'Thank you for approving. Here are your payment details.',
    '',
    `🚗 *Vehicle:* ${fmtPlate(lead.plate)}`,
    `📋 *Challans to settle (${ok.length})*`,
    ok.map(block).join('\n\n'),
    '',
    `Challan total: ${inr(total)}`,
    `*You pay (${rate}%): ${inr(payable)}*`,
    '',
    '💳 *Pay by UPI*',
    'UPI ID:',
    pay.upiId,
    ...(pay.payeeName ? [`Name: ${pay.payeeName}`] : []),
    `Amount: ${inr(payable)}`,
    `Remark: ${lead.ref}`,
    '_Or scan the QR code sent below._',
    ...(lok ? ['', `📅 *Lok Adalat:* ${lokDate}, ${CITY_COURT[lok.city] || lok.city}`] : []),
    '',
    '✅ *100% refund promise*',
    `If your challan is not cleared, the full amount will be refunded after the Lok Adalat date${lok ? ` (${lokShort})` : ''}.`,
    '',
    'Once paid, please send the payment screenshot here.',
    '',
    `Ref: ${lead.ref}`,
    '— Team Niptao',
  ].join('\n');
}
