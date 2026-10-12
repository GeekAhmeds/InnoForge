import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { seedSamples } from '../lib/samples.js';
import { Field, Toggle, useApp } from '../components/ui.jsx';
import BrandHead from '../components/Brand.jsx';
import { ConnectModal } from '../components/Network.jsx';
import { COUNTRIES, COUNTRY_FLAGS, countryName, countryPreset } from '../lib/countries.js';

const TYPES = [
  { id: 'retail', icon: '🏪' },
  { id: 'bookstore', icon: '📚' },
  { id: 'restaurant', icon: '🍽' },
  { id: 'trading', icon: '🏢' },
];

export default function Setup({ onDone }) {
  const { t, tErr, notify, reloadSettings, settings, license } = useApp();
  const locked = license?.country || null;
  const [form, setForm] = useState({
    ...countryPreset(locked || settings.country || 'EG'),
    business_type: 'retail', business_name: '', language: settings.language || 'ar',
    name: '', username: 'admin', pin: '', samples: true,
  });
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  async function switchLang(language) {
    setForm((f) => ({ ...f, language }));
    await api.settings.setLanguage(language);
    reloadSettings();
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { business_type, business_name, currency_symbol, language, country, currency, tax_rate, prices_include_tax } = form;
      await api.auth.setup({
        business: { business_type, business_name, currency_symbol, language, country, currency, tax_rate, prices_include_tax, service_rate: business_type === 'restaurant' ? 12 : 0 },
        admin: { name: form.name, username: form.username, pin: form.pin },
      });
      const user = await api.auth.login({ username: form.username, pin: form.pin });
      if (form.samples) await seedSamples(api, business_type);
      await onDone(user);
    } catch (err) {
      notify(tErr(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card setup" onSubmit={submit}>
        <div className="row between">
          <BrandHead title={t('setup.title')} />
          <div className="seg">
            <button type="button" className={form.language === 'ar' ? 'on' : ''} onClick={() => switchLang('ar')}>العربية</button>
            <button type="button" className={form.language === 'en' ? 'on' : ''} onClick={() => switchLang('en')}>English</button>
          </div>
        </div>
        <p className="muted">{t('setup.subtitle')}</p>

        <h3>{t('country.title')}</h3>
        <div className="seg">
          {Object.keys(COUNTRIES).filter((c) => !locked || c === locked).map((c) => (
            <button type="button" key={c} className={form.country === c ? 'on' : ''} onClick={() => setForm((f) => ({ ...f, ...countryPreset(c) }))}>
              {COUNTRY_FLAGS[c]} {countryName(c, form.language)}
            </button>
          ))}
        </div>
        <p className="muted small">{t('country.hint')}</p>

        <h3>{t('setup.businessType')}</h3>
        <div className="type-grid">
          {TYPES.map((ty) => (
            <button type="button" key={ty.id} className={`type-card ${form.business_type === ty.id ? 'on' : ''}`} onClick={() => set('business_type')(ty.id)}>
              <span className="big-ico">{ty.icon}</span>
              <span>{t(`type.${ty.id}`)}</span>
            </button>
          ))}
        </div>

        <div className="grid2">
          <Field label={t('setup.businessName')}><input required value={form.business_name} onChange={set('business_name')} autoFocus /></Field>
          <Field label={t('setup.currency')}><input value={form.currency_symbol} onChange={set('currency_symbol')} /></Field>
        </div>

        <h3>{t('setup.admin')}</h3>
        <div className="grid3">
          <Field label={t('setup.adminName')}><input required value={form.name} onChange={set('name')} /></Field>
          <Field label={t('setup.username')}><input required value={form.username} onChange={set('username')} /></Field>
          <Field label={t('setup.pin')}><input required type="password" inputMode="numeric" pattern="\d{4,8}" value={form.pin} onChange={set('pin')} /></Field>
        </div>
        <Toggle checked={form.samples} onChange={set('samples')} label={t('setup.sample')} />
        <button className="primary lg" disabled={busy}>{t('setup.start')}</button>
        <div className="row center">
          <span className="muted small">{t('net.activationHint')}</span>
          <button type="button" className="ghost" onClick={() => setJoining(true)}>🔗 {t('net.join')}</button>
        </div>
      </form>
      {joining && <ConnectModal onClose={() => setJoining(false)} />}
    </div>
  );
}
