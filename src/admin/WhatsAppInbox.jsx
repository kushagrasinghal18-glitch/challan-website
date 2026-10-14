import { useEffect, useMemo, useRef, useState } from 'react';

// WhatsApp tab: every WhatsApp conversation in one place, one row per customer (all their vehicles
// together), newest first. Messages come from the leads, which reload every 15 seconds.
const WA_ERR = {
  window_closed: 'The customer has not written in the last 24 hours, so WhatsApp only allows an approved template. Send the approval request from the lead, or use "Open in WhatsApp".',
  whatsapp_not_set_up: 'WhatsApp is not connected yet.', not_your_lead: 'This lead is no longer assigned to you.',
  not_connected: 'WhatsApp is offline right now. Check Settings → Automatic WhatsApp.',
  send_limit: 'The hourly sending limit is reached. Try again a bit later.',
};
const DAY = 24 * 3600e3;
const when = (iso) => {
  const d = new Date(iso);
  if (Date.now() - d < DAY && d.getDate() === new Date().getDate()) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const full = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtPhone = (p) => (p ? `${p.slice(0, 5)} ${p.slice(5)}` : '');
const tick = (m) => (m.dir !== 'out' || !m.status ? '' : m.status === 'read' ? ' · ✓✓ read' : m.status === 'delivered' ? ' · ✓✓ delivered' : m.status === 'failed' ? ` · failed${m.error ? `: ${m.error}` : ''}` : ' · ✓ sent');

export function conversations(leads) {
  const by = new Map();
  for (const l of leads || []) {
    if (!l.phone || !l.waChat?.length) continue;
    if (!by.has(l.phone)) by.set(l.phone, []);
    by.get(l.phone).push(l);
  }
  return [...by.entries()].map(([phone, ls]) => {
    const seen = new Set(), chat = [];
    for (const l of ls) for (const m of l.waChat) if (!seen.has(m.id)) { seen.add(m.id); chat.push({ ...m, ref: l.ref }); }
    chat.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const last = chat[chat.length - 1];
    const lastIn = ls.map((l) => l.waLastIn || '').sort().pop();
    const lastInMsg = [...chat].reverse().find((m) => m.dir === 'in');
    return {
      phone, leads: ls, chat, last, lastIn,
      name: (ls.find((l) => l.name && l.name !== 'WhatsApp customer') || ls[0]).name,
      plates: ls.map((l) => l.plate).filter(Boolean),
      unread: ls.reduce((n, l) => n + (l.waUnread || 0), 0),
      paused: ls.find((l) => l.botPaused)?.botPaused || null,
      home: lastInMsg?.ref || ls[0].ref, // replies go on the vehicle the customer last wrote about
    };
  }).sort((a, b) => String(b.last.at).localeCompare(String(a.last.at)));
}

export default function WhatsAppInbox({ leads, waApi, onSend, onRead, onBot, onOpenLead }) {
  const convs = useMemo(() => conversations(leads), [leads]);
  const [q, setQ] = useState('');
  const [phone, setPhone] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all');
  const box = useRef(null);
  const sel = convs.find((c) => c.phone === phone) || null;

  const needle = q.trim().toLowerCase();
  const list = convs.filter((c) => (filter === 'unread' ? c.unread > 0 : filter === 'handoff' ? c.paused?.reason === 'handoff' : true)
    && (!needle || c.name.toLowerCase().includes(needle) || c.phone.includes(needle.replace(/\D/g, '') || '~') || c.plates.some((p) => p.toLowerCase().includes(needle.replace(/\s/g, '')))
      || c.chat.some((m) => m.text.toLowerCase().includes(needle))));

  useEffect(() => { setDraft(''); setErr(''); }, [phone]);
  useEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; }, [phone, sel?.chat.length]);
  // Opening a chat clears its "new" badge on every vehicle.
  useEffect(() => { if (sel?.unread) onRead(sel.leads.filter((l) => l.waUnread).map((l) => l.ref)); }, [phone, sel?.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = sel && (waApi === 'live' || (!!sel.lastIn && Date.now() - new Date(sel.lastIn) < DAY));
  const send = async (e) => {
    e.preventDefault();
    if (!draft.trim() || !sel) return;
    setBusy(true); setErr('');
    try { const code = await onSend(sel.home, { text: draft }); if (code) setErr(WA_ERR[code] || 'WhatsApp did not send it. Try again.'); else setDraft(''); }
    finally { setBusy(false); }
  };
  const unreadTotal = convs.reduce((n, c) => n + (c.unread ? 1 : 0), 0);

  return (
    <div className={'panel inbox' + (sel ? ' has-sel' : '')}>
      <div className="inbox-list">
        <div className="inbox-tools">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number, vehicle or message" aria-label="Search chats" />
          <div className="inbox-filter" role="group" aria-label="Show">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All <span className="n">{convs.length}</span></button>
            <button type="button" aria-pressed={filter === 'unread'} onClick={() => setFilter('unread')}>Unread <span className="n">{unreadTotal}</span></button>
            <button type="button" aria-pressed={filter === 'handoff'} onClick={() => setFilter('handoff')}>Needs you</button>
          </div>
        </div>
        {!leads ? <div className="empty">Loading chats…</div> : !list.length ? (
          <div className="empty">{convs.length ? 'No chats match.' : 'No WhatsApp messages yet. They show here as soon as a customer writes.'}</div>
        ) : list.map((c) => (
          <button type="button" key={c.phone} className={'conv' + (c.phone === phone ? ' sel' : '') + (c.unread ? ' unread' : '')} onClick={() => setPhone(c.phone)}>
            <div className="conv-top"><b>{c.name}</b><span className="small">{when(c.last.at)}</span></div>
            <div className="conv-sub small">{fmtPhone(c.phone)}{c.plates.length ? ` · ${c.plates.join(', ')}` : ''}</div>
            <div className="conv-last small">{c.last.dir === 'out' ? `${c.last.by === 'Niptao AI' ? '🤖' : 'You'}: ` : ''}{c.last.text}</div>
            <div className="conv-tags">
              {c.unread > 0 && <span className="multi unread">💬 {c.unread} new</span>}
              {c.paused?.reason === 'handoff' && <span className="multi warn">🙋 needs you</span>}
            </div>
          </button>
        ))}
      </div>
      <div className="inbox-chat">
        {!sel ? <div className="empty">Pick a chat on the left.</div> : (<>
          <div className="inbox-head">
            <button type="button" className="btn ghost back" onClick={() => setPhone(null)} aria-label="Back to chats">←</button>
            <div style={{ minWidth: 0 }}>
              <div className="name">{sel.name}</div>
              <div className="small">+91 {fmtPhone(sel.phone)} · {sel.leads.map((l) => (
                <a key={l.ref} href={`#lead-${l.ref}`} onClick={(e) => { e.preventDefault(); onOpenLead(l.ref); }}>{l.plate || l.ref}</a>
              )).reduce((a, x) => (a.length ? [...a, ', ', x] : [x]), [])}</div>
            </div>
            <a className="btn ghost" href={`https://wa.me/91${sel.phone}`} target="_blank" rel="noreferrer">Open in WhatsApp</a>
          </div>
          {(waApi === 'live' || waApi === 'msg91') && (
            <div className={'bot-row' + (sel.paused ? ' paused' : '')}>
              <span>{sel.paused ? (sel.paused.reason === 'handoff' ? '🙋 The AI handed this chat to you. AI replies are paused.' : `AI replies paused by ${sel.paused.by}.`) : '🤖 AI replies are on for this chat.'}</span>
              <button type="button" className="btn ghost edit" disabled={busy} onClick={async () => { setBusy(true); try { await onBot(sel.home, !sel.paused); } finally { setBusy(false); } }}>{sel.paused ? 'Turn AI back on' : 'Pause AI'}</button>
            </div>
          )}
          <div className="wa-msgs big" ref={box}>
            {sel.chat.map((m, i) => (
              <div key={m.id || i} className={'wa-bub ' + m.dir}>
                <div className="t">{m.text}</div>
                <div className="m">{m.dir === 'out' ? `${m.by} · ` : ''}{full(m.at)}{tick(m)}</div>
              </div>
            ))}
          </div>
          {!waApi ? <div className="small">Sending from here starts once WhatsApp is connected (MSG91). Until then, use "Open in WhatsApp".</div>
            : open ? (
              <form className="wa-reply" onSubmit={send}>
                <textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a reply"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} aria-label="WhatsApp reply" />
                <button className="btn wa-btn" disabled={busy || !draft.trim()}>Send</button>
              </form>
            ) : <div className="small">The customer last wrote more than 24 hours ago, so WhatsApp only allows approved templates. Send the approval request from the lead, or use "Open in WhatsApp".</div>}
          {err && <div className="stale">{err}</div>}
        </>)}
      </div>
    </div>
  );
}
