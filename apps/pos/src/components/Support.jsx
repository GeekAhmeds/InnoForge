import React from 'react';
import { VENDOR, whatsappUrl } from '../lib/vendor.js';

/** Vendor contact block; links open in the system browser / WhatsApp. */
export default function Support({ t, compact = false }) {
  return (
    <div className={`support ${compact ? 'compact' : ''}`}>
      {!compact && <h3>{t('support.title')}</h3>}
      <p className="muted">{t('support.intro', { name: VENDOR.name })}</p>
      <div className="support-links">
        {VENDOR.phones.map((p) => (
          <a key={p} className="support-link" href={whatsappUrl(p)} target="_blank" rel="noreferrer">
            <span>📞</span><span dir="ltr">{p}</span><small>{t('support.whatsapp')}</small>
          </a>
        ))}
        <a className="support-link" href={VENDOR.website} target="_blank" rel="noreferrer">
          <span>🌐</span><span dir="ltr">{VENDOR.websiteLabel}</span>
        </a>
      </div>
    </div>
  );
}
