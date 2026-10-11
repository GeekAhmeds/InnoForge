import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney, formatQty, fromMinor, toMinor } from '../lib/money.js';
import { Empty, Field, Modal, Toggle, useApp, useLoad } from './ui.jsx';

/** Products → Modifiers: groups like "Size" (choose 1) or "Extras" (any), with prices and ingredients. */
export function ModifierGroups() {
  const { t, settings } = useApp();
  const [list, reload] = useLoad(() => api.modifiers.list(), []);
  const [editing, setEditing] = useState(null);
  const m = (v) => formatMoney(v, settings);
  const rule = (g) => (g.min_select >= 1 && g.max_select === 1 ? t('mods.chooseOne') : g.min_select >= 1 ? t('mods.atLeast', { n: g.min_select }) : g.max_select ? t('mods.upTo', { n: g.max_select }) : t('mods.optional'));
  return (
    <div className="card">
      <div className="row between">
        <h3>🧩 {t('mods.title')}</h3>
        <button className="primary" onClick={() => setEditing({ name: '', min_select: 0, max_select: 0, active: true, options: [{ name: '', price: '' }] })}>+ {t('mods.new')}</button>
      </div>
      <p className="muted small">{t('mods.hint')}</p>
      <div className="cat-list">
        {(list || []).filter((g) => g.active).map((g) => (
          <div key={g.id} className="cat-row">
            <div className="spacer">
              <b>{g.name}</b> <small className="badge">{rule(g)}</small>
              <div className="muted small">{g.options.filter((o) => o.active).map((o) => `${o.name}${o.price ? ` (+${m(o.price)})` : ''}`).join(' · ')}</div>
            </div>
            <button className="ghost sm" onClick={() => setEditing({ ...g, options: g.options.filter((o) => o.active).map((o) => ({ ...o, price: o.price ? fromMinor(o.price, settings.decimals) : '' })) })}>{t('common.edit')}</button>
          </div>
        ))}
        {list && !list.filter((g) => g.active).length && <Empty>{t('mods.none')}</Empty>}
      </div>
      {editing && <GroupModal group={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function GroupModal({ group, onClose, onSaved }) {
  const { t, tErr, notify, settings } = useApp();
  const [f, setF] = useState(group);
  const [ingredients] = useLoad(() => api.products.list({}), []);
  const kind = f.min_select >= 1 && Number(f.max_select) === 1 ? 'one' : 'many';
  const setOpt = (i, k, v) => setF((x) => ({ ...x, options: x.options.map((o, j) => (j === i ? { ...o, [k]: v } : o)) }));
  async function save() {
    try {
      await api.modifiers.save({ ...f, options: f.options.map((o) => ({ ...o, price: toMinor(o.price, settings.decimals), ingredient_qty: Number(o.ingredient_qty) || 0 })) });
      onSaved();
    } catch (err) { notify(tErr(err), 'error'); }
  }
  async function remove() {
    if (!window.confirm(t('common.areYouSure'))) return;
    try { await api.modifiers.remove(f.id); onSaved(); } catch (err) { notify(tErr(err), 'error'); }
  }
  return (
    <Modal title={f.id ? f.name : t('mods.new')} onClose={onClose} width={760}
      footer={<>{f.id && <button className="danger-ghost" onClick={remove}>{t('common.delete')}</button>}<span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button><button className="primary" onClick={save}>{t('common.save')}</button></>}>
      <div className="grid2">
        <Field label={t('common.name')}><input autoFocus value={f.name} placeholder={t('mods.namePh')} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('mods.rule')}>
          <div className="seg full">
            <button type="button" className={kind === 'one' ? 'on' : ''} onClick={() => setF({ ...f, min_select: 1, max_select: 1 })}>{t('mods.chooseOne')}</button>
            <button type="button" className={kind === 'many' ? 'on' : ''} onClick={() => setF({ ...f, min_select: 0, max_select: 0 })}>{t('mods.optional')}</button>
          </div>
        </Field>
      </div>
      <table className="grid compact-inputs top-gap">
        <thead><tr><th>{t('mods.option')}</th><th>{t('mods.extraPrice')}</th><th>{t('mods.ingredient')}</th><th>{t('mods.ingredientQty')}</th><th /></tr></thead>
        <tbody>{f.options.map((o, i) => (
          <tr key={o.id || `n${i}`}>
            <td><input value={o.name} placeholder={i === 0 ? t('mods.optionPh') : ''} onChange={(e) => setOpt(i, 'name', e.target.value)} /></td>
            <td><input className="w-amount" inputMode="decimal" placeholder="0" value={o.price} onChange={(e) => setOpt(i, 'price', e.target.value)} /></td>
            <td>
              <select value={o.ingredient_id || ''} onChange={(e) => setOpt(i, 'ingredient_id', Number(e.target.value) || null)}>
                <option value="">—</option>
                {(ingredients || []).filter((p) => p.track_stock).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </td>
            <td><input className="w-pct" inputMode="decimal" disabled={!o.ingredient_id} value={o.ingredient_qty || ''} onChange={(e) => setOpt(i, 'ingredient_qty', e.target.value)} /></td>
            <td><button className="danger-ghost sm" onClick={() => setF({ ...f, options: f.options.filter((_, j) => j !== i) })}>✕</button></td>
          </tr>
        ))}</tbody>
      </table>
      <button type="button" className="ghost" onClick={() => setF({ ...f, options: [...f.options, { name: '', price: '' }] })}>+ {t('mods.addOption')}</button>
      <p className="muted small">{t('mods.ingredientHint')}</p>
    </Modal>
  );
}

/** Product form section: which modifier groups apply, the recipe, and "raw material". */
export function ProductKitchenFields({ productId, f, setF }) {
  const { t, settings, can } = useApp();
  const [groups] = useLoad(() => api.modifiers.list(), []);
  const [all] = useLoad(() => api.products.list({}), []);
  const [loaded, setLoaded] = useState(!productId);
  useEffect(() => {
    if (!productId) return;
    api.products.get(productId).then((p) => {
      setF((x) => ({ ...x, modifier_group_ids: p.modifier_group_ids, recipe: p.recipe.map((r) => ({ ingredient_id: r.ingredient_id, qty: String(r.qty) })) }));
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!loaded) return null;
  const ingredients = (all || []).filter((p) => p.id !== productId && p.track_stock);
  const cost = (f.recipe || []).reduce((sum, r) => sum + Math.round((ingredients.find((p) => p.id === Number(r.ingredient_id))?.cost || 0) * (Number(r.qty) || 0)), 0);
  const setRow = (i, k, v) => setF((x) => ({ ...x, recipe: x.recipe.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  return (
    <>
      <div className="span2 sub-section">
        <Toggle checked={f.is_ingredient} onChange={(v) => setF((x) => ({ ...x, is_ingredient: v }))} label={`🥕 ${t('recipes.isIngredient')}`} />
      </div>
      {!f.is_ingredient && !!groups?.filter((g) => g.active).length && (
        <div className="span2 sub-section">
          <h4>🧩 {t('mods.title')}</h4>
          <div className="row wrap">
            {groups.filter((g) => g.active).map((g) => (
              <Toggle key={g.id} checked={(f.modifier_group_ids || []).includes(g.id)} label={g.name}
                onChange={(on) => setF((x) => ({ ...x, modifier_group_ids: on ? [...(x.modifier_group_ids || []), g.id] : (x.modifier_group_ids || []).filter((id) => id !== g.id) }))} />
            ))}
          </div>
        </div>
      )}
      {!f.is_ingredient && (
        <div className="span2 sub-section">
          <div className="row between">
            <h4>🍳 {t('recipes.title')}</h4>
            <button type="button" className="ghost sm" onClick={() => setF((x) => ({ ...x, recipe: [...(x.recipe || []), { ingredient_id: '', qty: '' }] }))}>+ {t('recipes.add')}</button>
          </div>
          {(f.recipe || []).map((r, i) => {
            const ing = ingredients.find((p) => p.id === Number(r.ingredient_id));
            return (
              <div key={i} className="unit-row">
                <select value={r.ingredient_id} onChange={(e) => setRow(i, 'ingredient_id', e.target.value)}>
                  <option value="">{t('recipes.pick')}</option>
                  {ingredients.map((p) => <option key={p.id} value={p.id}>{p.name}{p.unit && p.unit !== 'pcs' ? ` (${p.unit})` : ''}</option>)}
                </select>
                <input inputMode="decimal" placeholder={t('pos.qty')} value={r.qty} onChange={(e) => setRow(i, 'qty', e.target.value)} />
                <span className="muted small">{ing ? `${t('products.stock')}: ${formatQty(ing.stock)}` : ''}</span>
                <button type="button" className="danger-ghost sm" onClick={() => setF((x) => ({ ...x, recipe: x.recipe.filter((_, j) => j !== i) }))}>✕</button>
              </div>
            );
          })}
          {!f.recipe?.length ? <small className="muted">{t('recipes.hint')}</small>
            : can('view_cost') && <p className="muted">{t('recipes.cost')}: <b>{formatMoney(cost, settings)}</b>{f.price ? ` · ${t('recipes.margin')}: ${Math.round(((toMinor(f.price, settings.decimals) - cost) / Math.max(1, toMinor(f.price, settings.decimals))) * 100)}%` : ''}</p>}
        </div>
      )}
    </>
  );
}

/** Choosing size / extras when a product with modifiers is tapped on the sales screen. */
export function ModifierPicker({ product, onClose, onPick }) {
  const { t, settings } = useApp();
  const [groups] = useLoad(() => api.modifiers.forProduct(product.id), [product.id]);
  const [chosen, setChosen] = useState({});
  useEffect(() => {
    if (!groups) return;
    // Pre-select the first option of "choose one" groups.
    setChosen(Object.fromEntries(groups.filter((g) => g.min_select >= 1 && g.max_select === 1 && g.options[0]).map((g) => [g.id, [g.options[0].id]])));
  }, [groups]);
  if (!groups) return null;
  const m = (v) => formatMoney(v, settings);
  const toggle = (g, o) => setChosen((c) => {
    const cur = c[g.id] || [];
    if (g.max_select === 1) return { ...c, [g.id]: [o.id] };
    if (cur.includes(o.id)) return { ...c, [g.id]: cur.filter((x) => x !== o.id) };
    if (g.max_select > 0 && cur.length >= g.max_select) return c;
    return { ...c, [g.id]: [...cur, o.id] };
  });
  const options = groups.flatMap((g) => g.options.filter((o) => (chosen[g.id] || []).includes(o.id)));
  const extra = options.reduce((sum, o) => sum + o.price, 0);
  const ok = groups.every((g) => (chosen[g.id] || []).length >= g.min_select);
  return (
    <Modal title={product.name} onClose={onClose} width={620}
      footer={<><span>{t('pos.total')}: <b>{m(product.price + extra)}</b></span><span className="spacer" /><button onClick={onClose}>{t('common.cancel')}</button>
        <button className="primary lg" disabled={!ok} onClick={() => onPick(options.map((o) => ({ id: o.id, name: o.name, price: o.price })), product.price + extra)}>{t('mods.addToOrder')}</button></>}>
      {groups.map((g) => (
        <div key={g.id} className="mod-group">
          <h4>{g.name} {g.min_select >= 1 && <small className="badge credit">{t('mods.required')}</small>}</h4>
          <div className="mod-options">
            {g.options.map((o) => (
              <button key={o.id} type="button" className={(chosen[g.id] || []).includes(o.id) ? 'on' : ''} onClick={() => toggle(g, o)}>
                <span>{o.name}</span>{o.price ? <small>+{m(o.price)}</small> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}
