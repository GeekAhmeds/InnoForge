import React, { useState } from 'react';
import { activate, api, copyText } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';

// Shown by installed builds until a license for this computer is entered.
export default function Activation({ license, onActivated, settings, reloadSettings }) {
  const { t, tErr } = useI18n();
  const [key, setKey] = useState('');
  const [error, setError] = useState(license.reason && license.reason !== 'EMPTY' ? tErr({ code: `LICENSE_${license.reason}` }) : '');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onActivated(await activate(key));
    } catch (err) {
      setError(tErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleLang() {
    await api.settings.setLanguage(settings.language === 'ar' ? 'en' : 'ar');
    reloadSettings();
  }

  return (
    <div className="center-screen">
      <form className="card activation" onSubmit={submit}>
        <div className="row between">
          <h1>🔐 {t('license.title')}</h1>
          <button type="button" className="ghost" onClick={toggleLang}>{settings.language === 'ar' ? 'English' : 'العربية'}</button>
        </div>
        <p className="muted">{t('license.intro')}</p>
        <label className="field"><span>{t('license.machineId')}</span></label>
        <div className="machine-id">
          <code dir="ltr">{license.machine}</code>
          <button type="button" onClick={async () => { await copyText(license.machine); setCopied(true); }}>{copied ? `✓ ${t('license.copied')}` : t('license.copy')}</button>
        </div>
        <label className="field">
          <span>{t('license.key')}</span>
          <textarea dir="ltr" className="mono" rows={5} value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJwcm9kdWN0Ijoi…" autoFocus />
        </label>
        {error && <p className="warn">{error}</p>}
        <button className="primary lg" disabled={busy || !key.trim()}>{t('license.activate')}</button>
      </form>
    </div>
  );
}
