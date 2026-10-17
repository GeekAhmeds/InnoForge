// Stock in packs: 245 bottles with a carton of 24 → "10 كرتونة + 5 قطعة".
// Stock is always kept in the base unit; this is only how it is shown.
import { formatQty } from './money.js';

/** The pack used to show stock: the largest whole-number unit above 1 (e.g. carton of 24). */
export function bigPack(units) {
  return (units || []).filter((u) => Number(u.factor) > 1 && Number.isInteger(Number(u.factor))).sort((a, b) => b.factor - a.factor)[0] || null;
}

/** The base unit's name for people: 'pcs' (the default) reads as "piece". */
export const baseUnitName = (unit, t) => (!unit || unit === 'pcs' ? t('units.piece') : unit);

/** "10 كرتونة + 5 قطعة", or '' when the stock is less than one pack (or there is no pack). */
export function packsText(qty, product, t) {
  const pack = bigPack(product?.units);
  const q = Number(qty) || 0;
  if (!pack || Math.abs(q) < pack.factor) return '';
  const sign = q < 0 ? '-' : '';
  const abs = Math.abs(q);
  const packs = Math.floor(abs / pack.factor);
  const rest = Math.round((abs - packs * pack.factor) * 1000) / 1000;
  return `${sign}${packs} ${pack.name}${rest ? ` + ${formatQty(rest)} ${baseUnitName(product.unit, t)}` : ''}`;
}

/**
 * The pack a scanned barcode stands for (a carton's own barcode), or null for the item itself.
 * products.byBarcode returns the matched unit as `unit`; on a plain item `unit` is its base
 * unit's name ('pcs', 'kg'), which is not a pack.
 */
export const scannedUnit = (p) => (p?.unit && typeof p.unit === 'object' ? p.unit : null);
