// Builds self-contained HTML documents for the thermal printer.
import { formatMoney, formatQty } from './money.js';
import { VENDOR } from './vendor.js';
import { barcodeSvg } from './barcode.js';
import { qrSvg } from './qr.js';
import { zatcaQrForOrder } from './zatca-qr.js';
import { receiptLayout } from './receipt-layout.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Numbers, phones and dates inside RTL text must stay left-to-right.
const ltr = (s) => `<span dir="ltr">${esc(s)}</span>`;
// Header / footer text may span several lines.
const lines = (s) => esc(s).replace(/\r?\n/g, '<br>');

/** The fixed last line of every printed document: who made the program and how to reach support. */
export const vendorLine = (t) => `InnoForge POS — <span dir="ltr">${VENDOR.websiteLabel}</span><br>${t('receipt.support')}: <span dir="ltr">${VENDOR.support}</span>`;

function page(settings, lang, body) {
  const width = Number(settings.paper_width) || 80;
  const font = receiptLayout(settings).font;
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<style>
  @page { size: ${width}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 3mm; width: ${width}mm; font: ${font}px/1.35 Tahoma, "Segoe UI", Arial, sans-serif; color: #000; }
  h1 { font-size: ${font + 4}px; margin: 0 0 2px; text-align: center; }
  .c { text-align: center; } .muted { font-size: ${font - 1}px; }
  .logo { display: block; margin: 0 auto 4px; max-height: 30mm; object-fit: contain; filter: grayscale(1); }
  .vendor { font-size: ${Math.max(9, font - 2)}px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 2px 0; vertical-align: top; text-align: start; }
  .n { text-align: end; white-space: nowrap; }
  .big td { font-size: ${font + 3}px; font-weight: bold; }
  .note { font-size: ${font - 1}px; padding-inline-start: 8px; }
  .kitchen td { font-size: 16px; font-weight: bold; }
</style></head><body>${body}</body></html>`;
}

/** Gulf VAT invoices carry a fixed bilingual title; '' elsewhere (or when not VAT-registered). */
export function vatTitle(settings, t, b2b = false) {
  if (!settings.tax_number) return '';
  if (settings.country === 'SA') return t(b2b ? 'invoice.taxSA' : 'invoice.simplifiedSA');
  if (settings.country === 'AE') return t('invoice.taxAE');
  return '';
}

/** The QR a Saudi invoice must carry (signed in phase 2, plain TLV in phase 1). */
const zatcaQr = (order, settings, size) => {
  const text = zatcaQrForOrder(order, settings);
  return text ? `<div class="c" style="margin:6px 0">${qrSvg(text, { size })}</div>` : '';
};

/** VAT per line (the order's VAT spread over the lines), for Gulf tax invoices. */
function lineVat(items, tax) {
  const sum = items.reduce((a, i) => a + (i.line_total || 0), 0);
  let left = tax || 0;
  return items.map((i, n) => {
    const v = n === items.length - 1 ? left : sum ? Math.round(((tax || 0) * (i.line_total || 0)) / sum) : 0;
    left -= v;
    return v;
  });
}

function header(settings, t) {
  const { show, logoWidth } = receiptLayout(settings);
  return `${show.logo && settings.business_logo ? `<img class="logo" src="${esc(settings.business_logo)}" style="width:${logoWidth}%" alt="">` : ''}
  <h1>${esc(settings.business_name)}</h1>
  ${show.address && settings.address ? `<div class="c muted">${esc(settings.address)}</div>` : ''}
  ${show.phone && settings.phone ? `<div class="c muted">${ltr(settings.phone)}</div>` : ''}
  ${settings.tax_number ? `<div class="c muted">${t('receipt.taxNumber')}: ${ltr(settings.tax_number)}</div>` : ''}
  ${show.header && settings.receipt_header ? `<div class="c">${lines(settings.receipt_header)}</div>` : ''}`;
}

/** The bottom of a receipt: the owner's link QR, the footer text and the fixed vendor line. */
function footer(settings, t) {
  const { show, qrUrl, qrLabel } = receiptLayout(settings);
  return `${show.qr && qrUrl ? `<div class="c" style="margin:6px 0">${qrSvg(qrUrl, { size: 110 })}${qrLabel ? `<div class="muted">${esc(qrLabel)}</div>` : ''}</div>` : ''}
  ${show.footer && settings.receipt_footer ? `<div class="c">${lines(settings.receipt_footer)}</div>` : ''}
  <div class="c vendor">${vendorLine(t)}</div>`;
}

export function receiptHtml(order, settings, t, lang) {
  const { show } = receiptLayout(settings);
  const m = (v) => formatMoney(v, settings);
  const rows = order.items.map((i) => `
    <tr><td>${esc(i.name)}</td><td class="n">${formatQty(i.qty)}</td><td class="n">${m(i.line_total)}</td></tr>
    ${show.itemDetails && i.qty !== 1 ? `<tr><td class="note" colspan="3">${formatQty(i.qty)} × ${m(i.unit_price)}${i.discount ? ` − ${m(i.discount)}` : ''}</td></tr>` : ''}
    ${show.modifiers && i.modifiers?.length ? `<tr><td class="note" colspan="3">+ ${i.modifiers.map((x) => esc(x.name)).join('، ')}</td></tr>` : ''}
    ${show.itemNotes && i.note ? `<tr><td class="note" colspan="3">${esc(i.note)}</td></tr>` : ''}
    ${show.promos && i.promo_name ? `<tr><td class="note" colspan="3">🏷 ${esc(i.promo_name)} −${m(i.promo_discount)}</td></tr>` : ''}`).join('');
  const line = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="n">${v}</td></tr>`;
  const changeRow = show.change && order.change_due ? line(t('pay.change'), m(order.change_due)) : '';
  // Hiding the change folds it back out of the cash line (the receipt shows what was paid).
  const pays = show.payments ? order.payments.map((p) => line(t(`pay.${p.method}`), m(p.amount + (p.method === 'cash' && show.change ? order.change_due || 0 : 0)))).join('') : '';
  const customer = [order.customer_name, order.customer_phone, order.customer_address].filter(Boolean).map(esc).join(' — ');

  const title = vatTitle(settings, t, !!order.customer?.tax_number);
  return page(settings, lang, `${header(settings, t)}
  ${title ? `<div class="c" style="margin-top:4px"><b>${title}</b></div>` : ''}
  <hr>
  <table>
    ${line(t('receipt.invoice'), `<b>${order.invoice_no ?? '—'}</b>`)}
    ${line(t('receipt.date'), ltr(order.completed_at || order.created_at))}
    ${show.cashier ? line(t('receipt.cashier'), esc(order.user_name)) : ''}
    ${show.orderType && order.order_type !== 'sale' ? line(t('orders.type'), t(`order.${order.order_type}`) + (order.table_name ? ` — ${t('pos.table')} ${esc(order.table_name)}` : '')) : ''}
  </table>
  ${show.customer && customer ? `<div class="muted">${t('pos.customer')}: ${customer}</div>` : ''}
  ${show.delivery && order.order_type === 'delivery' && (order.zone_name || order.driver_name) ? `<div class="muted">🛵 ${esc([order.zone_name, order.driver_name].filter(Boolean).join(' — '))}</div>` : ''}
  <hr>
  <table>
    <tr><th>${t('receipt.item')}</th><th class="n">${t('receipt.qty')}</th><th class="n">${t('receipt.amount')}</th></tr>
    ${rows}
  </table>
  <hr>
  <table>
    ${line(t('pos.subtotal'), m(order.subtotal))}
    ${order.discount ? line(order.coupon_discount ? `${t('pos.discount')} (🎟 ${t('coupon.coupon')} ${m(order.coupon_discount)})` : t('pos.discount'), '− ' + m(order.discount)) : ''}
    ${order.service ? line(t('pos.service'), m(order.service)) : ''}
    ${order.delivery_fee ? line(t('delivery.fee'), m(order.delivery_fee)) : ''}
    ${order.tax ? line(settings.prices_include_tax ? `${t('pos.tax')} (${t('receipt.taxIncluded')})` : t('pos.tax'), m(order.tax)) : ''}
    ${line(t('pos.total'), m(order.total), 'big')}
    ${pays}
    ${changeRow}
    ${order.credit ? line(t('pay.onAccount'), m(order.credit), 'big') : ''}
    ${order.refunded ? line(t('receipt.refunded'), m(order.refunded)) : ''}
    ${show.balance && order.customer_balance != null && (order.credit || order.customer_balance) ? line(t('customers.currentBalance'), m(order.customer_balance)) : ''}
    ${show.loyalty && order.points_earned ? line(`⭐ ${t('loyalty.earned')}`, `+${formatQty(order.points_earned)}`) : ''}
    ${show.loyalty && order.customer?.points != null && (order.points_earned || order.points_redeemed) ? line(`⭐ ${t('loyalty.balance')}`, formatQty(order.customer.points)) : ''}
  </table>
  ${show.orderNote && order.note ? `<hr><div>${esc(order.note)}</div>` : ''}
  <hr>
  ${zatcaQr(order, settings, 130)}
  ${show.invoiceBarcode && order.invoice_no ? `<div class="c">${barcodeSvg(String(order.invoice_no), { height: 32 })}</div>` : ''}
  ${footer(settings, t)}`);
}

/** The bill brought to the table before paying (not an invoice: no number, no payments). */
export function checkHtml(order, settings, t, lang) {
  const m = (v) => formatMoney(v, settings);
  const line = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="n">${v}</td></tr>`;
  const rows = order.items.map((i) => `<tr><td>${esc(i.name)}${i.modifiers?.length ? `<div class="note">+ ${i.modifiers.map((x) => esc(x.name)).join('، ')}</div>` : ''}</td><td class="n">${formatQty(i.qty)}</td><td class="n">${m(i.line_total)}</td></tr>`).join('');
  return page(settings, lang, `${header(settings, t)}
  <hr><div class="c"><b>${t('floor.checkTitle')}</b></div>
  <div class="c">${order.table_name ? `${t('pos.table')} <b>${esc(order.table_name)}</b>` : t(`order.${order.order_type}`)}${order.guests ? ` · 👥 ${order.guests}` : ''}</div>
  <div class="c muted">#${order.id} — ${ltr(new Date().toLocaleString('en-GB'))} — ${esc(order.user_name)}</div>
  <hr>
  <table><tr><th>${t('receipt.item')}</th><th class="n">${t('receipt.qty')}</th><th class="n">${t('receipt.amount')}</th></tr>${rows}</table>
  <hr>
  <table>
    ${line(t('pos.subtotal'), m(order.subtotal))}
    ${order.discount ? line(t('pos.discount'), '− ' + m(order.discount)) : ''}
    ${order.service ? line(t('pos.service'), m(order.service)) : ''}
    ${order.tax ? line(t('pos.tax'), m(order.tax)) : ''}
    ${line(t('pos.total'), m(order.total), 'big')}
    ${order.guests > 1 ? line(t('floor.perGuest', { n: order.guests }), m(Math.ceil(order.total / order.guests))) : ''}
  </table>
  <hr><div class="c muted">${t('floor.notInvoice')}</div>`);
}

export function kitchenHtml(order, items, settings, t, lang, station = '') {
  const where = order.order_type === 'dine_in' && order.table_name ? `${t('pos.table')} ${esc(order.table_name)}` : t(`order.${order.order_type}`);
  return page(settings, lang, `<h1>${station ? esc(station) : t('receipt.kitchen')}</h1>
  <div class="c" style="font-size:18px;font-weight:bold">${where}</div>
  <div class="c muted">#${order.id} — ${new Date().toLocaleString('en-GB')} — ${esc(order.user_name)}</div>
  <hr>
  <table class="kitchen">
    ${items.map((i) => `<tr><td>${formatQty(i.qty)} ×</td><td>${esc(i.name)}</td></tr>${i.note ? `<tr><td></td><td class="note">${esc(i.note)}</td></tr>` : ''}`).join('')}
  </table>
  ${order.note ? `<hr><div>${esc(order.note)}</div>` : ''}`);
}

export function shiftHtml(summary, settings, t, lang) {
  const m = (v) => formatMoney(v, settings);
  const { shift, sales, byMethod, refunds, expectedCash } = summary;
  const line = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="n">${v}</td></tr>`;
  return page(settings, lang, `${header(settings, t)}
  <hr><div class="c"><b>${t('shift.report')} #${shift.id}</b></div><hr>
  <table>
    ${line(t('shift.by'), esc(shift.user_name))}
    ${line(t('shift.openedAt'), ltr(shift.opened_at))}
    ${shift.closed_at ? line(t('shift.closedAt'), ltr(shift.closed_at)) : ''}
    ${line(t('shift.openingCash'), m(shift.opening_cash))}
    ${line(t('shift.salesCount'), sales.count)}
    ${line(t('shift.sales'), m(sales.total), 'big')}
    ${sales.discount ? line(t('pos.discount'), m(sales.discount)) : ''}
    ${sales.tax ? line(t('pos.tax'), m(sales.tax)) : ''}
  </table><hr><table>
    ${byMethod.map((b) => line(t(`pay.${b.method}`), m(b.amount))).join('')}
    ${line(t('shift.refunds'), `${refunds.count} — ${m(refunds.total)}`)}
    ${summary.supplierCash ? line(t('shift.supplierCash'), '− ' + m(summary.supplierCash)) : ''}
    ${summary.expenseCash ? line(t('shift.expenseCash'), '− ' + m(summary.expenseCash)) : ''}
    ${summary.customerCash ? line(t('shift.customerCash'), '+ ' + m(summary.customerCash)) : ''}
    ${summary.giftCash ? line(t('shift.giftCash'), '+ ' + m(summary.giftCash)) : ''}
    ${summary.creditSales ? line(t('shift.creditSales'), m(summary.creditSales)) : ''}
  </table><hr><table>
    ${line(t('shift.expectedCash'), m(expectedCash), 'big')}
    ${shift.counted_cash != null ? line(t('shift.countedCash'), m(shift.counted_cash)) : ''}
    ${shift.counted_cash != null ? line(t('shift.difference'), m(shift.counted_cash - expectedCash)) : ''}
  </table>
  ${shift.notes ? `<hr><div>${esc(shift.notes)}</div>` : ''}`);
}

export function collectionHtml(r, customer, settings, t, lang) {
  const m = (v) => formatMoney(v, settings);
  const line = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="n">${v}</td></tr>`;
  const method = `${t(`pay.${r.method}`)}${r.cheque_no ? ` ${ltr(r.cheque_no)}` : ''}`;
  return page(settings, lang, `${header(settings, t)}
  <hr><div class="c"><b>${t('customers.receipt')} #${r.receipt_no}</b></div>
  ${r.status && r.status !== 'posted' ? `<div class="c"><b>*** ${t(`collect.status.${r.status}`)} ***</b></div>` : ''}<hr>
  <table>
    ${line(t('receipt.date'), ltr(r.created_at))}
    ${line(t('pos.customer'), esc(customer.name))}
    ${customer.phone ? line(t('settings.phone'), ltr(customer.phone)) : ''}
    ${line(method, m(r.amount), 'big')}
    ${r.bank ? line(t('collect.bank'), esc(r.bank)) : ''}
    ${r.cheque_due ? line(t('collect.chequeDue'), ltr(r.cheque_due)) : ''}
    ${r.discount ? line(t('collect.discount'), m(r.discount)) : ''}
  </table>
  ${r.allocations?.length ? `<hr><table>${r.allocations.map((a) => line(`${t('customers.invoice')} #${a.invoice_no}`, m(a.amount))).join('')}</table>` : ''}
  <hr><table>
    ${line(t('customers.balanceAfter'), m(customer.balance))}
    ${line(t('collect.collector'), esc(r.collector_name || r.user_name))}
  </table>
  ${r.notes ? `<hr><div>${esc(r.notes)}</div>` : ''}
  <br><div>${t('collect.signature')}: ..................</div>
  <hr><div class="c vendor">${vendorLine(t)}</div>`);
}

export function statementHtml(data, settings, t, lang) {
  const m = (v) => formatMoney(v, settings);
  const { customer, rows, balance } = data;
  const kind = (r) => ({
    sale: `${t('customers.invoice')} #${r.ref}${r.debit > 0 && r.due_date ? ` <small class="muted">(${t('collect.due')} ${ltr(r.due_date)})</small>` : ''}`,
    return: t('customers.returnCredit'),
    discount: `${t('collect.discount')} — ${t('customers.receipt')} #${r.receipt_no}`,
    bounced: `${t('cheques.bounced')} ${esc(r.cheque_no)}`,
  }[r.kind] || `${t('customers.receipt')} #${r.receipt_no ?? ''} — ${t(`pay.${r.ref}`)}${r.cheque_no ? ` ${esc(r.cheque_no)}` : ''}`);
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm; }
    body { font: 12px/1.5 Tahoma, "Segoe UI", Arial, sans-serif; color: #000; }
    h1 { font-size: 18px; margin: 0; } .muted { color: #555; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; } th, td { border-bottom: 1px solid #ccc; padding: 5px 6px; text-align: start; }
    th { background: #eee; } .n { text-align: end; white-space: nowrap; } .total td { font-weight: bold; font-size: 14px; border-top: 2px solid #000; }
  </style></head><body>
  <div class="head"><div><h1>${esc(settings.business_name)}</h1><div class="muted">${esc(settings.address)} ${settings.phone ? ltr(settings.phone) : ''}</div></div>
    <div><b>${t('purchases.statement')}</b><div class="muted">${ltr(new Date().toLocaleDateString('en-GB'))}</div></div></div>
  <p><b>${esc(customer.name)}</b> ${customer.phone ? ' — ' + ltr(customer.phone) : ''} ${customer.address ? ' — ' + esc(customer.address) : ''} ${customer.tax_number ? `<br>${t('receipt.taxNumber')}: ${ltr(customer.tax_number)}` : ''}</p>
  <table><thead><tr><th>${t('orders.date')}</th><th>${t('orders.type')}</th><th class="n">${t('customers.debit')}</th><th class="n">${t('customers.credit')}</th><th class="n">${t('customers.balance')}</th></tr></thead><tbody>
  ${customer.opening_balance ? `<tr><td>—</td><td>${t('customers.opening')}</td><td class="n">${customer.opening_balance > 0 ? m(customer.opening_balance) : ''}</td><td class="n">${customer.opening_balance < 0 ? m(-customer.opening_balance) : ''}</td><td class="n">${m(customer.opening_balance)}</td></tr>` : ''}
  ${rows.map((r) => `<tr><td>${ltr(r.created_at)}</td><td>${kind(r)}${r.notes ? ` — ${esc(r.notes)}` : ''}</td><td class="n">${r.debit ? m(r.debit) : ''}</td><td class="n">${r.credit ? m(r.credit) : ''}</td><td class="n">${m(r.balance)}</td></tr>`).join('')}
  <tr class="total"><td colspan="4">${t('customers.balance')}</td><td class="n">${m(balance)}</td></tr>
  </tbody></table>
  ${data.open?.length ? `<h3 style="margin-top:18px">${t('collect.openInvoices')}</h3><table><thead><tr><th>${t('customers.invoice')}</th><th>${t('orders.date')}</th><th>${t('collect.due')}</th><th class="n">${t('collect.remaining')}</th></tr></thead><tbody>
    ${data.open.map((x) => `<tr><td>${x.invoice_no ? `#${x.invoice_no}` : t('customers.opening')}</td><td>${ltr(String(x.date).slice(0, 10))}</td><td>${ltr(x.due_date)}</td><td class="n">${m(x.open)}</td></tr>`).join('')}
  </tbody></table>` : ''}
  <p class="muted" style="margin-top:24px">${vendorLine(t)}</p>
  </body></html>`;
}

/**
 * Formal A4 document (tax invoice or quotation) with the business logo and the
 * customer's tax details. `doc` is an order (kind 'invoice') or a quote (kind 'quote').
 */
export function a4Html(doc, kind, settings, t, lang) {
  const m = (v) => formatMoney(v, settings);
  const rtl = lang === 'ar';
  const isQuote = kind === 'quote';
  const cust = isQuote
    ? { name: doc.customer_display || doc.customer_name, phone: doc.customer_phone, address: doc.customer_address, tax: doc.customer_tax }
    : { name: doc.customer?.name || doc.customer_name, phone: doc.customer?.phone || doc.customer_phone, address: doc.customer?.address || doc.customer_address, tax: doc.customer?.tax_number };
  const gulf = ['SA', 'AE'].includes(settings.country) && !!settings.tax_number && !isQuote;
  const title = isQuote ? t('a4.quote') : vatTitle(settings, t, !!cust.tax) || (settings.tax_number ? t('a4.taxInvoice') : t('a4.invoice'));
  const vats = gulf ? lineVat(doc.items, doc.tax) : [];
  const row = (label, value, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="n">${value}</td></tr>`;
  const items = doc.items.map((i, n) => `<tr>
      <td class="c">${n + 1}</td><td>${esc(i.name)}${i.serials ? `<div class="muted">S/N: ${esc(i.serials)}</div>` : ''}${i.note ? `<div class="muted">${esc(i.note)}</div>` : ''}</td>
      <td class="c">${formatQty(i.qty)}</td><td class="n">${m(i.unit_price)}</td><td class="n">${i.discount ? m(i.discount) : '—'}</td>${gulf ? `<td class="c">${settings.tax_rate}%</td><td class="n">${m(vats[n])}</td>` : ''}<td class="n">${m(i.line_total)}</td></tr>`).join('');
  const paid = (doc.payments || []).reduce((s, p) => s + p.amount, 0);
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 12.5px/1.5 Tahoma, "Segoe UI", Arial, sans-serif; color: #111; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid #0a43c9; }
    .biz { display: flex; gap: 12px; align-items: center; }
    .biz img { max-height: 70px; max-width: 160px; object-fit: contain; }
    .biz h1 { margin: 0; font-size: 20px; }
    .muted { color: #555; font-size: 11.5px; }
    .doc { text-align: end; }
    .doc h2 { margin: 0 0 4px; font-size: 22px; color: #0a43c9; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 14px 0; }
    .box { border: 1px solid #ccd; border-radius: 8px; padding: 8px 12px; }
    .box h4 { margin: 0 0 4px; font-size: 12px; color: #0a43c9; }
    table.items { width: 100%; border-collapse: collapse; }
    table.items th { background: #0a43c9; color: #fff; padding: 7px 8px; font-weight: 600; text-align: start; }
    table.items td { padding: 7px 8px; border-bottom: 1px solid #e3e5ee; vertical-align: top; }
    table.items tr:nth-child(even) td { background: #f6f8fd; }
    .c { text-align: center; } .n { text-align: end; white-space: nowrap; }
    .bottom { display: flex; justify-content: space-between; gap: 20px; margin-top: 14px; }
    .totals { width: 300px; border-collapse: collapse; }
    .totals td { padding: 5px 8px; border-bottom: 1px solid #e3e5ee; }
    .totals .grand td { font-size: 16px; font-weight: bold; background: #0a43c9; color: #fff; }
    .notes { flex: 1; font-size: 11.5px; }
    .sign { display: flex; justify-content: space-between; margin-top: 40px; font-size: 12px; }
    .sign div { width: 40%; border-top: 1px solid #999; padding-top: 4px; text-align: center; }
    .foot { margin-top: 24px; text-align: center; color: #777; font-size: 10.5px; }
  </style></head><body>
  <div class="top">
    <div class="biz">
      ${settings.business_logo ? `<img src="${settings.business_logo}" alt="">` : ''}
      <div><h1>${esc(settings.business_name)}</h1>
        <div class="muted">${esc(settings.address)}</div>
        <div class="muted">${settings.phone ? ltr(settings.phone) : ''}</div>
        ${settings.tax_number ? `<div class="muted">${t('receipt.taxNumber')}: ${ltr(settings.tax_number)}</div>` : ''}</div>
    </div>
    <div class="doc"><h2>${title}</h2>
      <div><b>${isQuote ? t('a4.quoteNo') : t('receipt.invoice')}</b> ${ltr(isQuote ? doc.quote_no : doc.invoice_no ?? doc.id)}</div>
      <div>${t('receipt.date')}: ${ltr((isQuote ? doc.created_at : doc.completed_at || doc.created_at || '').slice(0, 10))}</div>
      ${isQuote && doc.valid_until ? `<div>${t('a4.validUntil')}: ${ltr(doc.valid_until)}</div>` : ''}
    </div>
  </div>
  <div class="parties">
    <div class="box"><h4>${isQuote ? t('a4.to') : t('a4.billTo')}</h4>
      <b>${esc(cust.name || t('a4.cashCustomer'))}</b>
      ${cust.phone ? `<div>${ltr(cust.phone)}</div>` : ''}${cust.address ? `<div>${esc(cust.address)}</div>` : ''}
      ${cust.tax ? `<div>${t('receipt.taxNumber')}: ${ltr(cust.tax)}</div>` : ''}</div>
    <div class="box"><h4>${t('a4.details')}</h4>
      <div>${t('receipt.cashier')}: ${esc(doc.user_name || '')}</div>
      ${!isQuote && doc.order_type && doc.order_type !== 'sale' ? `<div>${t(`order.${doc.order_type}`)}${doc.table_name ? ` — ${t('pos.table')} ${esc(doc.table_name)}` : ''}</div>` : ''}
      ${!isQuote ? `<div>${(doc.payments || []).map((p) => `${t(`pay.${p.method}`)}: ${m(p.amount)}`).join(' · ') || '—'}</div>` : ''}</div>
  </div>
  <table class="items"><thead><tr><th class="c">#</th><th>${t('receipt.item')}</th><th class="c">${t('pos.qty')}</th><th class="n">${t('pos.price')}</th><th class="n">${t('pos.discount')}</th>${gulf ? `<th class="c">${t('invoice.vatRate')}</th><th class="n">${t('invoice.vatAmount')}</th>` : ''}<th class="n">${t('common.total')}</th></tr></thead>
  <tbody>${items}</tbody></table>
  <div class="bottom">
    <div class="notes">
      ${doc.note ? `<p><b>${t('pos.note')}:</b> ${esc(doc.note)}</p>` : ''}
      ${settings.a4_terms ? `<p style="white-space:pre-wrap">${esc(settings.a4_terms)}</p>` : ''}
      ${!isQuote && doc.customer_balance != null ? `<p><b>${t('customers.currentBalance')}:</b> ${m(doc.customer_balance)}</p>` : ''}
      ${!isQuote ? zatcaQr(doc, settings, 120) : ''}
    </div>
    <table class="totals">
      ${row(t('pos.subtotal'), m(doc.subtotal))}
      ${doc.discount ? row(t('pos.discount'), '− ' + m(doc.discount)) : ''}
      ${doc.service ? row(t('pos.service'), m(doc.service)) : ''}
      ${doc.tax ? row(settings.prices_include_tax ? `${t('pos.tax')} (${t('receipt.taxIncluded')})` : `${t('pos.tax')} ${settings.tax_rate}%`, m(doc.tax)) : ''}
      ${row(t('pos.total'), m(doc.total), 'grand')}
      ${!isQuote && paid ? row(t('pay.paid'), m(paid)) : ''}
      ${!isQuote && doc.credit ? row(t('pay.onAccount'), m(doc.credit)) : ''}
      ${!isQuote && doc.refunded ? row(t('receipt.refunded'), m(doc.refunded)) : ''}
    </table>
  </div>
  <div class="sign"><div>${t('a4.receivedBy')}</div><div>${t('a4.signature')}</div></div>
  <div class="foot">${settings.receipt_footer ? lines(settings.receipt_footer) + '<br>' : ''}${vendorLine(t)}</div>
  </body></html>`;
}

/** A4 purchase order for a supplier (no prices unless the user may see costs). */
export function poHtml(po, settings, t, lang) {
  const showCost = po.total != null;
  const m = (v) => formatMoney(v, settings);
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm; } body { font: 13px/1.5 Tahoma, "Segoe UI", Arial, sans-serif; color: #000; }
    h1 { font-size: 20px; margin: 0; } .muted { color: #555; } .head { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: start; } th { background: #eee; } .n { text-align: end; }
  </style></head><body>
  <div class="head"><div><h1>${esc(settings.business_name)}</h1><div class="muted">${esc(settings.address)} ${settings.phone ? ltr(settings.phone) : ''}</div></div>
  <div><b>${t('po.po')} #${po.po_no}</b><div class="muted">${ltr(po.created_at.slice(0, 10))}</div></div></div>
  <p>${t('purchases.supplier')}: <b>${esc(po.supplier_name || '—')}</b> ${po.supplier_phone ? ltr(po.supplier_phone) : ''}</p>
  <table><thead><tr><th>#</th><th>${t('receipt.item')}</th><th class="n">${t('pos.qty')}</th>${showCost ? `<th class="n">${t('purchases.unitCost')}</th><th class="n">${t('common.total')}</th>` : ''}</tr></thead><tbody>
  ${po.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}${i.unit_name ? ` (${esc(i.unit_name)})` : ''}</td><td class="n">${formatQty(i.qty)}</td>${showCost ? `<td class="n">${m(i.unit_cost)}</td><td class="n">${m(Math.round(i.qty * i.unit_cost))}</td>` : ''}</tr>`).join('')}
  </tbody></table>
  ${showCost ? `<p class="n"><b>${t('common.total')}: ${m(po.total)}</b></p>` : ''}
  ${po.notes ? `<p>${esc(po.notes)}</p>` : ''}
  <p class="muted" style="margin-top:30px">${t('collect.signature')}: ....................</p>
  </body></html>`;
}

/** A4 installment schedule: the customer signs it at the sale and keeps a copy. */
export function installmentsHtml(plan, settings, t, lang) {
  const m = (v) => formatMoney(v, settings);
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm; } body { font: 13px/1.5 Tahoma, "Segoe UI", Arial, sans-serif; color: #000; }
    h1 { font-size: 20px; margin: 0; } .muted { color: #555; } .head { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #bbb; padding: 6px 8px; text-align: start; } th { background: #eee; } .n { text-align: end; }
    .sum { display: flex; gap: 24px; flex-wrap: wrap; margin: 10px 0; } .sign { display: flex; justify-content: space-between; margin-top: 40px; }
  </style></head><body>
  <div class="head"><div><h1>${esc(settings.business_name)}</h1><div class="muted">${esc(settings.address)} ${settings.phone ? ltr(settings.phone) : ''}</div></div>
  <div><b>${t('inst.schedule')}</b><div class="muted">${t('receipt.invoice')} #${plan.invoice_no} · ${ltr(String(plan.created_at).slice(0, 10))}</div></div></div>
  <p>${t('pos.customer')}: <b>${esc(plan.customer_name)}</b> ${plan.customer_phone ? ltr(plan.customer_phone) : ''}</p>
  <div class="sum"><span>${t('common.total')}: <b>${m(plan.total)}</b></span><span>${t('inst.downPayment')}: <b>${m(plan.down_payment)}</b></span>
    <span>${t('inst.financed')}: <b>${m(plan.credit)}</b></span><span>${t('inst.count')}: <b>${plan.items.length}</b></span></div>
  <table><thead><tr><th>#</th><th>${t('inst.dueDate')}</th><th class="n">${t('inst.amount')}</th><th class="n">${t('inst.paid')}</th><th class="n">${t('inst.left')}</th><th>${t('inst.customerSign')}</th></tr></thead><tbody>
  ${plan.items.map((i) => `<tr><td>${i.seq}</td><td>${ltr(i.due_date)}</td><td class="n">${m(i.amount)}</td><td class="n">${i.paid ? m(i.paid) : ''}</td><td class="n">${i.open ? m(i.open) : '✓'}</td><td></td></tr>`).join('')}
  </tbody></table>
  ${plan.notes ? `<p>${esc(plan.notes)}</p>` : ''}
  <div class="sign"><span>${t('inst.customerSign')}: ....................</span><span>${t('collect.signature')}: ....................</span></div>
  </body></html>`;
}

/** A4 payroll sheet for a month: one line per employee with what makes up the net pay. */
export function payslipHtml(data, settings, t, lang) {
  const m = (v) => (v ? formatMoney(v, settings) : '');
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 12mm; } body { font: 12px/1.5 Tahoma, "Segoe UI", Arial, sans-serif; color: #000; }
    h1 { font-size: 18px; margin: 0; } .muted { color: #555; } .head { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #bbb; padding: 5px 7px; text-align: start; } th { background: #eee; } .n { text-align: end; }
  </style></head><body>
  <div class="head"><div><h1>${esc(settings.business_name)}</h1></div><div><b>${t('emp.tab.payroll')} — ${ltr(data.month)}</b></div></div>
  <table><thead><tr><th>${t('common.name')}</th><th class="n">${t('emp.days')}</th><th class="n">${t('emp.base')}</th><th class="n">${t('emp.absence')}</th><th class="n">${t('emp.kind.bonus')}</th>
    <th class="n">${t('emp.kind.deduction')}</th><th class="n">${t('emp.kind.advance')}</th><th class="n">${t('emp.net')}</th><th>${t('emp.signature')}</th></tr></thead><tbody>
  ${data.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${r.days}${r.absent ? ` / ✕${r.absent}` : ''}</td><td class="n">${m(r.base)}</td><td class="n">${m(r.absence)}</td><td class="n">${m(r.bonuses)}</td>
    <td class="n">${m(r.deductions)}</td><td class="n">${m(r.advances)}</td><td class="n"><b>${formatMoney(r.net, settings)}</b></td><td></td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="7"><b>${t('common.total')}</b></td><td class="n"><b>${formatMoney(data.total, settings)}</b></td><td></td></tr></tfoot></table>
  </body></html>`;
}

/** Thermal slip handed over with a sold gift card: code (with barcode), value, expiry. */
export function giftCardHtml(card, settings, t, lang) {
  const m = (v) => formatMoney(v, settings);
  return page(settings, lang, `${header(settings, t)}
  <hr><div class="c"><b>🎁 ${t('gift.card')}</b></div><hr>
  <div class="c">${barcodeSvg(card.code, { height: 42 })}</div>
  <div class="c" style="font: bold 17px monospace; letter-spacing: 1px" dir="ltr">${esc(card.code.replace(/(\d{4})(?=\d)/g, '$1 '))}</div>
  <table>
    <tr class="big"><td>${t('gift.balance')}</td><td class="n">${m(card.balance)}</td></tr>
    ${card.expires ? `<tr><td>${t('gift.expires')}</td><td class="n">${ltr(card.expires)}</td></tr>` : ''}
    <tr><td>${t('receipt.date')}</td><td class="n">${ltr(String(card.created_at).slice(0, 10))}</td></tr>
  </table>
  <hr><div class="c muted">${t('gift.slipNote')}</div>`);
}

/**
 * Any report from the Reports page as an A4 document (landscape when wide): letterhead
 * with logo, title and period, the table with a totals row, summary lines and a footer.
 * `fmt(column, value, row)` formats a cell exactly like the screen does.
 */
export function reportHtml(report, labels, settings, lang, fmt) {
  const wide = report.columns.length > 6;
  const numeric = (c) => ['money', 'qty', 'int', 'pct'].includes(c.type);
  const head = report.columns.map((c) => `<th class="${numeric(c) ? 'n' : ''}">${esc(labels.columns[c.key])}</th>`).join('');
  const body = report.rows.map((row) => `<tr class="${row.kind === 'sum' ? 'sum' : ''}">${report.columns.map((c) => {
    const v = fmt(c, row[c.key], row);
    return `<td class="${numeric(c) ? 'n' : ''}${c.type === 'money' && row[c.key] < 0 ? ' neg' : ''}">${numeric(c) || c.type?.startsWith('date') ? ltr(v) : esc(v)}</td>`;
  }).join('')}</tr>`).join('');
  const hasTotals = report.columns.some((c) => c.total) && report.rows.length;
  const foot = hasTotals ? `<tfoot><tr>${report.columns.map((c, i) => `<td class="${c.total ? 'n' : ''}">${i === 0 ? esc(labels.total) : c.total ? ltr(fmt(c, report.totals[c.key], null)) : ''}</td>`).join('')}</tr></tfoot>` : '';
  const now = new Date();
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
    @page { size: A4 ${wide ? 'landscape' : 'portrait'}; margin: 12mm 10mm; }
    * { box-sizing: border-box; } body { margin: 0; font: 11.5px/1.45 Tahoma, "Segoe UI", Arial, sans-serif; color: #0f172a; }
    .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0a43c9; padding-bottom: 8px; margin-bottom: 10px; gap: 12px; }
    .head img { max-height: 54px; max-width: 160px; } .biz { font-size: 17px; font-weight: bold; color: #0a43c9; }
    .title { text-align: end; } .title h1 { margin: 0; font-size: 18px; } .muted { color: #64748b; }
    table { width: 100%; border-collapse: collapse; } thead { display: table-header-group; } tr { page-break-inside: avoid; }
    th { background: #0a43c9; color: #fff; padding: 6px 7px; text-align: start; font-weight: bold; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td { padding: 5px 7px; border-bottom: 1px solid #e5e7eb; text-align: start; } tbody tr:nth-child(even) td { background: #f8fafc; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .n { text-align: end; white-space: nowrap; } .neg { color: #b91c1c; } tr.sum td { font-weight: bold; border-top: 1px solid #94a3b8; }
    tfoot td { font-weight: bold; background: #eef4ff; border-top: 2px solid #0a43c9; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .summary { margin-top: 10px; font-weight: bold; } .foot { margin-top: 14px; display: flex; justify-content: space-between; color: #94a3b8; font-size: 10px; }
  </style></head><body>
  <div class="head">
    <div>${settings.business_logo ? `<img src="${esc(settings.business_logo)}" alt="">` : ''}<div class="biz">${esc(settings.business_name)}</div>
      <div class="muted">${esc(settings.address || '')} ${settings.phone ? ltr(settings.phone) : ''}</div></div>
    <div class="title"><h1>${esc(labels.title)}</h1><div class="muted">${esc(labels.period)}</div></div>
  </div>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>
  ${report.rows.length ? '' : '<p class="muted">—</p>'}
  ${(labels.summary || []).map((x) => `<div class="summary">${esc(x)}</div>`).join('')}
  <div class="foot"><span>${esc(labels.currencyNote || '')}</span><span>InnoForge POS — ${ltr(now.toLocaleString('en-GB'))}</span></div>
  </body></html>`;
}
