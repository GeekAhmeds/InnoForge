import React, { useCallback, useEffect, useState } from 'react';
import { api, zatcaOnboard, zatcaRun } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';
import { Field, Modal, Toggle, useApp } from './ui.jsx';

/** "ZATCA_MISSING: zatca_city,…" or a code → readable text. */
export function zatcaErrorText(text, t) {
  const m = /^ZATCA_MISSING:?\s*(.*)$/.exec(String(text || ''));
  if (m) return t('err.ZATCA_MISSING', { 0: m[1].split(',').filter(Boolean).map((k) => t(`zatcaKey.${k}`)).join('، ') });
  return text;
}
const zErr = (err, t, tErr) => (err.code === 'ZATCA_MISSING' ? zatcaErrorText(`ZATCA_MISSING: ${err.message}`, t) : `${tErr(err)}${err.code === 'ZATCA_COMPLIANCE' || err.code === 'ZATCA_ONBOARD' ? ` — ${err.message}` : ''}`);

const FIELDS = ['zatca_name', 'zatca_crn', 'zatca_id_scheme', 'zatca_street', 'zatca_building', 'zatca_plot', 'zatca_district', 'zatca_city', 'zatca_postal', 'zatca_branch', 'zatca_industry'];

/**
 * Settings → FATOORA (Saudi Arabia): the seller's registered details, registering this
 * computer with ZATCA (OTP from the FATOORA portal) and switching stamping on.
 */
