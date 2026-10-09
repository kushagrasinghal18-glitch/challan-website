import { useMemo, useState } from 'react';

// Month view of court tokens, worked out from the leads already loaded (staff only get their own leads).
// Clicking a day lists that day's tokens with buttons to open the token file or the lead.

const todayIST = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, '0');
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmtPlate = (p) => (p || '').replace(/^([A-Z]{2}\d{1,2})([A-Z]{0,3})(\d{4})$/, (m, a, b, c) => [a, b, c].filter(Boolean).join(' '));
const longDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function Calendar({ leads, onOpenToken, onOpenLead }) {
  const today = todayIST();
  const [month, setMonth] = useState(today.slice(0, 7)); // YYYY-MM
  const [day, setDay] = useState(today);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const l of leads || []) {
      for (const t of l.tokens || []) {
        if (!m.has(t.date)) m.set(t.date, []);
        m.get(t.date).push({ lead: l, token: t });
      }
    }
    for (const list of m.values()) list.sort((a, b) => String(a.token.number).localeCompare(String(b.token.number), 'en', { numeric: true }) || a.lead.name.localeCompare(b.lead.name));
    return m;
  }, [leads]);

  if (!leads) return <div className="panel"><div className="empty">Loading…</div></div>;

  const [y, mo] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; // blanks before the 1st (weeks start Monday)
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const shift = (n) => { const d = new Date(Date.UTC(y, mo - 1 + n, 1)); setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`); };
  const monthName = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const inMonth = cells.reduce((n, d) => n + (d ? (byDay.get(d) || []).length : 0), 0);
  const list = byDay.get(day) || [];
  const upcoming = [...byDay.keys()].filter((d) => d >= today).sort().slice(0, 5);

  return (
    <div className="cal-wrap">
      <section className="panel pad cal">
        <div className="cal-head">
          <button className="btn ghost" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <h2>{monthName}</h2>
          <button className="btn ghost" onClick={() => shift(1)} aria-label="Next month">›</button>
          <button className="btn" onClick={() => { setMonth(today.slice(0, 7)); setDay(today); }}>Today</button>
          <span className="small cal-total">{inMonth} token{inMonth === 1 ? '' : 's'} this month</span>
        </div>
        <div className="cal-grid" role="grid">
          {WEEK.map((w) => <div key={w} className="cal-wd">{w}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={`b${i}`} className="cal-cell blank" />;
            const n = (byDay.get(d) || []).length;
            return (
              <button key={d} className={'cal-cell' + (n ? ' has' : '') + (d === today ? ' today' : '') + (d === day ? ' sel' : '')}
                aria-pressed={d === day} aria-label={`${longDay(d)}: ${n} token${n === 1 ? '' : 's'}`} onClick={() => setDay(d)}>
                <span className="cal-num">{Number(d.slice(8))}</span>
                {n > 0 && <span className="cal-count">{n}<span className="w"> token{n === 1 ? '' : 's'}</span></span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel pad cal-day">
        <h2>{longDay(day)}</h2>
        {!list.length ? (
          <div className="small">No tokens on this day.{upcoming.length > 0 && <> Next tokens: {upcoming.map((d, i) => (
            <span key={d}>{i ? ', ' : ''}<button className="linkish" onClick={() => { setDay(d); setMonth(d.slice(0, 7)); }}>{d.slice(8)}/{d.slice(5, 7)}</button></span>
          ))}</>}</div>
        ) : (
          <ul className="cal-list">
            {list.map(({ lead: l, token: t }) => (
              <li key={t.id}>
                <div className="cal-who">
                  <b>{l.name}</b> <span className="plate">{fmtPlate(l.plate)}</span>
                  <div className="small">{l.ref}{t.number ? ` · Token ${t.number}` : ''} · {l.agent || 'Unassigned'} · {l.status}</div>
                </div>
                <div className="cal-btns">
                  <button className="btn primary" onClick={() => onOpenToken(l.ref, t)}>Open token ↗</button>
                  <button className="btn" onClick={() => onOpenLead(l.ref)}>Open lead</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
