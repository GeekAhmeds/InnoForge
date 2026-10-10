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
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
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
