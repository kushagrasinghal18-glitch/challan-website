import { useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import { inr } from './format.js';
import * as Icon from './icons.jsx';

// phone → otp → loading → results | empty | form (manual check on error) → form → thanks
const STEP_INDEX = { phone: 0, otp: 0, loading: 1, results: 1, empty: 1, form: 2 };

export default function CheckFlow({ plate, lang, cityKey, t, waUrl, onClose, onReset }) {
  const [step, setStep] = useState('phone');
  const [config, setConfig] = useState({ otpMode: 'demo', challanSource: 'mock' });
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); // inline message for the current step
  const [result, setResult] = useState(null); // { source, challans }
  const [errorMode, setErrorMode] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', vtype: 'car', consent: false });
  const [tried, setTried] = useState(false);
  const [ref, setRef] = useState('');
  const [alertMode, setAlertMode] = useState(false);
  const verifying = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => {});
    const iv = setInterval(() => setNow(Date.now()), 1000);
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { clearInterval(iv); document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, []);

  const loc = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const phoneShown = '+91 ' + (phone ? phone.slice(0, 5) + ' ' + phone.slice(5) : '');
  const resendS = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const msgFor = (err, fallback) => (err?.status === 429 ? t('tooMany') : fallback || t('netErr'));

  const challans = result?.challans || [];
  const eligible = challans.filter((c) => c.eligibility === 'eligible');
  const eligAmt = eligible.reduce((a, c) => a + c.amount, 0);
  const pending = challans.filter((c) => c.eligibility !== 'paid').reduce((a, c) => a + c.amount, 0);
  const fee = errorMode ? '50%' : inr(eligAmt / 2);

  async function requestOtp(e) {
    e?.preventDefault();
    if (!/^[6-9]\d{9}$/.test(phone)) return setError(t('phoneErr'));
    setBusy(true); setError('');
    try {
      const r = await api.sendOtp(phone);
      setOtp(''); setResendAt(Date.now() + (r.resendAfter || 30) * 1000); setStep('otp');
    } catch (err) {
      setError(msgFor(err));
    } finally { setBusy(false); }
  }

  async function verify(code) {
    if (code.length !== 6 || verifying.current) return;
    verifying.current = true; setError('');
    try {
      await api.verifyOtp(phone, code);
    } catch (err) {
      verifying.current = false;
      setOtp('');
      return setError(err.status === 400 ? t('otpErr') : msgFor(err));
    }
    verifying.current = false;
    loadChallans();
  }

  async function loadChallans() {
    setStep('loading');
    try {
      const r = await api.fetchChallans(plate);
      setResult(r); setErrorMode(false);
      setStep(r.challans.some((c) => c.eligibility !== 'paid') ? 'results' : 'empty');
    } catch {
      // Provider down or timed out: collect details for a manual check, as designed.
      setErrorMode(true); setStep('form');
    }
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.consent) return setTried(true);
    await saveLead(errorMode ? 'manual' : 'booking');
  }

  async function saveLead(kind) {
    setBusy(true); setError('');
    try {
      const r = await api.createLead({
        kind, plate, city: cityKey, lang, ...form,
        challans: challans.map(({ challanNo, offence, amount, eligibility, date }) => ({ challanNo, offence, amount, eligibility, date })),
      });
      setRef(r.ref); setAlertMode(kind === 'alert'); setTried(false); setStep('thanks');
    } catch (err) {
      setError(msgFor(err));
    } finally { setBusy(false); }
  }

  const idx = STEP_INDEX[step] ?? 0;
  const stepper = [t('stepVerify'), t('stepResults'), t('stepDetails')];

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('checkBtn')}>
        <div className="modal-top">
          {step !== 'thanks' ? (
            <div className="stepper">
              {stepper.map((label, i) => (
                <div key={label} className={i < idx ? 'done' : i === idx ? 'cur' : ''}>
                  <span className="n">{i < idx ? '✓' : i + 1}</span>
                  <span className="lbl">{label}</span>
                  {i < 2 && <span className="sep" />}
                </div>
              ))}
            </div>
          ) : <span />}
          <button className="modal-close" onClick={onClose} aria-label="Close"><Icon.Close /></button>
        </div>

        <div className="modal-body">
          {step === 'phone' && (
            <form className="pane" onSubmit={requestOtp} noValidate>
              <div className="plate-chip">{plate}</div>
              <div className="title-group">
                <h3>{t('phoneTitle')}</h3>
                <p className="desc">{t('phoneDesc')}</p>
              </div>
              <label className="field">
                <span>{t('phoneLabel')}</span>
                <div className="phone-input">
                  <span className="cc">+91</span>
                  <input type="tel" inputMode="numeric" autoFocus value={phone} placeholder="98765 43210" autoComplete="tel-national"
                    onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '').slice(-10)); setError(''); }} />
                </div>
              </label>
              {error && <div className="field-err" role="alert" style={{ marginTop: -6 }}>{error}</div>}
              <button type="submit" className="btn-amber" style={{ height: 56, fontSize: 16 }} disabled={busy}>{t('sendOtp')}</button>
              <div className="note" style={{ textAlign: 'center' }}>{t('lookupConsent')}</div>
            </form>
          )}

          {step === 'otp' && (
            <form className="pane" style={{ gap: 18 }} onSubmit={(e) => { e.preventDefault(); verify(otp); }}>
              <div className="title-group">
                <h3>{t('otpTitle')}</h3>
                <p className="desc" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {t('otpDesc', { phone: phoneShown })}
                  <a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); setError(''); setStep('phone'); }}>{t('change')}</a>
                </p>
              </div>
              <div className="otp-wrap">
                <div className="otp-cells">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className={i === otp.length ? 'active' : otp[i] ? 'filled' : ''}>{otp[i] || ''}</div>
                  ))}
                </div>
                <input type="tel" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} aria-label="OTP" value={otp}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setOtp(v); setError('');
                    if (v.length === 6) setTimeout(() => verify(v), 250);
                  }} />
              </div>
              {error && <div className="field-err" role="alert">{error}</div>}
              <div className="otp-foot">
                {resendS === 0
                  ? <a href="#" style={{ fontWeight: 600 }} onClick={(e) => { e.preventDefault(); requestOtp(); }}>{t('resend')}</a>
                  : <span style={{ color: '#6B7385' }}>{t('resendIn', { s: resendS })}</span>}
                {config.otpMode === 'demo' && <span className="demo">{t('otpDemo')}</span>}
              </div>
              <button type="submit" className="btn-amber" style={{ height: 56, fontSize: 16 }} disabled={otp.length !== 6}>{t('verifyBtn')}</button>
            </form>
          )}

          {step === 'loading' && (
            <div className="pane" style={{ padding: '28px 20px', gap: 18 }} aria-busy="true">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div className="spinner" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{t('loadingTitle')}</div>
                  <div style={{ fontSize: 14, color: '#4A5670' }}>{t('loadingDesc', { plate })}</div>
                </div>
              </div>
              {[1, 2, 3].map((k) => (
                <div className="skeleton" key={k}><div style={{ width: '45%' }} /><div style={{ width: '75%' }} /><div style={{ width: '55%' }} /></div>
              ))}
            </div>
          )}

          {step === 'results' && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {result.source === 'mock' && <span className="sample-badge">{t('sampleData')}</span>}
                <div className="summary">
                  <div className="top">
                    <span className="chip">{plate}</span>
                    <span className="sub">{t('challansFound', { n: challans.length })}</span>
                  </div>
                  <div>
                    <div className="sub" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>{t('totalPending')}</div>
                    <div className="total">{inr(pending)}</div>
                  </div>
                  <div className="elig">{t('eligibleSum', { n: eligible.length, amt: inr(eligAmt) })}</div>
                  <div className="pay"><span style={{ fontSize: 14, color: '#D7DBE6' }}>{t('youPay')}</span><b>{inr(eligAmt / 2)}</b></div>
                </div>
                <div className="note">{t('benchNote')}</div>
              </div>
              <div style={{ padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {challans.map((c) => (
                  <div key={c.challanNo} className={`challan ${c.eligibility}`}>
                    <div className="row">
                      <span className={`tag ${c.eligibility}`}>
                        {t(c.eligibility === 'eligible' ? 'tagEligible' : c.eligibility === 'not' ? 'tagNot' : 'tagPaid')}
                      </span>
                      <span className="no">{c.challanNo}</span>
                    </div>
                    <div className="main">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                        <div className="off">{(lang === 'hi' && c.offenceHi) || c.offence}</div>
                        <div className="meta">
                          {[c.date && new Date(c.date).toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' }), c.location].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="amt">{inr(c.amount)}</div>
                    </div>
                    {c.reason && <div className="reason">{t(c.reason === 'court' ? 'reasonCourt' : 'reasonSerious')}</div>}
                  </div>
                ))}
              </div>
              <div className="sticky-cta">
                <button className="btn-amber" style={{ width: '100%', height: 58, fontSize: 17 }} onClick={() => { setErrorMode(false); setStep('form'); }}>{t('settleCta')} →</button>
              </div>
            </div>
          )}

          {step === 'empty' && (
            <div className="pane" style={{ padding: '28px 20px 24px', gap: 18, alignItems: 'flex-start' }}>
              <span className="plate-chip">{plate}</span>
              <div className="title-group">
                <h3 style={{ fontSize: 24 }}>{t('emptyTitle')}</h3>
                <p className="desc">{t('emptyDesc', { plate })}</p>
              </div>
              <div className="alert-box">
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <Icon.WhatsApp size={24} sw={1.8} stroke="#1FA855" style={{ flex: 'none' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{t('alertTitle')}</div>
                    <div style={{ fontSize: 14, color: '#4A5670', lineHeight: 1.5 }}>{t('alertDesc')}</div>
                  </div>
                </div>
                <button className="btn-outline" style={{ borderColor: '#0E1B36', fontWeight: 700 }} disabled={busy} onClick={() => saveLead('alert')}>{t('alertBtn')}</button>
                {error && <div className="field-err" role="alert">{error}</div>}
              </div>
              <button className="btn-link" onClick={onReset}>{t('checkAnother')}</button>
            </div>
          )}

          {step === 'form' && (
            <form className="pane" style={{ paddingTop: 20 }} onSubmit={submit} noValidate>
              {errorMode && (
                <div className="warn">
                  <Icon.Warn stroke="#9A5B00" style={{ flex: 'none' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{t('errTitle')}</div>
                    <div style={{ fontSize: 14, color: '#4A5670', lineHeight: 1.45 }}>{t('errDesc')}</div>
                  </div>
                </div>
              )}
              <div className="title-group">
                <h3>{errorMode ? t('formTitleErr') : t('formTitle')}</h3>
                {!errorMode && <div style={{ fontSize: 14, color: '#1F6B45', fontWeight: 600 }}>{t('formSum', { n: eligible.length, amt: inr(eligAmt), fee })}</div>}
              </div>
              <div className="kv-grid">
                <div className="kv"><span className="k">{t('fVehicle')}</span><span className="mono" style={{ fontWeight: 600, fontSize: 16, letterSpacing: '.05em' }}>{plate}</span></div>
                <div className="kv"><span className="k">{t('fPhone')} <span className="ok">✓ {t('verified')}</span></span><span style={{ fontWeight: 600, fontSize: 16 }}>{phoneShown}</span></div>
              </div>
              <label className="field">
                <span>{t('fName')}</span>
                <input className={'text-input' + (tried && !form.name.trim() ? ' bad' : '')} value={form.name} placeholder={t('fNamePh')} autoComplete="name"
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="field">
                <span>{t('fEmail')} <span className="opt">{t('optional')}</span></span>
                <input className="text-input" type="email" value={form.email} placeholder="name@email.com" autoComplete="email"
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
              <div className="field">
                <span>{t('fType')}</span>
                <div className="vtypes">
                  {['car', 'bike', 'commercial'].map((k) => (
                    <button type="button" key={k} aria-pressed={form.vtype === k} onClick={() => setForm({ ...form, vtype: k })}>{t(k)}</button>
                  ))}
                </div>
              </div>
              <div className="consent" role="checkbox" aria-checked={form.consent} tabIndex={0}
                onClick={() => setForm({ ...form, consent: !form.consent })}
                onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), setForm({ ...form, consent: !form.consent }))}>
                <span className={'box' + (form.consent ? ' on' : tried ? ' bad' : '')}>{form.consent && <Icon.Check stroke="#fff" sw={3.2} />}</span>
                <span>{t('consent')} <a href="#privacy" onClick={(e) => e.stopPropagation()}>{t('privacy')}</a></span>
              </div>
              {error && <div className="field-err" role="alert">{error}</div>}
              <button type="submit" className="btn-amber" style={{ height: 58, fontSize: 17 }} disabled={busy}>{t('submit')}</button>
              <div className="note" style={{ textAlign: 'center' }}>{t('feeNote', { fee })}</div>
            </form>
          )}

          {step === 'thanks' && (
            <div className="pane" style={{ paddingTop: 8, gap: 20 }}>
              <div className="thanks-hero">
                <span className="ok"><Icon.Check size={30} sw={2.6} stroke="#1F7A4D" /></span>
                <h3>{alertMode ? t('thanksAlertTitle') : t('thanksTitle')}</h3>
                <p><Icon.WhatsApp size={20} sw={2} stroke="#1FA855" />{alertMode ? t('thanksAlertWa') : t('thanksWa')}</p>
              </div>
              <div className="ref">
                <span className="k">{t('refLabel')}</span>
                <span className="v">{ref}</span>
                <span className="s">{plate} · {phoneShown}</span>
              </div>
              {!alertMode && (
                <div className="steps">
                  <div className="k">{t('nextTitle2')}</div>
                  {['next1', 'next2', 'next3'].map((k, i) => (
                    <div className="s" key={k}><span className="i">{i + 1}</span><span style={{ paddingTop: 2 }}>{t(k)}</span></div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <a className="btn-wa" href={waUrl} target="_blank" rel="noopener noreferrer">{t('waNow')}</a>
                <button className="btn-outline" onClick={onReset}>{t('backHome')}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
