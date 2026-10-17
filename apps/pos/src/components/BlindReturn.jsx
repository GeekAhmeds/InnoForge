import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty } from '../lib/money.js';
import { returnHtml } from '../lib/receipt.js';
import { Field, Modal, useApp } from './ui.jsx';
import { VariantPicker } from './Variants.jsx';
import { scannedUnit } from '../lib/packs.js';

/** Whether this computer may offer returns without an invoice (Settings, and no e-invoicing). */
export const blindReturnsOn = (s) => !!s.blind_returns && !s.eta_enabled && !s.zatca_enabled && !s.uae_enabled;

/** First step of a return: the invoice number (typed or scanned) — or, when allowed, no invoice. */
export function ReturnStart({ onInvoice, onBlind, onClose }) {
  const { t, tErr, notify, settings } = useApp();
  const [no, setNo] = useState('');
  async function find(e) {
    e?.preventDefault();
    if (!no.trim()) return;
    try {
      const order = await api.orders.byInvoice(no.trim());
      if (!order) { notify(t('pos.returnNotFound', { n: no.trim() }), 'error'); return; }
      onInvoice(order.id);
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }
  return (
    <Modal title={`↩ ${t('pos.return')}`} onClose={onClose} width={480}
      footer={<>
        {blindReturnsOn(settings) && <button type="button" onClick={onBlind}>{t('blind.button')}</button>}
        <span className="spacer" />
        <button type="button" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="primary" onClick={find}>{t('common.confirm')}</button>
      </>}>
      <form onSubmit={find}>
        <Field label={t('pos.returnAsk')}><input autoFocus dir="ltr" value={no} onChange={(e) => setNo(e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

/** Return without an invoice: scan the items back, choose cash or the customer's account, give a reason. */
export function BlindReturnModal({ onClose }) {
  const { t, tErr, notify, settings, printDoc, lang, withApproval } = useApp();
  const m = (v) => formatMoney(v, settings);
  const [lines, setLines] = useState([]);
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState([]);
  const [picking, setPicking] = useState(null); // a model whose size / colour must be chosen
  const [method, setMethod] = useState('cash');
  const [customer, setCustomer] = useState(null);
  const [cq, setCq] = useState('');
  const [customers, setCustomers] = useState([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const scanRef = useRef(null);

  useEffect(() => {
    if (!q.trim()) { setMatches([]); return undefined; }
    const h = setTimeout(() => api.products.list({ search: q }).then((r) => setMatches(r.slice(0, 8))).catch(() => {}), 150);
    return () => clearTimeout(h);
  }, [q]);
  useEffect(() => {
    if (!cq.trim()) { setCustomers([]); return undefined; }
    const h = setTimeout(() => api.customers.list({ search: cq }).then((r) => setCustomers(r.slice(0, 6))).catch(() => {}), 150);
    return () => clearTimeout(h);
  }, [cq]);

  const add = (p, unit = null) => {
    if (p.is_parent) { setPicking(p); return; }
    const price = unit ? unit.price ?? Math.round(p.price * unit.factor) : p.price;
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id && (l.unit_id ?? null) === (unit?.id ?? null));
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { product_id: p.id, unit_id: unit?.id ?? null, name: unit ? `${p.name} (${unit.name})` : p.name, price, qty: 1 }];
    });
    setQ('');
    setMatches([]);
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  async function onScan(e) {
    if (e.key !== 'Enter' || !q.trim()) return;
    e.preventDefault();
    const hit = await api.products.byBarcode(q.trim()).catch(() => null);
    if (hit && !hit.scale) add(hit, scannedUnit(hit));
    else if (matches.length === 1) add(matches[0]);
    else notify(t('pos.notFound'), 'error');
  }

  const total = lines.reduce((sum, l) => sum + Math.round(l.price * (Number(l.qty) || 0)), 0);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      const ret = await withApproval((approval) => api.orders.blindReturn({
        items: lines.filter((l) => Number(l.qty) > 0).map((l) => ({ product_id: l.product_id, unit_id: l.unit_id, qty: Number(l.qty) })),
        customerId: customer?.id ?? null, method, reason, approval,
      }));
      printDoc(returnHtml({ invoice_no: null, customer_name: ret.customer_name }, ret, ret.items, settings, t, lang));
      notify(t('orders.refundDone'));
      onClose();
    } catch (err) {
      if (err.code !== 'CANCELLED') notify(tErr(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`↩ ${t('blind.title')}`} onClose={onClose} width={760}
      footer={<>
        <span className="muted">{t('blind.priceNote')}</span>
        <span className="spacer" />
        <button type="button" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="danger" disabled={busy || !lines.length} onClick={confirm}>{t('common.confirm')} — {m(total)}</button>
      </>}>
      <div className="blind-return">
        <div className="search-add">
          <input ref={scanRef} autoFocus placeholder={t('blind.scan')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onScan} />
          {!!matches.length && (
            <div className="dropdown">{matches.map((p) => (
              <button key={p.id} type="button" onClick={() => add(p)}><span>{p.name}</span><small className="muted">{m(p.price)}</small></button>
            ))}</div>
          )}
        </div>
        {!!lines.length && (
          <table className="grid compact-inputs">
            <thead><tr><th>{t('receipt.item')}</th><th className="num">{t('pos.price')}</th><th>{t('pos.qty')}</th><th className="num">{t('common.total')}</th><th /></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={`${l.product_id}-${l.unit_id}`}>
                <td>{l.name}</td>
                <td className="num">{m(l.price)}</td>
                <td><input className="qty-input" type="number" min="0" step="any" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
                <td className="num">{m(Math.round(l.price * (Number(l.qty) || 0)))}</td>
                <td><button type="button" className="danger-ghost sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <div className="grid2">
          <Field label={t('blind.refundTo')}>
            <div className="seg full">
              <button type="button" className={method === 'cash' ? 'on' : ''} onClick={() => setMethod('cash')}>💵 {t('blind.cash')}</button>
              <button type="button" className={method === 'account' ? 'on' : ''} onClick={() => setMethod('account')}>👤 {t('blind.account')}</button>
            </div>
          </Field>
          <Field label={t('blind.customer')}>
            {customer ? (
              <div className="row"><b>{customer.name}</b> <small className="muted">{customer.phone}</small><button type="button" className="ghost sm" onClick={() => setCustomer(null)}>✕</button></div>
            ) : (
              <div className="search-add">
                <input value={cq} onChange={(e) => setCq(e.target.value)} placeholder={t('common.search')} />
                {!!customers.length && (
                  <div className="dropdown">{customers.map((c) => (
                    <button key={c.id} type="button" onClick={() => { setCustomer(c); setCq(''); setCustomers([]); }}><span>{c.name}</span><small className="muted">{c.phone}</small></button>
                  ))}</div>
                )}
              </div>
            )}
          </Field>
          <div className="span2"><Field label={t('orders.reason')}><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
        </div>
        {lines.length > 0 && <div className="trow big"><span>{t('receipt.returnTotal')}</span><span>{m(total)} <small className="muted">({formatQty(lines.reduce((a, l) => a + (Number(l.qty) || 0), 0))})</small></span></div>}
      </div>
      {picking && <VariantPicker product={picking} onClose={() => setPicking(null)} onPick={(v) => { setPicking(null); add(v); }} />}
    </Modal>
  );
}
