import React, { useCallback, useEffect, useState } from 'react';
import { api, etaRun, etaTest } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';
import { Field, Modal, Toggle, useApp } from './ui.jsx';

const SECRETS = ['eta_client_secret', 'eta_pos_client_secret', 'eta_pos_key'];

/** "ETA_MISSING: eta_rin,eta_city" (from the queue or an error) → readable text. */
export function etaErrorText(text, t) {
  const m = /^ETA_MISSING:?\s*(.*)$/.exec(String(text || ''));
  if (m) return t('err.ETA_MISSING', { 0: m[1].split(',').filter(Boolean).map((k) => t(`etaKey.${k}`)).join('، ') });
  const code = /^([A-Z_]+)(?::\s*(.*))?$/.exec(String(text || ''));
  if (code && t(`err.${code[1]}`) !== `err.${code[1]}`) return `${t(`err.${code[1]}`)}${code[2] ? ` — ${code[2]}` : ''}`;
  return text;
}
const etaErr = (err, t, tErr) => (err.code === 'ETA_MISSING' ? etaErrorText(`ETA_MISSING: ${err.message}`, t) : tErr(err));

/**
 * Settings → E-invoice: everything the business fills in itself to send e-invoices (companies)
 * and e-receipts (walk-in customers) to the Egyptian Tax Authority.
 */
