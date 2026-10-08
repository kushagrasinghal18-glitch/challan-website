import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STATUS_COLORS = {
  New: ['#E8EEF8', '#2F5AA8'], Contacted: ['#F0EAF8', '#6A42A0'], 'Documents received': ['#FFF1D9', '#8A5200'],
  Scheduled: ['#E1F2F4', '#0E6470'], Settled: ['#E3F2E9', '#1F6B45'], Lost: ['#ECEBE8', '#5E6472'],
};
const CITY = { noida: 'Noida / Gr. Noida', ghaziabad: 'Ghaziabad', delhi: 'Delhi', gurugram: 'Gurugram' };
// The website shows dates for this one city only (same setting the site is built with).
const SITE_CITY = CITY[import.meta.env.VITE_CITY] ? import.meta.env.VITE_CITY : 'noida';
const TOKEN_KEY = 'niptao-admin';
const SOUND_KEY = 'niptao-sound';
const POLL_MS = 15_000;
// Official e-challan site: search by vehicle number + captcha, no OTP.
const PARIVAHAN_URL = 'https://echallan.parivahan.gov.in/index/accused-challan';

// Saved sign-in is { token, user: { uid, name, role } }; anything older is dropped.
const readSaved = () => { try { const v = JSON.parse(localStorage.getItem(TOKEN_KEY)); return v?.user ? v : null; } catch { return null; } };
const readSound = () => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } };
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

// Alert sound for new leads, made with Web Audio so no sound file is needed.
// Browsers only allow sound after a click on the page, hence unlock().
let audioCtx;
const sound = {
  unlock() {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* no audio */ }
  },
  ready: () => audioCtx?.state === 'running',
  buzz() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'square'; o.frequency.value = i % 2 ? 660 : 880;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.28);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.28 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 0.24);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + i * 0.28); o.stop(t0 + i * 0.28 + 0.26);
    }
  },
};

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
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);
  useEffect(() => { call('/api/admin/status').then((s) => setEnabled(s.enabled)).catch(() => {}); }, []);

  async function submit(e) {
    e.preventDefault();
    sound.unlock(); // this click lets the new-lead alert play later
    setBusy(true); setErr('');
    try {
      const r = await call('/api/admin/login', null, { method: 'POST', body: JSON.stringify({ username, password: pw }) });
      onIn(r);
    } catch (e2) {
      setErr(e2.status === 429 ? 'Too many tries. Wait 15 minutes and try again.'
        : e2.status === 401 ? 'Username or password is not right.' : 'Could not sign in. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <div style={{ color: '#0E1B36', display: 'flex', alignItems: 'center' }}><Logo /><span className="tag" style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.14em', color: '#9A5B00', marginLeft: 10 }}>ADMIN</span></div>
        <h1>Sign in to see leads</h1>
        {!enabled && <div className="warn">The admin panel is switched off. Add <b>ADMIN_PASSWORD</b> (at least 8 characters) in Render → Environment, then redeploy.</div>}
        <label>Username<input id="admin-user" value={username} onChange={(e) => setUsername(e.target.value.trim().toLowerCase())} autoComplete="username" autoCapitalize="none" placeholder="admin, or the username you were given" required /></label>
        <label>Password<input id="admin-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy || !enabled || !username || !pw}>Sign in</button>
      </form>
    </div>
  );
}

function Drawer({ lead, statuses, isAdmin, staff, onClose, onPatch }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setDraft(''); setCopied(false); }, [lead.ref]);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  const patch = async (p) => { setBusy(true); try { await onPatch(lead.ref, p); } finally { setBusy(false); } };
  const copyPlate = async () => {
    try { await navigator.clipboard.writeText(lead.plate); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  // Keep a reassigned person who has since been deactivated visible in the list.
  const choices = staff.filter((u) => u.active || u.id === lead.agentId);
  if (lead.agentId && !choices.some((u) => u.id === lead.agentId)) choices.push({ id: lead.agentId, name: lead.agent || 'Removed staff' });
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

          <div className="challan-check">
            <div className="sec-k">Check challans</div>
            <div className="cc-row">
              <a className="btn primary" href={PARIVAHAN_URL} target="_blank" rel="noopener noreferrer" onClick={copyPlate}>Open Parivahan e-Challan ↗</a>
              <button className="btn" onClick={copyPlate}>{copied ? 'Copied ✓' : `Copy ${fmtPlate(lead.plate)}`}</button>
            </div>
            <p className="hint">The vehicle number is copied when you open the site. Choose <b>Vehicle Number</b>, paste it, type the captcha and press Get Detail. No OTP is needed.</p>
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
              {isAdmin ? (
                <select id="agent" value={lead.agentId || ''} disabled={busy} onChange={(e) => patch({ assignTo: e.target.value })}>
                  <option value="">Unassigned</option>
                  {choices.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role === 'admin' ? ' (admin)' : ''}</option>)}
                </select>
              ) : <div className="v">{lead.agent || 'Unassigned'}</div>}
              {isAdmin && !staff.length && <div className="hint">Add staff in Settings to assign leads.</div>}
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

