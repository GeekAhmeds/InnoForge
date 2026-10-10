'use strict';
const crypto = require('node:crypto');
const { transaction } = require('../db.cjs');
const { computeTotals } = require('./totals.cjs');

const DEFAULT_SETTINGS = {
  setup_done: false,
  business_name: '',
  business_type: 'retail', // retail | bookstore | restaurant
  address: '',
  phone: '',
  tax_number: '',
  currency: 'EGP',
  currency_symbol: 'ج.م',
  decimals: 2,
  tax_rate: 0,
  prices_include_tax: true,
  service_rate: 0,
  language: 'ar',
  receipt_header: '',
  receipt_footer: 'شكراً لزيارتكم',
  printer_name: '',
  kitchen_printer_name: '',
  silent_print: false,
  paper_width: 80,
  allow_negative_stock: true,
};

class PosError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPin(pin, stored) {
  const [salt, hash] = String(stored).split(':');
  const candidate = crypto.scryptSync(String(pin), salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

const plain = (row) => (row ? { ...row } : row);
const plainAll = (rows) => rows.map(plain);
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v) => (v == null ? '' : String(v).trim());
const PAYMENT_METHODS = ['cash', 'card', 'wallet', 'other'];

function dateRange(from, to) {
  // Inclusive local-date range on completed_at ('YYYY-MM-DD HH:MM:SS').
  const today = new Date().toLocaleDateString('en-CA');
  return [from || today, to || today];
}

/**
 * Builds the service layer. `session` holds the logged-in user for this
 * window; every method that changes data checks it.
 */
function createServices(db) {
  const session = { user: null };

  function requireUser() {
    if (!session.user) throw new PosError('NOT_LOGGED_IN');
    return session.user;
  }
  function requireAdmin() {
    const u = requireUser();
    if (u.role !== 'admin') throw new PosError('FORBIDDEN');
    return u;
  }

  // ---------- settings ----------
  function getSettings() {
    const out = { ...DEFAULT_SETTINGS };
    for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      const def = DEFAULT_SETTINGS[key];
      out[key] = typeof def === 'boolean' ? value === '1' : typeof def === 'number' ? Number(value) : value;
    }
    return out;
  }

  function writeSettings(patch) {
    const stmt = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    for (const [key, raw] of Object.entries(patch || {})) {
      if (!(key in DEFAULT_SETTINGS) || key === 'setup_done') continue;
      const def = DEFAULT_SETTINGS[key];
      const value = typeof def === 'boolean' ? (raw ? '1' : '0') : typeof def === 'number' ? String(num(raw, def)) : str(raw);
      stmt.run(key, value);
    }
  }

  const settings = {
    get: getSettings,
    // UI language is a harmless display preference, so it is allowed before login/setup.
    setLanguage(language) {
      if (!['ar', 'en'].includes(language)) throw new PosError('INVALID_LANGUAGE');
      writeSettings({ language });
      return getSettings();
    },
    save(patch) {
      requireAdmin();
      if (patch && 'business_type' in patch && !['retail', 'bookstore', 'restaurant'].includes(patch.business_type)) {
        throw new PosError('INVALID_BUSINESS_TYPE');
      }
      transaction(db, () => writeSettings(patch));
      return getSettings();
    },
  };

  // ---------- auth & users ----------
  const publicUser = (u) => u && { id: u.id, name: u.name, username: u.username, role: u.role, active: !!u.active };

  function validatePin(pin) {
    if (!/^\d{4,8}$/.test(String(pin))) throw new PosError('INVALID_PIN');
  }

  const auth = {
    status() {
      return { setupDone: getSettings().setup_done, user: publicUser(session.user) };
    },
    setup({ business = {}, admin = {} } = {}) {
      if (getSettings().setup_done) throw new PosError('ALREADY_SETUP');
      if (!str(business.business_name)) throw new PosError('NAME_REQUIRED');
      if (!str(admin.name) || !str(admin.username)) throw new PosError('NAME_REQUIRED');
      validatePin(admin.pin);
      transaction(db, () => {
        writeSettings(business);
        db.prepare("INSERT INTO users (name, username, pin_hash, role) VALUES (?, ?, ?, 'admin')").run(
          str(admin.name), str(admin.username), hashPin(admin.pin),
        );
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('setup_done', '1')").run();
        if (business.business_type === 'restaurant') {
          const ins = db.prepare('INSERT INTO dining_tables (name, area) VALUES (?, ?)');
          for (let i = 1; i <= 8; i++) ins.run(String(i), '');
        }
      });
      return auth.status();
    },
    loginUsers() {
      return plainAll(db.prepare('SELECT id, name, username, role FROM users WHERE active = 1 ORDER BY name').all());
    },
    login({ username, pin }) {
      const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(str(username));
      if (!u || !verifyPin(pin, u.pin_hash)) throw new PosError('BAD_CREDENTIALS');
      session.user = plain(u);
      return publicUser(session.user);
    },
    logout() {
      session.user = null;
      return true;
    },
  };

