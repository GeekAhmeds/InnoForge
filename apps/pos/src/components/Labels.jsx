import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';
import { DEFAULT_LABEL, LABEL_PARTS, LABEL_SIZES, labelLayout, labelSetting, labelSize, labelsHtml, sizeName } from '../lib/labels.js';
import { Field, Modal, Toggle, useApp } from './ui.jsx';

const PX_PER_MM = 96 / 25.4;
const ZOOM = 2.6;

/** The design panel: what the sticker shows, sizes, and a live preview of one sticker. */
function LabelDesigner({ size, setSize, layout, setLayout, sample, onSave }) {
  const { t, settings, can } = useApp();
  const set = (patch) => setLayout((l) => labelLayout({ label_layout: JSON.stringify({ ...l, ...patch }) }));
  const [w, h] = labelSize(size, layout);
  const html = labelsHtml([sample], { size, layout, settings, preview: true }).replace('</style>', `body { zoom: ${ZOOM}; }</style>`);
  return (
    <div className="label-designer">
      <div>
        <div className="grid2">
          <Field label={t('labels.size')}>
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              {Object.keys(LABEL_SIZES).map((k) => <option key={k} value={k}>{sizeName(k, t)}</option>)}
            </select>
          </Field>
          {size === 'custom' ? (
            <div className="row">
              <Field label={t('labels.width')}><input type="number" min="20" max="120" key={layout.customW} defaultValue={layout.customW} onBlur={(e) => set({ customW: e.target.value })} /></Field>
              <Field label={t('labels.height')}><input type="number" min="10" max="100" key={layout.customH} defaultValue={layout.customH} onBlur={(e) => set({ customH: e.target.value })} /></Field>
            </div>
          ) : <span />}
        </div>
        <div className="row wrap">
          {LABEL_PARTS.map((k) => <Toggle key={k} checked={layout.show[k]} onChange={(v) => set({ show: { ...layout.show, [k]: v } })} label={t(`labels.part.${k}`)} />)}
        </div>
        {layout.show.custom && <Field label={t('labels.customText')}><input value={layout.customText} placeholder={t('labels.customHint')} onChange={(e) => set({ customText: e.target.value })} /></Field>}
        <div className="grid3">
          <Field label={`${t('labels.nameSize')} (${layout.nameSize})`}><input type="range" min="5" max="16" step="0.5" value={layout.nameSize} onChange={(e) => set({ nameSize: Number(e.target.value) })} /></Field>
          <Field label={`${t('labels.priceSize')} (${layout.priceSize})`}><input type="range" min="6" max="22" step="0.5" value={layout.priceSize} onChange={(e) => set({ priceSize: Number(e.target.value) })} /></Field>
          <Field label={`${t('labels.bars')} (${layout.bars}%)`}><input type="range" min="20" max="75" value={layout.bars} onChange={(e) => set({ bars: Number(e.target.value) })} /></Field>
        </div>
        <div className="row wrap">
          <Toggle checked={layout.currency} onChange={(v) => set({ currency: v })} label={t('labels.currency')} />
          <Toggle checked={layout.rotate} onChange={(v) => set({ rotate: v })} label={t('labels.rotate')} />
          <Toggle checked={layout.border} onChange={(v) => set({ border: v })} label={t('labels.border')} />
        </div>
        <div className="row">
          {can('settings') && <button type="button" onClick={onSave}>💾 {t('labels.saveDesign')}</button>}
          <button type="button" className="ghost" onClick={() => setLayout(labelLayout({ label_layout: JSON.stringify({ ...DEFAULT_LABEL, customW: layout.customW, customH: layout.customH }) }))}>↺ {t('rdesign.reset')}</button>
        </div>
      </div>
      <div className="label-preview-box">
        <small className="muted">{t('rdesign.preview')} — {w} × {h} mm</small>
        <iframe title={t('rdesign.preview')} srcDoc={html} sandbox="" style={{ width: Math.ceil(w * PX_PER_MM * ZOOM) + 4, height: Math.ceil(h * PX_PER_MM * ZOOM) + 4 }} />
      </div>
    </div>
  );
}

