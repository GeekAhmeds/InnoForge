import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty, fromMinor, toMinor } from '../lib/money.js';
import { Empty, Modal, useApp } from './ui.jsx';

// Ready-made value lists for common attributes (the owner can type anything).
const PRESETS = {
  size: ['S', 'M', 'L', 'XL', 'XXL'],
  shoes: ['38', '39', '40', '41', '42', '43', '44'],
};

const splitValues = (text) => [...new Set(String(text || '').split(/[,،\n]/).map((v) => v.trim()).filter(Boolean))];
const keyOf = (values) => JSON.stringify(values);

/** Every combination of the attributes' values: [{ attr: value, … }]. */
export function combinations(attributes) {
  const attrs = attributes.filter((a) => a.name.trim() && splitValues(a.values).length);
  if (!attrs.length) return [];
  return attrs.reduce((acc, a) => acc.flatMap((c) => splitValues(a.values).map((v) => ({ ...c, [a.name.trim()]: v }))), [{}]);
}

/**
 * The product editor's variants section. State lives in the modal (`value` / `onChange`) so the
 * modal saves the product and its variants together: { attributes: [{ name, values }], rows: { key: {…} }, autoBarcode }.
 */
export function useVariantState(product, decimals) {
  const [state, setState] = useState({ attributes: [], rows: {}, autoBarcode: true, loaded: !product?.is_parent, touched: false });
  useEffect(() => {
    if (!product?.is_parent) return;
    api.products.variants(product.id).then((r) => setState({
      attributes: r.attributes.map((a) => ({ name: a.name, values: a.values.join('، ') })),
      rows: Object.fromEntries(r.variants.map((v) => [keyOf(v.variant), { id: v.id, barcode: v.barcode || '', price: v.own_price ? fromMinor(v.price, decimals) : '', stock: v.stock, track: !!v.track_stock, active: !!v.active, existing: true }])),
      autoBarcode: true,
      loaded: true,
      touched: false,
    })).catch(() => setState((s) => ({ ...s, loaded: true })));
  }, [product?.id, product?.is_parent]);
  return [state, (patch) => setState((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch), touched: true }))];
}

/** Sends the variants (after the product itself was saved as `parentId`). */
export async function saveVariants(parentId, state, decimals) {
  if (!state.touched) return;
  const combos = combinations(state.attributes);
  const variants = combos.map((values) => {
    const r = state.rows[keyOf(values)] || {};
    return { id: r.id, values, barcode: r.barcode || '', price: r.price == null || r.price === '' ? '' : toMinor(r.price, decimals), stock: Number(r.stock) || 0, active: r.active !== false };
  }).filter((v, i) => state.rows[keyOf(combos[i])]?.include !== false);
  const attributes = state.attributes.filter((a) => a.name.trim() && splitValues(a.values).length).map((a) => ({ name: a.name.trim(), values: splitValues(a.values) }));
  const r = await api.products.saveVariants({ parentId, attributes, variants });
  if (state.autoBarcode) {
    const ids = r.variants.filter((v) => !v.barcode).map((v) => v.id);
    if (ids.length) await api.products.generateBarcodes({ ids });
  }
}

