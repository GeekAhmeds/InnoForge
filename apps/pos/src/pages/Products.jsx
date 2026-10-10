import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty, fromMinor, toMinor } from '../lib/money.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from '../components/ui.jsx';

export default function Products() {
  const { t, settings } = useApp();
  const [tab, setTab] = useState('products');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [lowOnly, setLowOnly] = useState(false);
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
        </div>
        {tab === 'products' && (
          <div className="filters">
            <input placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={categoryId || ''} onChange={(e) => setCategoryId(Number(e.target.value) || null)}>
              <option value="">{t('common.all')}</option>
              {(categories || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Toggle checked={lowOnly} onChange={setLowOnly} label={t('products.lowStock')} />
            <button className="primary" onClick={() => setEditing({})}>+ {t('products.new')}</button>
          </div>
        )}
      </div>

      {tab === 'categories' ? (
        <Categories categories={categories || []} reload={reloadCategories} />
      ) : (
        <div className="card flush">
          <table className="grid">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{bookstore ? t('products.isbn') : t('products.barcode')}</th>
                <th>{t('products.category')}</th>
                <th className="num">{t('products.price')}</th>
                <th className="num">{t('products.cost')}</th>
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
                  <td className="num muted">{m(p.cost)}</td>
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
      {adjusting && <AdjustModal product={adjusting} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); reload(); }} />}
    </div>
  );
}

function ProductModal({ product, categories, onClose, onSaved }) {
  const { t, tErr, notify, settings } = useApp();
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
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  async function save(e) {
    e?.preventDefault();
    try {
      await api.products.save({
        ...f,
        id: product.id,
        category_id: Number(f.category_id) || null,
        price: toMinor(f.price, d),
        cost: toMinor(f.cost, d),
        stock: Number(f.stock) || 0,
        min_stock: Number(f.min_stock) || 0,
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
      width={640}
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
        {bookstore && <>
          <Field label={t('products.author')}><input value={f.author} onChange={set('author')} /></Field>
          <Field label={t('products.publisher')}><input value={f.publisher} onChange={set('publisher')} /></Field>
        </>}
        <div className="span2 row wrap">
          <Toggle checked={f.track_stock} onChange={set('track_stock')} label={t('products.trackStock')} />
          {restaurant && <Toggle checked={f.kitchen} onChange={set('kitchen')} label={t('products.kitchen')} />}
          <Toggle checked={f.active} onChange={set('active')} label={t('common.active')} />
        </div>
        {f.track_stock && <>
          {isNew
            ? <Field label={t('products.initialStock')}><input inputMode="decimal" value={f.stock} onChange={set('stock')} placeholder="0" /></Field>
            : <Field label={t('products.stock')}><input disabled value={formatQty(product.stock)} /></Field>}
          <Field label={t('products.minStock')}><input inputMode="decimal" value={f.min_stock} onChange={set('min_stock')} /></Field>
        </>}
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
      <div className="row between"><h3>{t('products.categories')}</h3><button className="primary" onClick={() => setEditing({ name: '', color: '#4f46e5', sort: categories.length })}>+ {t('products.newCategory')}</button></div>
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
