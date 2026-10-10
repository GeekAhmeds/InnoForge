import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty, fromMinor, toMinor } from '../lib/money.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from '../components/ui.jsx';
import { today } from './Orders.jsx';

export default function Purchases() {
  const { t } = useApp();
  const [tab, setTab] = useState('purchases');
  return (
    <div className="page">
      <div className="page-head">
        <h2>🚚 {t('nav.purchases')}</h2>
        <div className="seg">
          {['purchases', 'suppliers', 'expenses'].map((x) => (
            <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`purchases.tab.${x}`)}</button>
          ))}
        </div>
      </div>
      {tab === 'purchases' && <PurchaseList />}
      {tab === 'suppliers' && <SupplierList />}
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

function PurchaseEditor({ onClose, onSaved }) {
  const { t, tErr, notify, settings, shift } = useApp();
  const d = settings.decimals;
  const m = (v) => formatMoney(v, settings);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState({ supplierId: '', refNo: '', discount: '', paid: '', method: 'cash', fromDrawer: false, notes: '' });
  const [lines, setLines] = useState([]);
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.suppliers.list({}).then(setSuppliers); }, []);
  useEffect(() => {
    if (!search.trim()) { setMatches([]); return undefined; }
    const h = setTimeout(() => api.products.list({ search }).then((r) => setMatches(r.slice(0, 8))), 120);
    return () => clearTimeout(h);
  }, [search]);

  const add = (p) => {
    setLines((ls) => (ls.some((l) => l.product_id === p.id) ? ls : [...ls, {
      product_id: p.id, name: p.name, qty: '1', unit_cost: fromMinor(p.cost, d), price: fromMinor(p.price, d), oldPrice: p.price, stock: p.stock, track: p.track_stock,
    }]));
    setSearch('');
  };
  const setLine = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const subtotal = lines.reduce((s, l) => s + Math.round((Number(l.qty) || 0) * toMinor(l.unit_cost, d)), 0);
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
        notes: form.notes,
        discount: toMinor(form.discount, d),
        paid: toMinor(form.paid, d),
        method: form.method,
        fromDrawer: form.fromDrawer,
        items: lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty), unit_cost: toMinor(l.unit_cost, d) })),
        updatePrices: lines.filter((l) => toMinor(l.price, d) !== l.oldPrice).map((l) => ({ product_id: l.product_id, price: toMinor(l.price, d) })),
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
        <thead><tr><th>{t('receipt.item')}</th><th className="num">{t('products.stock')}</th><th>{t('pos.qty')}</th><th>{t('purchases.unitCost')}</th><th>{t('products.price')}</th><th className="num">{t('common.total')}</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.product_id}>
              <td><b>{l.name}</b></td>
              <td className="num muted">{l.track ? formatQty(l.stock) : '∞'}</td>
              <td><input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} /></td>
              <td><input inputMode="decimal" value={l.unit_cost} onChange={(e) => setLine(i, 'unit_cost', e.target.value)} /></td>
              <td><input inputMode="decimal" value={l.price} onChange={(e) => setLine(i, 'price', e.target.value)} title={t('purchases.priceHint')} /></td>
              <td className="num">{m(Math.round((Number(l.qty) || 0) * toMinor(l.unit_cost, d)))}</td>
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
            {['cash', 'card', 'wallet', 'other'].map((x) => <option key={x} value={x}>{t(`pay.${x}`)}</option>)}
          </select>
        </Field>
      </div>
      {form.method === 'cash' && !!form.supplierId && (
        <Toggle checked={form.fromDrawer} onChange={set('fromDrawer')} label={shift ? t('purchases.fromDrawer') : `${t('purchases.fromDrawer')} — ${t('shift.none')}`} />
      )}
    </Modal>
  );
}

