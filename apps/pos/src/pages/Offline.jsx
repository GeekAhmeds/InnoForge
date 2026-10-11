import React, { useState } from 'react';
import { networkDisconnect } from '../lib/api.js';
import { useI18n } from '../i18n/index.jsx';
import BrandHead from '../components/Brand.jsx';
import Support from '../components/Support.jsx';

// This computer works on a main computer's data, and the main computer cannot be reached.
export default function Offline({ license }) {
  const { t, tErr } = useI18n();
  const [error, setError] = useState('');
  const leave = async () => {
    if (!window.confirm(t('net.disconnectWarn'))) return;
    try { await networkDisconnect(); } catch (err) { setError(tErr(err)); }
  };
  return (
    <div className="center-screen">
      <div className="card activation offline-screen">
        <BrandHead title={t('net.offlineTitle')} />
        <p>{t('net.offlineText')}</p>
        <p className="mono" dir="ltr">{license.server}</p>
        <ul className="muted small" style={{ textAlign: 'start' }}>
          <li>{t('net.offlineTip1')}</li>
          <li>{t('net.offlineTip2')}</li>
          <li>{t('net.offlineTip3')}</li>
        </ul>
        {error && <p className="warn">{error}</p>}
        <div className="row center">
          <button className="primary lg" onClick={() => window.location.reload()}>↻ {t('net.retry')}</button>
          <button className="ghost" onClick={leave}>{t('net.disconnect')}</button>
        </div>
        <Support t={t} compact />
      </div>
    </div>
  );
}
