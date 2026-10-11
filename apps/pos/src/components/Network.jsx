import React, { useCallback, useEffect, useState } from 'react';
import { api, copyText, network, networkConnect, networkDisconnect, networkServe } from '../lib/api.js';
import { Field, Modal, Toggle, useApp } from './ui.jsx';
import { useI18n } from '../i18n/index.jsx';

/**
 * Settings → Network: several computers on one set of data. One computer is the main
 * computer (it keeps the database); the others connect to it on the shop network, or from
 * a branch over a VPN such as Tailscale.
 */
export default function Network() {
  const { t, tErr, notify, license } = useApp();
  const [info, setInfo] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const load = useCallback(() => network().then(setInfo).catch((err) => notify(tErr(err), 'error')), [notify, tErr]);
  useEffect(() => { load(); }, [load]);
  if (!info) return null;

  const serve = async (patch) => {
    try {
      await networkServe({ enabled: info.mode === 'server', port: info.serve.port, ...patch });
      await load();
      notify(t('common.saved'));
    } catch (err) { notify(tErr(err), 'error'); }
  };
  const disconnect = async () => {
    if (!window.confirm(t('net.disconnectWarn'))) return;
    try { await networkDisconnect(); } catch (err) { notify(tErr(err), 'error'); }
  };

  return (
    <>
      <div className="card">
        <h3>🖧 {t('net.title')}</h3>
        <p className="muted small">{t('net.intro')}</p>
        <dl className="kv top-gap">
          <dt>{t('net.thisDevice')}</dt><dd>{info.name || '—'}</dd>
          <dt>{t('net.mode')}</dt><dd><span className="badge">{t(`net.mode.${info.mode}`)}</span></dd>
          <dt>{t('limit.devices')}</dt><dd>{license?.limits?.devices ? license.limits.devices : t('license.unlimited')}</dd>
        </dl>
      </div>

      {info.mode === 'client' && (
        <div className="card">
          <h3>🔗 {t('net.connectedTo')}</h3>
          <dl className="kv">
            <dt>{t('net.address')}</dt><dd className="mono" dir="ltr">{info.server.host}:{info.server.port}</dd>
            <dt>{t('net.status')}</dt><dd>{info.remote?.connected ? <span className="ok-text">✓ {t('net.online')}</span> : <span className="warn">✕ {t('net.offline')}</span>}</dd>
            {info.remote?.connected && <><dt>{t('net.mainName')}</dt><dd>{info.remote.business_name} — {info.remote.server_name}</dd></>}
            {info.remote?.connected && <><dt>{t('net.mainVersion')}</dt><dd dir="ltr">{info.remote.version}</dd></>}
          </dl>
          {info.remote?.connected && info.remote.version !== info.version && <p className="warn">{t('net.versionMismatch', { mine: info.version, main: info.remote.version })}</p>}
          <p className="muted small">{t('net.clientHint')}</p>
          <div className="row"><button onClick={load}>↻ {t('net.check')}</button><span className="spacer" /><button className="danger-ghost" onClick={disconnect}>{t('net.disconnect')}</button></div>
        </div>
      )}

      {info.mode !== 'client' && (
        <div className="card">
          <h3>🏠 {t('net.mainTitle')}</h3>
          <p className="muted small">{t('net.mainHint')}</p>
          <Toggle checked={info.mode === 'server'} onChange={(on) => serve({ enabled: on })} label={t('net.enableMain')} />
          {info.mode === 'server' && (
            <>
              <div className="grid3 top-gap">
                <Field label={t('net.port')}>
                  <input dir="ltr" type="number" defaultValue={info.serve.port} onBlur={(e) => Number(e.target.value) !== info.serve.port && serve({ port: Number(e.target.value) })} />
                </Field>
                <Field label={t('net.key')} hint={t('net.keyHint')}>
                  <div className="row">
                    <input dir="ltr" readOnly className="mono" value={info.serve.key} />
                    <button type="button" onClick={() => copyText(info.serve.key).then(() => notify(t('license.copied')))}>{t('license.copy')}</button>
                  </div>
                </Field>
                <Field label=" ">
                  <button type="button" onClick={() => window.confirm(t('net.newKeyWarn')) && serve({ newKey: true })}>🔑 {t('net.newKey')}</button>
                </Field>
              </div>
              <p className={info.serve.running ? 'ok-text' : 'warn'}>
                {info.serve.running ? `✓ ${t('net.running')}` : `✕ ${t('net.notRunning')} ${info.serve.error || ''}`}
              </p>
              {info.serve.running && (
                <div className="muted small">
                  {t('net.addresses')}{' '}
                  {info.serve.addresses.map((a) => <code key={a} dir="ltr" className="addr">{a}:{info.serve.port}</code>)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {info.mode === 'standalone' && (
        <div className="card">
          <h3>🔗 {t('net.joinTitle')}</h3>
          <p className="muted small">{t('net.joinHint')}</p>
          <button className="primary" onClick={() => setConnecting(true)}>{t('net.join')}</button>
        </div>
      )}

      {info.mode !== 'standalone' && <DeviceList />}
      {connecting && <ConnectModal initialName={info.name} onClose={() => setConnecting(false)} />}
    </>
  );
}

/** The computers that use the main computer's data: rename, block, allow again. */
function DeviceList() {
  const { t, tErr, notify, ask } = useApp();
  const [list, setList] = useState([]);
  const load = useCallback(() => api.devices.list().then(setList).catch((err) => notify(tErr(err), 'error')), [notify, tErr]);
  useEffect(() => { load(); }, [load]);
  const save = async (d, patch) => {
    try { await api.devices.save({ id: d.id, name: d.name, active: d.active, ...patch }); await load(); } catch (err) { notify(tErr(err), 'error'); }
  };
  return (
    <div className="card">
      <div className="row between"><h3>💻 {t('net.devices')}</h3><button onClick={load}>↻</button></div>
      <table className="table">
        <thead><tr><th>{t('net.deviceName')}</th><th>{t('net.kind')}</th><th>{t('net.lastSeen')}</th><th>{t('net.openShift')}</th><th>{t('common.status')}</th><th /></tr></thead>
        <tbody>
          {list.map((d) => (
            <tr key={d.id} className={d.active ? '' : 'muted'}>
              <td>{d.name || '—'}{d.me && <span className="badge">{t('net.me')}</span>}</td>
              <td>{t(d.kind === 'main' ? 'net.kind.main' : 'net.kind.client')}</td>
              <td dir="ltr">{d.kind === 'main' ? '—' : d.last_seen || '—'}</td>
              <td>{d.open_shifts ? '✓' : '—'}</td>
              <td>{d.active ? t('net.allowed') : t('net.blocked')}</td>
              <td className="row">
                <button className="ghost" onClick={async () => { const name = await ask(t('net.deviceName'), { initial: d.name, required: true }); if (name) save(d, { name }); }}>✎</button>
                {d.kind !== 'main' && (d.active
                  ? <button className="danger-ghost" onClick={() => window.confirm(t('net.blockWarn')) && save(d, { active: false })}>{t('net.block')}</button>
                  : <button onClick={() => save(d, { active: true })}>{t('net.allow')}</button>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Address + key of the main computer; the app restarts connected to it. */
// Also used by the activation screen, which has no app context yet.
export function ConnectModal({ onClose, initialName = '' }) {
  const { t, tErr } = useI18n();
  const [f, setF] = useState({ host: '', port: 7790, key: '', name: initialName });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await networkConnect(f);
      setError(t('net.restarting'));
    } catch (err) {
      setError(tErr(err));
      setBusy(false);
    }
  };
  return (
    <Modal title={t('net.join')} onClose={onClose}
      footer={<><span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" disabled={busy || !f.host.trim() || !f.key.trim()} onClick={submit}>{t('net.connect')}</button></>}>
      <p className="muted small">{t('net.joinSteps')}</p>
      <div className="grid2">
        <Field label={t('net.address')} hint={t('net.addressHint')}><input dir="ltr" autoFocus value={f.host} onChange={set('host')} placeholder="192.168.1.10" /></Field>
        <Field label={t('net.port')}><input dir="ltr" type="number" value={f.port} onChange={set('port')} /></Field>
      </div>
      <Field label={t('net.key')}><input dir="ltr" className="mono" value={f.key} onChange={set('key')} /></Field>
      <Field label={t('net.thisDeviceName')} hint={t('net.thisDeviceNameHint')}><input value={f.name} onChange={set('name')} /></Field>
      <p className="muted small">{t('net.joinWarn')}</p>
      {error && <p className="warn">{error}</p>}
    </Modal>
  );
}
