import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, toMinor } from '../lib/money.js';
import { shiftHtml } from '../lib/receipt.js';
import { Empty, Field, Modal, useApp, useLoad } from './ui.jsx';
import { OrderModal } from '../pages/Orders.jsx';

const REFRESH_MS = 15000;

/** How long ago, in minutes / hours, for "last sale 5 min ago". */
function ago(ts, t) {
  if (!ts) return '—';
  const min = Math.max(0, Math.round((Date.now() - new Date(ts.replace(' ', 'T')).getTime()) / 60000));
  return min < 60 ? t('monitor.minAgo', { n: min }) : t('monitor.hAgo', { n: Math.floor(min / 60) });
}

const deviceLabel = (s, t) => (s.me ? `${t('monitor.thisComputer')}${s.device_name ? ` — ${s.device_name}` : ''}` : s.device_name || s.device_id);

/** Every shift open right now on every computer, refreshed by itself. */
export function OpenShifts({ onOpen }) {
  const { t, settings } = useApp();
  const m = (v) => formatMoney(v, settings);
  const [list, reload] = useLoad(() => api.shifts.live(), []);
  useEffect(() => { const h = setInterval(reload, REFRESH_MS); return () => clearInterval(h); }, [reload]);
  if (!list) return null;
  if (!list.length) return <div className="card"><Empty>{t('monitor.none')}</Empty></div>;
  const all = list.reduce((a, s) => ({ sales: a.sales + s.sales.total, count: a.count + s.sales.count, cash: a.cash + s.expectedCash, refunds: a.refunds + s.refunds.total }), { sales: 0, count: 0, cash: 0, refunds: 0 });
  return (
    <>
      <div className="stat-row">
        <div className="stat"><small>{t('monitor.open')}</small><b>{list.length}</b></div>
        <div className="stat"><small>{t('shift.sales')}</small><b>{m(all.sales)}</b><small>{t('monitor.invoices', { n: all.count })}</small></div>
        <div className="stat"><small>{t('monitor.cashInDrawers')}</small><b>{m(all.cash)}</b></div>
        <div className="stat"><small>{t('shift.refunds')}</small><b>{m(all.refunds)}</b></div>
      </div>
      <div className="shift-cards">
        {list.map((s) => (
          <button key={s.id} type="button" className={`card shift-card ${s.me ? 'me' : ''}`} onClick={() => onOpen(s.id)}>
            <div className="row between"><b>🖥 {deviceLabel(s, t)}</b><small className="muted">#{s.id}</small></div>
            <div className="muted small">👤 {s.user_name}{s.cashiers.filter((n) => n !== s.user_name).length ? ` + ${s.cashiers.filter((n) => n !== s.user_name).join('، ')}` : ''} · {t('shift.openedAt')} {s.opened_at.slice(11, 16)}</div>
            <div className="shift-figs">
              <div><small>{t('shift.sales')}</small><b>{m(s.sales.total)}</b><small>{t('monitor.invoices', { n: s.sales.count })}</small></div>
              <div><small>{t('shift.expectedCash')}</small><b>{m(s.expectedCash)}</b></div>
              <div><small>{t('shift.refunds')}</small><b className={s.refunds.total ? 'warn' : ''}>{m(s.refunds.total)}</b><small>{s.refunds.count ? t('monitor.times', { n: s.refunds.count }) : ''}</small></div>
            </div>
            <div className="muted small">🕒 {t('monitor.lastSale')}: {ago(s.lastSaleAt, t)}{s.openOrders ? ` · 📋 ${t('monitor.openOrders', { n: s.openOrders })}` : ''}{s.creditSales ? ` · ${t('shift.creditSales')} ${m(s.creditSales)}` : ''}</div>
          </button>
        ))}
      </div>
      <p className="muted small">ℹ {t('monitor.howToUse')}</p>
    </>
  );
}

