import React, { useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { barcodeSvg } from '../lib/barcode.js';
import { formatMoney } from '../lib/money.js';
import { Field, Modal, Toggle, useApp } from './ui.jsx';

// Label sizes in mm. 'a4' prints a 3×8 sheet of 70×37mm stickers on a normal printer.
const SIZES = { '38x25': [38, 25], '50x30': [50, 30], '58x40': [58, 40], a4: [70, 37] };

function labelsHtml(labels, opts, settings) {
  const [w, h] = SIZES[opts.size] || SIZES['38x25'];
  const sheet = opts.size === 'a4';
  const one = (l) => `<div class="lb">
    ${opts.business ? `<div class="biz">${escape(settings.business_name)}</div>` : ''}
    ${opts.name ? `<div class="nm">${escape(l.name)}</div>` : ''}
    <div class="bc">${barcodeSvg(l.code, { height: 40 })}</div>
    ${opts.price ? `<div class="pr">${formatMoney(l.price, settings)}</div>` : ''}
  </div>`;
  const body = labels.flatMap((l) => Array.from({ length: l.copies }, () => one(l))).join('');
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
    @page { size: ${sheet ? 'A4' : `${w}mm ${h}mm`}; margin: ${sheet ? '10mm 5mm' : '0'}; }
    * { box-sizing: border-box; margin: 0; }
    body { font-family: Tahoma, Arial, sans-serif; ${sheet ? 'display: grid; grid-template-columns: repeat(3, 70mm); grid-auto-rows: 37mm;' : ''} }
    .lb { width: ${w}mm; height: ${h}mm; padding: 1.2mm 1.5mm; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; ${sheet ? '' : 'page-break-after: always;'} }
    .biz { font-size: 6.5pt; color: #333; }
    .nm { font-size: ${h < 30 ? 7 : 8.5}pt; font-weight: bold; text-align: center; max-height: 2.4em; overflow: hidden; line-height: 1.2; }
    .bc { width: 100%; flex: 1; min-height: 0; display: flex; }
    .bc svg { width: 100%; height: 100%; }
    .pr { font-size: ${h < 30 ? 9 : 11}pt; font-weight: bold; }
  </style></head><body>${body}</body></html>`;
}

const escape = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Choose products and copies, then print barcode stickers. */
export default function LabelsModal({ products, onClose, onChanged }) {
  const { t, tErr, notify, settings, printDoc, can } = useApp();
  const [copies, setCopies] = useState({});
  const [filter, setFilter] = useState('');
  const [opts, setOpts] = useState({ size: settings.label_size || '38x25', name: true, price: true, business: false });
  // Units with their own barcode (e.g. a carton) get their own label rows.
  const rows = useMemo(() => products.flatMap((p) => [
    { key: `p${p.id}`, id: p.id, name: p.name, code: p.barcode, price: p.price, stock: p.stock },
    ...(p.units || []).filter((u) => u.barcode).map((u) => ({ key: `u${u.id}`, id: p.id, name: `${p.name} (${u.name})`, code: u.barcode, price: u.price ?? Math.round(p.price * u.factor), stock: null })),
  ]), [products]);
  const shown = rows.filter((r) => !filter || r.name.includes(filter) || (r.code || '').includes(filter));
  const missing = products.filter((p) => !p.barcode).length;
  const chosen = rows.filter((r) => r.code && Number(copies[r.key]) > 0).map((r) => ({ ...r, copies: Number(copies[r.key]) }));
  const total = chosen.reduce((s, r) => s + r.copies, 0);

  async function generate() {
    try {
      const n = await api.products.generateBarcodes({});
      notify(t('labels.generated', { n }));
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
        <button className="primary" disabled={!total} onClick={() => printDoc(labelsHtml(chosen, opts, settings), settings.label_printer_name)}>🖨 {t('common.print')}</button>
      </>}>
      <div className="grid3">
        <Field label={t('labels.size')}>
          <select value={opts.size} onChange={(e) => setOpts({ ...opts, size: e.target.value })}>
            {Object.keys(SIZES).map((k) => <option key={k} value={k}>{k === 'a4' ? t('labels.a4') : `${k.replace('x', ' × ')} mm`}</option>)}
          </select>
        </Field>
        <div className="row wrap">
          <Toggle checked={opts.name} onChange={(v) => setOpts({ ...opts, name: v })} label={t('common.name')} />
          <Toggle checked={opts.price} onChange={(v) => setOpts({ ...opts, price: v })} label={t('pos.price')} />
          <Toggle checked={opts.business} onChange={(v) => setOpts({ ...opts, business: v })} label={t('setup.businessName')} />
        </div>
        <input placeholder={t('common.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
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
      {chosen[0] && <div className="label-preview" dangerouslySetInnerHTML={{ __html: barcodeSvg(chosen[0].code, { height: 40 }) }} />}
    </Modal>
  );
}
