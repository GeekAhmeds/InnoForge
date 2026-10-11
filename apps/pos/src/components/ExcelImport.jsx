import React, { useState } from 'react';
import { api, excelExport, excelPick, excelTemplate } from '../lib/api.js';
import { Empty, Modal, Toggle, useApp } from './ui.jsx';

const PREVIEW_FIELDS = {
  products: ['name', 'barcode', 'category', 'price', 'cost', 'stock', 'unit'],
  customers: ['name', 'phone', 'address', 'credit_limit', 'opening_balance'],
  suppliers: ['name', 'phone', 'address', 'opening_balance'],
};

/** Import from an Excel sheet: template → pick file → preview → import → result. */
export function ExcelImportModal({ kind, onClose, onDone }) {
  const { t, tErr, notify } = useApp();
  const [data, setData] = useState(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  const pick = () => run(async () => { const d = await excelPick(kind); if (d) { setData(d); setResult(null); } });
  const template = () => run(async () => { const f = await excelTemplate(kind); if (f) notify(t('excel.saved', { path: f })); });
  const doImport = () => run(async () => {
    setBusy(true);
    try {
      const r = await api.importer[kind]({ rows: data.rows, updateExisting });
      setResult(r);
      onDone?.();
    } finally {
      setBusy(false);
    }
  });

  const fields = PREVIEW_FIELDS[kind].filter((f) => data?.fields.includes(f));
  return (
    <Modal title={`📥 ${t('excel.importTitle')} — ${t(`excel.kind.${kind}`)}`} onClose={onClose} width={880}
      footer={<>
        <button onClick={template}>⬇️ {t('excel.template')}</button>
        <span className="spacer" />
        {data && !result && <Toggle checked={updateExisting} onChange={setUpdateExisting} label={t('excel.updateExisting')} />}
        <button onClick={pick}>📂 {data ? t('excel.otherFile') : t('excel.chooseFile')}</button>
        {data && !result && <button className="primary" disabled={busy || !data.rows.length || data.missing.length} onClick={doImport}>{t('excel.import', { n: data.rows.length })}</button>}
      </>}>
      {!data && (
        <div className="excel-intro">
          <ol>
            <li>{t('excel.step1')}</li>
            <li>{t('excel.step2')}</li>
            <li>{t('excel.step3')}</li>
          </ol>
          <p className="muted small">{t(`excel.hint.${kind}`)}</p>
        </div>
      )}
      {data && !result && (
        <>
          <p><b>{data.file}</b> — {t('excel.rowsFound', { n: data.rows.length })}</p>
          {!!data.missing.length && <p className="warn">{t('excel.missingName')}</p>}
          {!!data.unknown.length && <p className="muted small">{t('excel.ignored')}: {data.unknown.join('، ')}</p>}
          <div className="excel-preview">
            <table className="grid">
              <thead><tr><th>#</th>{fields.map((f) => <th key={f}>{t(`excel.field.${f}`)}</th>)}</tr></thead>
              <tbody>
                {data.rows.slice(0, 50).map((r) => <tr key={r.__row}><td className="muted">{r.__row}</td>{fields.map((f) => <td key={f}>{String(r[f] ?? '')}</td>)}</tr>)}
              </tbody>
            </table>
            {data.rows.length > 50 && <p className="muted small pad">{t('excel.more', { n: data.rows.length - 50 })}</p>}
            {!data.rows.length && <Empty>{t('common.none')}</Empty>}
          </div>
        </>
      )}
      {result && (
        <div className="excel-result">
          <div className="stats">
            <div className="stat"><small>{t('excel.created')}</small><b className="good">{result.created}</b></div>
            <div className="stat"><small>{t('excel.updated')}</small><b>{result.updated}</b></div>
            <div className="stat"><small>{t('excel.skipped')}</small><b>{result.skipped}</b></div>
            <div className="stat"><small>{t('excel.errors')}</small><b className={result.errors.length ? 'warn' : ''}>{result.errors.length}</b></div>
          </div>
          {!!result.errors.length && (
            <table className="grid">
              <thead><tr><th>{t('excel.row')}</th><th>{t('common.name')}</th><th>{t('excel.problem')}</th></tr></thead>
              <tbody>{result.errors.map((e) => <tr key={e.row}><td>{e.row}</td><td>{e.name || '—'}</td><td className="warn">{tErr(e)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Import/export buttons for a page toolbar. */
export function ExcelButtons({ kind, exportKind = kind, params = {}, onImported, importable = true }) {
  const { t, tErr, notify, can } = useApp();
  const [open, setOpen] = useState(false);
  if (!can('backup') && exportKind !== 'invoices' && exportKind !== 'report') return null;
  const doExport = async () => {
    try { const f = await excelExport({ kind: exportKind, ...params }); if (f) notify(t('excel.saved', { path: f })); } catch (err) { notify(tErr(err), 'error'); }
  };
  return (
    <>
      {importable && can('backup') && <button onClick={() => setOpen(true)}>📥 {t('excel.importBtn')}</button>}
      <button onClick={doExport}>📤 {t('excel.exportBtn')}</button>
      {open && <ExcelImportModal kind={kind} onClose={() => setOpen(false)} onDone={onImported} />}
    </>
  );
}
