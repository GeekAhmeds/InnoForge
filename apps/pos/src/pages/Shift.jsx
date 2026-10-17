import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, toMinor } from '../lib/money.js';
import { shiftHtml } from '../lib/receipt.js';
import { Field, useApp, useLoad } from '../components/ui.jsx';
import { ExpenseModal } from './Purchases.jsx';
import { AccountSelect } from './Treasury.jsx';
import { OpenShifts, ShiftDetail } from '../components/ShiftMonitor.jsx';

export default function Shift() {
  const { t, tErr, notify, settings, shift, reloadShift, printDoc, lang, can, setPage } = useApp();
  const isAdmin = can('shifts_all');
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [deposit, setDeposit] = useState({ accountId: null, amount: '' });
  const [expense, setExpense] = useState(false);
  // Managers: their own shift, every open shift (live), and the history.
  const [view, setView] = useState('mine');
  const [detailId, setDetailId] = useState(null);
  const [summary, reloadSummary] = useLoad(() => (shift ? api.shifts.summary(shift.id) : Promise.resolve(null)), [shift?.id]);
  const [history] = useLoad(() => (isAdmin ? api.shifts.list({}) : Promise.resolve([])), [shift?.id]);
  const m = (v) => formatMoney(v, settings);

  async function close(e) {
    e.preventDefault();
    if (!window.confirm(t('common.areYouSure'))) return;
    try {
      const result = await api.shifts.close({ countedCash: toMinor(counted, settings.decimals), notes, depositAccountId: deposit.accountId, depositAmount: deposit.accountId ? toMinor(deposit.amount === '' ? counted : deposit.amount, settings.decimals) : 0 });
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
      <div className="page-head">
        <h2>⏱ {t('nav.shift')}</h2>
        {isAdmin && (
          <div className="seg">
            <button className={view === 'mine' ? 'on' : ''} onClick={() => setView('mine')}>{t('shift.current')}</button>
            <button className={view === 'open' ? 'on' : ''} onClick={() => setView('open')}>🖥 {t('monitor.title')}</button>
            <button className={view === 'history' ? 'on' : ''} onClick={() => setView('history')}>{t('shift.history')}</button>
          </div>
        )}
      </div>
      {view === 'open' && <OpenShifts onOpen={setDetailId} />}
      {detailId && <ShiftDetail id={detailId} onClose={() => setDetailId(null)} onChanged={reloadShift} />}
      {view !== 'mine' ? null : !shift ? (
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
              {!!summary.supplierCash && <><dt>{t('shift.supplierCash')}</dt><dd>− {m(summary.supplierCash)}</dd></>}
              {!!summary.expenseCash && <><dt>{t('shift.expenseCash')}</dt><dd>− {m(summary.expenseCash)}</dd></>}
              {!!summary.customerCash && <><dt>{t('shift.customerCash')}</dt><dd>+ {m(summary.customerCash)}</dd></>}
              {!!summary.giftCash && <><dt>🎁 {t('shift.giftCash')}</dt><dd>+ {m(summary.giftCash)}</dd></>}
              {!!summary.creditSales && <><dt>{t('shift.creditSales')}</dt><dd>{m(summary.creditSales)}</dd></>}
              <dt>{t('shift.expectedCash')}</dt><dd><b>{m(summary.expectedCash)}</b></dd>
            </dl>
            <div className="row">
              <button onClick={() => printDoc(shiftHtml(summary, settings, t, lang))}>🖨 {t('common.print')}</button>
              <button onClick={() => setExpense(true)}>💸 {t('expenses.newDrawer')}</button>
            </div>
            {expense && <ExpenseModal onClose={() => setExpense(false)} onSaved={() => { setExpense(false); reloadSummary(); }} />}
          </div>
          <form className="card" onSubmit={close}>
            <h3>{t('shift.close')}</h3>
            <Field label={t('shift.countedCash')}><input className="xl" required inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
            {counted !== '' && <p className={diff < 0 ? 'warn' : diff > 0 ? 'good' : ''}>{t('shift.difference')}: <b>{m(diff)}</b></p>}
            {can('treasury') && (
              <div className="grid2">
                <Field label={t('shift.depositTo')}><AccountSelect kind="cash" value={deposit.accountId} onChange={(v) => setDeposit({ ...deposit, accountId: v })} none={t('shift.noDeposit')} /></Field>
                {deposit.accountId && <Field label={t('shift.depositAmount')} hint={t('shift.depositHint')}><input inputMode="decimal" value={deposit.amount} placeholder={counted || '0'} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} /></Field>}
              </div>
            )}
            <Field label={t('shift.notes')}><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <button className="danger lg">{t('shift.close')}</button>
          </form>
        </div>
      )}

      {isAdmin && view === 'history' && !!history?.length && (
        <div className="card flush">
          <h3 className="pad">{t('shift.history')}</h3>
          <table className="grid">
            <thead><tr><th>#</th><th>{t('monitor.computer')}</th><th>{t('shift.by')}</th><th>{t('shift.openedAt')}</th><th>{t('shift.closedAt')}</th><th className="num">{t('shift.expectedCash')}</th><th className="num">{t('shift.countedCash')}</th><th className="num">{t('shift.difference')}</th></tr></thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => setDetailId(s.id)}>
                  <td>{s.id}</td><td>{s.device_name || s.device_id}</td><td>{s.user_name}</td><td>{s.opened_at}</td><td>{s.closed_at || '—'}</td>
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