const CITY_COURT = { noida: 'District Court, Surajpur', ghaziabad: 'District Court, Ghaziabad', delhi: 'Delhi court complex', gurugram: 'District Court, Gurugram' };
const todayIST = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
const newId = () => Math.random().toString(36).slice(2, 10);
const ERRORS = {
  invalid_whatsapp: 'The WhatsApp number must be a 10-digit Indian mobile number.',
  invalid_phone: 'The calling number must be a 10-digit Indian mobile number.',
  invalid_date: 'One of the dates is not filled in. Pick a date or remove that row.',
};

function Settings({ auth, me, staff, reloadStaff, onSaved, signOut }) {
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call('/api/admin/settings', auth)
      .then((s) => setForm({ whatsapp: s.whatsapp || '', phone: s.phone || '', autoAssign: !!s.autoAssign, lokAdalatDates: s.lokAdalatDates || [] }))
      .catch((e) => (e.status === 401 ? signOut() : setMsg({ ok: false, text: 'Could not load settings. Refresh the page to try again.' })));
  }, [auth, signOut]);

  if (!form) return <div className="panel"><div className="empty">{msg?.text || 'Loading settings…'}</div></div>;

  const setDate = (id, patch) => setForm({ ...form, lokAdalatDates: form.lokAdalatDates.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const addDate = () => setForm({ ...form, lokAdalatDates: [...form.lokAdalatDates, { id: newId(), date: '', time: '10:00', city: 'noida', note: '' }] });
  const removeDate = (id) => setForm({ ...form, lokAdalatDates: form.lokAdalatDates.filter((d) => d.id !== id) });

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const saved = await call('/api/admin/settings', auth, { method: 'PUT', body: JSON.stringify(form) });
      setForm({ whatsapp: saved.whatsapp, phone: saved.phone, autoAssign: !!saved.autoAssign, lokAdalatDates: saved.lokAdalatDates });
      setMsg({ ok: true, text: 'Saved. The website shows the new details straight away.' });
      onSaved(saved);
    } catch (e2) {
      if (e2.status === 401) return signOut();
      setMsg({ ok: false, text: ERRORS[e2.message] || 'Not saved. Check your connection and try again.' });
    } finally { setBusy(false); }
  }

  const today = todayIST();
  return (
    <div className="settings">
    <form className="settings" onSubmit={save}>
      <section className="panel pad">
        <h2>Contact numbers</h2>
        <p className="hint">Shown on the website's WhatsApp button, the call button and the footer.</p>
        <div className="grid2">
          <label className="field">WhatsApp number
            <div className="phone"><span>+91</span><input id="set-wa" inputMode="numeric" value={form.whatsapp} placeholder="98765 43210"
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value.replace(/\D/g, '').slice(-10) })} /></div>
          </label>
          <label className="field">Calling number <span className="opt">(leave empty to use the WhatsApp number)</span>
            <div className="phone"><span>+91</span><input id="set-phone" inputMode="numeric" value={form.phone} placeholder="Same as WhatsApp"
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(-10) })} /></div>
          </label>
        </div>
      </section>

      <section className="panel pad">
        <h2>Lok Adalat dates</h2>
        <p className="hint">The website counts down to the next upcoming <b>{CITY[SITE_CITY]}</b> date. Past dates are hidden from visitors automatically.</p>
        {form.lokAdalatDates.length === 0 && <div className="empty small-empty">No dates yet. The website shows "Date to be announced" until you add one.</div>}
        <div className="dates">
          {form.lokAdalatDates.map((d) => (
            <div className={'date-row' + (d.date && d.date < today ? ' past' : '')} key={d.id}>
              <label className="field">Date<input type="date" value={d.date} onChange={(e) => setDate(d.id, { date: e.target.value })} required /></label>
              <label className="field">Time<input type="time" value={d.time} onChange={(e) => setDate(d.id, { time: e.target.value })} /></label>
              <label className="field">City
                <select value={d.city} onChange={(e) => setDate(d.id, { city: e.target.value })}>
                  {Object.entries(CITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="field note-f">Note on website <span className="opt">(optional)</span>
                <input value={d.note} maxLength={200} placeholder={`e.g. ${CITY_COURT[d.city]}, Hall 3`} onChange={(e) => setDate(d.id, { note: e.target.value })} />
              </label>
              <button type="button" className="btn ghost" onClick={() => removeDate(d.id)} aria-label="Remove this date">Remove</button>
              {d.date && d.date < today && <span className="past-tag">Past</span>}
              {d.city !== SITE_CITY && <span className="city-warn">Not shown on the website: it only shows {CITY[SITE_CITY]} dates.</span>}
            </div>
          ))}
        </div>
        <button type="button" className="btn" onClick={addDate}>+ Add a date</button>
      </section>

      <section className="panel pad">
        <h2>Lead assignment</h2>
        <label className="toggle">
          <input id="set-auto" type="checkbox" checked={form.autoAssign} onChange={(e) => setForm({ ...form, autoAssign: e.target.checked })} />
          <span><b>Auto-assign new leads</b><br />
            <span className="hint">Each new lead goes to the next active staff member in turn. Admins can still change it from the dropdown on any lead.</span></span>
        </label>
        {form.autoAssign && !staff.some((u) => u.active && u.role === 'staff') && <div className="warn" style={{ marginTop: 12 }}>No active staff yet, so new leads stay unassigned. Add someone under Staff below.</div>}
      </section>

      <div className="save-bar">
        {msg && <span className={msg.ok ? 'ok-msg' : 'err'} role="status">{msg.text}</span>}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
    <Staff auth={auth} me={me} staff={staff} reload={reloadStaff} signOut={signOut} />
    </div>
  );
}

