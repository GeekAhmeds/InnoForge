import React, { useState } from 'react';
import { activate, copyText } from '../lib/api.js';
import { VENDOR } from '../lib/vendor.js';
import { Modal, useApp } from './ui.jsx';
import { COUNTRY_FLAGS, countryName } from '../lib/countries.js';

// Every feature a license can include, in the order they are listed.
export const FEATURES = ['restaurant', 'delivery', 'trading', 'rebates', 'installments', 'treasury', 'warehouses', 'purchase_orders', 'employees',
  'promotions', 'coupons', 'scale', 'labels', 'batches', 'customer_display', 'lan', 'excel', 'commissions', 'eta', 'zatca', 'uae_einvoice'];

/** Settings → License: who it is for, the edition, what it includes and its limits; update the key. */
export default function LicenseTab() {
  const { t, tErr, notify, license, setLicense, lang } = useApp();
  const [renewing, setRenewing] = useState(false);
  const [newKey, setNewKey] = useState('');
  async function renew() {
    try {
      setLicense(await activate(newKey));
      setRenewing(false);
      setNewKey('');
      notify(t('license.updated'));
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }
  if (!license) return null;
  const owned = new Set(license.features || []);
  const limit = (k) => (license.limits?.[k] ? license.limits[k] : t('license.unlimited'));
  return (
    <div className="license-tab">
      <div className="card">
        <div className="row between">
          <div>
            <h3>🔑 {t('license.info')}</h3>
            <div className="edition-badge">{t(`edition.${license.edition || 'full'}`)}</div>
          </div>
          {license.required && (
            <div className="row">
              <button onClick={() => copyText(license.machine).then(() => notify(t('license.copied')))}>{t('license.copy')} {t('license.machineId')}</button>
              <button className="primary" onClick={() => setRenewing(true)}>🔑 {t('license.update')}</button>
            </div>
          )}
        </div>
        {license.required ? (
          <dl className="kv top-gap">
            <dt>{t('license.customer')}</dt><dd>{license.customer || '—'}</dd>
            <dt>{t('license.machineId')}</dt><dd className="mono" dir="ltr">{license.machine}</dd>
            <dt>{t('license.expires')}</dt><dd>{license.expires ? new Date(license.expires).toLocaleDateString('en-GB') : t('license.lifetime')}</dd>
            {license.country && <><dt>{t('country.title')}</dt><dd>{COUNTRY_FLAGS[license.country]} {countryName(license.country, lang)}</dd></>}
            <dt>{t('license.soldBy')}</dt><dd>{(() => { const by = license.seller || license.reseller; return by ? `${by.name}${by.phone ? ` — ${by.phone}` : ''}` : VENDOR.name; })()}</dd>
            <dt>{t('limit.users')}</dt><dd>{limit('users')}</dd>
            <dt>{t('limit.warehouses')}</dt><dd>{limit('warehouses')}</dd>
            <dt>{t('limit.devices')}</dt><dd>{limit('devices')}</dd>
          </dl>
        ) : <p className="muted">{license.client ? t('net.licenseFromMain', { server: license.server }) : t('license.devMode')} — {t(`edition.${license.edition || 'full'}`)}</p>}
      </div>
      <div className="card top-gap">
        <h3>{t('license.features')}</h3>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f} className={`feature ${owned.has(f) ? 'on' : 'off'}`}>
              <span>{owned.has(f) ? '✓' : '🔒'}</span>
              <span>{t(`feat.${f}`)}</span>
            </div>
          ))}
        </div>
        {FEATURES.some((f) => !owned.has(f)) && <p className="muted small top-gap">{t('license.upgradeHint', { phone: VENDOR.phones.join(' / ') })}</p>}
      </div>
      {renewing && (
        <Modal title={t('license.update')} onClose={() => setRenewing(false)}
          footer={<><span className="spacer" /><button onClick={() => setRenewing(false)}>{t('common.cancel')}</button><button className="primary" disabled={!newKey.trim()} onClick={renew}>{t('license.activate')}</button></>}>
          <p className="muted">{t('license.updateHint')}</p>
          <textarea dir="ltr" className="mono" rows={5} autoFocus value={newKey} onChange={(e) => setNewKey(e.target.value)} />
        </Modal>
      )}
    </div>
  );
}
