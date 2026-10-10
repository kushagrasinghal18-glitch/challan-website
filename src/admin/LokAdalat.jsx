import { useMemo, useState } from 'react';
import { lokPlan, lokLong, challanStateCode } from '../../shared/lok.js';

// Analytics card: which challans go to the next Lok Adalat, by state, and the leads to handle on each date.
// Only open leads count (not Settled or Lost). A lead's approved challans count if it has any, else all of
// its challans (marked "not approved yet"). Each challan goes to the next date for the state that issued
// it, the same rule as the approval and payment messages (shared/lok.js).

const STATE = { DL: 'Delhi', UP: 'Uttar Pradesh', HR: 'Haryana' };
const CITY = { noida: 'Noida / Gr. Noida', ghaziabad: 'Ghaziabad', delhi: 'Delhi', gurugram: 'Gurugram' };
const fmtPlate = (p) => (p || '').replace(/^([A-Z]{2}\d{1,2})([A-Z]{0,3})(\d{4})$/, (m, a, b, c) => [a, b, c].filter(Boolean).join(' '));

export default function LokAdalat({ leads, dates, inr }) {
  const [pick, setPick] = useState('');

  const d = useMemo(() => {
    const groups = new Map(); // one per Lok Adalat entry (state + date)
    let noChallans = 0, noDate = 0;
    for (const l of leads || []) {
      if (['Settled', 'Lost'].includes(l.status)) continue;
      const all = l.challans || [];
      if (!all.length) { noChallans++; continue; }
      const anyOk = all.some((c) => c.approved);
      for (const c of anyOk ? all.filter((x) => x.approved) : all) {
        const p = lokPlan(l, [c], dates)[0];
        if (!p) { noDate++; continue; }
        const key = `${p.lok.date}|${p.lok.time}|${p.lok.city}`;
        const g = groups.get(key) || { key, lok: p.lok, state: p.state, label: STATE[p.state] || p.label, leads: new Map(), challans: 0, approved: 0, amount: 0 };
        const token = (l.tokens || []).find((t) => (t.challans || []).includes(c.challanNo));
        const row = g.leads.get(l.ref) || { lead: l, challans: [] };
        row.challans.push({ ...c, approved: !!c.approved, token: token?.number || '', st: challanStateCode(c) });
        g.leads.set(l.ref, row);
        g.challans++;
        if (c.approved) g.approved++;
        g.amount += c.amount || 0;
        groups.set(key, g);
      }
    }
    const list = [...groups.values()].sort((a, b) => (a.lok.date + a.lok.time).localeCompare(b.lok.date + b.lok.time));
    return { list, days: [...new Set(list.map((g) => g.lok.date))], noChallans, noDate };
  }, [leads, dates]);

  const day = d.days.includes(pick) ? pick : d.days[0];
  const onDay = d.list.filter((g) => g.lok.date === day);
  const rows = onDay.flatMap((g) => [...g.leads.values()].map((r) => ({ ...r, g })));

  const csv = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Lok Adalat date', 'State', 'City', 'Reference', 'Name', 'Vehicle', 'Mobile', 'Stage', 'Assigned to', 'Challan number', 'Challan date', 'Offence', 'Amount (₹)', 'Approved', 'Court token'];
    const lines = rows.flatMap(({ lead: l, challans, g }) => challans.map((c) => [g.lok.date, g.label, CITY[g.lok.city] || g.lok.city, l.ref, l.name, fmtPlate(l.plate), l.phone,
      l.status, l.agent || '', c.challanNo, c.date || '', c.offence || '', c.amount || 0, c.approved ? 'Yes' : 'Not yet', c.token]));
    const blob = new Blob(['﻿' + [head, ...lines].map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `niptao-lok-adalat-${day}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <section className="panel pad an-card">
      <h2>Next Lok Adalat: challans by state</h2>
      <div className="small" style={{ marginBottom: 10 }}>
        Open leads only. Each challan goes to the next Lok Adalat of the state that issued it. Leads with approved challans count only those; others count all their challans for now.
      </div>
      {!d.list.length ? (
        <div className="small">{(dates || []).length ? 'No open leads have challans for the upcoming dates yet.' : 'No upcoming Lok Adalat dates. Add them in Settings.'}</div>
      ) : (
        <>
          <table className="an-table">
            <thead><tr><th /><th>Date</th><th>Leads</th><th>Challans</th><th>Approved</th><th>Challan amount</th></tr></thead>
            <tbody>
              {d.list.map((g) => (
                <tr key={g.key}>
                  <td className="lbl">{g.label}{g.state === 'UP' && <div className="small">{CITY[g.lok.city]}</div>}</td>
                  <td className="num">{lokLong(g.lok)}</td>
                  <td className="num">{g.leads.size}</td>
                  <td className="num">{g.challans}</td>
                  <td className="num">{g.approved}</td>
                  <td className="num">{inr(g.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="an-lok-head">
            <h2>Leads to handle on</h2>
            <div className="an-filters" role="group" aria-label="Lok Adalat date">
              {d.days.map((x) => <button key={x} aria-pressed={x === day} onClick={() => setPick(x)}>{lokLong({ date: x })}</button>)}
            </div>
            <button className="btn" onClick={csv}>Download CSV</button>
          </div>
          <table className="an-table an-lok">
            <thead><tr><th>Lead</th><th>Vehicle</th><th>Mobile</th><th>Stage</th><th>State</th><th>Challan numbers</th><th>Amount</th></tr></thead>
            <tbody>
              {rows.map(({ lead: l, challans, g }) => (
                <tr key={g.key + l.ref}>
                  <td className="lbl">{l.name}<div className="small">{l.ref}{l.agent ? ` · ${l.agent}` : ''}</div></td>
                  <td>{fmtPlate(l.plate)}</td>
                  <td>{l.phone}</td>
                  <td>{l.status}</td>
                  <td>{g.label}</td>
                  <td className="chal">
                    {challans.map((c, i) => (
                      <div key={i}>{c.challanNo || '–'}{!c.approved && <span className="small"> (not approved yet)</span>}{c.token && <span className="small"> · token {c.token}</span>}</div>
                    ))}
                  </td>
                  <td className="num">{inr(challans.reduce((n, c) => n + (c.amount || 0), 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {(d.noChallans > 0 || d.noDate > 0) && (
        <div className="small" style={{ marginTop: 10 }}>
          {d.noChallans > 0 && `${d.noChallans} open lead${d.noChallans === 1 ? ' has' : 's have'} no challans added yet, so ${d.noChallans === 1 ? 'it is' : 'they are'} not counted. `}
          {d.noDate > 0 && `${d.noDate} challan${d.noDate === 1 ? ' is' : 's are'} from a state with no upcoming date in Settings.`}
        </div>
      )}
    </section>
  );
}