/** One shift: its figures, invoices (open any of them to reprint or return), returns and what happened. */
export function ShiftDetail({ id, onClose, onChanged = () => {} }) {
  const { t, tErr, notify, settings, printDoc, lang } = useApp();
  const m = (v) => formatMoney(v, settings);
  const [d, reload] = useLoad(() => api.shifts.detail(id), [id]);
  const [tab, setTab] = useState('orders');
  const [openOrder, setOpenOrder] = useState(null);
  const [closing, setClosing] = useState(false);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => { if (d && !d.shift.closed_at) { const h = setInterval(reload, REFRESH_MS); return () => clearInterval(h); } return undefined; }, [d?.shift.closed_at, reload]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  const s = d.shift;
  const open = !s.closed_at;
  const diff = toMinor(counted, settings.decimals) - d.expectedCash;

  async function closeIt() {
    if (!window.confirm(t('monitor.closeConfirm'))) return;
    try {
      const result = await api.shifts.closeOther({ id: s.id, countedCash: toMinor(counted, settings.decimals), notes });
      await printDoc(shiftHtml(result, settings, t, lang));
      notify(t('monitor.closed'));
      onChanged();
      onClose();
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }

  return (
    <Modal title={`⏱ ${t('monitor.shift')} #${s.id} — ${deviceLabel(s, t)}`} onClose={onClose} width={980}
      footer={closing ? (
        <>
          <Field label={t('shift.countedCash')}><input autoFocus inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
          {counted !== '' && <span className={diff < 0 ? 'warn' : diff > 0 ? 'good' : ''}>{t('shift.difference')}: <b>{m(diff)}</b></span>}
          <Field label={t('shift.notes')}><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <span className="spacer" />
          <button type="button" onClick={() => setClosing(false)}>{t('common.cancel')}</button>
          <button type="button" className="danger" disabled={counted === ''} onClick={closeIt}>{t('shift.close')}</button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => printDoc(shiftHtml(d, settings, t, lang))}>🖨 {t('monitor.printX')}</button>
          <span className="spacer" />
          {open && !s.me && <button type="button" className="danger-ghost" onClick={() => setClosing(true)}>🔒 {t('monitor.closeRemote')}</button>}
        </>
      )}>
      <div className="shift-detail">
        <dl className="kv">
          <dt>{t('shift.by')}</dt><dd>{s.user_name}</dd>
          <dt>{t('shift.openedAt')}</dt><dd>{s.opened_at}</dd>
          {s.closed_at && <><dt>{t('shift.closedAt')}</dt><dd>{s.closed_at}</dd></>}
          <dt>{t('shift.openingCash')}</dt><dd>{m(s.opening_cash)}</dd>
          <dt>{t('shift.sales')}</dt><dd><b>{m(d.sales.total)}</b> ({d.sales.count})</dd>
          {d.byMethod.map((b) => <React.Fragment key={b.method}><dt>{t(`pay.${b.method}`)}</dt><dd>{m(b.amount)}</dd></React.Fragment>)}
          <dt>{t('shift.refunds')}</dt><dd>{d.refunds.count} — {m(d.refunds.total)}</dd>
          {!!d.expenseCash && <><dt>{t('shift.expenseCash')}</dt><dd>− {m(d.expenseCash)}</dd></>}
          {!!d.supplierCash && <><dt>{t('shift.supplierCash')}</dt><dd>− {m(d.supplierCash)}</dd></>}
          {!!d.customerCash && <><dt>{t('shift.customerCash')}</dt><dd>+ {m(d.customerCash)}</dd></>}
          {!!d.creditSales && <><dt>{t('shift.creditSales')}</dt><dd>{m(d.creditSales)}</dd></>}
          <dt>{t('shift.expectedCash')}</dt><dd><b>{m(d.expectedCash)}</b></dd>
          {s.counted_cash != null && <><dt>{t('shift.countedCash')}</dt><dd>{m(s.counted_cash)} ({t('shift.difference')} {m(s.counted_cash - s.expected_cash)})</dd></>}
        </dl>
        <div>
          <div className="seg">
            <button type="button" className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>🧾 {t('monitor.invoicesTab')} ({d.orders.length})</button>
            <button type="button" className={tab === 'returns' ? 'on' : ''} onClick={() => setTab('returns')}>↩ {t('shift.refunds')} ({d.returnsList.length})</button>
            <button type="button" className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>👁 {t('monitor.activity')} ({d.activity.length})</button>
          </div>
          <div className="excel-preview">
            {tab === 'orders' && (d.orders.length ? (
              <table className="grid compact">
                <thead><tr><th>#</th><th>{t('orders.date')}</th><th>{t('receipt.cashier')}</th><th>{t('pos.customer')}</th><th>{t('monitor.paidBy')}</th><th className="num">{t('common.total')}</th></tr></thead>
                <tbody>{d.orders.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => setOpenOrder(o.id)}>
                    <td><b>{o.invoice_no}</b></td><td>{o.completed_at?.slice(11, 16)}</td><td>{o.user_name}</td><td>{o.customer || ''}</td>
                    <td>{(o.methods || '').split(',').filter(Boolean).map((x) => t(`pay.${x}`)).join(' + ')}{o.credit ? ` + ${t('pay.onAccount')}` : ''}</td>
                    <td className="num">{m(o.total)}{o.refunded ? <small className="warn"> ↩ {m(o.refunded)}</small> : null}{o.discount ? <small className="muted"> 🏷</small> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <Empty>{t('common.none')}</Empty>)}
            {tab === 'returns' && (d.returnsList.length ? (
              <table className="grid compact">
                <thead><tr><th>{t('orders.date')}</th><th>{t('receipt.forInvoice')}</th><th>{t('receipt.cashier')}</th><th>{t('orders.reason')}</th><th className="num">{t('common.total')}</th></tr></thead>
                <tbody>{d.returnsList.map((r) => (
                  <tr key={r.id}><td>{r.created_at.slice(11, 16)}</td><td>{r.invoice_no ?? t('receipt.noInvoice')}</td><td>{r.user_name}</td><td>{r.reason}</td><td className="num">{m(r.amount)}</td></tr>
                ))}</tbody>
              </table>
            ) : <Empty>{t('common.none')}</Empty>)}
            {tab === 'activity' && (d.activity.length ? (
              <table className="grid compact">
                <thead><tr><th>{t('orders.date')}</th><th>{t('shift.by')}</th><th>{t('audit.action')}</th><th>{t('monitor.details')}</th></tr></thead>
                <tbody>{d.activity.map((a, i) => (
                  <tr key={i}>
                    <td>{a.created_at.slice(11, 16)}</td><td>{a.user_name}{a.approved_by_name ? <small className="muted"> ✓ {a.approved_by_name}</small> : null}</td>
                    <td>{t(`audit.${a.action}`)}</td>
                    <td className="small">{[a.details.invoice && `#${a.details.invoice}`, a.details.amount != null && m(a.details.amount), a.details.reason, a.details.pct != null && `${a.details.pct}%`].filter(Boolean).join(' — ')}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <Empty>{t('common.none')}</Empty>)}
          </div>
        </div>
      </div>
      {openOrder && <OrderModal id={openOrder} onClose={() => { setOpenOrder(null); reload(); }} onChanged={reload} />}
    </Modal>
  );
}
