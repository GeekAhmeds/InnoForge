import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty, fromMinor, toMinor } from '../lib/money.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from '../components/ui.jsx';
import { ExcelButtons } from '../components/ExcelImport.jsx';
import LabelsModal from '../components/Labels.jsx';

export default function Products() {
  const { t, settings, can } = useApp();
  const [tab, setTab] = useState('products');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [labels, setLabels] = useState(false);
  const [categories, reloadCategories] = useLoad(() => api.categories.list(), []);
  const [list, reload] = useLoad(
    () => (lowOnly ? api.products.lowStock() : api.products.list({ search, categoryId, includeInactive: true })),
    [search, categoryId, lowOnly],
  );
  const bookstore = settings.business_type === 'bookstore';
  const m = (v) => formatMoney(v, settings);

  return (
    <div className="page">
      <div className="page-head">
        <div className="seg">
          <button className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')}>{t('products.title')}</button>
          <button className={tab === 'categories' ? 'on' : ''} onClick={() => setTab('categories')}>{t('products.categories')}</button>
          {can('purchases') && <button className={tab === 'counts' ? 'on' : ''} onClick={() => setTab('counts')}>{t('counts.title')}</button>}
          <button className={tab === 'expiry' ? 'on' : ''} onClick={() => setTab('expiry')}>{t('expiry.title')}</button>
        </div>
        {tab === 'products' && (
          <div className="filters">
            <input placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={categoryId || ''} onChange={(e) => setCategoryId(Number(e.target.value) || null)}>
              <option value="">{t('common.all')}</option>
              {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Toggle checked={lowOnly} onChange={setLowOnly} label={t('products.lowStock')} />
            <button onClick={() => setLabels(true)}>🏷 {t('labels.button')}</button>
            <ExcelButtons kind="products" onImported={() => { reload(); reloadCategories(); }} />
            <button className="primary" onClick={() => setEditing({})}>+ {t('products.new')}</button>
          </div>
        )}
      </div>

      {tab === 'counts' && <StockCounts categories={categories || []} />}
      {tab === 'expiry' && <Expiring />}
      {tab === 'categories' ? (
        <Categories categories={categories || []} reload={reloadCategories} />
      ) : tab !== 'products' ? null : (
        <div className="card flush">
          <table className="grid">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{bookstore ? t('products.isbn') : t('products.barcode')}</th>
                <th>{t('products.category')}</th>
                <th className="num">{t('products.price')}</th>
                {can('view_cost') && <th className="num">{t('products.cost')}</th>}
                <th className="num">{t('products.stock')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list || []).map((p) => (
                <tr key={p.id} className={`clickable ${p.active ? '' : 'dim'}`} onClick={() => setEditing(p)}>
                  <td>
                    <b>{p.name}</b>
                    {p.author && <small className="muted"> — {p.author}</small>}
                    {!p.active && <small className="badge">{t('products.inactive')}</small>}
                  </td>
                  <td className="mono">{p.barcode}</td>
                  <td>{p.category_name && <span className="dot" style={{ background: p.category_color }} />}{p.category_name}</td>
                  <td className="num">{m(p.price)}</td>
                  {can('view_cost') && <td className="num muted">{m(p.cost)}</td>}
                  <td className={`num ${p.track_stock && p.stock <= p.min_stock ? 'warn' : ''}`}>{p.track_stock ? formatQty(p.stock) : '∞'}</td>
                  <td className="num">
                    {!!p.track_stock && <button className="ghost sm" onClick={(e) => { e.stopPropagation(); setAdjusting(p); }}>± {t('products.adjust')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list && !list.length && <Empty>{t('common.none')}</Empty>}
        </div>
      )}

      {editing && <ProductModal product={editing} categories={categories || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {labels && list && <LabelsModal products={list} onClose={() => setLabels(false)} onChanged={reload} />}
      {adjusting && <AdjustModal product={adjusting} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); reload(); }} />}
    </div>
  );
}

function ProductModal({ product, categories, onClose, onSaved }) {
  const { t, tErr, notify, settings, can } = useApp();
  const d = settings.decimals;
  const isNew = !product.id;
  const restaurant = settings.business_type === 'restaurant';
  const bookstore = settings.business_type === 'bookstore';
  const [f, setF] = useState({
    name: product.name || '',
    barcode: product.barcode || '',
    category_id: product.category_id || '',
    price: product.id ? fromMinor(product.price, d) : '',
    cost: product.id ? fromMinor(product.cost, d) : '',
    track_stock: product.id ? !!product.track_stock : !restaurant,
    stock: '',
    min_stock: product.min_stock ?? 0,
    unit: product.unit || 'pcs',
    author: product.author || '',
    publisher: product.publisher || '',
    kitchen: product.id ? !!product.kitchen : restaurant,
    active: product.id ? !!product.active : true,
    track_expiry: !!product.track_expiry,
    track_serial: !!product.track_serial,
    supplier_id: product.supplier_id || '',
    units: (product.units || []).map((u) => ({ ...u, price: u.price == null ? '' : fromMinor(u.price, d) })),
    prices: Object.fromEntries(Object.entries(product.prices || {}).map(([k, v]) => [k, fromMinor(v, d)])),
  });
  const [priceLists] = useLoad(() => api.priceLists.list(), []);
  const [suppliers, setSuppliers] = useState(null);
  useEffect(() => { if (can('purchases')) api.suppliers.list({}).then(setSuppliers).catch(() => {}); }, [can]);
  const setUnit = (i, k, v) => setF((x) => ({ ...x, units: x.units.map((u, j) => (j === i ? { ...u, [k]: v } : u)) }));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  async function save(e) {
    e?.preventDefault();
    try {
      // Users who cannot see suppliers leave the product's supplier as it is.
      const { supplier_id: supplierId, ...rest } = f;
      await api.products.save({
        ...rest,
        id: product.id,
        category_id: Number(f.category_id) || null,
        ...(suppliers ? { supplier_id: Number(supplierId) || null } : {}),
        price: toMinor(f.price, d),
        cost: toMinor(f.cost, d),
        stock: Number(f.stock) || 0,
        min_stock: Number(f.min_stock) || 0,
        units: f.units.map((u) => ({ ...u, factor: Number(u.factor), price: u.price === '' ? null : toMinor(u.price, d) })),
        prices: Object.fromEntries((priceLists || []).map((pl) => [pl.id, f.prices[pl.id] === '' || f.prices[pl.id] == null ? '' : toMinor(f.prices[pl.id], d)])),
      });
      notify(t('common.saved'));
      onSaved();
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }

  async function remove() {
    if (!window.confirm(t('common.areYouSure'))) return;
    try { await api.products.remove(product.id); onSaved(); } catch (err) { notify(tErr(err), 'error'); }
  }

  return (
    <Modal
      title={isNew ? t('products.new') : product.name}
      onClose={onClose}
      width={760}
      footer={<>
        {!isNew && <button className="danger-ghost" onClick={remove}>{t('common.delete')}</button>}
        <span className="spacer" />
        <button onClick={onClose}>{t('common.cancel')}</button>
        <button className="primary" onClick={save}>{t('common.save')}</button>
      </>}
    >
      <form className="grid2" onSubmit={save}>
        <div className="span2"><Field label={t('common.name')}><input autoFocus required value={f.name} onChange={set('name')} /></Field></div>
        <Field label={bookstore ? t('products.isbn') : t('products.barcode')}><input className="mono" value={f.barcode} onChange={set('barcode')} /></Field>
        <Field label={t('products.category')}>
          <select value={f.category_id} onChange={set('category_id')}>
            <option value="">{t('products.noCategory')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label={t('products.price')}><input required inputMode="decimal" value={f.price} onChange={set('price')} /></Field>
        <Field label={t('products.cost')}><input inputMode="decimal" value={f.cost} onChange={set('cost')} /></Field>
        {suppliers && (
          <Field label={t('products.supplier')} hint={t('products.supplierHint')}>
            <select value={f.supplier_id} onChange={set('supplier_id')}>
              <option value="">—</option>
              {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        )}
        {bookstore && <>
          <Field label={t('products.author')}><input value={f.author} onChange={set('author')} /></Field>
          <Field label={t('products.publisher')}><input value={f.publisher} onChange={set('publisher')} /></Field>
        </>}
        <div className="span2 row wrap">
          <Toggle checked={f.track_stock} onChange={set('track_stock')} label={t('products.trackStock')} />
          {restaurant && <Toggle checked={f.kitchen} onChange={set('kitchen')} label={t('products.kitchen')} />}
          <Toggle checked={f.track_expiry} onChange={set('track_expiry')} label={t('products.trackExpiry')} />
          <Toggle checked={f.track_serial} onChange={set('track_serial')} label={t('products.trackSerial')} />
          <Toggle checked={f.active} onChange={set('active')} label={t('common.active')} />
        </div>
        {f.track_stock && <>
          {isNew
            ? <Field label={t('products.initialStock')}><input inputMode="decimal" value={f.stock} onChange={set('stock')} placeholder="0" /></Field>
            : <Field label={t('products.stock')}><input disabled value={formatQty(product.stock)} /></Field>}
          <Field label={t('products.minStock')}><input inputMode="decimal" value={f.min_stock} onChange={set('min_stock')} /></Field>
        </>}
        {!!priceLists?.length && (
          <div className="span2 sub-section">
            <h4>{t('priceLists.title')}</h4>
            <div className="grid3">
              {priceLists.filter((pl) => pl.active).map((pl) => (
                <Field key={pl.id} label={pl.name}>
                  <input inputMode="decimal" placeholder={f.price || '—'} value={f.prices[pl.id] ?? ''} onChange={(e) => setF((x) => ({ ...x, prices: { ...x.prices, [pl.id]: e.target.value } }))} />
                </Field>
              ))}
            </div>
            <small className="muted">{t('priceLists.emptyMeansBase')}</small>
          </div>
        )}
        <div className="span2 sub-section">
          <div className="row between"><h4>{t('units.title')}</h4>
            <button type="button" className="ghost sm" onClick={() => setF((x) => ({ ...x, units: [...x.units, { name: '', factor: '', barcode: '', price: '' }] }))}>+ {t('units.add')}</button></div>
          {f.units.map((u, i) => (
            <div key={i} className="unit-row">
              <input placeholder={t('units.name')} value={u.name} onChange={(e) => setUnit(i, 'name', e.target.value)} />
              <input inputMode="decimal" placeholder={t('units.factor')} value={u.factor} onChange={(e) => setUnit(i, 'factor', e.target.value)} />
              <input className="mono" placeholder={t('products.barcode')} value={u.barcode || ''} onChange={(e) => setUnit(i, 'barcode', e.target.value)} />
              <input inputMode="decimal" placeholder={u.factor && f.price ? (Number(f.price) * Number(u.factor)).toFixed(d) : t('pos.price')} value={u.price} onChange={(e) => setUnit(i, 'price', e.target.value)} />
              <button type="button" className="danger-ghost sm" onClick={() => setF((x) => ({ ...x, units: x.units.filter((_, j) => j !== i) }))}>✕</button>
            </div>
          ))}
          {!f.units.length && <small className="muted">{t('units.hint')}</small>}
        </div>
        <button hidden />
      </form>
    </Modal>
  );
}

function AdjustModal({ product, onClose, onSaved }) {
  const { t, tErr, notify } = useApp();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('purchase');
  async function save(e) {
    e?.preventDefault();
    try { await api.products.adjustStock({ productId: product.id, qty: Number(qty), reason }); notify(t('common.saved')); onSaved(); } catch (err) { notify(tErr(err), 'error'); }
  }
  return (
    <Modal title={`${t('products.adjust')} — ${product.name}`} onClose={onClose} width={440}
      footer={<><span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
      <form onSubmit={save}>
        <p>{t('products.stock')}: <b>{formatQty(product.stock)}</b></p>
        <div className="seg full">
          <button type="button" className={reason === 'purchase' ? 'on' : ''} onClick={() => setReason('purchase')}>{t('products.purchase')}</button>
          <button type="button" className={reason === 'adjust' ? 'on' : ''} onClick={() => setReason('adjust')}>{t('products.adjustment')}</button>
        </div>
        <Field label={t('products.adjustQty')}><input className="xl" autoFocus inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <p className="muted">→ {formatQty(product.stock + (Number(qty) || 0))}</p>
      </form>
    </Modal>
  );
}

function Categories({ categories, reload }) {
  const { t, tErr, notify } = useApp();
  const [editing, setEditing] = useState(null);
  async function save(e) {
    e.preventDefault();
    try { await api.categories.save(editing); setEditing(null); reload(); } catch (err) { notify(tErr(err), 'error'); }
  }
  async function remove(id) {
    if (!window.confirm(t('common.areYouSure'))) return;
    try { await api.categories.remove(id); reload(); } catch (err) { notify(tErr(err), 'error'); }
  }
  return (
    <div className="card">
      <div className="row between"><h3>{t('products.categories')}</h3><button className="primary" onClick={() => setEditing({ name: '', color: '#0a43c9', sort: categories.length })}>+ {t('products.newCategory')}</button></div>
      <div className="cat-list">
        {categories.map((c) => (
          <div key={c.id} className="cat-row">
            <span className="dot lg" style={{ background: c.color }} />
            <b>{c.name}</b>
            <span className="spacer" />
            <button className="ghost sm" onClick={() => setEditing(c)}>{t('common.edit')}</button>
            <button className="danger-ghost sm" onClick={() => remove(c.id)}>{t('common.delete')}</button>
          </div>
        ))}
        {!categories.length && <Empty>{t('common.none')}</Empty>}
      </div>
      {editing && (
        <Modal title={editing.id ? editing.name : t('products.newCategory')} onClose={() => setEditing(null)} width={420}
          footer={<><span className="spacer" /><button className="primary" onClick={save}>{t('common.save')}</button></>}>
          <form onSubmit={save} className="grid2">
            <Field label={t('common.name')}><input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label={t('products.color')}><input type="color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} /></Field>
            <button hidden />
          </form>
        </Modal>
      )}
    </div>
  );
}

function StockCounts({ categories }) {
  const { t, tErr, notify, settings } = useApp();
  const [list, reload] = useLoad(() => api.stockCounts.list(), []);
  const [openId, setOpenId] = useState(null);
  const [categoryId, setCategoryId] = useState('');
  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  const open = list?.find((c) => c.status === 'open');
  return (
    <>
      <div className="card">
        <div className="row between">
          <div><h3>{t('counts.title')}</h3><p className="muted small">{t('counts.hint')}</p></div>
          {open ? <button className="primary" onClick={() => setOpenId(open.id)}>{t('counts.continue')} #{open.id}</button> : (
            <div className="row">
              <select className="w-auto" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{t('counts.allProducts')}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="primary" onClick={() => run(async () => { const c = await api.stockCounts.start({ categoryId: Number(categoryId) || null }); reload(); setOpenId(c.id); })}>+ {t('counts.start')}</button>
            </div>
          )}
        </div>
      </div>
      <div className="card flush">
        <table className="grid">
          <thead><tr><th>#</th><th>{t('orders.date')}</th><th>{t('shift.by')}</th><th>{t('counts.progress')}</th><th>{t('orders.type')}</th></tr></thead>
          <tbody>{(list || []).map((c) => (
            <tr key={c.id} className="clickable" onClick={() => setOpenId(c.id)}>
              <td>{c.id}</td><td>{c.created_at}</td><td>{c.user_name}</td><td>{c.counted} / {c.items}</td><td>{t(`counts.status.${c.status}`)}</td>
            </tr>
          ))}</tbody>
        </table>
        {list && !list.length && <Empty>{t('common.none')}</Empty>}
      </div>
      {openId && <CountSheet id={openId} settings={settings} onClose={() => { setOpenId(null); reload(); }} />}
    </>
  );
}

function CountSheet({ id, onClose }) {
  const { t, tErr, notify, settings } = useApp();
  const [count, reload, setCount] = useLoad(() => api.stockCounts.get(id), [id]);
  const [scan, setScan] = useState('');
  const [filter, setFilter] = useState('');
  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  if (!count) return null;
  const editable = count.status === 'open';
  const onScan = (e) => {
    if (e.key !== 'Enter' || !scan.trim()) return;
    run(async () => {
      const item = await api.stockCounts.set({ id, barcode: scan.trim(), add: 1 });
      notify(`${item.name}: ${formatQty(item.counted)}`);
      setScan('');
      reload();
    });
  };
  const items = count.items.filter((i) => !filter || i.name.includes(filter) || (i.barcode || '').includes(filter));
  return (
    <Modal title={`${t('counts.title')} #${count.id} — ${t(`counts.status.${count.status}`)}`} onClose={onClose} width={900}
      footer={<>
        <span>{t('counts.progress')}: <b>{count.counted} / {count.items.length}</b>{count.difference_value != null && <> · {t('counts.value')}: <b className={count.difference_value < 0 ? 'warn' : 'good'}>{formatMoney(count.difference_value, settings)}</b></>}</span>
        <span className="spacer" />
        {editable && <button className="danger-ghost" onClick={() => run(async () => { if (window.confirm(t('common.areYouSure'))) { await api.stockCounts.cancel(id); onClose(); } })}>{t('counts.cancel')}</button>}
        {editable && <button className="primary" onClick={() => run(async () => { if (window.confirm(t('counts.applyConfirm'))) { setCount(await api.stockCounts.apply(id)); notify(t('counts.applied')); } })}>{t('counts.apply')}</button>}
      </>}>
      {editable && <input className="xl" autoFocus placeholder={`📷 ${t('counts.scan')}`} value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={onScan} />}
      <input placeholder={t('common.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="excel-preview top-gap">
        <table className="grid compact-inputs">
          <thead><tr><th>{t('common.name')}</th><th>{t('products.barcode')}</th><th className="num">{t('counts.expected')}</th><th>{t('counts.counted')}</th><th className="num">{t('shift.difference')}</th></tr></thead>
          <tbody>{items.map((i) => {
            const diff = i.counted == null ? null : i.counted - i.expected;
            return (
              <tr key={i.product_id}>
                <td>{i.name}</td><td className="mono small">{i.barcode}</td><td className="num">{formatQty(i.expected)}</td>
                <td>{editable ? <input inputMode="decimal" defaultValue={i.counted ?? ''} onBlur={(e) => run(async () => { await api.stockCounts.set({ id, productId: i.product_id, counted: e.target.value }); reload(); })} /> : formatQty(i.counted ?? '—')}</td>
                <td className={`num ${diff < 0 ? 'warn' : diff > 0 ? 'good' : ''}`}>{diff == null ? '' : (diff > 0 ? '+' : '') + formatQty(diff)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Modal>
  );
}

function Expiring() {
  const { t } = useApp();
  const [days, setDays] = useState(30);
  const [list] = useLoad(() => api.products.expiring({ days }), [days]);
  return (
    <div className="card flush">
      <div className="row between pad">
        <div><h3>{t('expiry.title')}</h3><p className="muted small">{t('expiry.hint')}</p></div>
        <select className="w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 60, 90, 180].map((d) => <option key={d} value={d}>{t('expiry.within', { d })}</option>)}
        </select>
      </div>
      <table className="grid">
        <thead><tr><th>{t('common.name')}</th><th>{t('expiry.batch')}</th><th>{t('expiry.date')}</th><th className="num">{t('products.stock')}</th><th>{t('expiry.status')}</th></tr></thead>
        <tbody>{(list || []).map((b) => (
          <tr key={b.id} className={b.days_left < 0 ? 'audit-hot' : ''}>
            <td><b>{b.name}</b></td><td className="mono">{b.batch_no || '—'}</td><td className="mono">{b.expiry_date}</td><td className="num">{formatQty(b.qty)}</td>
            <td className={b.days_left < 0 ? 'warn' : b.days_left <= 7 ? 'warn' : ''}>{b.days_left < 0 ? t('expiry.expired', { d: -b.days_left }) : t('expiry.left', { d: b.days_left })}</td>
          </tr>
        ))}</tbody>
      </table>
      {list && !list.length && <Empty>{t('expiry.none')}</Empty>}
    </div>
  );
}
