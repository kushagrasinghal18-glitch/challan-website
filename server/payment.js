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

export function paymentMessage(lead, pay, dates = []) {
  const { ok, total, rate, payable } = paymentAmounts(lead);
  const lok = lokFor(lead, dates);
  const lokDate = lok ? new Date(`${lok.date}T${lok.time || '10:00'}:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const line = (c, i) => `${i + 1}. Challan ${c.challanNo || '-'}${c.date ? ` (${c.date})` : ''}${c.offence ? ` - ${String(c.offence).slice(0, 70)}` : ''} - ${inr(c.amount || 0)}`;
  return [
    `Hi ${lead.name},`,
    '',
    `Thank you for your approval. Here are the payment details for settling the challans on your vehicle ${fmtPlate(lead.plate)}:`,
    '',
    ...ok.map(line),
    `Challan amount: ${inr(total)}`,
    `*Amount to pay (${rate}%): ${inr(payable)}*`,
    '',
    `*Pay by UPI:* ${pay.upiId}${pay.payeeName ? ` (${pay.payeeName})` : ''}`,
    `Amount: ${inr(payable)} · Note/remark: ${lead.ref}`,
    'Or scan the QR code we are sending with this message.',
    ...(lok ? ['', `Your challans will be settled at the Lok Adalat on *${lokDate}* at ${CITY_COURT[lok.city] || lok.city}.`] : []),
    '',
    `*Note:* In case the challan is not cleared, the full 100% of the amount will be refunded after the Lok Adalat date${lok ? ` (${lokDate})` : ''}.`,
    '',
    'Please share the payment screenshot here once done.',
    `Reference: ${lead.ref}`,
    'Team Niptao',
  ].join('\n');
}
