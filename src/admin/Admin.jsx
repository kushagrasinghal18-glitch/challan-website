import { useCallback, useEffect, useMemo, useState } from 'react';

const STATUS_COLORS = {
  New: ['#E8EEF8', '#2F5AA8'], Contacted: ['#F0EAF8', '#6A42A0'], 'Documents received': ['#FFF1D9', '#8A5200'],
  Scheduled: ['#E1F2F4', '#0E6470'], Settled: ['#E3F2E9', '#1F6B45'], Lost: ['#ECEBE8', '#5E6472'],
};
const CITY = { noida: 'Noida / Gr. Noida', ghaziabad: 'Ghaziabad', delhi: 'Delhi', gurugram: 'Gurugram' };
const TOKEN_KEY = 'niptao-admin';

const readSaved = () => { try { return JSON.parse(localStorage.getItem(TOKEN_KEY)) || null; } catch { return null; } };
const save = (v) => { try { v ? localStorage.setItem(TOKEN_KEY, JSON.stringify(v)) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } };

const fmtPlate = (p) => (p || '').replace(/^([A-Z]{2}\d{1,2})([A-Z]{0,3})(\d{4})$/, (m, a, b, c) => [a, b, c].filter(Boolean).join(' '));
const fmtPhone = (p) => (p ? `${p.slice(0, 5)} ${p.slice(5)}` : '');
function ago(iso) {
  const d = new Date(iso), s = (Date.now() - d) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
const fullDate = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function Logo() {
  return <span className="logo" aria-label="Niptao"><span className="dev">निप</span><span className="lat">tao</span></span>;
}

function Pill({ status }) {
  const [bg, fg] = STATUS_COLORS[status] || STATUS_COLORS.New;
  return <span className="pill" style={{ background: bg, color: fg }}>{status}</span>;
}

async function call(path, auth, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'error'); e.status = res.status; throw e; }
  return data;
}

function Login({ onIn }) {
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);
  useEffect(() => { call('/api/admin/status').then((s) => setEnabled(s.enabled)).catch(() => {}); }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await call('/api/admin/login', null, { method: 'POST', body: JSON.stringify({ name, password: pw }) });
      onIn(r);
    } catch (e2) {
      setErr(e2.status === 429 ? 'Too many tries. Wait 15 minutes and try again.'
        : e2.status === 401 ? 'That password is not right.' : 'Could not sign in. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <div style={{ color: '#0E1B36', display: 'flex', alignItems: 'center' }}><Logo /><span className="tag" style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.14em', color: '#9A5B00', marginLeft: 10 }}>ADMIN</span></div>
        <h1>Sign in to see leads</h1>
        {!enabled && <div className="warn">The admin panel is switched off. Add <b>ADMIN_PASSWORD</b> (at least 8 characters) in Render → Environment, then redeploy.</div>}
        <label>Your name<input id="admin-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Shown on notes you add" required /></label>
        <label>Password<input id="admin-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy || !enabled || !name.trim() || !pw}>Sign in</button>
      </form>
    </div>
  );
}

