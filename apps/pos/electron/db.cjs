'use strict';
// SQLite access through Node's built-in driver (node:sqlite), so the app has
// no native modules to rebuild and works fully offline.
const { DatabaseSync } = require('node:sqlite');

// Each entry runs once, in order. Never edit a shipped migration — append a new one.
const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE users (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pin_hash   TEXT NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('admin', 'cashier')),
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE categories (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4f46e5',
    sort  INTEGER NOT NULL DEFAULT 0
  );

  -- Money is stored as integer minor units (e.g. piasters) to avoid float drift.
  CREATE TABLE products (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    barcode     TEXT UNIQUE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    price       INTEGER NOT NULL CHECK (price >= 0),
    cost        INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
    track_stock INTEGER NOT NULL DEFAULT 1,
    stock       REAL NOT NULL DEFAULT 0,
    min_stock   REAL NOT NULL DEFAULT 0,
    unit        TEXT NOT NULL DEFAULT 'pcs',
    author      TEXT,
    publisher   TEXT,
    kitchen     INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX idx_products_name ON products(name);

  CREATE TABLE dining_tables (
    id     INTEGER PRIMARY KEY,
    name   TEXT NOT NULL,
    area   TEXT NOT NULL DEFAULT '',
    seats  INTEGER NOT NULL DEFAULT 4,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE shifts (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    opened_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    closed_at      TEXT,
    opening_cash   INTEGER NOT NULL DEFAULT 0,
    counted_cash   INTEGER,
    expected_cash  INTEGER,
    notes          TEXT NOT NULL DEFAULT ''
  );

  -- An order is a cart that is either still open (parked cart / restaurant
  -- table) or completed (paid). Completed orders get a sequential invoice number.
  CREATE TABLE orders (
    id              INTEGER PRIMARY KEY,
    invoice_no      INTEGER UNIQUE,
    status          TEXT NOT NULL CHECK (status IN ('open', 'completed', 'void')),
    order_type      TEXT NOT NULL DEFAULT 'sale'
                    CHECK (order_type IN ('sale', 'dine_in', 'takeaway', 'delivery')),
    table_id        INTEGER REFERENCES dining_tables(id),
    shift_id        INTEGER REFERENCES shifts(id),
    user_id         INTEGER NOT NULL REFERENCES users(id),
    customer_name   TEXT NOT NULL DEFAULT '',
    customer_phone  TEXT NOT NULL DEFAULT '',
    customer_address TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    subtotal        INTEGER NOT NULL DEFAULT 0,
    discount        INTEGER NOT NULL DEFAULT 0,
    tax             INTEGER NOT NULL DEFAULT 0,
    service         INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL DEFAULT 0,
    paid            INTEGER NOT NULL DEFAULT 0,
    change_due      INTEGER NOT NULL DEFAULT 0,
    refunded        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    completed_at    TEXT
  );
  CREATE INDEX idx_orders_status ON orders(status);
  CREATE INDEX idx_orders_completed ON orders(completed_at);

  CREATE TABLE order_items (
    id           INTEGER PRIMARY KEY,
    order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    unit_price   INTEGER NOT NULL,
    unit_cost    INTEGER NOT NULL DEFAULT 0,
    qty          REAL NOT NULL CHECK (qty > 0),
    discount     INTEGER NOT NULL DEFAULT 0,
    line_total   INTEGER NOT NULL,
    note         TEXT NOT NULL DEFAULT '',
    kitchen_sent REAL NOT NULL DEFAULT 0,
    returned_qty REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_order_items_order ON order_items(order_id);

  CREATE TABLE payments (
    id         INTEGER PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    method     TEXT NOT NULL CHECK (method IN ('cash', 'card', 'wallet', 'other')),
    amount     INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE returns (
    id         INTEGER PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES orders(id),
    shift_id   INTEGER REFERENCES shifts(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    amount     INTEGER NOT NULL,
    method     TEXT NOT NULL DEFAULT 'cash',
    reason     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE return_items (
    id            INTEGER PRIMARY KEY,
    return_id     INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    order_item_id INTEGER NOT NULL REFERENCES order_items(id),
    qty           REAL NOT NULL,
    amount        INTEGER NOT NULL
  );

  CREATE TABLE stock_moves (
    id         INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    qty        REAL NOT NULL,
    reason     TEXT NOT NULL CHECK (reason IN ('sale', 'return', 'adjust', 'purchase')),
    ref_id     INTEGER,
    user_id    INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  `,
  // v2: purchasing, suppliers and cash-out expenses.
  `
  CREATE TABLE suppliers (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL DEFAULT '',
    address    TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE purchases (
    id          INTEGER PRIMARY KEY,
    supplier_id INTEGER REFERENCES suppliers(id),
    ref_no      TEXT NOT NULL DEFAULT '',
    user_id     INTEGER NOT NULL REFERENCES users(id),
    subtotal    INTEGER NOT NULL DEFAULT 0,
    discount    INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);
  CREATE INDEX idx_purchases_created ON purchases(created_at);

  CREATE TABLE purchase_items (
    id          INTEGER PRIMARY KEY,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    qty         REAL NOT NULL CHECK (qty > 0),
    unit_cost   INTEGER NOT NULL CHECK (unit_cost >= 0),
    line_total  INTEGER NOT NULL
  );

  -- Money paid to suppliers, either with a purchase or later against the balance.
  CREATE TABLE supplier_payments (
    id          INTEGER PRIMARY KEY,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    purchase_id INTEGER REFERENCES purchases(id),
    amount      INTEGER NOT NULL CHECK (amount > 0),
    method      TEXT NOT NULL DEFAULT 'cash',
    from_drawer INTEGER NOT NULL DEFAULT 0,
    shift_id    INTEGER REFERENCES shifts(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX idx_supplier_payments_supplier ON supplier_payments(supplier_id);

  CREATE TABLE expenses (
    id          INTEGER PRIMARY KEY,
    category    TEXT NOT NULL DEFAULT '',
    amount      INTEGER NOT NULL CHECK (amount > 0),
    notes       TEXT NOT NULL DEFAULT '',
    from_drawer INTEGER NOT NULL DEFAULT 0,
    shift_id    INTEGER REFERENCES shifts(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX idx_expenses_created ON expenses(created_at);
  `,
  // v3: customers and credit (on-account) sales.
  `
  CREATE TABLE customers (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    phone        TEXT NOT NULL DEFAULT '',
    address      TEXT NOT NULL DEFAULT '',
    tax_number   TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    credit_limit INTEGER NOT NULL DEFAULT 0, -- 0 = no limit
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX idx_customers_name ON customers(name);
  CREATE INDEX idx_customers_phone ON customers(phone);

  -- credit = the part of a completed sale left on the customer's account.
  ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id);
  ALTER TABLE orders ADD COLUMN credit INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX idx_orders_customer ON orders(customer_id);

  -- Money received from customers against their balance. method 'return' is a
  -- credit note from a returned credit sale (no cash moves).
  CREATE TABLE customer_payments (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    amount      INTEGER NOT NULL CHECK (amount > 0),
    method      TEXT NOT NULL DEFAULT 'cash',
    shift_id    INTEGER REFERENCES shifts(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    order_id    INTEGER REFERENCES orders(id),
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX idx_customer_payments_customer ON customer_payments(customer_id);

  -- Part of a return actually paid out of the drawer (the rest may go to the customer's account).
  ALTER TABLE returns ADD COLUMN cash_amount INTEGER NOT NULL DEFAULT 0;
  UPDATE returns SET cash_amount = amount WHERE method = 'cash';
  `,
  // v4: supervisor role, per-user permissions and commission, audit log, sales reps.
  // Rebuilds tables whose CHECK constraints change, so it runs with foreign keys off.
  {
    fkOff: true,
    sql: `
    CREATE TABLE users_new (
      id              INTEGER PRIMARY KEY,
      name            TEXT NOT NULL,
      username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pin_hash        TEXT NOT NULL,
      role            TEXT NOT NULL CHECK (role IN ('admin', 'supervisor', 'cashier')),
      permissions     TEXT NOT NULL DEFAULT '{}', -- JSON overrides of the role defaults
      commission_rate REAL NOT NULL DEFAULT 0,    -- % of net sales
      active          INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    INSERT INTO users_new (id, name, username, pin_hash, role, active, created_at)
      SELECT id, name, username, pin_hash, role, active, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;

    -- Payment methods are validated in code so new ones (e.g. loyalty points) need no rebuild.
    CREATE TABLE payments_new (
      id         INTEGER PRIMARY KEY,
      order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      method     TEXT NOT NULL,
      amount     INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    INSERT INTO payments_new SELECT * FROM payments;
    DROP TABLE payments;
    ALTER TABLE payments_new RENAME TO payments;
    CREATE INDEX idx_payments_order ON payments(order_id);

    ALTER TABLE orders ADD COLUMN salesperson_id INTEGER REFERENCES users(id);

    CREATE TABLE audit_log (
      id          INTEGER PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id),
      action      TEXT NOT NULL,
      entity      TEXT NOT NULL DEFAULT '',
      entity_id   INTEGER,
      details     TEXT NOT NULL DEFAULT '',
      approved_by INTEGER REFERENCES users(id),
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX idx_audit_created ON audit_log(created_at);
    CREATE INDEX idx_audit_action ON audit_log(action);
    `,
  },
  // v5: opening balances, so existing debts can be brought in (e.g. from Excel).
  `
  ALTER TABLE customers ADD COLUMN opening_balance INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE suppliers ADD COLUMN opening_balance INTEGER NOT NULL DEFAULT 0;
  `,
  // v6: trading features — price lists, units, quotations, purchase returns, stock counts,
  // batches/expiry and serial numbers. stock_moves is rebuilt to allow new reasons.
  {
    fkOff: true,
    sql: `
    CREATE TABLE stock_moves_new (
      id         INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      qty        REAL NOT NULL,
      reason     TEXT NOT NULL, -- sale | return | adjust | purchase | purchase_return | count
      ref_id     INTEGER,
      user_id    INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    INSERT INTO stock_moves_new SELECT * FROM stock_moves;
    DROP TABLE stock_moves;
    ALTER TABLE stock_moves_new RENAME TO stock_moves;
    CREATE INDEX idx_stock_moves_product ON stock_moves(product_id);

    CREATE TABLE price_lists (
      id     INTEGER PRIMARY KEY,
      name   TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE product_prices (
      product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
      price         INTEGER NOT NULL CHECK (price >= 0),
      PRIMARY KEY (product_id, price_list_id)
    );
    ALTER TABLE customers ADD COLUMN price_list_id INTEGER REFERENCES price_lists(id);

    -- Extra selling units, e.g. a carton of 12. price NULL = base price × factor.
    CREATE TABLE product_units (
      id         INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      factor     REAL NOT NULL CHECK (factor > 0),
      barcode    TEXT UNIQUE,
      price      INTEGER CHECK (price >= 0)
    );
    CREATE INDEX idx_product_units_product ON product_units(product_id);

    ALTER TABLE products ADD COLUMN track_expiry INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE products ADD COLUMN track_serial INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE order_items ADD COLUMN unit_id INTEGER REFERENCES product_units(id) ON DELETE SET NULL;
    ALTER TABLE order_items ADD COLUMN unit_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE order_items ADD COLUMN unit_factor REAL NOT NULL DEFAULT 1;
    ALTER TABLE order_items ADD COLUMN serials TEXT NOT NULL DEFAULT '';
    ALTER TABLE orders ADD COLUMN price_list_id INTEGER REFERENCES price_lists(id);
    ALTER TABLE orders ADD COLUMN quote_id INTEGER;

    ALTER TABLE purchase_items ADD COLUMN unit_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE purchase_items ADD COLUMN unit_factor REAL NOT NULL DEFAULT 1;
    ALTER TABLE purchase_items ADD COLUMN batch_no TEXT NOT NULL DEFAULT '';
    ALTER TABLE purchase_items ADD COLUMN expiry_date TEXT;
    ALTER TABLE purchase_items ADD COLUMN returned_qty REAL NOT NULL DEFAULT 0;
    ALTER TABLE purchases ADD COLUMN returned INTEGER NOT NULL DEFAULT 0;

    -- Quantities on hand per expiry date (base units), consumed first-expiry-first-out.
    CREATE TABLE batches (
      id          INTEGER PRIMARY KEY,
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      batch_no    TEXT NOT NULL DEFAULT '',
      expiry_date TEXT,
      qty         REAL NOT NULL DEFAULT 0,
      purchase_id INTEGER REFERENCES purchases(id),
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX idx_batches_product ON batches(product_id, expiry_date);

    CREATE TABLE quotes (
      id             INTEGER PRIMARY KEY,
      quote_no       INTEGER NOT NULL UNIQUE,
      status         TEXT NOT NULL DEFAULT 'quote' CHECK (status IN ('quote', 'order', 'invoiced', 'cancelled')),
      customer_id    INTEGER REFERENCES customers(id),
      customer_name  TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      price_list_id  INTEGER REFERENCES price_lists(id),
      valid_until    TEXT,
      note           TEXT NOT NULL DEFAULT '',
      subtotal       INTEGER NOT NULL DEFAULT 0,
      discount       INTEGER NOT NULL DEFAULT 0,
      tax            INTEGER NOT NULL DEFAULT 0,
      total          INTEGER NOT NULL DEFAULT 0,
      user_id        INTEGER NOT NULL REFERENCES users(id),
      order_id       INTEGER REFERENCES orders(id),
      created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE quote_items (
      id          INTEGER PRIMARY KEY,
      quote_id    INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
      unit_id     INTEGER,
      name        TEXT NOT NULL,
      unit_name   TEXT NOT NULL DEFAULT '',
      unit_price  INTEGER NOT NULL,
      qty         REAL NOT NULL,
      discount    INTEGER NOT NULL DEFAULT 0,
      line_total  INTEGER NOT NULL
    );

    CREATE TABLE purchase_returns (
      id          INTEGER PRIMARY KEY,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id),
      supplier_id INTEGER REFERENCES suppliers(id),
      user_id     INTEGER NOT NULL REFERENCES users(id),
      amount      INTEGER NOT NULL,
      reason      TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE purchase_return_items (
      id               INTEGER PRIMARY KEY,
      return_id        INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
      purchase_item_id INTEGER NOT NULL REFERENCES purchase_items(id),
      qty              REAL NOT NULL,
      amount           INTEGER NOT NULL
    );

    CREATE TABLE stock_counts (
      id         INTEGER PRIMARY KEY,
      status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'cancelled')),
      notes      TEXT NOT NULL DEFAULT '',
      user_id    INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      applied_at TEXT
    );
    CREATE TABLE stock_count_items (
      count_id   INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      expected   REAL NOT NULL,
      counted    REAL,
      PRIMARY KEY (count_id, product_id)
    );
    `,
  },
  // v7: automatic promotions and customer loyalty points.
  `
  CREATE TABLE promotions (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('percent', 'amount', 'buy_x_get_y')),
    scope      TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'category', 'product')),
    target_id  INTEGER,
    value      REAL NOT NULL DEFAULT 0,  -- percent, or amount off per unit (minor units)
    buy_qty    REAL NOT NULL DEFAULT 0,
    get_qty    REAL NOT NULL DEFAULT 0,
    min_qty    REAL NOT NULL DEFAULT 0,
    start_date TEXT,
    end_date   TEXT,
    days       TEXT NOT NULL DEFAULT '', -- weekdays 0-6 (Sunday = 0), empty = every day
    time_from  TEXT NOT NULL DEFAULT '',
    time_to    TEXT NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  ALTER TABLE order_items ADD COLUMN promo_discount INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE order_items ADD COLUMN promo_name TEXT NOT NULL DEFAULT '';

  ALTER TABLE customers ADD COLUMN points REAL NOT NULL DEFAULT 0;
  ALTER TABLE orders ADD COLUMN points_earned REAL NOT NULL DEFAULT 0;
  ALTER TABLE orders ADD COLUMN points_redeemed REAL NOT NULL DEFAULT 0;
  CREATE TABLE loyalty_moves (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    order_id    INTEGER REFERENCES orders(id),
    points      REAL NOT NULL,
    reason      TEXT NOT NULL, -- earn | redeem | return | adjust
    user_id     INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX idx_loyalty_customer ON loyalty_moves(customer_id);
  `,
  // v8: receipt vouchers (numbered, bank/cheque details, voids, allocation to invoices),
  // payment terms and due dates, customer discounts, supplier bonuses and rebates.
  `
  ALTER TABLE customer_payments ADD COLUMN receipt_no INTEGER;
  ALTER TABLE customer_payments ADD COLUMN status TEXT NOT NULL DEFAULT 'posted'; -- posted | void | bounced
  ALTER TABLE customer_payments ADD COLUMN cheque_no TEXT NOT NULL DEFAULT '';
  ALTER TABLE customer_payments ADD COLUMN bank TEXT NOT NULL DEFAULT '';
  ALTER TABLE customer_payments ADD COLUMN cheque_due TEXT;
  ALTER TABLE customer_payments ADD COLUMN cheque_status TEXT NOT NULL DEFAULT ''; -- pending | cleared | bounced
  ALTER TABLE customer_payments ADD COLUMN collector_id INTEGER REFERENCES users(id);
  ALTER TABLE customer_payments ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';
  ALTER TABLE customer_payments ADD COLUMN voided_at TEXT;
  ALTER TABLE customer_payments ADD COLUMN voided_by INTEGER REFERENCES users(id);
  UPDATE customer_payments SET receipt_no = id WHERE method != 'return';
  CREATE INDEX idx_customer_payments_receipt ON customer_payments(receipt_no);

  -- Which invoices a payment settles. Payments without allocations settle the oldest debts first.
  CREATE TABLE payment_allocations (
    id         INTEGER PRIMARY KEY,
    payment_id INTEGER NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
    order_id   INTEGER NOT NULL REFERENCES orders(id),
    amount     INTEGER NOT NULL CHECK (amount > 0)
  );
  CREATE INDEX idx_alloc_payment ON payment_allocations(payment_id);
  CREATE INDEX idx_alloc_order ON payment_allocations(order_id);
  INSERT INTO payment_allocations (payment_id, order_id, amount)
    SELECT id, order_id, amount FROM customer_payments WHERE method = 'return' AND order_id IS NOT NULL;

  ALTER TABLE customers ADD COLUMN payment_terms INTEGER NOT NULL DEFAULT 0; -- days; 0 = the general setting
  ALTER TABLE customers ADD COLUMN discount_percent REAL NOT NULL DEFAULT 0;
  ALTER TABLE orders ADD COLUMN due_date TEXT;
  ALTER TABLE order_items ADD COLUMN customer_discount INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE products ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
  ALTER TABLE purchase_items ADD COLUMN bonus_qty REAL NOT NULL DEFAULT 0;
  ALTER TABLE purchase_items ADD COLUMN discount_percent REAL NOT NULL DEFAULT 0;
  UPDATE products SET supplier_id = (
    SELECT pu.supplier_id FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
    WHERE pi.product_id = products.id AND pu.supplier_id IS NOT NULL ORDER BY pu.id DESC LIMIT 1);

  -- Volume rebates agreed with a supplier: a percentage (or fixed amount) of what we
  -- bought from them, or sold of their products, in a period, once a target is reached.
  CREATE TABLE supplier_rebates (
    id             INTEGER PRIMARY KEY,
    supplier_id    INTEGER NOT NULL REFERENCES suppliers(id),
    name           TEXT NOT NULL,
    basis          TEXT NOT NULL CHECK (basis IN ('purchases', 'sales')),
    start_date     TEXT NOT NULL,
    end_date       TEXT NOT NULL,
    target         INTEGER NOT NULL DEFAULT 0,
    percent        REAL NOT NULL DEFAULT 0,
    fixed_amount   INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'cancelled')),
    settled_amount INTEGER NOT NULL DEFAULT 0,
    settled_at     TEXT,
    notes          TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  ALTER TABLE supplier_payments ADD COLUMN rebate_id INTEGER REFERENCES supplier_rebates(id);
  `,
  // v9: quotations keep the hand-given discount apart from automatic ones.
  `
  ALTER TABLE quote_items ADD COLUMN manual_discount INTEGER NOT NULL DEFAULT 0;
  UPDATE quote_items SET manual_discount = discount;
  `,
  // v10: restaurant floor (guests, printed check) and kitchen stations with their own
  // printers and a kitchen display; tickets are kept so the screen can track them.
  `
  ALTER TABLE orders ADD COLUMN guests INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE orders ADD COLUMN check_printed_at TEXT;

  CREATE TABLE kitchen_stations (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    printer_name TEXT NOT NULL DEFAULT '',
    copies       INTEGER NOT NULL DEFAULT 1,
    print        INTEGER NOT NULL DEFAULT 1, -- print a ticket on its printer
    display      INTEGER NOT NULL DEFAULT 1, -- show tickets on the kitchen screen
    sort         INTEGER NOT NULL DEFAULT 0,
    active       INTEGER NOT NULL DEFAULT 1
  );
  ALTER TABLE categories ADD COLUMN station_id INTEGER REFERENCES kitchen_stations(id) ON DELETE SET NULL;
  ALTER TABLE products ADD COLUMN station_id INTEGER REFERENCES kitchen_stations(id) ON DELETE SET NULL;

  CREATE TABLE kitchen_tickets (
    id          INTEGER PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    station_id  INTEGER REFERENCES kitchen_stations(id) ON DELETE SET NULL,
    items       TEXT NOT NULL, -- JSON [{ name, qty, note }]
    status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'preparing', 'ready', 'served', 'cancelled')),
    table_name  TEXT NOT NULL DEFAULT '',
    order_type  TEXT NOT NULL DEFAULT '',
    user_name   TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    started_at  TEXT,
    ready_at    TEXT,
    served_at   TEXT
  );
  CREATE INDEX idx_kitchen_tickets_status ON kitchen_tickets(status);
  `,
  // v11: products sold by weight, with the PLU code used by label-printing scales.
  `
  ALTER TABLE products ADD COLUMN by_weight INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE products ADD COLUMN plu TEXT;
  CREATE INDEX idx_products_plu ON products(plu);
  `,
  // v12: purchase orders sent to suppliers (from the low-stock list) before the goods arrive.
  `
  CREATE TABLE purchase_orders (
    id          INTEGER PRIMARY KEY,
    po_no       INTEGER NOT NULL UNIQUE,
    supplier_id INTEGER REFERENCES suppliers(id),
    status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'received', 'cancelled')),
    notes       TEXT NOT NULL DEFAULT '',
    user_id     INTEGER NOT NULL REFERENCES users(id),
    purchase_id INTEGER REFERENCES purchases(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE purchase_order_items (
    id         INTEGER PRIMARY KEY,
    po_id      INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    unit_id    INTEGER REFERENCES product_units(id) ON DELETE SET NULL,
    qty        REAL NOT NULL CHECK (qty > 0),
    unit_cost  INTEGER NOT NULL DEFAULT 0
  );
  ALTER TABLE purchases ADD COLUMN po_id INTEGER REFERENCES purchase_orders(id);
  `,
  // v13: restaurants — modifiers/sizes, recipes (ingredients consumed per dish), delivery zones and drivers.
  `
  CREATE TABLE modifier_groups (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    min_select INTEGER NOT NULL DEFAULT 0, -- 1 = must choose (e.g. size)
    max_select INTEGER NOT NULL DEFAULT 1, -- 0 = no limit
    sort       INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE modifier_options (
    id             INTEGER PRIMARY KEY,
    group_id       INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    price          INTEGER NOT NULL DEFAULT 0, -- added to the item price (can be 0)
    ingredient_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
    ingredient_qty REAL NOT NULL DEFAULT 0,    -- consumed per item when chosen
    sort           INTEGER NOT NULL DEFAULT 0,
    active         INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE product_modifier_groups (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    group_id   INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
    sort       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, group_id)
  );
  ALTER TABLE order_items ADD COLUMN modifiers TEXT NOT NULL DEFAULT ''; -- JSON [{ id, name, price }]
  ALTER TABLE order_items ADD COLUMN modifiers_price INTEGER NOT NULL DEFAULT 0;

  -- A dish made from ingredients: selling it consumes them (and sets its cost).
  CREATE TABLE recipe_items (
    product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES products(id),
    qty           REAL NOT NULL CHECK (qty > 0),
    PRIMARY KEY (product_id, ingredient_id)
  );
  ALTER TABLE products ADD COLUMN is_ingredient INTEGER NOT NULL DEFAULT 0; -- raw material, hidden from the sales screens

  CREATE TABLE delivery_zones (
    id     INTEGER PRIMARY KEY,
    name   TEXT NOT NULL,
    fee    INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE drivers (
    id     INTEGER PRIMARY KEY,
    name   TEXT NOT NULL,
    phone  TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  );
  ALTER TABLE orders ADD COLUMN zone_id INTEGER REFERENCES delivery_zones(id);
  ALTER TABLE orders ADD COLUMN delivery_fee INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE orders ADD COLUMN driver_id INTEGER REFERENCES drivers(id);
  ALTER TABLE orders ADD COLUMN delivery_status TEXT NOT NULL DEFAULT ''; -- '' | out | delivered
  ALTER TABLE orders ADD COLUMN out_at TEXT;
  ALTER TABLE orders ADD COLUMN delivered_at TEXT;
  `,
  // v14: treasury — cash boxes and bank accounts with a ledger of every movement;
  // cheques we give suppliers (payable until the bank pays them).
  `
  CREATE TABLE money_accounts (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('cash', 'bank')),
    bank_name       TEXT NOT NULL DEFAULT '',
    account_no      TEXT NOT NULL DEFAULT '',
    opening_balance INTEGER NOT NULL DEFAULT 0,
    active          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  -- Signed amounts: + money in, − money out. ref_type/ref_id point at what caused it.
  CREATE TABLE money_moves (
    id          INTEGER PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES money_accounts(id),
    amount      INTEGER NOT NULL,
    kind        TEXT NOT NULL,
    ref_type    TEXT NOT NULL DEFAULT '',
    ref_id      INTEGER,
    transfer_id INTEGER,
    notes       TEXT NOT NULL DEFAULT '',
    user_id     INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX idx_money_moves_account ON money_moves(account_id, created_at);
  CREATE INDEX idx_money_moves_ref ON money_moves(ref_type, ref_id);

  ALTER TABLE customer_payments ADD COLUMN account_id INTEGER REFERENCES money_accounts(id);
  ALTER TABLE expenses ADD COLUMN account_id INTEGER REFERENCES money_accounts(id);
  ALTER TABLE supplier_payments ADD COLUMN account_id INTEGER REFERENCES money_accounts(id);
  ALTER TABLE supplier_payments ADD COLUMN status TEXT NOT NULL DEFAULT 'posted'; -- posted | void
  ALTER TABLE supplier_payments ADD COLUMN cheque_no TEXT NOT NULL DEFAULT '';
  ALTER TABLE supplier_payments ADD COLUMN bank TEXT NOT NULL DEFAULT '';
  ALTER TABLE supplier_payments ADD COLUMN cheque_due TEXT;
  ALTER TABLE supplier_payments ADD COLUMN cheque_status TEXT NOT NULL DEFAULT ''; -- pending | cleared
  ALTER TABLE supplier_payments ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';
  ALTER TABLE shifts ADD COLUMN deposited INTEGER NOT NULL DEFAULT 0;
  `,
  // v15: several warehouses (shop floor, store room, a second branch's store) with stock
  // per warehouse and transfers between them; installment plans for credit sales.
  `
  CREATE TABLE warehouses (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  INSERT INTO warehouses (id, name) VALUES (1, 'المخزن الرئيسي');
  -- products.stock stays the total over all warehouses; this table splits it.
  CREATE TABLE warehouse_stock (
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    qty          REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (warehouse_id, product_id)
  );
  INSERT INTO warehouse_stock (warehouse_id, product_id, qty) SELECT 1, id, stock FROM products WHERE track_stock = 1;
  ALTER TABLE stock_moves ADD COLUMN warehouse_id INTEGER;
  ALTER TABLE purchases ADD COLUMN warehouse_id INTEGER;
  ALTER TABLE stock_counts ADD COLUMN warehouse_id INTEGER;
  CREATE TABLE stock_transfers (
    id         INTEGER PRIMARY KEY,
    from_id    INTEGER NOT NULL REFERENCES warehouses(id),
    to_id      INTEGER NOT NULL REFERENCES warehouses(id),
    notes      TEXT NOT NULL DEFAULT '',
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE stock_transfer_items (
    id          INTEGER PRIMARY KEY,
    transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products(id),
    name        TEXT NOT NULL,
    qty         REAL NOT NULL
  );

  -- An installment plan splits what a credit invoice leaves unpaid into dated installments.
  CREATE TABLE installment_plans (
    id            INTEGER PRIMARY KEY,
    order_id      INTEGER NOT NULL UNIQUE REFERENCES orders(id),
    customer_id   INTEGER NOT NULL REFERENCES customers(id),
    down_payment  INTEGER NOT NULL DEFAULT 0,
    financed      INTEGER NOT NULL,
    count         INTEGER NOT NULL,
    period_months INTEGER NOT NULL DEFAULT 1,
    first_due     TEXT NOT NULL,
    notes         TEXT NOT NULL DEFAULT '',
    user_id       INTEGER NOT NULL REFERENCES users(id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE installments (
    id       INTEGER PRIMARY KEY,
    plan_id  INTEGER NOT NULL REFERENCES installment_plans(id) ON DELETE CASCADE,
    seq      INTEGER NOT NULL,
    due_date TEXT NOT NULL,
    amount   INTEGER NOT NULL
  );
  CREATE INDEX idx_installments_plan ON installments(plan_id, seq);
  `,
  // v16: employees (attendance, advances, bonuses/deductions, monthly payroll);
  // coupon codes and prepaid gift cards.
  `
  CREATE TABLE employees (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL DEFAULT '',
    job        TEXT NOT NULL DEFAULT '',
    user_id    INTEGER REFERENCES users(id),
    pay_type   TEXT NOT NULL DEFAULT 'monthly' CHECK (pay_type IN ('monthly', 'daily')),
    salary     INTEGER NOT NULL DEFAULT 0, -- monthly salary, or the day rate for daily workers
    hired_at   TEXT,
    notes      TEXT NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE attendance (
    id          INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    day         TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'leave')),
    check_in    TEXT,
    check_out   TEXT,
    notes       TEXT NOT NULL DEFAULT '',
    UNIQUE (employee_id, day)
  );
  -- advance (paid out now, deducted from the salary) | bonus | deduction, for a payroll month.
  CREATE TABLE employee_moves (
    id          INTEGER PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    kind        TEXT NOT NULL CHECK (kind IN ('advance', 'bonus', 'deduction')),
    amount      INTEGER NOT NULL,
    month       TEXT NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    expense_id  INTEGER REFERENCES expenses(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE payrolls (
    id          INTEGER PRIMARY KEY,
    month       TEXT NOT NULL,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    days        REAL NOT NULL DEFAULT 0,
    absent      REAL NOT NULL DEFAULT 0,
    base        INTEGER NOT NULL,
    absence     INTEGER NOT NULL DEFAULT 0,
    bonuses     INTEGER NOT NULL DEFAULT 0,
    deductions  INTEGER NOT NULL DEFAULT 0,
    advances    INTEGER NOT NULL DEFAULT 0,
    net         INTEGER NOT NULL,
    expense_id  INTEGER REFERENCES expenses(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (month, employee_id)
  );

  CREATE TABLE coupons (
    id         INTEGER PRIMARY KEY,
    code       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind       TEXT NOT NULL CHECK (kind IN ('percent', 'amount')),
    value      INTEGER NOT NULL, -- percent, or minor units
    min_total  INTEGER NOT NULL DEFAULT 0,
    max_uses   INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited
    used       INTEGER NOT NULL DEFAULT 0,
    valid_from TEXT,
    valid_to   TEXT,
    notes      TEXT NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  ALTER TABLE orders ADD COLUMN coupon_id INTEGER REFERENCES coupons(id);
  ALTER TABLE orders ADD COLUMN coupon_discount INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE gift_cards (
    id          INTEGER PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    initial     INTEGER NOT NULL,
    balance     INTEGER NOT NULL,
    customer_id INTEGER REFERENCES customers(id),
    expires     TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  -- issue / topup (money in: method + shift) | redeem (order) | refund (back onto the card).
  CREATE TABLE gift_card_moves (
    id         INTEGER PRIMARY KEY,
    card_id    INTEGER NOT NULL REFERENCES gift_cards(id),
    kind       TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    method     TEXT NOT NULL DEFAULT '',
    order_id   INTEGER REFERENCES orders(id),
    shift_id   INTEGER REFERENCES shifts(id),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX idx_gift_moves_card ON gift_card_moves(card_id);
  `,
];

function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get();
  for (let v = current; v < MIGRATIONS.length; v++) {
    const m = typeof MIGRATIONS[v] === 'string' ? { sql: MIGRATIONS[v] } : MIGRATIONS[v];
    // Table rebuilds follow SQLite's documented procedure: foreign keys off around the
    // transaction, then verify nothing dangles before committing.
    if (m.fkOff) db.exec('PRAGMA foreign_keys = OFF');
    try {
      transaction(db, () => {
        db.exec(m.sql);
        if (m.fkOff && db.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`Migration ${v + 1} broke foreign keys`);
        db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    } finally {
      if (m.fkOff) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

// node:sqlite has no transaction helper; nested calls join the outer transaction.
function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, transaction };
