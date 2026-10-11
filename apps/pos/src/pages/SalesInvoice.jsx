import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty, fromMinor, toMinor } from '../lib/money.js';
import { a4Html, installmentsHtml } from '../lib/receipt.js';
import { invoiceText, openWhatsApp } from '../lib/share.js';
import { Empty, Field, Toggle, useApp } from '../components/ui.jsx';
import { InstallmentFields, newInstallmentForm } from '../components/Installments.jsx';
import { NoShift } from './Pos.jsx';
import { clearDraft, loadDraft, saveDraft } from '../lib/drafts.js';
import { has } from '../lib/features.js';

// Trading (B2B) sales invoice: customer first, then a line grid with unit, quantity,
// price, discount % and stock; due date, salesperson and partial payment on one screen.
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

const lineFromProduct = (p, unit = null) => {
  const price = unit ? unit.price ?? Math.round(p.price * unit.factor) : p.price;
  return {
    key: Math.random().toString(36).slice(2), product_id: p.id, name: p.name, units: p.units || [], base_unit: p.unit,
    unit_id: unit?.id ?? '', qty: '1', price: null, list_price: price, discount_pct: '', stock: p.stock, track_stock: !!p.track_stock,
    track_serial: !!p.track_serial, serials: '',
  };
};

export default function SalesInvoice() {
  const { t, tErr, notify, settings, shift, printDoc, lang, withApproval, pendingCart, setPendingCart, user } = useApp();
  const d = settings.decimals;
  const m = (v) => formatMoney(v, settings);
  const [customer, setCustomer] = useState(null);
  const [lines, setLines] = useState([]);
  const [inst, setInst] = useState(null); // installment plan form, when selling in installments
  const [head, setHead] = useState({ price_list_id: '', salesperson_id: '', due_date: '', note: '', discount: '', quote_id: null, quote_no: null });
  const [pay, setPay] = useState({ amount: '', method: 'cash', touched: false });
  const [opts, setOpts] = useState({ print: true, whatsapp: false });
  const [quote, setQuote] = useState(null);
  const [priceLists, setPriceLists] = useState([]);
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const addRef = useRef(null);

  useEffect(() => {
    api.priceLists.list().then((l) => setPriceLists(l.filter((x) => x.active))).catch(() => {});
    api.auth.salespeople().then(setPeople).catch(() => {});
  }, []);

  // The invoice being typed is kept on disk until it is saved (power cut, crash, closing by mistake).
  const draftKey = `invoice-${user?.id}`;
  useEffect(() => {
    if (pendingCart) return;
    const saved = loadDraft(draftKey);
    if (saved?.lines?.length && window.confirm(t('pos.restoreDraft', { n: saved.lines.length }))) {
      setCustomer(saved.customer); setLines(saved.lines); setHead(saved.head);
    } else clearDraft(draftKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (lines.length) saveDraft(draftKey, { customer, lines, head }); else clearDraft(draftKey);
  }, [customer, lines, head, draftKey]);

  // A quotation converted to an invoice arrives as a pending cart.
  useEffect(() => {
    if (!pendingCart) return;
    const c = pendingCart;
    setPendingCart(null);
    (async () => {
      if (c.customer_id) setCustomer(await api.customers.get(c.customer_id));
      const ls = [];
      for (const it of c.items || []) {
        const p = await api.products.get(it.product_id);
        const unit = p.units.find((u) => u.id === it.unit_id) || null;
        const l = lineFromProduct(p, unit);
        l.qty = String(it.qty);
        if (it.discount) l.discount_pct = String(Math.round((it.discount / Math.max(1, it.unit_price * it.qty)) * 10000) / 100);
        ls.push(l);
      }
      setLines(ls);
      setHead((h) => ({ ...h, price_list_id: c.price_list_id || '', note: c.note || '', discount: c.discount ? fromMinor(c.discount, d) : '', quote_id: c.quote_id || null, quote_no: c.quote_no || null }));
    })().catch((err) => notify(tErr(err), 'error'));
  }, [pendingCart]); // eslint-disable-line react-hooks/exhaustive-deps

  const cart = {
    order_type: 'sale',
    customer_id: customer?.id || null, customer_name: customer?.name || '', customer_phone: customer?.phone || '', customer_address: customer?.address || '',
    price_list_id: Number(head.price_list_id) || null, salesperson_id: Number(head.salesperson_id) || null, note: head.note,
    discount: toMinor(head.discount, d), quote_id: head.quote_id,
    items: lines.map((l) => {
      const qty = Number(l.qty) || 0;
      const price = l.price != null && l.price !== '' ? toMinor(l.price, d) : null;
      const unitPrice = price ?? l.list_price;
      return {
        product_id: l.product_id, unit_id: Number(l.unit_id) || null, qty, serials: l.serials,
        unit_price: unitPrice, price_override: price != null && price !== l.list_price,
        discount: Math.round((unitPrice * qty * (Number(l.discount_pct) || 0)) / 100),
      };
    }).filter((i) => i.qty > 0),
  };

  // Server-side pricing: price lists, customer discount, promotions, tax.
  const cartKey = JSON.stringify(cart);
  useEffect(() => {
    if (!cart.items.length) { setQuote(null); return undefined; }
    let live = true;
    const h = setTimeout(() => api.orders.quote(cart).then((q) => {
      if (!live) return;
      setQuote(q);
      // Keep each line's list price in step with the price list / unit chosen.
      setLines((ls) => ls.map((l, i) => (q.lines[i] && l.list_price !== q.lines[i].list_price ? { ...l, list_price: q.lines[i].list_price } : l)));
    }).catch((e) => notify(tErr(e), 'error')), 150);
    return () => { live = false; clearTimeout(h); };
  }, [cartKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = quote?.total || 0;
  // Unless typed, a customer buys on account and a walk-in pays in full.
  const paidNow = pay.touched ? toMinor(pay.amount, d) : customer ? 0 : total;
  const onAccount = Math.max(0, total - paidNow);
  const newBalance = (customer?.balance || 0) + onAccount;
  const overLimit = customer && customer.credit_limit > 0 && onAccount > 0 && newBalance > customer.credit_limit;

  async function pickCustomer(c) {
    const full = c ? await api.customers.get(c.id) : null;
    setCustomer(full);
    setHead((h) => ({ ...h, price_list_id: full?.price_list_id || '', due_date: full ? addDays(full.terms_days) : '' }));
    setPay({ amount: '', method: 'cash', touched: false });
  }

  async function addByCode(code) {
    const q = code.trim();
    if (!q) return false;
    const [, qtyStr, c] = q.match(/^(\d+(?:\.\d+)?)\*(.+)$/) || [null, null, q];
    const p = await api.products.byBarcode(c);
    if (!p) return false;
    const l = lineFromProduct(p, p.unit || null);
    if (qtyStr) l.qty = qtyStr;
    setLines((ls) => [...ls, l]);
    return true;
  }

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function reset(keepSaved = null) {
    setCustomer(null);
    setLines([]);
    setHead({ price_list_id: '', salesperson_id: '', due_date: '', note: '', discount: '', quote_id: null, quote_no: null });
    setPay({ amount: '', method: 'cash', touched: false });
    setInst(null);
    setSaved(keepSaved);
  }

  async function save(kind) {
    if (busy || !cart.items.length) return;
    setBusy(true);
    try {
      if (kind === 'quote') {
        const q = await api.quotes.create({ ...cart, valid_until: addDays(14) });
        notify(t('quotes.saved', { n: q.quote_no }));
        if (opts.print) await printDoc(a4Html(q, 'quote', settings, t, lang), settings.a4_printer_name);
        reset();
      } else {
        const payments = paidNow > 0 ? [{ method: pay.method, amount: paidNow }] : [];
        let order = await withApproval((approval) => api.orders.checkout({ ...cart, payments, approval, due_date: onAccount > 0 ? head.due_date : null }));
        notify(t('pay.done', { n: order.invoice_no }));
        if (inst && order.credit > 0) {
          try {
            const plan = await withApproval((approval) => api.installments.create({ orderId: order.id, count: Number(inst.count), periodMonths: Number(inst.period), firstDue: inst.firstDue, approval }));
            if (opts.print) await printDoc(installmentsHtml(plan, settings, t, lang), settings.a4_printer_name);
            order = await api.orders.get(order.id);
          } catch (err) {
            // The sale is saved; the plan can still be made from the invoice.
            if (err.code !== 'CANCELLED') notify(tErr(err), 'error');
          }
        }
        if (opts.print) await printDoc(a4Html(order, 'invoice', settings, t, lang), settings.a4_printer_name);
        if (opts.whatsapp && (order.customer?.phone || order.customer_phone)) openWhatsApp(order.customer?.phone || order.customer_phone, invoiceText(order, settings, t));
        reset(order);
      }
    } catch (err) {
      if (err.code !== 'CANCELLED') notify(tErr(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!shift) return <NoShift />;
  const today = new Date().toLocaleDateString('en-CA');

  return (
    <div className="page invoice-page">
      <div className="page-head">
        <h2>📄 {t('nav.invoice')}{head.quote_no ? <small className="badge credit">{t('quotes.quote')} #{head.quote_no}</small> : null}</h2>
        {saved && (
          <div className="saved-chip">
            ✓ {t('pay.done', { n: saved.invoice_no })}
            <button className="ghost sm" onClick={() => printDoc(a4Html(saved, 'invoice', settings, t, lang), settings.a4_printer_name)}>📄 {t('a4.printA4')}</button>
          </div>
        )}
      </div>

      <div className="card invoice-head">
        <div className="inv-customer">
          {customer ? (
            <div className="inv-cust-card">
              <div className="row between"><b>👤 {customer.name}</b><button className="ghost sm" onClick={() => pickCustomer(null)}>✕</button></div>
              <div className="muted small" dir="ltr">{customer.phone}</div>
              <div className="inv-cust-stats">
                <span>{t('customers.balance')}: <b className={customer.balance > 0 ? 'warn' : 'good'}>{m(customer.balance)}</b></span>
                {customer.credit_limit > 0 && <span>{t('customers.limit')}: {m(customer.credit_limit)}</span>}
                <span>{t('collect.terms')}: {customer.terms_days}</span>
                {customer.discount_percent > 0 && <span className="good">{t('customers.discountPercent')}: {customer.discount_percent}%</span>}
                {customer.pending_cheques > 0 && <span>{t('collect.pendingCheques')}: {m(customer.pending_cheques)}</span>}
              </div>
            </div>
          ) : <CustomerSearch onPick={pickCustomer} />}
        </div>
        <div className="grid2 inv-fields">
          <Field label={t('priceLists.title')}>
            <select value={head.price_list_id} onChange={(e) => setHead({ ...head, price_list_id: e.target.value })}>
              <option value="">{t('priceLists.retail')}</option>
              {priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label={t('pos.salesperson')}>
            <select value={head.salesperson_id} onChange={(e) => setHead({ ...head, salesperson_id: e.target.value })}>
              <option value="">—</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label={t('invoice.dueDate')}><input type="date" min={today} value={head.due_date} disabled={!customer} onChange={(e) => setHead({ ...head, due_date: e.target.value })} /></Field>
          <Field label={t('invoice.reference')}><input value={head.note} placeholder={t('invoice.referencePh')} onChange={(e) => setHead({ ...head, note: e.target.value })} /></Field>
        </div>
      </div>

      <div className="card flush">
        <table className="grid inv-lines">
          <thead><tr>
            <th>#</th><th>{t('receipt.item')}</th><th>{t('units.unit')}</th><th>{t('pos.qty')}</th><th>{t('pos.price')}</th>
            <th>{t('invoice.discPct')}</th><th className="num">{t('common.total')}</th><th className="num">{t('products.stock')}</th><th />
          </tr></thead>
          <tbody>
            {lines.map((l, i) => {
              const ql = quote?.lines?.[i];
              const factor = l.units.find((u) => u.id === Number(l.unit_id))?.factor || 1;
              const short = l.track_stock && (Number(l.qty) || 0) * factor > l.stock;
              return (
                <tr key={l.key}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <b>{l.name}</b>
                    {ql?.customer_discount > 0 && <div className="promo small">👤 −{m(ql.customer_discount)}</div>}
                    {ql?.promo_name && <div className="promo small">🏷 {ql.promo_name} −{m(ql.promo_discount)}</div>}
                    {l.track_serial && <input className="mono serial-input" dir="ltr" placeholder={t('pos.serials')} value={l.serials} onChange={(e) => setLine(l.key, { serials: e.target.value })} />}
                  </td>
                  <td>{l.units.length ? (
                    <select value={l.unit_id} onChange={(e) => setLine(l.key, { unit_id: e.target.value, price: null })}>
                      <option value="">{!l.base_unit || l.base_unit === 'pcs' ? t('units.base') : l.base_unit}</option>
                      {l.units.map((u) => <option key={u.id} value={u.id}>{u.name} × {formatQty(u.factor)}</option>)}
                    </select>
                  ) : <span className="muted">{!l.base_unit || l.base_unit === 'pcs' ? t('units.base') : l.base_unit}</span>}</td>
                  <td><input className="qty-input" inputMode="decimal" value={l.qty} onFocus={(e) => e.target.select()} onChange={(e) => setLine(l.key, { qty: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && addRef.current?.focus()} /></td>
                  <td><input className="price-input" inputMode="decimal" value={l.price ?? fromMinor(l.list_price, d)} onFocus={(e) => e.target.select()} onChange={(e) => setLine(l.key, { price: e.target.value })} />
                    {l.price != null && toMinor(l.price, d) !== l.list_price && <div className="muted small">{t('invoice.listPrice')} {m(l.list_price)}</div>}</td>
                  <td><input className="w-pct" inputMode="decimal" placeholder="0" value={l.discount_pct} onChange={(e) => setLine(l.key, { discount_pct: e.target.value })} /></td>
                  <td className="num"><b>{ql ? m(ql.line_total) : '…'}</b></td>
                  <td className={`num ${short ? 'warn' : 'muted'}`}>{l.track_stock ? formatQty(l.stock / factor) : '∞'}{short && ' ⚠'}</td>
                  <td><button className="danger-ghost sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>✕</button></td>
                </tr>
              );
            })}
            <tr className="add-row">
              <td className="muted">{lines.length + 1}</td>
              <td colSpan={8}><ProductSearch inputRef={addRef} onPick={(p) => setLines((ls) => [...ls, lineFromProduct(p)])} onCode={addByCode} /></td>
            </tr>
          </tbody>
        </table>
        {!lines.length && <Empty>{t('invoice.empty')}</Empty>}
      </div>

      <div className="invoice-foot">
        <div className="card inv-pay">
          <h4>{t('invoice.payment')}</h4>
          <div className="row">
            <Field label={t('invoice.paidNow')}>
              <input inputMode="decimal" value={pay.touched ? pay.amount : fromMinor(paidNow, d)} onFocus={(e) => e.target.select()} onChange={(e) => setPay({ ...pay, amount: e.target.value, touched: true })} />
            </Field>
            <Field label={t('purchases.method')}>
              <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                {['cash', 'card', 'wallet', 'bank'].map((x) => <option key={x} value={x}>{t(`pay.${x}`)}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <button type="button" onClick={() => setPay({ ...pay, amount: fromMinor(total, d), touched: true })}>{t('invoice.payAll')}</button>
            {customer && <button type="button" onClick={() => setPay({ ...pay, amount: '0', touched: true })}>{t('pay.allCredit')}</button>}
          </div>
          {customer && onAccount > 0 && (
            <p className={overLimit ? 'warn' : 'muted'}>
              {t('pay.onAccount')}: <b>{m(onAccount)}</b> · {t('customers.newBalance')}: <b>{m(newBalance)}</b>
              {overLimit && <> — {t('err.CREDIT_LIMIT_EXCEEDED')}</>}
            </p>
          )}
          {!customer && paidNow < total && <p className="warn">{t('invoice.needCustomer')}</p>}
          {customer && onAccount > 0 && has('installments') && (
            <>
              <Toggle checked={!!inst} onChange={(v) => setInst(v ? newInstallmentForm() : null)} label={`📆 ${t('inst.sellInInstallments')}`} />
              {inst && <InstallmentFields value={inst} onChange={setInst} amount={onAccount} />}
            </>
          )}
        </div>
        <div className="card inv-totals">
          <div className="trow"><span>{t('pos.subtotal')}</span><span>{m(quote?.subtotal)}</span></div>
          <div className="trow"><span>{t('invoice.invoiceDiscount')}</span><input className="w-amount" inputMode="decimal" placeholder="0" value={head.discount} onChange={(e) => setHead({ ...head, discount: e.target.value })} /></div>
          {!!quote?.discount && <div className="trow"><span>{t('pos.discount')}</span><span>− {m(quote.discount)}</span></div>}
          {!!quote?.tax && <div className="trow"><span>{t('pos.tax')}</span><span>{m(quote.tax)}</span></div>}
          <div className="trow big"><span>{t('pos.total')}</span><span>{m(total)}</span></div>
          <div className="row wrap top-gap">
            <Toggle checked={opts.print} onChange={(v) => setOpts({ ...opts, print: v })} label={t('a4.printA4')} />
            <Toggle checked={opts.whatsapp} onChange={(v) => setOpts({ ...opts, whatsapp: v })} label={t('share.whatsapp')} />
          </div>
          <div className="row top-gap">
            <button onClick={() => reset()} className="danger-ghost">{t('pos.clear')}</button>
            <span className="spacer" />
            <button disabled={busy || !cart.items.length} onClick={() => save('quote')}>📝 {t('quotes.save')}</button>
            <button className="primary lg" disabled={busy || !cart.items.length || overLimit || (!customer && paidNow < total)} onClick={() => save('invoice')}>💾 {t('invoice.save')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomerSearch({ onPick }) {
  const { t, settings } = useApp();
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  useEffect(() => {
    const h = setTimeout(() => api.customers.list({ search: q }).then((r) => setList(r.slice(0, 8))).catch(() => {}), 120);
    return () => clearTimeout(h);
  }, [q]);
  return (
    <div className="search-add">
      <input autoFocus placeholder={`👤 ${t('invoice.pickCustomer')}`} value={q} onChange={(e) => setQ(e.target.value)} />
      {q && !!list.length && (
        <div className="dropdown">
          {list.map((c) => (
            <button key={c.id} type="button" onClick={() => { onPick(c); setQ(''); }}>
              <span><b>{c.name}</b> <small className="muted" dir="ltr">{c.phone}</small></span>
              {c.balance > 0 && <small className="warn">{formatMoney(c.balance, settings)}</small>}
            </button>
          ))}
        </div>
      )}
      <small className="muted">{t('invoice.walkIn')}</small>
    </div>
  );
}

function ProductSearch({ onPick, onCode, inputRef }) {
  const { t, settings, notify } = useApp();
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [hi, setHi] = useState(0);
  useEffect(() => {
    if (!q.trim()) { setList([]); return undefined; }
    const h = setTimeout(() => api.products.list({ search: q, forSale: true }).then((r) => { setList(r.slice(0, 10)); setHi(0); }).catch(() => {}), 120);
    return () => clearTimeout(h);
  }, [q]);
  async function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter' && q.trim()) {
      e.preventDefault();
      if (await onCode(q)) { setQ(''); return; }
      if (list[hi]) { onPick(list[hi]); setQ(''); } else notify(t('pos.notFound'), 'error');
    }
  }
  return (
    <div className="search-add">
      <input ref={inputRef} placeholder={t('invoice.addLine')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
      {!!list.length && (
        <div className="dropdown">
          {list.map((p, i) => (
            <button key={p.id} type="button" className={i === hi ? 'hi' : ''} onClick={() => { onPick(p); setQ(''); inputRef.current?.focus(); }}>
              <span>{p.name} <small className="muted">{p.barcode}</small></span>
              <small>{formatMoney(p.price, settings)} · {p.track_stock ? formatQty(p.stock) : '∞'}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
