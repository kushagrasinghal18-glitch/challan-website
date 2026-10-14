import { useCallback, useEffect, useState } from 'react';

// Settings → WhatsApp templates (MSG91). Templates are the only messages WhatsApp allows more than 24 hours
// after the customer last wrote. Meta reviews each one, usually within minutes to a day.
const ERR = {
  whatsapp_not_set_up: 'MSG91 is not connected yet (MSG91_AUTH_KEY and MSG91_WA_NUMBER in Render).',
  invalid_name: 'Name: only small letters, numbers and _ (for example payment_reminder).',
  empty_body: 'Write the message text.',
  bad_variables: 'Number the blanks {{1}}, {{2}}, {{3}} in order, without skipping a number.',
  duplicate_name: 'A template with this name already exists. Pick another name.',
  status_unavailable: 'MSG91 did not give the status right now. Check it in MSG91 → WhatsApp → Templates, then mark it below.',
};
const APPROVAL = {
  name: 'approval_request', category: 'UTILITY', language: 'en', header: 'Challan settlement approval',
  body: 'Hi {{1}}, we have checked the challans on your vehicle {{2}}. It has {{3}} in total.\n\nAll challans: {{4}}\n\nWe can settle {{5}} for you. Amount you pay: {{6}}.\n\nPlease reply I APPROVE to give your written approval for Niptao to settle these challans. Reference: {{7}}',
  footer: 'Team Niptao', buttons: ['I APPROVE'],
  samples: ['Ravi', 'UP 16 AB 1234', '3 challans worth ₹4,500', '1) UP123 Over speeding ₹2,000: we will settle; 2) UP456 No helmet ₹1,000: we will settle; 3) DL789 Red light ₹1,500: cannot settle now (outside our service area)', '2 challans worth ₹3,000', '₹1,500 (50% of the challan amount)', 'GBN-1234567'],
};
const BLANK = { name: '', category: 'UTILITY', language: 'en', header: '', body: '', footer: '', buttons: [], samples: [] };
const BADGE = { APPROVED: ['#E7F6EC', '#137A3A', 'Approved'], PENDING: ['#FFF6E5', '#9A5B00', 'Waiting for Meta'], REJECTED: ['#FDECEC', '#B42318', 'Rejected'] };
const varCount = (body) => Math.max(0, ...[...String(body).matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])));

