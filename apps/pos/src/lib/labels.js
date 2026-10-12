// Barcode stickers: sizes, the saved design (`label_layout` setting, JSON) and the printable HTML.
// The size itself is the `label_size` setting (per computer: each one has its own label printer).
import { barcodeSvg } from './barcode.js';
import { formatMoney } from './money.js';

// Roll sizes in mm, plus A4 sheets of stickers for normal printers.
export const LABEL_SIZES = {
  '38x25': [38, 25], '40x30': [40, 30], '50x25': [50, 25], '50x30': [50, 30], '58x40': [58, 40], '60x40': [60, 40],
  a4: [70, 37], // 3 × 8 on A4
  a4_40: [52.5, 29.7], // 4 × 10 on A4
  custom: null,
};
export const SHEETS = { a4: { cols: 3, rows: 8 }, a4_40: { cols: 4, rows: 10 } };

/** How a size reads in a list: "38 × 25 mm", "A4 — 24 labels"… */
export const sizeName = (k, t) => (k === 'custom' ? t('labels.custom') : SHEETS[k] ? t('labels.sheet', { n: SHEETS[k].cols * SHEETS[k].rows }) : `${k.replace('x', ' × ')} mm`);

/** Parts of a sticker the owner can switch on and off, top to bottom. */
export const LABEL_PARTS = ['business', 'name', 'attrs', 'code', 'price', 'custom'];

export const DEFAULT_LABEL = {
  show: { business: false, name: true, attrs: true, code: true, price: true, custom: false },
  nameSize: 8, // pt
  priceSize: 10, // pt
  bars: 45, // % of the sticker height for the bars
  currency: true,
  customText: '',
  customW: 40,
  customH: 25,
  rotate: false, // printers that feed the roll upside down
  border: false, // a frame, to line the design up on a new roll
};

const clamp = (v, min, max, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.min(max, Math.max(min, Number(v))) : d);

/** The saved design, always complete and within limits. */
export function labelLayout(settings) {
  let saved = {};
  try { saved = JSON.parse(settings?.label_layout || '{}') || {}; } catch { saved = {}; }
  const show = { ...DEFAULT_LABEL.show };
  for (const k of LABEL_PARTS) if (typeof saved.show?.[k] === 'boolean') show[k] = saved.show[k];
  const bool = (k) => (typeof saved[k] === 'boolean' ? saved[k] : DEFAULT_LABEL[k]);
  return {
    show,
    nameSize: clamp(saved.nameSize, 5, 16, DEFAULT_LABEL.nameSize),
    priceSize: clamp(saved.priceSize, 6, 22, DEFAULT_LABEL.priceSize),
    bars: clamp(saved.bars, 20, 75, DEFAULT_LABEL.bars),
    currency: bool('currency'),
    customText: typeof saved.customText === 'string' ? saved.customText.slice(0, 60) : '',
    customW: clamp(saved.customW, 20, 120, DEFAULT_LABEL.customW),
    customH: clamp(saved.customH, 10, 100, DEFAULT_LABEL.customH),
    rotate: bool('rotate'),
    border: bool('border'),
  };
}

export const labelSetting = (layout) => JSON.stringify(labelLayout({ label_layout: JSON.stringify(layout) }));

/** [width, height] in mm for a size key (custom → the design's own size). */
export function labelSize(size, layout) {
  if (size === 'custom') return [layout.customW, layout.customH];
  return LABEL_SIZES[size] || LABEL_SIZES['38x25'];
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** One sticker's inner HTML: label = { name, label (name without the variant), code, price, attrs }. */
function sticker(l, layout, settings) {
  const { show } = layout;
  // With the size / colour line on, the name leaves it out (it would print twice).
  const name = show.attrs && l.attrs ? l.label || l.name : l.name;
  const price = show.price && l.price != null
    ? (layout.currency ? formatMoney(l.price, settings) : formatMoney(l.price, { ...settings, currency_symbol: '' }).trim())
    : '';
  return `<div class="lb">
    ${show.business && settings.business_name ? `<div class="biz">${esc(settings.business_name)}</div>` : ''}
    ${show.name ? `<div class="nm">${esc(name)}</div>` : ''}
    ${show.attrs && l.attrs ? `<div class="at">${esc(l.attrs)}</div>` : ''}
    <div class="bc">${barcodeSvg(l.code, { height: 40, showText: false })}</div>
    ${show.code ? `<div class="cd">${esc(l.code)}</div>` : ''}
    ${price ? `<div class="pr">${price}</div>` : ''}
    ${show.custom && layout.customText ? `<div class="cu">${esc(layout.customText)}</div>` : ''}
  </div>`;
}

/**
 * Printable stickers. labels = [{ name, code, price, attrs, copies }]; `size` is a LABEL_SIZES key.
 * `preview` draws a single sticker without page rules (for the designer).
 */
export function labelsHtml(labels, { size, layout, settings, preview = false }) {
  const [w, h] = labelSize(size, layout);
  const sheet = SHEETS[size];
  const body = labels.flatMap((l) => Array.from({ length: Math.max(1, l.copies || 1) }, () => sticker(l, layout, settings))).join('');
  const page = preview ? '' : `@page { size: ${sheet ? 'A4' : `${w}mm ${h}mm`}; margin: ${sheet ? '10mm 5mm' : '0'}; }`;
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
    ${page}
    * { box-sizing: border-box; margin: 0; }
    html, body { overflow: hidden; }
    body { font-family: Tahoma, Arial, sans-serif; color: #000; background: #fff;
      ${sheet && !preview ? `display: grid; grid-template-columns: repeat(${sheet.cols}, ${w}mm); grid-auto-rows: ${h}mm;` : ''} }
    .lb { width: ${w}mm; height: ${h}mm; padding: 1.2mm 1.5mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .3mm; overflow: hidden;
      ${sheet || preview ? '' : 'page-break-after: always;'} ${layout.rotate ? 'transform: rotate(180deg);' : ''} ${layout.border ? 'outline: .2mm solid #000; outline-offset: -.2mm;' : ''} }
    .biz { font-size: ${Math.max(5, layout.nameSize - 1.5)}pt; line-height: 1.1; }
    .nm { font-size: ${layout.nameSize}pt; font-weight: bold; text-align: center; max-height: 2.4em; overflow: hidden; line-height: 1.2; }
    .at { font-size: ${Math.max(5, layout.nameSize - 1)}pt; line-height: 1.1; }
    .lb > div { flex: none; }
    /* the bars give way first when the texts need the room */
    .lb > .bc { width: 100%; height: ${layout.bars}%; flex: 0 1 auto; min-height: 0; display: flex; }
    .bc svg { width: 100%; height: 100%; }
    .cd { font: ${Math.max(5, layout.nameSize - 1.5)}pt/1 monospace; letter-spacing: .5px; direction: ltr; }
    .pr { font-size: ${layout.priceSize}pt; font-weight: bold; line-height: 1.1; }
    .cu { font-size: ${Math.max(5, layout.nameSize - 1.5)}pt; line-height: 1.1; }
  </style></head><body>${body}</body></html>`;
}