function Drawer({ lead, statuses, onClose, onPatch }) {
  const [draft, setDraft] = useState('');
  const [agent, setAgent] = useState(lead.agent || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAgent(lead.agent || ''); setDraft(''); }, [lead.ref]);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  const patch = async (p) => { setBusy(true); try { await onPatch(lead.ref, p); } finally { setBusy(false); } };
  const waText = encodeURIComponent(`Hi ${lead.name}, this is Niptao about the challans on ${fmtPlate(lead.plate)}.`);

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" aria-label="Lead detail">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="meta">{lead.ref} · {fullDate(lead.createdAt)}</div>
            <h2>{lead.name}</h2>
            <Pill status={lead.status} />
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0E1B36" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="drawer-body">
          <div className="actions">
            <a className="call" href={`tel:+91${lead.phone}`}>Call</a>
            <a className="wa" href={`https://wa.me/91${lead.phone}?text=${waText}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
          </div>

          <div>
            <div className="sec-k">Status</div>
            <div className="status-btns">
              {statuses.map((s) => {
                const on = lead.status === s, [, fg] = STATUS_COLORS[s];
                return <button key={s} disabled={busy} onClick={() => !on && patch({ status: s })}
                  style={on ? { background: fg, borderColor: fg, color: '#fff' } : undefined} aria-pressed={on}>{s}</button>;
              })}
            </div>
          </div>

          <div className="details">
            <div className="kv"><div className="k">Vehicle</div><div className="v"><span className="plate">{fmtPlate(lead.plate)}</span></div></div>
            <div className="kv"><div className="k">Mobile</div><div className="v">+91 {fmtPhone(lead.phone)}</div></div>
            <div className="kv"><div className="k">City</div><div className="v">{CITY[lead.city] || lead.city}</div></div>
            <div className="kv"><div className="k">Language</div><div className="v">{lead.lang === 'hi' ? 'Hindi' : 'English'}</div></div>
            <div className="kv" style={{ gridColumn: '1 / -1' }}>
              <label className="k" htmlFor="agent">Assigned to</label>
              <input id="agent" value={agent} placeholder="Type a name, press Enter" onChange={(e) => setAgent(e.target.value)}
                onBlur={() => agent !== (lead.agent || '') && patch({ agent })}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
            </div>
          </div>

          <div className="notes">
            <div className="sec-k">Notes</div>
            <textarea id="note" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Call outcome, documents pending, challan amounts…" />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn primary" disabled={busy || !draft.trim()} onClick={async () => { await patch({ note: draft }); setDraft(''); }}>Add note</button>
            </div>
            {(lead.notes || []).map((n, i) => (
              <div className="note-row" key={i}>
                <span className="av">{n.by.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                <div><div className="by"><b style={{ color: '#0E1B36' }}>{n.by}</b> · {ago(n.at)}</div><div className="t">{n.text}</div></div>
              </div>
            ))}
            <div className="note-row">
              <span className="av">·</span>
              <div><div className="by"><b style={{ color: '#0E1B36' }}>Website</b> · {ago(lead.createdAt)}</div><div className="t">Lead submitted from the website.</div></div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function toCsv(leads) {
  const cols = [['Reference', 'ref'], ['Received', (l) => fullDate(l.createdAt)], ['Name', 'name'], ['Vehicle', (l) => fmtPlate(l.plate)],
    ['Mobile', 'phone'], ['City', (l) => CITY[l.city] || l.city], ['Status', 'status'], ['Assigned to', 'agent'],
    ['Latest note', (l) => l.notes?.[0]?.text || '']];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.map((c) => esc(c[0])).join(','), ...leads.map((l) => cols.map(([, f]) => esc(typeof f === 'function' ? f(l) : l[f])).join(','))].join('\n');
}

export default function Admin() {
  const [auth, setAuth] = useState(readSaved);
  const [leads, setLeads] = useState(null);
  const [storage, setStorage] = useState('');
  const [statuses, setStatuses] = useState(Object.keys(STATUS_COLORS));
  const [tab, setTab] = useState('All');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState('');

  const signOut = useCallback(() => { save(null); setAuth(null); setLeads(null); }, []);

  const load = useCallback(async () => {
    if (!auth) return;
    try {
      const r = await call('/api/admin/leads', auth);
      setLeads(r.leads); setStorage(r.storage); setErr('');
    } catch (e) {
      if (e.status === 401) signOut();
      else setErr('Could not load leads. The server may be waking up; this page retries every minute.');
    }
  }, [auth, signOut]);

  useEffect(() => {
    call('/api/admin/status').then((s) => s.statuses && setStatuses(s.statuses)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, [load]);

  const onPatch = async (ref, p) => {
    try {
      const { lead } = await call(`/api/admin/leads/${encodeURIComponent(ref)}`, auth, { method: 'PATCH', body: JSON.stringify(p) });
      setLeads((ls) => ls.map((l) => (l.ref === ref ? lead : l)));
    } catch (e) {
      if (e.status === 401) signOut(); else setErr('That change was not saved. Try again.');
    }
  };

  const filtered = useMemo(() => {
    const s = q.toLowerCase().replace(/\s/g, '');
    return (leads || []).filter((l) => !s || (l.name + l.plate + l.phone + l.ref).toLowerCase().replace(/\s/g, '').includes(s));
  }, [leads, q]);
  const rows = tab === 'All' ? filtered : filtered.filter((l) => l.status === tab);

  if (!auth) return <Login onIn={(a) => { save(a); setAuth(a); }} />;

  const all = leads || [];
  const weekAgo = Date.now() - 7 * 864e5;
  const kpis = [
    ['New, unassigned', all.filter((l) => l.status === 'New' && !l.agent).length],
    ['Open leads', all.filter((l) => !['Settled', 'Lost'].includes(l.status)).length],
    ['Last 7 days', all.filter((l) => new Date(l.createdAt) > weekAgo).length],
    ['Settled', all.filter((l) => l.status === 'Settled').length],
  ];
  const selLead = all.find((l) => l.ref === sel);

  const exportCsv = () => {
    const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `niptao-leads-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <header className="bar">
        <div className="bar-in">
          <div style={{ display: 'flex', alignItems: 'center' }}><Logo /><span className="tag">ADMIN</span></div>
          <div className="who"><span>{auth.name}</span><button onClick={signOut}>Sign out</button></div>
        </div>
      </header>
      <main className="page">
        <div className="head">
          <div>
            <h1>Leads</h1>
            <div className="sub">Next Lok Adalat: <strong>Sat, 12 Dec 2026</strong> · District Court, Surajpur</div>
          </div>
          <div className="kpis">
            {kpis.map(([l, v]) => <div className="kpi" key={l}><div className="l">{l}</div><div className="v">{leads ? v : '–'}</div></div>)}
          </div>
        </div>

        {storage === 'file' && (
          <div className="warn"><b>Leads are in temporary storage.</b> On Render's free plan they are deleted whenever the server restarts. Connect a database (DATABASE_URL) to keep them.</div>
        )}
        {err && <div className="warn" role="alert">{err}</div>}

        <div className="panel">
          <div className="tabs" role="tablist">
            {['All', ...statuses].map((s) => (
              <button key={s} aria-pressed={tab === s} onClick={() => setTab(s)}>
                {s}<span className="n">{s === 'All' ? filtered.length : filtered.filter((l) => l.status === s).length}</span>
              </button>
            ))}
          </div>
          <div className="tools">
            <div className="search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7385" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <input id="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vehicle number, name, phone or reference" />
            </div>
            <button className="btn" onClick={load}>Refresh</button>
            <button className="btn" onClick={exportCsv} disabled={!rows.length}>Download CSV</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Lead</th><th>Vehicle</th><th>City</th><th>Assigned to</th><th>Status</th><th>Received</th></tr></thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.ref} className={sel === l.ref ? 'sel' : ''} onClick={() => setSel(l.ref)}>
                    <td><div className="name">{l.name}</div><div className="small">{l.ref} · {fmtPhone(l.phone)}</div></td>
                    <td><span className="plate">{fmtPlate(l.plate)}</span></td>
                    <td>{CITY[l.city] || l.city}</td>
                    <td className={l.agent ? '' : 'unassigned'}>{l.agent || 'Unassigned'}</td>
                    <td><Pill status={l.status} /></td>
                    <td title={fullDate(l.createdAt)}>{ago(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {leads && !rows.length && <div className="empty">{all.length ? 'No leads match this search.' : 'No leads yet. They appear here as soon as someone submits the form on the website.'}</div>}
            {!leads && !err && <div className="empty">Loading leads…</div>}
          </div>
          {leads && <div className="foot">Showing {rows.length} of {all.length} leads · refreshes every minute</div>}
        </div>
      </main>
      {selLead && <Drawer lead={selLead} statuses={statuses} onClose={() => setSel(null)} onPatch={onPatch} />}
    </>
  );
}
