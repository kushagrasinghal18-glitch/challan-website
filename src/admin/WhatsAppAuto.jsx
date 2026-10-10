import { useCallback, useEffect, useRef, useState } from 'react';

// Settings → Automatic WhatsApp: link the WhatsApp number (QR or pairing code), switch the AI and the
// automatic payment message on or off, and give the AI extra notes. Admins only.
const ERR = {
  invalid_phone: 'Type the 10-digit WhatsApp number you are linking.',
  live_off: 'Automatic WhatsApp is switched off on the server (WA_BAILEYS=off in Render).',
  crm_off: 'Switch Automatic WhatsApp on first.',
};

export default function WhatsAppAuto({ auth, call, signOut }) {
  const [s, setS] = useState(null);
  const [form, setForm] = useState(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const fail = useCallback((e) => (e.status === 401 ? signOut() : setMsg({ ok: false, text: ERR[e.message] || 'That did not work. Try again in a moment.' })), [signOut]);
  const load = useCallback(() => call('/api/admin/wa-live', auth).then((v) => { setS(v); setForm((f) => f || v.settings); }).catch(fail), [auth, call, fail]);
  useEffect(() => { load(); }, [load]);
  // While waiting for the scan, keep the QR fresh (WhatsApp changes it every ~20 seconds).
  const waiting = s && ['qr', 'connecting'].includes(s.state);
  useEffect(() => { if (!waiting) return undefined; const iv = setInterval(load, 3000); return () => clearInterval(iv); }, [waiting, load]);

  const act = async (path, body, okText) => {
    setBusy(true); setMsg(null);
    try { const v = await call(path, auth, { method: /(settings|power)$/.test(path) ? 'PUT' : 'POST', body: JSON.stringify(body || {}) }); setS(v); if (okText) setMsg({ ok: true, text: okText }); return v; }
    catch (e) { fail(e); return null; } finally { setBusy(false); }
  };

  if (!s || !form) return <section className="panel pad"><h2>Automatic WhatsApp</h2><div className="hint">Loading…</div></section>;
  const linked = s.state === 'open';
  const on = s.settings.on !== false;
  const fmt = (p) => (p ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : '');

  return (
    <section className="panel pad wa-auto">
      <h2>Automatic WhatsApp</h2>
      <p className="hint" style={{ marginTop: 0 }}>Link your WhatsApp number once. Then customers who message it get AI replies, their vehicle numbers become leads, "I APPROVE" is marked by itself and the payment details go out straight after. It only ever replies: nobody gets a first message from it.</p>

      <label className="toggle power">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => {
          const next = e.target.checked;
          if (!next && !window.confirm('Switch off Automatic WhatsApp?\n\nNo AI replies and no automatic messages. The panel goes back to how it worked before (WhatsApp buttons and the add-on). The number stays linked, so switching on again needs no new scan.')) return;
          act('/api/admin/wa-live/power', { on: next }, next ? 'Switched on.' : 'Switched off. Everything works as before.');
        }} />
        <span><b>Automatic WhatsApp is {on ? 'ON' : 'OFF'}</b><br />
          <span className="hint">{on ? 'Untick to switch everything off and work exactly as before.' : 'Nothing is sent automatically. Send messages yourself with the WhatsApp buttons on each lead, as before.'}</span></span>
      </label>
      {on && (<>
      <div className={'wa-link ' + (linked ? 'on' : '')}>
        {linked ? (<>
          <div className="ok-line">✓ Linked{s.me ? ` to ${fmt(s.me)}` : ''}. Working.</div>
          <div className="hint">{s.sentLastHour} message{s.sentLastHour === 1 ? '' : 's'} sent in the last hour. The number keeps working on your phone as usual.</div>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => {
            if (window.confirm('Unlink this WhatsApp number? Automatic replies stop until you link it again.')) act('/api/admin/wa-live/logout', {}, 'Unlinked.');
          }}>Unlink this number</button>
        </>) : s.state === 'qr' || s.pairCode ? (<>
          {s.pairCode ? (<>
            <div className="sec-k">Pairing code</div>
            <div className="pair-code">{s.pairCode.replace(/^(.{4})(.{4})$/, '$1-$2')}</div>
            <ol className="small">
              <li>On the phone with this number open WhatsApp → <b>⋮ / Settings</b> → <b>Linked devices</b> → <b>Link a device</b>.</li>
              <li>Tap <b>Link with phone number instead</b> and type this code.</li>
            </ol>
          </>) : (<>
            {s.qr ? <img className="wa-qr" src={s.qr} alt="WhatsApp QR code to scan" /> : <div className="hint">Getting the QR code…</div>}
            <ol className="small">
              <li>On the phone with this number open WhatsApp → <b>⋮ / Settings</b> → <b>Linked devices</b> → <b>Link a device</b>.</li>
              <li>Point the phone at this QR code. This page updates by itself once it's linked.</li>
            </ol>
          </>)}
        </>) : (<>
          <div className="small">{s.state === 'connecting' ? 'Connecting to WhatsApp…' : s.error === 'logged_out' ? 'The number was unlinked (from the phone or by WhatsApp). Link it again.' : s.error === 'replaced' ? 'Another copy of the site took over this number (usually after an update). Press Link to bring it back here.' : 'Not linked yet.'}</div>
          <div className="cc-row">
            <button type="button" className="btn primary" disabled={busy || s.state === 'connecting'} onClick={() => act('/api/admin/wa-live/link', {})}>Link with QR code</button>
          </div>
          <div className="cc-row">
            <input className="pair-in" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, '').slice(0, 12))} placeholder="WhatsApp number" aria-label="WhatsApp number to link" />
            <button type="button" className="btn" disabled={busy || s.state === 'connecting'} onClick={() => act('/api/admin/wa-live/link', { phone })}>Get a code instead</button>
          </div>
          <div className="hint">Use the code when this screen and the phone are the same device.</div>
        </>)}
      </div>

      <label className="toggle">
        <input type="checkbox" checked={form.ai} onChange={(e) => setForm({ ...form, ai: e.target.checked })} />
        <span><b>AI replies</b><br />
          <span className="hint">Answers questions about Niptao, asks for the vehicle number and name, and adds them to the lead. It goes quiet in a chat for 2 hours after someone from the team writes there, and hands the chat to you when a customer asks for a person.</span>
          {!s.aiReady && <span className="warn" style={{ display: 'block', marginTop: 6 }}>Not active yet: add <code>GEMINI_API_KEY</code> in Render → Environment.</span>}</span>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={form.autoPayment} onChange={(e) => setForm({ ...form, autoPayment: e.target.checked })} />
        <span><b>Send payment details by itself</b><br />
          <span className="hint">When the customer replies "I APPROVE", the payment message and QR from Payment details go out straight away. A payment screenshot they send is saved on the lead and flagged for you to confirm.</span></span>
      </label>
      <label className="field"><span>Extra notes for the AI</span>
        <textarea rows={4} value={form.notes} maxLength={4000} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="e.g. Office hours are 10 am to 7 pm. This week's offer: code DIWALI40, customers pay 40%." /></label>
      <div className="save-bar">
        {msg && <span className={msg.ok ? 'ok-msg' : 'err'} role="status">{msg.text}</span>}
        <button type="button" className="btn primary" disabled={busy} onClick={async () => { const v = await act('/api/admin/wa-live/settings', form, 'Saved.'); if (v) setForm(v.settings); }}>Save</button>
      </div>
      <details className="guide"><summary>Keep the number safe</summary>
        <ul className="small">
          <li>Use a second number for this, not your main one. WhatsApp can block numbers that send automated messages.</li>
          <li>Let customers message first (the website's WhatsApp button, ads, your visiting card). This never starts chats.</li>
          <li>The site has to stay awake for replies to go out. See the setup guide.</li>
        </ul>
      </details>
      </>)}
      {!on && msg && <div className={msg.ok ? 'ok-msg' : 'err'} role="status" style={{ marginTop: 10 }}>{msg.text}</div>}
      <TryAI auth={auth} call={call} signOut={signOut} notes={form.notes} ready={s.aiReady} />
      <div className="try-ai">
        <div className="ch-head"><div className="sec-k">Recent activity</div>
          <button type="button" className="btn ghost edit" onClick={load}>Refresh</button></div>
        <div className="hint">Why the AI did or didn't reply to each message since the site last started. Newest first.</div>
        {!(s.activity || []).length ? <div className="small">Nothing yet. Send a WhatsApp message to the linked number, then press Refresh.</div> : (
          <ul className="wa-activity">
            {s.activity.map((a, i) => (
              <li key={i} className={a.bad ? 'bad' : ''}><span className="small">{new Date(a.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}{a.who ? ` · ${a.who}` : ''}</span> {a.text}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// Pretend to be a customer and see what the AI would answer. Uses the notes typed above, even unsaved.
// Nothing goes out on WhatsApp and no lead is created.
function TryAI({ auth, call, signOut, notes, ready }) {
  const [chat, setChat] = useState([]); // [{ dir: 'in' | 'out', text, info? }]
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [known, setKnown] = useState({ name: '', plates: [] });
  const boxRef = useRef(null);
  useEffect(() => { const el = boxRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chat.length, busy]);

  async function send(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const next = [...chat, { dir: 'in', text }];
    setChat(next); setDraft(''); setErr(''); setBusy(true);
    try {
      const a = await call('/api/admin/wa-live/test', auth, { method: 'POST', body: JSON.stringify({ chat: next.map(({ dir, text: t }) => ({ dir, text: t })), notes, ...known }) });
      const plates = [...new Set([...known.plates, ...a.plates])];
      setKnown({ name: a.name || known.name, plates });
      const info = [
        a.plates.length ? `Would add vehicle${a.plates.length === 1 ? '' : 's'} ${a.plates.join(', ')} to the lead` : '',
        a.name ? `Would save the name "${a.name}"` : '',
        a.paid ? 'Would flag "says paid" on the lead' : '',
        a.handoff ? 'Would hand this chat to the team and pause itself' : '',
      ].filter(Boolean);
      setChat([...next, { dir: 'out', text: a.reply, info }]);
    } catch (e2) {
      if (e2.status === 401) return signOut();
      setErr(e2.message === 'ai_not_ready' ? 'Add GEMINI_API_KEY in Render → Environment first.' : `The AI did not answer. ${e2.detail || 'Check the GEMINI_API_KEY in Render, then try again.'}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="try-ai">
      <div className="ch-head"><div className="sec-k">Try the AI</div>
        {chat.length > 0 && <button type="button" className="btn ghost edit" onClick={() => { setChat([]); setKnown({ name: '', plates: [] }); setErr(''); }}>Start over</button>}</div>
      <div className="hint">Type as if you were a customer. You see exactly what the AI would reply, using the notes above (even before you save them). Nothing is sent on WhatsApp and no lead is created.</div>
      {!ready && <div className="warn">Not active yet: add <code>GEMINI_API_KEY</code> in Render → Environment.</div>}
      <div className="wa-msgs" ref={boxRef}>
        {!chat.length && <div className="small">e.g. "Hi, I have 3 challans on my car, how much will it cost?"</div>}
        {chat.map((m, i) => (
          <div key={i} className={'wa-bub ' + m.dir}>
            <div className="t">{m.text}</div>
            <div className="m">{m.dir === 'in' ? 'You (as customer)' : 'Niptao AI'}</div>
            {m.info?.length > 0 && <div className="try-info">{m.info.map((x) => <div key={x}>↳ {x}</div>)}</div>}
          </div>
        ))}
        {busy && <div className="wa-bub out"><div className="t">typing…</div></div>}
      </div>
      <form className="wa-reply" onSubmit={send}>
        <textarea rows={2} value={draft} disabled={!ready} onChange={(e) => setDraft(e.target.value)} placeholder="Message as a customer" aria-label="Test message"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
        <button className="btn wa-btn" disabled={busy || !ready || !draft.trim()}>Send</button>
      </form>
      {err && <div className="err">{err}</div>}
    </div>
  );
}
