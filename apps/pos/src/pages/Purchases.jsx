import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty, fromMinor, toMinor } from '../lib/money.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from '../components/ui.jsx';
import { ExcelButtons } from '../components/ExcelImport.jsx';
import { today } from './Orders.jsx';
import { openWhatsApp } from '../lib/share.js';
import { poHtml } from '../lib/receipt.js';
import { AccountSelect } from './Treasury.jsx';
import { WarehouseSelect } from '../components/Warehouses.jsx';
import { has } from '../lib/features.js';

export default function Purchases() {
  const { t } = useApp();
  const [tab, setTab] = useState('purchases');
  return (
    <div className="page">
      <div className="page-head">
        <h2>🚚 {t('nav.purchases')}</h2>
        <div className="seg">
          {['purchases', 'orders', 'suppliers', 'rebates', 'expenses'].filter((x) => has({ orders: 'purchase_orders', rebates: 'rebates' }[x])).map((x) => (
            <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`purchases.tab.${x}`)}</button>
          ))}
        </div>
      </div>
      {tab === 'purchases' && <PurchaseList />}
      {tab === 'suppliers' && <SupplierList />}
      {tab === 'orders' && <PurchaseOrders />}
      {tab === 'rebates' && <Rebates />}
      {tab === 'expenses' && <ExpenseList />}
    </div>
  );
}

function DateRange({ range, setRange, children }) {
  return (
    <div className="filters toolbar">
      <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
      <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
      <span className="spacer" />
      {children}
    </div>
  );
}

const monthStart = () => today().slice(0, 8) + '01';

