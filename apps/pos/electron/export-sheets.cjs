'use strict';
// The sheets behind "Export to Excel" (products, customers, suppliers, invoices, summary).
// Runs on the computer that holds the data: in the main process, or on the main computer
// for a connected device (lan-server /api/export).
const excel = require('./excel.cjs');
const { PosError } = require('./services/index.cjs');

function exportSheets(s, kind, params = {}) {
  const t = (ar, en) => `${ar} | ${en}`;
  if (kind === 'products') {
    s.requirePerm('backup');
    const showCost = s.can('view_cost');
    return [{
      name: 'products',
      columns: [
        { header: excel.COLUMNS.products.name[0], key: 'name', width: 32 },
        { header: excel.COLUMNS.products.barcode[0], key: 'barcode', width: 18 },
        { header: excel.COLUMNS.products.category[0], key: 'category_name', width: 18 },
        { header: excel.COLUMNS.products.price[0], key: 'price', money: true },
        ...(showCost ? [{ header: excel.COLUMNS.products.cost[0], key: 'cost', money: true }] : []),
        { header: excel.COLUMNS.products.stock[0], key: 'stock' },
        { header: excel.COLUMNS.products.min_stock[0], key: 'min_stock' },
        { header: excel.COLUMNS.products.unit[0], key: 'unit' },
        { header: excel.COLUMNS.products.track_stock[0], key: 'track' },
        { header: excel.COLUMNS.products.author[0], key: 'author' },
        { header: excel.COLUMNS.products.publisher[0], key: 'publisher' },
      ],
      rows: s.products.list({ includeInactive: true }).map((p) => ({ ...p, track: p.track_stock ? 'نعم' : 'لا' })),
    }];
  }
  if (kind === 'customers' || kind === 'suppliers') {
    s.requirePerm('backup');
    const list = kind === 'customers' ? s.customers.list({ includeInactive: true }) : s.suppliers.list({ includeInactive: true });
    const cols = excel.COLUMNS[kind];
    return [{
      name: kind,
      columns: [
        { header: cols.name[0], key: 'name', width: 28 },
        { header: cols.phone[0], key: 'phone', width: 16 },
        { header: cols.address[0], key: 'address', width: 24 },
        ...(kind === 'customers' ? [{ header: cols.tax_number[0], key: 'tax_number', width: 18 }, { header: cols.credit_limit[0], key: 'credit_limit', money: true }] : []),
        // Exported as the opening balance so the file can be re-imported elsewhere as-is.
        { header: cols.opening_balance[0], key: 'balance', money: true, width: 20 },
        { header: cols.notes[0], key: 'notes', width: 24 },
      ],
      rows: list,
    }];
  }
  if (kind === 'invoices') {
    s.requirePerm('reports');
    const orders = s.orders.list({ from: params.from, to: params.to, limit: 100000 });
    const items = orders.flatMap((o) => s.orders.get(o.id).items.map((i) => ({ ...i, invoice_no: o.invoice_no, completed_at: o.completed_at })));
    return [
      {
        name: 'invoices',
        columns: [
          { header: t('رقم الفاتورة', 'Invoice'), key: 'invoice_no' }, { header: t('التاريخ', 'Date'), key: 'completed_at', width: 20 },
          { header: t('العميل', 'Customer'), key: 'customer_display', width: 24 }, { header: t('الكاشير', 'Cashier'), key: 'user_name' },
          { header: t('النوع', 'Type'), key: 'order_type' }, { header: t('المجموع', 'Subtotal'), key: 'subtotal', money: true },
          { header: t('الخصم', 'Discount'), key: 'discount', money: true }, { header: t('الضريبة', 'Tax'), key: 'tax', money: true },
          { header: t('الخدمة', 'Service'), key: 'service', money: true }, { header: t('الإجمالي', 'Total'), key: 'total', money: true },
          { header: t('آجل', 'On account'), key: 'credit', money: true }, { header: t('مرتجع', 'Refunded'), key: 'refunded', money: true },
        ],
        rows: orders,
      },
      {
        name: 'items',
        columns: [
          { header: t('رقم الفاتورة', 'Invoice'), key: 'invoice_no' }, { header: t('التاريخ', 'Date'), key: 'completed_at', width: 20 },
          { header: t('الصنف', 'Item'), key: 'name', width: 30 }, { header: t('الكمية', 'Qty'), key: 'qty' },
          { header: t('السعر', 'Price'), key: 'unit_price', money: true }, { header: t('الخصم', 'Discount'), key: 'discount', money: true },
          { header: t('الإجمالي', 'Total'), key: 'line_total', money: true }, { header: t('مرتجع', 'Returned'), key: 'returned_qty' },
        ],
        rows: items,
      },
    ];
  }
  if (kind === 'report') {
    const r = s.reports.summary({ from: params.from, to: params.to });
    const money = (key, header) => ({ header, key, money: true });
    const totals = Object.entries(r.totals).filter(([, v]) => v != null).map(([k, v]) => ({ k, v }));
    return [
      { name: 'summary', columns: [{ header: t('البند', 'Item'), key: 'k', width: 24 }, { header: t('القيمة', 'Value'), key: 'v', width: 18 }], rows: totals.map((x) => ({ ...x, v: ['orders'].includes(x.k) ? x.v : x.v / 10 ** (s.settings.get().decimals ?? 2) })) },
      { name: 'by day', columns: [{ header: t('اليوم', 'Day'), key: 'day' }, { header: t('الفواتير', 'Invoices'), key: 'orders' }, money('total', t('الإجمالي', 'Total'))], rows: r.byDay },
      { name: 'top products', columns: [{ header: t('الصنف', 'Item'), key: 'name', width: 30 }, { header: t('الكمية', 'Qty'), key: 'qty' }, money('total', t('الإجمالي', 'Total'))], rows: r.topProducts },
      { name: 'by method', columns: [{ header: t('الطريقة', 'Method'), key: 'method' }, money('amount', t('المبلغ', 'Amount'))], rows: r.byMethod },
      { name: 'by category', columns: [{ header: t('التصنيف', 'Category'), key: 'name' }, money('total', t('الإجمالي', 'Total'))], rows: r.byCategory },
      { name: 'by cashier', columns: [{ header: t('الكاشير', 'Cashier'), key: 'name' }, { header: t('الفواتير', 'Invoices'), key: 'orders' }, money('total', t('الإجمالي', 'Total'))], rows: r.byCashier },
      { name: 'commissions', columns: [{ header: t('الاسم', 'Name'), key: 'name' }, money('net', t('صافي المبيعات', 'Net sales')), { header: '%', key: 'rate' }, money('commission', t('العمولة', 'Commission'))], rows: s.commissions.report(params) },
    ];
  }
  throw new PosError('UNKNOWN_METHOD', kind);
}

module.exports = { exportSheets };