export default function WhatsAppTemplates({ auth, call, signOut }) {
  const [s, setS] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const fail = useCallback((e) => (e.status === 401 ? signOut() : setMsg({ ok: false, text: ERR[e.message] || (e.detail ? `MSG91 said: ${e.detail}` : 'That did not work. Try again in a moment.') })), [signOut]);
  useEffect(() => { call('/api/admin/wa-templates', auth).then(setS).catch(fail); }, [auth, call, fail]);

  const act = async (path, method, body, okText) => {
    setBusy(true); setMsg(null);
    try { const v = await call(path, auth, { method, body: JSON.stringify(body || {}) }); setS(v); if (okText) setMsg({ ok: true, text: okText }); return v; }
    catch (e) { fail(e); return null; } finally { setBusy(false); }
  };
  if (!s) return <section className="panel pad"><h2>WhatsApp templates</h2><div className="hint">Loading…</div></section>;

  const n = form ? varCount(form.body) : 0;
  const preview = form ? form.body.replace(/\{\{(\d+)\}\}/g, (m, i) => form.samples[i - 1] || m) : '';
  const approved = s.list.filter((t) => t.status === 'APPROVED');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <section className="panel pad wa-tpl">
      <h2>WhatsApp templates</h2>
      <p className="hint" style={{ marginTop: 0 }}>WhatsApp only lets you message a customer freely for 24 hours after they last wrote. After that, only templates approved by Meta can be sent. Create them here; Meta usually decides within minutes, sometimes a day.</p>
      {!s.configured && <div className="stale" style={{ marginBottom: 10 }}>{ERR.whatsapp_not_set_up}</div>}

      <label className="field"><span>Template for approval requests (after 24 hours)</span>
        <select value={s.approval || ''} disabled={busy} onChange={(e) => act('/api/admin/wa-templates', 'PUT', { approval: e.target.value }, 'Saved.')}>
          <option value="">{s.envApproval ? `From Render: ${s.envApproval}` : 'None (approval requests need the customer to have written in the last 24 hours)'}</option>
          {approved.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          {s.approval && !approved.some((t) => t.name === s.approval) && <option value={s.approval}>{s.approval} (not approved yet)</option>}
        </select>
        <span className="hint">Its blanks are filled in this order: 1 name, 2 vehicle number, 3 all challans (count and amount), 4 every challan with whether we can settle it, 5 what we will settle, 6 amount to pay, 7 reference. Older 5-blank templates still get the short version.</span>
      </label>

      <div className="ch-head" style={{ marginTop: 14 }}><div className="sec-k">Your templates</div>
        <button type="button" className="btn ghost edit" disabled={busy || !s.configured} onClick={() => act('/api/admin/wa-templates/refresh', 'POST', {}, 'Statuses updated from MSG91.')}>Check status</button></div>
      {!s.list.length ? <div className="small">No templates yet.</div> : (
        <ul className="tpl-list">
          {s.list.map((t) => { const [bg, fg, label] = BADGE[t.status] || ['#F2F4F7', '#475467', t.status || 'Unknown']; return (
            <li key={`${t.name}-${t.language || ''}`}>
              <div className="tpl-top"><b>{t.name}</b><span className="badge" style={{ background: bg, color: fg }}>{label}</span>
                {s.approval === t.name && <span className="badge" style={{ background: '#EEF3FF', color: '#1F4FB8' }}>Used for approvals</span>}</div>
              {t.body && <div className="small tpl-body">{t.body}{t.buttons?.length ? `  [${t.buttons.join('] [')}]` : ''}</div>}
              <div className="small">{t.external ? 'Made in MSG91' : `${t.category?.toLowerCase()} · ${t.language} · added by ${t.by}`}
                {t.status !== 'APPROVED' && <> · <button type="button" className="linkish" disabled={busy} onClick={() => act('/api/admin/wa-templates', 'PUT', { name: t.name, status: 'APPROVED' }, 'Marked approved.')}>Mark approved</button></>}
                {' · '}<button type="button" className="linkish" disabled={busy} onClick={() => { if (window.confirm(`Remove ${t.name} from this list? It stays in MSG91.`)) act('/api/admin/wa-templates', 'PUT', { remove: t.name }); }}>Remove</button></div>
            </li>
          ); })}
        </ul>
      )}

      {!form ? (
        <div className="cc-row" style={{ marginTop: 14 }}>
          <button type="button" className="btn primary" disabled={!s.configured} onClick={() => { setMsg(null); setForm({ ...APPROVAL, name: s.list.some((t) => t.name === 'approval_request') ? 'approval_request_2' : 'approval_request' }); }}>Create the approval template</button>
          <button type="button" className="btn" disabled={!s.configured} onClick={() => { setMsg(null); setForm(BLANK); }}>New template</button>
        </div>
      ) : (
        <form className="tpl-form" onSubmit={async (e) => { e.preventDefault(); const v = await act('/api/admin/wa-templates', 'POST', { ...form, samples: form.samples.slice(0, n) }, 'Sent to Meta for review. Press Check status in a few minutes.'); if (v) setForm(null); }}>
          <div className="pay-grid">
            <label className="field"><span>Name</span>
              <input value={form.name} onChange={(e) => set('name', e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))} placeholder="payment_reminder" required /></label>
            <label className="field"><span>Type</span>
              <select value={form.category} onChange={(e) => set('category', e.target.value)}>
                <option value="UTILITY">Utility (updates about their case)</option>
                <option value="MARKETING">Marketing (offers, reminders to sign up)</option>
              </select></label>
            <label className="field"><span>Language</span>
              <select value={form.language} onChange={(e) => set('language', e.target.value)}>
                <option value="en">English</option><option value="hi">Hindi</option>
              </select></label>
          </div>
          <label className="field"><span>Heading (optional, no emoji)</span>
            <input value={form.header} maxLength={60} onChange={(e) => set('header', e.target.value)} /></label>
          <label className="field"><span>Message</span>
            <textarea rows={5} value={form.body} maxLength={1024} onChange={(e) => set('body', e.target.value)} required
              placeholder="Hi {{1}}, your Lok Adalat date for {{2}} is {{3}}." />
            <span className="hint">Put {'{{1}}'}, {'{{2}}'}… where the customer's details go.</span></label>
          {n > 0 && (
            <div className="pay-grid">
              {Array.from({ length: n }, (_, i) => (
                <label className="field" key={i}><span>Example for {`{{${i + 1}}}`}</span>
                  <input value={form.samples[i] || ''} onChange={(e) => { const x = [...form.samples]; x[i] = e.target.value; set('samples', x); }} placeholder="Meta needs an example" /></label>
              ))}
            </div>
          )}
          <label className="field"><span>Small text at the bottom (optional)</span>
            <input value={form.footer} maxLength={60} onChange={(e) => set('footer', e.target.value)} /></label>
          <div className="field"><span>Reply buttons (optional, up to 3)</span>
            {form.buttons.map((b, i) => (
              <div className="cc-row" key={i}>
                <input value={b} maxLength={25} onChange={(e) => { const x = [...form.buttons]; x[i] = e.target.value; set('buttons', x); }} placeholder="I APPROVE" />
                <button type="button" className="btn ghost" onClick={() => set('buttons', form.buttons.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            {form.buttons.length < 3 && <button type="button" className="btn ghost edit" onClick={() => set('buttons', [...form.buttons, ''])}>+ Add button</button>}
          </div>
          <div className="sec-k" style={{ marginTop: 8 }}>Preview</div>
          <div className="wa-msgs" style={{ maxHeight: 'none' }}>
            <div className="wa-bub out" style={{ alignSelf: 'flex-start' }}>
              {form.header && <div className="t" style={{ fontWeight: 700 }}>{form.header}</div>}
              <div className="t">{preview || '…'}</div>
              {form.footer && <div className="m" style={{ textAlign: 'left' }}>{form.footer}</div>}
              {form.buttons.filter(Boolean).map((b) => <div key={b} className="tpl-btn">{b}</div>)}
            </div>
          </div>
          <div className="save-bar">
            {msg && <span className={msg.ok ? 'ok-msg' : 'err'} role="status">{msg.text}</span>}
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn primary" disabled={busy || !form.name || !form.body}>{busy ? 'Sending…' : 'Send to Meta for review'}</button>
          </div>
        </form>
      )}
      {!form && msg && <div className={msg.ok ? 'ok-msg' : 'err'} role="status" style={{ marginTop: 10 }}>{msg.text}</div>}
    </section>
  );
}
