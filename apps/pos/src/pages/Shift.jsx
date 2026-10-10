import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, toMinor } from '../lib/money.js';
import { shiftHtml } from '../lib/receipt.js';
import { Field, useApp, useLoad } from '../components/ui.jsx';

export default function Shift() {
  const { t, tErr, notify, settings, shift, reloadShift, printDoc, lang, isAdmin, setPage } = useApp();
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [summary] = useLoad(() => (shift ? api.shifts.summary(shift.id) : Promise.resolve(null)), [shift?.id]);
  const [history] = useLoad(() => (isAdmin ? api.shifts.list({}) : Promise.resolve([])), [shift?.id]);
  const m = (v) => formatMoney(v, settings);

  async function close(e) {
    e.preventDefault();
    if (!window.confirm(t('common.areYouSure'))) return;
    try {
      const result = await api.shifts.close({ countedCash: toMinor(counted, settings.decimals), notes });
      await printDoc(shiftHtml(result, settings, t, lang));
      await reloadShift();
      setPage('pos');
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }

  const diff = summary ? toMinor(counted, settings.decimals) - summary.expectedCash : 0;

  return (
    <div className="page">
      <div className="page-head"><h2>⏱ {t('nav.shift')}</h2></div>
      {!shift ? (
        <div className="card narrow">
          <p>{t('shift.none')}</p>
          <button className="primary" onClick={() => setPage('pos')}>{t('shift.open')}</button>
        </div>
      ) : summary && (
        <div className="two-col">
          <div className="card">
            <h3>{t('shift.current')} #{summary.shift.id}</h3>
            <dl className="kv">
              <dt>{t('shift.by')}</dt><dd>{summary.shift.user_name}</dd>
              <dt>{t('shift.openedAt')}</dt><dd>{summary.shift.opened_at}</dd>
              <dt>{t('shift.openingCash')}</dt><dd>{m(summary.shift.opening_cash)}</dd>
              <dt>{t('shift.salesCount')}</dt><dd>{summary.sales.count}</dd>
              <dt>{t('shift.sales')}</dt><dd><b>{m(summary.sales.total)}</b></dd>
              {summary.byMethod.map((b) => <React.Fragment key={b.method}><dt>{t(`pay.${b.method}`)}</dt><dd>{m(b.amount)}</dd></React.Fragment>)}
              <dt>{t('shift.refunds')}</dt><dd>{summary.refunds.count} — {m(summary.refunds.total)}</dd>
              <dt>{t('shift.expectedCash')}</dt><dd><b>{m(summary.expectedCash)}</b></dd>
            </dl>
            <button onClick={() => printDoc(shiftHtml(summary, settings, t, lang))}>🖨 {t('common.print')}</button>
          </div>
          <form className="card" onSubmit={close}>
            <h3>{t('shift.close')}</h3>
            <Field label={t('shift.countedCash')}><input className="xl" required inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
            {counted !== '' && <p className={diff < 0 ? 'warn' : diff > 0 ? 'good' : ''}>{t('shift.difference')}: <b>{m(diff)}</b></p>}
            <Field label={t('shift.notes')}><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <button className="danger lg">{t('shift.close')}</button>
          </form>
        </div>
      )}

      {isAdmin && !!history?.length && (
        <div className="card flush">
          <h3 className="pad">{t('shift.history')}</h3>
          <table className="grid">
            <thead><tr><th>#</th><th>{t('shift.by')}</th><th>{t('shift.openedAt')}</th><th>{t('shift.closedAt')}</th><th className="num">{t('shift.expectedCash')}</th><th className="num">{t('shift.countedCash')}</th><th className="num">{t('shift.difference')}</th></tr></thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td><td>{s.user_name}</td><td>{s.opened_at}</td><td>{s.closed_at || '—'}</td>
                  <td className="num">{s.expected_cash != null ? m(s.expected_cash) : ''}</td>
                  <td className="num">{s.counted_cash != null ? m(s.counted_cash) : ''}</td>
                  <td className={`num ${s.counted_cash - s.expected_cash < 0 ? 'warn' : ''}`}>{s.counted_cash != null ? m(s.counted_cash - s.expected_cash) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
