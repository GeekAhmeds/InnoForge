import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty } from '../lib/money.js';
import { today } from '../pages/Orders.jsx';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from './ui.jsx';

/** Warehouse picker; renders nothing while the shop has a single warehouse. */
export function WarehouseSelect({ value, onChange, label = true }) {
  const { t } = useApp();
  const [list] = useLoad(() => api.warehouses.list({ includeInactive: false }), []);
  useEffect(() => {
    if (list && !value) onChange(String(list.find((w) => w.is_sale)?.id || 1));
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list || list.length < 2) return null;
  const select = (
    <select className="w-auto" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {list.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
  );
  return label ? <Field label={t('wh.warehouse')}>{select}</Field> : select;
}

/** Products → Warehouses: the warehouses, stock in each, and transfers between them. */
export function WarehousesTab() {
  const { t, tErr, notify, settings, can, reloadSettings } = useApp();
  const [list, reload] = useLoad(() => api.warehouses.list(), []);
  const [search, setSearch] = useState('');
  const [stock, reloadStock] = useLoad(() => api.warehouses.stock({ search }), [search]);
  const [transfers, reloadTransfers] = useLoad(() => api.warehouses.transfers({ from: today().slice(0, 8) + '01', to: today() }), []);
  const [edit, setEdit] = useState(null);
  const [moving, setMoving] = useState(null);
  const [viewing, setViewing] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const run = async (fn) => { try { await fn(); } catch (err) { notify(tErr(err), 'error'); } };
  const active = (list || []).filter((w) => w.active);
  const saleId = (list || []).find((w) => w.is_sale)?.id;
  const reloadAll = () => { reload(); reloadStock(); reloadTransfers(); };

  const save = () => run(async () => { await api.warehouses.save(edit); setEdit(null); reloadAll(); });
  const setSale = (id) => run(async () => {
    await api.settings.save({ sale_warehouse_id: id });
    await reloadSettings();
    reload();
    notify(t('wh.saleSet'));
  });

  return (
    <>
      <div className="card">
        <div className="row between">
          <div><h3>🏬 {t('wh.title')}</h3><p className="muted small">{t('wh.hint')}</p></div>
          <div className="row">
            {active.length > 1 && can('products') && <button onClick={() => setMoving({ fromId: String(active.find((w) => w.id !== saleId)?.id || active[0].id), toId: String(saleId || 1), items: [], notes: '' })}>🔁 {t('wh.transfer')}</button>}
            {can('products') && <button className="primary" onClick={() => setEdit({ name: '', active: true })}>+ {t('wh.new')}</button>}
          </div>
        </div>
        <div className="wh-cards">
          {(list || []).map((w) => (
            <div key={w.id} className={`wh-card ${w.active ? '' : 'dim'} ${w.is_sale ? 'on' : ''}`}>
              <b>{w.name}</b>
              <small className="muted">{t('wh.items', { n: w.items })}{w.value != null ? ` · ${m(w.value)}` : ''}</small>
              {w.is_sale ? <span className="badge">🖥 {t('wh.sellingHere')}</span>
                : w.active && can('settings') && <button className="ghost sm" onClick={() => setSale(w.id)}>{t('wh.sellFromHere')}</button>}
              {can('products') && <button className="ghost sm" onClick={() => setEdit({ ...w, active: !!w.active })}>{t('common.edit')}</button>}
            </div>
          ))}
        </div>
      </div>

      {(list || []).length > 1 && (
        <div className="card flush top-gap">
          <div className="row between pad">
            <h3>📦 {t('wh.stock')}</h3>
            <input className="w-auto" placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <table className="grid compact">
            <thead><tr><th>{t('common.name')}</th>{(list || []).map((w) => <th key={w.id} className="num">{w.name}</th>)}<th className="num">{t('common.total')}</th></tr></thead>
            <tbody>{(stock || []).map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                {(list || []).map((w) => { const q = p.by[w.id] || 0; return <td key={w.id} className={`num ${q < 0 ? 'warn' : q ? '' : 'muted'}`}>{q ? formatQty(q) : '—'}</td>; })}
                <td className="num"><b>{formatQty(p.stock)}</b></td>
              </tr>
            ))}</tbody>
          </table>
          {stock && !stock.length && <Empty>{t('common.none')}</Empty>}
        </div>
      )}

      {!!transfers?.length && (
        <div className="card flush top-gap">
          <h3 className="pad">🔁 {t('wh.transfersMonth')}</h3>
          <table className="grid">
            <thead><tr><th>#</th><th>{t('common.date')}</th><th>{t('wh.from')}</th><th>{t('wh.to')}</th><th className="num">{t('wh.lines')}</th><th>{t('common.user')}</th></tr></thead>
            <tbody>{transfers.map((x) => (
              <tr key={x.id} className="clickable" onClick={() => run(async () => setViewing(await api.warehouses.getTransfer(x.id)))}>
                <td>{x.id}</td><td>{x.created_at.slice(0, 16)}</td><td>{x.from_name}</td><td>{x.to_name}</td><td className="num">{x.items}</td><td>{x.user_name}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {edit && (
        <Modal title={edit.id ? edit.name : t('wh.new')} onClose={() => setEdit(null)} width={420}
          footer={<><span className="spacer" /><button className="primary" onClick={save}>{t('common.save')}</button></>}>
          <Field label={t('common.name')}><input autoFocus value={edit.name} placeholder={t('wh.namePh')} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          {edit.id && edit.id !== 1 && <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label={t('common.active')} />}
        </Modal>
      )}
      {moving && <TransferModal warehouses={active} initial={moving} onClose={() => setMoving(null)} onDone={(x) => { setMoving(null); reloadAll(); setViewing(x); notify(t('wh.transferred')); }} />}
      {viewing && (
        <Modal title={`🔁 ${t('wh.transfer')} #${viewing.id}`} onClose={() => setViewing(null)} width={520}>
          <p>{t('wh.fromTo', { a: viewing.from_name, b: viewing.to_name })} · <span className="muted">{viewing.created_at} · {viewing.user_name}</span></p>
          <table className="grid compact"><tbody>{viewing.items.map((i) => <tr key={i.id}><td>{i.name}</td><td className="num"><b>{formatQty(i.qty)}</b> {i.unit && i.unit !== 'pcs' ? i.unit : ''}</td></tr>)}</tbody></table>
          {viewing.notes && <p className="muted">{viewing.notes}</p>}
        </Modal>
      )}
    </>
  );
}

function TransferModal({ warehouses, initial, onClose, onDone }) {
  const { t, tErr, notify } = useApp();
  const [f, setF] = useState(initial);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q.trim()) { setFound([]); return undefined; }
    const h = setTimeout(() => api.warehouses.stock({ search: q, warehouseId: Number(f.fromId) }).then((r) => setFound(r.slice(0, 8))).catch(() => {}), 120);
    return () => clearTimeout(h);
  }, [q, f.fromId]);
  const add = (p) => { setF((x) => (x.items.some((i) => i.product_id === p.id) ? x : { ...x, items: [...x.items, { product_id: p.id, name: p.name, have: p.by[f.fromId] || 0, qty: '' }] })); setQ(''); };
  const save = async () => {
    setBusy(true);
    try {
      const x = await api.warehouses.transfer({ fromId: Number(f.fromId), toId: Number(f.toId), notes: f.notes, items: f.items.map((i) => ({ product_id: i.product_id, qty: Number(i.qty) })) });
      onDone(x);
    } catch (err) { notify(tErr(err), 'error'); } finally { setBusy(false); }
  };
  const sel = (k) => (
    <select value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value, ...(k === 'fromId' ? { items: [] } : {}) })}>
      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
  );
  return (
    <Modal title={`🔁 ${t('wh.transfer')}`} onClose={onClose} width={640}
      footer={<><span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" disabled={busy || f.fromId === f.toId || !f.items.some((i) => Number(i.qty) > 0)} onClick={save}>{t('wh.doTransfer')}</button></>}>
      <div className="grid2"><Field label={t('wh.from')}>{sel('fromId')}</Field><Field label={t('wh.to')}>{sel('toId')}</Field></div>
      {f.fromId === f.toId && <p className="warn">{t('err.INVALID_WAREHOUSE')}</p>}
      <Field label={t('wh.addProduct')}>
        <input autoFocus value={q} placeholder={t('wh.searchPh')} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) add(found[0]); }} />
      </Field>
      {!!found.length && <div className="cat-list">{found.map((p) => <button key={p.id} className="cat-row" onClick={() => add(p)}><span className="spacer">{p.name}</span><span className="muted">{formatQty(p.by[f.fromId] || 0)}</span></button>)}</div>}
      <table className="grid compact top-gap">
        <thead><tr><th>{t('common.name')}</th><th className="num">{t('wh.available')}</th><th>{t('pos.qty')}</th><th /></tr></thead>
        <tbody>{f.items.map((i, k) => (
          <tr key={i.product_id}>
            <td>{i.name}</td><td className="num muted">{formatQty(i.have)}</td>
            <td><input className="qty-input" inputMode="decimal" value={i.qty} onChange={(e) => setF({ ...f, items: f.items.map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)) })} /></td>
            <td><button className="danger-ghost sm" onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== k) })}>✕</button></td>
          </tr>
        ))}</tbody>
      </table>
      {!f.items.length && <Empty>{t('wh.noLines')}</Empty>}
      <Field label={t('common.notes')}><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </Modal>
  );
}
