// Settings → WhatsApp templates: create MSG91 (Meta) templates from the admin panel, see whether Meta
// approved them, and pick the one used for approval requests after the 24-hour window.
import { getKV, setKV } from './store.js';
import { msg91Configured, createTemplate, templateStatuses, TEMPLATE_NAME_RE } from './msg91.js';

const CATEGORIES = ['UTILITY', 'MARKETING'];
const LANGS = ['en', 'en_US', 'hi'];
// { list: [{ name, category, language, header, body, footer, buttons, at, by, status }], approval: name }
export const getTemplates = async () => ({ list: [], approval: '', ...(await getKV('waTemplates', {})) });
// The approval template: chosen in the panel, else MSG91_APPROVAL_TEMPLATE.
export const approvalTemplate = async () => (await getTemplates()).approval || process.env.MSG91_APPROVAL_TEMPLATE || '';

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
      if (typeof b.approval === 'string') {
        if (b.approval && !TEMPLATE_NAME_RE.test(b.approval)) return res.status(400).json({ error: 'invalid_name' });
        cur.approval = b.approval;
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
