// Builds self-contained HTML documents for the thermal printer.
import { formatMoney, formatQty } from './money.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Numbers, phones and dates inside RTL text must stay left-to-right.
const ltr = (s) => `<span dir="ltr">${esc(s)}</span>`;

function page(settings, lang, body) {
  const width = Number(settings.paper_width) || 80;
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<style>
  @page { size: ${width}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 3mm; width: ${width}mm; font: 12px/1.35 Tahoma, "Segoe UI", Arial, sans-serif; color: #000; }
  h1 { font-size: 16px; margin: 0 0 2px; text-align: center; }
  .c { text-align: center; } .muted { font-size: 11px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 2px 0; vertical-align: top; text-align: start; }
  .n { text-align: end; white-space: nowrap; }
  .big td { font-size: 15px; font-weight: bold; }
  .note { font-size: 11px; padding-inline-start: 8px; }
  .kitchen td { font-size: 16px; font-weight: bold; }
</style></head><body>${body}</body></html>`;
}

function header(settings, t) {
  return `<h1>${esc(settings.business_name)}</h1>
  ${settings.address ? `<div class="c muted">${esc(settings.address)}</div>` : ''}
  ${settings.phone ? `<div class="c muted">${ltr(settings.phone)}</div>` : ''}
  ${settings.tax_number ? `<div class="c muted">${t('receipt.taxNumber')}: ${ltr(settings.tax_number)}</div>` : ''}
  ${settings.receipt_header ? `<div class="c">${esc(settings.receipt_header)}</div>` : ''}`;
}

export function receiptHtml(order, settings, t, lang) {
  const m = (v) => formatMoney(v, settings);
  const rows = order.items.map((i) => `
    <tr><td>${esc(i.name)}</td><td class="n">${formatQty(i.qty)}</td><td class="n">${m(i.line_total)}</td></tr>
    ${i.qty !== 1 ? `<tr><td class="note" colspan="3">${formatQty(i.qty)} × ${m(i.unit_price)}${i.discount ? ` − ${m(i.discount)}` : ''}</td></tr>` : ''}
    ${i.note ? `<tr><td class="note" colspan="3">${esc(i.note)}</td></tr>` : ''}`).join('');
  const line = (label, v, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="n">${v}</td></tr>`;
  const changeRow = order.change_due ? line(t('pay.change'), m(order.change_due)) : '';
  const pays = order.payments.map((p) => line(t(`pay.${p.method}`), m(p.amount + (p.method === 'cash' ? order.change_due : 0)))).join('');
  const customer = [order.customer_name, order.customer_phone, order.customer_address].filter(Boolean).map(esc).join(' — ');

  return page(settings, lang, `${header(settings, t)}
  <hr>
  <table>
    ${line(t('receipt.invoice'), `<b>${order.invoice_no ?? '—'}</b>`)}
    ${line(t('receipt.date'), ltr(order.completed_at || order.created_at))}
    ${line(t('receipt.cashier'), esc(order.user_name))}
    ${order.order_type !== 'sale' ? line(t('orders.type'), t(`order.${order.order_type}`) + (order.table_name ? ` — ${t('pos.table')} ${esc(order.table_name)}` : '')) : ''}
  </table>
  ${customer ? `<div class="muted">${t('pos.customer')}: ${customer}</div>` : ''}
  <hr>
  <table>
    <tr><th>${t('receipt.item')}</th><th class="n">${t('receipt.qty')}</th><th class="n">${t('receipt.amount')}</th></tr>
    ${rows}
  </table>
  <hr>
  <table>
    ${line(t('pos.subtotal'), m(order.subtotal))}
    ${order.discount ? line(t('pos.discount'), '− ' + m(order.discount)) : ''}
    ${order.service ? line(t('pos.service'), m(order.service)) : ''}
    ${order.tax ? line(settings.prices_include_tax ? `${t('pos.tax')} (${t('receipt.taxIncluded')})` : t('pos.tax'), m(order.tax)) : ''}
    ${line(t('pos.total'), m(order.total), 'big')}
    ${pays}
    ${changeRow}
    ${order.refunded ? line(t('receipt.refunded'), m(order.refunded)) : ''}
  </table>
  ${order.note ? `<hr><div>${esc(order.note)}</div>` : ''}
  <hr>
  ${settings.receipt_footer ? `<div class="c">${esc(settings.receipt_footer)}</div>` : ''}
  <div class="c muted">InnoForge POS</div>`);
}

export function kitchenHtml(order, items, settings, t, lang) {
  const where = order.order_type === 'dine_in' && order.table_name ? `${t('pos.table')} ${esc(order.table_name)}` : t(`order.${order.order_type}`);
  return page(settings, lang, `<h1>${t('receipt.kitchen')}</h1>
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
  </table><hr><table>
    ${line(t('shift.expectedCash'), m(expectedCash), 'big')}
    ${shift.counted_cash != null ? line(t('shift.countedCash'), m(shift.counted_cash)) : ''}
    ${shift.counted_cash != null ? line(t('shift.difference'), m(shift.counted_cash - expectedCash)) : ''}
  </table>
  ${shift.notes ? `<hr><div>${esc(shift.notes)}</div>` : ''}`);
}
