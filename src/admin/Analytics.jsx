import { useMemo, useState } from 'react';
import LokAdalat from './LokAdalat.jsx';

// Admin-only numbers worked out from the leads already loaded in the panel (nothing extra is fetched).
// Leads received count by the day they came in; settled, lost and payments count by the day the
// lead reached that stage (statusLog, else its last update for leads from before the log existed).

const DAY = 864e5;
const IST = 5.5 * 36e5;
const istDay = (t) => new Date(new Date(t).getTime() + IST).toISOString().slice(0, 10);
const startOfIstDay = (d) => new Date(`${d}T00:00:00+05:30`).getTime();
const FLOW = ['New', 'Contacted', 'Payment received', 'Documents received', 'Documents verified', 'Scheduled', 'Settled'];
const CITY = { noida: 'Noida / Gr. Noida', ghaziabad: 'Ghaziabad', delhi: 'Delhi', gurugram: 'Gurugram' };
const RANGES = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['month', 'This month'], ['all', 'All time'], ['custom', 'Custom']];

function rangeOf(kind, from, to) {
  const today = istDay(Date.now());
  const end = startOfIstDay(today) + DAY;
  if (kind === 'today') return [startOfIstDay(today), end];
  if (kind === '7') return [end - 7 * DAY, end];
  if (kind === '30') return [end - 30 * DAY, end];
  if (kind === 'month') return [startOfIstDay(today.slice(0, 8) + '01'), end];
  if (kind === 'custom' && from && to && from <= to) return [startOfIstDay(from), startOfIstDay(to) + DAY];
  return [0, end];
}

