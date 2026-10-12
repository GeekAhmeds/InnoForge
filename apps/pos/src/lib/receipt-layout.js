// What the customer's thermal receipt shows (Settings → Receipt & printing → receipt design).
// Stored as one JSON setting (`receipt_layout`); anything missing or broken falls back to the
// defaults, which match the receipt before the designer existed.
//
// The business name, invoice number, date, the items with their totals, VAT, the tax number,
// the Gulf "Tax invoice" title and the FATOORA QR are required by law (or by the receipt making
// sense) and are always printed, so they have no switch here.

/** Parts the owner can switch on and off, in the order they appear on the receipt. */
export const RECEIPT_PARTS = [
  { key: 'logo', group: 'top', def: false },
  { key: 'address', group: 'top', def: true },
  { key: 'phone', group: 'top', def: true },
  { key: 'header', group: 'top', def: true },
  { key: 'cashier', group: 'info', def: true },
  { key: 'orderType', group: 'info', def: true },
  { key: 'customer', group: 'info', def: true },
  { key: 'delivery', group: 'info', def: true },
  { key: 'itemDetails', group: 'items', def: true },
  { key: 'modifiers', group: 'items', def: true },
  { key: 'itemNotes', group: 'items', def: true },
  { key: 'promos', group: 'items', def: true },
  { key: 'payments', group: 'totals', def: true },
  { key: 'change', group: 'totals', def: true },
  { key: 'balance', group: 'totals', def: true },
  { key: 'loyalty', group: 'totals', def: true },
  { key: 'orderNote', group: 'bottom', def: true },
  { key: 'invoiceBarcode', group: 'bottom', def: false },
  { key: 'qr', group: 'bottom', def: false },
  { key: 'footer', group: 'bottom', def: true },
];

export const FONT_SIZES = [10, 11, 12, 13, 14];
export const LOGO_WIDTHS = [30, 45, 60, 80];

export const DEFAULT_LAYOUT = {
  show: Object.fromEntries(RECEIPT_PARTS.map((p) => [p.key, p.def])),
  font: 12,
  logoWidth: 45, // % of the paper width
  qrUrl: '', // a link printed as a QR (menu, Instagram, Google review…)
  qrLabel: '',
};

/** The receipt layout from the settings, always complete and within limits. */
export function receiptLayout(settings) {
  let saved = {};
  try { saved = JSON.parse(settings?.receipt_layout || '{}') || {}; } catch { saved = {}; }
  const show = { ...DEFAULT_LAYOUT.show };
  for (const p of RECEIPT_PARTS) if (typeof saved.show?.[p.key] === 'boolean') show[p.key] = saved.show[p.key];
  return {
    show,
    font: FONT_SIZES.includes(Number(saved.font)) ? Number(saved.font) : DEFAULT_LAYOUT.font,
    logoWidth: LOGO_WIDTHS.includes(Number(saved.logoWidth)) ? Number(saved.logoWidth) : DEFAULT_LAYOUT.logoWidth,
    qrUrl: typeof saved.qrUrl === 'string' ? saved.qrUrl.trim().slice(0, 300) : '',
    qrLabel: typeof saved.qrLabel === 'string' ? saved.qrLabel.slice(0, 80) : '',
  };
}

/** A layout cleaned up and ready to store in the `receipt_layout` setting. */
export const layoutSetting = (layout) => JSON.stringify(receiptLayout({ receipt_layout: JSON.stringify(layout) }));
