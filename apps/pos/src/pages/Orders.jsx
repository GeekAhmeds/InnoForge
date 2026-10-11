import React, { useState } from 'react';
import { api, savePdf } from '../lib/api.js';
import { invoiceText, openWhatsApp } from '../lib/share.js';
import { formatMoney, formatQty } from '../lib/money.js';
import { a4Html, receiptHtml } from '../lib/receipt.js';
import { Empty, Field, Modal, useApp, useLoad } from '../components/ui.jsx';
import { ExcelButtons } from '../components/ExcelImport.jsx';
import { CollectModal } from '../components/Collect.jsx';
import { MakePlanModal, ScheduleModal } from '../components/Installments.jsx';

export const today = () => new Date().toLocaleDateString('en-CA');

export default function Orders() {
  const { t, settings, can } = useApp();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [serialHits, setSerialHits] = useState(null);
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
          <input className="w-amount" placeholder={`🔎 ${t('orders.serial')}`} onKeyDown={async (e) => {
            if (e.key !== 'Enter' || !e.target.value.trim()) return;
            setSerialHits(await api.orders.findSerial(e.target.value.trim()));
          }} />
          {can('reports') && <ExcelButtons kind="invoices" exportKind="invoices" params={{ from, to }} importable={false} />}
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
      {serialHits && (
        <Modal title={`🔎 ${t('orders.serial')}`} onClose={() => setSerialHits(null)} width={640}>
          {!serialHits.length ? <Empty>{t('orders.serialNone')}</Empty> : (
            <table className="grid"><tbody>
              {serialHits.map((h) => (
                <tr key={`${h.id}${h.name}`} className="clickable" onClick={() => { setSerialHits(null); setOpenId(h.id); }}>
                  <td><b>#{h.invoice_no}</b></td><td>{h.completed_at}</td><td>{h.name}</td><td>{h.customer}</td><td className="mono small">{h.serials}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </Modal>
      )}
      {openId && <OrderModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}

function OrderModal({ id, onClose, onChanged }) {
  const { t, tErr, notify, settings, printDoc, lang, shift, withApproval } = useApp();
  const [order, , setOrder] = useLoad(() => api.orders.get(id), [id]);
  const [refundQty, setRefundQty] = useState({});
  const [reason, setReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [plan, setPlan] = useState(null); // 'make' | 'view'
  const m = (v) => formatMoney(v, settings);
  if (!order) return null;
  const refresh = async () => { setOrder(await api.orders.get(order.id)); onChanged(); };

  async function doRefund() {
    try {
      const items = Object.entries(refundQty).map(([order_item_id, qty]) => ({ order_item_id: Number(order_item_id), qty: Number(qty) })).filter((i) => i.qty > 0);
      const updated = await withApproval((approval) => api.orders.refund({ orderId: order.id, items, reason, approval }));
      setOrder(updated);
      setRefunding(false);
      setRefundQty({});
      notify(t('orders.refundDone'));
      onChanged();
    } catch (err) {
      if (err.code !== 'CANCELLED') notify(tErr(err), 'error');
    }
  }

  const canRefund = shift && order.refunded < order.total;

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
          {order.installments ? <button onClick={() => setPlan('view')}>📆 {t('inst.schedule')}</button>
            : order.open_amount > 0 && <button onClick={() => setPlan('make')}>📆 {t('inst.make')}</button>}
          {order.open_amount > 0 && <button className="primary" onClick={() => setCollecting(true)}>💵 {t('customers.collect')}</button>}
          <button onClick={() => openWhatsApp(order.customer?.phone || order.customer_phone, invoiceText(order, settings, t))}>💬 {t('share.whatsapp')}</button>
          <button onClick={() => savePdf({ html: a4Html(order, 'invoice', settings, t, lang), name: `${t('receipt.invoice')} ${order.invoice_no}` }).catch((err) => notify(tErr(err), 'error'))}>📑 PDF</button>
          <button onClick={() => printDoc(a4Html(order, 'invoice', settings, t, lang), settings.a4_printer_name)}>📄 {t('a4.printA4')}</button>
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
        {!!order.credit && <div className="trow"><span>{t('pay.onAccount')}{order.due_date ? ` · ${t('collect.due')} ${order.due_date}` : ''}</span><span>{m(order.credit)}</span></div>}
        {order.open_amount != null && order.credit > 0 && (
          <div className={`trow ${order.open_amount > 0 ? (order.due_date < today() ? 'warn' : '') : 'good'}`}>
            <span>{order.open_amount > 0 ? t('collect.remaining') : `✓ ${t('collect.paidOff')}`}</span><span>{m(order.open_amount)}</span>
          </div>
        )}
        {!!order.refunded && <div className="trow warn"><span>{t('orders.refunded')}</span><span>{m(order.refunded)}</span></div>}
      </div>
      {plan === 'make' && <MakePlanModal order={order} onClose={() => setPlan(null)} onDone={async () => { await refresh(); setPlan('view'); }} />}
      {plan === 'view' && <ScheduleModal orderId={order.id} onClose={() => setPlan(null)} onChanged={refresh} />}
      {collecting && <CollectModal customerId={order.customer_id} orderId={order.id} onClose={() => setCollecting(false)} onDone={async () => { setCollecting(false); setOrder(await api.orders.get(order.id)); onChanged(); }} />}
      {order.returns.map((r) => (
        <p key={r.id} className="muted">↩ {r.created_at} — {r.user_name} — {m(r.amount)} {r.reason && `— ${r.reason}`}</p>
      ))}
    </Modal>
  );
}