// When the lead last reached a stage, or null.
function reachedAt(l, status) {
  const hit = (l.statusLog || []).filter((x) => x.status === status).pop();
  if (hit) return hit.at;
  return l.status === status ? l.updatedAt || l.createdAt : null;
}
// Furthest step along FLOW the lead has ever been at (a lost lead keeps how far it got).
function furthest(l) {
  const steps = [l.status, ...(l.statusLog || []).map((x) => x.status)].map((s) => FLOW.indexOf(s));
  return Math.max(0, ...steps);
}
const PAID = FLOW.indexOf('Payment received');
// Revenue counts only money the team confirmed with "Mark payment received" (amount entered), on leads that are not Lost.
const paidAt = (l) => (l.payment && l.status !== 'Lost' ? l.payment.at : null);
const approvedByCustomer = (l) => l.waApproval?.state === 'received' || (l.challans || []).some((c) => c.approved);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export default function Analytics({ leads, staff, payable, inr, lokDates, onOpenLead }) {
  const [showPaid, setShowPaid] = useState(false);
  const [kind, setKind] = useState('30');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tip, setTip] = useState(null);

  const d = useMemo(() => {
    const [a, b] = rangeOf(kind, from, to);
    const inRange = (iso) => { if (!iso) return false; const t = new Date(iso).getTime(); return t >= a && t < b; };
    const all = leads || [];
    const received = all.filter((l) => inRange(l.createdAt));
    const settled = all.filter((l) => inRange(reachedAt(l, 'Settled')) && l.status === 'Settled');
    const lost = all.filter((l) => inRange(reachedAt(l, 'Lost')) && l.status === 'Lost');
    const paid = all.filter((l) => inRange(paidAt(l)));
    const got = (l) => l.payment.amount;
    const revenue = paid.reduce((n, l) => n + got(l), 0);
    const paySent = all.filter((l) => inRange(l.paymentSent?.at));
    const open = all.filter((l) => !['Settled', 'Lost'].includes(l.status));
    const pipeline = open.filter((l) => approvedByCustomer(l) && !l.payment).reduce((n, l) => n + payable(l), 0);
    const days = settled.map((l) => (new Date(reachedAt(l, 'Settled')) - new Date(l.createdAt)) / DAY).filter((x) => x >= 0);
    const avgDays = days.length ? days.reduce((n, x) => n + x, 0) / days.length : null;

    // Leads per day (or per week for long ranges).
    const first = a || (all.length ? startOfIstDay(istDay(Math.min(...all.map((l) => new Date(l.createdAt))))) : b - 30 * DAY);
    const spanDays = Math.max(1, Math.round((b - first) / DAY));
    const step = spanDays > 92 ? 7 : 1;
    const buckets = [];
    for (let t = first; t < b; t += step * DAY) buckets.push({ t, n: 0, settled: 0 });
    for (const l of received) {
      const i = Math.floor((new Date(l.createdAt) - first) / (step * DAY));
      if (buckets[i]) buckets[i].n++;
    }

    // How far the leads received in this period have got.
    const funnel = [
      ['Received', received.length],
      ['Contacted', received.filter((l) => furthest(l) >= 1).length],
      ['Approved challans', received.filter(approvedByCustomer).length],
      ...FLOW.slice(PAID, -1).map((s) => [s, received.filter((l) => furthest(l) >= FLOW.indexOf(s)).length]),
      ['Settled', received.filter((l) => l.status === 'Settled').length],
    ];

    const group = (keyOf, labelOf) => {
      const m = new Map();
      for (const l of received) {
        const k = keyOf(l);
        const r = m.get(k) || { key: k, label: labelOf(k), n: 0, settled: 0, lost: 0, revenue: 0 };
        r.n++;
        if (l.status === 'Settled') r.settled++;
        if (paidAt(l)) r.revenue += got(l);
        if (l.status === 'Lost') r.lost++;
        m.set(k, r);
      }
      return [...m.values()].sort((x, y) => y.n - x.n);
    };
    const staffName = Object.fromEntries((staff || []).map((u) => [u.id, u.name]));
    return {
      received, settled, lost, paid, revenue, got, paySent, pipeline, avgDays, buckets, step, funnel,
      conv: pct(received.filter((l) => l.status === 'Settled').length, received.length),
      byStatus: [...FLOW, 'Lost'].map((s) => ({ key: s, label: s, n: received.filter((l) => l.status === s).length })),
      bySource: group((l) => l.source || 'Website', (k) => k),
      byCity: group((l) => l.city || '', (k) => CITY[k] || k || 'Not given'),
      byStaff: group((l) => l.agentId || '', (k) => (k ? staffName[k] || 'Removed staff' : 'Unassigned')),
    };
  }, [leads, staff, kind, from, to, payable]);

  if (!leads) return <div className="panel"><div className="empty">Loading…</div></div>;
  const maxDay = Math.max(1, ...d.buckets.map((x) => x.n));
  const fmtDay = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const tiles = [
    ['Leads received', d.received.length, 'New leads in this period'],
    ['Converted', d.settled.length, 'Moved to Settled in this period'],
    ['Lost', d.lost.length, 'Moved to Lost in this period'],
    ['Conversion rate', `${d.conv}%`, 'Of leads received in this period, settled so far'],
    ['Revenue', inr(d.revenue), `From ${d.paid.length} payment${d.paid.length === 1 ? '' : 's'} received in this period`],
    ['Open pipeline', inr(d.pipeline), 'Payable on approved leads not yet paid (right now)'],
    ['Payment details sent', d.paySent.length, `${inr(d.paySent.reduce((n, l) => n + (l.paymentSent.amount || 0), 0))} requested in this period`],
    ['Avg. time to settle', d.avgDays == null ? '–' : `${d.avgDays < 1 ? '<1' : Math.round(d.avgDays)} day${Math.round(d.avgDays) === 1 ? '' : 's'}`, 'From lead received to Settled'],
  ];

  const Table = ({ title, rows, withMoney = true }) => {
    const max = Math.max(1, ...rows.map((r) => r.n));
    return (
      <section className="panel pad an-card">
        <h2>{title}</h2>
        {!rows.some((r) => r.n) ? <div className="small">No leads in this period.</div> : (
          <table className="an-table">
            <thead><tr><th /><th>Leads</th>{withMoney && <><th>Settled</th><th>Lost</th><th>Conv.</th><th>Revenue</th></>}</tr></thead>
            <tbody>
              {rows.filter((r) => r.n || !withMoney).map((r) => (
                <tr key={r.key}>
                  <td className="lbl">{r.label}<div className="meter"><span style={{ width: `${(r.n / max) * 100}%` }} /></div></td>
                  <td className="num">{r.n}</td>
                  {withMoney && <><td className="num">{r.settled}</td><td className="num">{r.lost}</td><td className="num">{pct(r.settled, r.n)}%</td><td className="num">{inr(r.revenue)}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  };

  return (
    <div className="analytics">
      <div className="an-filters" role="group" aria-label="Date range">
        {RANGES.map(([k, label]) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>)}
        {kind === 'custom' && (
          <span className="an-custom">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <span>to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </span>
        )}
      </div>

      <div className="an-tiles">
        {tiles.map(([l, v, hint]) => (l === 'Revenue' ? (
          <button type="button" className={'an-tile an-click' + (showPaid ? ' on' : '')} key={l} title="Show the leads behind this number" aria-expanded={showPaid} onClick={() => setShowPaid((x) => !x)}>
            <div className="l">{l} {showPaid ? '▾' : '▸'}</div><div className="v">{v}</div><div className="h">{hint} · click to see the leads</div>
          </button>
        ) : (
          <div className="an-tile" key={l} title={hint}><div className="l">{l}</div><div className="v">{v}</div><div className="h">{hint}</div></div>
        )))}
      </div>

      {showPaid && (
        <section className="panel pad an-card">
          <h2>Revenue: {inr(d.revenue)} from {d.paid.length} lead{d.paid.length === 1 ? '' : 's'}</h2>
          <div className="small" style={{ marginBottom: 10 }}>Each lead counts the amount received, as entered when payment was confirmed, on that day. Older leads without an entered amount count the amount due (approved challans × their rate).</div>
          {!d.paid.length ? <div className="small">No payments in this period.</div> : (
            <table className="an-table an-paid">
              <thead><tr><th>Lead</th><th>Paid on</th><th>Stage now</th><th>Approved challans</th><th>Rate</th><th>Revenue</th></tr></thead>
              <tbody>
                {[...d.paid].sort((a, b) => String(paidAt(b)).localeCompare(String(paidAt(a)))).map((l) => {
                  const ok = (l.challans || []).filter((c) => c.approved);
                  return (
                    <tr key={l.ref}>
                      <td className="lbl">{onOpenLead ? <button type="button" className="linkish" onClick={() => onOpenLead(l.ref)}>{l.name}</button> : l.name}
                        <div className="small">{l.ref} · {l.plate || 'no vehicle number'}</div></td>
                      <td>{new Date(paidAt(l)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}</td>
                      <td>{l.status}</td>
                      <td className="num">{ok.length} · {inr(ok.reduce((n, c) => n + (c.amount || 0), 0))}</td>
                      <td className="num">{[50, 40, 30].includes(l.feeRate) ? l.feeRate : 50}%</td>
                      <td className="num"><b>{inr(d.got(l))}</b>{!l.payment && <div className="small">amount due, not entered</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="panel pad an-card">
        <h2>Leads received per {d.step === 7 ? 'week' : 'day'}</h2>
        <div className="an-bars" onMouseLeave={() => setTip(null)}>
          {d.buckets.map((x, i) => (
            <div key={x.t} className="an-col" onMouseEnter={(e) => setTip({ i, x: e.currentTarget.offsetLeft + e.currentTarget.offsetWidth / 2 })}>
              <span className={'bar' + (tip?.i === i ? ' on' : '')} style={{ height: `${(x.n / maxDay) * 100}%` }} />
            </div>
          ))}
          {tip && d.buckets[tip.i] && (
            <div className="an-tip" style={{ left: tip.x }}>
              <b>{d.buckets[tip.i].n} lead{d.buckets[tip.i].n === 1 ? '' : 's'}</b>
              <div>{d.step === 7 ? `Week of ${fmtDay(d.buckets[tip.i].t)}` : fmtDay(d.buckets[tip.i].t)}</div>
            </div>
          )}
        </div>
        <div className="an-axis"><span>{fmtDay(d.buckets[0]?.t)}</span><span>Most in one {d.step === 7 ? 'week' : 'day'}: {maxDay}</span><span>{fmtDay(d.buckets[d.buckets.length - 1]?.t)}</span></div>
      </section>

      <section className="panel pad an-card">
        <h2>How far leads from this period got</h2>
        <div className="small" style={{ marginBottom: 10 }}>Each step counts the leads received in this period that reached it, even if they later moved on or were lost.</div>
        <div className="an-funnel">
          {d.funnel.map(([label, n], i) => (
            <div className="row" key={label}>
              <div className="lbl">{label}</div>
              <div className="track"><span style={{ width: `${pct(n, d.funnel[0][1])}%` }} /></div>
              <div className="num"><b>{n}</b> <span className="small">{i ? `${pct(n, d.funnel[0][1])}%` : ''}</span></div>
            </div>
          ))}
        </div>
      </section>

      <LokAdalat leads={leads} dates={lokDates || []} inr={inr} />

      <div className="an-grid">
        <Table title="By current stage" rows={d.byStatus} withMoney={false} />
        <Table title="By source" rows={d.bySource} />
        <Table title="By city" rows={d.byCity} />
        <Table title="By staff member" rows={d.byStaff} />
      </div>
      <p className="small">Revenue is the amount the team entered when confirming "Payment received" on a lead, counted on the day it was confirmed. Leads marked Lost drop out.</p>
    </div>
  );
}