  const users = {
    list() {
      requireAdmin();
      return db.prepare('SELECT * FROM users ORDER BY name').all().map(publicUser);
    },
    save(u = {}) {
      const me = requireAdmin();
      const role = u.role === 'admin' ? 'admin' : 'cashier';
      if (!str(u.name) || !str(u.username)) throw new PosError('NAME_REQUIRED');
      return transaction(db, () => {
        if (u.id) {
          if (u.id === me.id && (role !== 'admin' || u.active === false)) throw new PosError('CANNOT_DEMOTE_SELF');
          db.prepare('UPDATE users SET name = ?, username = ?, role = ?, active = ? WHERE id = ?').run(
            str(u.name), str(u.username), role, u.active === false ? 0 : 1, u.id,
          );
          if (u.pin) {
            validatePin(u.pin);
            db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(u.pin), u.id);
          }
          return u.id;
        }
        validatePin(u.pin);
        return Number(
          db.prepare('INSERT INTO users (name, username, pin_hash, role) VALUES (?, ?, ?, ?)').run(
            str(u.name), str(u.username), hashPin(u.pin), role,
          ).lastInsertRowid,
        );
      });
    },
  };

  // ---------- catalog ----------
  const categories = {
    list() {
      requireUser();
      return plainAll(db.prepare('SELECT * FROM categories ORDER BY sort, name').all());
    },
    save(c = {}) {
      requireAdmin();
      if (!str(c.name)) throw new PosError('NAME_REQUIRED');
      if (c.id) {
        db.prepare('UPDATE categories SET name = ?, color = ?, sort = ? WHERE id = ?').run(str(c.name), str(c.color) || '#4f46e5', int(c.sort), c.id);
        return c.id;
      }
      return Number(db.prepare('INSERT INTO categories (name, color, sort) VALUES (?, ?, ?)').run(str(c.name), str(c.color) || '#4f46e5', int(c.sort)).lastInsertRowid);
    },
    remove(id) {
      requireAdmin();
      db.prepare('DELETE FROM categories WHERE id = ?').run(id);
      return true;
    },
  };

  const PRODUCT_SELECT = `SELECT p.*, c.name AS category_name, c.color AS category_color
    FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

  const products = {
    list({ search = '', categoryId = null, includeInactive = false } = {}) {
      requireUser();
      const where = [];
      const params = [];
      if (!includeInactive) where.push('p.active = 1');
      if (categoryId) { where.push('p.category_id = ?'); params.push(categoryId); }
      if (str(search)) {
        where.push('(p.name LIKE ? OR p.barcode LIKE ? OR p.author LIKE ?)');
        const q = `%${str(search)}%`;
        params.push(q, q, q);
      }
      const sql = `${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name LIMIT 500`;
      return plainAll(db.prepare(sql).all(...params));
    },
    byBarcode(barcode) {
      requireUser();
      return plain(db.prepare(`${PRODUCT_SELECT} WHERE p.barcode = ? AND p.active = 1`).get(str(barcode))) || null;
    },
    save(p = {}) {
      requireAdmin();
      if (!str(p.name)) throw new PosError('NAME_REQUIRED');
      const price = int(p.price, -1);
      if (price < 0) throw new PosError('INVALID_PRICE');
      const fields = {
        name: str(p.name),
        barcode: str(p.barcode) || null,
        category_id: p.category_id || null,
        price,
        cost: Math.max(0, int(p.cost)),
        track_stock: p.track_stock === false ? 0 : 1,
        min_stock: num(p.min_stock),
        unit: str(p.unit) || 'pcs',
        author: str(p.author) || null,
        publisher: str(p.publisher) || null,
        kitchen: p.kitchen ? 1 : 0,
        active: p.active === false ? 0 : 1,
      };
      if (fields.barcode) {
        const dup = db.prepare('SELECT id FROM products WHERE barcode = ? AND id != ?').get(fields.barcode, p.id || 0);
        if (dup) throw new PosError('DUPLICATE_BARCODE');
      }
      const keys = Object.keys(fields);
      return transaction(db, () => {
        if (p.id) {
          db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), p.id);
          return p.id;
        }
        const id = Number(
          db.prepare(`INSERT INTO products (${keys.join(', ')}, stock) VALUES (${keys.map(() => '?').join(', ')}, ?)`)
            .run(...keys.map((k) => fields[k]), 0).lastInsertRowid,
        );
        const initial = num(p.stock);
        if (initial) moveStock(id, initial, 'purchase', null, session.user.id);
        return id;
      });
    },
    remove(id) {
      requireAdmin();
      const used = db.prepare('SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1').get(id);
      if (used) db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
      else db.prepare('DELETE FROM products WHERE id = ?').run(id);
      return true;
    },
    adjustStock({ productId, qty, reason = 'adjust' }) {
      const u = requireAdmin();
      if (!['adjust', 'purchase'].includes(reason)) throw new PosError('INVALID_REASON');
      transaction(db, () => moveStock(productId, num(qty), reason, null, u.id));
      return plain(db.prepare('SELECT stock FROM products WHERE id = ?').get(productId));
    },
    lowStock() {
      requireUser();
      return plainAll(db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND p.track_stock = 1 AND p.stock <= p.min_stock ORDER BY p.stock`).all());
    },
  };

  function moveStock(productId, qty, reason, refId, userId) {
    if (!qty) return;
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND track_stock = 1').run(qty, productId);
    db.prepare('INSERT INTO stock_moves (product_id, qty, reason, ref_id, user_id) VALUES (?, ?, ?, ?, ?)').run(productId, qty, reason, refId, userId);
  }

  // ---------- restaurant tables ----------
  const tables = {
    list() {
      requireUser();
      return plainAll(db.prepare(`
        SELECT t.*, o.id AS order_id, o.total AS order_total, o.created_at AS order_opened_at
        FROM dining_tables t
        LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
        WHERE t.active = 1 ORDER BY t.area, CAST(t.name AS INTEGER), t.name`).all());
    },
    save(t = {}) {
      requireAdmin();
      if (!str(t.name)) throw new PosError('NAME_REQUIRED');
      if (t.id) {
        db.prepare('UPDATE dining_tables SET name = ?, area = ?, seats = ? WHERE id = ?').run(str(t.name), str(t.area), int(t.seats, 4), t.id);
        return t.id;
      }
      return Number(db.prepare('INSERT INTO dining_tables (name, area, seats) VALUES (?, ?, ?)').run(str(t.name), str(t.area), int(t.seats, 4)).lastInsertRowid);
    },
    remove(id) {
      requireAdmin();
      if (db.prepare("SELECT 1 FROM orders WHERE table_id = ? AND status = 'open'").get(id)) throw new PosError('TABLE_BUSY');
      db.prepare('UPDATE dining_tables SET active = 0 WHERE id = ?').run(id);
      return true;
    },
  };

  // ---------- shifts ----------
  function currentShift() {
    return plain(db.prepare('SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1').get()) || null;
  }

  function shiftSummary(shiftId) {
    const shift = plain(db.prepare('SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(shiftId));
    if (!shift) throw new PosError('NOT_FOUND');
    const sales = plain(db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(discount), 0) AS discount, COALESCE(SUM(tax), 0) AS tax FROM orders WHERE shift_id = ? AND status = 'completed'").get(shiftId));
    const byMethod = plainAll(db.prepare("SELECT p.method, SUM(p.amount) AS amount FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.shift_id = ? AND o.status = 'completed' GROUP BY p.method").all(shiftId));
    const refunds = plain(db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(CASE WHEN method = \'cash\' THEN amount ELSE 0 END), 0) AS cash FROM returns WHERE shift_id = ?').get(shiftId));
    const cashSales = byMethod.find((m) => m.method === 'cash')?.amount || 0;
    const expectedCash = shift.opening_cash + cashSales - refunds.cash;
    return { shift, sales, byMethod, refunds, expectedCash };
  }

  const shifts = {
    current() {
      requireUser();
      return currentShift();
    },
    open({ openingCash = 0 } = {}) {
      const u = requireUser();
      if (currentShift()) throw new PosError('SHIFT_ALREADY_OPEN');
      const id = Number(db.prepare('INSERT INTO shifts (user_id, opening_cash) VALUES (?, ?)').run(u.id, Math.max(0, int(openingCash))).lastInsertRowid);
      return plain(db.prepare('SELECT * FROM shifts WHERE id = ?').get(id));
    },
    close({ countedCash = 0, notes = '' } = {}) {
      requireUser();
      const shift = currentShift();
      if (!shift) throw new PosError('NO_OPEN_SHIFT');
      return transaction(db, () => {
        const { expectedCash } = shiftSummary(shift.id);
        db.prepare("UPDATE shifts SET closed_at = datetime('now', 'localtime'), counted_cash = ?, expected_cash = ?, notes = ? WHERE id = ?")
          .run(int(countedCash), expectedCash, str(notes), shift.id);
        return shiftSummary(shift.id);
      });
    },
    summary(id) {
      requireUser();
      return shiftSummary(id || currentShift()?.id);
    },
    list({ limit = 50 } = {}) {
      requireAdmin();
      return plainAll(db.prepare('SELECT s.*, u.name AS user_name FROM shifts s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT ?').all(int(limit, 50)));
    },
  };

  // ---------- orders ----------
  function getOrder(id) {
    const order = plain(db.prepare(`
      SELECT o.*, u.name AS user_name, t.name AS table_name
      FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN dining_tables t ON t.id = o.table_id
      WHERE o.id = ?`).get(id));
    if (!order) throw new PosError('NOT_FOUND');
    order.items = plainAll(db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id));
    order.payments = plainAll(db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id').all(id));
    order.returns = plainAll(db.prepare('SELECT r.*, u.name AS user_name FROM returns r JOIN users u ON u.id = r.user_id WHERE r.order_id = ? ORDER BY r.id').all(id));
    return order;
  }

  /**
   * Re-prices a cart from the database so the renderer can never dictate
   * prices, then computes totals with the current tax/service settings.
   */
  function priceCart(cart) {
    const s = getSettings();
    const items = (cart.items || []).map((it) => {
      const qty = num(it.qty);
      if (!(qty > 0)) throw new PosError('INVALID_QTY');
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
      if (!p) throw new PosError('PRODUCT_NOT_FOUND');
      return {
        id: it.id || null,
        product_id: p.id,
        name: p.name,
        unit_price: p.price,
        unit_cost: p.cost,
        qty,
        discount: Math.max(0, int(it.discount)),
        note: str(it.note),
        track_stock: p.track_stock,
        stock: p.stock,
      };
    });
    const orderType = ['sale', 'dine_in', 'takeaway', 'delivery'].includes(cart.order_type) ? cart.order_type : 'sale';
    const totals = computeTotals(items, {
      discount: int(cart.discount),
      taxRate: s.tax_rate,
      pricesIncludeTax: s.prices_include_tax,
      serviceRate: orderType === 'dine_in' ? s.service_rate : 0,
    });
    return { settings: s, orderType, ...totals };
  }

  // Writes header + lines of an order inside the caller's transaction.
  function persistOrder(cart, priced, user, status) {
    const header = {
      order_type: priced.orderType,
      table_id: priced.orderType === 'dine_in' ? cart.table_id || null : null,
      user_id: user.id,
      customer_name: str(cart.customer_name),
      customer_phone: str(cart.customer_phone),
      customer_address: str(cart.customer_address),
      note: str(cart.note),
      subtotal: priced.subtotal,
      discount: priced.discount,
      tax: priced.tax,
      service: priced.service,
      total: priced.total,
    };
    let orderId = cart.id || null;
    if (orderId) {
      const existing = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
      if (!existing || existing.status !== 'open') throw new PosError('ORDER_NOT_OPEN');
      const keys = Object.keys(header);
      db.prepare(`UPDATE orders SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => header[k]), orderId);
    } else {
      if (header.table_id && db.prepare("SELECT 1 FROM orders WHERE table_id = ? AND status = 'open'").get(header.table_id)) {
        throw new PosError('TABLE_BUSY');
      }
      const keys = Object.keys(header);
      orderId = Number(
        db.prepare(`INSERT INTO orders (status, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`)
          .run(status, ...keys.map((k) => header[k])).lastInsertRowid,
      );
    }

    // Sync lines: update known ids, insert new ones, drop the rest.
    const keep = [];
    for (const l of priced.lines) {
      const owned = l.id && db.prepare('SELECT id FROM order_items WHERE id = ? AND order_id = ?').get(l.id, orderId);
      if (owned) {
        db.prepare('UPDATE order_items SET product_id = ?, name = ?, unit_price = ?, unit_cost = ?, qty = ?, discount = ?, line_total = ?, note = ? WHERE id = ?')
          .run(l.product_id, l.name, l.unit_price, l.unit_cost, l.qty, l.discount, l.line_total, l.note, l.id);
        keep.push(l.id);
      } else {
        keep.push(Number(
          db.prepare('INSERT INTO order_items (order_id, product_id, name, unit_price, unit_cost, qty, discount, line_total, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(orderId, l.product_id, l.name, l.unit_price, l.unit_cost, l.qty, l.discount, l.line_total, l.note).lastInsertRowid,
        ));
      }
    }
    const existingIds = db.prepare('SELECT id FROM order_items WHERE order_id = ?').all(orderId).map((r) => r.id);
    for (const id of existingIds) if (!keep.includes(id)) db.prepare('DELETE FROM order_items WHERE id = ?').run(id);
    return orderId;
  }

  const orders = {
    quote(cart = {}) {
      requireUser();
      const { settings: _s, lines, ...rest } = priceCart(cart);
      return { ...rest, lines: lines.map(({ track_stock, stock, ...l }) => l) };
    },
    saveOpen(cart = {}) {
      const u = requireUser();
      if (!cart.items?.length) throw new PosError('EMPTY_CART');
      return transaction(db, () => getOrder(persistOrder(cart, priceCart(cart), u, 'open')));
    },
    listOpen() {
      requireUser();
      return plainAll(db.prepare(`
        SELECT o.*, t.name AS table_name, u.name AS user_name,
          (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
        FROM orders o LEFT JOIN dining_tables t ON t.id = o.table_id JOIN users u ON u.id = o.user_id
        WHERE o.status = 'open' ORDER BY o.created_at`).all());
    },
    get(id) {
      requireUser();
      return getOrder(id);
    },
    /** Marks unsent quantities as sent and returns them for the kitchen ticket. */
    sendToKitchen(id) {
      requireUser();
      return transaction(db, () => {
        const order = getOrder(id);
        if (order.status !== 'open') throw new PosError('ORDER_NOT_OPEN');
        const pending = order.items
          .filter((i) => i.qty > i.kitchen_sent)
          .map((i) => ({ name: i.name, qty: i.qty - i.kitchen_sent, note: i.note }));
        db.prepare('UPDATE order_items SET kitchen_sent = qty WHERE order_id = ?').run(id);
        return { order: getOrder(id), items: pending };
      });
    },
    voidOpen(id) {
      const u = requireUser();
      return transaction(db, () => {
        const order = getOrder(id);
        if (order.status !== 'open') throw new PosError('ORDER_NOT_OPEN');
        if (u.role !== 'admin' && order.items.some((i) => i.kitchen_sent > 0)) throw new PosError('FORBIDDEN');
        db.prepare("UPDATE orders SET status = 'void' WHERE id = ?").run(id);
        return true;
      });
    },
    checkout(cart = {}) {
      const u = requireUser();
      const shift = currentShift();
      if (!shift) throw new PosError('NO_OPEN_SHIFT');
      if (!cart.items?.length) throw new PosError('EMPTY_CART');
      return transaction(db, () => {
        const priced = priceCart(cart);
        if (!priced.settings.allow_negative_stock) {
          const need = new Map();
          for (const l of priced.lines) if (l.track_stock) need.set(l.product_id, (need.get(l.product_id) || 0) + l.qty);
          for (const l of priced.lines) if (l.track_stock && need.get(l.product_id) > l.stock) throw new PosError('OUT_OF_STOCK', l.name);
        }

        const payments = (cart.payments || [])
          .map((p) => ({ method: p.method, amount: int(p.amount) }))
          .filter((p) => p.amount > 0);
        if (payments.some((p) => !PAYMENT_METHODS.includes(p.method))) throw new PosError('INVALID_PAYMENT');
        if (!payments.length && priced.total > 0) throw new PosError('PAYMENT_REQUIRED');
        const tendered = payments.reduce((s, p) => s + p.amount, 0);
        if (tendered < priced.total) throw new PosError('INSUFFICIENT_PAYMENT');
        const nonCash = payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amount, 0);
        if (nonCash > priced.total) throw new PosError('NON_CASH_OVERPAY');
        const change = tendered - priced.total;

        const orderId = persistOrder(cart, priced, u, 'completed');
        const invoiceNo = (db.prepare('SELECT MAX(invoice_no) AS n FROM orders').get().n || 0) + 1;
        db.prepare("UPDATE orders SET status = 'completed', invoice_no = ?, shift_id = ?, user_id = ?, paid = ?, change_due = ?, completed_at = datetime('now', 'localtime') WHERE id = ?")
          .run(invoiceNo, shift.id, u.id, tendered, change, orderId);

        // Store net amounts per method: change always comes out of cash.
        let changeLeft = change;
        const insPay = db.prepare('INSERT INTO payments (order_id, method, amount) VALUES (?, ?, ?)');
        for (const p of payments) {
          let amount = p.amount;
          if (p.method === 'cash' && changeLeft > 0) {
            const take = Math.min(amount, changeLeft);
            amount -= take;
            changeLeft -= take;
          }
          if (amount > 0) insPay.run(orderId, p.method, amount);
        }

        for (const l of priced.lines) if (l.track_stock) moveStock(l.product_id, -l.qty, 'sale', orderId, u.id);
        return getOrder(orderId);
      });
    },
    list({ from, to, search = '', limit = 200 } = {}) {
      requireUser();
      const [f, t] = dateRange(from, to);
      const params = [f, t];
      let extra = '';
      if (str(search)) {
        extra = 'AND (CAST(o.invoice_no AS TEXT) = ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)';
        params.push(str(search), `%${str(search)}%`, `%${str(search)}%`);
      }
      params.push(int(limit, 200));
      return plainAll(db.prepare(`
        SELECT o.*, u.name AS user_name FROM orders o JOIN users u ON u.id = o.user_id
        WHERE o.status = 'completed' AND o.completed_at >= ? AND o.completed_at < date(?, '+1 day') ${extra}
        ORDER BY o.id DESC LIMIT ?`).all(...params));
    },
    /** Returns items from a completed order; refunded in cash from the open shift. */
    refund({ orderId, items = [], reason = '' } = {}) {
      const u = requireAdmin();
      const shift = currentShift();
      if (!shift) throw new PosError('NO_OPEN_SHIFT');
      return transaction(db, () => {
        const order = getOrder(orderId);
        if (order.status !== 'completed') throw new PosError('ORDER_NOT_COMPLETED');
        const lines = [];
        for (const r of items) {
          const qty = num(r.qty);
          if (!(qty > 0)) continue;
          const line = order.items.find((i) => i.id === r.order_item_id);
          if (!line) throw new PosError('NOT_FOUND');
          if (qty > line.qty - line.returned_qty + 1e-9) throw new PosError('RETURN_EXCEEDS_SOLD', line.name);
          // Each line's share of the final total, so order discount/tax/service are refunded proportionally.
          const share = order.subtotal > 0 ? (line.line_total * (qty / line.qty)) / order.subtotal : 0;
          lines.push({ line, qty, amount: Math.round(order.total * share) });
        }
        if (!lines.length) throw new PosError('NOTHING_TO_RETURN');
        let amount = lines.reduce((s, l) => s + l.amount, 0);
        const fullyReturned = order.items.every((i) => {
          const r = lines.find((l) => l.line.id === i.id);
          return i.qty - i.returned_qty - (r ? r.qty : 0) <= 1e-9;
        });
        const remaining = order.total - order.refunded;
        // Absorb rounding so a full return refunds exactly what was paid.
        if (fullyReturned || amount > remaining) amount = remaining;

        const returnId = Number(
          db.prepare("INSERT INTO returns (order_id, shift_id, user_id, amount, method, reason) VALUES (?, ?, ?, ?, 'cash', ?)")
            .run(orderId, shift.id, u.id, amount, str(reason)).lastInsertRowid,
        );
        for (const l of lines) {
          db.prepare('INSERT INTO return_items (return_id, order_item_id, qty, amount) VALUES (?, ?, ?, ?)').run(returnId, l.line.id, l.qty, l.amount);
          db.prepare('UPDATE order_items SET returned_qty = returned_qty + ? WHERE id = ?').run(l.qty, l.line.id);
          const p = l.line.product_id && db.prepare('SELECT track_stock FROM products WHERE id = ?').get(l.line.product_id);
          if (p && p.track_stock) moveStock(l.line.product_id, l.qty, 'return', returnId, u.id);
        }
        db.prepare('UPDATE orders SET refunded = refunded + ? WHERE id = ?').run(amount, orderId);
        return getOrder(orderId);
      });
    },
  };

  // ---------- reports ----------
  const reports = {
    summary({ from, to } = {}) {
      requireAdmin();
      const [f, t] = dateRange(from, to);
      const range = "o.status = 'completed' AND o.completed_at >= ? AND o.completed_at < date(?, '+1 day')";
      const totals = plain(db.prepare(`
        SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS gross, COALESCE(SUM(discount), 0) AS discount,
               COALESCE(SUM(tax), 0) AS tax, COALESCE(SUM(service), 0) AS service
        FROM orders o WHERE ${range}`).get(f, t));
      const refunds = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM returns WHERE created_at >= ? AND created_at < date(?, '+1 day')").get(f, t).total;
      const cost = db.prepare(`
        SELECT COALESCE(SUM(i.unit_cost * (i.qty - i.returned_qty)), 0) AS cost,
               COALESCE(SUM(i.line_total * (i.qty - i.returned_qty) / i.qty), 0) AS revenue
        FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${range}`).get(f, t);
      return {
        from: f,
        to: t,
        totals: {
          ...totals,
          refunds,
          net: totals.gross - refunds,
          average: totals.orders ? Math.round(totals.gross / totals.orders) : 0,
          profit: Math.round(cost.revenue - cost.cost),
        },
        byMethod: plainAll(db.prepare(`SELECT p.method, SUM(p.amount) AS amount, COUNT(DISTINCT p.order_id) AS orders FROM payments p JOIN orders o ON o.id = p.order_id WHERE ${range} GROUP BY p.method ORDER BY amount DESC`).all(f, t)),
        byDay: plainAll(db.prepare(`SELECT date(o.completed_at) AS day, COUNT(*) AS orders, SUM(o.total) AS total FROM orders o WHERE ${range} GROUP BY day ORDER BY day`).all(f, t)),
        byHour: plainAll(db.prepare(`SELECT CAST(strftime('%H', o.completed_at) AS INTEGER) AS hour, COUNT(*) AS orders, SUM(o.total) AS total FROM orders o WHERE ${range} GROUP BY hour ORDER BY hour`).all(f, t)),
        byType: plainAll(db.prepare(`SELECT o.order_type, COUNT(*) AS orders, SUM(o.total) AS total FROM orders o WHERE ${range} GROUP BY o.order_type ORDER BY total DESC`).all(f, t)),
        topProducts: plainAll(db.prepare(`
          SELECT i.name, SUM(i.qty - i.returned_qty) AS qty, SUM(i.line_total * (i.qty - i.returned_qty) / i.qty) AS total
          FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${range}
          GROUP BY COALESCE(i.product_id, i.name) ORDER BY total DESC LIMIT 15`).all(f, t)),
        byCategory: plainAll(db.prepare(`
          SELECT COALESCE(c.name, '') AS name, SUM(i.line_total * (i.qty - i.returned_qty) / i.qty) AS total
          FROM order_items i JOIN orders o ON o.id = i.order_id
          LEFT JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id
          WHERE ${range} GROUP BY c.id ORDER BY total DESC`).all(f, t)),
        byCashier: plainAll(db.prepare(`SELECT u.name, COUNT(*) AS orders, SUM(o.total) AS total FROM orders o JOIN users u ON u.id = o.user_id WHERE ${range} GROUP BY u.id ORDER BY total DESC`).all(f, t)),
      };
    },
  };

  return { session, settings, auth, users, categories, products, tables, shifts, orders, reports, requireAdmin };
}

module.exports = { createServices, PosError, DEFAULT_SETTINGS, hashPin, verifyPin };