export function VariantEditor({ product, state, setState, basePrice }) {
  const { t } = useApp();
  const combos = useMemo(() => combinations(state.attributes), [state.attributes]);
  const setAttr = (i, k, v) => setState((s) => ({ attributes: s.attributes.map((a, j) => (j === i ? { ...a, [k]: v } : a)) }));
  const setRow = (key, patch) => setState((s) => ({ rows: { ...s.rows, [key]: { ...s.rows[key], ...patch } } }));
  if (!state.loaded) return null;
  const isParent = !!state.attributes.length;
  return (
    <div className="span2 sub-section variants">
      <div className="row between">
        <h4>👕 {t('variants.title')}</h4>
        {state.attributes.length < 3 && (
          <div className="row">
            <button type="button" className="ghost sm" onClick={() => setState((s) => ({ attributes: [...s.attributes, { name: t('variants.size'), values: PRESETS.size.join('، ') }] }))}>+ {t('variants.size')}</button>
            <button type="button" className="ghost sm" onClick={() => setState((s) => ({ attributes: [...s.attributes, { name: t('variants.color'), values: '' }] }))}>+ {t('variants.color')}</button>
            <button type="button" className="ghost sm" onClick={() => setState((s) => ({ attributes: [...s.attributes, { name: '', values: '' }] }))}>+ {t('variants.other')}</button>
          </div>
        )}
      </div>
      {!isParent && <small className="muted">{t('variants.hint')}</small>}
      {state.attributes.map((a, i) => (
        <div key={i} className="variant-attr">
          <input placeholder={t('variants.attrName')} value={a.name} onChange={(e) => setAttr(i, 'name', e.target.value)} />
          <input placeholder={t('variants.values')} value={a.values} onChange={(e) => setAttr(i, 'values', e.target.value)} />
          {a.name === t('variants.size') && <button type="button" className="ghost sm" title={t('variants.shoeSizes')} onClick={() => setAttr(i, 'values', PRESETS.shoes.join('، '))}>👟</button>}
          <button type="button" className="danger-ghost sm" onClick={() => setState((s) => ({ attributes: s.attributes.filter((_, j) => j !== i) }))}>✕</button>
        </div>
      ))}
      {!!combos.length && (
        <>
          <small className="muted">{t('variants.count', { n: combos.length })} — {t('variants.priceHint')}</small>
          <div className="excel-preview">
            <table className="grid compact-inputs">
              <thead><tr><th /><th>{t('variants.variant')}</th><th>{t('products.barcode')}</th><th>{t('pos.price')}</th><th>{t('products.stock')}</th></tr></thead>
              <tbody>
                {combos.map((values) => {
                  const key = keyOf(values);
                  const r = state.rows[key] || {};
                  const on = r.include !== false && r.active !== false;
                  return (
                    <tr key={key} className={on ? '' : 'dim'}>
                      <td><input type="checkbox" checked={on} onChange={(e) => setRow(key, r.existing ? { active: e.target.checked } : { include: e.target.checked })} /></td>
                      <td>{Object.values(values).join(' / ')}</td>
                      <td><input className="mono" placeholder={state.autoBarcode ? t('variants.autoBarcode') : ''} value={r.barcode || ''} onChange={(e) => setRow(key, { barcode: e.target.value })} /></td>
                      <td><input inputMode="decimal" placeholder={basePrice || '—'} value={r.price ?? ''} onChange={(e) => setRow(key, { price: e.target.value })} /></td>
                      <td>{r.existing ? <span className="muted">{r.track ? formatQty(r.stock) : '∞'}</span>
                        : <input inputMode="decimal" placeholder="0" value={r.stock ?? ''} onChange={(e) => setRow(key, { stock: e.target.value })} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="toggle"><input type="checkbox" checked={state.autoBarcode} onChange={(e) => setState({ autoBarcode: e.target.checked })} /><span>{t('variants.autoBarcodeLong')}</span></label>
        </>
      )}
      {product?.id && product.track_stock && !product.is_parent && product.stock ? <small className="warn-text">{t('err.VARIANT_PARENT_STOCK')}</small> : null}
    </div>
  );
}

/** The cashier taps a model (e.g. a T-shirt): pick the colour / size. Two attributes show as a grid. */
export function VariantPicker({ product, onPick, onClose }) {
  const { t, settings } = useApp();
  const [data, setData] = useState(null);
  useEffect(() => { api.products.variants(product.id).then(setData).catch(() => setData({ attributes: [], variants: [] })); }, [product.id]);
  const m = (v) => formatMoney(v, settings);
  const variants = (data?.variants || []).filter((v) => v.active);
  const find = (values) => variants.find((v) => Object.entries(values).every(([k, x]) => v.variant[k] === x));
  const cell = (v, grid = false) => (v ? (
    <button type="button" className={`variant-cell ${v.track_stock && v.stock <= 0 ? 'out' : ''}`} onClick={() => onPick(v)}>
      {!grid && <b>{v.variant_label}</b>}
      <span className={grid ? 'strong' : ''}>{m(v.price)}</span>
      {v.track_stock ? <small>{v.stock > 0 ? formatQty(v.stock) : t('pos.outOfStock')}</small> : null}
    </button>
  ) : <span className="variant-cell none">—</span>);
  const attrs = data?.attributes || [];
  return (
    <Modal title={`👕 ${product.name}`} onClose={onClose} width={720}>
      {!data ? null : !variants.length ? <Empty>{t('common.none')}</Empty> : attrs.length === 2 ? (
        <table className="variant-grid">
          <thead><tr><th>{attrs[0].name} \ {attrs[1].name}</th>{attrs[1].values.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{attrs[0].values.map((r) => (
            <tr key={r}><th>{r}</th>{attrs[1].values.map((c) => <td key={c}>{cell(find({ [attrs[0].name]: r, [attrs[1].name]: c }), true)}</td>)}</tr>
          ))}</tbody>
        </table>
      ) : (
        <div className="variant-list">{variants.map((v) => <React.Fragment key={v.id}>{cell(v)}</React.Fragment>)}</div>
      )}
    </Modal>
  );
}
