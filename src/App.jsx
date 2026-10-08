import { useEffect, useMemo, useState } from 'react';
import { CITIES, T } from './content.js';
import { PLATE_RE, fmtPlate, pad, fill } from './format.js';
import CheckFlow from './CheckFlow.jsx';
import * as Icon from './icons.jsx';

const env = import.meta.env;
export const SITE = {
  cityKey: CITIES[env.VITE_CITY] ? env.VITE_CITY : 'noida',
  brand: env.VITE_BRAND || 'Niptao',
  phone: env.VITE_PHONE || '+910000000000',
  whatsapp: env.VITE_WHATSAPP || '910000000000',
  email: env.VITE_EMAIL || 'hello@example.in',
};
const city = CITIES[SITE.cityKey];

const readLang = () => {
  try { return localStorage.getItem('lang') || env.VITE_DEFAULT_LANG || 'en'; } catch { return 'en'; }
};

function Logo() {
  return (
    <span className="logo" aria-label={SITE.brand}>
      <span className="dev">निप</span><span className="lat">tao</span>
    </span>
  );
}

const fmtPhone = (p) => p.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2');

export default function App() {
  const [lang, setLangState] = useState(readLang);
  const [plate, setPlate] = useState('');
  const [plateErr, setPlateErr] = useState(false);
  const [flowOpen, setFlowOpen] = useState(false);
  const [faq, setFaq] = useState(0);
  const [promo, setPromo] = useState(''); // code picked from the offer banner, carried into the form
  const [codeCopied, setCodeCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  // Lok Adalat dates and contact numbers come from the admin panel (Settings).
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    fetch('/api/settings').then((r) => (r.ok ? r.json() : Promise.reject())).then(setSettings).catch(() => setSettings({ failed: true }));
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === 'hi'
      ? 'ट्रैफ़िक चालान पर फ़्लैट 50% छूट | लोक अदालत में निपटारा | Niptao'
      : 'Flat 50% Off Traffic Challans | Settle at Lok Adalat, No Court Visit | Niptao';
  }, [lang]);

  const setLang = (l) => {
    setLangState(l);
    try { localStorage.setItem('lang', l); } catch { /* private mode */ }
  };

  const loc = lang === 'hi' ? 'hi-IN' : 'en-IN';
  // Soonest upcoming date from the admin panel, whatever its city (the server sends them
  // sorted and future-only). The built-in date is used only if settings can't load.
  const upcoming = (settings?.lokAdalatDates || []).filter((d) => CITIES[d.city]);
  const nextDate = upcoming[0];
  const dCity = CITIES[nextDate?.city] || city; // court, address and booking text for that date
  const target = useMemo(() => {
    if (nextDate) return new Date(`${nextDate.date}T${nextDate.time || '10:00'}:00+05:30`);
    if (settings?.failed) return new Date(city.date);
    return null; // loading, or no date announced yet
  }, [nextDate?.date, nextDate?.time, settings?.failed]);
  const tz = { timeZone: 'Asia/Kolkata' };
  const tba = !target;
  const dateShort = tba ? '' : target.toLocaleDateString(loc, { ...tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const dateLong = tba ? '' : target.toLocaleDateString(loc, { ...tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const contact = {
    whatsapp: settings?.whatsapp ? '91' + settings.whatsapp : SITE.whatsapp,
    phone: settings?.phone ? '+91' + settings.phone : SITE.phone,
  };
  const plateShown = plate || city.plateHint;

  const R = T[lang];
  const vars = { city: city.name[lang], court: city.court[lang], brand: SITE.brand, plate: plateShown, date: dateShort || T[lang].dateTbaInline };
  const t = (key, extra) => fill(R[key], { ...vars, ...extra });

  const diff = tba ? 0 : Math.max(0, target - now);
  const countdown = [
    [Math.floor(diff / 864e5), t('days')], [Math.floor(diff / 36e5) % 24, t('hrs')],
    [Math.floor(diff / 6e4) % 60, t('min')], [Math.floor(diff / 1e3) % 60, t('sec')],
  ];

  const gcal = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const calUrl = tba ? '' : 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + '&text=' + encodeURIComponent('Lok Adalat — ' + dCity.court.en)
    + '&dates=' + gcal(target) + '/' + gcal(new Date(+target + 7 * 36e5))
    + '&details=' + encodeURIComponent('Reminder from ' + SITE.brand + '. We attend on your behalf; keep your RC, licence and photo ID handy on WhatsApp.')
    + '&location=' + encodeURIComponent(dCity.address.en);
  const waUrl = `https://wa.me/${contact.whatsapp}?text=` + encodeURIComponent('Hi, I need help with challans for ' + plateShown);

  // Exclusive offer from admin Settings. The timer runs to a real end time (Settings, or the next Lok Adalat).
  const offer = settings?.offer || null;
  const offerLeft = offer?.endsAt ? Math.max(0, new Date(offer.endsAt) - now) : null;
  const offerParts = offerLeft ? [Math.floor(offerLeft / 864e5), Math.floor(offerLeft / 36e5) % 24, Math.floor(offerLeft / 6e4) % 60, Math.floor(offerLeft / 1e3) % 60] : null;
  const useOffer = async () => {
    setPromo(offer.code);
    try { await navigator.clipboard.writeText(offer.code); } catch { /* clipboard blocked */ }
    setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000);
  };

  const onCheck = (e) => {
    e.preventDefault();
    if (PLATE_RE.test(plate.replace(/\s/g, ''))) { setPlateErr(false); setFlowOpen(true); }
    else setPlateErr(true);
  };

  const reserve = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => document.getElementById('plate')?.focus({ preventScroll: true }), 500);
  };

  const how = [
    [Icon.Car, 'how1t', 'how1d'], [Icon.Shield, 'how2t', 'how2d'], [Icon.Doc, 'how3t', 'how3d'], [Icon.CalCheck, 'how4t', 'how4d', true],
  ];
  const why = [[Icon.Doc, 'why1t', 'why1d'], [Icon.Chat, 'why2t', 'why2d'], [Icon.Pin, 'why3t', 'why3d'], [Icon.Rupee, 'why4t', 'why4d']];

  return (
    <>
      <header className="header">
        <div className="wrap">
          <a href="#top" style={{ textDecoration: 'none' }}><Logo /></a>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="lang">
              <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
              <button aria-pressed={lang === 'hi'} onClick={() => setLang('hi')}>हिंदी</button>
            </div>
            <a href={`tel:${contact.phone}`} aria-label="Call" className="icon-btn"><Icon.Phone /></a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="wrap">
            <div className="hero-main">
              {offer && offerLeft !== 0 && (
                <div className="offer" role="region" aria-label={t('offerTag')}>
                  <div className="offer-l">
                    <span className="offer-tag">🔥 {t('offerTag')}</span>
                    <span className="offer-txt">{offer.title || t('heroTitle1')} · {t('offerUse')} <b className="code">{offer.code}</b></span>
                  </div>
                  <div className="offer-r">
                    {offerParts
                      ? <span className="offer-timer" aria-label={`${t('endsIn')} ${offerParts[0]} ${t('days')}`}>{t('endsIn')}
                          {offerParts.map((v, i) => <b key={i}>{pad(v)}<small>{['d', 'h', 'm', 's'][i]}</small></b>)}</span>
                      : <span className="offer-timer">{t('limited')}</span>}
                    <button type="button" className="offer-copy" onClick={useOffer}>{codeCopied ? t('codeCopied') : t('copyCode')}</button>
                  </div>
                </div>
              )}
              <span className="pill"><span className="dot" />{city.district[lang]} · {city.name[lang]}</span>
              <h1>{t('heroTitle1')} <span>{t('heroTitle2')}</span></h1>
              <p className="hero-sub">{t('heroSub')}</p>

              <form className="check-card" onSubmit={onCheck} noValidate>
                <label htmlFor="plate">{t('plateLabel')}</label>
                <div className="plate">
                  <div className="plate-ind"><span className="ring" /><span className="txt">IND</span></div>
                  <input id="plate" value={plate} onChange={(e) => { setPlate(fmtPlate(e.target.value)); setPlateErr(false); }}
                    placeholder={city.plateHint} autoComplete="off" autoCapitalize="characters" spellCheck="false" maxLength={13}
                    aria-invalid={plateErr} aria-describedby="plate-help" />
                </div>
                {plateErr
                  ? <div id="plate-help" className="field-err" role="alert">{t('plateError', { plate: city.plateHint })}</div>
                  : <div id="plate-help" className="field-hint">{t('plateHint')}: <b>{city.plateHint}</b> · {t('multiHint')}</div>}
                <button type="submit" className="btn-amber" style={{ height: 58, fontSize: 17 }}>{t('checkBtn')} <span aria-hidden="true">→</span></button>
                <div className="price-ex" aria-label={t('priceEx')}>
                  <span className="k">{t('priceEx')}</span>
                  <span>{t('priceChallan')} <s>₹4,000</s></span>
                  <span>{t('priceYouPay')} <b>₹2,000</b></span>
                  <span className="save">{t('priceSave')} ₹2,000</span>
                </div>
                <div className="trust">
                  {['trust1', 'trust2', 'trust3'].map((k) => <span key={k}><Icon.Check stroke="#2E8B57" />{t(k)}</span>)}
                </div>
              </form>
            </div>

            <div className="hero-side">
              <picture className="hero-img">
                <source type="image/webp" srcSet="/img/hero-720.webp 720w, /img/hero-1200.webp 1200w" sizes="(max-width: 820px) 100vw, 560px" />
                <img src="/img/hero-1200.jpg" srcSet="/img/hero-720.jpg 720w, /img/hero-1200.jpg 1200w" sizes="(max-width: 820px) 100vw, 560px"
                  width="1200" height="675" alt={t('heroImgAlt')} fetchPriority="high" decoding="async" />
              </picture>
              <div className="countdown-card">
                <div className="top">
                  <span className="eyebrow on-dark">{t('countdownLabel')}</span>
                  <span className="date">{tba ? (settings ? t('dateTba') : '') : dateShort}</span>
                </div>
                <div className="countdown">
                  {countdown.map(([v, l]) => <div key={l}><div className="v">{tba ? '--' : pad(v)}</div><div className="l">{l}</div></div>)}
                </div>
                <div className="court"><Icon.Pin stroke="#F5C06A" style={{ flex: 'none', marginTop: 1 }} /><span>{dCity.court[lang]}</span></div>
                <a href="#lok-adalat">{t('seeCarry')} ↓</a>
              </div>
            </div>
          </div>
        </section>

        <section className="how">
          <div className="wrap section-body">
            <div className="section-head">
              <span className="eyebrow">{t('howEyebrow')}</span>
              <h2 className="h2">{t('howTitle')}</h2>
            </div>
            <div className="how-grid">
              {how.map(([Ico, tk, dk, hot], i) => (
                <div className="how-card" key={tk}>
                  <div className="row"><span className={'ico' + (hot ? ' hot' : '')}><Ico /></span><span className="num">0{i + 1}</span></div>
                  <div className="t">{t(tk)}</div>
                  <div className="d">{t(dk)}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="why">
          <div className="wrap section-body">
            <div className="section-head">
              <span className="eyebrow">{t('whyEyebrow')}</span>
              <h2 className="h2">{t('whyTitle')}</h2>
            </div>
            <div className="why-grid">
              {why.map(([Ico, tk, dk]) => (
                <div key={tk}>
                  <Ico size={26} />
                  <div className="txt"><div className="t">{t(tk)}</div><div className="d">{t(dk)}</div></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="lok-adalat" className="next">
          <div className="wrap section-body">
            <div className="section-head">
              <span className="eyebrow on-dark">{t('nextEyebrow')}</span>
              <h2 className="h2">{t('nextTitle', { city: dCity.name[lang] })}</h2>
            </div>
            <div className="next-cols">
              <div className="next-card">
                <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
                  <div className="cal">
                    <div className="m">{tba ? '—' : target.toLocaleDateString(loc, { ...tz, month: 'short' }).toUpperCase()}</div>
                    <div className="d">{tba ? '?' : target.toLocaleDateString('en-IN', { ...tz, day: 'numeric' })}</div>
                    <div className="w">{tba ? '' : target.toLocaleDateString(loc, { ...tz, weekday: 'long' })}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.3 }}>{tba ? (settings ? t('dateTba') : '') : dateLong}</div>
                    <div style={{ fontSize: 14, color: '#B9C0D2' }}>{tba ? t('dateTbaDesc') : `${t('reporting')}: ${t('reportingVal')}`}</div>
                    {nextDate?.note && <div style={{ fontSize: 14, color: '#F5C06A' }}>{nextDate.note}</div>}
                  </div>
                </div>
                <div className="next-block">
                  <div className="k">{t('venue')}</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{dCity.court[lang]}</div>
                  <div style={{ fontSize: 14, color: '#B9C0D2', lineHeight: 1.5 }}>{dCity.address[lang]}</div>
                </div>
                <div className="next-block">
                  <div className="k">{t('bookingTitle')}</div>
                  <div style={{ fontSize: 14.5, color: '#D7DBE6', lineHeight: 1.55 }}>{dCity.booking[lang]}</div>
                </div>
                {upcoming.length > 1 && (
                  <div className="next-block">
                    <div className="k">{t('moreDates')}</div>
                    <ul className="more-dates">
                      {upcoming.slice(1, 8).map((d) => (
                        <li key={d.id}>
                          <b>{new Date(`${d.date}T${d.time || '10:00'}:00+05:30`).toLocaleDateString(loc, { ...tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b>
                          <span>{CITIES[d.city].name[lang]} · {CITIES[d.city].court[lang]}{d.note ? ` · ${d.note}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="next-actions">
                  <button className="btn-amber" onClick={reserve}>{t('reserveBtn')} →</button>
                  {!tba && <a href={calUrl} target="_blank" rel="noopener noreferrer">{t('addCal')}</a>}
                </div>
              </div>
              <div className="carry">
                <div style={{ fontSize: 17, fontWeight: 600 }}>{t('carryTitle')}</div>
                {R.carry.map((item) => (
                  <div className="item" key={item}><span className="box"><Icon.Check size={12} sw={3} /></span><span>{item}</span></div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="faq">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow">{t('faqEyebrow')}</span>
              <h2 className="h2">{t('faqTitle')}</h2>
            </div>
            <div className="faq-list">
              {R.faqs.map((f, i) => (
                <div className="faq-item" key={i}>
                  <button aria-expanded={faq === i} onClick={() => setFaq(faq === i ? -1 : i)}>
                    <span>{fill(f.q, vars)}</span><span className="sign">{faq === i ? '−' : '+'}</span>
                  </button>
                  {faq === i && <p>{fill(f.a, vars)}</p>}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          <Logo />
          <div className="disclaimer"><div className="k">{t('disclaimerTitle')}</div><div className="v">{t('disclaimer')}</div></div>
          <div className="footer-cols">
            <div>
              <div className="k">{t('contact')}</div>
              <a href={`tel:${contact.phone}`}>{fmtPhone(contact.phone)}</a>
              <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
              <span>{city.office[lang]}</span>
            </div>
            <div>
              <div className="k">{SITE.brand}</div>
              <a href="#privacy">{t('privacy')}</a>
              <a href="#terms">{t('terms')}</a>
              <a href="#lok-adalat">{t('nextEyebrow')}</a>
            </div>
          </div>
          <div className="copyright">© {new Date().getFullYear()} {SITE.brand}</div>
        </div>
      </footer>

      <a className="wa-fab" href={waUrl} target="_blank" rel="noopener noreferrer"><Icon.WhatsApp />{t('waFab')}</a>

      {flowOpen && (
        <CheckFlow
          plateHint={city.plateHint}
          plate={plate} lang={lang} cityKey={SITE.cityKey} t={t} waUrl={waUrl}
          promoCodes={settings?.promoCodes || []} initialPromo={promo}
          onClose={() => setFlowOpen(false)}
          onReset={() => { setFlowOpen(false); setPlate(''); }}
        />
      )}
    </>
  );
}