export default function ZatcaSettings() {
  const { t, tErr, notify, settings, reloadSettings } = useApp();
  const [f, setF] = useState(() => ({ ...settings }));
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const onboarded = !!settings.zatca_cert && settings.zatca_onboarded_env === f.zatca_env;

  const save = async (patch = {}) => {
    try {
      const keys = [...FIELDS, 'zatca_env', 'zatca_b2b', 'zatca_auto', 'zatca_enabled'];
      await api.settings.save({ ...Object.fromEntries(keys.map((k) => [k, f[k]])), ...patch });
      await reloadSettings();
      notify(t('common.saved'));
      return true;
    } catch (err) { notify(zErr(err, t, tErr), 'error'); return false; }
  };
  const register = async () => {
    setBusy(true);
    setResult(null);
    try {
      if (!(await save({ zatca_enabled: false }))) return;
      const r = await zatcaOnboard({ otp });
      setResult(r);
      setOtp('');
      await reloadSettings();
      notify(t('zatca.onboarded'));
    } catch (err) { notify(zErr(err, t, tErr), 'error'); } finally { setBusy(false); }
  };
  const showPreview = async () => {
    try { if (await save()) setPreview(await api.zatca.preview({})); } catch (err) { notify(zErr(err, t, tErr), 'error'); }
  };

  return (
    <form className="eta-settings" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="card">
        <h3>🇸🇦 {t('zatca.title')}</h3>
        <p className="muted small">{t('zatca.intro')}</p>
        <ol className="muted small eta-steps">
          <li>{t('zatca.step1')}</li><li>{t('zatca.step2')}</li><li>{t('zatca.step3')}</li><li>{t('zatca.step4')}</li>
        </ol>
        {!settings.tax_number && <p className="warn">{t('zatca.needVat')}</p>}
        <div className="grid3">
          <Field label={t('zatca.env')} hint={t('zatca.envHint')}>
            <select value={f.zatca_env} onChange={set('zatca_env')}>
              {['sandbox', 'simulation', 'production'].map((x) => <option key={x} value={x}>{t(`zatca.env.${x}`)}</option>)}
            </select>
          </Field>
          <div><Toggle checked={f.zatca_b2b} onChange={set('zatca_b2b')} label={t('zatca.b2b')} /><small className="muted">{t('zatca.b2bHint')}</small></div>
          <div><Toggle checked={f.zatca_auto} onChange={set('zatca_auto')} label={t('zatca.auto')} /></div>
        </div>
      </div>

      <div className="card">
        <h3>{t('zatca.seller')}</h3>
        <div className="grid3">
          <Field label={t('zatcaKey.zatca_name')} hint={t('zatca.nameHint')}><input value={f.zatca_name} onChange={set('zatca_name')} placeholder={settings.business_name} /></Field>
          <Field label={t('zatcaKey.tax_number')}><input dir="ltr" value={settings.tax_number} disabled /></Field>
          <Field label={t('zatcaKey.zatca_crn')}>
            <div className="row">
              <select value={f.zatca_id_scheme} onChange={set('zatca_id_scheme')} style={{ maxWidth: 90 }}>
                {['CRN', 'MOM', 'MLS', 'SAG', '700', 'OTH'].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <input dir="ltr" value={f.zatca_crn} onChange={set('zatca_crn')} />
            </div>
          </Field>
          <Field label={t('zatcaKey.zatca_street')}><input value={f.zatca_street} onChange={set('zatca_street')} /></Field>
          <Field label={t('zatcaKey.zatca_building')} hint={t('zatca.fourDigits')}><input dir="ltr" inputMode="numeric" maxLength={4} value={f.zatca_building} onChange={set('zatca_building')} /></Field>
          <Field label={t('zatcaKey.zatca_plot')} hint={t('zatca.fourDigits')}><input dir="ltr" inputMode="numeric" maxLength={4} value={f.zatca_plot} onChange={set('zatca_plot')} /></Field>
          <Field label={t('zatcaKey.zatca_district')}><input value={f.zatca_district} onChange={set('zatca_district')} /></Field>
          <Field label={t('zatcaKey.zatca_city')}><input value={f.zatca_city} onChange={set('zatca_city')} /></Field>
          <Field label={t('zatcaKey.zatca_postal')} hint={t('zatca.fiveDigits')}><input dir="ltr" inputMode="numeric" maxLength={5} value={f.zatca_postal} onChange={set('zatca_postal')} /></Field>
          <Field label={t('zatca.branch')} hint={t('zatca.branchHint')}><input value={f.zatca_branch} onChange={set('zatca_branch')} /></Field>
          <Field label={t('zatca.industry')}><input value={f.zatca_industry} onChange={set('zatca_industry')} placeholder="Retail" /></Field>
        </div>
      </div>

      <div className="card">
        <h3>{t('zatca.device')}</h3>
        {onboarded ? (
          <p className="ok-text">✓ {t('zatca.registered', { env: t(`zatca.env.${settings.zatca_onboarded_env}`) })}{settings.zatca_cert_expires ? ` — ${t('zatca.certUntil', { d: settings.zatca_cert_expires })}` : ''}</p>
        ) : (
          <p className="muted small">{t('zatca.notRegistered')}</p>
        )}
        <div className="row">
          <Field label={t('zatca.otp')} hint={t(f.zatca_env === 'sandbox' ? 'zatca.otpSandbox' : 'zatca.otpHint')}>
            <input dir="ltr" inputMode="numeric" maxLength={8} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="123456" />
          </Field>
          <button type="button" disabled={busy || !otp} onClick={register}>🔐 {busy ? t('zatca.registering') : onboarded ? t('zatca.registerAgain') : t('zatca.register')}</button>
        </div>
        {result?.checks && (
          <ul className="small">
            {result.checks.map((c, i) => <li key={i} className={c.status === 'PASS' ? 'ok-text' : 'warn'}>{c.standard ? 'B2B' : 'B2C'} — {t(`zatca.kind.${c.kind}`)}: {c.status}{c.warnings ? ` (${c.warnings})` : ''}</li>)}
          </ul>
        )}
        <div className="top-gap">
          <Toggle checked={!!f.zatca_enabled} onChange={(v) => { setF((x) => ({ ...x, zatca_enabled: v })); save({ zatca_enabled: v }); }} label={t('zatca.enable')} />
          <small className="muted">{t('zatca.enableHint')}</small>
        </div>
      </div>

      <div className="card row">
        <button className="primary">{t('common.save')}</button>
        <button type="button" onClick={showPreview}>👁 {t('zatca.preview')}</button>
      </div>
      {preview && (
        <Modal title={`${t('zatca.preview')} — #${preview.invoice_no} (${preview.standard ? 'B2B' : 'B2C'})`} onClose={() => setPreview(null)} width={820}>
          <pre className="json" dir="ltr">{preview.xml.replace(/></g, '>\n<')}</pre>
        </Modal>
      )}
    </form>
  );
}

const STATUS_CLASS = { reported: 'ok', cleared: 'ok', warning: 'info', pending: 'info', error: 'bad', rejected: 'bad', skipped: 'muted' };

/** FATOORA page: every stamped document, what ZATCA said, and what needs attention. */
export function ZatcaPage() {
  const { t, tErr, notify, settings, can, ask } = useApp();
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const m = (v) => formatMoney(v, settings);

  const load = useCallback(async () => {
    try {
      setSummary(await api.zatca.summary());
      setRows(await api.zatca.list({ status: filter, search }));
    } catch (err) { notify(tErr(err), 'error'); }
  }, [filter, search, notify, tErr]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => { try { await fn(); await load(); } catch (err) { notify(tErr(err), 'error'); } };
  const sendNow = async () => {
    setBusy(true);
    try {
      const r = await zatcaRun();
      if (r?.last && !r.last.ok) notify(`${t('zatca.sendFailed')}: ${r.last.message}`, 'error');
      else notify(t('zatca.sent', { n: r?.sent || 0, r: r?.rejected || 0 }));
    } catch (err) { notify(tErr(err), 'error'); } finally { setBusy(false); load(); }
  };
  const addOld = async () => {
    const no = await ask(t('zatca.addOld'), { type: 'number', required: true });
    if (no) act(() => api.zatca.add({ invoiceNo: Number(no) }));
  };
  const download = (d) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([d.xml], { type: 'application/xml' }));
    a.download = `${d.doc_no}_${d.uuid}.xml`;
    a.click();
  };

  const counts = summary?.counts || {};
  const needs = (counts.error || 0) + (counts.rejected || 0);
  const late = summary?.oldest_pending && Date.now() - new Date(summary.oldest_pending.replace(' ', 'T')).getTime() > 20 * 3600 * 1000;
  return (
    <div className="page">
      <div className="page-head">
        <h2>🇸🇦 {t('nav.zatca')}</h2>
        <div className="row">
          {can('settings') && <button onClick={addOld}>＋ {t('zatca.addOld')}</button>}
          <button className="primary" disabled={busy} onClick={sendNow}>📤 {busy ? t('zatca.sending') : t('zatca.sendNow')}</button>
        </div>
      </div>
      {summary && !summary.ready && <p className="warn card">{t('zatca.notReady')}</p>}
      {summary?.missing?.length > 0 && <p className="warn card">{zatcaErrorText(`ZATCA_MISSING: ${summary.missing.join(',')}`, t)}</p>}
      {late && <p className="warn card">⏰ {t('zatca.late')}</p>}
      {summary?.unstamped > 0 && <p className="warn card">{t('zatca.unstamped', { n: summary.unstamped })}</p>}
      {summary?.env !== 'production' && summary?.ready && <p className="muted card small">🧪 {t('zatca.testNote', { env: t(`zatca.env.${summary.env}`) })}</p>}
      <div className="stats">
        {[['pending', counts.pending || 0], ['reported', counts.reported || 0], ['cleared', counts.cleared || 0], ['warning', counts.warning || 0], ['attention', needs]].map(([k, n]) => (
          <button key={k} className={`stat ${filter === k ? 'on' : ''}`} onClick={() => setFilter(filter === k ? '' : k)}>
            <b>{n}</b><span>{t(`zatca.status.${k}`)}</span>
          </button>
        ))}
      </div>
      <div className="card">
        <div className="row">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">{t('eta.all')}</option>
            {['attention', 'pending', 'reported', 'cleared', 'warning', 'rejected', 'error', 'skipped'].map((s) => <option key={s} value={s}>{t(`zatca.status.${s}`)}</option>)}
          </select>
          <input placeholder={t('zatca.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <table className="table top-gap">
          <thead><tr><th>#</th><th>{t('zatca.docNo')}</th><th>{t('common.date')}</th><th>{t('eta.type')}</th><th>{t('eta.customer')}</th><th>{t('common.total')}</th><th>{t('common.status')}</th><th>{t('eta.reason')}</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="muted">{d.icv}</td>
                <td>{d.doc_no}</td>
                <td dir="ltr">{d.created_at}</td>
                <td>{t(`zatca.kind.${d.kind}`)} {d.standard ? 'B2B' : ''}</td>
                <td>{d.customer || d.customer_name || '—'}</td>
                <td>{m(d.total)}</td>
                <td><span className={`badge eta-${STATUS_CLASS[d.status] || 'info'}`}>{t(`zatca.status.${d.status}`)}</span></td>
                <td className="small eta-error" title={d.error}>{d.error}</td>
                <td className="row">
                  <button className="ghost" onClick={() => api.zatca.get(d.id).then(setOpen).catch((err) => notify(tErr(err), 'error'))}>👁</button>
                  {can('settings') && ['error', 'skipped'].includes(d.status) && <button onClick={() => act(() => api.zatca.retry(d.id))}>↻ {t('eta.retry')}</button>}
                  {can('settings') && ['rejected', 'error'].includes(d.status) && <button onClick={() => window.confirm(t('zatca.restampWarn')) && act(() => api.zatca.restamp(d.id))}>🔁 {t('zatca.restamp')}</button>}
                  {can('settings') && ['pending', 'error', 'rejected'].includes(d.status) && <button className="danger-ghost" onClick={() => window.confirm(t('zatca.skipWarn')) && act(() => api.zatca.skip(d.id))}>{t('eta.skip')}</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="muted">{t('zatca.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal title={`${open.doc_no} — ${t(`zatca.kind.${open.kind}`)}`} onClose={() => setOpen(null)} width={820}>
          <dl className="kv">
            <dt>{t('common.status')}</dt><dd>{t(`zatca.status.${open.status}`)}</dd>
            <dt>UUID</dt><dd className="mono small" dir="ltr">{open.uuid}</dd>
            <dt>{t('zatca.counter')}</dt><dd>{open.icv}</dd>
            <dt>Hash</dt><dd className="mono small" dir="ltr">{open.hash}</dd>
            {open.sent_at && <><dt>{t('eta.submittedAt')}</dt><dd dir="ltr">{open.sent_at}</dd></>}
            {open.error && <><dt>{t('eta.reason')}</dt><dd className="warn">{open.error}</dd></>}
          </dl>
          <button onClick={() => download(open)}>⬇ XML</button>
        </Modal>
      )}
    </div>
  );
}
