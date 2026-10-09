import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseChallans } from './parseChallans.js';

const STATUS_COLORS = {
  New: ['#E8EEF8', '#2F5AA8'], Contacted: ['#F0EAF8', '#6A42A0'], 'Documents received': ['#FFF1D9', '#8A5200'], 'Documents verified': ['#FDF3C4', '#6B5300'],
  Scheduled: ['#E1F2F4', '#0E6470'], Settled: ['#E3F2E9', '#1F6B45'], Lost: ['#ECEBE8', '#5E6472'],
};
const CITY = { noida: 'Noida / Gr. Noida', ghaziabad: 'Ghaziabad', delhi: 'Delhi', gurugram: 'Gurugram' };
const TOKEN_KEY = 'niptao-admin';
const SOUND_KEY = 'niptao-sound';
const POLL_MS = 15_000;
// Official e-challan site: search by vehicle number + captcha, no OTP.
// Niptao Lead Filler Chrome add-on, served from public/. Replace the zip and bump this on each release.
const ADDON_ZIP = '/niptao-lead-filler.zip';
const ADDON_VERSION = '1.7.2';
// Park+ challan check (search by vehicle number). Used until a paid challan API is switched on.
const PARKPLUS_URL = 'https://parkplus.io/e-challan';
const PARIVAHAN_URL = 'https://echallan.parivahan.gov.in/index/accused-challan';
// Delhi Traffic Police virtual court: token for Delhi challans (Lead Filler add-on 1.7.0+ fills the number).
const DELHI_COURT_URL = 'https://traffic.delhipolice.gov.in/evecourtddc/#/';

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
const challanTotal = (l) => (l.challans || []).reduce((n, c) => n + (c.amount || 0), 0);
const approvedOf = (l) => (l.challans || []).filter((c) => c.approved);
const approvedTotal = (l) => approvedOf(l).reduce((n, c) => n + (c.amount || 0), 0);
const FEE_RATES = [50, 40, 30];
const feeRate = (l) => (FEE_RATES.includes(l.feeRate) ? l.feeRate : 50);
const payable = (l) => Math.round((approvedTotal(l) * feeRate(l)) / 100);
const inr = (n) => `₹${n.toLocaleString('en-IN')}`;
// State a challan was issued in, read from the challan number's prefix (UP…, HR…). Delhi Traffic Police
// challan numbers are digits only. Leads with no challans fall back to the vehicle's registration state.
const STATES = { AN: 'Andaman & Nicobar', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar', CG: 'Chhattisgarh', CH: 'Chandigarh',
  DD: 'Daman & Diu', DL: 'Delhi', DN: 'Dadra & Nagar Haveli', GA: 'Goa', GJ: 'Gujarat', HP: 'Himachal Pradesh', HR: 'Haryana', JH: 'Jharkhand',
  JK: 'Jammu & Kashmir', KA: 'Karnataka', KL: 'Kerala', LA: 'Ladakh', LD: 'Lakshadweep', MH: 'Maharashtra', ML: 'Meghalaya', MN: 'Manipur',
  MP: 'Madhya Pradesh', MZ: 'Mizoram', NL: 'Nagaland', OD: 'Odisha', OR: 'Odisha', PB: 'Punjab', PY: 'Puducherry', RJ: 'Rajasthan', SK: 'Sikkim',
  TN: 'Tamil Nadu', TR: 'Tripura', TS: 'Telangana', TG: 'Telangana', UK: 'Uttarakhand', UA: 'Uttarakhand', UP: 'Uttar Pradesh', WB: 'West Bengal' };