const STAFF_ERRORS = {
  missing_name: 'Enter the person\'s name.',
  invalid_username: 'Username: 3 to 30 small letters or numbers (dots, dashes and underscores are fine). "admin" is reserved.',
  short_password: 'The password needs at least 8 characters.',
  username_taken: 'Someone already has that username. Pick another.',
  cannot_demote_self: 'You can\'t switch off or demote your own account.',
};

function Staff({ auth, me, staff, reload, signOut }) {
  const blank = { name: '', username: '', password: '', role: 'staff' };
  const [add, setAdd] = useState(blank);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState(null);
  const [newPw, setNewPw] = useState('');

  const run = async (fn, okText) => {
    setBusy(true); setMsg(null);
    try { await fn(); await reload(); setMsg({ ok: true, text: okText }); return true; }
    catch (e) {
      if (e.status === 401) signOut();
      else setMsg({ ok: false, text: STAFF_ERRORS[e.message] || 'Not saved. Check your connection and try again.' });
      return false;
    } finally { setBusy(false); }
  };
  const patch = (id, body, okText) => run(() => call(`/api/admin/staff/${id}`, auth, { method: 'PATCH', body: JSON.stringify(body) }), okText);

  async function create(e) {
    e.preventDefault();
    if (await run(() => call('/api/admin/staff', auth, { method: 'POST', body: JSON.stringify(add) }), `Added ${add.name}. Share the username and password with them.`)) setAdd(blank);
  }

  return (
    <section className="panel pad" id="staff">
      <h2>Staff</h2>
      <p className="hint">Everyone signs in at this same page with their own username and password. <b>Staff</b> see only the leads assigned to them. <b>Admins</b> see all leads and can change settings. Your own login is username <b>admin</b> with the ADMIN_PASSWORD from Render.</p>
      {staff.length > 0 && (
        <div className="table-wrap">
          <table className="staff-table">
            <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {staff.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'off'}>
                  <td className="name">{u.name}</td>
                  <td><code>{u.username}</code></td>
                  <td>
                    <select value={u.role} disabled={busy || u.id === me.uid} onChange={(e) => patch(u.id, { role: e.target.value }, `${u.name} is now ${e.target.value === 'admin' ? 'an admin' : 'staff'}.`)}>
                      <option value="staff">Staff</option><option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>{u.active ? 'Active' : 'Switched off'}</td>
                  <td className="row-actions">
                    {resetFor === u.id ? (
                      <form onSubmit={async (e) => { e.preventDefault(); if (await patch(u.id, { password: newPw }, `New password set for ${u.name}. They need to sign in again.`)) { setResetFor(null); setNewPw(''); } }}>
                        <input type="text" value={newPw} autoComplete="new-password" placeholder="New password (8+)" onChange={(e) => setNewPw(e.target.value)} autoFocus />
                        <button className="btn primary" disabled={busy || newPw.length < 8}>Set</button>
                        <button type="button" className="btn ghost" onClick={() => { setResetFor(null); setNewPw(''); }}>Cancel</button>
                      </form>
                    ) : (<>
                      <button type="button" className="btn ghost" disabled={busy} onClick={() => { setResetFor(u.id); setNewPw(''); }}>Reset password</button>
                      {u.id !== me.uid && (
                        <button type="button" className="btn ghost" disabled={busy} onClick={() => patch(u.id, { active: !u.active }, u.active ? `${u.name} can no longer sign in.` : `${u.name} can sign in again.`)}>
                          {u.active ? 'Switch off' : 'Switch on'}
                        </button>
                      )}
                    </>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="add-staff" onSubmit={create}>
        <div className="sec-k">Add a person</div>
        <div className="grid4">
          <label className="field">Name<input id="staff-name" value={add.name} placeholder="e.g. Priya Sharma" onChange={(e) => setAdd({ ...add, name: e.target.value })} /></label>
          <label className="field">Username<input id="staff-user" value={add.username} autoCapitalize="none" placeholder="e.g. priya" onChange={(e) => setAdd({ ...add, username: e.target.value.trim().toLowerCase() })} /></label>
          <label className="field">Password<input id="staff-pw" type="text" autoComplete="new-password" value={add.password} placeholder="At least 8 characters" onChange={(e) => setAdd({ ...add, password: e.target.value })} /></label>
          <label className="field">Role
            <select id="staff-role" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}><option value="staff">Staff</option><option value="admin">Admin</option></select>
          </label>
        </div>
        <div className="save-bar">
          {msg && <span className={msg.ok ? 'ok-msg' : 'err'} role="status">{msg.text}</span>}
          <button className="btn primary" disabled={busy || !add.name.trim() || !add.username || add.password.length < 8}>Add person</button>
        </div>
      </form>
    </section>
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
  const [view, setView] = useState(() => (location.hash === '#settings' ? 'settings' : 'leads'));
  const [site, setSite] = useState(null);
  const [staff, setStaff] = useState([]);
  const [soundOn, setSoundOn] = useState(readSound);
  const [soundReady, setSoundReady] = useState(sound.ready);
  const [fresh, setFresh] = useState([]); // refs that arrived since the page was opened
  const seen = useRef(null);
  const me = auth?.user;
  const isAdmin = me?.role === 'admin';
  const page = isAdmin && view === 'settings' ? 'settings' : 'leads';
  useEffect(() => { history.replaceState(null, '', page === 'settings' ? '#settings' : '#'); }, [page]);
  useEffect(() => { call('/api/settings').then(setSite).catch(() => {}); }, []);

  const signOut = useCallback(() => { save(null); setAuth(null); setLeads(null); setStaff([]); seen.current = null; setFresh([]); }, []);

  const load = useCallback(async () => {
    if (!auth) return;
    try {
      const r = await call('/api/admin/leads', auth);
      // Buzz for leads we have not seen before (not on the first load).
      const refs = r.leads.map((l) => l.ref);
      if (seen.current) {
        const added = refs.filter((x) => !seen.current.has(x));
        if (added.length) {
          setFresh((f) => [...added, ...f]);
          if (readSound()) sound.buzz();
        }
      }
      seen.current = new Set(refs);
      setLeads(r.leads); setStorage(r.storage); setErr('');
    } catch (e) {
      if (e.status === 401) signOut();
      else setErr('Could not load leads. The server may be waking up; this page keeps retrying.');
    }
  }, [auth, signOut]);

  const loadStaff = useCallback(async () => {
    if (!auth) return;
    try { setStaff((await call('/api/admin/staff', auth)).staff); } catch (e) { if (e.status === 401) signOut(); }
  }, [auth, signOut]);
  useEffect(() => { loadStaff(); }, [loadStaff]);

  // Flash the tab title while new leads are waiting to be looked at.
  useEffect(() => {
    const base = 'Niptao Admin';
    if (!fresh.length) { document.title = base; return; }
    let on = false;
    const iv = setInterval(() => { on = !on; document.title = on ? `(${fresh.length}) New lead!` : base; }, 1000);
    return () => { clearInterval(iv); document.title = base; };
  }, [fresh.length]);

  // Any click on the page lets the browser play the alert sound.
  useEffect(() => {
    const unlock = () => { sound.unlock(); setTimeout(() => setSoundReady(sound.ready()), 50); };
    document.addEventListener('pointerdown', unlock);
    return () => document.removeEventListener('pointerdown', unlock);
  }, []);

  const toggleSound = () => {
    const next = soundOn && soundReady ? false : true; // a tap while waiting for permission turns it on, not off
    try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off'); } catch { /* private mode */ }
    setSoundOn(next);
    if (next) { sound.unlock(); setTimeout(() => { setSoundReady(sound.ready()); sound.buzz(); }, 50); }
  };

  useEffect(() => {
    call('/api/admin/status').then((s) => s.statuses && setStatuses(s.statuses)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const iv = setInterval(load, POLL_MS);
    return () => clearInterval(iv);
  }, [load]);

  const onPatch = async (ref, p) => {
    try {
      const { lead } = await call(`/api/admin/leads/${encodeURIComponent(ref)}`, auth, { method: 'PATCH', body: JSON.stringify(p) });
      setLeads((ls) => ls.map((l) => (l.ref === ref ? lead : l)));
    } catch (e) {
      if (e.status === 401) signOut();
      else if (e.message === 'not_your_lead') { setErr('That lead is no longer assigned to you.'); setSel(null); load(); }
      else setErr('That change was not saved. Try again.');
    }
  };

  const filtered = useMemo(() => {
    const s = q.toLowerCase().replace(/\s/g, '');
    return (leads || []).filter((l) => !s || (l.name + l.plate + l.phone + l.ref).toLowerCase().replace(/\s/g, '').includes(s));
  }, [leads, q]);
  const rows = tab === 'All' ? filtered : filtered.filter((l) => l.status === tab);

  if (!auth) return <Login onIn={(a) => { save(a); setAuth(a); setSoundReady(sound.ready()); }} />;

  const all = leads || [];
  const weekAgo = Date.now() - 7 * 864e5;
  const kpis = [
    isAdmin ? ['New, unassigned', all.filter((l) => l.status === 'New' && !l.agent).length] : ['New', all.filter((l) => l.status === 'New').length],
    ['Open leads', all.filter((l) => !['Settled', 'Lost'].includes(l.status)).length],
    ['Last 7 days', all.filter((l) => new Date(l.createdAt) > weekAgo).length],
    ['Settled', all.filter((l) => l.status === 'Settled').length],
  ];
  const selLead = all.find((l) => l.ref === sel);

  const next = site?.lokAdalatDates?.[0];
  const nextLine = next
    ? <>Next Lok Adalat: <strong>{new Date(`${next.date}T${next.time}:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</strong> · {CITY_COURT[next.city]}</>
    : isAdmin ? <>No upcoming Lok Adalat date. <a href="#settings" onClick={(e) => { e.preventDefault(); setView('settings'); }}>Add one in Settings</a></> : <>No upcoming Lok Adalat date yet.</>;
  const exportCsv = () => {
    const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `niptao-leads-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <header className="bar">
        <div className="bar-in">
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}><Logo /><span className="tag">ADMIN</span></div>
            <nav className="nav">
              <button aria-pressed={page === 'leads'} onClick={() => setView('leads')}>Leads</button>
              {isAdmin && <button aria-pressed={page === 'settings'} onClick={() => setView('settings')}>Settings</button>}
            </nav>
          </div>
          <div className="who">
            <button className={'sound' + (soundOn && soundReady ? ' on' : '') + (soundOn && !soundReady ? ' wake' : '')} onClick={toggleSound}
              title="Plays a buzzer when a new lead arrives" aria-label={!soundOn ? 'New-lead alert off' : soundReady ? 'New-lead alert on' : 'Tap to enable new-lead alert'}>
              {soundOn ? '🔔' : '🔕'}<span> {!soundOn ? 'Alert off' : soundReady ? 'Alert on' : 'Tap to enable alert'}</span>
            </button>
            <span>{me.name}{isAdmin ? '' : ' · Staff'}</span><button onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="page">
        {page === 'settings' ? (
          <>
            <div className="head"><div><h1>Settings</h1><div className="sub">Changes show on the website as soon as you save.</div></div></div>
            <Settings auth={auth} me={me} staff={staff} reloadStaff={loadStaff} signOut={signOut} onSaved={(s) => setSite({ ...s, lokAdalatDates: s.lokAdalatDates.filter((d) => d.date >= todayIST()) })} />
          </>
        ) : (<>
        <div className="head">
          <div>
            <h1>Leads</h1>
            <div className="sub">{nextLine}</div>
          </div>
          <div className="kpis">
            {kpis.map(([l, v]) => <div className="kpi" key={l}><div className="l">{l}</div><div className="v">{leads ? v : '–'}</div></div>)}
          </div>
        </div>

        {storage === 'file' && (
          <div className="warn"><b>Leads are in temporary storage.</b> On Render's free plan they are deleted whenever the server restarts. Connect a database (DATABASE_URL) to keep them.</div>
        )}
        {err && <div className="warn" role="alert">{err}</div>}
        {fresh.length > 0 && (
          <div className="new-banner" role="status">
            <b>{fresh.length === 1 ? '1 new lead' : `${fresh.length} new leads`}</b> arrived while this page was open.
            <button className="btn" onClick={() => { setTab('All'); setQ(''); setFresh([]); }}>Got it</button>
          </div>
        )}
        {!isAdmin && <div className="sub" style={{ marginBottom: 12 }}>You see the leads assigned to you.</div>}

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
                  <tr key={l.ref} className={(sel === l.ref ? 'sel' : '') + (fresh.includes(l.ref) ? ' fresh' : '')} onClick={() => { setSel(l.ref); setFresh((f) => f.filter((x) => x !== l.ref)); }}>
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
            {leads && !rows.length && <div className="empty">{all.length ? 'No leads match this search.' : isAdmin ? 'No leads yet. They appear here as soon as someone submits the form on the website.' : 'No leads are assigned to you yet.'}</div>}
            {!leads && !err && <div className="empty">Loading leads…</div>}
          </div>
          {leads && <div className="foot">Showing {rows.length} of {all.length} leads · checks for new leads every 15 seconds</div>}
        </div>
        </>)}
      </main>
      {selLead && <Drawer lead={selLead} statuses={statuses} isAdmin={isAdmin} staff={staff} onClose={() => setSel(null)} onPatch={onPatch} />}
    </>
  );
}