export default function EtaSettings() {
  const { t, tErr, notify, settings, reloadSettings } = useApp();
  const [f, setF] = useState(() => ({ ...settings, ...Object.fromEntries(SECRETS.map((k) => [k, ''])) }));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  const save = async (e) => {
    e?.preventDefault();
    try {
      const keys = Object.keys(f).filter((k) => k.startsWith('eta_') && !k.endsWith('_set'));
      await api.settings.save(Object.fromEntries(keys.map((k) => [k, f[k]])));
      await reloadSettings();
      setF((x) => ({ ...x, ...Object.fromEntries(SECRETS.map((k) => [k, ''])) }));
      notify(t('common.saved'));
      return true;
    } catch (err) { notify(tErr(err), 'error'); return false; }
  };
  const test = async () => {
    setBusy(true);
    setTestResult(null);
    try { if (await save()) setTestResult(await etaTest()); } catch (err) { notify(tErr(err), 'error'); } finally { setBusy(false); }
  };
  const showPreview = async () => {
    try { if (await save()) setPreview(await api.eta.preview({})); } catch (err) { notify(etaErr(err, t, tErr), 'error'); }
  };
  const secret = (k) => (
    <input dir="ltr" type="password" autoComplete="new-password" value={f[k]} onChange={set(k)} placeholder={settings[`${k}_set`] ? t('eta.secretSaved') : ''} />
  );

  return (
    <form className="eta-settings" onSubmit={save}>
      <div className="card">
        <h3>🏛 {t('eta.title')}</h3>
        <p className="muted small">{t('eta.intro')}</p>
        <ol className="muted small eta-steps">
          <li>{t('eta.step1')}</li><li>{t('eta.step2')}</li><li>{t('eta.step3')}</li><li>{t('eta.step4')}</li>
        </ol>
        <Toggle checked={f.eta_enabled} onChange={set('eta_enabled')} label={t('eta.enable')} />
        {f.eta_enabled && (
          <div className="grid3 top-gap">
            <Field label={t('eta.env')} hint={t('eta.envHint')}>
              <select value={f.eta_env} onChange={set('eta_env')}><option value="preprod">{t('eta.env.preprod')}</option><option value="prod">{t('eta.env.prod')}</option></select>
            </Field>
            <div><Toggle checked={f.eta_invoice} onChange={set('eta_invoice')} label={t('eta.invoices')} /><small className="muted">{t('eta.invoicesHint')}</small></div>
            <div><Toggle checked={f.eta_receipt} onChange={set('eta_receipt')} label={t('eta.receipts')} /><small className="muted">{t('eta.receiptsHint')}</small></div>
            <div className="span3"><Toggle checked={f.eta_auto} onChange={set('eta_auto')} label={t('eta.auto')} /></div>
          </div>
        )}
      </div>

      {f.eta_enabled && (
        <>
          <div className="card">
            <h3>{t('eta.taxpayer')}</h3>
            <div className="grid3">
              <Field label={t('eta.rin')} hint={t('eta.rinHint')}><input dir="ltr" value={f.eta_rin} onChange={set('eta_rin')} /></Field>
              <Field label={t('eta.name')}><input value={f.eta_name} onChange={set('eta_name')} placeholder={settings.business_name} /></Field>
              <Field label={t('eta.activity')} hint={t('eta.activityHint')}><input dir="ltr" value={f.eta_activity} onChange={set('eta_activity')} /></Field>
              <Field label={t('eta.branch')} hint={t('eta.branchHint')}><input dir="ltr" value={f.eta_branch} onChange={set('eta_branch')} /></Field>
              <Field label={t('eta.governate')}><input value={f.eta_governate} onChange={set('eta_governate')} /></Field>
              <Field label={t('eta.city')}><input value={f.eta_city} onChange={set('eta_city')} /></Field>
              <Field label={t('eta.street')}><input value={f.eta_street} onChange={set('eta_street')} /></Field>
              <Field label={t('eta.building')}><input value={f.eta_building} onChange={set('eta_building')} /></Field>
            </div>
          </div>

          {f.eta_invoice && (
            <div className="card">
              <h3>{t('eta.invoiceCreds')}</h3>
              <p className="muted small">{t('eta.invoiceCredsHint')}</p>
              <div className="grid2">
                <Field label={t('eta.clientId')}><input dir="ltr" value={f.eta_client_id} onChange={set('eta_client_id')} /></Field>
                <Field label={t('eta.clientSecret')}>{secret('eta_client_secret')}</Field>
                <Field label={t('eta.signer')} hint={t('eta.signerHint')}>
                  <select value={f.eta_signer} onChange={set('eta_signer')}>
                    {['none', 'url', 'command'].map((x) => <option key={x} value={x}>{t(`eta.signer.${x}`)}</option>)}
                  </select>
                </Field>
                {f.eta_signer === 'url' && <Field label={t('eta.signerUrl')} hint={t('eta.signerUrlHint')}><input dir="ltr" value={f.eta_signer_url} onChange={set('eta_signer_url')} placeholder="http://127.0.0.1:8085/sign" /></Field>}
                {f.eta_signer === 'command' && <Field label={t('eta.signerCmd')} hint={t('eta.signerCmdHint')}><input dir="ltr" className="mono" value={f.eta_signer_cmd} onChange={set('eta_signer_cmd')} /></Field>}
              </div>
            </div>
          )}

          {f.eta_receipt && (
            <div className="card">
              <h3>{t('eta.posCreds')}</h3>
              <p className="muted small">{t('eta.posCredsHint')}</p>
              <div className="grid3">
                <Field label={t('eta.posSerial')}><input dir="ltr" value={f.eta_pos_serial} onChange={set('eta_pos_serial')} /></Field>
                <Field label={t('eta.posOs')}><input dir="ltr" value={f.eta_pos_os} onChange={set('eta_pos_os')} /></Field>
                <Field label={t('eta.posModel')}><input dir="ltr" value={f.eta_pos_model} onChange={set('eta_pos_model')} /></Field>
                <Field label={t('eta.clientId')}><input dir="ltr" value={f.eta_pos_client_id} onChange={set('eta_pos_client_id')} /></Field>
                <Field label={t('eta.clientSecret')}>{secret('eta_pos_client_secret')}</Field>
                <Field label={t('eta.posKey')}>{secret('eta_pos_key')}</Field>
              </div>
            </div>
          )}

          <div className="card">
            <h3>{t('eta.codes')}</h3>
            <p className="muted small">{t('eta.codesHint')}</p>
            <div className="grid3">
              <Field label={t('eta.itemType')}><select value={f.eta_item_type} onChange={set('eta_item_type')}><option value="EGS">EGS</option><option value="GS1">GS1</option></select></Field>
              <Field label={t('eta.itemCode')} hint={t('eta.itemCodeHint')}><input dir="ltr" value={f.eta_item_code} onChange={set('eta_item_code')} placeholder="EG-123456789-1001" /></Field>
              <Field label={t('eta.unit')} hint={t('eta.unitHint')}><input dir="ltr" value={f.eta_unit} onChange={set('eta_unit')} /></Field>
              <Field label={t('eta.taxSubtype')} hint={t('eta.taxSubtypeHint')}><input dir="ltr" value={f.eta_tax_subtype} onChange={set('eta_tax_subtype')} /></Field>
              <Field label={t('eta.taxSubtypeZero')}><input dir="ltr" value={f.eta_tax_subtype_zero} onChange={set('eta_tax_subtype_zero')} /></Field>
            </div>
          </div>
        </>
      )}

      <div className="card row">
        <button className="primary">{t('common.save')}</button>
        {f.eta_enabled && <button type="button" disabled={busy} onClick={test}>🔌 {t('eta.test')}</button>}
        {f.eta_enabled && <button type="button" onClick={showPreview}>👁 {t('eta.preview')}</button>}
        {testResult && (
          <span className="small">
            {Object.entries(testResult).filter(([k]) => k !== 'last').map(([k, v]) => (
              <span key={k} className={v.ok ? 'ok-text' : 'warn'}>{t(`eta.kind.${k}`)}: {v.ok ? `✓ ${t('eta.loginOk')}` : `✕ ${v.message}`} </span>
            ))}
            {!Object.keys(testResult).some((k) => k !== 'last') && t('eta.nothingToTest')}
          </span>
        )}
      </div>
      {preview && (
        <Modal title={`${t('eta.preview')} — #${preview.invoice_no} (${t(`eta.kind.${preview.kind}`)})`} onClose={() => setPreview(null)} width={820}>
          <pre className="json" dir="ltr">{JSON.stringify(preview.document, null, 2)}</pre>
        </Modal>
      )}
    </form>
  );
}