function PurchaseView({ id, onClose }) {
  const { t, settings } = useApp();
  const [p] = useLoad(() => api.purchases.get(id), [id]);
  const m = (v) => formatMoney(v, settings);
  if (!p) return null;
  const paid = p.payments.reduce((s, x) => s + x.amount, 0);
  return (
    <Modal title={`${t('purchases.invoice')} #${p.id}`} onClose={onClose} width={720}>
      <div className="meta">
        <span>{p.created_at}</span><span>{p.supplier_name || '—'}</span>{p.ref_no && <span className="mono">{p.ref_no}</span>}<span>{p.user_name}</span>
      </div>
      <table className="grid">
        <thead><tr><th>{t('receipt.item')}</th><th className="num">{t('pos.qty')}</th><th className="num">{t('purchases.unitCost')}</th><th className="num">{t('common.total')}</th></tr></thead>
        <tbody>{p.items.map((i) => <tr key={i.id}><td>{i.name}</td><td className="num">{formatQty(i.qty)}</td><td className="num">{m(i.unit_cost)}</td><td className="num">{m(i.line_total)}</td></tr>)}</tbody>
      </table>
      <div className="totals compact">
        <div className="trow"><span>{t('pos.subtotal')}</span><span>{m(p.subtotal)}</span></div>
        {!!p.discount && <div className="trow"><span>{t('pos.discount')}</span><span>− {m(p.discount)}</span></div>}
        <div className="trow big"><span>{t('pos.total')}</span><span>{m(p.total)}</span></div>
        <div className="trow"><span>{t('pay.paid')}</span><span>{m(paid)}</span></div>
        {p.total - paid > 0 && <div className="trow warn"><span>{t('purchases.due')}</span><span>{m(p.total - paid)}</span></div>}
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
  const { t, tErr, notify, settings, shift } = useApp();
  const [data, , setData] = useLoad(() => api.suppliers.statement(id), [id]);
  const [pay, setPay] = useState(null);
  const m = (v) => formatMoney(v, settings);
  if (!data) return null;
  async function submitPay(e) {
    e?.preventDefault();
    try {
      setData(await api.suppliers.pay({ supplierId: id, amount: toMinor(pay.amount, settings.decimals), method: pay.method, fromDrawer: pay.fromDrawer, notes: pay.notes }));
      setPay(null);
      notify(t('common.saved'));
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }
  return (
    <Modal title={`${t('purchases.statement')} — ${data.supplier.name}`} onClose={onClose} width={760}
      footer={pay ? (
        <form className="row grow" onSubmit={submitPay}>
          <input className="w-amount" autoFocus inputMode="decimal" placeholder={t('reports.amount')} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
          <select className="w-auto" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
            {['cash', 'card', 'wallet', 'other'].map((x) => <option key={x} value={x}>{t(`pay.${x}`)}</option>)}
          </select>
          {pay.method === 'cash' && shift && <Toggle checked={pay.fromDrawer} onChange={(v) => setPay({ ...pay, fromDrawer: v })} label={t('purchases.fromDrawer')} />}
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
              <td>{r.kind === 'purchase' ? `${t('purchases.invoice')} #${r.id}${r.ref ? ` (${r.ref})` : ''}` : `${t('purchases.payment')} — ${t(`pay.${r.ref}`)}`}{r.notes && <small className="muted"> — {r.notes}</small>}</td>
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
  const { t, tErr, notify, settings, shift, isAdmin } = useApp();
  const [f, setF] = useState({ category: '', amount: '', notes: '', fromDrawer: !!shift });
  const [cats, setCats] = useState([]);
  useEffect(() => { api.expenses.categories().then(setCats).catch(() => {}); }, []);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  async function save(e) {
    e?.preventDefault();
    try {
      await api.expenses.create({ ...f, amount: toMinor(f.amount, settings.decimals) });
      notify(t('common.saved'));
      onSaved();
    } catch (err) {
      notify(tErr(err), 'error');
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
        {isAdmin && <Toggle checked={f.fromDrawer} onChange={set('fromDrawer')} label={t('expenses.fromDrawer')} />}
        <button hidden />
      </form>
    </Modal>
  );
}