/** Choose products and copies, then print barcode stickers. */
export default function LabelsModal({ onClose, onChanged }) {
  const { t, tErr, notify, settings, printDoc, can, reloadSettings } = useApp();
  const [copies, setCopies] = useState({});
  const [filter, setFilter] = useState('');
  const [size, setSize] = useState(LABEL_SIZES[settings.label_size] !== undefined ? settings.label_size : '38x25');
  const [layout, setLayout] = useState(() => labelLayout(settings));
  const [designing, setDesigning] = useState(false);
  // Every sellable row, variants included (each size / colour has its own barcode).
  const [products, setProducts] = useState([]);
  const [version, setVersion] = useState(0);
  useEffect(() => { api.products.list({}).then(setProducts).catch((err) => notify(tErr(err), 'error')); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  // Units with their own barcode (e.g. a carton) get their own label rows.
  // A variant's sticker shows the model name, with its size / colour on its own line.
  const modelName = (p) => (p.variant_label && p.name.endsWith(` — ${p.variant_label}`) ? p.name.slice(0, -(p.variant_label.length + 3)) : p.name);
  const rows = useMemo(() => products.flatMap((p) => [
    { key: `p${p.id}`, id: p.id, name: p.name, label: modelName(p), attrs: p.variant_label || '', code: p.barcode, price: p.price, stock: p.stock },
    ...(p.units || []).filter((u) => u.barcode).map((u) => ({ key: `u${u.id}`, id: p.id, name: `${p.name} (${u.name})`, label: `${modelName(p)} (${u.name})`, attrs: p.variant_label || '', code: u.barcode, price: u.price ?? Math.round(p.price * u.factor), stock: null })),
  ]), [products]);
  const shown = rows.filter((r) => !filter || r.name.includes(filter) || (r.code || '').includes(filter));
  const missing = products.filter((p) => !p.barcode).length;
  const chosen = rows.filter((r) => r.code && Number(copies[r.key]) > 0).map((r) => ({ ...r, copies: Number(copies[r.key]) }));
  const total = chosen.reduce((s, r) => s + r.copies, 0);
  const sample = chosen[0] || rows.find((r) => r.code) || { name: t('rdesign.sampleItem1'), attrs: '', code: '6221000000011', price: 1500 };

  async function saveDesign() {
    try {
      await api.settings.save({ label_layout: labelSetting(layout), label_size: size });
      await reloadSettings();
      notify(t('common.saved'));
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }

  async function generate() {
    try {
      const n = await api.products.generateBarcodes({});
      notify(t('labels.generated', { n }));
      setVersion((v) => v + 1);
      onChanged?.();
    } catch (err) {
      notify(tErr(err), 'error');
    }
  }

  return (
    <Modal title={`🏷 ${t('labels.title')}`} onClose={onClose} width={860}
      footer={<>
        <span className="muted">{t('labels.count', { n: total })}</span>
        <span className="spacer" />
        <button onClick={() => setCopies(Object.fromEntries(shown.filter((r) => r.code).map((r) => [r.key, 1])))}>{t('labels.oneEach')}</button>
        <button onClick={() => setCopies(Object.fromEntries(shown.filter((r) => r.code && r.stock > 0).map((r) => [r.key, Math.ceil(r.stock)])))}>{t('labels.byStock')}</button>
        <button className="primary" disabled={!total} onClick={() => printDoc(labelsHtml(chosen, { size, layout, settings }), settings.label_printer_name)}>🖨 {t('common.print')}</button>
      </>}>
      <div className="row">
        <input className="grow" placeholder={t('common.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className={designing ? 'on' : ''} onClick={() => setDesigning((x) => !x)}>🎨 {t('labels.design')} ({sizeName(size, t)})</button>
      </div>
      {designing && <LabelDesigner size={size} setSize={setSize} layout={layout} setLayout={setLayout} sample={sample} onSave={saveDesign} />}
      {missing > 0 && can('products') && (
        <div className="pay-customer"><span>{t('labels.missing', { n: missing })}</span><button type="button" onClick={generate}>⚙ {t('labels.generate')}</button></div>
      )}
      <div className="excel-preview">
        <table className="grid compact-inputs">
          <thead><tr><th>{t('common.name')}</th><th>{t('products.barcode')}</th><th className="num">{t('pos.price')}</th><th className="num">{t('products.stock')}</th><th>{t('labels.copies')}</th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.key} className={r.code ? '' : 'dim'}>
              <td>{r.name}</td><td className="mono small">{r.code || '—'}</td><td className="num">{formatMoney(r.price, settings)}</td><td className="num">{r.stock ?? ''}</td>
              <td><input type="number" min="0" disabled={!r.code} value={copies[r.key] ?? ''} onChange={(e) => setCopies((c) => ({ ...c, [r.key]: e.target.value }))} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Modal>
  );
}
