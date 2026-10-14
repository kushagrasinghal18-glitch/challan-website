// Settings → WhatsApp templates: create MSG91 (Meta) templates from the admin panel, see whether Meta
// approved them, and pick the one used for approval requests after the 24-hour window.
import { getKV, setKV } from './store.js';
import { msg91Configured, createTemplate, templateStatuses, TEMPLATE_NAME_RE } from './msg91.js';
import { paymentAmounts } from './payment.js';
import { cannotDo, notReason } from '../shared/verdict.js';

const CATEGORIES = ['UTILITY', 'MARKETING'];
const LANGS = ['en', 'en_US', 'hi'];
// { list: [{ name, category, language, header, body, footer, buttons, at, by, status }], approval: name, receipt: name, starter: name }
export const getTemplates = async () => ({ list: [], approval: '', receipt: '', starter: '', ...(await getKV('waTemplates', {})) });
export const receiptTemplate = async () => (await getTemplates()).receipt || '';
export const starterTemplate = async () => (await getTemplates()).starter || '';
// The approval template: chosen in the panel, else MSG91_APPROVAL_TEMPLATE (the old 5-blank wording).
// { name, blanks } so the right number of values goes with it.
export async function approvalTemplate() {
  const t = await getTemplates();
  if (t.approval) {
    const body = t.list.find((x) => x.name === t.approval)?.body || '';
    const blanks = Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));
    return { name: t.approval, blanks: blanks || 7 };
  }
  return process.env.MSG91_APPROVAL_TEMPLATE ? { name: process.env.MSG91_APPROVAL_TEMPLATE, blanks: 5 } : null;
}

