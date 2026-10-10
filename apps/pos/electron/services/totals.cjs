'use strict';
// Pure pricing math shared by the main process (authoritative) and tests.
// All amounts are integer minor units; rates are percentages (e.g. 14 = 14%).

function lineTotal(unitPrice, qty, discount = 0) {
  const gross = Math.round(unitPrice * qty);
  return Math.max(0, gross - Math.min(Math.max(0, discount), gross));
}

/**
 * @param {Array<{unit_price:number, qty:number, discount?:number}>} items
 * @param {{discount?:number, taxRate?:number, pricesIncludeTax?:boolean, serviceRate?:number}} opts
 */
function computeTotals(items, opts = {}) {
  const taxRate = Number(opts.taxRate) || 0;
  const serviceRate = Number(opts.serviceRate) || 0;
  const lines = items.map((it) => ({ ...it, line_total: lineTotal(it.unit_price, it.qty, it.discount) }));
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const discount = Math.min(Math.max(0, Math.round(opts.discount || 0)), subtotal);
  const afterDiscount = subtotal - discount;
  const service = Math.round((afterDiscount * serviceRate) / 100);
  const base = afterDiscount + service;
  let tax;
  let total;
  if (opts.pricesIncludeTax) {
    tax = Math.round((base * taxRate) / (100 + taxRate));
    total = base;
  } else {
    tax = Math.round((base * taxRate) / 100);
    total = base + tax;
  }
  return { lines, subtotal, discount, service, tax, total };
}

module.exports = { computeTotals, lineTotal };