// ---------- purchase invoices ----------
function PurchaseList() {
  const { t, settings } = useApp();
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [creating, setCreating] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [list, reload] = useLoad(() => api.purchases.list(range), [range.from, range.to]);
  const m = (v) => formatMoney(v, settings);
  const sum = (list || []).reduce((s, p) => s + p.total, 0);
  return (
    <>
      <DateRange range={range} setRange={setRange}>
        <button className="primary" onClick={() => setCreating(true)}>+ {t('purchases.new')}</button>
      </DateRange>
      <div className="card flush">
        <table className="grid">
          <thead><tr><th>#</th><th>{t('orders.date')}</th><th>{t('purchases.supplier')}</th><th>{t('purchases.refNo')}</th><th className="num">{t('common.total')}</th><th className="num">{t('pay.paid')}</th><th className="num">{t('purchases.due')}</th></tr></thead>
          <tbody>
            {(list || []).map((p) => (
              <tr key={p.id} className="clickable" onClick={() => setViewId(p.id)}>
                <td>{p.id}</td><td>{p.created_at}</td><td>{p.supplier_name || '—'}</td><td className="mono">{p.ref_no}</td>
                <td className="num">{m(p.total)}</td><td className="num">{m(p.paid)}</td>
                <td className={`num ${p.total - p.paid > 0 ? 'warn' : ''}`}>{p.total - p.paid > 0 ? m(p.total - p.paid) : ''}</td>
              </tr>
            ))}
          </tbody>
          {!!list?.length && <tfoot><tr><td colSpan={4}>{list.length}</td><td className="num"><b>{m(sum)}</b></td><td colSpan={2} /></tr></tfoot>}
        </table>
        {list && !list.length && <Empty>{t('common.none')}</Empty>}
      </div>
      {creating && <PurchaseEditor onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
      {viewId && <PurchaseView id={viewId} onClose={() => setViewId(null)} />}
    </>
  );
}

function PurchaseEditor({ onClose, onSaved, initial = null }) {
  const { t, tErr, notify, settings, shift, can } = useApp();
  const d = settings.decimals;
  const m = (v) => formatMoney(v, settings);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState({ supplierId: '', refNo: '', discount: '', paid: '', method: 'cash', fromDrawer: false, notes: '' });
  const [lines, setLines] = useState([]);
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.suppliers.list({}).then(setSuppliers); }, []);
  // Receiving a purchase order: start from its supplier and lines.
  useEffect(() => {
    if (!initial) return;
    setForm((f) => ({ ...f, supplierId: initial.supplierId ? String(initial.supplierId) : '', notes: initial.notes || '' }));
    (async () => {
      const ls = [];
      for (const it of initial.items) {
        const p = await api.products.get(it.product_id);
        const unit = p.units.find((u) => u.id === it.unit_id);
        ls.push({
          product_id: p.id, name: p.name, qty: String(it.qty), unit_cost: fromMinor(it.unit_cost ?? (p.cost ?? 0), d), price: fromMinor(p.price, d), oldPrice: p.price, stock: p.stock, track: p.track_stock,
          units: p.units || [], unit_id: unit ? String(unit.id) : '', baseCost: p.cost ?? 0, track_expiry: !!p.track_expiry, batch_no: '', expiry_date: '', discount_percent: '', bonus_qty: '',
        });
      }
      setLines(ls);
    })().catch((err) => notify(tErr(err), 'error'));
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!search.trim()) { setMatches([]); return undefined; }
    const h = setTimeout(() => api.products.list({ search }).then((r) => setMatches(r.slice(0, 8))), 120);
    return () => clearTimeout(h);
  }, [search]);

  const add = (p) => {
    setLines((ls) => (ls.some((l) => l.product_id === p.id) ? ls : [...ls, {
      product_id: p.id, name: p.name, qty: '1', unit_cost: fromMinor(p.cost ?? 0, d), price: fromMinor(p.price, d), oldPrice: p.price, stock: p.stock, track: p.track_stock,
      units: p.units || [], unit_id: '', baseCost: p.cost ?? 0, track_expiry: !!p.track_expiry, batch_no: '', expiry_date: '', discount_percent: '', bonus_qty: '',
    }]));
    setSearch('');
  };
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const lineTotal = (l) => Math.round((Number(l.qty) || 0) * toMinor(l.unit_cost, d) * (1 - Math.min(100, Number(l.discount_percent) || 0) / 100));
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const total = Math.max(0, subtotal - toMinor(form.discount, d));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  async function onScan(e) {
    if (e.key !== 'Enter' || !search.trim()) return;
    const p = await api.products.byBarcode(search.trim());
    if (p) add(p);
    else if (matches.length === 1) add(matches[0]);
  }

  async function save() {
    setBusy(true);
    try {
      await api.purchases.create({
        supplierId: Number(form.supplierId) || null,
        refNo: form.refNo,
        warehouseId: Number(form.warehouseId) || null,
        notes: form.notes,
        discount: toMinor(form.discount, d),
        paid: toMinor(form.paid, d),
        method: form.method,
        fromDrawer: form.fromDrawer,
        accountId: form.accountId || null,
        cheque: form.method === 'cheque' ? { no: form.chequeNo, due: form.chequeDue } : null,
        items: lines.map((l) => ({ product_id: l.product_id, unit_id: Number(l.unit_id) || null, qty: Number(l.qty), unit_cost: toMinor(l.unit_cost, d), discount_percent: Number(l.discount_percent) || 0, bonus_qty: Number(l.bonus_qty) || 0, batch_no: l.batch_no, expiry_date: l.expiry_date || null })),
        updatePrices: lines.filter((l) => toMinor(l.price, d) !== l.oldPrice).map((l) => ({ product_id: l.product_id, price: toMinor(l.price, d) })),
        poId: initial?.poId || null,
      });
      notify(t('common.saved'));
      onSaved();
    } catch (err) {
      notify(tErr(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('purchases.new')}
      onClose={onClose}
      width={980}
      footer={<>
        <span className="muted">{t('pos.total')}: <b className="big-num">{m(total)}</b></span>
        <span className="spacer" />
        <button onClick={onClose}>{t('common.cancel')}</button>
        <button className="primary" disabled={busy || !lines.length} onClick={save}>{t('purchases.receive')}</button>
      </>}
    >
      <div className="grid3">
        <Field label={t('purchases.supplier')}>
          <select value={form.supplierId} onChange={set('supplierId')}>
            <option value="">{t('purchases.noSupplier')}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label={t('purchases.refNo')}><input value={form.refNo} onChange={set('refNo')} /></Field>
        <WarehouseSelect value={form.warehouseId} onChange={(v) => setForm((f) => ({ ...f, warehouseId: v }))} />
        <Field label={t('pos.note')}><input value={form.notes} onChange={set('notes')} /></Field>
      </div>

      <div className="search-add">
        <input autoFocus placeholder={t('purchases.addProduct')} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onScan} />
        {!!matches.length && (
          <div className="dropdown">
            {matches.map((p) => <button key={p.id} type="button" onClick={() => add(p)}><span>{p.name}</span><small className="muted">{p.barcode} · {m(p.cost)}</small></button>)}
          </div>
        )}
      </div>

      <table className="grid compact-inputs">
        <thead><tr><th>{t('receipt.item')}</th><th className="num">{t('products.stock')}</th><th>{t('units.unit')}</th><th>{t('pos.qty')}</th><th>{t('purchases.unitCost')}</th><th title={t('purchases.lineDiscountHint')}>{t('purchases.lineDiscount')}</th><th title={t('purchases.bonusHint')}>{t('purchases.bonus')}</th><th>{t('products.price')}</th><th className="num">{t('common.total')}</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.product_id}>
              <td><b>{l.name}</b>
                {l.track_expiry && (
                  <div className="row expiry-inputs">
                    <input placeholder={t('expiry.batch')} value={l.batch_no} onChange={(e) => setLine(i, 'batch_no', e.target.value)} />
                    <input type="date" title={t('expiry.date')} value={l.expiry_date} onChange={(e) => setLine(i, 'expiry_date', e.target.value)} />
                  </div>
                )}
              </td>
              <td className="num muted">{l.track ? formatQty(l.stock) : '∞'}</td>
              <td>{l.units.length ? (
                <select value={l.unit_id} onChange={(e) => {
                  const u = l.units.find((x) => x.id === Number(e.target.value));
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit_id: e.target.value, unit_cost: fromMinor(Math.round(l.baseCost * (u?.factor || 1)), d) } : x)));
                }}>
                  <option value="">{t('units.base')}</option>
                  {l.units.map((u) => <option key={u.id} value={u.id}>{u.name} × {formatQty(u.factor)}</option>)}
                </select>
              ) : <span className="muted">—</span>}</td>
              <td><input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} /></td>
              <td><input inputMode="decimal" value={l.unit_cost} onChange={(e) => setLine(i, 'unit_cost', e.target.value)} /></td>
              <td><input className="w-pct" inputMode="decimal" placeholder="0" value={l.discount_percent} onChange={(e) => setLine(i, 'discount_percent', e.target.value)} /></td>
              <td><input className="w-pct" inputMode="decimal" placeholder="0" value={l.bonus_qty} onChange={(e) => setLine(i, 'bonus_qty', e.target.value)} /></td>
              <td><input inputMode="decimal" value={l.price} onChange={(e) => setLine(i, 'price', e.target.value)} title={t('purchases.priceHint')} /></td>
              <td className="num">{m(lineTotal(l))}{Number(l.bonus_qty) > 0 && Number(l.qty) > 0 && <div className="muted small">{t('purchases.netUnit')} {m(Math.round(lineTotal(l) / (Number(l.qty) + Number(l.bonus_qty))))}</div>}</td>
              <td><button className="danger-ghost sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!lines.length && <Empty>{t('purchases.emptyHint')}</Empty>}

      <div className="grid3 top-gap">
        <Field label={t('pos.discount')}><input inputMode="decimal" value={form.discount} onChange={set('discount')} placeholder="0" /></Field>
        <Field label={t('purchases.paidNow')} hint={form.supplierId ? t('purchases.paidHint') : t('purchases.needSupplier')}>
          <div className="row">
            <input inputMode="decimal" value={form.paid} onChange={set('paid')} placeholder="0" disabled={!form.supplierId} />
            <button type="button" disabled={!form.supplierId} onClick={() => setForm((f) => ({ ...f, paid: fromMinor(total, d) }))}>{t('purchases.payAll')}</button>
          </div>
        </Field>
        <Field label={t('purchases.method')}>
          <select value={form.method} onChange={set('method')} disabled={!form.supplierId}>
            {['cash', 'bank', 'cheque', 'card', 'wallet', 'other'].map((x) => <option key={x} value={x}>{t(`pay.${x}`)}</option>)}
          </select>
        </Field>
        {!!form.supplierId && !(form.method === 'cash' && form.fromDrawer) && can('treasury') && (
          <Field label={t('treasury.account')}><AccountSelect kind={form.method === 'cash' ? 'cash' : ['bank', 'cheque'].includes(form.method) ? 'bank' : ''} value={form.accountId} onChange={(v) => setForm((f) => ({ ...f, accountId: v }))} /></Field>
        )}
        {form.method === 'cheque' && !!form.supplierId && <>
          <Field label={t('collect.chequeNo')}><input dir="ltr" value={form.chequeNo || ''} onChange={set('chequeNo')} /></Field>
          <Field label={t('collect.chequeDue')}><input type="date" value={form.chequeDue || ''} onChange={set('chequeDue')} /></Field>
        </>}
      </div>
      {form.method === 'cash' && !!form.supplierId && (
        <Toggle checked={form.fromDrawer} onChange={set('fromDrawer')} label={shift ? t('purchases.fromDrawer') : `${t('purchases.fromDrawer')} — ${t('shift.none')}`} />
      )}
    </Modal>
  );
}