export function mountTemplates(app, { requireAdmin }) {
  const view = async () => ({ ...(await getTemplates()), configured: msg91Configured(), envApproval: process.env.MSG91_APPROVAL_TEMPLATE || '' });

  app.get('/api/admin/wa-templates', requireAdmin, async (req, res) => {
    try { res.json(await view()); } catch (err) { console.error('[templates] read failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
  });

  app.post('/api/admin/wa-templates', requireAdmin, async (req, res) => {
    if (!msg91Configured()) return res.status(409).json({ error: 'whatsapp_not_set_up' });
    const b = req.body || {};
    const t = {
      name: String(b.name || '').trim().toLowerCase(),
      category: CATEGORIES.includes(b.category) ? b.category : 'UTILITY',
      language: LANGS.includes(b.language) ? b.language : 'en',
      header: String(b.header || '').trim().slice(0, 60),
      body: String(b.body || '').trim().slice(0, 1024),
      footer: String(b.footer || '').trim().slice(0, 60),
      buttons: (Array.isArray(b.buttons) ? b.buttons : []).map((x) => String(x || '').trim().slice(0, 25)).filter(Boolean).slice(0, 3),
      samples: (Array.isArray(b.samples) ? b.samples : []).map((x) => String(x || '').trim().slice(0, 100)),
    };
    if (!TEMPLATE_NAME_RE.test(t.name)) return res.status(400).json({ error: 'invalid_name' });
    if (!t.body) return res.status(400).json({ error: 'empty_body' });
    const nums = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    if (nums.some((n, i) => n < 1) || new Set(nums).size !== Math.max(0, ...nums)) return res.status(400).json({ error: 'bad_variables' });
    try {
      const cur = await getTemplates();
      if (cur.list.some((x) => x.name === t.name && x.language === t.language)) return res.status(409).json({ error: 'duplicate_name' });
      const { id } = await createTemplate(t);
      const entry = { ...t, id, at: new Date().toISOString(), by: req.user.name, status: 'PENDING' };
      await setKV('waTemplates', { ...cur, list: [entry, ...cur.list].slice(0, 100) });
      console.log('[templates] submitted', t.name, 'by', req.user.name);
      res.json(await view());
    } catch (err) {
      console.error('[templates] create failed', err.message);
      res.status(502).json({ error: 'msg91_refused', detail: err.message.slice(0, 300) });
    }
  });

  // Ask MSG91 for Meta's decision on each template.
  app.post('/api/admin/wa-templates/refresh', requireAdmin, async (req, res) => {
    try {
      const cur = await getTemplates();
      let remote;
      try { remote = await templateStatuses(); } catch (err) { return res.status(502).json({ error: 'status_unavailable', detail: err.message.slice(0, 200) }); }
      const known = new Set(cur.list.map((x) => x.name));
      const list = cur.list.map((x) => (remote[x.name] ? { ...x, status: remote[x.name] } : x));
      // Templates made directly in MSG91 show too, so they can be picked for approvals.
      for (const [name, status] of Object.entries(remote)) if (!known.has(name)) list.push({ name, status, external: true });
      await setKV('waTemplates', { ...cur, list });
      res.json(await view());
    } catch (err) { console.error('[templates] refresh failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
  });

  // { approval: name | '' } picks the approval-request template; { name, status } marks a status by hand.
  app.put('/api/admin/wa-templates', requireAdmin, async (req, res) => {
    const b = req.body || {};
    try {
      const cur = await getTemplates();
      for (const k of ['approval', 'receipt', 'starter']) {
        if (typeof b[k] !== 'string') continue;
        if (b[k] && !TEMPLATE_NAME_RE.test(b[k])) return res.status(400).json({ error: 'invalid_name' });
        cur[k] = b[k];
      }
      if (typeof b.name === 'string' && ['APPROVED', 'PENDING', 'REJECTED'].includes(b.status)) {
        cur.list = cur.list.map((x) => (x.name === b.name ? { ...x, status: b.status } : x));
      }
      if (typeof b.remove === 'string') cur.list = cur.list.filter((x) => x.name !== b.remove);
      await setKV('waTemplates', cur);
      res.json(await view());
    } catch (err) { console.error('[templates] save failed', err.message); res.status(500).json({ error: 'storage_unavailable' }); }
  });
}

// The approval template's wording, also used by the "Create the approval template" button (via the panel).
// Blanks: 1 name, 2 vehicle, 3 all challans (count and amount), 4 every challan with what we can do,
// 5 what we will settle, 6 amount to pay, 7 reference.
const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const fmtPlate = (p) => (p || '').replace(/^([A-Z]{2}\d{1,2})([A-Z]{0,3})(\d{4})$/, (m, a, b, c) => [a, b, c].filter(Boolean).join(' '));
const LIST_MAX = 600; // a template blank can't be very long, and has no new lines

export function approvalParams(lead) {
  const all = lead.challans || [];
  const { ok, total, rate, payable } = paymentAmounts(lead);
  const line = (c, i) => {
    const what = cannotDo(c) ? `cannot settle now (${notReason(c).label.toLowerCase()})` : c.approved ? 'we will settle' : 'not included';
    return `${i + 1}) ${[c.challanNo, c.offence].filter(Boolean).join(' ')} ${inr(c.amount)}: ${what}`;
  };
  let list = '';
  for (let i = 0; i < all.length; i++) {
    const next = (list ? list + '; ' : '') + line(all[i], i);
    if (next.length > LIST_MAX) { list += `; and ${all.length - i} more`; break; }
    list = next;
  }
  return [
    lead.name || 'there',
    fmtPlate(lead.plate) || '-',
    `${all.length} challan${all.length === 1 ? '' : 's'} worth ${inr(all.reduce((n, c) => n + (c.amount || 0), 0))}`,
    list || 'none found',
    `${ok.length} challan${ok.length === 1 ? '' : 's'} worth ${inr(total)}`,
    `${inr(payable)} (${rate}% of the challan amount)`,
    lead.ref,
  ];
}

// Templates made before this wording had 5 blanks: name, vehicle, count, amount to pay, reference.
export function legacyParams(lead) {
  const { ok, payable } = paymentAmounts(lead);
  return [lead.name, lead.plate, String(ok.length), inr(payable), lead.ref];
}

// Conversation starter (any time, also after 24 hours). Blanks: 1 name, 2 vehicle, 3 total of the
// challans on the vehicle. null when no challans have been fetched yet.
export function starterParams(lead) {
  const list = lead.challans || [];
  const total = list.reduce((n, c) => n + (c.amount || 0), 0);
  if (!list.length || !total) return null;
  return [lead.name || 'there', fmtPlate(lead.plate) || '-', `${inr(total)} (${list.length} challan${list.length === 1 ? '' : 's'})`];
}

// Payment receipt. Blanks: 1 name, 2 vehicle, 3 final amount (with %), 4 received, 5 date, 6 balance, 7 reference.
const longDate = (d) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
export function receiptParams(lead) {
  const p = lead.payment;
  return [lead.name || 'there', fmtPlate(lead.plate) || '-', `${inr(p.finalAmount)} (${p.finalRate}% of the challan amount)`, inr(p.amount), longDate(p.date),
    p.pending > 0 ? inr(p.pending) : '₹0 (fully paid)', lead.ref];
}
export function receiptText(lead) {
  const p = lead.payment;
  if (lead.lang === 'hi') {
    return [`धन्यवाद ${lead.name}! 🙏 आपका पेमेंट मिल गया है।`, '', `वाहन: ${fmtPlate(lead.plate) || '-'}`, `कुल देय राशि: ${inr(p.finalAmount)} (चालान राशि का ${p.finalRate}%)`,
      `प्राप्त राशि: ${inr(p.amount)}`, `तारीख: ${longDate(p.date)}`, p.pending > 0 ? `बकाया: *${inr(p.pending)}*` : 'बकाया: ₹0 (पूरा भुगतान हो गया)', '',
      'हम अब लोक अदालत में आपके चालान निपटाएँगे और आपको यहीं अपडेट देंगे।', `रेफ़रेंस: ${lead.ref}`, 'टीम निपटाओ'].join('\n');
  }
  return [`Thank you, ${lead.name}! 🙏 We have received your payment.`, '', `Vehicle: ${fmtPlate(lead.plate) || '-'}`, `Final amount: ${inr(p.finalAmount)} (${p.finalRate}% of the challan amount)`,
    `Amount received: ${inr(p.amount)}`, `Date: ${longDate(p.date)}`, p.pending > 0 ? `Balance pending: *${inr(p.pending)}*` : 'Balance pending: ₹0 (fully paid)', '',
    'We will now settle your challans at the Lok Adalat and keep you updated here.', `Reference: ${lead.ref}`, 'Team Niptao'].join('\n');
}
