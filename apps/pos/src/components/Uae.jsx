import React, { useCallback, useEffect, useState } from 'react';
import { api, uaeExport, uaeRun } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';
import { Field, Modal, Toggle, useApp } from './ui.jsx';

export const EMIRATES = ['AUH', 'DXB', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ'];
const FIELDS = ['uae_name', 'uae_tl', 'uae_tl_authority', 'uae_street', 'uae_city', 'uae_emirate', 'uae_mode', 'uae_asp_url', 'uae_asp_header', 'uae_asp_key', 'uae_auto', 'uae_enabled'];
const missingText = (keys, t) => t('err.UAE_MISSING', { 0: keys.map((k) => t(`uaeKey.${k}`)).join('، ') });

/** Settings → UAE e-invoice: the business as registered, and how documents reach its ASP. */
export default function UaeSettings() {
  const { t, tErr, notify, settings, reloadSettings } = useApp();
  const [f, setF] = useState(() => ({ ...settings, uae_asp_key: '' }));
  const [preview, setPreview] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const save = async (e) => {
    e?.preventDefault();
    try {
      await api.settings.save(Object.fromEntries(FIELDS.map((k) => [k, f[k]])));
      await reloadSettings();
      setF((x) => ({ ...x, uae_asp_key: '' }));
      notify(t('common.saved'));
      return true;
    } catch (err) { notify(err.code === 'UAE_MISSING' ? missingText(err.message.split(','), t) : tErr(err), 'error'); return false; }
  };
  const showPreview = async () => {
    try { if (await save()) setPreview(await api.uae.preview({})); } catch (err) { notify(err.code === 'UAE_MISSING' ? missingText(err.message.split(','), t) : tErr(err), 'error'); }
  };
  return (
    <form className="eta-settings" onSubmit={save}>
      <div className="card">
        <h3>🇦🇪 {t('uae.title')}</h3>
        <p className="muted small">{t('uae.intro')}</p>
        <Toggle checked={f.uae_enabled} onChange={set('uae_enabled')} label={t('uae.enable')} />
        {!settings.tax_number && <p className="warn">{t('uae.needTrn')}</p>}
      </div>
      <div className="card">
        <h3>{t('uae.seller')}</h3>
        <div className="grid3">
          <Field label={t('uaeKey.uae_name')}><input value={f.uae_name} onChange={set('uae_name')} placeholder={settings.business_name} /></Field>
          <Field label={t('uaeKey.tax_number')}><input dir="ltr" value={settings.tax_number} disabled /></Field>
          <Field label={t('uae.tl')}><input dir="ltr" value={f.uae_tl} onChange={set('uae_tl')} /></Field>
          <Field label={t('uae.tlAuthority')}><input value={f.uae_tl_authority} onChange={set('uae_tl_authority')} placeholder="DED Dubai" /></Field>
          <Field label={t('uaeKey.uae_street')}><input value={f.uae_street} onChange={set('uae_street')} /></Field>
          <Field label={t('uaeKey.uae_city')}><input value={f.uae_city} onChange={set('uae_city')} /></Field>
          <Field label={t('uaeKey.uae_emirate')}>
            <select value={f.uae_emirate} onChange={set('uae_emirate')}><option value="">—</option>{EMIRATES.map((x) => <option key={x} value={x}>{t(`emirate.${x}`)}</option>)}</select>
          </Field>
        </div>
      </div>
      <div className="card">
        <h3>{t('uae.delivery')}</h3>
        <div className="grid3">
          <Field label={t('uae.mode')} hint={t('uae.modeHint')}>
            <select value={f.uae_mode} onChange={set('uae_mode')}><option value="export">{t('uae.mode.export')}</option><option value="asp">{t('uae.mode.asp')}</option></select>
          </Field>
          {f.uae_mode === 'asp' && <>
            <Field label={t('uae.aspUrl')}><input dir="ltr" value={f.uae_asp_url} onChange={set('uae_asp_url')} placeholder="https://api.asp.ae/v1/documents" /></Field>
            <Field label={t('uae.aspHeader')}><input dir="ltr" value={f.uae_asp_header} onChange={set('uae_asp_header')} /></Field>
            <Field label={t('uae.aspKey')}><input dir="ltr" type="password" autoComplete="new-password" value={f.uae_asp_key} onChange={set('uae_asp_key')} placeholder={settings.uae_asp_key_set ? t('eta.secretSaved') : 'Bearer …'} /></Field>
            <div><Toggle checked={f.uae_auto} onChange={set('uae_auto')} label={t('zatca.auto')} /></div>
          </>}
        </div>
      </div>
      <div className="card row">
        <button className="primary">{t('common.save')}</button>
        <button type="button" onClick={showPreview}>👁 {t('zatca.preview')}</button>
      </div>
      {preview && (
        <Modal title={`${t('zatca.preview')} — #${preview.invoice_no}`} onClose={() => setPreview(null)} width={820}>
          <pre className="json" dir="ltr">{preview.xml.replace(/></g, '>\n<')}</pre>
        </Modal>
      )}
    </form>
  );
}

const STATUS_CLASS = { sent: 'ok', exported: 'ok', pending: 'info', error: 'bad', rejected: 'bad', skipped: 'muted' };

/** UAE e-invoice page: B2B documents and their delivery to the ASP. */
export function UaePage() {
  const { t, tErr, notify, settings, can, ask } = useApp();
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const m = (v) => formatMoney(v, settings);
  const load = useCallback(async () => {
    try { setSummary(await api.uae.summary()); setRows(await api.uae.list({ status: filter })); } catch (err) { notify(tErr(err), 'error'); }
  }, [filter, notify, tErr]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn) => { try { await fn(); await load(); } catch (err) { notify(tErr(err), 'error'); } };
  const send = async () => {
    setBusy(true);
    try {
      if (summary?.mode === 'asp') {
        const r = await uaeRun();
        notify(r?.last && !r.last.ok ? `${t('zatca.sendFailed')}: ${r.last.message}` : t('zatca.sent', { n: r.sent || 0, r: r.rejected || 0 }), r?.last && !r.last.ok ? 'error' : undefined);
      } else {
        const r = await uaeExport();
        if (r.count) notify(t('uae.exported', { n: r.count }));
      }
    } catch (err) { notify(tErr(err), 'error'); } finally { setBusy(false); load(); }
  };
  const download = async (id) => {
    const d = await api.uae.get(id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([d.xml], { type: 'application/xml' }));
    a.download = `${d.doc_no}_${d.uuid}.xml`;
    a.click();
  };
  const addOld = async () => {
    const no = await ask(t('zatca.addOld'), { type: 'number', required: true });
    if (no) act(() => api.uae.add({ invoiceNo: Number(no) }));
  };
  const counts = summary?.counts || {};
  return (
    <div className="page">
      <div className="page-head">
        <h2>🇦🇪 {t('nav.uae')}</h2>
        <div className="row">
          {can('settings') && <button onClick={addOld}>＋ {t('zatca.addOld')}</button>}
          <button className="primary" disabled={busy} onClick={send}>{summary?.mode === 'asp' ? `📤 ${t('zatca.sendNow')}` : `💾 ${t('uae.exportNow')}`}</button>
        </div>
      </div>
      {summary?.missing?.length > 0 && <p className="warn card">{missingText(summary.missing, t)}</p>}
      <p className="muted card small">{t('uae.pageNote')}</p>
      <div className="stats">
        {[['pending', counts.pending || 0], ['sent', (counts.sent || 0) + (counts.exported || 0)], ['attention', (counts.error || 0) + (counts.rejected || 0)]].map(([k, n]) => (
          <button key={k} className={`stat ${filter === k ? 'on' : ''}`} onClick={() => setFilter(filter === k ? '' : k)}><b>{n}</b><span>{t(`uae.status.${k}`)}</span></button>
        ))}
      </div>
      <div className="card">
        <table className="table">
          <thead><tr><th>{t('zatca.docNo')}</th><th>{t('common.date')}</th><th>{t('eta.type')}</th><th>{t('eta.customer')}</th><th>{t('common.total')}</th><th>{t('common.status')}</th><th>{t('eta.reason')}</th><th /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td>{d.doc_no}</td><td dir="ltr">{d.created_at}</td><td>{t(`zatca.kind.${d.kind}`)}</td><td>{d.customer || '—'}</td><td>{m(d.total)}</td>
                <td><span className={`badge eta-${STATUS_CLASS[d.status] || 'info'}`}>{t(`uae.status.${d.status}`)}</span></td>
                <td className="small eta-error" title={d.error}>{d.error}</td>
                <td className="row">
                  <button className="ghost" onClick={() => download(d.id).catch((err) => notify(tErr(err), 'error'))}>⬇ XML</button>
                  {can('settings') && ['error', 'rejected', 'skipped'].includes(d.status) && <button onClick={() => act(() => api.uae.retry(d.id))}>↻ {t('eta.retry')}</button>}
                  {can('settings') && ['pending', 'error', 'rejected'].includes(d.status) && <button className="danger-ghost" onClick={() => window.confirm(t('zatca.skipWarn')) && act(() => api.uae.skip(d.id))}>{t('eta.skip')}</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="muted">{t('zatca.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