function PurchaseView({ id, onClose }) {
  const { t, tErr, notify, settings } = useApp();
  const [p, , setP] = useLoad(() => api.purchases.get(id), [id]);
  const [returning, setReturning] = useState(false);
  const [qtys, setQtys] = useState({});
  const [reason, setReason] = useState('');
  async function doReturn() {
    try {
      const items = Object.entries(qtys).map(([k, v]) => ({ purchase_item_id: Number(k), qty: Number(v) })).filter((x) => x.qty > 0);
      setP(await api.purchases.returnItems({ purchaseId: id, items, reason }));
      setReturning(false);
      setQtys({});
      notify(t('purchases.returned'));
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }
  const m = (v) => formatMoney(v, settings);
  if (!p) return null;
  const paid = p.payments.filter((x) => x.method !== 'return').reduce((s, x) => s + x.amount, 0);
  return (
    <Modal title={`${t('purchases.invoice')} #${p.id}`} onClose={onClose} width={760}
      footer={returning ? (
        <><input placeholder={t('orders.reason')} value={reason} onChange={(e) => setReason(e.target.value)} /><span className="spacer" />
          <button onClick={() => setReturning(false)}>{t('common.cancel')}</button><button className="danger" onClick={doReturn}>{t('common.confirm')}</button></>
      ) : (
        <><span className="spacer" /><button className="danger-ghost" onClick={() => setReturning(true)}>↩ {t('purchases.returnToSupplier')}</button></>
      )}>
      <div className="meta">
        <span>{p.created_at}</span><span>{p.supplier_name || '—'}</span>{p.ref_no && <span className="mono">{p.ref_no}</span>}<span>{p.user_name}</span>{p.warehouse_name && p.warehouse_id !== 1 && <span>🏬 {p.warehouse_name}</span>}
      </div>
      <table className="grid">
        <thead><tr><th>{t('receipt.item')}</th><th className="num">{t('pos.qty')}</th><th className="num">{t('purchases.unitCost')}</th><th className="num">{t('common.total')}</th><th className="num">{returning ? t('orders.returnQty') : t('orders.alreadyReturned')}</th></tr></thead>
        <tbody>{p.items.map((i) => (
          <tr key={i.id}>
            <td>{i.name}{(i.batch_no || i.expiry_date) && <small className="muted"> · {i.batch_no} {i.expiry_date}</small>}</td>
            <td className="num">{formatQty(i.qty)}{i.bonus_qty > 0 && <small className="badge">+{formatQty(i.bonus_qty)} {t('purchases.bonus')}</small>}</td><td className="num">{m(i.unit_cost)}{i.discount_percent > 0 && <small className="muted"> −{i.discount_percent}%</small>}</td><td className="num">{m(i.line_total)}</td>
            <td className="num">{returning
              ? <input className="qty-input" type="number" min="0" max={i.qty + (i.bonus_qty || 0) - i.returned_qty} step="any" disabled={i.qty + (i.bonus_qty || 0) - i.returned_qty <= 0} value={qtys[i.id] ?? ''} onChange={(e) => setQtys((q) => ({ ...q, [i.id]: e.target.value }))} />
              : i.returned_qty ? formatQty(i.returned_qty) : ''}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="totals compact">
        <div className="trow"><span>{t('pos.subtotal')}</span><span>{m(p.subtotal)}</span></div>
        {!!p.discount && <div className="trow"><span>{t('pos.discount')}</span><span>− {m(p.discount)}</span></div>}
        <div className="trow big"><span>{t('pos.total')}</span><span>{m(p.total)}</span></div>
        <div className="trow"><span>{t('pay.paid')}</span><span>{m(paid)}</span></div>
        {!!p.returned && <div className="trow"><span>{t('purchases.returnedValue')}</span><span>− {m(p.returned)}</span></div>}
        {p.total - paid - p.returned > 0 && <div className="trow warn"><span>{t('purchases.due')}</span><span>{m(p.total - paid - p.returned)}</span></div>}
      </div>
      {p.notes && <p className="muted">{p.notes}</p>}
    </Modal>
  );
}

// ---------- suppliers ----------
function SupplierList() {
  const { t, settings } = useApp();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [statementId, setStatementId] = useState(null);
  const [list, reload] = useLoad(() => api.suppliers.list({ search, includeInactive: true }), [search]);
  const m = (v) => formatMoney(v, settings);
  const owed = (list || []).reduce((s, x) => s + Math.max(0, x.balance), 0);
  return (
    <>
      <div className="filters toolbar">
        <input placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="muted">{t('purchases.totalOwed')}: <b className="warn">{m(owed)}</b></span>
        <span className="spacer" />
        <ExcelButtons kind="suppliers" onImported={reload} />
        <button className="primary" onClick={() => setEditing({ name: '', phone: '', address: '', notes: '', active: true })}>+ {t('purchases.newSupplier')}</button>
      </div>
      <div className="card flush">
        <table className="grid">
          <thead><tr><th>{t('common.name')}</th><th>{t('settings.phone')}</th><th>{t('settings.address')}</th><th className="num">{t('purchases.balance')}</th><th /></tr></thead>
          <tbody>
            {(list || []).map((s) => (
              <tr key={s.id} className={`clickable ${s.active ? '' : 'dim'}`} onClick={() => setStatementId(s.id)}>
                <td><b>{s.name}</b></td><td className="mono">{s.phone}</td><td>{s.address}</td>
                <td className={`num ${s.balance > 0 ? 'warn' : ''}`}>{m(s.balance)}</td>
                <td className="num"><button className="ghost sm" onClick={(e) => { e.stopPropagation(); setEditing(s); }}>{t('common.edit')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list && !list.length && <Empty>{t('common.none')}</Empty>}
      </div>
      {editing && <SupplierModal supplier={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {statementId && <Statement id={statementId} onClose={() => { setStatementId(null); reload(); }} />}
    </>
  );
}

function SupplierModal({ supplier, onClose, onSaved }) {
  const { t, tErr, notify } = useApp();
  const [f, setF] = useState(supplier);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  async function save(e) {
    e?.preventDefault();
    try { await api.suppliers.save(f); onSaved(); } catch (err) { notify(tErr(err), 'error'); }
  }
  return (
    <Modal title={f.id ? f.name : t('purchases.newSupplier')} onClose={onClose}
      footer={<><span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
      <form className="grid2" onSubmit={save}>
        <Field label={t('common.name')}><input autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label={t('settings.phone')}><input value={f.phone} onChange={set('phone')} /></Field>
        <div className="span2"><Field label={t('settings.address')}><input value={f.address} onChange={set('address')} /></Field></div>
        <div className="span2"><Field label={t('pos.note')}><input value={f.notes} onChange={set('notes')} /></Field></div>
        {f.id && <Toggle checked={f.active} onChange={set('active')} label={t('common.active')} />}
        <button hidden />
      </form>
    </Modal>
  );
}

function Statement({ id, onClose }) {
  const { t, tErr, notify, settings, shift, can } = useApp();
  const [data, , setData] = useLoad(() => api.suppliers.statement(id), [id]);
  const [pay, setPay] = useState(null);
  const m = (v) => formatMoney(v, settings);
  if (!data) return null;
  async function submitPay(e) {
    e?.preventDefault();
    try {
      setData(await api.suppliers.pay({
        supplierId: id, amount: toMinor(pay.amount, settings.decimals), method: pay.method, fromDrawer: pay.fromDrawer, notes: pay.notes,
        accountId: pay.accountId || null, cheque: pay.method === 'cheque' ? { no: pay.chequeNo, due: pay.due } : null,
      }));
      setPay(null);
      notify(t('common.saved'));
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }
  return (
    <Modal title={`${t('purchases.statement')} — ${data.supplier.name}`} onClose={onClose} width={760}
      footer={pay ? (
        <form className="row grow wrap" onSubmit={submitPay}>
          <input className="w-amount" autoFocus inputMode="decimal" placeholder={t('reports.amount')} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
          <select className="w-auto" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
            {['cash', 'bank', 'cheque', 'card', 'wallet', 'other'].map((x) => <option key={x} value={x}>{t(`pay.${x}`)}</option>)}
          </select>
          {pay.method === 'cash' && shift && <Toggle checked={pay.fromDrawer} onChange={(v) => setPay({ ...pay, fromDrawer: v })} label={t('purchases.fromDrawer')} />}
          {!(pay.method === 'cash' && pay.fromDrawer) && can('treasury') && <span className="w-auto"><AccountSelect kind={pay.method === 'cash' ? 'cash' : pay.method === 'cheque' || pay.method === 'bank' ? 'bank' : ''} value={pay.accountId} onChange={(v) => setPay({ ...pay, accountId: v })} /></span>}
          {pay.method === 'cheque' && <>
            <input className="w-amount" dir="ltr" placeholder={t('collect.chequeNo')} value={pay.chequeNo || ''} onChange={(e) => setPay({ ...pay, chequeNo: e.target.value })} />
            <input className="w-auto" type="date" title={t('collect.chequeDue')} value={pay.due || ''} onChange={(e) => setPay({ ...pay, due: e.target.value })} />
          </>}
          <span className="spacer" />
          <button type="button" onClick={() => setPay(null)}>{t('common.cancel')}</button>
          <button className="primary">{t('common.save')}</button>
        </form>
      ) : (
        <>
          <span>{t('purchases.balance')}: <b className={data.supplier.balance > 0 ? 'warn' : ''}>{m(data.supplier.balance)}</b></span>
          <span className="spacer" />
          <button className="primary" onClick={() => setPay({ amount: data.supplier.balance > 0 ? fromMinor(data.supplier.balance, settings.decimals) : '', method: 'cash', fromDrawer: false, notes: '' })}>💵 {t('purchases.paySupplier')}</button>
        </>
      )}>
      <table className="grid">
        <thead><tr><th>{t('orders.date')}</th><th>{t('orders.type')}</th><th className="num">{t('purchases.debit')}</th><th className="num">{t('purchases.credit')}</th><th className="num">{t('purchases.balance')}</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={`${r.kind}${r.id}`}>
              <td>{r.created_at}</td>
              <td>{r.kind === 'purchase' ? `${t('purchases.invoice')} #${r.id}${r.ref ? ` (${r.ref})` : ''}` : r.ref === 'rebate' ? `🎁 ${t('rebates.received')}` : r.ref === 'return' ? `↩ ${t('purchases.returnToSupplier')}` : `${t('purchases.payment')} — ${t(`pay.${r.ref}`)}`}{r.notes && <small className="muted"> — {r.notes}</small>}</td>
              <td className="num">{r.debit ? m(r.debit) : ''}</td>
              <td className="num">{r.credit ? m(r.credit) : ''}</td>
              <td className="num"><b>{m(r.balance)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.rows.length && <Empty>{t('common.none')}</Empty>}
    </Modal>
  );
}

// ---------- purchase orders ----------
function PurchaseOrders() {
  const { t, tErr, notify, settings } = useApp();
  const [status, setStatus] = useState('');
  const [list, reload] = useLoad(() => api.purchaseOrders.list({ status }), [status]);
  const [view, setView] = useState(null);
  const [suggest, setSuggest] = useState(null);
  const [receiving, setReceiving] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  return (
    <>
      <div className="filters toolbar">
        <div className="seg">{['', 'draft', 'sent', 'received', 'cancelled'].map((x) => <button key={x} className={status === x ? 'on' : ''} onClick={() => setStatus(x)}>{x ? t(`po.status.${x}`) : t('common.all')}</button>)}</div>
        <span className="spacer" />
        <button onClick={() => run(async () => setSuggest(await api.purchaseOrders.suggest()))}>📦 {t('po.fromLowStock')}</button>
        <button className="primary" onClick={() => setView({ supplier_id: '', notes: '', items: [], status: 'draft' })}>+ {t('po.new')}</button>
      </div>
      <div className="card flush">
        <table className="grid">
          <thead><tr><th>#</th><th>{t('orders.date')}</th><th>{t('purchases.supplier')}</th><th className="num">{t('po.items')}</th><th className="num">{t('common.total')}</th><th>{t('orders.type')}</th></tr></thead>
          <tbody>{(list || []).map((po) => (
            <tr key={po.id} className="clickable" onClick={() => run(async () => setView(await api.purchaseOrders.get(po.id)))}>
              <td><b>{po.po_no}</b></td><td>{po.created_at.slice(0, 10)}</td><td>{po.supplier_name || '—'}</td><td className="num">{po.item_count}</td>
              <td className="num">{m(po.total)}</td><td><span className={`badge status-${po.status}`}>{t(`po.status.${po.status}`)}</span></td>
            </tr>
          ))}</tbody>
        </table>
        {list && !list.length && <Empty>{t('po.none')}</Empty>}
      </div>
      {suggest && (
        <Modal title={`📦 ${t('po.fromLowStock')}`} onClose={() => setSuggest(null)} width={760}>
          {!suggest.length && <Empty>{t('po.nothingLow')}</Empty>}
          {suggest.map((g) => (
            <div key={g.supplier_id || 0} className="card">
              <div className="row between"><b>{g.supplier_name || t('po.noSupplier')}</b>
                <button className="primary sm" onClick={() => run(async () => { const po = await api.purchaseOrders.save({ supplier_id: g.supplier_id, items: g.items }); setSuggest(null); reload(); setView(po); })}>+ {t('po.create')}</button>
              </div>
              <table className="grid compact"><tbody>{g.items.map((i) => <tr key={i.product_id}><td>{i.name}</td><td className="num warn">{formatQty(i.stock)}</td><td className="num muted">/ {formatQty(i.min_stock)}</td><td className="num">→ <b>{formatQty(i.qty)}</b></td></tr>)}</tbody></table>
            </div>
          ))}
        </Modal>
      )}
      {view && <PoModal po={view} onClose={() => setView(null)} onChanged={(po) => { reload(); if (po) setView(po); }} onReceive={(po) => { setView(null); setReceiving({ supplierId: po.supplier_id, items: po.items, poId: po.id, notes: `${t('po.po')} #${po.po_no}` }); }} />}
      {receiving && <PurchaseEditor initial={receiving} onClose={() => setReceiving(null)} onSaved={() => { setReceiving(null); reload(); }} />}
    </>
  );
}

function PoModal({ po, onClose, onChanged, onReceive }) {
  const { t, tErr, notify, settings, printDoc, lang, can } = useApp();
  const d = settings.decimals;
  const [f, setF] = useState({ ...po, items: po.items.map((i) => ({ ...i, qty: String(i.qty), cost: i.unit_cost != null ? fromMinor(i.unit_cost, d) : '' })) });
  const [suppliers] = useLoad(() => api.suppliers.list({}), []);
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);
  const editable = !po.id || ['draft', 'sent'].includes(po.status);
  const m = (v) => formatMoney(v, settings);
  useEffect(() => {
    if (!search.trim()) { setMatches([]); return undefined; }
    const h = setTimeout(() => api.products.list({ search }).then((r) => setMatches(r.slice(0, 8))), 120);
    return () => clearTimeout(h);
  }, [search]);
  const run = async (fn) => { try { return await fn(); } catch (err) { notify(tErr(err), 'error'); return null; } };
  const payload = () => ({ id: po.id, supplier_id: Number(f.supplier_id) || null, notes: f.notes, items: f.items.map((i) => ({ product_id: i.product_id, unit_id: i.unit_id, qty: Number(i.qty), unit_cost: i.cost === '' ? 0 : toMinor(i.cost, d) })) });
  const save = () => run(async () => { const saved = await api.purchaseOrders.save(payload()); notify(t('common.saved')); onChanged(saved); return saved; });
  const supplier = (suppliers || []).find((s) => s.id === Number(f.supplier_id));
  const text = (x) => [`*${settings.business_name}*`, `${t('po.po')} #${x.po_no} — ${x.created_at.slice(0, 10)}`, '', ...x.items.map((i) => `• ${i.name} × ${formatQty(i.qty)}${i.unit_name ? ` ${i.unit_name}` : ''}`), '', x.notes || '', settings.phone ? `📞 ${settings.phone}` : ''].filter(Boolean).join('\n');
  return (
    <Modal title={po.id ? `${t('po.po')} #${po.po_no} — ${t(`po.status.${po.status}`)}` : t('po.new')} onClose={onClose} width={820}
      footer={<>
        {po.id && editable && <button className="danger-ghost" onClick={() => run(async () => { onChanged(await api.purchaseOrders.setStatus({ id: po.id, status: 'cancelled' })); })}>{t('po.cancel')}</button>}
        <span className="spacer" />
        {po.id && <button onClick={() => printDoc(poHtml(po, settings, t, lang), settings.a4_printer_name)}>📄 {t('a4.printA4')}</button>}
        {po.id && supplier?.phone && <button onClick={() => run(async () => { openWhatsApp(supplier.phone, text(po)); if (po.status === 'draft') onChanged(await api.purchaseOrders.setStatus({ id: po.id, status: 'sent' })); })}>💬 {t('po.sendWhatsapp')}</button>}
        {editable && <button onClick={save}>{t('common.save')}</button>}
        {po.id && editable && can('purchases') && <button className="primary" onClick={() => run(async () => { const saved = await api.purchaseOrders.save(payload()); onReceive(saved); })}>📥 {t('po.receive')}</button>}
      </>}>
      <div className="grid2">
        <Field label={t('purchases.supplier')}>
          <select value={f.supplier_id || ''} disabled={!editable} onChange={(e) => setF({ ...f, supplier_id: e.target.value })}>
            <option value="">—</option>{(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label={t('pos.note')}><input value={f.notes || ''} disabled={!editable} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {editable && (
        <div className="search-add">
          <input placeholder={t('purchases.addProduct')} value={search} onChange={(e) => setSearch(e.target.value)} />
          {!!matches.length && <div className="dropdown">{matches.map((p) => <button key={p.id} type="button" onClick={() => { setF({ ...f, items: [...f.items, { product_id: p.id, name: p.name, stock: p.stock, min_stock: p.min_stock, qty: '1', cost: p.cost != null ? fromMinor(p.cost, d) : '', unit_id: null }] }); setSearch(''); }}><span>{p.name}</span><small className="muted">{formatQty(p.stock)}</small></button>)}</div>}
        </div>
      )}
      <table className="grid compact-inputs">
        <thead><tr><th>{t('receipt.item')}</th><th className="num">{t('products.stock')}</th><th>{t('pos.qty')}</th>{can('view_cost') && <th>{t('purchases.unitCost')}</th>}<th /></tr></thead>
        <tbody>{f.items.map((i, idx) => (
          <tr key={`${i.product_id}-${idx}`}>
            <td>{i.name}{i.unit_name && <small className="muted"> ({i.unit_name})</small>}</td>
            <td className="num muted">{formatQty(i.stock)}{i.min_stock ? ` / ${formatQty(i.min_stock)}` : ''}</td>
            <td><input className="qty-input" disabled={!editable} inputMode="decimal" value={i.qty} onChange={(e) => setF({ ...f, items: f.items.map((x, j) => (j === idx ? { ...x, qty: e.target.value } : x)) })} /></td>
            {can('view_cost') && <td><input className="qty-input" disabled={!editable} inputMode="decimal" value={i.cost} onChange={(e) => setF({ ...f, items: f.items.map((x, j) => (j === idx ? { ...x, cost: e.target.value } : x)) })} /></td>}
            <td>{editable && <button className="danger-ghost sm" onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== idx) })}>✕</button>}</td>
          </tr>
        ))}</tbody>
      </table>
      {po.total != null && <p className="muted">{t('common.total')}: <b>{m(po.total)}</b></p>}
    </Modal>
  );
}

// ---------- supplier rebates ----------
function Rebates() {
  const { t, tErr, notify, settings, ask } = useApp();
  const [status, setStatus] = useState('open');
  const [list, reload] = useLoad(() => api.rebates.list({ status }), [status]);
  const [editing, setEditing] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const run = async (fn) => { try { await fn(); reload(); } catch (err) { notify(tErr(err), 'error'); } };
  const y = new Date().getFullYear();
  const blank = { supplier_id: '', name: '', basis: 'purchases', start_date: `${y}-01-01`, end_date: `${y}-12-31`, target: '', percent: '', fixed_amount: '', notes: '' };
  return (
    <>
      <div className="filters toolbar">
        <div className="seg">{['open', 'settled', 'cancelled', ''].map((x) => <button key={x} className={status === x ? 'on' : ''} onClick={() => setStatus(x)}>{x ? t(`rebates.status.${x}`) : t('common.all')}</button>)}</div>
        <span className="muted small">{t('rebates.hint')}</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing(blank)}>+ {t('rebates.new')}</button>
      </div>
      <div className="rebate-grid">
        {(list || []).map((r) => (
          <div key={r.id} className={`card rebate ${r.reached ? 'reached' : ''}`}>
            <div className="row between"><b>{r.name}</b><span className={`badge ${r.status === 'open' ? '' : 'dim'}`}>{t(`rebates.status.${r.status}`)}</span></div>
            <div className="muted small">{r.supplier_name} · {t(`rebates.basis.${r.basis}`)} · <span dir="ltr" className="nowrap">{r.start_date} → {r.end_date}</span></div>
            <div className="muted small">{r.percent ? `${r.percent}%` : ''}{r.percent && r.fixed_amount ? ' + ' : ''}{r.fixed_amount ? m(r.fixed_amount) : ''}{r.target ? ` ${t('rebates.whenReach', { v: m(r.target) })}` : ''}</div>
            <div className="progress"><span style={{ width: `${r.progress}%` }} /></div>
            <div className="row between small"><span>{t('rebates.achieved')}: <b>{m(r.achieved)}</b></span>{r.target > 0 && <span>{r.reached ? `✅ ${t('rebates.reached')}` : t('rebates.remaining', { v: m(r.remaining) })}</span>}</div>
            {r.status === 'open' ? (
              <div className="row between top-gap">
                <span>{t('rebates.earned')}: <b className={r.earned ? 'good' : ''}>{m(r.earned)}</b></span>
                <span className="row">
                  <button className="ghost sm" onClick={() => setEditing({ ...r, target: fromMinor(r.target, settings.decimals), fixed_amount: r.fixed_amount ? fromMinor(r.fixed_amount, settings.decimals) : '' })}>{t('common.edit')}</button>
                  <button className="danger-ghost sm" onClick={() => run(async () => { if (window.confirm(t('common.areYouSure'))) await api.rebates.cancel(r.id); })}>{t('common.cancel')}</button>
                  <button className="primary sm" onClick={async () => {
                    const v = await ask(t('rebates.settlePrompt'), { type: 'number', initial: fromMinor(r.earned, settings.decimals), required: true });
                    if (v != null) run(async () => { await api.rebates.settle({ id: r.id, amount: toMinor(v, settings.decimals) }); notify(t('rebates.settled')); });
                  }}>🎁 {t('rebates.settle')}</button>
                </span>
              </div>
            ) : r.status === 'settled' && <div className="top-gap">{t('rebates.received')}: <b className="good">{m(r.settled_amount)}</b> <small className="muted">{r.settled_at?.slice(0, 10)}</small></div>}
          </div>
        ))}
      </div>
      {list && !list.length && <Empty>{t('rebates.none')}</Empty>}
      {editing && <RebateModal rebate={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function RebateModal({ rebate, onClose, onSaved }) {
  const { t, tErr, notify, settings } = useApp();
  const [f, setF] = useState(rebate);
  const [suppliers] = useLoad(() => api.suppliers.list({}), []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  async function save() {
    try {
      await api.rebates.save({ ...f, target: toMinor(f.target, settings.decimals), fixed_amount: toMinor(f.fixed_amount, settings.decimals), percent: Number(f.percent) || 0 });
      onSaved();
    } catch (err) { notify(tErr(err), 'error'); }
  }
  return (
    <Modal title={f.id ? f.name : t('rebates.new')} onClose={onClose} width={620}
      footer={<><span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
      <div className="grid2">
        <Field label={t('purchases.supplier')}>
          <select value={f.supplier_id} onChange={set('supplier_id')}>
            <option value="">—</option>
            {(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label={t('common.name')}><input value={f.name} placeholder={t('rebates.namePh')} onChange={set('name')} /></Field>
        <div className="span2"><Field label={t('rebates.basisLabel')}>
          <div className="seg full">{['purchases', 'sales'].map((b) => <button key={b} type="button" className={f.basis === b ? 'on' : ''} onClick={() => setF({ ...f, basis: b })}>{t(`rebates.basis.${b}`)}</button>)}</div>
        </Field><small className="muted">{t(`rebates.basisHint.${f.basis}`)}</small></div>
        <Field label={t('common.from')}><input type="date" value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label={t('common.to')}><input type="date" value={f.end_date} onChange={set('end_date')} /></Field>
        <Field label={t('rebates.target')} hint={t('rebates.targetHint')}><input inputMode="decimal" value={f.target} onChange={set('target')} placeholder="0" /></Field>
        <Field label={t('rebates.percent')}><input inputMode="decimal" value={f.percent} onChange={set('percent')} placeholder="0" /></Field>
        <Field label={t('rebates.fixed')}><input inputMode="decimal" value={f.fixed_amount} onChange={set('fixed_amount')} placeholder="0" /></Field>
        <Field label={t('pos.note')}><input value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

// ---------- expenses ----------
function ExpenseList() {
  const { t, tErr, notify, settings } = useApp();
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [adding, setAdding] = useState(false);
  const [list, reload] = useLoad(() => api.expenses.list(range), [range.from, range.to]);
  const m = (v) => formatMoney(v, settings);
  const sum = (list || []).reduce((s, e) => s + e.amount, 0);
  async function remove(id) {
    if (!window.confirm(t('common.areYouSure'))) return;
    try { await api.expenses.remove(id); reload(); } catch (err) { notify(tErr(err), 'error'); }
  }
  return (
    <>
      <DateRange range={range} setRange={setRange}>
        <button className="primary" onClick={() => setAdding(true)}>+ {t('expenses.new')}</button>
      </DateRange>
      <div className="card flush">
        <table className="grid">
          <thead><tr><th>{t('orders.date')}</th><th>{t('expenses.category')}</th><th>{t('pos.note')}</th><th>{t('shift.by')}</th><th>{t('expenses.source')}</th><th className="num">{t('reports.amount')}</th><th /></tr></thead>
          <tbody>
            {(list || []).map((e) => (
              <tr key={e.id}>
                <td>{e.created_at}</td><td><b>{e.category}</b></td><td>{e.notes}</td><td>{e.user_name}</td>
                <td>{e.from_drawer ? t('expenses.drawer') : t('expenses.outside')}</td>
                <td className="num">{m(e.amount)}</td>
                <td className="num"><button className="danger-ghost sm" onClick={() => remove(e.id)}>{t('common.delete')}</button></td>
              </tr>
            ))}
          </tbody>
          {!!list?.length && <tfoot><tr><td colSpan={5}>{list.length}</td><td className="num"><b>{m(sum)}</b></td><td /></tr></tfoot>}
        </table>
        {list && !list.length && <Empty>{t('common.none')}</Empty>}
      </div>
      {adding && <ExpenseModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />}
    </>
  );
}

export function ExpenseModal({ onClose, onSaved }) {
  const { t, tErr, notify, settings, shift, withApproval, can } = useApp();
  const [f, setF] = useState({ category: '', amount: '', notes: '', fromDrawer: !!shift, accountId: null });
  const [cats, setCats] = useState([]);
  useEffect(() => { api.expenses.categories().then(setCats).catch(() => {}); }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  async function save(e) {
    e?.preventDefault();
    try {
      await withApproval((approval) => api.expenses.create({ ...f, amount: toMinor(f.amount, settings.decimals), approval }));
      notify(t('common.saved'));
      onSaved();
    } catch (err) {
      if (err.code !== 'CANCELLED') notify(tErr(err), 'error');
    }
  }
  return (
    <Modal title={t('expenses.new')} onClose={onClose} width={480}
      footer={<><span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
      <form onSubmit={save}>
        <Field label={t('reports.amount')}><input className="xl" autoFocus inputMode="decimal" value={f.amount} onChange={set('amount')} /></Field>
        <Field label={t('expenses.category')}>
          <input list="expense-cats" value={f.category} onChange={set('category')} placeholder={t('expenses.categoryHint')} />
          <datalist id="expense-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label={t('pos.note')}><input value={f.notes} onChange={set('notes')} /></Field>
        <Toggle checked={f.fromDrawer} onChange={set('fromDrawer')} label={t('expenses.fromDrawer')} />
        {!f.fromDrawer && can('treasury') && <Field label={t('treasury.paidFrom')}><AccountSelect value={f.accountId} onChange={(v) => setF((x) => ({ ...x, accountId: v }))} /></Field>}
        <button hidden />
      </form>
    </Modal>
  );
}
