import { useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import * as Icon from './icons.jsx';

// Lead capture: one form (name + mobile, vehicle carried over from the hero) → thanks.
// The OTP and live challan lookup steps are switched off for now; their server
// code is still in /server for when they're needed again.
export default function CheckFlow({ plate, lang, cityKey, t, waUrl, onClose, onReset }) {
  const [form, setForm] = useState({ name: '', phone: '', consent: false, website: '' });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ref, setRef] = useState('');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, []);

  const phoneOk = /^[6-9]\d{9}$/.test(form.phone);
  const phoneShown = '+91 ' + form.phone.slice(0, 5) + ' ' + form.phone.slice(5);

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !phoneOk || !form.consent) return setTried(true);
    setBusy(true); setError('');
    try {
      const r = await api.createLead({ ...form, plate, city: cityKey, lang });
      setRef(r.ref);
    } catch (err) {
      setError(err.status === 429 ? t('tooMany') : t('netErr'));
    } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t('leadTitle')}>
        <div className="modal-top">
          <span className="plate-chip" style={{ alignSelf: 'center' }}>{plate}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close"><Icon.Close /></button>
        </div>

        <div className="modal-body">
          {!ref ? (
            <form className="pane" onSubmit={submit} noValidate>
              <div className="title-group">
                <h3>{t('leadTitle')}</h3>
                <p className="desc">{t('leadDesc')}</p>
              </div>
              <label className="field">
                <span>{t('fName')}</span>
                <input id="lead-name" className={'text-input' + (tried && !form.name.trim() ? ' bad' : '')} value={form.name}
                  placeholder={t('fNamePh')} autoComplete="name" autoFocus
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="field">
                <span>{t('fPhone')}</span>
                <div className="phone-input" style={tried && !phoneOk ? { borderColor: 'var(--error)' } : undefined}>
                  <span className="cc">+91</span>
                  <input id="lead-phone" type="tel" inputMode="numeric" value={form.phone} placeholder="98765 43210" autoComplete="tel-national"
                    onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(-10) })} />
                </div>
              </label>
              {tried && !phoneOk && <div className="field-err" role="alert" style={{ marginTop: -8 }}>{t('phoneErr')}</div>}
              {/* Honeypot: hidden from people, bots fill it in */}
              <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
              <div className="consent" role="checkbox" aria-checked={form.consent} tabIndex={0}
                onClick={() => setForm({ ...form, consent: !form.consent })}
                onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), setForm({ ...form, consent: !form.consent }))}>
                <span className={'box' + (form.consent ? ' on' : tried ? ' bad' : '')}>{form.consent && <Icon.Check stroke="#fff" sw={3.2} />}</span>
                <span>{t('consent')} <a href="#privacy" onClick={(e) => e.stopPropagation()}>{t('privacy')}</a></span>
              </div>
              {error && <div className="field-err" role="alert">{error}</div>}
              <button type="submit" className="btn-amber" style={{ height: 58, fontSize: 17 }} disabled={busy}>{t('submit')} <span aria-hidden="true">→</span></button>
              <div className="note" style={{ textAlign: 'center' }}>{t('leadNote')}</div>
            </form>
          ) : (
            <div className="pane" style={{ paddingTop: 8, gap: 20 }}>
              <div className="thanks-hero">
                <span className="ok"><Icon.Check size={30} sw={2.6} stroke="#1F7A4D" /></span>
                <h3>{t('thanksTitle')}</h3>
                <p><Icon.WhatsApp size={20} sw={2} stroke="#1FA855" />{t('thanksWa')}</p>
              </div>
              <div className="ref">
                <span className="k">{t('refLabel')}</span>
                <span className="v">{ref}</span>
                <span className="s">{plate} · {phoneShown}</span>
              </div>
              <div className="steps">
                <div className="k">{t('nextTitle2')}</div>
                {['next1', 'next2', 'next3'].map((k, i) => (
                  <div className="s" key={k}><span className="i">{i + 1}</span><span style={{ paddingTop: 2 }}>{t(k)}</span></div>
                ))}
              </div>
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
