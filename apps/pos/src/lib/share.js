// WhatsApp messages for invoices, quotations and statements. Opens WhatsApp (app or web)
// through wa.me with the text ready; PDFs are saved separately to attach.
import { formatMoney, formatQty } from './money.js';

/** Egyptian mobiles (01xxxxxxxxx) get the 20 country code; other numbers are used as typed. */
export function waPhone(phone) {
  let d = String(phone || '').replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = `2${d}`;
  return d;
}

export function openWhatsApp(phone, text) {
  const to = waPhone(phone);
  window.open(`https://wa.me/${to}?text=${encodeURIComponent(text)}`, '_blank');
}

export function invoiceText(order, settings, t) {
  const m = (v) => formatMoney(v, settings);
  const lines = order.items.map((i) => `• ${i.name} × ${formatQty(i.qty)} = ${m(i.line_total)}`);
  return [
    `*${settings.business_name}*`,
    `${t('receipt.invoice')} ${order.invoice_no} — ${String(order.completed_at || '').slice(0, 10)}`,
    '',
    ...lines,
    '',
    order.discount ? `${t('pos.discount')}: ${m(order.discount)}` : null,
    order.tax ? `${t('pos.tax')}: ${m(order.tax)}` : null,
    `*${t('pos.total')}: ${m(order.total)}*`,
    order.credit ? `${t('pay.onAccount')}: ${m(order.credit)}` : null,
    order.customer_balance != null ? `${t('customers.currentBalance')}: ${m(order.customer_balance)}` : null,
    '',
    settings.receipt_footer || null,
  ].filter((x) => x !== null).join('\n');
}

export function quoteText(q, settings, t) {
  const m = (v) => formatMoney(v, settings);
  return [
    `*${settings.business_name}*`,
    `${t('a4.quoteNo')} ${q.quote_no}${q.valid_until ? ` — ${t('a4.validUntil')} ${q.valid_until}` : ''}`,
    '',
    ...q.items.map((i) => `• ${i.name} × ${formatQty(i.qty)} = ${m(i.line_total)}`),
    '',
    `*${t('pos.total')}: ${m(q.total)}*`,
  ].join('\n');
}

export function statementText(data, settings, t) {
  const m = (v) => formatMoney(v, settings);
  const last = data.rows.slice(-5).map((r) => `• ${String(r.created_at).slice(0, 10)} — ${r.debit ? `+${m(r.debit)}` : `−${m(r.credit)}`}`);
  return [
    `*${settings.business_name}*`,
    `${t('purchases.statement')} — ${data.customer.name}`,
    '',
    ...last,
    '',
    `*${t('customers.balance')}: ${m(data.balance)}*`,
    settings.phone ? `📞 ${settings.phone}` : null,
  ].filter((x) => x !== null).join('\n');
}