const STATUS_CLASS = { valid: 'ok', submitted: 'info', pending: 'info', error: 'bad', rejected: 'bad', invalid: 'bad', skipped: 'muted', cancelled: 'muted' };
const docKind = (d) => ({ I: 'invoice', C: 'credit', S: 'receipt', R: 'return' })[d.doc_type] || d.kind;

/** E-invoice page: what was sent, what ETA said, and what needs attention. */
export function EtaPage() {
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
      setSummary(await api.eta.summary());
      setRows(await api.eta.list({ status: filter, search }));
    } catch (err) { notify(tErr(err), 'error'); }
  }, [filter, search, notify, tErr]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn) => { try { await fn(); await load(); } catch (err) { notify(tErr(err), 'error'); } };
  const sendNow = async () => {
    setBusy(true);
    try {
      const r = await etaRun();
      if (r?.last && !r.last.ok) notify(`${t('eta.sendFailed')}: ${etaErrorText(r.last.message, t)}`, 'error');
      else notify(t('eta.sent', { n: (r?.invoices || 0) + (r?.receipts || 0) }));
    } catch (err) { notify(tErr(err), 'error'); } finally { setBusy(false); load(); }
  };
  const addOld = async () => {
    const no = await ask(t('eta.addOld'), { type: 'number', required: true });
    if (no) act(() => api.eta.add({ invoiceNo: Number(no) }));
  };

  const counts = summary?.counts || {};
  const needs = (counts.error || 0) + (counts.rejected || 0) + (counts.invalid || 0);
  return (
    <div className="page">
      <div className="page-head">
        <h2>🏛 {t('nav.eta')}</h2>
        <div className="row">
          {can('settings') && <button onClick={addOld}>＋ {t('eta.addOld')}</button>}
          <button className="primary" disabled={busy} onClick={sendNow}>📤 {busy ? t('eta.sending') : t('eta.sendNow')}</button>
        </div>
      </div>
      {summary && !summary.enabled && <p className="warn card">{t('eta.disabled')}</p>}
      {summary && [...summary.missing.invoice, ...summary.missing.receipt].length > 0 && (
        <p className="warn card">{t('eta.missing')}: {[...new Set([...summary.missing.invoice, ...summary.missing.receipt])].map((k) => t(`etaKey.${k}`)).join('، ')}</p>
      )}
      {summary?.env === 'preprod' && summary.enabled && <p className="muted card small">🧪 {t('eta.preprodNote')}</p>}
      <div className="stats">
        {[['pending', counts.pending || 0], ['submitted', counts.submitted || 0], ['valid', counts.valid || 0], ['attention', needs]].map(([k, n]) => (
          <button key={k} className={`stat ${filter === k ? 'on' : ''}`} onClick={() => setFilter(filter === k ? '' : k)}>
            <b>{n}</b><span>{t(`eta.status.${k}`)}</span>
          </button>
        ))}
      </div>
      <div className="card">
        <div className="row">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">{t('eta.all')}</option>
            {['attention', 'pending', 'submitted', 'valid', 'invalid', 'rejected', 'error', 'skipped'].map((s) => <option key={s} value={s}>{t(`eta.status.${s}`)}</option>)}
          </select>
          <input placeholder={t('eta.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <table className="table top-gap">
          <thead><tr><th>{t('eta.invoiceNo')}</th><th>{t('common.date')}</th><th>{t('eta.type')}</th><th>{t('eta.customer')}</th><th>{t('common.total')}</th><th>{t('common.status')}</th><th>{t('eta.reason')}</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>#{d.invoice_no}</td>
                <td dir="ltr">{d.created_at}</td>
                <td>{t(`eta.kind.${docKind(d)}`)}</td>
                <td>{d.customer || d.customer_name || '—'}</td>
                <td>{m(d.total)}</td>
                <td><span className={`badge eta-${STATUS_CLASS[d.status] || 'info'}`}>{t(`eta.status.${d.status}`)}</span></td>
                <td className="small eta-error" title={etaErrorText(d.error, t)}>{etaErrorText(d.error, t)}</td>
                <td className="row">
                  <button className="ghost" onClick={() => api.eta.get(d.id).then(setOpen).catch((err) => notify(tErr(err), 'error'))}>👁</button>
                  {can('settings') && ['error', 'rejected', 'invalid', 'skipped'].includes(d.status) && <button onClick={() => act(() => api.eta.retry(d.id))}>↻ {t('eta.retry')}</button>}
                  {can('settings') && ['pending', 'error', 'rejected', 'invalid'].includes(d.status) && <button className="danger-ghost" onClick={() => window.confirm(t('eta.skipWarn')) && act(() => api.eta.skip(d.id))}>{t('eta.skip')}</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="muted">{t('eta.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      {open && (
        <Modal title={`#${open.invoice_no} — ${t(`eta.kind.${docKind(open)}`)}`} onClose={() => setOpen(null)} width={820}>
          <dl className="kv">
            <dt>{t('common.status')}</dt><dd>{t(`eta.status.${open.status}`)}</dd>
            {open.uuid && <><dt>UUID</dt><dd className="mono small" dir="ltr">{open.uuid}</dd></>}
            {open.submitted_at && <><dt>{t('eta.submittedAt')}</dt><dd dir="ltr">{open.submitted_at}</dd></>}
            {open.error && <><dt>{t('eta.reason')}</dt><dd className="warn">{etaErrorText(open.error, t)}</dd></>}
          </dl>
          {open.portal && open.status === 'valid' && <p><a href={open.portal} target="_blank" rel="noreferrer">🌐 {t('eta.openPortal')}</a></p>}
          {open.payload && <pre className="json" dir="ltr">{JSON.stringify(open.payload, null, 2)}</pre>}
        </Modal>
      )}
    </div>
  );
}
