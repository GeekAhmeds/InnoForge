'use strict';
// Every report the Reports page offers. Each one returns the same shape so one viewer,
// one Excel writer and one PDF layout serve them all:
//   { columns: [{ key, label, type, total? }], rows: [...], summary?: [{ label, value, type }] }
// `label` is an i18n key (the renderer translates it). Types: text | money | qty | int | pct | date | datetime.
// Money is in minor units like everywhere else.

const RANGE = "o.status = 'completed' AND o.completed_at >= ? AND o.completed_at < date(?, '+1 day')";
const IN_RANGE = (col) => `${col} >= ? AND ${col} < date(?, '+1 day')`;
// What a sold line is worth / cost after its returns.
const NET_LINE = 'i.line_total * (i.qty - i.returned_qty) / i.qty';
const NET_COST = 'i.unit_cost * (i.qty - i.returned_qty)';

const col = (key, label, type = 'text', total = ['money', 'qty', 'int'].includes(type)) => ({ key, label, type, total });

/**
 * @param ctx { db, can, has, CUSTOMER_BALANCE, SUPPLIER_BALANCE, aging, accountBalance }
 */
function buildCatalog(ctx) {
  const { db, can, has, CUSTOMER_BALANCE, SUPPLIER_BALANCE } = ctx;
  const all = (sql, ...p) => db.prepare(sql).all(...p).map((r) => ({ ...r }));
  const one = (sql, ...p) => ({ ...db.prepare(sql).get(...p) });
  const cost = () => can('view_cost');
  const margin = (r) => { r.margin = r.sales ? Math.round((r.profit / r.sales) * 1000) / 10 : 0; return r; };
  // Drop cost/profit columns for users who may not see cost prices.
  // Stock in the product's largest whole pack, e.g. "10 كرتونة + 5" (stock itself stays in base units).
  const withPacks = (rows) => {
    const packs = new Map(all('SELECT product_id, name, factor FROM product_units WHERE factor > 1 AND factor = CAST(factor AS INTEGER) ORDER BY factor')
      .map((u) => [u.product_id, u])); // the largest wins (ordered ascending)
    return rows.map(({ id, ...r }) => {
      const u = packs.get(id);
      const q = Math.abs(r.stock || 0);
      if (!u || q < u.factor) return { ...r, packs: '' };
      const n = Math.floor(q / u.factor);
      const rest = Math.round((q - n * u.factor) * 1000) / 1000;
      return { ...r, packs: `${r.stock < 0 ? '-' : ''}${n} ${u.name}${rest ? ` + ${rest}` : ''}` };
    });
  };
  // Returns without an invoice (no sale line to net against): what they refunded and what the goods cost.
  const blind = (f, t) => one(`SELECT COALESCE(SUM(bi.amount), 0) AS amount, COALESCE(SUM(bi.unit_cost * bi.qty), 0) AS cost
    FROM blind_return_items bi JOIN returns r ON r.id = bi.return_id WHERE ${IN_RANGE('r.created_at')}`, f, t);
  const costCols = (cols) => (cost() ? cols : cols.filter((c) => !['cost', 'profit', 'margin', 'value_cost'].includes(c.key)));

  return {
    // ---------------- sales ----------------
    sales_by_day: {
      group: 'sales',
      run: ({ f, t }) => {
        const rows = all(`SELECT date(o.completed_at) AS day, COUNT(*) AS invoices, SUM(o.subtotal) AS gross, SUM(o.discount) AS discount,
            SUM(o.tax) AS tax, SUM(o.service) AS service, SUM(o.total) AS total, SUM(o.credit) AS credit
          FROM orders o WHERE ${RANGE} GROUP BY day ORDER BY day`, f, t);
        const refunds = new Map(all(`SELECT date(created_at) AS day, SUM(amount) AS r FROM returns WHERE ${IN_RANGE('created_at')} GROUP BY day`, f, t).map((x) => [x.day, x.r]));
        const prof = new Map(all(`SELECT date(o.completed_at) AS day, SUM(${NET_LINE}) - SUM(${NET_COST}) AS p FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${RANGE} GROUP BY day`, f, t).map((x) => [x.day, Math.round(x.p)]));
        for (const b of all(`SELECT date(r.created_at) AS day, SUM(bi.amount - bi.unit_cost * bi.qty) AS p FROM blind_return_items bi JOIN returns r ON r.id = bi.return_id WHERE ${IN_RANGE('r.created_at')} GROUP BY day`, f, t)) {
          prof.set(b.day, (prof.get(b.day) || 0) - Math.round(b.p));
        }
        for (const r of rows) { r.refunds = refunds.get(r.day) || 0; r.net = r.total - r.refunds; r.profit = prof.get(r.day) || 0; }
        return {
          columns: costCols([col('day', 'rep.col.date', 'date'), col('invoices', 'rep.col.invoices', 'int'), col('gross', 'rep.col.gross', 'money'), col('discount', 'rep.col.discount', 'money'),
            col('tax', 'rep.col.tax', 'money'), col('total', 'rep.col.total', 'money'), col('refunds', 'rep.col.refunds', 'money'), col('net', 'rep.col.net', 'money'),
            col('credit', 'rep.col.credit', 'money'), col('profit', 'rep.col.profit', 'money')]),
          rows,
        };
      },
    },
    invoices: {
      group: 'sales',
      run: ({ f, t }) => ({
        columns: [col('invoice_no', 'rep.col.invoice', 'int', false), col('completed_at', 'rep.col.datetime', 'datetime'), col('customer', 'rep.col.customer'), col('cashier', 'rep.col.cashier'),
          col('order_type', 'rep.col.type', 'type'), col('total', 'rep.col.total', 'money'), col('paid_now', 'rep.col.paid', 'money'), col('credit', 'rep.col.credit', 'money'), col('refunded', 'rep.col.refunds', 'money')],
        rows: all(`SELECT o.invoice_no, o.completed_at, COALESCE(c.name, o.customer_name, '') AS customer, u.name AS cashier, o.order_type, o.total,
            o.total - o.credit AS paid_now, o.credit, o.refunded
          FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN customers c ON c.id = o.customer_id WHERE ${RANGE} ORDER BY o.invoice_no`, f, t),
      }),
    },
    sales_by_product: {
      group: 'sales',
      run: ({ f, t }) => ({
        columns: costCols([col('name', 'rep.col.product'), col('category', 'rep.col.category'), col('qty', 'rep.col.qty', 'qty'), col('sales', 'rep.col.sales', 'money'),
          col('cost', 'rep.col.cost', 'money'), col('profit', 'rep.col.profit', 'money'), col('margin', 'rep.col.margin', 'pct', false)]),
        rows: all(`SELECT i.name, COALESCE(cat.name, '') AS category, SUM((i.qty - i.returned_qty) * i.unit_factor) AS qty, ROUND(SUM(${NET_LINE})) AS sales,
            ROUND(SUM(${NET_COST})) AS cost, ROUND(SUM(${NET_LINE}) - SUM(${NET_COST})) AS profit
          FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN products p ON p.id = i.product_id LEFT JOIN categories cat ON cat.id = p.category_id
          WHERE ${RANGE} GROUP BY COALESCE(i.product_id, i.name) ORDER BY sales DESC`, f, t).map(margin),
      }),
    },
    // Products with variants summed up per model (all sizes / colours of a T-shirt together).
    sales_by_model: {
      group: 'sales',
      run: ({ f, t }) => ({
        columns: costCols([col('name', 'rep.col.product'), col('variants', 'rep.col.variants', 'int', false), col('qty', 'rep.col.qty', 'qty'), col('sales', 'rep.col.sales', 'money'),
          col('cost', 'rep.col.cost', 'money'), col('profit', 'rep.col.profit', 'money'), col('margin', 'rep.col.margin', 'pct', false), col('stock', 'rep.col.stockNow', 'qty')]),
        rows: all(`SELECT m.name, COUNT(DISTINCT i.product_id) AS variants, SUM((i.qty - i.returned_qty) * i.unit_factor) AS qty, ROUND(SUM(${NET_LINE})) AS sales,
            ROUND(SUM(${NET_COST})) AS cost, ROUND(SUM(${NET_LINE}) - SUM(${NET_COST})) AS profit,
            (SELECT COALESCE(SUM(v.stock), 0) FROM products v WHERE v.parent_id = m.id AND v.track_stock = 1) AS stock
          FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id JOIN products m ON m.id = p.parent_id
          WHERE ${RANGE} GROUP BY m.id ORDER BY sales DESC`, f, t).map(margin),
      }),
    },
    sales_by_category: {
      group: 'sales',
      run: ({ f, t }) => ({
        columns: costCols([col('category', 'rep.col.category'), col('items', 'rep.col.items', 'int'), col('qty', 'rep.col.qty', 'qty'), col('sales', 'rep.col.sales', 'money'),
          col('profit', 'rep.col.profit', 'money'), col('margin', 'rep.col.margin', 'pct', false), col('share', 'rep.col.share', 'pct', false)]),
        rows: (() => {
          const rows = all(`SELECT COALESCE(cat.name, '—') AS category, COUNT(DISTINCT COALESCE(i.product_id, i.name)) AS items, SUM((i.qty - i.returned_qty) * i.unit_factor) AS qty,
              ROUND(SUM(${NET_LINE})) AS sales, ROUND(SUM(${NET_LINE}) - SUM(${NET_COST})) AS profit
            FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN products p ON p.id = i.product_id LEFT JOIN categories cat ON cat.id = p.category_id
            WHERE ${RANGE} GROUP BY cat.id ORDER BY sales DESC`, f, t).map(margin);
          const total = rows.reduce((s, r) => s + r.sales, 0);
          for (const r of rows) r.share = total ? Math.round((r.sales / total) * 1000) / 10 : 0;
          return rows;
        })(),
      }),
    },
    sales_by_cashier: {
      group: 'sales',
      run: ({ f, t }) => ({
        columns: [col('name', 'rep.col.cashier'), col('invoices', 'rep.col.invoices', 'int'), col('total', 'rep.col.total', 'money'), col('average', 'rep.col.average', 'money', false),
          col('discount', 'rep.col.discount', 'money'), col('refunds', 'rep.col.refunds', 'money')],
        rows: all(`SELECT u.name, COUNT(*) AS invoices, SUM(o.total) AS total, ROUND(AVG(o.total)) AS average, SUM(o.discount) AS discount,
            COALESCE((SELECT SUM(r.amount) FROM returns r WHERE r.user_id = u.id AND ${IN_RANGE('r.created_at')}), 0) AS refunds
          FROM orders o JOIN users u ON u.id = o.user_id WHERE ${RANGE} GROUP BY u.id ORDER BY total DESC`, f, t, f, t),
      }),
    },
    sales_by_customer: {
      group: 'sales',
      run: ({ f, t }) => ({
        columns: [col('name', 'rep.col.customer'), col('phone', 'rep.col.phone'), col('invoices', 'rep.col.invoices', 'int'), col('total', 'rep.col.total', 'money'),
          col('credit', 'rep.col.credit', 'money'), col('last', 'rep.col.lastPurchase', 'datetime')],
        rows: all(`SELECT c.name, c.phone, COUNT(*) AS invoices, SUM(o.total) AS total, SUM(o.credit) AS credit, MAX(o.completed_at) AS last
          FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${RANGE} GROUP BY c.id ORDER BY total DESC`, f, t),
      }),
    },
    sales_by_payment: {
      group: 'sales',
      run: ({ f, t }) => ({
        columns: [col('method', 'rep.col.method', 'method'), col('invoices', 'rep.col.invoices', 'int'), col('amount', 'rep.col.amount', 'money')],
        rows: [
          ...all(`SELECT p.method, COUNT(DISTINCT p.order_id) AS invoices, SUM(p.amount) AS amount FROM payments p JOIN orders o ON o.id = p.order_id WHERE ${RANGE} GROUP BY p.method ORDER BY amount DESC`, f, t),
          ...all(`SELECT 'credit' AS method, COUNT(*) AS invoices, SUM(o.credit) AS amount FROM orders o WHERE ${RANGE} AND o.credit > 0`, f, t).filter((r) => r.invoices),
        ],
      }),
    },
    sales_by_hour: {
      group: 'sales',
      run: ({ f, t }) => ({
        columns: [col('hour', 'rep.col.hour'), col('invoices', 'rep.col.invoices', 'int'), col('total', 'rep.col.total', 'money'), col('average', 'rep.col.average', 'money', false)],
        rows: all(`SELECT printf('%02d:00', CAST(strftime('%H', o.completed_at) AS INTEGER)) AS hour, COUNT(*) AS invoices, SUM(o.total) AS total, ROUND(AVG(o.total)) AS average
          FROM orders o WHERE ${RANGE} GROUP BY hour ORDER BY hour`, f, t),
      }),
    },
    sales_by_type: {
      group: 'sales', feature: 'restaurant',
      run: ({ f, t }) => ({
        columns: [col('order_type', 'rep.col.type', 'type'), col('invoices', 'rep.col.invoices', 'int'), col('total', 'rep.col.total', 'money'), col('average', 'rep.col.average', 'money', false)],
        rows: all(`SELECT o.order_type, COUNT(*) AS invoices, SUM(o.total) AS total, ROUND(AVG(o.total)) AS average FROM orders o WHERE ${RANGE} GROUP BY o.order_type ORDER BY total DESC`, f, t),
      }),
    },
    discounts: {
      group: 'sales',
      run: ({ f, t }) => ({
        columns: [col('invoice_no', 'rep.col.invoice', 'int', false), col('completed_at', 'rep.col.datetime', 'datetime'), col('cashier', 'rep.col.cashier'), col('customer', 'rep.col.customer'),
          col('subtotal', 'rep.col.gross', 'money'), col('discount', 'rep.col.discount', 'money'), col('coupon_discount', 'rep.col.coupon', 'money'), col('pct', 'rep.col.pct', 'pct', false)],
        rows: all(`SELECT o.invoice_no, o.completed_at, u.name AS cashier, COALESCE(c.name, '') AS customer, o.subtotal,
            o.discount + COALESCE((SELECT SUM(i.discount) FROM order_items i WHERE i.order_id = o.id), 0) AS discount, o.coupon_discount
          FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN customers c ON c.id = o.customer_id
          WHERE ${RANGE} AND (o.discount > 0 OR EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id AND i.discount > 0)) ORDER BY o.invoice_no`, f, t)
          .map((r) => ({ ...r, pct: r.subtotal ? Math.round((r.discount / r.subtotal) * 1000) / 10 : 0 })),
      }),
    },
    returns: {
      group: 'sales',
      run: ({ f, t }) => ({
        columns: [col('created_at', 'rep.col.datetime', 'datetime'), col('invoice_no', 'rep.col.invoice', 'int', false), col('cashier', 'rep.col.cashier'), col('customer', 'rep.col.customer'),
          col('method', 'rep.col.method', 'method'), col('amount', 'rep.col.amount', 'money'), col('reason', 'rep.col.reason')],
        // invoice_no is empty for a return without an invoice.
        rows: all(`SELECT r.created_at, o.invoice_no, u.name AS cashier, COALESCE(c.name, '') AS customer, r.method, r.amount, r.reason
          FROM returns r LEFT JOIN orders o ON o.id = r.order_id JOIN users u ON u.id = r.user_id LEFT JOIN customers c ON c.id = COALESCE(o.customer_id, r.customer_id)
          WHERE ${IN_RANGE('r.created_at')} ORDER BY r.created_at`, f, t),
      }),
    },
    tax: {
      group: 'sales',
      run: ({ f, t }) => ({
        columns: [col('day', 'rep.col.date', 'date'), col('invoices', 'rep.col.invoices', 'int'), col('taxable', 'rep.col.taxable', 'money'), col('tax', 'rep.col.tax', 'money'), col('total', 'rep.col.total', 'money')],
        rows: all(`SELECT date(o.completed_at) AS day, COUNT(*) AS invoices, SUM(o.total - o.tax) AS taxable, SUM(o.tax) AS tax, SUM(o.total) AS total
          FROM orders o WHERE ${RANGE} GROUP BY day ORDER BY day`, f, t),
      }),
    },

    // ---------------- profit ----------------
    profit_loss: {
      group: 'money', perm: 'view_cost', noRows: true,
      run: ({ f, t }) => {
        const s = one(`SELECT COALESCE(SUM(${NET_LINE}), 0) AS sales, COALESCE(SUM(${NET_COST}), 0) AS cogs FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${RANGE}`, f, t);
        const disc = one(`SELECT COALESCE(SUM(o.discount), 0) AS d FROM orders o WHERE ${RANGE}`, f, t).d;
        const exp = all(`SELECT category, SUM(amount) AS amount FROM expenses WHERE ${IN_RANGE('created_at')} GROUP BY category ORDER BY amount DESC`, f, t);
        const settle = one(`SELECT COALESCE(SUM(amount), 0) AS t FROM customer_payments WHERE method = 'discount' AND status = 'posted' AND ${IN_RANGE('created_at')}`, f, t).t;
        const rebates = one(`SELECT COALESCE(SUM(amount), 0) AS t FROM supplier_payments WHERE method = 'rebate' AND ${IN_RANGE('created_at')}`, f, t).t;
        const b = blind(f, t);
        const sales = Math.round(s.sales - disc - b.amount);
        const cogs = s.cogs - b.cost;
        const gross = Math.round(sales - cogs);
        const expenses = exp.reduce((a, r) => a + r.amount, 0);
        const rows = [
          { item: 'rep.pl.sales', amount: sales, kind: 'in' },
          { item: 'rep.pl.cogs', amount: -Math.round(cogs), kind: 'out' },
          { item: 'rep.pl.gross', amount: gross, kind: 'sum' },
          ...exp.map((e) => ({ item: e.category || '—', amount: -e.amount, kind: 'out', raw: true })),
          ...(settle ? [{ item: 'rep.pl.settlement', amount: -settle, kind: 'out' }] : []),
          ...(rebates ? [{ item: 'rep.pl.rebates', amount: rebates, kind: 'in' }] : []),
          { item: 'rep.pl.net', amount: gross - expenses - settle + rebates, kind: 'sum' },
        ];
        return {
          columns: [col('item', 'rep.col.item', 'label'), col('amount', 'rep.col.amount', 'money', false), col('pct', 'rep.col.ofSales', 'pct', false)],
          rows: rows.map((r) => ({ ...r, pct: sales ? Math.round((r.amount / sales) * 1000) / 10 : 0 })),
          summary: [{ label: 'rep.pl.grossMargin', value: sales ? Math.round((gross / sales) * 1000) / 10 : 0, type: 'pct' }],
        };
      },
    },

    // ---------------- stock ----------------
    stock_valuation: {
      group: 'stock', noRange: true,
      run: () => ({
        columns: costCols([col('name', 'rep.col.product'), col('barcode', 'rep.col.barcode'), col('category', 'rep.col.category'), col('stock', 'rep.col.stock', 'qty'), col('packs', 'rep.col.packs'),
          col('cost', 'rep.col.unitCost', 'money', false), col('value_cost', 'rep.col.valueCost', 'money'), col('price', 'rep.col.price', 'money', false), col('value_price', 'rep.col.valuePrice', 'money')]),
        rows: withPacks(all(`SELECT p.id, p.name, COALESCE(p.barcode, '') AS barcode, COALESCE(c.name, '') AS category, p.stock, p.cost, ROUND(MAX(p.stock, 0) * p.cost) AS value_cost,
            p.price, ROUND(MAX(p.stock, 0) * p.price) AS value_price
          FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1 AND p.track_stock = 1 AND p.attributes = '' ORDER BY c.name, p.name`)),
      }),
    },
    low_stock: {
      group: 'stock', noRange: true,
      run: () => ({
        columns: [col('name', 'rep.col.product'), col('category', 'rep.col.category'), col('stock', 'rep.col.stock', 'qty', false), col('packs', 'rep.col.packs'), col('min_stock', 'rep.col.minStock', 'qty', false),
          col('shortage', 'rep.col.shortage', 'qty'), col('supplier', 'rep.col.supplier')],
        rows: withPacks(all(`SELECT p.id, p.name, COALESCE(c.name, '') AS category, p.stock, p.min_stock, p.min_stock - p.stock AS shortage, COALESCE(s.name, '') AS supplier
          FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers s ON s.id = p.supplier_id
          WHERE p.active = 1 AND p.track_stock = 1 AND p.attributes = '' AND p.stock <= p.min_stock ORDER BY shortage DESC`)),
      }),
    },
    stock_movement: {
      group: 'stock',
      run: ({ f, t }) => {
        const rows = all(`SELECT p.name, COALESCE(SUM(CASE WHEN m.reason = 'purchase' THEN m.qty END), 0) AS purchased,
            -COALESCE(SUM(CASE WHEN m.reason = 'sale' THEN m.qty END), 0) AS sold,
            COALESCE(SUM(CASE WHEN m.reason = 'return' THEN m.qty END), 0) AS returned,
            -COALESCE(SUM(CASE WHEN m.reason = 'purchase_return' THEN m.qty END), 0) AS returned_to_supplier,
            COALESCE(SUM(CASE WHEN m.reason IN ('adjust', 'count') THEN m.qty END), 0) AS adjusted,
            COALESCE(SUM(CASE WHEN m.reason NOT IN ('transfer') THEN m.qty END), 0) AS net,
            p.stock
          FROM stock_moves m JOIN products p ON p.id = m.product_id WHERE ${IN_RANGE('m.created_at')} GROUP BY p.id ORDER BY p.name`, f, t);
        return {
          columns: [col('name', 'rep.col.product'), col('purchased', 'rep.col.purchased', 'qty'), col('sold', 'rep.col.sold', 'qty'), col('returned', 'rep.col.customerReturns', 'qty'),
            col('returned_to_supplier', 'rep.col.supplierReturns', 'qty'), col('adjusted', 'rep.col.adjusted', 'qty'), col('net', 'rep.col.netChange', 'qty'), col('stock', 'rep.col.stockNow', 'qty')],
          rows,
        };
      },
    },
    slow_movers: {
      group: 'stock',
      run: ({ f, t }) => ({
        columns: costCols([col('name', 'rep.col.product'), col('category', 'rep.col.category'), col('stock', 'rep.col.stock', 'qty'), col('value_cost', 'rep.col.valueCost', 'money'),
          col('last_sale', 'rep.col.lastSale', 'datetime')]),
        rows: all(`SELECT p.name, COALESCE(c.name, '') AS category, p.stock, ROUND(MAX(p.stock, 0) * p.cost) AS value_cost,
            (SELECT MAX(o.completed_at) FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.product_id = p.id AND o.status = 'completed') AS last_sale
          FROM products p LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.active = 1 AND p.track_stock = 1 AND p.attributes = '' AND p.stock > 0 AND NOT EXISTS (
            SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.product_id = p.id AND ${RANGE})
          ORDER BY value_cost DESC`, f, t),
      }),
    },
    expiry: {
      group: 'stock', feature: 'batches', noRange: true,
      run: () => ({
        columns: [col('name', 'rep.col.product'), col('batch_no', 'rep.col.batch'), col('expiry_date', 'rep.col.expiry', 'date'), col('days', 'rep.col.daysLeft', 'int', false), col('qty', 'rep.col.qty', 'qty')],
        rows: all(`SELECT p.name, b.batch_no, b.expiry_date, CAST(julianday(b.expiry_date) - julianday('now', 'localtime') AS INTEGER) AS days, b.qty
          FROM batches b JOIN products p ON p.id = b.product_id WHERE b.qty > 0 AND b.expiry_date IS NOT NULL ORDER BY b.expiry_date`),
      }),
    },
    stock_by_warehouse: {
      group: 'stock', feature: 'warehouses', noRange: true,
      run: () => {
        const whs = all('SELECT id, name FROM warehouses WHERE active = 1 ORDER BY id');
        const rows = all("SELECT id, name, stock FROM products WHERE active = 1 AND track_stock = 1 AND attributes = '' ORDER BY name");
        const split = all('SELECT warehouse_id, product_id, qty FROM warehouse_stock');
        for (const r of rows) for (const w of whs) r[`w${w.id}`] = split.find((x) => x.product_id === r.id && x.warehouse_id === w.id)?.qty || 0;
        return {
          columns: [col('name', 'rep.col.product'), ...whs.map((w) => ({ key: `w${w.id}`, label: w.name, raw: true, type: 'qty', total: true })), col('stock', 'rep.col.total', 'qty')],
          rows,
        };
      },
    },

    // ---------------- purchases ----------------
    purchases_list: {
      group: 'purchases',
      run: ({ f, t }) => ({
        columns: [col('id', 'rep.col.number', 'int', false), col('created_at', 'rep.col.datetime', 'datetime'), col('supplier', 'rep.col.supplier'), col('ref_no', 'rep.col.ref'),
          col('total', 'rep.col.total', 'money'), col('returned', 'rep.col.returns', 'money'), col('paid', 'rep.col.paid', 'money'), col('due', 'rep.col.due', 'money')],
        rows: all(`SELECT p.id, p.created_at, COALESCE(s.name, '') AS supplier, p.ref_no, p.total, p.returned,
            COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id AND sp.method NOT IN ('return') AND sp.status = 'posted'), 0) AS paid
          FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE ${IN_RANGE('p.created_at')} ORDER BY p.id`, f, t)
          .map((r) => ({ ...r, due: Math.max(0, r.total - r.returned - r.paid) })),
      }),
    },
    purchases_by_supplier: {
      group: 'purchases',
      run: ({ f, t }) => ({
        columns: [col('supplier', 'rep.col.supplier'), col('invoices', 'rep.col.invoices', 'int'), col('total', 'rep.col.total', 'money'), col('returned', 'rep.col.returns', 'money'), col('net', 'rep.col.net', 'money')],
        rows: all(`SELECT COALESCE(s.name, '—') AS supplier, COUNT(*) AS invoices, SUM(p.total) AS total, SUM(p.returned) AS returned, SUM(p.total - p.returned) AS net
          FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE ${IN_RANGE('p.created_at')} GROUP BY s.id ORDER BY total DESC`, f, t),
      }),
    },
    purchases_by_product: {
      group: 'purchases',
      run: ({ f, t }) => ({
        columns: [col('name', 'rep.col.product'), col('qty', 'rep.col.qty', 'qty'), col('bonus', 'rep.col.bonus', 'qty'), col('total', 'rep.col.total', 'money'), col('avg_cost', 'rep.col.avgCost', 'money', false)],
        rows: all(`SELECT i.name, SUM(i.qty * i.unit_factor) AS qty, SUM(i.bonus_qty * i.unit_factor) AS bonus, SUM(i.line_total) AS total,
            ROUND(SUM(i.line_total) / SUM((i.qty + i.bonus_qty) * i.unit_factor)) AS avg_cost
          FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id WHERE ${IN_RANGE('p.created_at')} GROUP BY COALESCE(i.product_id, i.name) ORDER BY total DESC`, f, t),
      }),
    },
    supplier_balances: {
      group: 'purchases', noRange: true,
      run: () => ({
        columns: [col('name', 'rep.col.supplier'), col('phone', 'rep.col.phone'), col('balance', 'rep.col.balance', 'money')],
        rows: all(`SELECT * FROM (SELECT s.name, s.phone, ${SUPPLIER_BALANCE} AS balance FROM suppliers s WHERE s.active = 1) WHERE balance != 0 ORDER BY balance DESC`),
      }),
    },

    // ---------------- customers ----------------
    customer_balances: {
      group: 'customers', noRange: true,
      run: () => ({
        columns: [col('name', 'rep.col.customer'), col('phone', 'rep.col.phone'), col('credit_limit', 'rep.col.creditLimit', 'money', false), col('balance', 'rep.col.balance', 'money')],
        rows: all(`SELECT * FROM (SELECT c.name, c.phone, c.credit_limit, ${CUSTOMER_BALANCE} AS balance FROM customers c WHERE c.active = 1) WHERE balance != 0 ORDER BY balance DESC`),
      }),
    },
    aging: {
      group: 'customers', noRange: true,
      run: () => ({
        columns: [col('name', 'rep.col.customer'), col('phone', 'rep.col.phone'), col('b30', 'rep.col.b30', 'money'), col('b60', 'rep.col.b60', 'money'), col('b90', 'rep.col.b90', 'money'),
          col('b90p', 'rep.col.b90p', 'money'), col('total', 'rep.col.total', 'money'), col('overdue', 'rep.col.overdue', 'money')],
        rows: ctx.aging(),
      }),
    },
    collections: {
      group: 'customers',
      run: ({ f, t }) => ({
        columns: [col('created_at', 'rep.col.datetime', 'datetime'), col('receipt_no', 'rep.col.receipt', 'int', false), col('customer', 'rep.col.customer'), col('method', 'rep.col.method', 'method'),
          col('amount', 'rep.col.amount', 'money'), col('discount', 'rep.col.settlement', 'money'), col('collector', 'rep.col.collector')],
        rows: all(`SELECT MIN(p.created_at) AS created_at, p.receipt_no, c.name AS customer, MAX(CASE WHEN p.method != 'discount' THEN p.method END) AS method,
            SUM(CASE WHEN p.method != 'discount' THEN p.amount ELSE 0 END) AS amount, SUM(CASE WHEN p.method = 'discount' THEN p.amount ELSE 0 END) AS discount,
            COALESCE(col.name, u.name) AS collector
          FROM customer_payments p JOIN customers c ON c.id = p.customer_id JOIN users u ON u.id = p.user_id LEFT JOIN users col ON col.id = p.collector_id
          WHERE p.receipt_no IS NOT NULL AND p.status = 'posted' AND ${IN_RANGE('p.created_at')} GROUP BY p.receipt_no ORDER BY p.receipt_no`, f, t),
      }),
    },
    installments_due: {
      group: 'customers', feature: 'installments', noRange: true,
      run: () => ({
        columns: [col('customer_name', 'rep.col.customer'), col('customer_phone', 'rep.col.phone'), col('invoice_no', 'rep.col.invoice', 'int', false), col('installment', 'rep.col.installment', 'int', false),
          col('due_date', 'rep.col.dueDate', 'date'), col('open', 'rep.col.due', 'money')],
        rows: ctx.installmentsDue(),
      }),
    },

    // ---------------- money ----------------
    expenses: {
      group: 'money',
      run: ({ f, t }) => ({
        columns: [col('created_at', 'rep.col.datetime', 'datetime'), col('category', 'rep.col.category'), col('notes', 'rep.col.notes'), col('source', 'rep.col.source'),
          col('user', 'rep.col.user'), col('amount', 'rep.col.amount', 'money')],
        rows: all(`SELECT e.created_at, e.category, e.notes, CASE WHEN e.from_drawer = 1 THEN 'drawer' ELSE COALESCE(a.name, '') END AS source, u.name AS user, e.amount
          FROM expenses e JOIN users u ON u.id = e.user_id LEFT JOIN money_accounts a ON a.id = e.account_id WHERE ${IN_RANGE('e.created_at')} ORDER BY e.created_at`, f, t),
      }),
    },
    expenses_by_category: {
      group: 'money',
      run: ({ f, t }) => {
        const rows = all(`SELECT COALESCE(NULLIF(category, ''), '—') AS category, COUNT(*) AS count, SUM(amount) AS amount FROM expenses WHERE ${IN_RANGE('created_at')} GROUP BY category ORDER BY amount DESC`, f, t);
        const total = rows.reduce((s, r) => s + r.amount, 0);
        return {
          columns: [col('category', 'rep.col.category'), col('count', 'rep.col.count', 'int'), col('amount', 'rep.col.amount', 'money'), col('share', 'rep.col.share', 'pct', false)],
          rows: rows.map((r) => ({ ...r, share: total ? Math.round((r.amount / total) * 1000) / 10 : 0 })),
        };
      },
    },
    shifts: {
      group: 'money',
      run: ({ f, t }) => ({
        columns: [col('id', 'rep.col.number', 'int', false), col('user', 'rep.col.cashier'), col('opened_at', 'rep.col.opened', 'datetime'), col('closed_at', 'rep.col.closed', 'datetime'),
          col('sales', 'rep.col.sales', 'money'), col('expected_cash', 'rep.col.expected', 'money'), col('counted_cash', 'rep.col.counted', 'money'), col('difference', 'rep.col.difference', 'money')],
        rows: all(`SELECT s.id, u.name AS user, s.opened_at, s.closed_at, s.expected_cash, s.counted_cash,
            COALESCE((SELECT SUM(total) FROM orders o WHERE o.shift_id = s.id AND o.status = 'completed'), 0) AS sales
          FROM shifts s JOIN users u ON u.id = s.user_id WHERE ${IN_RANGE('s.opened_at')} ORDER BY s.id`, f, t)
          .map((r) => ({ ...r, difference: r.closed_at && r.counted_cash != null ? r.counted_cash - (r.expected_cash || 0) : null })),
      }),
    },
    treasury: {
      group: 'money', feature: 'treasury', perm: 'treasury',
      run: ({ f, t }) => ({
        columns: [col('name', 'rep.col.account'), col('kind', 'rep.col.kind', 'kind'), col('opening', 'rep.col.openingPeriod', 'money'), col('money_in', 'rep.col.in', 'money'),
          col('money_out', 'rep.col.out', 'money'), col('closing', 'rep.col.closing', 'money')],
        rows: all('SELECT id, name, kind, opening_balance FROM money_accounts WHERE active = 1 ORDER BY id').map((a) => {
          const before = one("SELECT COALESCE(SUM(amount), 0) AS s FROM money_moves WHERE account_id = ? AND created_at < ?", a.id, f).s;
          const mv = one(`SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS i, COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END), 0) AS o FROM money_moves WHERE account_id = ? AND ${IN_RANGE('created_at')}`, a.id, f, t);
          const opening = a.opening_balance + before;
          return { name: a.name, kind: a.kind, opening, money_in: mv.i, money_out: mv.o, closing: opening + mv.i - mv.o };
        }),
      }),
    },

    // ---------------- staff ----------------
    commissions: {
      group: 'staff', feature: 'commissions',
      run: ({ f, t }) => ({
        columns: [col('name', 'rep.col.salesperson'), col('orders', 'rep.col.invoices', 'int'), col('net', 'rep.col.net', 'money'), col('rate', 'rep.col.rate', 'pct', false), col('commission', 'rep.col.commission', 'money')],
        rows: ctx.commissions({ from: f, to: t }),
      }),
    },
    attendance: {
      group: 'staff', feature: 'employees', perm: 'employees',
      run: ({ f, t }) => ({
        columns: [col('name', 'rep.col.employee'), col('job', 'rep.col.job'), col('present', 'rep.col.present', 'int'), col('absent', 'rep.col.absent', 'int'), col('leave', 'rep.col.leave', 'int'),
          col('advances', 'rep.col.advances', 'money'), col('bonuses', 'rep.col.bonuses', 'money'), col('deductions', 'rep.col.deductions', 'money')],
        rows: all(`SELECT e.name, e.job,
            (SELECT COUNT(*) FROM attendance a WHERE a.employee_id = e.id AND a.status = 'present' AND a.day BETWEEN ? AND ?) AS present,
            (SELECT COUNT(*) FROM attendance a WHERE a.employee_id = e.id AND a.status = 'absent' AND a.day BETWEEN ? AND ?) AS absent,
            (SELECT COUNT(*) FROM attendance a WHERE a.employee_id = e.id AND a.status = 'leave' AND a.day BETWEEN ? AND ?) AS leave,
            COALESCE((SELECT SUM(amount) FROM employee_moves m WHERE m.employee_id = e.id AND m.kind = 'advance' AND ${IN_RANGE('m.created_at')}), 0) AS advances,
            COALESCE((SELECT SUM(amount) FROM employee_moves m WHERE m.employee_id = e.id AND m.kind = 'bonus' AND ${IN_RANGE('m.created_at')}), 0) AS bonuses,
            COALESCE((SELECT SUM(amount) FROM employee_moves m WHERE m.employee_id = e.id AND m.kind = 'deduction' AND ${IN_RANGE('m.created_at')}), 0) AS deductions
          FROM employees e WHERE e.active = 1 ORDER BY e.name`, f, t, f, t, f, t, f, t, f, t, f, t),
      }),
    },
  };
}

module.exports = { buildCatalog };
