import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty } from '../lib/money.js';
import { receiptHtml } from '../lib/receipt.js';
import { Empty, Field, Modal, useApp, useLoad } from '../components/ui.jsx';

export const today = () => new Date().toLocaleDateString('en-CA');

export default function Orders() {
  const { t, settings } = useApp();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [list, reload] = useLoad(() => api.orders.list({ from, to, search }), [from, to, search]);
  const m = (v) => formatMoney(v, settings);
  const sum = (list || []).reduce((s, o) => s + o.total - o.refunded, 0);

  return (
    <div className="page">
      <div className="page-head">
        <h2>{t('orders.title')}</h2>
        <div className="filters">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <input placeholder={t('orders.searchHint')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="card flush">
        <table className="grid">
          <thead>
            <tr>
              <th>{t('orders.invoice')}</th><th>{t('orders.date')}</th><th>{t('orders.type')}</th><th>{t('pos.customer')}</th>
              <th>{t('orders.cashier')}</th><th className="num">{t('common.total')}</th><th className="num">{t('orders.refunded')}</th>
            </tr>
          </thead>
          <tbody>
            {(list || []).map((o) => (
              <tr key={o.id} className="clickable" onClick={() => setOpenId(o.id)}>
                <td><b>{o.invoice_no}</b></td>
                <td>{o.completed_at}</td>
                <td>{t(`order.${o.order_type}`)}</td>
                <td>{o.customer_display}{o.credit > 0 && <small className="badge credit">{t('pay.onAccount')} {m(o.credit)}</small>}</td>
                <td>{o.user_name}</td>
                <td className="num">{m(o.total)}</td>
                <td className="num">{o.refunded ? m(o.refunded) : ''}</td>
              </tr>
            ))}
          </tbody>
          {!!list?.length && (
            <tfoot><tr><td colSpan={5}>{list.length}</td><td className="num" colSpan={2}><b>{m(sum)}</b></td></tr></tfoot>
          )}
        </table>
        {list && !list.length && <Empty>{t('common.none')}</Empty>}
      </div>
      {openId && <OrderModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

function OrderModal({ id, onClose, onChanged }) {
  const { t, tErr, notify, settings, printDoc, lang, isAdmin, shift } = useApp();
  const [order, , setOrder] = useLoad(() => api.orders.get(id), [id]);
  const [refundQty, setRefundQty] = useState({});
  const [reason, setReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const m = (v) => formatMoney(v, settings);
  if (!order) return null;

  async function doRefund() {
    try {
      const items = Object.entries(refundQty).map(([order_item_id, qty]) => ({ order_item_id: Number(order_item_id), qty: Number(qty) })).filter((i) => i.qty > 0);
      const updated = await api.orders.refund({ orderId: order.id, items, reason });
      setOrder(updated);
      setRefunding(false);
      setRefundQty({});
      notify(t('orders.refundDone'));
      onChanged();
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }

  const canRefund = isAdmin && shift && order.refunded < order.total;

  return (
    <Modal
      title={refunding ? t('orders.refundTitle', { n: order.invoice_no }) : `${t('orders.details')} — ${order.invoice_no}`}
      onClose={onClose}
      width={720}
      footer={refunding ? (
        <>
          <Field label={t('orders.reason')}><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <span className="spacer" />
          <button onClick={() => setRefunding(false)}>{t('common.cancel')}</button>
          <button className="danger" onClick={doRefund}>{t('common.confirm')}</button>
        </>
      ) : (
        <>
          {canRefund && <button className="danger-ghost" onClick={() => setRefunding(true)}>↩ {t('orders.refund')}</button>}
          <span className="spacer" />
          <button className="primary" onClick={() => printDoc(receiptHtml(order, settings, t, lang))}>🖨 {t('orders.reprint')}</button>
        </>
      )}
    >
      <div className="meta">
        <span>{order.completed_at}</span>
        <span>{t(`order.${order.order_type}`)}{order.table_name ? ` — ${t('pos.table')} ${order.table_name}` : ''}</span>
        <span>{order.user_name}</span>
        {order.customer_name && <span>👤 {order.customer_name} {order.customer_phone}</span>}
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>{t('receipt.item')}</th><th className="num">{t('orders.sold')}</th><th className="num">{t('pos.price')}</th><th className="num">{t('common.total')}</th>
            {refunding ? <th className="num">{t('orders.returnQty')}</th> : <th className="num">{t('orders.alreadyReturned')}</th>}
          </tr>
        </thead>
        <tbody>
          {order.items.map((i) => (
            <tr key={i.id}>
              <td>{i.name}{i.note && <small className="muted"> — {i.note}</small>}</td>
              <td className="num">{formatQty(i.qty)}</td>
              <td className="num">{m(i.unit_price)}</td>
              <td className="num">{m(i.line_total)}</td>
              {refunding ? (
                <td className="num">
                  <input
                    className="qty-input"
                    type="number"
                    min="0"
                    max={i.qty - i.returned_qty}
                    step="any"
                    disabled={i.qty - i.returned_qty <= 0}
                    value={refundQty[i.id] ?? ''}
                    onChange={(e) => setRefundQty((r) => ({ ...r, [i.id]: e.target.value }))}
                  />
                </td>
              ) : <td className="num">{i.returned_qty ? formatQty(i.returned_qty) : ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="totals compact">
        <div className="trow"><span>{t('pos.subtotal')}</span><span>{m(order.subtotal)}</span></div>
        {!!order.discount && <div className="trow"><span>{t('pos.discount')}</span><span>− {m(order.discount)}</span></div>}
        {!!order.service && <div className="trow"><span>{t('pos.service')}</span><span>{m(order.service)}</span></div>}
        {!!order.tax && <div className="trow"><span>{t('pos.tax')}</span><span>{m(order.tax)}</span></div>}
        <div className="trow big"><span>{t('pos.total')}</span><span>{m(order.total)}</span></div>
        {order.payments.map((p) => <div className="trow" key={p.id}><span>{t(`pay.${p.method}`)}</span><span>{m(p.amount)}</span></div>)}
        {!!order.credit && <div className="trow"><span>{t('pay.onAccount')}</span><span>{m(order.credit)}</span></div>}
        {!!order.refunded && <div className="trow warn"><span>{t('orders.refunded')}</span><span>{m(order.refunded)}</span></div>}
      </div>
      {order.returns.map((r) => (
        <p key={r.id} className="muted">↩ {r.created_at} — {r.user_name} — {m(r.amount)} {r.reason && `— ${r.reason}`}</p>
      ))}
    </Modal>
  );
}
