// The receipt designer: switched-off parts disappear, required parts and the vendor line stay.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (f) => import(pathToFileURL(path.join(root, f)).href);
const { receiptHtml, a4Html } = await load('src/lib/receipt.js');
const { receiptLayout, layoutSetting, DEFAULT_LAYOUT } = await load('src/lib/receipt-layout.js');
const ar = (await load('src/i18n/ar.js')).default;

const t = (k) => ar[k] ?? k;
const settings = (extra = {}) => ({
  business_name: 'محل التجربة', address: 'شارع التحرير', phone: '0100', tax_number: '123456789', currency_symbol: 'ج.م', decimals: 2,
  receipt_header: 'عرض الأسبوع', receipt_footer: 'شكراً\nالاستبدال خلال 14 يوم', business_logo: 'data:image/png;base64,AAAA', paper_width: 80, ...extra,
});
const order = {
  invoice_no: 77, completed_at: '2026-10-12 10:00:00', user_name: 'سارة', order_type: 'delivery', zone_name: 'المعادي', driver_name: 'كريم',
  customer_name: 'منى', customer_phone: '0111', customer: { points: 50 },
  items: [{ name: 'شاي', qty: 2, unit_price: 500, discount: 0, line_total: 1000, modifiers: [{ name: 'نعناع' }], note: 'سكر خفيف', promo_name: 'عرض', promo_discount: 100 }],
  payments: [{ method: 'cash', amount: 1000 }], subtotal: 1000, discount: 0, service: 0, tax: 0, total: 1000, change_due: 500, refunded: 0,
  customer_balance: 0, points_earned: 3, note: 'ملاحظة الطلب',
};
const withLayout = (show, more = {}) => settings({ receipt_layout: JSON.stringify({ show, ...more }) });

test('default layout keeps the receipt as it was', () => {
  const html = receiptHtml(order, settings(), t, 'ar');
  for (const s of ['شارع التحرير', 'عرض الأسبوع', 'سارة', 'منى', 'المعادي', '2 × ', 'نعناع', 'سكر خفيف', 'ملاحظة الطلب', 'شكراً<br>الاستبدال']) assert.ok(html.includes(s), s);
  assert.ok(!html.includes('class="logo"'), 'logo is off by default on thermal receipts');
  assert.ok(html.includes('15.00'), 'cash line includes the change by default');
});

test('switched-off parts disappear; required parts stay', () => {
  const off = Object.fromEntries(Object.keys(DEFAULT_LAYOUT.show).map((k) => [k, false]));
  const html = receiptHtml(order, withLayout(off), t, 'ar');
  for (const s of ['شارع التحرير', 'عرض الأسبوع', 'سارة', 'منى', 'المعادي', '2 × ', 'نعناع', 'سكر خفيف', 'ملاحظة الطلب', 'شكراً', t('pay.change'), t('loyalty.earned')]) assert.ok(!html.includes(s), s);
  for (const s of ['محل التجربة', '123456789', '<b>77</b>', 'شاي', '10.00']) assert.ok(html.includes(s), s);
});

test('the vendor line with the support number is always printed', () => {
  const off = Object.fromEntries(Object.keys(DEFAULT_LAYOUT.show).map((k) => [k, false]));
  for (const s of [settings(), withLayout(off)]) {
    const html = receiptHtml(order, s, t, 'ar');
    assert.ok(html.includes('InnoForge POS') && html.includes('+201011600023') && html.includes('خدمة العملاء'));
  }
  assert.ok(a4Html({ ...order, items: order.items }, 'invoice', settings(), t, 'ar').includes('+201011600023'));
});

test('logo, invoice barcode, link QR and font size', () => {
  const html = receiptHtml(order, withLayout({ logo: true, invoiceBarcode: true, qr: true }, { qrUrl: 'https://example.com/menu', qrLabel: 'المنيو', font: 14, logoWidth: 60 }), t, 'ar');
  assert.ok(html.includes('class="logo"') && html.includes('width:60%'));
  assert.ok(html.includes('المنيو'));
  assert.ok((html.match(/<svg/g) || []).length >= 2, 'barcode and QR');
  assert.ok(html.includes('font: 14px/'));
});

test('a broken or out-of-range layout falls back to the defaults', () => {
  assert.deepEqual(receiptLayout({ receipt_layout: '{oops' }), receiptLayout({}));
  const l = receiptLayout({ receipt_layout: JSON.stringify({ font: 99, logoWidth: 7, show: { cashier: 'no', phone: false } }) });
  assert.equal(l.font, DEFAULT_LAYOUT.font);
  assert.equal(l.logoWidth, DEFAULT_LAYOUT.logoWidth);
  assert.equal(l.show.cashier, true);
  assert.equal(l.show.phone, false);
  assert.deepEqual(JSON.parse(layoutSetting({ show: { phone: false } })).show.phone, false);
});
