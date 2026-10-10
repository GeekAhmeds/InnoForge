import React, { useEffect, useState } from 'react';
import { appVersion, onUpdateState, updateCheck, updateInstall, updateState } from '../lib/api.js';

/** Live updater state from the main process. */
export function useUpdateState() {
  const [state, setState] = useState(null);
  useEffect(() => {
    updateState().then(setState).catch(() => {});
    return onUpdateState(setState);
  }, []);
  return state;
}

/** Shown on every screen once a verified update has been downloaded. */
export function UpdateBanner({ t }) {
  const state = useUpdateState();
  const [hidden, setHidden] = useState(false);
  if (state?.status !== 'ready' || hidden) return null;
  return (
    <div className="update-banner" role="status">
      <span>⬆️ {t('update.ready', { v: state.version })}</span>
      <span className="spacer" />
      <button className="ghost" onClick={() => setHidden(true)}>{t('update.later')}</button>
      <button className="primary" onClick={() => updateInstall()}>{t('update.installNow')}</button>
    </div>
  );
}

/** Version and update controls for Settings → Support. */
export function UpdatePanel({ t }) {
  const state = useUpdateState();
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { appVersion().then(setVersion).catch(() => {}); }, []);
  const status = state?.status || 'idle';
  const text = {
    disabled: t('update.disabled'),
    idle: t('update.idle'),
    checking: t('update.checking'),
    latest: t('update.latest'),
    downloading: t('update.downloading', { v: state?.version || '', p: state?.percent ?? 0 }),
    ready: t('update.ready', { v: state?.version || '' }),
    error: t('update.error'),
    rejected: t('update.rejected', { v: state?.version || '' }),
  }[status];
  return (
    <div className="update-panel">
      <h3>{t('update.title')}</h3>
      <dl className="kv">
        <dt>{t('update.current')}</dt><dd className="mono" dir="ltr">v{version}</dd>
        <dt>{t('update.status')}</dt><dd className={status === 'error' || status === 'rejected' ? 'warn' : status === 'ready' ? 'good' : ''}>{text}</dd>
      </dl>
      <div className="row">
        {status === 'ready'
          ? <button className="primary" onClick={() => updateInstall()}>{t('update.installNow')}</button>
          : <button disabled={busy || status === 'disabled' || status === 'checking' || status === 'downloading'} onClick={async () => { setBusy(true); try { await updateCheck(); } finally { setBusy(false); } }}>🔄 {t('update.check')}</button>}
      </div>
      <p className="muted small">{t('update.hint')}</p>
    </div>
  );
}