const challanState = (c) => {
  const no = String(c.challanNo || '').toUpperCase().replace(/\s/g, '');
  if (/^\d{6,}$/.test(no)) return 'DL';
  const st = no.slice(0, 2);
  return STATES[st] ? st : '';
};
const plateState = (l) => (STATES[(l.plate || '').slice(0, 2)] ? l.plate.slice(0, 2) : '');
const leadStates = (l) => {
  const set = new Set((l.challans || []).map(challanState).filter(Boolean));
  if (!set.size && !l.challans?.length && plateState(l)) set.add(plateState(l));
  return [...set];
};
// Pre-written message asking the customer to approve, in writing, the challans they agreed to on the call.
// Next Lok Adalat for the customer's city, else the soonest one anywhere (dates arrive already filtered to upcoming).
function lokFor(l, dates) {
  const list = dates || [];
  return list.find((d) => d.city === l.city) || list[0] || null;
}
function approvalMessage(l, dates) {
  const lok = lokFor(l, dates);
  const lokLine = lok ? `Next Lok Adalat: *${new Date(`${lok.date}T${lok.time || '10:00'}:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}* at ${CITY_COURT[lok.city] || CITY[lok.city] || lok.city}. We will settle the approved challans there, so please reply before then.` : '';
  const all = l.challans || [];
  const ok = all.filter((c) => c.approved), rest = all.filter((c) => !c.approved);
  const line = (c, i) => `${i + 1}. Challan ${c.challanNo || '-'}${c.date ? ` (${c.date})` : ''}${c.offence ? ` - ${String(c.offence).slice(0, 70)}` : ''} - ${inr(c.amount || 0)}`;
  const restTotal = rest.reduce((n, c) => n + (c.amount || 0), 0);
  return [
    `Hi ${l.name},`,
    '',
    `This is Niptao. Your vehicle ${fmtPlate(l.plate)} has ${all.length} challan${all.length === 1 ? '' : 's'} totalling ${inr(challanTotal(l))}.`,
    '',
    `*Challans we will settle for you (${ok.length})*`,
    ...ok.map(line),
    `Challan amount: ${inr(approvedTotal(l))}`,
    `Amount you pay (${feeRate(l)}%): *${inr(payable(l))}*`,
    ...(rest.length ? ['', `*Remaining challans, not included (${rest.length})*`, ...rest.map(line), `Remaining amount: ${inr(restTotal)}`,
      'These stay pending on your vehicle. Tell us if you want us to settle these too.'] : []),
    ...(lokLine ? ['', lokLine] : []),
    '',
    `Please reply *I APPROVE* to give your written approval for Niptao to settle the ${ok.length} challan${ok.length === 1 ? '' : 's'} listed under "Challans we will settle for you" for ${inr(payable(l))}.`,
    '',
    `Reference: ${l.ref}`,
    'Team Niptao',
  ].join('\n');
}
// True when the approved challans or the rate changed after the approval message went out.
const waStale = (l) => {
  const w = l.waApproval;
  if (!w) return false;
  const ok = approvedOf(l);
  return w.feeRate !== feeRate(l) || w.total !== approvedTotal(l) || ok.map((c) => c.challanNo || '').join('|') !== (w.challanNos || []).join('|');
};
const fullDate = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function Logo() {
  return <span className="logo" aria-label="Niptao"><span className="dev">निप</span><span className="lat">tao</span></span>;
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

const SOURCES = ['Park+', 'Parivahan', 'Delhi Traffic Police', 'Virtual Courts', 'Other'];
const blankRow = () => ({ challanNo: '', date: '', offence: '', location: '', amount: '', status: '' });

// Paste challan text copied from any site, check the rows, save them on the lead.
function ChallanEditor({ lead, onSave, onCancel }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState(() => (lead.challans?.length ? lead.challans.map((c) => ({ ...c })) : []));
  const [source, setSource] = useState(lead.challansSource && SOURCES.includes(lead.challansSource) ? lead.challansSource : 'Park+');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const read = () => {
    const found = parseChallans(text);
    setMsg(found.length ? `Found ${found.length} challan${found.length === 1 ? '' : 's'}. Check each row, fix anything wrong, then Save.` : 'No challan numbers found in that text. Add rows by hand instead.');
    if (found.length) setRows(found);
  };
  const save = async (list) => {
    setBusy(true);
    try { await onSave(list, source); } finally { setBusy(false); }
  };
  const total = rows.reduce((n, r) => n + (Number(String(r.amount).replace(/[^\d.]/g, '')) || 0), 0);
  return (
    <div className="ch-edit">
      <div className="sec-k">Add challan details</div>
      <p className="hint">On Park+ or any challan site, select the challan list with your mouse, copy it (Ctrl+C), and paste it here.</p>
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the copied challan details here" />
      <div className="row-btns">
        <button className="btn primary" disabled={!text.trim()} onClick={read}>Read challans</button>
        <button className="btn" onClick={() => setRows([...rows, blankRow()])}>+ Add a row by hand</button>
      </div>
      {msg && <div className="small" role="status">{msg}</div>}
      {rows.map((r, i) => (
        <div className="ch-row" key={i}>
          <input aria-label="Challan number" placeholder="Challan no." value={r.challanNo} onChange={(e) => set(i, 'challanNo', e.target.value)} />
          <input aria-label="Amount" placeholder="₹ Amount" inputMode="numeric" value={r.amount || ''} onChange={(e) => set(i, 'amount', e.target.value)} />
          <input className="wide" aria-label="Offence" placeholder="Offence" value={r.offence} onChange={(e) => set(i, 'offence', e.target.value)} />
          <input aria-label="Date" placeholder="Date" value={r.date} onChange={(e) => set(i, 'date', e.target.value)} />
          <input aria-label="Status" placeholder="Status" value={r.status} onChange={(e) => set(i, 'status', e.target.value)} />
          <input className="wide" aria-label="Place" placeholder="Place" value={r.location} onChange={(e) => set(i, 'location', e.target.value)} />
          <button className="btn ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="row-btns">
        <label className="src">Source
          <select value={source} onChange={(e) => setSource(e.target.value)}>{SOURCES.map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        <button className="btn primary" disabled={busy || !rows.length} onClick={() => save(rows)}>Save {rows.length} challan{rows.length === 1 ? '' : 's'}{total ? ` · ₹${total.toLocaleString('en-IN')}` : ''}</button>
        <button className="btn" disabled={busy} onClick={() => save([])} title="Mark that this vehicle has no challans">No challans</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// One "same as the lead" tick with a box that is always there when it's not the same.
function SameOr({ label, sameLabel, value, field, placeholder, inputMode, clean, valid, savedText, onSave }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [untick, setUntick] = useState(false); // ticked before, unticked now: show the box until something is saved
  useEffect(() => { setText(value && !value.same ? value[field] : ''); setErr(''); setUntick(false); }, [value?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (p) => { setBusy(true); setErr(''); try { if (await onSave(p) === false) setErr('Not saved. Check it and try again.'); } finally { setBusy(false); } };
  const same = !!value?.same && !untick;
  const saved = value && !value.same ? value[field] : '';
  return (
    <div className="own-row">
      <div className="own-k">{label}</div>
      <div className="own-v">
        <label className="own-same">
          <input type="checkbox" checked={same} disabled={busy} onChange={(e) => (e.target.checked ? save({ same: true }) : setUntick(true))} />
          {sameLabel}
        </label>
        {!same && (
          <form className="own-form" onSubmit={(e) => { e.preventDefault(); if (valid(text)) save({ same: false, [field]: clean(text) }); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={label} inputMode={inputMode} maxLength={120} />
            <button className="btn" disabled={busy || !valid(text) || clean(text) === saved}>Save</button>
          </form>
        )}
        {saved && <div className="small">Saved: <b>{savedText(saved)}</b>{value.by ? ` · ${value.by}` : ''}</div>}
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}

// Name and mobile number on the vehicle's RC. Messages to the customer always use the lead's own name and number.
function OwnerFields({ lead, onPatch }) {
  const send = (key) => (p) => onPatch(lead.ref, { [key]: p });
  return (
    <div className="owner">
      <SameOr label="Name on RC" sameLabel={`Same as lead name (${lead.name})`} value={lead.rcName} field="name"
        placeholder="Name as on the RC" clean={(v) => v.replace(/\s+/g, ' ').trim()} valid={(v) => v.trim().length >= 2}
        savedText={(v) => v} onSave={send('rcName')} />
      {lead.rcOwner?.name && (
        <div className={`own-hint ${lead.rcOwner.match || ''}`}>Parivahan shows <b>{lead.rcOwner.name}</b>{' '}
          {lead.rcOwner.match === 'match' ? '✓ matches' : lead.rcOwner.match === 'partial' ? '⚠ partly matches' : lead.rcOwner.match === 'mismatch' ? "⚠ doesn't match the lead name" : ''}
        </div>
      )}
      <SameOr label="Registered mobile" sameLabel={`Same as lead mobile (${fmtPhone(lead.phone)})`} value={lead.rcMobile} field="phone"
        placeholder="10-digit mobile" inputMode="numeric" clean={(v) => v.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')}
        valid={(v) => /^[6-9]\d{9}$/.test(v.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))} savedText={(v) => `+91 ${fmtPhone(v)}`} onSave={send('rcMobile')} />
    </div>
  );
}

// Stage dots next to the lead's name: green for done and current, red for what is still to come.
const FLOW = ['New', 'Contacted', 'Documents received', 'Documents verified', 'Scheduled', 'Settled'];
function StageDots({ status }) {
  const lost = status === 'Lost';
  const at = FLOW.indexOf(status);
  return (
    <div className="stages" aria-label={`Stage: ${status}`}>
      <div className="dots">
        {FLOW.map((s, i) => {
          const kind = lost ? 'todo' : i < at ? 'done' : i === at ? 'now' : 'todo';
          return <span key={s} className={`dot ${kind}`} title={`${s}${kind === 'done' ? ' · done' : kind === 'now' ? ' · current stage' : ' · pending'}`} />;
        })}
      </div>
      <span className={`stage-name${lost ? ' lost' : ''}`}>{status}{!lost && at >= 0 ? ` · step ${at + 1} of ${FLOW.length}` : ''}</span>
    </div>
  );
}

// "2/3" needed documents uploaded, or the file count when nothing is marked needed.
const docsHave = (l, types) => {
  const need = types.filter((t) => t.required);
  return need.length ? `${need.filter((t) => (l.docs || []).some((d) => d.type === t.id)).length}/${need.length}` : `${(l.docs || []).length} files`;
};
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// Phone photos are often 3–8 MB. Shrink big images to at most 2000px JPEG before uploading.
function shrinkImage(file) {
  const plain = /^image\/(jpeg|png|webp)$/.test(file.type); // other images (iPhone HEIC) become JPEG when the browser can read them
  if (!/^image\//.test(file.type) || (plain && file.size < 1_200_000)) return Promise.resolve(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 2000 / Math.max(img.width, img.height));
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob((b) => resolve(b && (!plain || b.size < file.size) ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', 0.85);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

const DOC_ERR = { file_too_large: 'That file is bigger than 5 MB. Upload a smaller photo or PDF.', file_type_not_allowed: 'Only photos (JPG, PNG, WEBP) and PDF files can be uploaded.',
  unknown_doc_type: 'This document type was removed in Settings. Reload the page.', too_many_docs: 'This lead already has the most files allowed. Remove some first.',
  not_your_lead: 'This lead is no longer assigned to you.' };

// One upload button per document type from Settings. Files open only for signed-in team members.
// Message sent with the customer's upload link, in the language they chose on the website.
function uploadLinkMessage(lead, url, types) {
  const need = types.filter((t) => t.required).map((t) => t.name).join(', ');
  const till = new Date(lead.docLink.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  return lead.lang === 'hi'
    ? `नमस्ते ${lead.name}, वाहन ${fmtPlate(lead.plate)} के चालान के लिए कृपया इस लिंक पर अपने दस्तावेज़ अपलोड करें:\n${url}\n\n${need ? `ज़रूरी दस्तावेज़: ${need}\n` : ''}यह लिंक ${till} तक चलेगा। - Niptao`
    : `Hi ${lead.name}, please upload your documents for the challans on ${fmtPlate(lead.plate)} using this link:\n${url}\n\n${need ? `Documents needed: ${need}\n` : ''}The link works till ${till}. - Niptao`;
}

function Docs({ lead, types, onUpload, onOpenDoc, onRemoveDoc, onPatch, onDocLink }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [lead.ref]);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const link = lead.docLink && new Date(lead.docLink.expiresAt) > new Date() ? lead.docLink : null;
  const linkUrl = link ? `${window.location.origin}/upload/${link.token}` : '';
  const makeLink = async (off) => {
    if (off && !window.confirm('Switch off this link? The customer will not be able to upload with it any more.')) return;
    if (!off && link && !window.confirm('Make a new link? The old link will stop working.')) return;
    setLinkBusy(true);
    try { const e = await onDocLink(lead.ref, off); if (e) setErr(DOC_ERR[e] || 'The link was not changed. Try again.'); } finally { setLinkBusy(false); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(linkUrl); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); } catch { /* clipboard blocked */ }
  };
  const [busyType, setBusyType] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => setErr(''), [lead.ref]);
  const docs = lead.docs || [];
  const known = new Set(types.map((t) => t.id));
  const others = docs.filter((d) => !known.has(d.type));
  const needed = types.filter((t) => t.required);
  const have = needed.filter((t) => docs.some((d) => d.type === t.id)).length;
  const upload = async (type, files) => {
    setErr(''); setBusyType(type.id);
    try {
      for (const f of files) {
        const e = await onUpload(lead.ref, type.id, await shrinkImage(f));
        if (e) { setErr(DOC_ERR[e] || 'The file was not uploaded. Try again.'); break; }
      }
    } finally { setBusyType(''); }
  };
  const remove = async (d) => {
    if (!window.confirm(`Remove ${d.name} from this lead? The file is deleted.`)) return;
    const e = await onRemoveDoc(lead.ref, d.id);
    if (e) setErr(DOC_ERR[e] || 'The file was not removed. Try again.');
  };
  const row = (d) => (
    <li key={d.id}>
      <button className="linkish" onClick={() => onOpenDoc(lead.ref, d)}>{d.name}</button>
      <span className="small"> · {fmtSize(d.size)} · {d.by} · {ago(d.at)}</span>
      <button className="x" aria-label={`Remove ${d.name}`} title="Remove" onClick={() => remove(d)}>×</button>
    </li>
  );
  return (
    <div className={'docs' + (open ? ' open' : '')}>
      <button type="button" className="docs-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="sec-k">{open ? '▾' : '▸'} Documents</span>
        <span className="small">{needed.length > 0 ? `${have} of ${needed.length} needed` : `${docs.length} file${docs.length === 1 ? '' : 's'}`}
          {lead.docsNew > 0 ? ` · ${lead.docsNew} new from customer` : ''}{link ? ' · upload link active' : ''}{lead.status === 'Documents verified' ? ' · ✓ verified' : ''}</span>
      </button>
      {open && (<>
      {!types.length && <div className="hint">No document types yet. An admin can add them in Settings → Documents.</div>}
      {types.length > 0 && (
        <div className="doc-link">
          {link ? (<>
            <div className="small"><b>Customer upload link</b> · works till {fullDate(link.expiresAt)}</div>
            <div className="doc-link-url">{linkUrl}</div>
            <div className="doc-link-btns">
              <a className="btn wa-btn" href={`https://wa.me/91${lead.phone}?text=${encodeURIComponent(uploadLinkMessage(lead, linkUrl, types))}`} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>
              <button className="btn" onClick={copyLink}>{linkCopied ? 'Copied ✓' : 'Copy link'}</button>
              <button className="btn ghost" disabled={linkBusy} onClick={() => makeLink(true)}>Switch off</button>
              <button className="btn ghost" disabled={linkBusy} onClick={() => makeLink(false)}>New link</button>
            </div>
          </>) : (<>
            <button className="btn" disabled={linkBusy} onClick={() => makeLink(false)}>🔗 Make upload link for customer</button>
            <div className="hint">The customer opens it on their phone and uploads each document. They can't see or delete files.{lead.docLink ? ' The last link has expired.' : ''}</div>
          </>)}
        </div>
      )}
      {types.map((t) => {
        const mine = docs.filter((d) => d.type === t.id);
        return (
          <div key={t.id} className={`doc-type${mine.length ? ' done' : ''}`}>
            <div className="doc-head">
              <div><b>{mine.length ? '✓ ' : ''}{t.name}</b>{!t.required && <span className="small"> (optional)</span>}</div>
              <label className={`btn${mine.length ? '' : ' primary'}${busyType ? ' disabled' : ''}`}>
                {busyType === t.id ? 'Uploading…' : mine.length ? 'Add another' : 'Upload'}
                <input type="file" accept="image/*,application/pdf" multiple hidden disabled={!!busyType}
                  onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) upload(t, f); }} />
              </label>
            </div>
            {mine.length > 0 && <ul className="doc-files">{mine.map(row)}</ul>}
          </div>
        );
      })}
      {others.length > 0 && (
        <div className="doc-type done"><div className="doc-head"><b>Other files</b></div><ul className="doc-files">{others.map((d) => row({ ...d, name: `${d.typeName}: ${d.name}` }))}</ul></div>
      )}
      {err && <div className="err" role="alert">{err}</div>}
      {lead.status === 'Documents received' && have < needed.length && (
        <div className="small">Still needed: {needed.filter((t) => !docs.some((d) => d.type === t.id)).map((t) => t.name).join(', ')}</div>
      )}
      {lead.status === 'Documents received' && have === needed.length && (
        <div className="ask docs-verify">
          All documents are in. Check them, then
          <button className="btn primary" onClick={() => onPatch(lead.ref, { status: 'Documents verified', note: 'Documents verified.' })}>Mark documents verified</button>
        </div>
      )}
      {lead.status === 'Documents verified' && <div className="small ok-msg">✓ Documents verified</div>}
      </>)}
    </div>
  );
}

function Drawer({ lead, statuses, isAdmin, isSuper, staff, onClose, onPatch, onSaveChallans, onDelete, askApproval, onAsked, listState, lokDates, siblings = [], onOpen, waApi, onWaSend, getPayment, isAdminUser, docTypes = [], onUploadDoc, onOpenDoc, onRemoveDoc, onDocLink }) {
  const [draft, setDraft] = useState('');
  const [chSt, setChSt] = useState(listState || '');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [waDraft, setWaDraft] = useState('');
  const [waErr, setWaErr] = useState('');
  const [plateIn, setPlateIn] = useState('');
  const [pay, setPay] = useState(null); // { text, upiLink, qr, amount } or { error }
  const [qrCopied, setQrCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [chatBig, setChatBig] = useState(false);
  const chatRef = useRef(null);
  // Show the latest WhatsApp message first.
  useEffect(() => { const el = chatRef.current; if (el) el.scrollTop = el.scrollHeight; }, [lead.ref, lead.waChat?.length, chatBig]);
  const approvedIn = lead.waApproval?.state === 'received';
  const payKey = `${lead.ref}|${approvedIn}|${feeRate(lead)}|${approvedTotal(lead)}`;
  useEffect(() => {
    setPay(null);
    if (approvedIn && getPayment) getPayment(lead.ref).then(setPay);
  }, [payKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const copyQr = async () => {
    try {
      const blob = await (await fetch(pay.qr)).blob();
      const png = blob.type === 'image/png' ? blob : await new Promise((ok) => {
        const img = new Image(); img.onload = () => { const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }); c.getContext('2d').drawImage(img, 0, 0); c.toBlob(ok, 'image/png'); }; img.src = pay.qr;
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setQrCopied(true); setTimeout(() => setQrCopied(false), 2500);
    } catch { /* clipboard blocked: staff can use Download */ }
  };
  useEffect(() => { setDraft(''); setCopied(false); setEditing(false); setChSt(listState || ''); setWaDraft(''); setWaErr(''); setPlateIn(''); setShowHelp(false); setChatBig(false); }, [lead.ref, listState]);
  // Opening a lead clears its "new WhatsApp reply" badge.
  useEffect(() => { if (lead.waUnread) onPatch(lead.ref, { waRead: true }); }, [lead.ref, lead.waUnread]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (lead.docsNew) onPatch(lead.ref, { docsSeen: true }); }, [lead.ref, lead.docsNew]); // eslint-disable-line react-hooks/exhaustive-deps
  const waOpen = !!lead.waLastIn && Date.now() - new Date(lead.waLastIn) < 24 * 3600e3;
  const WA_ERR = { window_closed: 'The customer has not messaged in the last 24 hours, so WhatsApp only allows the approval template. Use "Open in WhatsApp" instead, or ask an admin to add the template.',
    whatsapp_not_set_up: 'WhatsApp is not connected yet.', not_your_lead: 'This lead is no longer assigned to you.' };
  const waSend = async (body) => {
    setBusy(true); setWaErr('');
    try { const e = await onWaSend(lead.ref, body); if (e) setWaErr(WA_ERR[e] || 'WhatsApp did not send it. Try again, or use "Open in WhatsApp".'); return !e; }
    finally { setBusy(false); }
  };
  const approvalRef = useRef(null);
  useEffect(() => { if (askApproval) approvalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [askApproval, lead.ref]);
  const toggleApproved = (i) => {
    const now = (lead.challans || []).map((c, j) => (j === i ? !c.approved : !!c.approved));
    patch({ approved: now.flatMap((on, j) => (on ? [j] : [])) });
  };
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
            <h2>{lead.name}{lead.plate && <span className="plate head-plate">{fmtPlate(lead.plate)}</span>}</h2>
            <StageDots status={lead.status} />
            <div className="status-btns head-status" role="group" aria-label="Stage">
              {statuses.map((s) => {
                const on = lead.status === s, [, fg] = STATUS_COLORS[s] || STATUS_COLORS.New;
                return <button key={s} disabled={busy} onClick={() => { if (on) return; patch({ status: s }); if (s === 'Contacted') onAsked(true); }}
                  style={on ? { background: fg, borderColor: fg, color: '#fff' } : undefined} aria-pressed={on}>{s}</button>;
              })}
            </div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0E1B36" strokeWidth="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="drawer-body">
          <div className="col-main">
            {lead.groupRef && (
              <div className="siblings">
                <div className="sec-k">Same customer · {siblings.length + 1} vehicles</div>
                <div className="cc-row">
                  <span className="plate cur">{fmtPlate(lead.plate)}</span>
                  {siblings.map((x) => (
                    <button key={x.ref} className="btn" onClick={() => onOpen(x.ref)} title={`${x.ref} · ${x.status}`}>{fmtPlate(x.plate)} <span className="small">· {x.status}</span></button>
                  ))}
                </div>
                {siblings.length + 1 < (lead.vehicles || 0) && <div className="small">{lead.vehicles - siblings.length - 1} more vehicle(s) from this request are assigned to someone else or were deleted.</div>}
              </div>
            )}

            {!lead.plate && (
              <div className="add-plate">
                <div className="sec-k">Vehicle number</div>
                <div className="small">This lead came from WhatsApp without a vehicle number. Ask the customer and add it here.</div>
                <form className="cc-row" onSubmit={(e) => { e.preventDefault(); if (plateIn.trim()) patch({ plate: plateIn, note: `Vehicle number ${plateIn.toUpperCase()} added.` }); }}>
                  <input className="plate-input" value={plateIn} onChange={(e) => setPlateIn(e.target.value.toUpperCase())} placeholder="UP16AB1234" aria-label="Vehicle number" />
                  <button className="btn primary" disabled={busy || !plateIn.trim()}>Save</button>
                </form>
              </div>
            )}

            <div className="challan-check">
              <div className="sec-k">Check challans</div>
              <div className="cc-row">
                <a className="btn primary" href={PARKPLUS_URL} target="_blank" rel="noopener noreferrer" onClick={copyPlate}>Open Park+ ↗</a>
                <a className="btn" href={PARIVAHAN_URL} target="_blank" rel="noopener noreferrer" onClick={copyPlate} data-niptao-plate={lead.plate} data-niptao-ref={lead.ref}>Open Parivahan e-Challan ↗</a>
                <a className="btn" href={DELHI_COURT_URL} target="_blank" rel="noopener noreferrer" onClick={copyPlate} data-niptao-plate={lead.plate} data-niptao-ref={lead.ref}>Delhi court token ↗</a>
                <button className="btn" onClick={copyPlate}>{copied ? 'Copied ✓' : `Copy ${fmtPlate(lead.plate)}`}</button>
              </div>
              <button type="button" className="btn ghost instr" aria-expanded={showHelp} onClick={() => setShowHelp((v) => !v)}>{showHelp ? '▾ Hide instructions' : '▸ Instructions'}</button>
              {showHelp && (<div className="guide">
                <div className="sec-k">Park+</div>
                <ol>
                  <li>Click <b>Open Park+</b>. The vehicle number is copied for you. Paste it into Park+'s vehicle number box and search.</li>
                  <li>When the challans show, select the whole list with your mouse, from the first challan number down to the last "View details", and copy it (Ctrl+C, or Cmd+C on a Mac).</li>
                  <li>Come back here, click <b>+ Add challan details</b>, paste into the box (Ctrl+V) and press <b>Read challans</b>.</li>
                  <li>Check each row (number, amount, offence, date, place, status), fix anything wrong, choose Source <b>Park+</b>, and press <b>Save</b>.</li>
                  <li>If the vehicle has no challans, press <b>No challans</b> instead.</li>
                </ol>
                <p className="hint"><b>Parivahan:</b> the vehicle number is copied when you open the site. Choose <b>Vehicle Number</b>, paste it, type the captcha and press Get Detail. No OTP is needed. With the <a href={ADDON_ZIP} download>Niptao Lead Filler add-on</a> in Chrome, the number is filled in for you.</p>
              <p className="hint"><b>Delhi court token:</b> for Delhi challans. The vehicle number is copied when you open the site; with the add-on (version 1.7.0 or later) it is filled in for you.</p>
              </div>)}
            </div>

            {askApproval && (
              <div className="ask" ref={approvalRef} role="status">
                <b>Customer contacted.</b> {lead.challans?.length
                  ? 'Tick the challans the customer approved for settlement below.'
                  : 'First add the challans (Open Park+, then + Add challan details), then tick the ones the customer approved.'}
                <button className="btn" onClick={() => onAsked(false)}>Done</button>
              </div>
            )}
            {editing ? (
              <ChallanEditor lead={lead} onCancel={() => setEditing(false)}
                onSave={async (list, source) => { if (await onSaveChallans(lead.ref, list, source)) setEditing(false); }} />
            ) : !lead.challans ? (
              <button className="btn" onClick={() => setEditing(true)}>+ Add challan details</button>
            ) : (
              <div className="challans">
                <div className="ch-head"><div className="sec-k">Challans · {lead.challans.length} · ₹{challanTotal(lead).toLocaleString('en-IN')}
                  {approvedOf(lead).length > 0 && <span className="appr"> · Approved {approvedOf(lead).length} · ₹{approvedTotal(lead).toLocaleString('en-IN')}</span>}</div>
                  <button className="btn ghost edit" onClick={() => setEditing(true)}>Edit</button></div>
                <div className="small">From {lead.challansSource || 'Parivahan'} · {fullDate(lead.challansAt)}{lead.challansBy ? ` · ${lead.challansBy}` : ''}</div>
                {lead.challans.length > 0 && (() => {
                  const n = {};
                  lead.challans.forEach((c) => { const x = challanState(c) || '?'; n[x] = (n[x] || 0) + 1; });
                  const keys = Object.keys(n);
                  if (chSt && !n[chSt]) keys.push(chSt);
                  return (
                    <div className="ch-states" role="group" aria-label="Filter challans by state">
                      {[['', lead.challans.length], ...keys.map((k) => [k, n[k] || 0])].map(([k, c]) => (
                        <button key={k || 'all'} type="button" aria-pressed={chSt === k} onClick={() => setChSt(k)}>
                          {k === '' ? 'All states' : k === '?' ? 'Other' : STATES[k]} <span className="n">{c}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
                {lead.challans.length ? (
                  <div className="ch-list">
                    {lead.challans.map((c, i) => (chSt && (challanState(c) || '?') !== chSt ? null :
                      <div className={'ch' + (c.approved ? ' ok' : '')} key={c.challanNo || i}>
                        <div className="ch-top"><span className="no">{c.challanNo || '—'}</span><b>{c.amount ? `₹${c.amount.toLocaleString('en-IN')}` : ''}</b></div>
                        {c.offence && <div>{c.offence}</div>}
                        <div className="small">{[STATES[challanState(c)], c.date, c.location, c.status].filter(Boolean).join(' · ')}</div>
                        <label className="appr-box"><input type="checkbox" checked={!!c.approved} disabled={busy} onChange={() => toggleApproved(i)} /> Customer approved</label>
                      </div>
                    ))}
                    {chSt && !lead.challans.some((c) => (challanState(c) || '?') === chSt) && <div className="small">No challans from {STATES[chSt] || 'this state'} on this lead.</div>}
                  </div>
                ) : <div className="small">No challans found for this vehicle.</div>}
                {approvedOf(lead).length > 0 && (
                  <div className="payable">
                    <div><div className="k">Approved challans</div><div className="v">{inr(approvedTotal(lead))}</div></div>
                    <label><span className="k">Customer pays</span>
                      <select aria-label="Share of the challan amount the customer pays" value={feeRate(lead)} disabled={busy} onChange={(e) => patch({ feeRate: Number(e.target.value) })}>
                        {FEE_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                      </select>
                    </label>
                    <div className="total"><div className="k">Amount payable</div><div className="v">{inr(payable(lead))}</div></div>
                  </div>
                )}
                {approvedOf(lead).length > 0 && (() => {
                  const w = lead.waApproval, stale = waStale(lead), msg = approvalMessage(lead, lokDates);
                  const link = `https://wa.me/91${lead.phone}?text=${encodeURIComponent(msg)}`;
                  const send = () => patch({ waApproval: 'sent', note: `Sent approval request on WhatsApp: ${approvedOf(lead).length} challan${approvedOf(lead).length === 1 ? '' : 's'}, ${inr(payable(lead))} payable (${feeRate(lead)}%).` });
                  return (
                    <div className={'wa-appr' + (w?.state === 'received' && !stale ? ' done' : '')}>
                      <div className="sec-k">Written approval on WhatsApp</div>
                      {!w ? <div className="small">Send the customer the approved challans and amount, and ask them to reply "I APPROVE".</div>
                        : w.state === 'received' ? <div className="ok-line">✓ Customer approved in writing{stale ? ' (the earlier list)' : ''} · marked by {w.receivedBy} · {fullDate(w.receivedAt)}</div>
                        : <div className="small">Sent by {w.sentBy} · {fullDate(w.sentAt)}. Waiting for the customer to reply "I APPROVE".</div>}
                      {waErr && !lead.waChat?.length && <div className="stale">{waErr}</div>}
                      {waApi && w?.state === 'sent' && !stale && <div className="small">When the customer replies "I APPROVE" on WhatsApp, this is marked automatically.</div>}
                      {stale && <div className="stale">The approved challans or amount changed after the message was sent. Send it again.</div>}
                      <div className="cc-row">
                        {waApi && (
                          <button className={'btn ' + (!w || stale ? 'wa-btn' : '')} disabled={busy} onClick={() => waSend({ text: msg, approval: true })}>
                            {!w ? 'Send on WhatsApp' : 'Send again on WhatsApp'}
                          </button>
                        )}
                        <a className={'btn ' + (!waApi && (!w || stale) ? 'wa-btn' : '')} href={link} target="_blank" rel="noopener noreferrer"
                          onClick={(e) => { if (busy) { e.preventDefault(); return; } send(); }}>
                          {waApi ? 'Open in WhatsApp' : !w ? 'Send on WhatsApp' : 'Send again on WhatsApp'}
                        </a>
                        {w?.state === 'sent' && !stale && (
                          <button className="btn primary" disabled={busy} onClick={() => patch({ waApproval: 'received', note: 'Customer gave written approval on WhatsApp.' })}>Customer replied "I APPROVE"</button>
                        )}
                      </div>
                      <details className="guide"><summary>See the message</summary><pre className="wa-msg">{msg}</pre></details>
                    </div>
                  );
                })()}
                {approvedIn && (
                  <div className={'wa-appr pay-box' + (lead.paymentSent ? ' done' : '')}>
                    <div className="sec-k">Payment details on WhatsApp</div>
                    {!pay ? <div className="small">Loading…</div>
                      : pay.error === 'payment_not_set' ? <div className="stale">{isAdminUser ? 'Add your UPI ID and QR in Settings → Payment details first.' : 'Ask an admin to add the UPI ID and QR in Settings → Payment details.'}</div>
                      : pay.error ? <div className="stale">Could not load the payment details. Close and reopen this lead.</div>
                      : (<>
                        {lead.paymentSent
                          ? <div className="ok-line">✓ Sent by {lead.paymentSent.by} · {fullDate(lead.paymentSent.at)} · {inr(lead.paymentSent.amount)}</div>
                          : <div className="small">Send the UPI ID and QR for {inr(pay.amount)}, with the 100% refund note.</div>}
                        {lead.paymentSent && lead.paymentSent.amount !== pay.amount && <div className="stale">The amount changed to {inr(pay.amount)} after it was sent. Send it again.</div>}
                        <div className="cc-row">
                          <a className={'btn ' + (!lead.paymentSent ? 'wa-btn' : '')} href={`https://wa.me/91${lead.phone}?text=${encodeURIComponent(pay.text)}`} target="_blank" rel="noopener noreferrer"
                            onClick={(e) => { if (busy) { e.preventDefault(); return; } patch({ paymentSent: true, note: `Sent payment details on WhatsApp: ${inr(pay.amount)} to ${pay.upiId}.` }); }}>
                            {lead.paymentSent ? 'Send again on WhatsApp' : 'Send payment details'}
                          </a>
                          {pay.qr && <button type="button" className="btn" onClick={copyQr}>{qrCopied ? 'QR copied ✓' : 'Copy QR'}</button>}
                          {pay.qr && <a className="btn" href={pay.qr} download={`niptao-upi-qr-${lead.ref}.png`}>Download QR</a>}
                        </div>
                        {pay.qr && <div className="small">After sending the message, paste the QR in the same WhatsApp chat (Ctrl+V) and press Enter.</div>}
                        <details className="guide"><summary>See the message</summary><pre className="wa-msg">{pay.text}</pre></details>
                      </>)}
                  </div>
                )}
              </div>
            )}

            <Docs lead={lead} types={docTypes} onUpload={onUploadDoc} onOpenDoc={onOpenDoc} onRemoveDoc={onRemoveDoc} onPatch={onPatch} onDocLink={onDocLink} />
          </div>
          <div className="col-side">
            <div className="actions">
              <a className="call" href={`tel:+91${lead.phone}`}>Call</a>
              <a className="wa" href={`https://wa.me/91${lead.phone}?text=${waText}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
            </div>

            <OwnerFields lead={lead} onPatch={onPatch} />
            <div className="details">
              <div className="kv"><div className="k">Mobile</div><div className="v">+91 {fmtPhone(lead.phone)}</div></div>
              <div className="kv"><div className="k">City</div><div className="v">{CITY[lead.city] || lead.city}</div></div>
              <div className="kv"><div className="k">Language</div><div className="v">{lead.lang === 'hi' ? 'Hindi' : 'English'}</div></div>
              {lead.promoCode && <div className="kv"><div className="k">Promo code</div><div className="v" style={{ fontFamily: 'var(--mono)' }}>{lead.promoCode}</div></div>}
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

            {(waApi || lead.waChat?.length > 0) && (
              <div className="wa-chat">
                <div className="ch-head"><div className="sec-k">WhatsApp chat{lead.source === 'WhatsApp' ? ' · lead came from WhatsApp' : ''}</div>
                  {lead.waChat?.length > 0 && <button type="button" className="btn ghost edit" onClick={() => setChatBig((v) => !v)}>{chatBig ? 'Collapse' : 'Expand'}</button>}</div>
                {lead.waChat?.length ? (
                  <div className={'wa-msgs' + (chatBig ? ' big' : '')} ref={chatRef}>
                    {lead.waChat.slice(-50).map((m, i) => (
                      <div key={m.id || i} className={'wa-bub ' + m.dir}>
                        <div className="t">{m.text}</div>
                        <div className="m">{m.dir === 'out' ? `${m.by} · ` : ''}{fullDate(m.at)}{m.dir === 'out' && m.status ? ` · ${m.status === 'read' ? '✓✓ read' : m.status === 'delivered' ? '✓✓ delivered' : m.status === 'failed' ? `failed${m.error ? `: ${m.error}` : ''}` : '✓ sent'}` : ''}</div>
                      </div>
                    ))}
                  </div>
                ) : <div className="small">No WhatsApp messages with this customer yet.</div>}
                {waApi && (waOpen ? (
                  <form className="wa-reply" onSubmit={async (e) => { e.preventDefault(); if (waDraft.trim() && await waSend({ text: waDraft })) setWaDraft(''); }}>
                    <textarea rows={2} value={waDraft} onChange={(e) => setWaDraft(e.target.value)} placeholder="Reply on WhatsApp" aria-label="WhatsApp reply" />
                    <button className="btn wa-btn" disabled={busy || !waDraft.trim()}>Send</button>
                  </form>
                ) : <div className="small">You can reply here for 24 hours after the customer's last message. Until they write again, use "Open in WhatsApp" or the approval request below.</div>)}
                {waErr && <div className="stale">{waErr}</div>}
              </div>
            )}

          </div>
          {isSuper && (
            <div className="danger">
              <button className="btn ghost" disabled={busy} onClick={() => {
                if (window.confirm(`Delete the lead for ${lead.name} (${fmtPlate(lead.plate)}, ${lead.ref})?\n\nThis removes it and its challans and notes for good. It can't be undone.`)) onDelete(lead.ref);
              }}>Delete this lead</button>
              <span className="small">Only you (the main admin) see this.</span>
            </div>
          )}
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
  invalid_upi: 'Check the UPI ID. It looks like name@bank, for example niptao@okaxis.',
  invalid_qr: 'The QR image could not be used. Upload a PNG or JPG photo of the QR code.',
  invalid_doc_type: 'Every document needs a name. Fill it in or remove the empty row.',
  duplicate_doc_type: 'Two documents have the same name. Give each one a different name.',
  invalid_phone: 'The calling number must be a 10-digit Indian mobile number.',
  invalid_date: 'One of the dates is not filled in. Pick a date or remove that row.',
  invalid_code: 'A promo code is empty. Type a code or remove that row.',
  duplicate_code: 'Two promo codes are the same. Each code must be different.',
  offer_code_missing: 'The offer uses a code that is not in the promo code list.',
};

const DEFAULT_CODES = [{ code: 'FLAT50', title: 'Flat 50% off your challans', pays: 50, show: true }];
// datetime-local works in the browser's local time; settings keep an ISO time.
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const formFrom = (s) => ({
  whatsapp: s.whatsapp || '', phone: s.phone || '', autoAssign: !!s.autoAssign, lokAdalatDates: s.lokAdalatDates || [],
  promoCodes: Array.isArray(s.promoCodes) ? s.promoCodes : DEFAULT_CODES,
  offer: s.offer ? { ...s.offer, endsAt: toLocalInput(s.offer.endsAt) } : (Array.isArray(s.promoCodes) ? { on: false, code: '', endsAt: '' } : { on: true, code: 'FLAT50', endsAt: '' }),
  payment: { upiId: s.payment?.upiId || '', payeeName: s.payment?.payeeName || '', qr: s.payment?.qr || '' },
  docTypes: Array.isArray(s.docTypes) ? s.docTypes : [],
});

// Shrinks an uploaded QR photo so it stays small enough to store with the settings.
function readQr(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 800 / Math.max(img.width, img.height));
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      let out = c.toDataURL('image/png');
      if (out.length > 600_000) out = c.toDataURL('image/jpeg', 0.85);
      resolve(out);
    };
    img.onerror = () => reject(new Error('bad_image'));
    img.src = URL.createObjectURL(file);
  });
}

function Settings({ auth, me, staff, reloadStaff, onSaved, signOut }) {
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call('/api/admin/settings', auth)
      .then((s) => setForm(formFrom(s)))
      .catch((e) => (e.status === 401 ? signOut() : setMsg({ ok: false, text: 'Could not load settings. Refresh the page to try again.' })));
  }, [auth, signOut]);

  if (!form) return <div className="panel"><div className="empty">{msg?.text || 'Loading settings…'}</div></div>;

  const setDate = (id, patch) => setForm({ ...form, lokAdalatDates: form.lokAdalatDates.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const addDate = () => setForm({ ...form, lokAdalatDates: [...form.lokAdalatDates, { id: newId(), date: '', time: '10:00', city: 'noida', note: '' }] });
  const setCode = (i, patch) => setForm({ ...form, promoCodes: form.promoCodes.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const removeDate = (id) => setForm({ ...form, lokAdalatDates: form.lokAdalatDates.filter((d) => d.id !== id) });

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const body = { ...form, offer: { ...form.offer, endsAt: form.offer.endsAt ? new Date(form.offer.endsAt).toISOString() : '' } };
      const saved = await call('/api/admin/settings', auth, { method: 'PUT', body: JSON.stringify(body) });
      setForm(formFrom(saved));
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
        <p className="hint">The website counts down to the soonest upcoming date (any city) and lists the next few below it. Past dates are hidden from visitors automatically.</p>
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
            </div>
          ))}
        </div>
        <button type="button" className="btn" onClick={addDate}>+ Add a date</button>
      </section>

      <section className="panel pad">
        <h2>Promo codes</h2>
        <p className="hint">Customers can type these in the form on the website. Codes marked "Show on website" appear as buttons next to the code box. "Customer pays" sets the starting percentage on the lead.</p>
        <div className="dates">
          {form.promoCodes.map((c, i) => (
            <div className="date-row promo-row-a" key={i}>
              <label className="field">Code<input value={c.code} placeholder="e.g. FLAT50" style={{ textTransform: 'uppercase', fontFamily: 'var(--mono)' }}
                onChange={(e) => setCode(i, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) })} /></label>
              <label className="field">Customer pays
                <select value={c.pays} onChange={(e) => setCode(i, { pays: Number(e.target.value) })}>{FEE_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</select>
              </label>
              <label className="field note-f">Text shown with it<input value={c.title} maxLength={80} placeholder="e.g. Flat 50% off your challans" onChange={(e) => setCode(i, { title: e.target.value })} /></label>
              <label className="toggle small-t"><input type="checkbox" checked={c.show !== false} onChange={(e) => setCode(i, { show: e.target.checked })} /> Show on website</label>
              <button type="button" className="btn ghost" onClick={() => setForm({ ...form, promoCodes: form.promoCodes.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => setForm({ ...form, promoCodes: [...form.promoCodes, { code: '', title: '', pays: 50, show: true }] })}>+ Add a code</button>

        <h2 style={{ marginTop: 22 }}>Exclusive offer banner</h2>
        <label className="toggle">
          <input id="set-offer" type="checkbox" checked={form.offer.on} onChange={(e) => setForm({ ...form, offer: { ...form.offer, on: e.target.checked, code: form.offer.code || form.promoCodes[0]?.code || '' } })} />
          <span><b>Show the offer at the top of the website, with a countdown</b><br />
            <span className="hint">The timer counts down to the end time you set. Leave it empty to end the offer at the next Lok Adalat date. When the time is up the banner hides by itself.</span></span>
        </label>
        {form.offer.on && (
          <div className="grid2" style={{ marginTop: 12 }}>
            <label className="field">Offer code
              <select value={form.offer.code} onChange={(e) => setForm({ ...form, offer: { ...form.offer, code: e.target.value } })}>
                {form.promoCodes.filter((c) => c.code).map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </label>
            <label className="field">Offer ends <span className="opt">(optional)</span>
              <input type="datetime-local" value={form.offer.endsAt} onChange={(e) => setForm({ ...form, offer: { ...form.offer, endsAt: e.target.value } })} />
            </label>
          </div>
        )}
      </section>

      <section className="panel pad">
        <h2>Payment details</h2>
        <p className="hint" style={{ marginTop: 0 }}>Sent to the customer on WhatsApp after they approve, with the amount, UPI ID, QR and the 100% refund note.</p>
        <div className="pay-grid">
          <label className="field"><span>UPI ID</span>
            <input id="set-upi" value={form.payment.upiId} placeholder="niptao@okaxis" autoCapitalize="none" spellCheck="false"
              onChange={(e) => setForm({ ...form, payment: { ...form.payment, upiId: e.target.value.trim() } })} /></label>
          <label className="field"><span>Name shown for payment</span>
            <input id="set-payee" value={form.payment.payeeName} placeholder="Niptao"
              onChange={(e) => setForm({ ...form, payment: { ...form.payment, payeeName: e.target.value } })} /></label>
        </div>
        <div className="qr-row">
          {form.payment.qr ? <img className="qr-prev" src={form.payment.qr} alt="Payment QR code" /> : <div className="qr-prev empty">No QR yet</div>}
          <div>
            <label className="btn">{form.payment.qr ? 'Change QR image' : 'Upload QR image'}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                try { setForm((x) => ({ ...x, payment: { ...x.payment, qr: '' } })); const qr = await readQr(f); setForm((x) => ({ ...x, payment: { ...x.payment, qr } })); }
                catch { setMsg({ ok: false, text: ERRORS.invalid_qr }); }
              }} />
            </label>
            {form.payment.qr && <button type="button" className="btn ghost" onClick={() => setForm({ ...form, payment: { ...form.payment, qr: '' } })}>Remove</button>}
            <div className="hint">A screenshot or photo of your UPI QR code. Remember to press Save changes.</div>
          </div>
        </div>
      </section>

      <section className="panel pad">
        <h2>Documents</h2>
        <p className="hint" style={{ marginTop: 0 }}>The documents your team collects from each customer. Each one gets its own upload button on every lead. When every <b>needed</b> document is uploaded, the lead moves to <b>Documents received</b> by itself.</p>
        <div className="doc-set">
          {form.docTypes.map((t, i) => (
            <div className="doc-set-row" key={t.id || i}>
              <input value={t.name} placeholder="e.g. RC (registration certificate)" aria-label="Document name" maxLength={60}
                onChange={(e) => setForm({ ...form, docTypes: form.docTypes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <label className="toggle-sm"><input type="checkbox" checked={t.required !== false}
                onChange={(e) => setForm({ ...form, docTypes: form.docTypes.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} /> Needed</label>
              <button type="button" className="btn ghost" aria-label={`Remove ${t.name || 'document'}`}
                onClick={() => setForm({ ...form, docTypes: form.docTypes.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
        </div>
        {form.docTypes.length === 0 && <div className="empty small-empty">No documents yet. Add the ones you collect, like RC, driving licence and Aadhaar.</div>}
        <button type="button" className="btn" disabled={form.docTypes.length >= 20}
          onClick={() => setForm({ ...form, docTypes: [...form.docTypes, { id: '', name: '', required: true }] })}>+ Add document</button>
        <div className="hint">Untick <b>Needed</b> for optional documents. Removing a document here keeps files already uploaded on leads. Remember to press Save changes.</div>
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
    <Addon />
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

function Addon() {
  return (
    <section className="panel pad" id="addon">
      <h2>Chrome add-on: Niptao Lead Filler</h2>
      <p className="hint">Fills the vehicle number on Parivahan when you click <b>Open Parivahan e-Challan</b> on a lead, then saves the challans it finds back to that lead. You always type the captcha and OTP yourself. Works in Chrome or Edge on a computer, not on phones. Install it on every computer your team uses.</p>
      <div><a className="btn primary dl" href={ADDON_ZIP} download>Download add-on (version {ADDON_VERSION})</a></div>
      <div className="steps-box">
        <div className="sec-k">Install (once per computer)</div>
        <ol>
          <li>Unzip the downloaded file. You get a folder called <code>niptao-lead-filler</code>. Keep it somewhere safe, like Documents. Chrome needs it to stay there.</li>
          <li>In Chrome's address bar type <code>chrome://extensions</code> and press Enter (in Edge: <code>edge://extensions</code>).</li>
          <li>Turn on <b>Developer mode</b> (switch at the top right).</li>
          <li>Click <b>Load unpacked</b> and choose the <code>niptao-lead-filler</code> folder.</li>
          <li>Click the puzzle-piece icon next to the address bar and pin <b>Niptao Lead Filler</b>. Then sign in to this admin panel in the same Chrome. The add-on uses that sign-in, so there's nothing else to log in to.</li>
        </ol>
        <div className="sec-k">Use it</div>
        <ol>
          <li>Open a lead here and click <b>Open Parivahan e-Challan</b>. The vehicle number is filled in for you.</li>
          <li>Type the captcha and press Get Detail. The challans are saved to the lead automatically (a small box says "Saved N challans") and show up here within 15 seconds.</li>
          <li><b>Delhi court token:</b> open a lead and click <b>Delhi court token</b>. The vehicle number is filled in for you. Type the captcha and OTP yourself.</li>
          <li>If a box isn't filled, click the add-on icon and press <b>Fill this page</b>, or right-click the box and pick <b>Niptao: fill vehicle number</b>.</li>
          <li>If the Parivahan results show the owner's name, it is saved on the lead too. The lead then says whether it matches the name the customer gave, and the list shows a red <b>⚠ name</b> tag when it doesn't.</li>
        </ol>
        <div className="sec-k">WhatsApp Web</div>
        <ol>
          <li>Open this admin panel once and sign in, so the add-on knows who you are.</li>
          <li>On <b>web.whatsapp.com</b>, open a customer's chat. A <b>Niptao</b> box appears at the top right.</li>
          <li>Press <b>Save chat to Niptao</b> to save the messages on screen to the customer's lead (a new customer becomes a lead assigned to you), or <b>Add as lead</b> to only create the lead. If the number box is empty, type it once (or click the chat name at the top so WhatsApp shows it); it's remembered.</li>
          <li>When the customer replies <b>I APPROVE</b> in the open chat, it is saved once by itself and the lead is marked approved. Nothing is ever sent on WhatsApp by the add-on.</li>
          <li>After the customer approves, the WhatsApp box puts the payment message in the chat and copies the QR. Press <b>Enter</b>, then <b>Ctrl+V</b> and <b>Enter</b>. (Set the UPI ID and QR first in Payment details above.)</li>
        </ol>
        <div className="sec-k">Update to a new version</div>
        <ol>
          <li>Download again, unzip over the old <code>niptao-lead-filler</code> folder (replace the files).</li>
          <li>Open <code>chrome://extensions</code> and press the round reload arrow on the add-on's card.</li>
          <li>Reload any open admin panel and Parivahan tabs.</li>
        </ol>
        <p className="hint" style={{ margin: 0 }}>Chrome may show a note about developer-mode extensions when it starts. That's normal for add-ons installed this way.</p>
      </div>
    </section>
  );
}

function toCsv(leads) {
  const cols = [['Reference', 'ref'], ['Received', (l) => fullDate(l.createdAt)], ['Name', 'name'], ['Vehicle', (l) => fmtPlate(l.plate)],
    ['Mobile', 'phone'], ['Same request as', (l) => (l.groupRef && l.groupRef !== l.ref ? l.groupRef : '')], ['City', (l) => CITY[l.city] || l.city], ['Status', 'status'], ['Assigned to', 'agent'],
    ['Challans', (l) => (l.challans ? l.challans.length : '')], ['Challan total (₹)', (l) => (l.challans ? challanTotal(l) : '')],
    ['Challan states', (l) => leadStates(l).map((st) => STATES[st]).join(', ')], ['Approved challans', (l) => (l.challans ? approvedOf(l).map((c) => c.challanNo).join(' ') : '')], ['Approved total (₹)', (l) => (l.challans ? approvedTotal(l) : '')],
    ['Customer pays (%)', (l) => (approvedOf(l).length ? feeRate(l) : '')], ['Amount payable (₹)', (l) => (approvedOf(l).length ? payable(l) : '')],
    ['WhatsApp approval', (l) => (!l.waApproval ? '' : waStale(l) ? 'Changed after sending' : l.waApproval.state === 'received' ? `Approved ${fullDate(l.waApproval.receivedAt)}` : `Sent ${fullDate(l.waApproval.sentAt)}`)],
    ['Payment details sent', (l) => (l.paymentSent ? fullDate(l.paymentSent.at) : '')],
    ['RC owner (Parivahan)', (l) => l.rcOwner?.name || ''],
    ['Name on RC', (l) => (!l.rcName ? '' : l.rcName.same ? `Same as lead (${l.name})` : l.rcName.name)],
    ['Registered mobile', (l) => (!l.rcMobile ? '' : l.rcMobile.same ? l.phone : l.rcMobile.phone)],
    ['Documents uploaded', (l) => [...new Set((l.docs || []).map((d) => d.typeName))].join(', ')],
    ['RC owner name check', (l) => (!l.rcOwner ? '' : l.rcOwner.match === 'match' ? 'Matches' : l.rcOwner.match === 'partial' ? 'Partly matches' : l.rcOwner.match === 'mismatch' ? "Doesn't match" : 'Not compared')],
    ['Latest note', (l) => l.notes?.[0]?.text || '']];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.map((c) => esc(c[0])).join(','), ...leads.map((l) => cols.map(([, f]) => esc(typeof f === 'function' ? f(l) : l[f])).join(','))].join('\n');
}

export default function Admin() {
  const [auth, setAuth] = useState(readSaved);
  const [leads, setLeads] = useState(null);
  const [storage, setStorage] = useState('');
  const [statuses, setStatuses] = useState(Object.keys(STATUS_COLORS));
  const [waApi, setWaApi] = useState(false);
  const [tab, setTab] = useState('All');
  const [q, setQ] = useState('');
  const [st, setSt] = useState('');
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
      if (Array.isArray(r.docTypes)) setDocTypes(r.docTypes);
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
    call('/api/admin/status').then((s) => { if (s.statuses) setStatuses(s.statuses); setWaApi(!!s.whatsappApi); }).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const iv = setInterval(load, POLL_MS);
    return () => clearInterval(iv);
  }, [load]);

  const getPayment = async (ref) => {
    try { return await call(`/api/admin/leads/${encodeURIComponent(ref)}/payment`, auth); }
    catch (e) { if (e.status === 401) signOut(); return { error: e.message }; }
  };
  // Returns '' when sent, else the error code.
  const onWaSend = async (ref, body) => {
    try {
      const { lead } = await call(`/api/admin/leads/${encodeURIComponent(ref)}/whatsapp`, auth, { method: 'POST', body: JSON.stringify(body) });
      setLeads((ls) => ls.map((l) => (l.ref === ref ? lead : l)));
      return '';
    } catch (e) {
      if (e.status === 401) signOut();
      return e.message;
    }
  };
  // Documents: returns '' when done, else the error code.
  const [docTypes, setDocTypes] = useState([]);
  const docUrl = (ref, id = '') => `/api/admin/leads/${encodeURIComponent(ref)}/docs${id ? `/${encodeURIComponent(id)}` : ''}`;
  const onUploadDoc = async (ref, type, file) => {
    try {
      const res = await fetch(`${docUrl(ref)}?type=${encodeURIComponent(type)}&name=${encodeURIComponent(file.name || '')}`, {
        method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream', Authorization: `Bearer ${auth.token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { signOut(); return 'signed_out'; }
      if (!res.ok) return data.error || (res.status === 413 ? 'file_too_large' : 'error');
      setLeads((ls) => ls.map((l) => (l.ref === ref ? data.lead : l)));
      return '';
    } catch { return 'error'; }
  };
  const onDocLink = async (ref, off) => {
    try {
      const { lead } = await call(`/api/admin/leads/${encodeURIComponent(ref)}/doclink`, auth, { method: 'POST', body: JSON.stringify({ off }) });
      setLeads((ls) => ls.map((l) => (l.ref === ref ? lead : l)));
      return '';
    } catch (e) { if (e.status === 401) signOut(); return e.message; }
  };
  const onRemoveDoc = async (ref, id) => {
    try {
      const { lead } = await call(docUrl(ref, id), auth, { method: 'DELETE' });
      setLeads((ls) => ls.map((l) => (l.ref === ref ? lead : l)));
      return '';
    } catch (e) { if (e.status === 401) signOut(); return e.message; }
  };
  // Files need the sign-in, so they are fetched here and opened from memory in a new tab.
  const onOpenDoc = async (ref, d) => {
    const w = window.open('', '_blank');
    try {
      const res = await fetch(docUrl(ref, d.id), { headers: { Authorization: `Bearer ${auth.token}` } });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      if (w) w.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { w?.close(); setErr('That file could not be opened. Try again.'); }
  };
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

  // After "Contacted", open the lead and ask which challans the customer approved.
  const [ask, setAsk] = useState(null);
  const changeStatus = async (ref, status) => {
    await onPatch(ref, { status });
    if (status === 'Contacted') { setSel(ref); setAsk(ref); }
  };

  const onDelete = async (ref) => {
    try {
      await call(`/api/admin/leads/${encodeURIComponent(ref)}`, auth, { method: 'DELETE' });
      setLeads((ls) => ls.filter((l) => l.ref !== ref));
      setSel(null); setAsk(null);
    } catch (e) {
      if (e.status === 401) signOut(); else setErr('The lead was not deleted. Try again.');
    }
  };

  const onSaveChallans = async (ref, challans, source) => {
    try {
      const { lead } = await call(`/api/admin/leads/${encodeURIComponent(ref)}/challans`, auth, { method: 'POST', body: JSON.stringify({ challans, source }) });
      setLeads((ls) => ls.map((l) => (l.ref === ref ? lead : l)));
      return true;
    } catch (e) {
      if (e.status === 401) signOut();
      else setErr(e.message === 'not_your_lead' ? 'That lead is no longer assigned to you.' : 'Challans were not saved. Try again.');
      return false;
    }
  };

  const filtered = useMemo(() => {
    const s = q.toLowerCase().replace(/\s/g, '');
    return (leads || []).filter((l) => (!s || (l.name + l.plate + l.phone + l.ref).toLowerCase().replace(/\s/g, '').includes(s))
      && (!st || leadStates(l).includes(st)));
  }, [leads, q, st]);
  // States that appear in the leads, most leads first, for the State filter.
  const stateOpts = useMemo(() => {
    const n = {};
    (leads || []).forEach((l) => leadStates(l).forEach((x) => { n[x] = (n[x] || 0) + 1; }));
    if (st && !n[st]) n[st] = 0;
    return Object.entries(n).sort((a, b) => b[1] - a[1] || STATES[a[0]].localeCompare(STATES[b[0]]));
  }, [leads, st]);
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
            <Settings auth={auth} me={me} staff={staff} reloadStaff={loadStaff} signOut={signOut} onSaved={(s) => { setSite({ ...s, lokAdalatDates: s.lokAdalatDates.filter((d) => d.date >= todayIST()) }); if (Array.isArray(s.docTypes)) setDocTypes(s.docTypes); }} />
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
            <button className="btn" onClick={() => { setTab('All'); setQ(''); setSt(''); setFresh([]); }}>Got it</button>
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
            <select className="state-sel" aria-label="Filter by challan state" value={st} onChange={(e) => setSt(e.target.value)}>
              <option value="">All states</option>
              {stateOpts.map(([x, n]) => <option key={x} value={x}>{STATES[x]} ({n})</option>)}
            </select>
            <button className="btn" onClick={load}>Refresh</button>
            <button className="btn" onClick={exportCsv} disabled={!rows.length}>Download CSV</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Lead</th><th>Vehicle</th><th>City</th><th>Assigned to</th><th>Status</th><th>Received</th></tr></thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.ref} className={(sel === l.ref ? 'sel' : '') + (fresh.includes(l.ref) ? ' fresh' : '')} onClick={() => { setSel(l.ref); setFresh((f) => f.filter((x) => x !== l.ref)); }}>
                    <td><div className="name">{l.name}{l.groupRef && <span className="multi" title="This customer sent several vehicles together">{l.vehicles} vehicles</span>}{l.source === 'WhatsApp' && <span className="multi wa">WhatsApp</span>}{l.waUnread > 0 && <span className="multi unread">💬 {l.waUnread} new</span>}{l.docsNew > 0 && <span className="multi unread docs-new" title="The customer uploaded documents">📄 {l.docsNew} new</span>}{l.rcOwner?.match === 'mismatch' && <span className="multi warn" title={`RC owner on Parivahan: ${l.rcOwner.name}`}>⚠ name</span>}</div><div className="small">{l.ref} · {fmtPhone(l.phone)}{l.challans ? ` · ${l.challans.length} challan${l.challans.length === 1 ? '' : 's'} ₹${challanTotal(l).toLocaleString('en-IN')}` : ''}{st && l.challans?.length && leadStates(l).length > 1 ? ` (${l.challans.filter((c) => challanState(c) === st).length} in ${STATES[st]})` : ''}{approvedOf(l).length ? ` · payable ${inr(payable(l))} (${feeRate(l)}%)` : ''}{l.waApproval ? (l.waApproval.state === 'received' && !waStale(l) ? ' · ✓ approved on WhatsApp' : ' · WhatsApp sent') : ''}{l.paymentSent ? ' · payment details sent' : ''}{l.docs?.length ? ` · docs ${docsHave(l, docTypes)}` : ''}</div></td>
                    <td>{l.plate ? <span className="plate">{fmtPlate(l.plate)}</span> : <span className="small">Not given yet</span>}</td>
                    <td>{CITY[l.city] || l.city}</td>
                    <td className={l.agent ? '' : 'unassigned'}>{l.agent || 'Unassigned'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select className="status-sel" aria-label={`Status of ${l.name}`} value={l.status}
                        style={{ background: (STATUS_COLORS[l.status] || STATUS_COLORS.New)[0], color: (STATUS_COLORS[l.status] || STATUS_COLORS.New)[1] }}
                        onChange={(e) => changeStatus(l.ref, e.target.value)}>
                        {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td title={fullDate(l.createdAt)}>{ago(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {leads && !rows.length && <div className="empty">{all.length ? (st ? `No leads with challans in ${STATES[st]}${q ? ' match this search' : ''}.` : 'No leads match this search.') : isAdmin ? 'No leads yet. They appear here as soon as someone submits the form on the website.' : 'No leads are assigned to you yet.'}</div>}
            {!leads && !err && <div className="empty">Loading leads…</div>}
          </div>
          {leads && <div className="foot">Showing {rows.length} of {all.length} leads · checks for new leads every 15 seconds</div>}
        </div>
        </>)}
      </main>
      {selLead && <Drawer lead={selLead} statuses={statuses} isAdmin={isAdmin} isSuper={me.uid === 'super'} staff={staff} onDelete={onDelete} onClose={() => { setSel(null); setAsk(null); }} onPatch={onPatch} onSaveChallans={onSaveChallans} listState={st} lokDates={site?.lokAdalatDates}
        siblings={selLead.groupRef ? all.filter((x) => x.groupRef === selLead.groupRef && x.ref !== selLead.ref) : []} onOpen={(r) => { setSel(r); setAsk(null); }} waApi={waApi} onWaSend={onWaSend} getPayment={getPayment} isAdminUser={isAdmin}
        docTypes={docTypes} onUploadDoc={onUploadDoc} onOpenDoc={onOpenDoc} onRemoveDoc={onRemoveDoc} onDocLink={onDocLink}
        askApproval={ask === selLead.ref} onAsked={(on) => setAsk(on ? selLead.ref : null)} />}
    </>
  );
}
