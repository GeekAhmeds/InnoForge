'use strict';
const crypto = require('node:crypto');
const { transaction } = require('../db.cjs');
const { computeTotals } = require('./totals.cjs');
const { PERMISSIONS, ROLE_DEFAULTS, effectivePermissions, parseOverrides } = require('./permissions.cjs');

const DEFAULT_SETTINGS = {
  setup_done: false,
  business_name: '',
  business_type: 'retail', // retail | bookstore | restaurant | trading
  sell_screens: '', // enabled selling screens: cashier,restaurant,trading ('' = by business type)
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
  business_logo: '', // data URL shown on A4 invoices / quotes
  invoice_format: 'thermal', // thermal | a4 — what the payment screen prints
  a4_printer_name: '',
  a4_terms: '',
  overdue_days: 30,
  loyalty_enabled: false,
  loyalty_earn_per: 10, // spend this much (major units) to earn 1 point
  loyalty_point_value: 10, // value of 1 point in minor units (10 = 0.10)
  loyalty_min_redeem: 100,
  label_printer_name: '',
  label_size: '38x25',
  kitchen_auto_send: true, // paying an order sends its unsent kitchen items (takeaway paid at once)
  kds_lan: false, // let tablets on the local network open the kitchen screen
  kds_port: 7799,
  kds_key: '',
  // Label-printing scales print EAN-13 barcodes: prefix + item code (PLU) + weight or price + check digit.
  scale_barcodes: false,
  scale_prefixes: '21,22,23,24,25,26,27,28,29',
  scale_code_digits: 5,
  scale_value: 'weight', // weight | price
  scale_value_decimals: 3, // weight in grams → 3; price in piasters → 2
  // A scale connected to this computer (serial / USB-serial) sends the weight continuously or on request.
  scale_serial: false,
  scale_port: '',
  scale_baud: 9600,
  scale_request: '', // '' (scale streams) | 'W' | 'ENQ' | 'P' — sent to ask for a reading
  cash_drawer: false, // open the drawer (through the receipt printer) on cash sales
  drawer_pin: 0, // ESC/POS drawer connector: 0 = pin 2, 1 = pin 5
  display_message: '', // customer display: line shown when idle (offers, welcome)
  customer_display: false, // open the customer-facing screen with the cashier
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
const PAYMENT_METHODS = ['cash', 'card', 'wallet', 'bank', 'other'];
// Ways a customer can settle their account (a cheque counts once received; it is reversed if it bounces).
const COLLECT_METHODS = [...PAYMENT_METHODS, 'cheque'];

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
    return requirePerm('users').user;
  }

  const permsOf = (u) => effectivePermissions(u);
  // Actions a supervisor can unlock on the spot with their PIN; the rest are simply forbidden.
  const APPROVABLE = new Set(['discount', 'price_override', 'credit_sale', 'refund', 'void', 'expenses', 'open_drawer']);
  const can = (perm, u = session.user) => !!permsOf(u)[perm];

  /**
   * Checks a permission for the logged-in user. If they lack it, another user's
   * credentials ({ username, pin }) can approve the action, provided that user has
   * both the permission and 'approve'. `extra(perms)` adds a condition such as a
   * discount ceiling. Returns { user, approvedBy }.
   */
  function requirePerm(perm, approval = null, extra = null) {
    const user = requireUser();
    const ok = (u) => { const p = permsOf(u); return (!perm || p[perm]) && (!extra || extra(p)); };
    if (ok(user)) return { user, approvedBy: null };
    if (perm && !APPROVABLE.has(perm)) throw new PosError('FORBIDDEN');
    if (!approval?.username) throw new PosError('APPROVAL_REQUIRED', perm || 'discount');
    const approver = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(str(approval.username));
    if (!approver || !verifyPin(approval.pin, approver.pin_hash)) {
      audit('approval_failed', { details: { perm, approver: str(approval.username) } });
      throw new PosError('BAD_CREDENTIALS');
    }
    if (approver.id === user.id || !permsOf(approver).approve || !ok(approver)) throw new PosError('APPROVER_NOT_ALLOWED');
    return { user, approvedBy: plain(approver) };
  }

  /** Appends to the activity log; never lets logging break the action itself. */
  function audit(action, { entity = '', entityId = null, details = '', approvedBy = null, userId } = {}) {
    // Failures are usually followed by a rollback that would erase the entry, so write those
    // once the current transaction has finished.
    if (db.isTransaction && /_failed$/.test(action)) {
      const uid = userId !== undefined ? userId : session.user?.id ?? null;
      setImmediate(() => audit(action, { entity, entityId, details, approvedBy, userId: uid }));
      return;
    }
    try {
      db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, details, approved_by) VALUES (?, ?, ?, ?, ?, ?)').run(
        userId !== undefined ? userId : session.user?.id ?? null, action, entity, entityId,
        typeof details === 'string' ? details : JSON.stringify(details), approvedBy?.id ?? approvedBy ?? null,
      );
    } catch { /* logging is best-effort */ }
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
      requirePerm('settings');
      audit('settings_change', { details: { keys: Object.keys(patch || {}) } });
      if (patch && 'business_type' in patch && !['retail', 'bookstore', 'restaurant', 'trading'].includes(patch.business_type)) {
        throw new PosError('INVALID_BUSINESS_TYPE');
      }
      // The kitchen screen key only changes through newKdsKey (forms send stale copies of it).
      const { kds_key: _key, ...rest } = patch || {};
      transaction(db, () => writeSettings(rest));
      return getSettings();
    },
  };

  // ---------- auth & users ----------
  const publicUser = (u) => u && {
    id: u.id, name: u.name, username: u.username, role: u.role, active: !!u.active,
    commission_rate: u.commission_rate || 0, overrides: parseOverrides(u.permissions), perms: permsOf(u),
  };

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
    /** Users who can approve restricted actions (shown in the approval dialog). */
    approvers() {
      requireUser();
      return db.prepare('SELECT * FROM users WHERE active = 1 ORDER BY name').all()
        .filter((u) => u.id !== session.user.id && permsOf(u).approve)
        .map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role }));
    },
    /** People sales can be credited to (for commissions). */
    salespeople() {
      requireUser();
      return plainAll(db.prepare('SELECT id, name, commission_rate FROM users WHERE active = 1 ORDER BY name').all());
    },
    login({ username, pin }) {
      const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(str(username));
      if (!u || !verifyPin(pin, u.pin_hash)) {
        audit('login_failed', { userId: u?.id ?? null, details: { username: str(username) } });
        throw new PosError('BAD_CREDENTIALS');
      }
      session.user = plain(u);
      audit('login');
      return publicUser(session.user);
    },
    logout() {
      if (session.user) audit('logout');
      session.user = null;
      return true;
    },
    /** Role defaults for the permissions screen. */
    permissionCatalog() {
      return { permissions: PERMISSIONS, roles: ROLE_DEFAULTS };
    },
  };

  const users = {
    list() {
      requirePerm('users');
      return db.prepare('SELECT * FROM users ORDER BY name').all().map(publicUser);
    },
    save(u = {}) {
      const me = requirePerm('users').user;
      const role = ['admin', 'supervisor'].includes(u.role) ? u.role : 'cashier';
      if (!str(u.name) || !str(u.username)) throw new PosError('NAME_REQUIRED');
      // Only admins can create or edit admins.
      const target = u.id ? db.prepare('SELECT role FROM users WHERE id = ?').get(u.id) : null;
      if ((role === 'admin' || target?.role === 'admin') && me.role !== 'admin') throw new PosError('FORBIDDEN');
      const overrides = JSON.stringify(parseOverrides(u.overrides || {}));
      const commission = Math.min(100, Math.max(0, num(u.commission_rate)));
      return transaction(db, () => {
        if (u.id) {
          if (u.id === me.id && (role !== me.role || u.active === false)) throw new PosError('CANNOT_DEMOTE_SELF');
          db.prepare('UPDATE users SET name = ?, username = ?, role = ?, active = ?, permissions = ?, commission_rate = ? WHERE id = ?').run(
            str(u.name), str(u.username), role, u.active === false ? 0 : 1, overrides, commission, u.id,
          );
          audit('user_update', { entity: 'user', entityId: u.id, details: { role, active: u.active !== false, overrides: JSON.parse(overrides), pinChanged: !!u.pin } });
          if (u.pin) {
            validatePin(u.pin);
            db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(u.pin), u.id);
          }
          return u.id;
        }
        validatePin(u.pin);
        const id = Number(
          db.prepare('INSERT INTO users (name, username, pin_hash, role, permissions, commission_rate) VALUES (?, ?, ?, ?, ?, ?)').run(
            str(u.name), str(u.username), hashPin(u.pin), role, overrides, commission,
          ).lastInsertRowid,
        );
        audit('user_create', { entity: 'user', entityId: id, details: { role } });
        return id;
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
      requirePerm('products');
      if (!str(c.name)) throw new PosError('NAME_REQUIRED');
      if (c.id) {
        db.prepare('UPDATE categories SET name = ?, color = ?, sort = ? WHERE id = ?').run(str(c.name), str(c.color) || '#0a43c9', int(c.sort), c.id);
        return c.id;
      }
      return Number(db.prepare('INSERT INTO categories (name, color, sort) VALUES (?, ?, ?)').run(str(c.name), str(c.color) || '#0a43c9', int(c.sort)).lastInsertRowid);
    },
    remove(id) {
      requirePerm('products');
      db.prepare('DELETE FROM categories WHERE id = ?').run(id);
      audit('category_delete', { entity: 'category', entityId: id });
      return true;
    },
  };

  const PRODUCT_SELECT = `SELECT p.*, c.name AS category_name, c.color AS category_color,
      (SELECT COUNT(*) FROM product_modifier_groups pmg JOIN modifier_groups g ON g.id = pmg.group_id WHERE pmg.product_id = p.id AND g.active = 1) AS modifier_count,
      (SELECT COUNT(*) FROM recipe_items r WHERE r.product_id = p.id) AS recipe_count
    FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

  /** Attaches selling units and price-list prices ({ listId: price }) to product rows. */
  function withUnitsAndPrices(rows) {
    if (!rows.length) return rows;
    const ids = rows.map((r) => r.id);
    const marks = ids.map(() => '?').join(',');
    const units = db.prepare(`SELECT * FROM product_units WHERE product_id IN (${marks}) ORDER BY factor`).all(...ids);
    const prices = db.prepare(`SELECT * FROM product_prices WHERE product_id IN (${marks})`).all(...ids);
    return rows.map((r) => ({
      ...r,
      units: units.filter((u) => u.product_id === r.id).map(plain),
      prices: Object.fromEntries(prices.filter((x) => x.product_id === r.id).map((x) => [x.price_list_id, x.price])),
    }));
  }

  // Replaces a product's units / list prices when the editor sent them.
  function saveUnitsAndPrices(productId, p) {
    if (Array.isArray(p.units)) {
      const keep = [];
      for (const u of p.units) {
        const name = str(u.name);
        const factor = num(u.factor);
        if (!name || !(factor > 0)) throw new PosError('INVALID_UNIT');
        const barcode = str(u.barcode) || null;
        if (barcode && (db.prepare('SELECT 1 FROM products WHERE barcode = ? AND id != ?').get(barcode, productId)
          || db.prepare('SELECT 1 FROM product_units WHERE barcode = ? AND id != ?').get(barcode, u.id || 0))) throw new PosError('DUPLICATE_BARCODE');
        const price = u.price === '' || u.price == null ? null : Math.max(0, int(u.price));
        if (u.id && db.prepare('SELECT 1 FROM product_units WHERE id = ? AND product_id = ?').get(u.id, productId)) {
          db.prepare('UPDATE product_units SET name = ?, factor = ?, barcode = ?, price = ? WHERE id = ?').run(name, factor, barcode, price, u.id);
          keep.push(u.id);
        } else {
          keep.push(Number(db.prepare('INSERT INTO product_units (product_id, name, factor, barcode, price) VALUES (?, ?, ?, ?, ?)').run(productId, name, factor, barcode, price).lastInsertRowid));
        }
      }
      for (const { id } of db.prepare('SELECT id FROM product_units WHERE product_id = ?').all(productId)) {
        if (!keep.includes(id)) db.prepare('DELETE FROM product_units WHERE id = ?').run(id);
      }
    }
    if (p.prices && typeof p.prices === 'object') {
      for (const [listId, value] of Object.entries(p.prices)) {
        if (value === '' || value == null) db.prepare('DELETE FROM product_prices WHERE product_id = ? AND price_list_id = ?').run(productId, listId);
        else db.prepare('INSERT INTO product_prices (product_id, price_list_id, price) VALUES (?, ?, ?) ON CONFLICT(product_id, price_list_id) DO UPDATE SET price = excluded.price')
          .run(productId, Number(listId), Math.max(0, int(value)));
      }
    }
  }

  /**
   * Reads a label-printing scale's barcode (e.g. 21 01234 01250 7 = item 1234, 1.250 kg).
   * Returns the product with `scale: { qty, value, kind }`, or null when it is not one.
   */
  function scaleBarcode(code) {
    const s = getSettings();
    if (!s.scale_barcodes || !/^\d{13}$/.test(code)) return null;
    const prefixes = String(s.scale_prefixes).split(/[,\s]+/).filter(Boolean);
    const prefix = prefixes.find((p) => code.startsWith(p));
    if (!prefix) return null;
    const codeDigits = Math.min(6, Math.max(4, int(s.scale_code_digits, 5)));
    const plu = code.slice(prefix.length, prefix.length + codeDigits);
    const raw = code.slice(prefix.length + codeDigits, 12);
    if (!raw) return null;
    const row = db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND p.plu IS NOT NULL AND CAST(p.plu AS INTEGER) = ?`).get(Number(plu));
    if (!row) return null;
    const value = Number(raw) / 10 ** Math.max(0, int(s.scale_value_decimals, 3));
    // A price label: quantity = printed price ÷ price per kg.
    const qty = s.scale_value === 'price'
      ? (row.price > 0 ? Math.round(((value * 10 ** (s.decimals ?? 2)) / row.price) * 1000) / 1000 : 0)
      : Math.round(value * 1000) / 1000;
    if (!(qty > 0)) return null;
    const [p] = withUnitsAndPrices([plain(row)]);
    if (!can('view_cost')) delete p.cost;
    return { ...p, scale: { qty, value, kind: s.scale_value } };
  }

  // Replaces a product's modifier groups / recipe when the editor sent them.
  function saveModifiersAndRecipe(productId, p) {
    if (Array.isArray(p.modifier_group_ids)) {
      db.prepare('DELETE FROM product_modifier_groups WHERE product_id = ?').run(productId);
      p.modifier_group_ids.forEach((g, i) => db.prepare('INSERT OR IGNORE INTO product_modifier_groups (product_id, group_id, sort) VALUES (?, ?, ?)').run(productId, int(g), i));
    }
    if (Array.isArray(p.recipe)) {
      db.prepare('DELETE FROM recipe_items WHERE product_id = ?').run(productId);
      for (const r of p.recipe) {
        const ing = int(r.ingredient_id);
        if (!ing || ing === productId || !(num(r.qty) > 0)) continue;
        db.prepare('INSERT OR REPLACE INTO recipe_items (product_id, ingredient_id, qty) VALUES (?, ?, ?)').run(productId, ing, num(r.qty));
      }
    }
  }

  /**
   * Takes stock out (sign -1) or puts it back (+1) for `qty` of a sold line: a dish with a
   * recipe consumes its ingredients, other products their own stock; chosen modifiers
   * consume their ingredient too.
   */
  function consumeStock(productId, qty, factor, modifiers, sign, reason, refId, userId) {
    const recipe = db.prepare('SELECT ingredient_id, qty FROM recipe_items WHERE product_id = ?').all(productId);
    if (recipe.length) {
      for (const r of recipe) moveStock(r.ingredient_id, sign * r.qty * qty * factor, reason, refId, userId);
    } else if (db.prepare('SELECT track_stock FROM products WHERE id = ?').get(productId)?.track_stock) {
      moveStock(productId, sign * qty * factor, reason, refId, userId);
    }
    for (const m of modifiers || []) {
      const opt = db.prepare('SELECT ingredient_id, ingredient_qty FROM modifier_options WHERE id = ?').get(m.id);
      if (opt?.ingredient_id && opt.ingredient_qty > 0) moveStock(opt.ingredient_id, sign * opt.ingredient_qty * qty, reason, refId, userId);
    }
  }

  const products = {
    list({ search = '', categoryId = null, includeInactive = false, top = false, forSale = false } = {}) {
      requireUser();
      if (top) {
        // Best sellers of the last 30 days, for the cashier's quick tab.
        const rows = withUnitsAndPrices(plainAll(db.prepare(`${PRODUCT_SELECT}
          JOIN (SELECT i.product_id, SUM(i.qty) AS sold FROM order_items i JOIN orders o ON o.id = i.order_id
                WHERE o.status = 'completed' AND o.completed_at >= datetime('now', 'localtime', '-30 days') GROUP BY i.product_id) t ON t.product_id = p.id
          WHERE p.active = 1 AND p.is_ingredient = 0 ORDER BY t.sold DESC LIMIT 40`).all()));
        return can('view_cost') ? rows : rows.map(({ cost, ...r }) => r);
      }
      const where = [];
      const params = [];
      if (!includeInactive) where.push('p.active = 1');
      if (forSale) where.push('p.is_ingredient = 0');
      if (categoryId) { where.push('p.category_id = ?'); params.push(categoryId); }
      if (str(search)) {
        where.push('(p.name LIKE ? OR p.barcode LIKE ? OR p.author LIKE ?)');
        const q = `%${str(search)}%`;
        params.push(q, q, q);
      }
      const sql = `${PRODUCT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name LIMIT 500`;
      const rows = withUnitsAndPrices(plainAll(db.prepare(sql).all(...params)));
      return can('view_cost') ? rows : rows.map(({ cost, ...r }) => r);
    },
    get(id) {
      requireUser();
      const p = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id);
      if (!p) throw new PosError('NOT_FOUND');
      const [row] = withUnitsAndPrices([plain(p)]);
      row.modifier_group_ids = db.prepare('SELECT group_id FROM product_modifier_groups WHERE product_id = ? ORDER BY sort').all(id).map((r) => r.group_id);
      row.recipe = plainAll(db.prepare(`SELECT r.ingredient_id, r.qty, i.name, i.unit, i.cost FROM recipe_items r JOIN products i ON i.id = r.ingredient_id WHERE r.product_id = ? ORDER BY i.name`).all(id));
      row.recipe_cost = row.recipe.reduce((sum, r) => sum + Math.round(r.cost * r.qty), 0);
      if (!can('view_cost')) { delete row.cost; delete row.recipe_cost; row.recipe = row.recipe.map(({ cost, ...r }) => r); }
      return row;
    },
    /** Finds a product by its own barcode or one of its units' barcodes (returned as `unit`). */
    byBarcode(barcode) {
      requireUser();
      const code = str(barcode);
      const weighed = scaleBarcode(code);
      if (weighed) return weighed;
      const direct = db.prepare(`${PRODUCT_SELECT} WHERE p.barcode = ? AND p.active = 1`).get(code);
      if (direct) return withUnitsAndPrices([plain(direct)])[0];
      const unit = db.prepare('SELECT * FROM product_units WHERE barcode = ?').get(code);
      if (!unit) return null;
      const p = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ? AND p.active = 1`).get(unit.product_id);
      return p ? { ...withUnitsAndPrices([plain(p)])[0], unit: plain(unit) } : null;
    },
    /**
     * Gives products without a barcode an internal EAN-13 ("20" + id + check digit),
     * so their labels can be scanned. Returns how many were assigned.
     */
    generateBarcodes({ ids = null } = {}) {
      requirePerm('products');
      const rows = ids?.length
        ? db.prepare(`SELECT id FROM products WHERE (barcode IS NULL OR barcode = '') AND id IN (${ids.map(() => '?').join(',')})`).all(...ids)
        : db.prepare("SELECT id FROM products WHERE barcode IS NULL OR barcode = ''").all();
      const check = (d12) => String((10 - ([...d12].reduce((sum, c, i) => sum + Number(c) * (i % 2 ? 3 : 1), 0) % 10)) % 10);
      let n = 0;
      transaction(db, () => {
        for (const { id } of rows) {
          const d12 = `20${String(id).padStart(10, '0')}`;
          const code = d12 + check(d12);
          if (db.prepare('SELECT 1 FROM products WHERE barcode = ?').get(code) || db.prepare('SELECT 1 FROM product_units WHERE barcode = ?').get(code)) continue;
          db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run(code, id);
          n++;
        }
      });
      if (n) audit('barcodes_generated', { details: { count: n } });
      return n;
    },
    /** Products with stock in batches that expire within `days` (or already expired). */
    expiring({ days = 30 } = {}) {
      requireUser();
      return plainAll(db.prepare(`
        SELECT b.*, p.name, p.barcode, CAST(julianday(b.expiry_date) - julianday(date('now', 'localtime')) AS INTEGER) AS days_left
        FROM batches b JOIN products p ON p.id = b.product_id
        WHERE b.qty > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= date('now', 'localtime', ?)
        ORDER BY b.expiry_date`).all(`+${int(days, 30)} days`));
    },
    save(p = {}) {
      requirePerm('products');
      if (!str(p.name)) throw new PosError('NAME_REQUIRED');
      const price = int(p.price, -1);
      if (price < 0) throw new PosError('INVALID_PRICE');
      const fields = {
        name: str(p.name),
        barcode: str(p.barcode) || null,
        category_id: p.category_id || null,
        price,
        // Users who cannot see costs cannot overwrite them either.
        cost: can('view_cost') || !p.id ? Math.max(0, int(p.cost)) : db.prepare('SELECT cost FROM products WHERE id = ?').get(p.id)?.cost ?? 0,
        track_stock: p.track_stock === false ? 0 : 1,
        min_stock: num(p.min_stock),
        unit: str(p.unit) || 'pcs',
        author: str(p.author) || null,
        publisher: str(p.publisher) || null,
        kitchen: p.kitchen ? 1 : 0,
        station_id: 'station_id' in p ? int(p.station_id) || null : p.id ? db.prepare('SELECT station_id FROM products WHERE id = ?').get(p.id)?.station_id ?? null : null,
        supplier_id: 'supplier_id' in p ? int(p.supplier_id) || null : p.id ? db.prepare('SELECT supplier_id FROM products WHERE id = ?').get(p.id)?.supplier_id ?? null : null,
        track_expiry: p.track_expiry ? 1 : 0,
        by_weight: p.by_weight ? 1 : 0,
        is_ingredient: p.is_ingredient ? 1 : 0,
        plu: str(p.plu) || null,
        track_serial: p.track_serial ? 1 : 0,
        active: p.active === false ? 0 : 1,
      };
      if (fields.barcode) {
        const dup = db.prepare('SELECT id FROM products WHERE barcode = ? AND id != ?').get(fields.barcode, p.id || 0)
          || db.prepare('SELECT id FROM product_units WHERE barcode = ? AND product_id != ?').get(fields.barcode, p.id || 0);
        if (dup) throw new PosError('DUPLICATE_BARCODE');
      }
      const keys = Object.keys(fields);
      return transaction(db, () => {
        if (p.id) {
          const before = db.prepare('SELECT price, cost, active FROM products WHERE id = ?').get(p.id);
          db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), p.id);
          const changes = {};
          for (const k of ['price', 'cost', 'active']) if (before && before[k] !== fields[k]) changes[k] = [before[k], fields[k]];
          audit(changes.price ? 'product_price_change' : 'product_update', { entity: 'product', entityId: p.id, details: { name: fields.name, ...changes } });
          saveUnitsAndPrices(p.id, p);
          saveModifiersAndRecipe(p.id, p);
          return p.id;
        }
        const id = Number(
          db.prepare(`INSERT INTO products (${keys.join(', ')}, stock) VALUES (${keys.map(() => '?').join(', ')}, ?)`)
            .run(...keys.map((k) => fields[k]), 0).lastInsertRowid,
        );
        const initial = num(p.stock);
        if (initial) moveStock(id, initial, 'purchase', null, session.user.id);
        audit('product_create', { entity: 'product', entityId: id, details: { name: fields.name, price: fields.price } });
        saveUnitsAndPrices(id, p);
        saveModifiersAndRecipe(id, p);
        return id;
      });
    },
    remove(id) {
      requirePerm('products');
      const used = db.prepare('SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1').get(id);
      const name = db.prepare('SELECT name FROM products WHERE id = ?').get(id)?.name;
      if (used) db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
      else db.prepare('DELETE FROM products WHERE id = ?').run(id);
      audit(used ? 'product_deactivate' : 'product_delete', { entity: 'product', entityId: id, details: { name } });
      return true;
    },
    adjustStock({ productId, qty, reason = 'adjust' }) {
      const u = requirePerm('products').user;
      if (!['adjust', 'purchase'].includes(reason)) throw new PosError('INVALID_REASON');
      transaction(db, () => moveStock(productId, num(qty), reason, null, u.id));
      audit('stock_adjust', { entity: 'product', entityId: productId, details: { qty: num(qty), reason, name: db.prepare('SELECT name FROM products WHERE id = ?').get(productId)?.name } });
      return plain(db.prepare('SELECT stock FROM products WHERE id = ?').get(productId));
    },
    lowStock() {
      requireUser();
      return plainAll(db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND p.track_stock = 1 AND p.stock <= p.min_stock ORDER BY p.stock`).all());
    },
  };

  /**
   * Changes on-hand stock (base units) and, for expiry-tracked products, the batches:
   * removals consume the earliest expiry first; additions go to the given batch, or
   * back onto the latest-expiring batch when none is named (e.g. customer returns).
   */
  function moveStock(productId, qty, reason, refId, userId, batch = null) {
    if (!qty) return;
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ? AND track_stock = 1').run(qty, productId);
    db.prepare('INSERT INTO stock_moves (product_id, qty, reason, ref_id, user_id) VALUES (?, ?, ?, ?, ?)').run(productId, qty, reason, refId, userId);
    const p = db.prepare('SELECT track_expiry, track_stock FROM products WHERE id = ?').get(productId);
    if (!p?.track_expiry || !p.track_stock) return;
    if (qty < 0) {
      let left = -qty;
      const open = db.prepare("SELECT id, qty FROM batches WHERE product_id = ? AND qty > 0 ORDER BY COALESCE(expiry_date, '9999-12-31'), id").all(productId);
      for (const b of open) {
        if (left <= 1e-9) break;
        const take = Math.min(b.qty, left);
        db.prepare('UPDATE batches SET qty = qty - ? WHERE id = ?').run(take, b.id);
        left -= take;
      }
    } else if (batch && (batch.expiry || batch.batchNo)) {
      db.prepare('INSERT INTO batches (product_id, batch_no, expiry_date, qty, purchase_id) VALUES (?, ?, ?, ?, ?)')
        .run(productId, str(batch.batchNo), batch.expiry || null, qty, batch.purchaseId ?? null);
    } else {
      const last = db.prepare("SELECT id FROM batches WHERE product_id = ? ORDER BY COALESCE(expiry_date, '9999-12-31') DESC, id DESC LIMIT 1").get(productId);
      if (last) db.prepare('UPDATE batches SET qty = qty + ? WHERE id = ?').run(qty, last.id);
      else db.prepare('INSERT INTO batches (product_id, qty) VALUES (?, ?)').run(productId, qty);
    }
  }

  // ---------- restaurant tables ----------
  const tables = {
    list() {
      requireUser();
      return plainAll(db.prepare(`
        SELECT t.*, o.id AS order_id, o.total AS order_total, o.created_at AS order_opened_at, o.guests, o.check_printed_at,
          u.name AS waiter_name, o.customer_name,
          CAST((julianday('now', 'localtime') - julianday(o.created_at)) * 1440 AS INTEGER) AS minutes,
          (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count,
          (SELECT COUNT(*) FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id AND p.kitchen = 1 AND i.qty > i.kitchen_sent) AS unsent,
          (SELECT COUNT(*) FROM kitchen_tickets k WHERE k.order_id = o.id AND k.status = 'ready') AS ready
        FROM dining_tables t
        LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
        LEFT JOIN users u ON u.id = o.user_id
        WHERE t.active = 1 ORDER BY t.area, CAST(t.name AS INTEGER), t.name`).all());
    },
    save(t = {}) {
      requirePerm('settings');
      if (!str(t.name)) throw new PosError('NAME_REQUIRED');
      if (t.id) {
        db.prepare('UPDATE dining_tables SET name = ?, area = ?, seats = ? WHERE id = ?').run(str(t.name), str(t.area), int(t.seats, 4), t.id);
        return t.id;
      }
      return Number(db.prepare('INSERT INTO dining_tables (name, area, seats) VALUES (?, ?, ?)').run(str(t.name), str(t.area), int(t.seats, 4)).lastInsertRowid);
    },
    remove(id) {
      requirePerm('settings');
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
    const refunds = plain(db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(cash_amount), 0) AS cash FROM returns WHERE shift_id = ?').get(shiftId));
    const cashSales = byMethod.find((m) => m.method === 'cash')?.amount || 0;
    // Cash that left the drawer during the shift for suppliers or expenses.
    const supplierCash = db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM supplier_payments WHERE shift_id = ? AND from_drawer = 1').get(shiftId).t;
    const expenseCash = db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE shift_id = ? AND from_drawer = 1').get(shiftId).t;
    const creditSales = db.prepare("SELECT COALESCE(SUM(credit), 0) AS t FROM orders WHERE shift_id = ? AND status = 'completed'").get(shiftId).t;
    const collections = plainAll(db.prepare("SELECT method, SUM(amount) AS amount FROM customer_payments WHERE shift_id = ? AND method NOT IN ('return', 'discount') AND status = 'posted' GROUP BY method").all(shiftId));
    const customerCash = collections.find((c) => c.method === 'cash')?.amount || 0;
    const expectedCash = shift.opening_cash + cashSales + customerCash - refunds.cash - supplierCash - expenseCash;
    return { shift, sales, byMethod, refunds, supplierCash, expenseCash, creditSales, collections, customerCash, expectedCash };
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
      audit('shift_open', { entity: 'shift', entityId: id, details: { opening_cash: Math.max(0, int(openingCash)) } });
      return plain(db.prepare('SELECT * FROM shifts WHERE id = ?').get(id));
    },
    close({ countedCash = 0, notes = '' } = {}) {
      requireUser();
      const shift = currentShift();
      if (!shift) throw new PosError('NO_OPEN_SHIFT');
      return transaction(db, () => {
        const { expectedCash } = shiftSummary(shift.id);
        audit('shift_close', { entity: 'shift', entityId: shift.id, details: { expected: expectedCash, counted: int(countedCash), difference: int(countedCash) - expectedCash } });
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
      requirePerm('shifts_all');
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
    order.items = plainAll(db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id))
      .map((i) => ({ ...i, modifiers: i.modifiers ? JSON.parse(i.modifiers) : [] }));
    order.driver_name = order.driver_id ? db.prepare('SELECT name FROM drivers WHERE id = ?').get(order.driver_id)?.name || '' : '';
    order.zone_name = order.zone_id ? db.prepare('SELECT name FROM delivery_zones WHERE id = ?').get(order.zone_id)?.name || '' : '';
    order.payments = plainAll(db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY id').all(id));
    order.returns = plainAll(db.prepare('SELECT r.*, u.name AS user_name FROM returns r JOIN users u ON u.id = r.user_id WHERE r.order_id = ? ORDER BY r.id').all(id));
    order.customer_balance = order.customer_id ? customerBalance(order.customer_id) : null;
    order.customer = order.customer_id ? plain(db.prepare('SELECT id, name, phone, address, tax_number, points FROM customers WHERE id = ?').get(order.customer_id)) : null;
    if (order.customer_id && order.credit > 0 && order.status === 'completed') {
      order.open_amount = openItems(order.customer_id).debts.find((x) => x.order_id === order.id)?.open ?? 0;
    }
    return order;
  }

  /**
   * Re-prices a cart from the database so the renderer can never dictate
   * prices, then computes totals with the current tax/service settings.
   */
  // ---------- promotions ----------
  /** Promotions running right now (date range, weekday and time window). */
  function activePromotions(at = new Date()) {
    const date = at.toLocaleDateString('en-CA');
    const day = String(at.getDay());
    const time = at.toTimeString().slice(0, 5);
    return db.prepare('SELECT * FROM promotions WHERE active = 1').all().filter((p) =>
      (!p.start_date || p.start_date <= date) && (!p.end_date || p.end_date >= date)
      && (!p.days || p.days.split(',').includes(day))
      && (!p.time_from || !p.time_to || (p.time_from <= p.time_to ? time >= p.time_from && time <= p.time_to : time >= p.time_from || time <= p.time_to)));
  }

  /** Gives each line the single best promotion that applies to it (added to its discount). */
  function applyPromotions(items) {
    const promos = activePromotions();
    if (!promos.length) return;
    for (const it of items) {
      const gross = Math.round(it.unit_price * it.qty);
      let best = { amount: 0, name: '' };
      for (const p of promos) {
        if (p.scope === 'product' && p.target_id !== it.product_id) continue;
        if (p.scope === 'category' && p.target_id !== it.category_id) continue;
        if (p.min_qty && it.qty < p.min_qty) continue;
        let amount = 0;
        if (p.kind === 'percent') amount = Math.round((gross * p.value) / 100);
        else if (p.kind === 'amount') amount = Math.round(p.value * it.qty);
        else if (p.kind === 'buy_x_get_y' && p.buy_qty > 0 && p.get_qty > 0) {
          const free = Math.floor(it.qty / (p.buy_qty + p.get_qty)) * p.get_qty;
          amount = Math.round(free * it.unit_price);
        }
        amount = Math.min(amount, Math.max(0, gross - it.manual_discount - (it.customer_discount || 0)));
        if (amount > best.amount) best = { amount, name: p.name };
      }
      it.promo_discount = best.amount;
      it.promo_name = best.name;
      it.discount = it.manual_discount + (it.customer_discount || 0) + best.amount;
    }
  }

  const promotions = {
    list() {
      requireUser();
      return plainAll(db.prepare('SELECT * FROM promotions ORDER BY active DESC, id DESC').all());
    },
    active() {
      requireUser();
      return activePromotions().map(plain);
    },
    save(p = {}) {
      requirePerm('settings');
      if (!str(p.name)) throw new PosError('NAME_REQUIRED');
      if (!['percent', 'amount', 'buy_x_get_y'].includes(p.kind)) throw new PosError('INVALID_PROMO');
      const scope = ['all', 'category', 'product'].includes(p.scope) ? p.scope : 'all';
      if (scope !== 'all' && !int(p.target_id)) throw new PosError('INVALID_PROMO');
      if (p.kind === 'buy_x_get_y' && !(num(p.buy_qty) > 0 && num(p.get_qty) > 0)) throw new PosError('INVALID_PROMO');
      if (p.kind === 'percent' && !(num(p.value) > 0 && num(p.value) <= 100)) throw new PosError('INVALID_PROMO');
      const f = {
        name: str(p.name), kind: p.kind, scope, target_id: scope === 'all' ? null : int(p.target_id),
        value: p.kind === 'amount' ? Math.max(0, int(p.value)) : num(p.value), buy_qty: num(p.buy_qty), get_qty: num(p.get_qty), min_qty: num(p.min_qty),
        start_date: str(p.start_date) || null, end_date: str(p.end_date) || null,
        days: Array.isArray(p.days) ? p.days.join(',') : str(p.days), time_from: str(p.time_from), time_to: str(p.time_to), active: p.active === false ? 0 : 1,
      };
      const keys = Object.keys(f);
      audit('promo_save', { entity: 'promotion', entityId: p.id ?? null, details: { name: f.name, kind: f.kind } });
      if (p.id) {
        db.prepare(`UPDATE promotions SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), p.id);
        return p.id;
      }
      return Number(db.prepare(`INSERT INTO promotions (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => f[k])).lastInsertRowid);
    },
    remove(id) {
      requirePerm('settings');
      db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
      audit('promo_remove', { entity: 'promotion', entityId: id });
      return true;
    },
  };

  /** The price list a cart sells at: explicit choice, else the customer's list. */
  function cartPriceList(cart) {
    let id = int(cart.price_list_id) || null;
    if (!id && cart.customer_id) id = db.prepare('SELECT price_list_id FROM customers WHERE id = ?').get(cart.customer_id)?.price_list_id || null;
    return id && db.prepare('SELECT 1 FROM price_lists WHERE id = ? AND active = 1').get(id) ? id : null;
  }

  function priceCart(cart) {
    const s = getSettings();
    const priceListId = cartPriceList(cart);
    // A customer's standing discount applies to every line on its own (not the cashier's discount).
    const customerPct = cart.customer_id ? Math.min(100, Math.max(0, db.prepare('SELECT discount_percent FROM customers WHERE id = ?').get(cart.customer_id)?.discount_percent || 0)) : 0;
    const items = (cart.items || []).map((it) => {
      const qty = num(it.qty);
      if (!(qty > 0)) throw new PosError('INVALID_QTY');
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
      if (!p) throw new PosError('PRODUCT_NOT_FOUND');
      const unit = it.unit_id ? db.prepare('SELECT * FROM product_units WHERE id = ? AND product_id = ?').get(it.unit_id, p.id) : null;
      if (it.unit_id && !unit) throw new PosError('INVALID_UNIT');
      const factor = unit?.factor ?? 1;
      const listPrice = priceListId ? db.prepare('SELECT price FROM product_prices WHERE product_id = ? AND price_list_id = ?').get(p.id, priceListId)?.price : null;
      // Modifiers (size, extras): checked against the product's groups and their min/max.
      const modIds = (Array.isArray(it.modifiers) ? it.modifiers : []).map((m) => int(typeof m === 'object' ? m.id : m)).filter(Boolean);
      const groups = db.prepare('SELECT g.* FROM product_modifier_groups pmg JOIN modifier_groups g ON g.id = pmg.group_id WHERE pmg.product_id = ? AND g.active = 1').all(p.id);
      const mods = modIds.map((id) => db.prepare('SELECT * FROM modifier_options WHERE id = ? AND active = 1').get(id));
      if (mods.some((o) => !o || !groups.some((g) => g.id === o.group_id))) throw new PosError('INVALID_MODIFIER', p.name);
      for (const g of groups) {
        const n = mods.filter((o) => o.group_id === g.id).length;
        if (n < g.min_select || (g.max_select > 0 && n > g.max_select)) throw new PosError('MODIFIERS_REQUIRED', `${p.name}: ${g.name}`);
      }
      const modPrice = mods.reduce((sum, o) => sum + o.price, 0);
      const modCost = mods.reduce((sum, o) => sum + (o.ingredient_id ? Math.round((db.prepare('SELECT cost FROM products WHERE id = ?').get(o.ingredient_id)?.cost || 0) * o.ingredient_qty) : 0), 0);
      const recipeCost = db.prepare('SELECT COALESCE(SUM(i.cost * r.qty), 0) AS c, COUNT(*) AS n FROM recipe_items r JOIN products i ON i.id = r.ingredient_id WHERE r.product_id = ?').get(p.id);
      const standard = (unit?.price ?? Math.round((listPrice ?? p.price) * factor)) + modPrice;
      // The cart may only change a price when the line is explicitly flagged; checkout authorizes it.
      const overridePrice = it.price_override && int(it.unit_price, -1) >= 0 && int(it.unit_price) !== standard ? int(it.unit_price) : null;
      return {
        id: it.id || null,
        product_id: p.id,
        name: unit ? `${p.name} (${unit.name})` : p.name,
        unit_id: unit?.id ?? null,
        unit_name: unit?.name ?? '',
        unit_factor: factor,
        serials: str(it.serials),
        track_serial: p.track_serial,
        list_price: standard,
        price_override: overridePrice != null,
        unit_price: overridePrice ?? standard,
        unit_cost: (recipeCost.n ? Math.round(recipeCost.c) : Math.round(p.cost * factor)) + modCost,
        modifiers: mods.map((o) => ({ id: o.id, name: o.name, price: o.price })),
        modifiers_price: modPrice,
        qty,
        manual_discount: Math.max(0, int(it.discount)),
        customer_discount: 0,
        discount: Math.max(0, int(it.discount)),
        category_id: p.category_id,
        note: str(it.note),
        track_stock: p.track_stock,
        stock: p.stock,
      };
    });
    if (customerPct > 0) {
      for (const it of items) {
        const gross = Math.round(it.unit_price * it.qty);
        it.customer_discount = Math.round((Math.max(0, gross - it.manual_discount) * customerPct) / 100);
        it.discount = it.manual_discount + it.customer_discount;
      }
    }
    applyPromotions(items);
    const orderType = ['sale', 'dine_in', 'takeaway', 'delivery'].includes(cart.order_type) ? cart.order_type : 'sale';
    // Delivery: the zone's fee (or a typed fee), added after tax and never discounted.
    const zone = orderType === 'delivery' && int(cart.zone_id) ? db.prepare('SELECT * FROM delivery_zones WHERE id = ? AND active = 1').get(int(cart.zone_id)) : null;
    const deliveryFee = orderType === 'delivery' ? (zone ? zone.fee : Math.max(0, int(cart.delivery_fee))) : 0;
    const totals = computeTotals(items, {
      discount: int(cart.discount),
      taxRate: s.tax_rate,
      pricesIncludeTax: s.prices_include_tax,
      serviceRate: orderType === 'dine_in' ? s.service_rate : 0,
    });
    return { settings: s, orderType, priceListId, customerPct, ...totals, total: totals.total + deliveryFee, delivery_fee: deliveryFee, zone_id: zone?.id ?? null };
  }

  /**
   * Checks the cashier may give this cart's discounts / price changes, asking for a
   * supervisor's approval when they exceed their own limits. Logs what was granted.
   */
  function authorizeCart(priced, approval, { credit = 0 } = {}) {
    const gross = priced.lines.reduce((sum, l) => sum + Math.round(l.unit_price * l.qty), 0);
    // Automatic promotions are not the cashier's discount, so only manual ones count here.
    const discount = priced.lines.reduce((sum, l) => sum + Math.min(l.manual_discount, Math.round(l.unit_price * l.qty)), 0) + priced.discount;
    const pct = gross > 0 ? (discount / gross) * 100 : 0;
    const granted = [];
    if (discount > 0) {
      const r = requirePerm('discount', approval, (p) => pct <= (p.max_discount ?? 0) + 1e-9);
      granted.push({ action: 'discount', approvedBy: r.approvedBy, details: { amount: discount, pct: Math.round(pct * 10) / 10 } });
    }
    const overrides = priced.lines.filter((l) => l.price_override);
    if (overrides.length) {
      const r = requirePerm('price_override', approval);
      granted.push({ action: 'price_override', approvedBy: r.approvedBy, details: overrides.map((l) => ({ product: l.name, from: l.list_price, to: l.unit_price })) });
    }
    if (credit > 0) {
      const r = requirePerm('credit_sale', approval);
      granted.push({ action: 'credit_sale', approvedBy: r.approvedBy, details: { amount: credit } });
    }
    return granted;
  }

  // Writes header + lines of an order inside the caller's transaction.
  function persistOrder(cart, priced, user, status) {
    const header = {
      order_type: priced.orderType,
      table_id: priced.orderType === 'dine_in' ? cart.table_id || null : null,
      user_id: user.id,
      customer_id: int(cart.customer_id) || null,
      salesperson_id: int(cart.salesperson_id) || null,
      price_list_id: priced.priceListId,
      quote_id: int(cart.quote_id) || null,
      customer_name: str(cart.customer_name),
      customer_phone: str(cart.customer_phone),
      customer_address: str(cart.customer_address),
      note: str(cart.note),
      guests: Math.max(0, int(cart.guests)),
      zone_id: priced.zone_id,
      delivery_fee: priced.delivery_fee,
      driver_id: priced.orderType === 'delivery' ? int(cart.driver_id) || null : null,
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
        db.prepare('UPDATE order_items SET product_id = ?, name = ?, unit_price = ?, unit_cost = ?, qty = ?, discount = ?, line_total = ?, note = ?, unit_id = ?, unit_name = ?, unit_factor = ?, serials = ?, promo_discount = ?, promo_name = ?, customer_discount = ? WHERE id = ?')
          .run(l.product_id, l.name, l.unit_price, l.unit_cost, l.qty, l.discount, l.line_total, l.note, l.unit_id, l.unit_name, l.unit_factor, l.serials, l.promo_discount || 0, l.promo_name || '', l.customer_discount || 0, l.id);
        keep.push(l.id);
      } else {
        keep.push(Number(
          db.prepare('INSERT INTO order_items (order_id, product_id, name, unit_price, unit_cost, qty, discount, line_total, note, unit_id, unit_name, unit_factor, serials, promo_discount, promo_name, customer_discount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(orderId, l.product_id, l.name, l.unit_price, l.unit_cost, l.qty, l.discount, l.line_total, l.note, l.unit_id, l.unit_name, l.unit_factor, l.serials, l.promo_discount || 0, l.promo_name || '', l.customer_discount || 0).lastInsertRowid,
        ));
      }
    }
    priced.lines.forEach((l, i) => {
      db.prepare('UPDATE order_items SET modifiers = ?, modifiers_price = ? WHERE id = ?').run(l.modifiers?.length ? JSON.stringify(l.modifiers) : '', l.modifiers_price || 0, keep[i]);
    });
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
        const tickets = dispatchKitchen(order);
        return { order: getOrder(id), tickets, items: tickets.flatMap((tk) => tk.items) };
      });
    },
    /** Cancels an open order; once items reached the kitchen it needs the 'void' permission. */
    voidOpen(arg) {
      requireUser();
      const id = typeof arg === 'object' ? arg.id : arg;
      return transaction(db, () => {
        const order = getOrder(id);
        if (order.status !== 'open') throw new PosError('ORDER_NOT_OPEN');
        let approvedBy = null;
        if (order.items.some((i) => i.kitchen_sent > 0)) approvedBy = requirePerm('void', arg?.approval).approvedBy;
        db.prepare("UPDATE orders SET status = 'void' WHERE id = ?").run(id);
        db.prepare("UPDATE kitchen_tickets SET status = 'cancelled' WHERE order_id = ? AND status IN ('new', 'preparing', 'ready')").run(id);
        audit('order_void', { entity: 'order', entityId: id, approvedBy, details: { total: order.total, items: order.items.length, table: order.table_name } });
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
          for (const l of priced.lines) if (l.track_stock) need.set(l.product_id, (need.get(l.product_id) || 0) + l.qty * l.unit_factor);
          for (const l of priced.lines) if (l.track_stock && need.get(l.product_id) > l.stock) throw new PosError('OUT_OF_STOCK', l.name);
        }

        // Serial-tracked items need one serial number per piece sold.
        for (const l of priced.lines) {
          if (!l.track_serial) continue;
          const serials = l.serials.split(/[\s,،;]+/).filter(Boolean);
          if (serials.length !== Math.round(l.qty * l.unit_factor)) throw new PosError('SERIALS_REQUIRED', l.name);
        }
        const payments = (cart.payments || [])
          .map((p) => ({ method: p.method, amount: int(p.amount) }))
          .filter((p) => p.amount > 0);
        if (payments.some((p) => !PAYMENT_METHODS.includes(p.method))) throw new PosError('INVALID_PAYMENT');
        const customer = cart.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ? AND active = 1').get(cart.customer_id) : null;
        if (cart.customer_id && !customer) throw new PosError('CUSTOMER_NOT_FOUND');

        // Loyalty points redeemed count as a payment worth points × point value.
        const loyalty = priced.settings.loyalty_enabled && customer;
        const redeem = loyalty ? Math.max(0, Math.floor(num(cart.redeem_points))) : 0;
        if (num(cart.redeem_points) > 0 && !loyalty) throw new PosError('LOYALTY_UNAVAILABLE');
        if (redeem) {
          if (redeem > customer.points + 1e-9) throw new PosError('NOT_ENOUGH_POINTS');
          if (redeem < priced.settings.loyalty_min_redeem) throw new PosError('BELOW_MIN_REDEEM');
          const value = Math.round(redeem * priced.settings.loyalty_point_value);
          if (value > priced.total) throw new PosError('POINTS_EXCEED_TOTAL');
          payments.push({ method: 'points', amount: value });
        }
        const tendered = payments.reduce((s, p) => s + p.amount, 0);
        const nonCash = payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amount, 0);
        if (nonCash > priced.total) throw new PosError('NON_CASH_OVERPAY');

        // Anything not paid now goes on the customer's account (credit sale).
        let credit = 0;
        if (tendered < priced.total) {
          if (!customer) throw new PosError(payments.length ? 'INSUFFICIENT_PAYMENT' : 'PAYMENT_REQUIRED');
          credit = priced.total - tendered;
          if (customer.credit_limit > 0 && customerBalance(customer.id) + credit > customer.credit_limit) {
            throw new PosError('CREDIT_LIMIT_EXCEEDED');
          }
        }
        const change = Math.max(0, tendered - priced.total);
        const granted = authorizeCart(priced, cart.approval, { credit });

        const orderId = persistOrder(cart, priced, u, 'completed');
        const invoiceNo = (db.prepare('SELECT MAX(invoice_no) AS n FROM orders').get().n || 0) + 1;
        db.prepare("UPDATE orders SET status = 'completed', invoice_no = ?, shift_id = ?, user_id = ?, paid = ?, change_due = ?, credit = ?, completed_at = datetime('now', 'localtime') WHERE id = ?")
          .run(invoiceNo, shift.id, u.id, tendered, change, credit, orderId);
        if (credit > 0) {
          // When the unpaid part is due: an explicit date, else the customer's terms, else the general setting.
          const due = /^\d{4}-\d{2}-\d{2}$/.test(str(cart.due_date)) ? str(cart.due_date) : addDays(new Date().toLocaleDateString('en-CA'), termsOf(customer));
          db.prepare('UPDATE orders SET due_date = ? WHERE id = ?').run(due, orderId);
        }

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

        for (const l of priced.lines) consumeStock(l.product_id, l.qty, l.unit_factor, l.modifiers, -1, 'sale', orderId, u.id);
        if (priced.orderType === 'delivery') db.prepare("UPDATE orders SET delivery_status = 'delivered', delivered_at = datetime('now', 'localtime') WHERE id = ?").run(orderId);
        if (loyalty) {
          // Points are earned on what the customer actually pays for (not on points spent).
          const pointsValue = payments.find((p) => p.method === 'points')?.amount || 0;
          const unit = (priced.settings.loyalty_earn_per || 0) * 10 ** (priced.settings.decimals ?? 2);
          const earned = unit > 0 ? Math.floor((priced.total - pointsValue) / unit) : 0;
          if (redeem) db.prepare("INSERT INTO loyalty_moves (customer_id, order_id, points, reason, user_id) VALUES (?, ?, ?, 'redeem', ?)").run(customer.id, orderId, -redeem, u.id);
          if (earned) db.prepare("INSERT INTO loyalty_moves (customer_id, order_id, points, reason, user_id) VALUES (?, ?, ?, 'earn', ?)").run(customer.id, orderId, earned, u.id);
          db.prepare('UPDATE customers SET points = points + ? WHERE id = ?').run(earned - redeem, customer.id);
          db.prepare('UPDATE orders SET points_earned = ?, points_redeemed = ? WHERE id = ?').run(earned, redeem, orderId);
        }
        if (cart.quote_id) db.prepare("UPDATE quotes SET status = 'invoiced', order_id = ? WHERE id = ? AND status IN ('quote', 'order')").run(orderId, cart.quote_id);
        for (const g of granted) audit(g.action, { entity: 'order', entityId: orderId, approvedBy: g.approvedBy, details: { invoice: invoiceNo, ...((Array.isArray(g.details) ? { lines: g.details } : g.details)) } });
        // Orders paid straight away (takeaway, counter) still have to reach the kitchen.
        const tickets = priced.settings.kitchen_auto_send ? dispatchKitchen(getOrder(orderId)) : [];
        return { ...getOrder(orderId), kitchen_tickets: tickets };
      });
    },
    list({ from, to, search = '', limit = 200 } = {}) {
      requireUser();
      const [f, t] = dateRange(from, to);
      const params = [f, t];
      let extra = '';
      if (str(search)) {
        extra = 'AND (CAST(o.invoice_no AS TEXT) = ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR c.name LIKE ?)';
        params.push(str(search), `%${str(search)}%`, `%${str(search)}%`, `%${str(search)}%`);
      }
      params.push(int(limit, 200));
      return plainAll(db.prepare(`
        SELECT o.*, u.name AS user_name, COALESCE(c.name, o.customer_name) AS customer_display
        FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.status = 'completed' AND o.completed_at >= ? AND o.completed_at < date(?, '+1 day') ${extra}
        ORDER BY o.id DESC LIMIT ?`).all(...params));
    },
    /** Returns items from a completed order; refunded in cash from the open shift. */
    refund({ orderId, items = [], reason = '', approval = null } = {}) {
      const { user: u, approvedBy } = requirePerm('refund', approval);
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

        // A credit sale is refunded against what the customer still owes first; only the rest is paid out in cash.
        const owed = order.customer_id && order.credit > 0 ? Math.max(0, Math.min(order.credit, customerBalance(order.customer_id))) : 0;
        const toAccount = Math.min(amount, owed);
        const cashOut = amount - toAccount;
        const returnId = Number(
          db.prepare('INSERT INTO returns (order_id, shift_id, user_id, amount, method, reason, cash_amount) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(orderId, shift.id, u.id, amount, cashOut ? 'cash' : 'account', str(reason), cashOut).lastInsertRowid,
        );
        if (toAccount > 0) {
          const pid = db.prepare("INSERT INTO customer_payments (customer_id, amount, method, shift_id, user_id, order_id, notes) VALUES (?, ?, 'return', ?, ?, ?, ?)")
            .run(order.customer_id, toAccount, shift.id, u.id, orderId, str(reason)).lastInsertRowid;
          db.prepare('INSERT INTO payment_allocations (payment_id, order_id, amount) VALUES (?, ?, ?)').run(pid, orderId, toAccount);
        }
        for (const l of lines) {
          db.prepare('INSERT INTO return_items (return_id, order_item_id, qty, amount) VALUES (?, ?, ?, ?)').run(returnId, l.line.id, l.qty, l.amount);
          db.prepare('UPDATE order_items SET returned_qty = returned_qty + ? WHERE id = ?').run(l.qty, l.line.id);
          if (l.line.product_id) consumeStock(l.line.product_id, l.qty, l.line.unit_factor || 1, l.line.modifiers, +1, 'return', returnId, u.id);
        }
        db.prepare('UPDATE orders SET refunded = refunded + ? WHERE id = ?').run(amount, orderId);
        if (order.customer_id && order.points_earned > 0 && order.total > 0) {
          const back = Math.min(order.points_earned, Math.round((order.points_earned * amount) / order.total));
          if (back) {
            db.prepare("INSERT INTO loyalty_moves (customer_id, order_id, points, reason, user_id) VALUES (?, ?, ?, 'return', ?)").run(order.customer_id, orderId, -back, u.id);
            db.prepare('UPDATE customers SET points = MAX(0, points - ?) WHERE id = ?').run(back, order.customer_id);
          }
        }
        audit('refund', { entity: 'order', entityId: orderId, approvedBy, details: { invoice: order.invoice_no, amount, cash: cashOut, reason: str(reason), items: lines.map((l) => ({ name: l.line.name, qty: l.qty })) } });
        return getOrder(orderId);
      });
    },
  };



  /** Re-prices an open order after its lines changed server-side (merge / split). */
  function repriceOpen(id) {
    const o = getOrder(id);
    const cart = {
      ...o,
      items: o.items.map((i) => ({
        id: i.id, product_id: i.product_id, unit_id: i.unit_id, qty: i.qty, note: i.note, serials: i.serials, modifiers: i.modifiers,
        discount: Math.max(0, i.discount - (i.promo_discount || 0) - (i.customer_discount || 0)),
        price_override: true, unit_price: i.unit_price,
      })),
    };
    persistOrder(cart, priceCart(cart), { id: o.user_id }, 'open');
    return getOrder(id);
  }

  function openOrder(id) {
    const o = getOrder(id);
    if (o.status !== 'open') throw new PosError('ORDER_NOT_OPEN');
    return o;
  }

  /** Restaurant floor actions on open orders. */
  const floor = {
    /** Moves an order to a free table. */
    transfer({ orderId, tableId } = {}) {
      requireUser();
      return transaction(db, () => {
        const o = openOrder(orderId);
        if (!db.prepare('SELECT 1 FROM dining_tables WHERE id = ? AND active = 1').get(tableId)) throw new PosError('NOT_FOUND');
        if (db.prepare("SELECT 1 FROM orders WHERE table_id = ? AND status = 'open' AND id != ?").get(tableId, orderId)) throw new PosError('TABLE_BUSY');
        db.prepare("UPDATE orders SET table_id = ?, order_type = 'dine_in' WHERE id = ?").run(tableId, orderId);
        audit('table_transfer', { entity: 'order', entityId: orderId, details: { from: o.table_name, to: db.prepare('SELECT name FROM dining_tables WHERE id = ?').get(tableId).name } });
        return getOrder(orderId);
      });
    },
    /** Joins one table's order into another's (the first is closed). */
    merge({ fromId, toId } = {}) {
      requireUser();
      if (fromId === toId) throw new PosError('INVALID_STATUS');
      return transaction(db, () => {
        const from = openOrder(fromId);
        const to = openOrder(toId);
        db.prepare('UPDATE order_items SET order_id = ? WHERE order_id = ?').run(toId, fromId);
        db.prepare('UPDATE kitchen_tickets SET order_id = ? WHERE order_id = ?').run(toId, fromId);
        db.prepare("UPDATE orders SET status = 'void', note = TRIM(note || ' ' || ?) WHERE id = ?").run(`→ #${toId}`, fromId);
        db.prepare('UPDATE orders SET guests = guests + ? WHERE id = ?').run(from.guests || 0, toId);
        audit('table_merge', { entity: 'order', entityId: toId, details: { from: from.table_name || `#${fromId}`, to: to.table_name || `#${toId}` } });
        return repriceOpen(toId);
      });
    },
    /** Moves some lines (or part of their quantity) to a new open order so they can be paid apart. */
    split({ orderId, items = [] } = {}) {
      const u = requireUser();
      return transaction(db, () => {
        const o = openOrder(orderId);
        const moves = items.map((r) => ({ line: o.items.find((i) => i.id === int(r.order_item_id)), qty: num(r.qty) })).filter((m) => m.line && m.qty > 0);
        if (!moves.length) throw new PosError('NOTHING_TO_SPLIT');
        for (const m of moves) if (m.qty > m.line.qty + 1e-9) throw new PosError('INVALID_QTY');
        if (moves.every((m) => m.qty >= m.line.qty - 1e-9) && moves.length === o.items.length) throw new PosError('NOTHING_TO_SPLIT');
        const newId = Number(db.prepare(`INSERT INTO orders (status, order_type, table_id, user_id, customer_name, note, guests)
          VALUES ('open', ?, NULL, ?, ?, ?, 0)`).run(o.order_type, u.id, o.customer_name, `${o.table_name ? `${o.table_name} ` : ''}#${orderId}`).lastInsertRowid);
        for (const m of moves) {
          const l = m.line;
          const sent = Math.min(m.qty, l.kitchen_sent);
          if (m.qty >= l.qty - 1e-9) {
            db.prepare('UPDATE order_items SET order_id = ? WHERE id = ?').run(newId, l.id);
          } else {
            db.prepare('UPDATE order_items SET qty = qty - ?, kitchen_sent = MAX(0, kitchen_sent - ?) WHERE id = ?').run(m.qty, sent, l.id);
            db.prepare(`INSERT INTO order_items (order_id, product_id, name, unit_price, unit_cost, qty, discount, line_total, note, unit_id, unit_name, unit_factor, kitchen_sent, modifiers, modifiers_price)
              VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`).run(newId, l.product_id, l.name, l.unit_price, l.unit_cost, m.qty, l.note, l.unit_id, l.unit_name, l.unit_factor, sent, l.modifiers?.length ? JSON.stringify(l.modifiers) : '', l.modifiers_price || 0);
          }
        }
        audit('bill_split', { entity: 'order', entityId: orderId, details: { table: o.table_name, items: moves.map((m) => ({ name: m.line.name, qty: m.qty })) } });
        repriceOpen(orderId);
        return repriceOpen(newId);
      });
    },
    /** The customer asked for the bill: marks the table and returns the order to print. */
    printCheck(id) {
      requireUser();
      openOrder(id);
      db.prepare("UPDATE orders SET check_printed_at = datetime('now', 'localtime') WHERE id = ?").run(id);
      return getOrder(id);
    },
  };

  // ---------- suppliers & purchasing ----------
  const SUPPLIER_BALANCE = `(
    s.opening_balance +
    COALESCE((SELECT SUM(total) FROM purchases p WHERE p.supplier_id = s.id), 0) -
    COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id), 0)
  )`;

  // Records cash leaving the business; drawer cash needs the open shift so the Z-report balances.
  function drawerShift(fromDrawer) {
    if (!fromDrawer) return null;
    const shift = currentShift();
    if (!shift) throw new PosError('NO_OPEN_SHIFT');
    return shift.id;
  }

  function insertSupplierPayment({ supplierId, purchaseId = null, amount, method = 'cash', fromDrawer = false, notes = '' }, user) {
    if (!PAYMENT_METHODS.includes(method)) throw new PosError('INVALID_PAYMENT');
    const drawer = fromDrawer && method === 'cash';
    db.prepare('INSERT INTO supplier_payments (supplier_id, purchase_id, amount, method, from_drawer, shift_id, user_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(supplierId, purchaseId, amount, method, drawer ? 1 : 0, drawerShift(drawer), user.id, str(notes));
  }

  const suppliers = {
    list({ search = '', includeInactive = false } = {}) {
      requirePerm('purchases');
      const q = `%${str(search)}%`;
      return plainAll(db.prepare(`
        SELECT s.*, ${SUPPLIER_BALANCE} AS balance FROM suppliers s
        WHERE (s.name LIKE ? OR s.phone LIKE ?) ${includeInactive ? '' : 'AND s.active = 1'}
        ORDER BY s.name`).all(q, q));
    },
    save(s = {}) {
      requirePerm('purchases');
      if (!str(s.name)) throw new PosError('NAME_REQUIRED');
      const vals = [str(s.name), str(s.phone), str(s.address), str(s.notes), s.active === false ? 0 : 1];
      if (s.id) {
        db.prepare('UPDATE suppliers SET name = ?, phone = ?, address = ?, notes = ?, active = ? WHERE id = ?').run(...vals, s.id);
        return s.id;
      }
      return Number(db.prepare('INSERT INTO suppliers (name, phone, address, notes, active) VALUES (?, ?, ?, ?, ?)').run(...vals).lastInsertRowid);
    },
    /** Purchases and payments in date order with a running balance (what we owe). */
    statement(id) {
      requirePerm('purchases');
      const supplier = plain(db.prepare(`SELECT s.*, ${SUPPLIER_BALANCE} AS balance FROM suppliers s WHERE s.id = ?`).get(id));
      if (!supplier) throw new PosError('NOT_FOUND');
      const rows = plainAll(db.prepare(`
        SELECT 'purchase' AS kind, id, created_at, ref_no AS ref, total AS debit, 0 AS credit, notes FROM purchases WHERE supplier_id = ?
        UNION ALL
        SELECT 'payment' AS kind, id, created_at, method AS ref, 0 AS debit, amount AS credit, notes FROM supplier_payments WHERE supplier_id = ?
        ORDER BY created_at, kind DESC, id`).all(id, id));
      let balance = supplier.opening_balance || 0;
      for (const r of rows) { balance += r.debit - r.credit; r.balance = balance; }
      return { supplier, rows, opening: supplier.opening_balance || 0 };
    },
    pay({ supplierId, amount, method = 'cash', fromDrawer = false, notes = '' } = {}) {
      const u = requirePerm('purchases').user;
      const value = int(amount);
      if (!(value > 0)) throw new PosError('INVALID_AMOUNT');
      if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(supplierId)) throw new PosError('NOT_FOUND');
      transaction(db, () => insertSupplierPayment({ supplierId, amount: value, method, fromDrawer, notes }, u));
      audit('supplier_payment', { entity: 'supplier', entityId: supplierId, details: { amount: value, method, fromDrawer } });
      return suppliers.statement(supplierId);
    },
  };

  const purchases = {
    list({ from, to, supplierId = null } = {}) {
      requirePerm('purchases');
      const [f, t] = dateRange(from, to);
      const params = [f, t];
      let extra = '';
      if (supplierId) { extra = 'AND p.supplier_id = ?'; params.push(supplierId); }
      return plainAll(db.prepare(`
        SELECT p.*, s.name AS supplier_name, u.name AS user_name,
          COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id AND sp.method != 'return'), 0) AS paid
        FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id JOIN users u ON u.id = p.user_id
        WHERE p.created_at >= ? AND p.created_at < date(?, '+1 day') ${extra}
        ORDER BY p.id DESC LIMIT 500`).all(...params));
    },
    get(id) {
      requirePerm('purchases');
      const p = plain(db.prepare(`
        SELECT p.*, s.name AS supplier_name, u.name AS user_name FROM purchases p
        LEFT JOIN suppliers s ON s.id = p.supplier_id JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(id));
      if (!p) throw new PosError('NOT_FOUND');
      p.items = plainAll(db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id').all(id));
      p.returns = plainAll(db.prepare('SELECT r.*, u.name AS user_name FROM purchase_returns r JOIN users u ON u.id = r.user_id WHERE r.purchase_id = ? ORDER BY r.id').all(id));
      p.payments = plainAll(db.prepare('SELECT * FROM supplier_payments WHERE purchase_id = ? ORDER BY id').all(id));
      return p;
    },
    /**
     * Receives goods: adds stock, re-averages product cost and optionally pays now.
     * Anything unpaid stays on the supplier's balance.
     */
    create({ supplierId = null, refNo = '', items = [], discount = 0, paid = 0, method = 'cash', fromDrawer = false, notes = '', updatePrices = [], poId = null } = {}) {
      const u = requirePerm('purchases').user;
      if (!items.length) throw new PosError('EMPTY_CART');
      if (supplierId && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(supplierId)) throw new PosError('NOT_FOUND');
      return transaction(db, () => {
        const lines = items.map((it) => {
          const qty = num(it.qty);
          const unitCost = int(it.unit_cost, -1);
          if (!(qty > 0)) throw new PosError('INVALID_QTY');
          if (unitCost < 0) throw new PosError('INVALID_PRICE');
          const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
          if (!product) throw new PosError('PRODUCT_NOT_FOUND');
          const unit = it.unit_id ? db.prepare('SELECT * FROM product_units WHERE id = ? AND product_id = ?').get(it.unit_id, product.id) : null;
          if (it.unit_id && !unit) throw new PosError('INVALID_UNIT');
          // Supplier terms per line: a trade discount % and free bonus units (same unit as qty).
          const pct = Math.min(100, Math.max(0, num(it.discount_percent)));
          const bonus = Math.max(0, num(it.bonus_qty));
          return {
            product, unit, qty, unitCost, pct, bonus, lineTotal: Math.round(qty * unitCost * (1 - pct / 100)),
            factor: unit?.factor ?? 1, batchNo: str(it.batch_no), expiry: str(it.expiry_date) || null,
          };
        });
        const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
        const disc = Math.min(Math.max(0, int(discount)), subtotal);
        const total = subtotal - disc;
        const paidNow = Math.min(Math.max(0, int(paid)), total);
        if (paidNow > 0 && !supplierId) throw new PosError('SUPPLIER_REQUIRED');

        const purchaseId = Number(db.prepare('INSERT INTO purchases (supplier_id, ref_no, user_id, subtotal, discount, total, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(supplierId, str(refNo), u.id, subtotal, disc, total, str(notes)).lastInsertRowid);
        // Spread the invoice discount over the lines so product cost reflects what was really paid.
        const factor = subtotal > 0 ? total / subtotal : 1;
        for (const l of lines) {
          db.prepare('INSERT INTO purchase_items (purchase_id, product_id, name, qty, unit_cost, line_total, unit_name, unit_factor, batch_no, expiry_date, bonus_qty, discount_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(purchaseId, l.product.id, l.unit ? `${l.product.name} (${l.unit.name})` : l.product.name, l.qty, l.unitCost, l.lineTotal, l.unit?.name ?? '', l.factor, l.batchNo, l.expiry, l.bonus, l.pct);
          const current = db.prepare('SELECT stock, cost, track_stock FROM products WHERE id = ?').get(l.product.id);
          // Cost is kept per base unit: a carton of 12 bought at 120 costs 10 per piece.
          // Bonus units come in free, so they lower the cost of every unit received.
          const baseQty = (l.qty + l.bonus) * l.factor;
          const effective = Math.round((l.lineTotal * factor) / baseQty);
          const onHand = current.track_stock ? Math.max(0, current.stock) : 0;
          const newCost = onHand > 0 ? Math.round((onHand * current.cost + baseQty * effective) / (onHand + baseQty)) : effective;
          db.prepare('UPDATE products SET cost = ? WHERE id = ?').run(newCost, l.product.id);
          if (current.track_stock) moveStock(l.product.id, baseQty, 'purchase', purchaseId, u.id, { batchNo: l.batchNo, expiry: l.expiry, purchaseId });
          // Remember who supplies the product (used for sales-based rebates).
          if (supplierId) db.prepare('UPDATE products SET supplier_id = ? WHERE id = ? AND supplier_id IS NULL').run(supplierId, l.product.id);
        }
        for (const up of updatePrices) {
          const price = int(up.price, -1);
          if (up.product_id && price >= 0) db.prepare('UPDATE products SET price = ? WHERE id = ?').run(price, up.product_id);
        }
        if (paidNow > 0) insertSupplierPayment({ supplierId, purchaseId, amount: paidNow, method, fromDrawer }, u);
        if (int(poId)) {
          db.prepare("UPDATE purchase_orders SET status = 'received', purchase_id = ? WHERE id = ? AND status IN ('draft', 'sent')").run(purchaseId, int(poId));
          db.prepare('UPDATE purchases SET po_id = ? WHERE id = ?').run(int(poId), purchaseId);
        }
        audit('purchase_create', { entity: 'purchase', entityId: purchaseId, details: { total, paid: paidNow, supplierId } });
        return purchases.get(purchaseId);
      });
    },
  };

  const expenses = {
    list({ from, to } = {}) {
      requirePerm('expenses');
      const [f, t] = dateRange(from, to);
      return plainAll(db.prepare(`
        SELECT e.*, u.name AS user_name FROM expenses e JOIN users u ON u.id = e.user_id
        WHERE e.created_at >= ? AND e.created_at < date(?, '+1 day') ORDER BY e.id DESC`).all(f, t));
    },
    categories() {
      requireUser();
      return db.prepare("SELECT DISTINCT category FROM expenses WHERE category != '' ORDER BY category").all().map((r) => r.category);
    },
    /** Cashiers may record drawer expenses (e.g. paying a delivery); admins can record any. */
    create({ category = '', amount, notes = '', fromDrawer = true, approval = null } = {}) {
      const u = requireUser();
      const value = int(amount);
      if (!(value > 0)) throw new PosError('INVALID_AMOUNT');
      const approvedBy = fromDrawer ? null : requirePerm('expenses', approval).approvedBy;
      const id = Number(db.prepare('INSERT INTO expenses (category, amount, notes, from_drawer, shift_id, user_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(str(category), value, str(notes), fromDrawer ? 1 : 0, drawerShift(fromDrawer), u.id).lastInsertRowid);
      audit('expense_create', { entity: 'expense', entityId: id, approvedBy, details: { amount: value, category: str(category), fromDrawer } });
      return plain(db.prepare('SELECT * FROM expenses WHERE id = ?').get(id));
    },
    remove(id) {
      requirePerm('expenses');
      const e = db.prepare('SELECT shift_id FROM expenses WHERE id = ?').get(id);
      if (!e) throw new PosError('NOT_FOUND');
      // Removing a drawer expense from a closed shift would silently change its Z-report.
      if (e.shift_id && db.prepare('SELECT closed_at FROM shifts WHERE id = ?').get(e.shift_id)?.closed_at) throw new PosError('SHIFT_CLOSED');
      const row = db.prepare('SELECT amount, category FROM expenses WHERE id = ?').get(id);
      db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
      audit('expense_delete', { entity: 'expense', entityId: id, details: { ...row } });
      return true;
    },
  };


  // ---------- customers & credit sales ----------
  function customerBalance(id) {
    const opening = db.prepare('SELECT opening_balance FROM customers WHERE id = ?').get(id)?.opening_balance || 0;
    const sold = db.prepare("SELECT COALESCE(SUM(credit), 0) AS t FROM orders WHERE customer_id = ? AND status = 'completed'").get(id).t;
    const paid = db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM customer_payments WHERE customer_id = ? AND status = 'posted'").get(id).t;
    return opening + sold - paid;
  }
  const CUSTOMER_BALANCE = `(
    c.opening_balance +
    COALESCE((SELECT SUM(credit) FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed'), 0) -
    COALESCE((SELECT SUM(amount) FROM customer_payments cp WHERE cp.customer_id = c.id AND cp.status = 'posted'), 0)
  )`;

  const addDays = (date, days) => {
    const d = new Date(`${String(date).slice(0, 10)}T12:00:00`);
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-CA');
  };
  const termsOf = (customer) => int(customer?.payment_terms) || getSettings().overdue_days || 30;

  /**
   * What the customer still owes, invoice by invoice. Payments allocated to an invoice
   * settle it; everything else (unallocated payments, a credit opening balance, anything
   * allocated beyond an invoice's amount) settles the oldest debts first. Whatever is
   * left over is an advance the customer has with us.
   */
  function openItems(customerId) {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!c) throw new PosError('NOT_FOUND');
    const terms = termsOf(c);
    const debts = [];
    let pool = c.opening_balance < 0 ? -c.opening_balance : 0;
    if (c.opening_balance > 0) {
      debts.push({ order_id: null, invoice_no: null, date: c.created_at, due_date: addDays(c.created_at, terms), amount: c.opening_balance, open: c.opening_balance });
    }
    const allocated = new Map(db.prepare(`
      SELECT a.order_id, SUM(a.amount) AS amount FROM payment_allocations a JOIN customer_payments p ON p.id = a.payment_id
      WHERE p.customer_id = ? AND p.status = 'posted' GROUP BY a.order_id`).all(customerId).map((r) => [r.order_id, r.amount]));
    const paid = db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM customer_payments WHERE customer_id = ? AND status = 'posted'").get(customerId).t;
    const allocTotal = [...allocated.values()].reduce((s, v) => s + v, 0);
    pool += paid - allocTotal;
    for (const o of db.prepare("SELECT id, invoice_no, completed_at, due_date, total, credit FROM orders WHERE customer_id = ? AND status = 'completed' AND credit > 0 ORDER BY completed_at, id").all(customerId)) {
      const a = allocated.get(o.id) || 0;
      pool += Math.max(0, a - o.credit);
      debts.push({ order_id: o.id, invoice_no: o.invoice_no, date: o.completed_at, due_date: o.due_date || addDays(o.completed_at, terms), total: o.total, amount: o.credit, open: Math.max(0, o.credit - a) });
    }
    for (const d of debts) {
      const take = Math.min(pool, d.open);
      d.open -= take;
      pool -= take;
    }
    return { customer: plain(c), debts, open: debts.filter((d) => d.open > 0), advance: pool };
  }

  const pendingCheques = (customerId) => db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM customer_payments WHERE customer_id = ? AND method = 'cheque' AND status = 'posted' AND cheque_status = 'pending'").get(customerId).t;

  /** A receipt voucher: every payment row sharing the number (amount + settlement discount). */
  function getReceipt(receiptNo) {
    const rows = plainAll(db.prepare(`
      SELECT p.*, u.name AS user_name, col.name AS collector_name, vu.name AS voided_by_name
      FROM customer_payments p JOIN users u ON u.id = p.user_id
      LEFT JOIN users col ON col.id = p.collector_id LEFT JOIN users vu ON vu.id = p.voided_by
      WHERE p.receipt_no = ? ORDER BY p.id`).all(receiptNo));
    if (!rows.length) throw new PosError('NOT_FOUND');
    const main = rows.find((r) => r.method !== 'discount') || rows[0];
    const ids = rows.map((r) => r.id);
    const allocations = plainAll(db.prepare(`
      SELECT o.id AS order_id, o.invoice_no, o.completed_at, SUM(a.amount) AS amount FROM payment_allocations a JOIN orders o ON o.id = a.order_id
      WHERE a.payment_id IN (${ids.map(() => '?').join(',')}) GROUP BY o.id ORDER BY o.completed_at`).all(...ids));
    return {
      receipt_no: receiptNo, id: main.id, customer_id: main.customer_id, created_at: main.created_at, method: main.method, status: main.status,
      amount: rows.filter((r) => r.method !== 'discount').reduce((s, r) => s + r.amount, 0),
      discount: rows.filter((r) => r.method === 'discount').reduce((s, r) => s + r.amount, 0),
      cheque_no: main.cheque_no, bank: main.bank, cheque_due: main.cheque_due, cheque_status: main.cheque_status,
      notes: main.notes, user_name: main.user_name, collector_name: main.collector_name || main.user_name,
      void_reason: main.void_reason, voided_at: main.voided_at, voided_by_name: main.voided_by_name, shift_id: main.shift_id,
      allocations,
    };
  }

  const customers = {
    list({ search = '', includeInactive = false, owingOnly = false } = {}) {
      requireUser();
      const q = `%${str(search)}%`;
      return plainAll(db.prepare(`
        SELECT * FROM (
          SELECT c.*, ${CUSTOMER_BALANCE} AS balance,
            (SELECT MAX(completed_at) FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed') AS last_purchase,
            (SELECT COALESCE(SUM(total), 0) FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed') AS total_sales
          FROM customers c
          WHERE (c.name LIKE ? OR c.phone LIKE ?) ${includeInactive ? '' : 'AND c.active = 1'}
        ) ${owingOnly ? 'WHERE balance > 0' : ''}
        ORDER BY name LIMIT 500`).all(q, q));
    },
    get(id) {
      requireUser();
      const c = plain(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
      if (!c) throw new PosError('NOT_FOUND');
      c.balance = customerBalance(id);
      c.pending_cheques = pendingCheques(id);
      c.terms_days = termsOf(c);
      return c;
    },
    /** Cashiers can add/edit contact details; credit limits, terms, discounts and price lists need customers_edit. */
    save(c = {}) {
      const u = requireUser();
      if (!str(c.name)) throw new PosError('NAME_REQUIRED');
      const phone = str(c.phone);
      if (phone && db.prepare('SELECT 1 FROM customers WHERE phone = ? AND id != ?').get(phone, c.id || 0)) throw new PosError('DUPLICATE_PHONE');
      const existing = c.id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(c.id) : null;
      if (c.id && !existing) throw new PosError('NOT_FOUND');
      const admin = can('customers_edit', u);
      const limit = admin ? Math.max(0, int(c.credit_limit)) : existing?.credit_limit ?? 0;
      const active = admin ? (c.active === false ? 0 : 1) : existing?.active ?? 1;
      if (existing && existing.credit_limit !== limit) audit('credit_limit_change', { entity: 'customer', entityId: c.id, details: { name: str(c.name), from: existing.credit_limit, to: limit } });
      const priceList = admin ? int(c.price_list_id) || null : existing?.price_list_id ?? null;
      const terms = admin ? Math.max(0, int(c.payment_terms)) : existing?.payment_terms ?? 0;
      const discountPct = admin ? Math.min(100, Math.max(0, num(c.discount_percent))) : existing?.discount_percent ?? 0;
      if (existing && existing.discount_percent !== discountPct) audit('customer_discount_change', { entity: 'customer', entityId: c.id, details: { name: str(c.name), pct: discountPct } });
      const vals = [str(c.name), phone, str(c.address), str(c.tax_number), str(c.notes), limit, active, priceList, terms, discountPct];
      if (c.id) {
        db.prepare('UPDATE customers SET name = ?, phone = ?, address = ?, tax_number = ?, notes = ?, credit_limit = ?, active = ?, price_list_id = ?, payment_terms = ?, discount_percent = ? WHERE id = ?').run(...vals, c.id);
        return c.id;
      }
      return Number(db.prepare('INSERT INTO customers (name, phone, address, tax_number, notes, credit_limit, active, price_list_id, payment_terms, discount_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...vals).lastInsertRowid);
    },
    /** Invoices, receipts, discounts, bounced cheques and returns in date order with a running balance. */
    statement({ id, from = null, to = null } = {}) {
      requireUser();
      const customer = customers.get(id);
      const rows = plainAll(db.prepare(`
        SELECT 'sale' AS kind, id, invoice_no AS ref, completed_at AS created_at, total, credit AS debit, 0 AS credit, '' AS notes, NULL AS receipt_no, due_date, '' AS cheque_no
          FROM orders WHERE customer_id = ? AND status = 'completed'
        UNION ALL
        SELECT CASE method WHEN 'return' THEN 'return' WHEN 'discount' THEN 'discount' ELSE 'payment' END AS kind, id, method AS ref, created_at, amount AS total,
               0 AS debit, amount AS credit, notes, receipt_no, NULL AS due_date, cheque_no
          FROM customer_payments WHERE customer_id = ? AND status IN ('posted', 'bounced')
        UNION ALL
        SELECT 'bounced' AS kind, id, method AS ref, voided_at AS created_at, amount AS total, amount AS debit, 0 AS credit, void_reason AS notes, receipt_no, NULL AS due_date, cheque_no
          FROM customer_payments WHERE customer_id = ? AND status = 'bounced'
        ORDER BY created_at, kind DESC, id`).all(id, id, id));
      let balance = customer.opening_balance || 0;
      for (const r of rows) { balance += r.debit - r.credit; r.balance = balance; }
      const inRange = rows.filter((r) => (!from || r.created_at >= from) && (!to || r.created_at < `${to} 99`));
      const opening = inRange.length ? inRange[0].balance - inRange[0].debit + inRange[0].credit : balance;
      const { open, advance } = openItems(id);
      return { customer, opening, rows: inRange, balance, open, advance };
    },
    /** Unpaid (or partly paid) invoices with what is left on each, oldest first. */
    openInvoices(id) {
      requireUser();
      const { open, advance, customer } = openItems(id);
      return { open, advance, balance: customerBalance(id), terms_days: termsOf(customer) };
    },
    /** Manual points correction (e.g. a welcome bonus); needs customers_edit. */
    adjustPoints({ customerId, points, reason = '' } = {}) {
      const u = requirePerm('customers_edit').user;
      const value = Math.round(num(points));
      if (!value) throw new PosError('INVALID_AMOUNT');
      db.prepare("INSERT INTO loyalty_moves (customer_id, points, reason, user_id) VALUES (?, ?, 'adjust', ?)").run(customerId, value, u.id);
      db.prepare('UPDATE customers SET points = MAX(0, points + ?) WHERE id = ?').run(value, customerId);
      audit('points_adjust', { entity: 'customer', entityId: customerId, details: { points: value, reason: str(reason) } });
      return customers.get(customerId);
    },
    /**
     * Issues a numbered receipt voucher. Cash goes into the open shift's drawer; a cheque
     * reduces the balance now and is reversed if it bounces. `discount` is a settlement
     * discount given on top of the money received (needs the discount permission).
     * `allocations` [{ order_id, amount }] pick the invoices it pays; otherwise the oldest are settled.
     * Paying more than is owed leaves an advance (credit balance).
     */
    collect({ customerId, amount, method = 'cash', notes = '', discount = 0, allocations = null, cheque = null, collectorId = null, approval = null } = {}) {
      const u = requireUser();
      const value = Math.max(0, int(amount));
      const disc = Math.max(0, int(discount));
      if (!(value > 0) && !(disc > 0)) throw new PosError('INVALID_AMOUNT');
      if (!COLLECT_METHODS.includes(method)) throw new PosError('INVALID_PAYMENT');
      if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(customerId)) throw new PosError('NOT_FOUND');
      const shift = currentShift();
      if (value > 0 && method === 'cash' && !shift) throw new PosError('NO_OPEN_SHIFT');
      const chq = method === 'cheque' ? { no: str(cheque?.no), bank: str(cheque?.bank), due: str(cheque?.due) || null } : null;
      if (chq && !chq.no) throw new PosError('CHEQUE_NO_REQUIRED');
      const collector = int(collectorId) && db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(int(collectorId)) ? int(collectorId) : u.id;
      return transaction(db, () => {
        let approvedBy = null;
        if (disc > 0) {
          const pct = ((disc / (value + disc)) * 100);
          approvedBy = requirePerm('discount', approval, (p) => pct <= (p.max_discount ?? 0) + 1e-9).approvedBy;
        }
        // Validate requested allocations against what each invoice still owes.
        const { open } = openItems(customerId);
        const wanted = (Array.isArray(allocations) ? allocations : [])
          .map((a) => ({ order_id: int(a.order_id), amount: Math.max(0, int(a.amount)) })).filter((a) => a.order_id && a.amount > 0);
        for (const a of wanted) {
          const inv = open.find((d) => d.order_id === a.order_id);
          if (!inv || a.amount > inv.open) throw new PosError('ALLOCATION_EXCEEDS_DUE');
        }
        if (wanted.reduce((s, a) => s + a.amount, 0) > value + disc) throw new PosError('ALLOCATION_EXCEEDS_PAYMENT');

        const receiptNo = (db.prepare('SELECT MAX(receipt_no) AS n FROM customer_payments').get().n || 0) + 1;
        const ins = db.prepare(`INSERT INTO customer_payments (customer_id, amount, method, shift_id, user_id, notes, receipt_no, cheque_no, bank, cheque_due, cheque_status, collector_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const rows = [];
        if (value > 0) {
          rows.push({ id: Number(ins.run(customerId, value, method, shift?.id ?? null, u.id, str(notes), receiptNo, chq?.no || '', chq?.bank || '', chq?.due || null, chq ? 'pending' : '', collector).lastInsertRowid), left: value });
        }
        if (disc > 0) {
          rows.push({ id: Number(ins.run(customerId, disc, 'discount', shift?.id ?? null, u.id, str(notes), receiptNo, '', '', null, '', collector).lastInsertRowid), left: disc });
        }
        // Spread the allocations over the money first, then the discount.
        const insAlloc = db.prepare('INSERT INTO payment_allocations (payment_id, order_id, amount) VALUES (?, ?, ?)');
        for (const a of wanted) {
          let need = a.amount;
          for (const r of rows) {
            if (!need) break;
            const take = Math.min(need, r.left);
            if (take > 0) { insAlloc.run(r.id, a.order_id, take); r.left -= take; need -= take; }
          }
        }
        audit('customer_collect', { entity: 'customer', entityId: customerId, approvedBy, details: { receipt: receiptNo, amount: value, discount: disc, method, ...(chq ? { cheque: chq.no } : {}) } });
        return { receipt: getReceipt(receiptNo), customer: customers.get(customerId), payment: getReceipt(receiptNo) };
      });
    },
    receipt(receiptNo) {
      requireUser();
      const r = getReceipt(int(receiptNo));
      return { ...r, customer: customers.get(r.customer_id) };
    },
    /** Receipt vouchers in a date range (one row per voucher). */
    receipts({ from, to, search = '', method = '', customerId = null } = {}) {
      requireUser();
      const [f, t] = dateRange(from, to);
      const where = ["p.receipt_no IS NOT NULL", "p.created_at >= ?", "p.created_at < date(?, '+1 day')"];
      const params = [f, t];
      if (customerId) { where.push('p.customer_id = ?'); params.push(int(customerId)); }
      if (str(search)) { where.push('(c.name LIKE ? OR c.phone LIKE ? OR CAST(p.receipt_no AS TEXT) = ? OR p.cheque_no = ?)'); params.push(`%${str(search)}%`, `%${str(search)}%`, str(search), str(search)); }
      const rows = plainAll(db.prepare(`
        SELECT p.receipt_no, MIN(p.created_at) AS created_at, p.customer_id, c.name AS customer_name, c.phone AS customer_phone,
          SUM(CASE WHEN p.method != 'discount' THEN p.amount ELSE 0 END) AS amount,
          SUM(CASE WHEN p.method = 'discount' THEN p.amount ELSE 0 END) AS discount,
          MAX(CASE WHEN p.method != 'discount' THEN p.method END) AS method,
          MAX(p.status) AS status, MAX(p.cheque_no) AS cheque_no, MAX(p.cheque_status) AS cheque_status,
          MAX(u.name) AS user_name, MAX(COALESCE(col.name, u.name)) AS collector_name
        FROM customer_payments p JOIN customers c ON c.id = p.customer_id JOIN users u ON u.id = p.user_id LEFT JOIN users col ON col.id = p.collector_id
        WHERE ${where.join(' AND ')}
        GROUP BY p.receipt_no ORDER BY p.receipt_no DESC LIMIT 1000`).all(...params));
      const list = method ? rows.filter((r) => (r.method || 'discount') === method) : rows;
      const posted = list.filter((r) => r.status === 'posted');
      const byMethod = {};
      for (const r of posted) if (r.amount) byMethod[r.method] = (byMethod[r.method] || 0) + r.amount;
      return {
        rows: list,
        totals: { amount: posted.reduce((s, r) => s + r.amount, 0), discount: posted.reduce((s, r) => s + r.discount, 0), count: posted.length, byMethod },
      };
    },
    /** Cancels a receipt voucher (wrong amount, wrong customer…). Needs 'void' and a reason. */
    voidReceipt({ receiptNo, reason = '', approval = null } = {}) {
      const { user: u, approvedBy } = requirePerm('void', approval);
      if (!str(reason)) throw new PosError('REASON_REQUIRED');
      return transaction(db, () => {
        const r = getReceipt(int(receiptNo));
        if (r.status !== 'posted') throw new PosError('ALREADY_VOID');
        // Cash already counted in a closed shift cannot leave its Z-report.
        if (r.method === 'cash' && r.shift_id && db.prepare('SELECT closed_at FROM shifts WHERE id = ?').get(r.shift_id)?.closed_at) throw new PosError('SHIFT_CLOSED');
        db.prepare("UPDATE customer_payments SET status = 'void', void_reason = ?, voided_at = datetime('now', 'localtime'), voided_by = ? WHERE receipt_no = ?").run(str(reason), u.id, r.receipt_no);
        audit('receipt_void', { entity: 'customer', entityId: r.customer_id, approvedBy, details: { receipt: r.receipt_no, amount: r.amount, discount: r.discount, reason: str(reason) } });
        return { ...getReceipt(r.receipt_no), customer: customers.get(r.customer_id) };
      });
    },
    /** Cheques received; status '' = all, pending, cleared or bounced. */
    cheques({ status = 'pending' } = {}) {
      requireUser();
      const params = [];
      let where = "p.method = 'cheque' AND p.status != 'void'";
      if (status) { where += ' AND p.cheque_status = ?'; params.push(status); }
      return plainAll(db.prepare(`
        SELECT p.id, p.receipt_no, p.amount, p.cheque_no, p.bank, p.cheque_due, p.cheque_status, p.created_at, p.customer_id, c.name AS customer_name, c.phone AS customer_phone,
          CAST(julianday(p.cheque_due) - julianday(date('now', 'localtime')) AS INTEGER) AS days_left
        FROM customer_payments p JOIN customers c ON c.id = p.customer_id
        WHERE ${where} ORDER BY COALESCE(p.cheque_due, p.created_at), p.id`).all(...params));
    },
    /** The bank paid a cheque. */
    clearCheque(id) {
      requirePerm('customers_edit');
      const p = db.prepare("SELECT * FROM customer_payments WHERE id = ? AND method = 'cheque'").get(id);
      if (!p || p.status !== 'posted' || p.cheque_status !== 'pending') throw new PosError('INVALID_STATUS');
      db.prepare("UPDATE customer_payments SET cheque_status = 'cleared' WHERE id = ?").run(id);
      audit('cheque_cleared', { entity: 'customer', entityId: p.customer_id, details: { cheque: p.cheque_no, amount: p.amount, receipt: p.receipt_no } });
      return true;
    },
    /** The cheque bounced: the amount goes back on the customer's balance. */
    bounceCheque({ id, reason = '' } = {}) {
      const u = requirePerm('customers_edit').user;
      const p = db.prepare("SELECT * FROM customer_payments WHERE id = ? AND method = 'cheque'").get(id);
      if (!p || p.status !== 'posted' || p.cheque_status === 'bounced') throw new PosError('INVALID_STATUS');
      transaction(db, () => {
        db.prepare("UPDATE customer_payments SET status = 'bounced', cheque_status = 'bounced', void_reason = ?, voided_at = datetime('now', 'localtime'), voided_by = ? WHERE id = ?").run(str(reason), u.id, id);
        // A settlement discount given with this cheque goes with it.
        db.prepare("UPDATE customer_payments SET status = 'void', void_reason = ?, voided_at = datetime('now', 'localtime'), voided_by = ? WHERE receipt_no = ? AND method = 'discount' AND status = 'posted'").run(str(reason), u.id, p.receipt_no);
      });
      audit('cheque_bounced', { entity: 'customer', entityId: p.customer_id, details: { cheque: p.cheque_no, amount: p.amount, receipt: p.receipt_no, reason: str(reason) } });
      return customers.get(p.customer_id);
    },
  };

  // ---------- reports ----------
  const reports = {
    summary({ from, to } = {}) {
      requirePerm('reports');
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
      const purchasesTotal = db.prepare("SELECT COALESCE(SUM(total), 0) AS t FROM purchases WHERE created_at >= ? AND created_at < date(?, '+1 day')").get(f, t).t;
      const expensesTotal = db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE created_at >= ? AND created_at < date(?, '+1 day')").get(f, t).t;
      const profit = Math.round(cost.revenue - cost.cost);
      // Settlement discounts given when collecting reduce profit; supplier rebates received add to it.
      const settlementDiscounts = db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM customer_payments WHERE method = 'discount' AND status = 'posted' AND created_at >= ? AND created_at < date(?, '+1 day')").get(f, t).t;
      const rebatesTotal = db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM supplier_payments WHERE method = 'rebate' AND created_at >= ? AND created_at < date(?, '+1 day')").get(f, t).t;
      return {
        from: f,
        to: t,
        totals: {
          ...totals,
          refunds,
          net: totals.gross - refunds,
          average: totals.orders ? Math.round(totals.gross / totals.orders) : 0,
          profit: can('view_cost') ? profit : null,
          purchases: purchasesTotal,
          expenses: expensesTotal,
          settlementDiscounts,
          rebates: rebatesTotal,
          netProfit: can('view_cost') ? profit - expensesTotal - settlementDiscounts + rebatesTotal : null,
          creditSales: db.prepare("SELECT COALESCE(SUM(credit), 0) AS t FROM orders o WHERE " + range).get(f, t).t,
          collections: db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM customer_payments WHERE method NOT IN ('return', 'discount') AND status = 'posted' AND created_at >= ? AND created_at < date(?, '+1 day')").get(f, t).t,
          receivables: db.prepare(`SELECT COALESCE(SUM(b), 0) AS t FROM (SELECT ${CUSTOMER_BALANCE} AS b FROM customers c) WHERE b > 0`).get().t,
        },
        ...(can('view_cost') ? {} : { hiddenProfit: true }),
        topCustomers: plainAll(db.prepare(`SELECT c.name, COUNT(*) AS orders, SUM(o.total) AS total FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${range} GROUP BY c.id ORDER BY total DESC LIMIT 10`).all(f, t)),
        expensesByCategory: plainAll(db.prepare("SELECT category, SUM(amount) AS total FROM expenses WHERE created_at >= ? AND created_at < date(?, '+1 day') GROUP BY category ORDER BY total DESC").all(f, t)),
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

  

  // ---------- price lists ----------
  const priceLists = {
    list() {
      requireUser();
      return plainAll(db.prepare('SELECT * FROM price_lists ORDER BY id').all());
    },
    save(pl = {}) {
      requirePerm('settings');
      if (!str(pl.name)) throw new PosError('NAME_REQUIRED');
      if (pl.id) {
        db.prepare('UPDATE price_lists SET name = ?, active = ? WHERE id = ?').run(str(pl.name), pl.active === false ? 0 : 1, pl.id);
        return pl.id;
      }
      return Number(db.prepare('INSERT INTO price_lists (name) VALUES (?)').run(str(pl.name)).lastInsertRowid);
    },
    /** Sets a list's prices from the base price with a percentage (e.g. wholesale = -10%). */
    fillFromBase({ id, percent = 0, overwrite = false } = {}) {
      requirePerm('settings');
      const factor = 1 + num(percent) / 100;
      return transaction(db, () => {
        let n = 0;
        for (const p of db.prepare('SELECT id, price FROM products WHERE active = 1').all()) {
          const exists = db.prepare('SELECT 1 FROM product_prices WHERE product_id = ? AND price_list_id = ?').get(p.id, id);
          if (exists && !overwrite) continue;
          db.prepare('INSERT INTO product_prices (product_id, price_list_id, price) VALUES (?, ?, ?) ON CONFLICT(product_id, price_list_id) DO UPDATE SET price = excluded.price')
            .run(p.id, id, Math.max(0, Math.round(p.price * factor)));
          n++;
        }
        audit('price_list_fill', { entity: 'price_list', entityId: id, details: { pct: num(percent), count: n } });
        return n;
      });
    },
  };

  // ---------- quotations ----------
  function getQuote(id) {
    const q = plain(db.prepare(`SELECT q.*, u.name AS user_name, c.name AS customer_display, c.tax_number AS customer_tax, c.address AS customer_address
      FROM quotes q JOIN users u ON u.id = q.user_id LEFT JOIN customers c ON c.id = q.customer_id WHERE q.id = ?`).get(id));
    if (!q) throw new PosError('NOT_FOUND');
    q.items = plainAll(db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY id').all(id));
    return q;
  }
  const quotes = {
    /** Saves the current cart as a quotation (no stock or money moves). */
    create(cart = {}) {
      const u = requireUser();
      if (!cart.items?.length) throw new PosError('EMPTY_CART');
      return transaction(db, () => {
        const priced = priceCart({ ...cart, order_type: 'sale' });
        const no = (db.prepare('SELECT MAX(quote_no) AS n FROM quotes').get().n || 0) + 1;
        const customer = cart.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(cart.customer_id) : null;
        const id = Number(db.prepare(`INSERT INTO quotes (quote_no, customer_id, customer_name, customer_phone, price_list_id, valid_until, note, subtotal, discount, tax, total, user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(no, customer?.id ?? null, str(cart.customer_name) || customer?.name || '', str(cart.customer_phone) || customer?.phone || '',
          priced.priceListId, str(cart.valid_until) || null, str(cart.note), priced.subtotal, priced.discount, priced.tax, priced.total, u.id).lastInsertRowid);
        for (const l of priced.lines) {
          db.prepare('INSERT INTO quote_items (quote_id, product_id, unit_id, name, unit_name, unit_price, qty, discount, line_total, manual_discount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, l.product_id, l.unit_id, l.name, l.unit_name, l.unit_price, l.qty, l.discount, l.line_total, l.manual_discount);
        }
        audit('quote_create', { entity: 'quote', entityId: id, details: { quote: no, total: priced.total } });
        return getQuote(id);
      });
    },
    list({ status = '', search = '' } = {}) {
      requireUser();
      const where = [];
      const params = [];
      if (str(status)) { where.push('q.status = ?'); params.push(str(status)); }
      if (str(search)) { where.push('(CAST(q.quote_no AS TEXT) = ? OR q.customer_name LIKE ? OR q.customer_phone LIKE ?)'); params.push(str(search), `%${str(search)}%`, `%${str(search)}%`); }
      return plainAll(db.prepare(`SELECT q.*, u.name AS user_name FROM quotes q JOIN users u ON u.id = q.user_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.id DESC LIMIT 300`).all(...params));
    },
    get(id) {
      requireUser();
      return getQuote(id);
    },
    /** quote → order (customer confirmed, to be delivered/invoiced later) or cancelled. */
    setStatus({ id, status }) {
      requireUser();
      if (!['quote', 'order', 'cancelled'].includes(status)) throw new PosError('INVALID_STATUS');
      const q = getQuote(id);
      if (q.status === 'invoiced') throw new PosError('QUOTE_INVOICED');
      db.prepare('UPDATE quotes SET status = ? WHERE id = ?').run(status, id);
      audit('quote_status', { entity: 'quote', entityId: id, details: { quote: q.quote_no, status } });
      return getQuote(id);
    },
    /** Cart to load into the sales screen; checkout with quote_id marks it invoiced. */
    toCart(id) {
      requireUser();
      const q = getQuote(id);
      if (['invoiced', 'cancelled'].includes(q.status)) throw new PosError('QUOTE_INVOICED');
      return {
        quote_id: q.id, quote_no: q.quote_no, customer_id: q.customer_id, customer_name: q.customer_name, customer_phone: q.customer_phone,
        price_list_id: q.price_list_id, discount: q.discount, note: q.note,
        items: q.items.filter((i) => i.product_id).map((i) => ({ product_id: i.product_id, unit_id: i.unit_id, name: i.name, unit_price: i.unit_price, list_price: i.unit_price, qty: i.qty, discount: i.manual_discount ?? i.discount, note: '', kitchen_sent: 0 })),
      };
    },
  };

  // ---------- receivables aging ----------
  /**
   * Splits each customer's balance by age: payments settle the oldest debt first (opening
   * balance, then credit invoices in date order); what is left is bucketed by days old.
   */
  /**
   * Receivables by age (days since each invoice) per customer. An invoice is overdue
   * once its due date (customer payment terms, or the general setting) has passed.
   */
  function aging() {
    requireUser();
    const today = new Date().toLocaleDateString('en-CA');
    const now = Date.now();
    const out = [];
    for (const c of db.prepare('SELECT id, name, phone, credit_limit FROM customers WHERE active = 1').all()) {
      const { open } = openItems(c.id);
      if (!open.length) continue;
      const row = { id: c.id, name: c.name, phone: c.phone, credit_limit: c.credit_limit, total: 0, b30: 0, b60: 0, b90: 0, b90p: 0, oldest_days: 0, overdue: 0, next_due: null };
      for (const d of open) {
        const days = Math.max(0, Math.floor((now - Date.parse(String(d.date).replace(' ', 'T'))) / 86400000));
        row.total += d.open;
        row[days <= 30 ? 'b30' : days <= 60 ? 'b60' : days <= 90 ? 'b90' : 'b90p'] += d.open;
        row.oldest_days = Math.max(row.oldest_days, days);
        if (d.due_date < today) row.overdue += d.open;
        else if (!row.next_due || d.due_date < row.next_due) row.next_due = d.due_date;
      }
      out.push(row);
    }
    return out.sort((a, b) => b.overdue - a.overdue || b.oldest_days - a.oldest_days || b.total - a.total);
  }

  // ---------- purchase returns ----------
  function returnPurchase({ purchaseId, items = [], reason = '' } = {}) {
    const u = requirePerm('purchases').user;
    return transaction(db, () => {
      const pur = purchases.get(purchaseId);
      const factor = pur.subtotal > 0 ? pur.total / pur.subtotal : 1;
      const lines = [];
      for (const r of items) {
        const qty = num(r.qty);
        if (!(qty > 0)) continue;
        const line = pur.items.find((i) => i.id === r.purchase_item_id);
        if (!line) throw new PosError('NOT_FOUND');
        const received = line.qty + (line.bonus_qty || 0);
        if (qty > received - line.returned_qty + 1e-9) throw new PosError('RETURN_EXCEEDS_SOLD', line.name);
        // Credited at what each received unit really cost (after line discount, bonus and invoice discount).
        lines.push({ line, qty, amount: Math.round((line.line_total / received) * qty * factor) });
      }
      if (!lines.length) throw new PosError('NOTHING_TO_RETURN');
      const amount = lines.reduce((sum, l) => sum + l.amount, 0);
      const id = Number(db.prepare('INSERT INTO purchase_returns (purchase_id, supplier_id, user_id, amount, reason) VALUES (?, ?, ?, ?, ?)')
        .run(purchaseId, pur.supplier_id, u.id, amount, str(reason)).lastInsertRowid);
      for (const l of lines) {
        db.prepare('INSERT INTO purchase_return_items (return_id, purchase_item_id, qty, amount) VALUES (?, ?, ?, ?)').run(id, l.line.id, l.qty, l.amount);
        db.prepare('UPDATE purchase_items SET returned_qty = returned_qty + ? WHERE id = ?').run(l.qty, l.line.id);
        if (l.line.product_id) moveStock(l.line.product_id, -l.qty * (l.line.unit_factor || 1), 'purchase_return', id, u.id);
      }
      db.prepare('UPDATE purchases SET returned = returned + ? WHERE id = ?').run(amount, purchaseId);
      // The supplier now owes us this much less (recorded like a payment that moves no cash).
      if (pur.supplier_id) {
        db.prepare("INSERT INTO supplier_payments (supplier_id, purchase_id, amount, method, user_id, notes) VALUES (?, ?, ?, 'return', ?, ?)")
          .run(pur.supplier_id, purchaseId, amount, u.id, str(reason));
      }
      audit('purchase_return', { entity: 'purchase', entityId: purchaseId, details: { amount, reason: str(reason) } });
      return purchases.get(purchaseId);
    });
  }

  // ---------- stock counts ----------
  function getCount(id) {
    const c = plain(db.prepare('SELECT s.*, u.name AS user_name FROM stock_counts s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(id));
    if (!c) throw new PosError('NOT_FOUND');
    c.items = plainAll(db.prepare(`SELECT i.*, p.name, p.barcode, p.cost, p.unit FROM stock_count_items i JOIN products p ON p.id = i.product_id
      WHERE i.count_id = ? ORDER BY (i.counted IS NULL), p.name`).all(id));
    c.counted = c.items.filter((i) => i.counted != null).length;
    c.difference_value = c.items.reduce((sum, i) => sum + (i.counted == null ? 0 : (i.counted - i.expected) * i.cost), 0);
    if (!can('view_cost')) { c.items = c.items.map(({ cost, ...i }) => i); c.difference_value = null; }
    return c;
  }
  const stockCounts = {
    list() {
      requirePerm('purchases');
      return plainAll(db.prepare(`SELECT s.*, u.name AS user_name, (SELECT COUNT(*) FROM stock_count_items i WHERE i.count_id = s.id) AS items,
        (SELECT COUNT(*) FROM stock_count_items i WHERE i.count_id = s.id AND i.counted IS NOT NULL) AS counted
        FROM stock_counts s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 100`).all());
    },
    /** Snapshots expected quantities for all tracked products (optionally one category). */
    start({ categoryId = null, notes = '' } = {}) {
      const u = requirePerm('purchases').user;
      if (db.prepare("SELECT 1 FROM stock_counts WHERE status = 'open'").get()) throw new PosError('COUNT_OPEN');
      return transaction(db, () => {
        const id = Number(db.prepare('INSERT INTO stock_counts (notes, user_id) VALUES (?, ?)').run(str(notes), u.id).lastInsertRowid);
        db.prepare(`INSERT INTO stock_count_items (count_id, product_id, expected)
          SELECT ?, id, stock FROM products WHERE active = 1 AND track_stock = 1 ${categoryId ? 'AND category_id = ?' : ''}`).run(...[id, ...(categoryId ? [categoryId] : [])]);
        audit('count_start', { entity: 'count', entityId: id });
        return getCount(id);
      });
    },
    get(id) {
      requirePerm('purchases');
      return getCount(id);
    },
    /** Sets a counted quantity, or adds to it (scanning: add = 1 per scan, unit barcodes add their factor). */
    set({ id, productId = null, barcode = '', counted = null, add = null }) {
      requirePerm('purchases');
      const c = db.prepare('SELECT status FROM stock_counts WHERE id = ?').get(id);
      if (!c || c.status !== 'open') throw new PosError('COUNT_CLOSED');
      let pid = productId;
      let factor = 1;
      if (!pid && str(barcode)) {
        const p = db.prepare('SELECT id FROM products WHERE barcode = ?').get(str(barcode));
        const unit = p ? null : db.prepare('SELECT product_id, factor FROM product_units WHERE barcode = ?').get(str(barcode));
        pid = p?.id ?? unit?.product_id;
        factor = unit?.factor ?? 1;
      }
      const item = pid && db.prepare('SELECT * FROM stock_count_items WHERE count_id = ? AND product_id = ?').get(id, pid);
      if (!item) throw new PosError('PRODUCT_NOT_FOUND');
      const value = add != null ? (item.counted || 0) + num(add) * factor : counted === '' || counted == null ? null : num(counted);
      db.prepare('UPDATE stock_count_items SET counted = ? WHERE count_id = ? AND product_id = ?').run(value, id, pid);
      return plain(db.prepare('SELECT i.*, p.name FROM stock_count_items i JOIN products p ON p.id = i.product_id WHERE i.count_id = ? AND i.product_id = ?').get(id, pid));
    },
    /** Posts differences as stock adjustments. Uncounted products are left unchanged. */
    apply(id) {
      const u = requirePerm('purchases').user;
      return transaction(db, () => {
        const c = getCount(id);
        if (c.status !== 'open') throw new PosError('COUNT_CLOSED');
        let changed = 0;
        for (const i of c.items) {
          if (i.counted == null) continue;
          // Sales made during the count moved stock too, so adjust against the current figure.
          const now = db.prepare('SELECT stock FROM products WHERE id = ?').get(i.product_id).stock;
          const sold = i.expected - now;
          const diff = i.counted - i.expected;
          if (Math.abs(diff) > 1e-9) { moveStock(i.product_id, diff, 'count', id, u.id); changed++; }
          void sold;
        }
        db.prepare("UPDATE stock_counts SET status = 'applied', applied_at = datetime('now', 'localtime') WHERE id = ?").run(id);
        audit('count_apply', { entity: 'count', entityId: id, details: { changed, value: c.difference_value } });
        return getCount(id);
      });
    },
    cancel(id) {
      requirePerm('purchases');
      db.prepare("UPDATE stock_counts SET status = 'cancelled' WHERE id = ? AND status = 'open'").run(id);
      return true;
    },
  };

  customers.aging = aging;
  reports.dashboard = dashboard;
  purchases.returnItems = returnPurchase;
  orders.findSerial = (serial) => findSerial(serial);

  /** Finds the invoice a serial number was sold on (warranty look-ups). */
  function findSerial(serial) {
    requireUser();
    const q = str(serial);
    if (!q) return [];
    return plainAll(db.prepare(`SELECT o.id, o.invoice_no, o.completed_at, i.name, i.serials, COALESCE(c.name, o.customer_name) AS customer
      FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.status = 'completed' AND (' ' || replace(replace(i.serials, ',', ' '), char(10), ' ') || ' ') LIKE ? LIMIT 20`).all(`% ${q} %`));
  }

  // ---------- bulk import (Excel) ----------
  // Rows arrive with money in major units (as typed in the sheet). Each sheet row is
  // validated on its own; bad rows are reported and skipped, good ones applied together.
  const toMinorUnits = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,٬\s]/g, '').replace('٫', '.'));
    return Number.isFinite(n) ? Math.round(n * 10 ** (getSettings().decimals ?? 2)) : NaN;
  };
  const yes = (v, d) => (v === '' || v == null ? d : /^(1|y|yes|true|نعم|ايوه|أيوه|اه|✓)$/i.test(String(v).trim()));

  function importProducts({ rows = [], updateExisting = true } = {}) {
    const u = requirePerm('products').user;
    requirePerm('backup');
    const result = { created: 0, updated: 0, skipped: 0, errors: [] };
    const catId = (name) => {
      if (!str(name)) return null;
      const found = db.prepare('SELECT id FROM categories WHERE name = ?').get(str(name));
      return found ? found.id : Number(db.prepare('INSERT INTO categories (name) VALUES (?)').run(str(name)).lastInsertRowid);
    };
    transaction(db, () => {
      rows.forEach((r, i) => {
        const line = r.__row || i + 2;
        const name = str(r.name);
        const price = toMinorUnits(r.price);
        const cost = toMinorUnits(r.cost);
        if (!name) { result.errors.push({ row: line, code: 'NAME_REQUIRED' }); return; }
        if (price == null || Number.isNaN(price) || price < 0) { result.errors.push({ row: line, code: 'INVALID_PRICE', name }); return; }
        if (Number.isNaN(cost)) { result.errors.push({ row: line, code: 'INVALID_PRICE', name }); return; }
        const barcode = str(r.barcode) || null;
        const existing = (barcode && db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode))
          || db.prepare('SELECT * FROM products WHERE name = ? AND (barcode IS NULL OR barcode = ?)').get(name, barcode || '');
        const fields = {
          name, barcode, price,
          category_id: str(r.category) ? catId(r.category) : existing?.category_id ?? null,
          cost: cost ?? existing?.cost ?? 0,
          unit: str(r.unit) || existing?.unit || 'pcs',
          min_stock: r.min_stock === '' || r.min_stock == null ? existing?.min_stock ?? 0 : num(r.min_stock),
          track_stock: yes(r.track_stock, existing ? !!existing.track_stock : true) ? 1 : 0,
          author: str(r.author) || existing?.author || null,
          publisher: str(r.publisher) || existing?.publisher || null,
          kitchen: yes(r.kitchen, existing ? !!existing.kitchen : false) ? 1 : 0,
          active: 1,
        };
        const stock = r.stock === '' || r.stock == null ? null : num(r.stock, NaN);
        if (Number.isNaN(stock)) { result.errors.push({ row: line, code: 'INVALID_QTY', name }); return; }
        if (existing) {
          if (!updateExisting) { result.skipped++; return; }
          const keys = Object.keys(fields);
          db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), existing.id);
          // The sheet's stock is the counted quantity: record the difference as an adjustment.
          if (stock != null && fields.track_stock && stock !== existing.stock) moveStock(existing.id, stock - existing.stock, 'adjust', null, u.id);
          result.updated++;
        } else {
          const keys = Object.keys(fields);
          const id = Number(db.prepare(`INSERT INTO products (${keys.join(', ')}, stock) VALUES (${keys.map(() => '?').join(', ')}, 0)`).run(...keys.map((k) => fields[k])).lastInsertRowid);
          if (stock && fields.track_stock) moveStock(id, stock, 'purchase', null, u.id);
          result.created++;
        }
      });
      audit('import_products', { details: { created: result.created, updated: result.updated, errors: result.errors.length } });
    });
    return result;
  }

  function importParties(kind, { rows = [], updateExisting = true } = {}) {
    requirePerm(kind === 'customers' ? 'customers_edit' : 'purchases');
    requirePerm('backup');
    const table = kind === 'customers' ? 'customers' : 'suppliers';
    const result = { created: 0, updated: 0, skipped: 0, errors: [] };
    transaction(db, () => {
      rows.forEach((r, i) => {
        const line = r.__row || i + 2;
        const name = str(r.name);
        if (!name) { result.errors.push({ row: line, code: 'NAME_REQUIRED' }); return; }
        const opening = toMinorUnits(r.opening_balance);
        const limit = toMinorUnits(r.credit_limit);
        if (Number.isNaN(opening) || Number.isNaN(limit)) { result.errors.push({ row: line, code: 'INVALID_AMOUNT', name }); return; }
        const phone = str(r.phone);
        const existing = (phone && db.prepare(`SELECT * FROM ${table} WHERE phone = ?`).get(phone)) || db.prepare(`SELECT * FROM ${table} WHERE name = ?`).get(name);
        const fields = { name, phone, address: str(r.address) || existing?.address || '', notes: str(r.notes) || existing?.notes || '' };
        if (opening != null) fields.opening_balance = opening;
        if (kind === 'customers') {
          fields.tax_number = str(r.tax_number) || existing?.tax_number || '';
          if (limit != null) fields.credit_limit = Math.max(0, limit);
        }
        const keys = Object.keys(fields);
        if (existing) {
          if (!updateExisting) { result.skipped++; return; }
          db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), existing.id);
          result.updated++;
        } else {
          db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => fields[k]));
          result.created++;
        }
      });
      audit(`import_${kind}`, { details: { created: result.created, updated: result.updated, errors: result.errors.length } });
    });
    return result;
  }

  const importer = {
    products: importProducts,
    customers: (arg) => importParties('customers', arg),
    suppliers: (arg) => importParties('suppliers', arg),
  };

  // ---------- commissions ----------
  const commissions = {
    /** Net sales (after returns) per salesperson — the cashier unless another rep was picked. */
    report({ from, to } = {}) {
      requirePerm('reports');
      const [f, t] = dateRange(from, to);
      return plainAll(db.prepare(`
        SELECT u.id, u.name, u.commission_rate AS rate, COUNT(*) AS orders,
               SUM(o.total - o.refunded) AS net
        FROM orders o JOIN users u ON u.id = COALESCE(o.salesperson_id, o.user_id)
        WHERE o.status = 'completed' AND o.completed_at >= ? AND o.completed_at < date(?, '+1 day')
        GROUP BY u.id ORDER BY net DESC`).all(f, t)).map((r) => ({ ...r, commission: Math.round((r.net * r.rate) / 100) }));
    },
  };

  const auditLog = {
    list({ from, to, userId = null, action = '', limit = 500 } = {}) {
      requirePerm('audit');
      const [f, t] = dateRange(from, to);
      const where = ["a.created_at >= ? AND a.created_at < date(?, '+1 day')"];
      const params = [f, t];
      if (userId) { where.push('a.user_id = ?'); params.push(userId); }
      if (str(action)) { where.push('a.action = ?'); params.push(str(action)); }
      params.push(int(limit, 500));
      return plainAll(db.prepare(`
        SELECT a.*, u.name AS user_name, ap.name AS approver_name FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id LEFT JOIN users ap ON ap.id = a.approved_by
        WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ?`).all(...params));
    },
    actions() {
      requirePerm('audit');
      return db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all().map((r) => r.action);
    },
  };

  // ---------- supplier rebates (volume bonuses) ----------
  /** How far an agreement has got: the amount reached, the target and what has been earned. */
  function rebateProgress(r) {
    const range = [r.start_date, r.end_date];
    const achieved = r.basis === 'purchases'
      ? db.prepare("SELECT COALESCE(SUM(total - returned), 0) AS t FROM purchases WHERE supplier_id = ? AND created_at >= ? AND created_at < date(?, '+1 day')").get(r.supplier_id, ...range).t
      : Math.round(db.prepare(`
          SELECT COALESCE(SUM(i.line_total * (i.qty - i.returned_qty) / i.qty), 0) AS t
          FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
          WHERE p.supplier_id = ? AND o.status = 'completed' AND o.completed_at >= ? AND o.completed_at < date(?, '+1 day')`).get(r.supplier_id, ...range).t);
    const reached = achieved >= r.target;
    const earned = reached ? Math.round((achieved * r.percent) / 100) + r.fixed_amount : 0;
    const today = new Date().toLocaleDateString('en-CA');
    return {
      ...plain(r), achieved, reached, earned,
      progress: r.target > 0 ? Math.min(100, Math.round((achieved / r.target) * 100)) : 100,
      remaining: Math.max(0, r.target - achieved),
      ended: r.end_date < today,
    };
  }

  const rebates = {
    list({ supplierId = null, status = '' } = {}) {
      requirePerm('purchases');
      const where = []; const params = [];
      if (supplierId) { where.push('r.supplier_id = ?'); params.push(int(supplierId)); }
      if (status) { where.push('r.status = ?'); params.push(status); }
      return db.prepare(`SELECT r.*, s.name AS supplier_name FROM supplier_rebates r JOIN suppliers s ON s.id = r.supplier_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.status = 'open' DESC, r.end_date DESC, r.id DESC`).all(...params).map(rebateProgress);
    },
    save(r = {}) {
      requirePerm('purchases');
      if (!str(r.name)) throw new PosError('NAME_REQUIRED');
      if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(int(r.supplier_id))) throw new PosError('SUPPLIER_REQUIRED');
      const basis = r.basis === 'sales' ? 'sales' : 'purchases';
      const start = str(r.start_date); const end = str(r.end_date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) throw new PosError('INVALID_DATES');
      const pct = Math.min(100, Math.max(0, num(r.percent)));
      const fixed = Math.max(0, int(r.fixed_amount));
      if (!pct && !fixed) throw new PosError('INVALID_AMOUNT');
      const vals = [int(r.supplier_id), str(r.name), basis, start, end, Math.max(0, int(r.target)), pct, fixed, str(r.notes)];
      if (r.id) {
        const cur = db.prepare('SELECT status FROM supplier_rebates WHERE id = ?').get(r.id);
        if (!cur) throw new PosError('NOT_FOUND');
        if (cur.status !== 'open') throw new PosError('INVALID_STATUS');
        db.prepare('UPDATE supplier_rebates SET supplier_id = ?, name = ?, basis = ?, start_date = ?, end_date = ?, target = ?, percent = ?, fixed_amount = ?, notes = ? WHERE id = ?').run(...vals, r.id);
        audit('rebate_save', { entity: 'supplier', entityId: vals[0], details: { name: vals[1] } });
        return r.id;
      }
      const id = Number(db.prepare('INSERT INTO supplier_rebates (supplier_id, name, basis, start_date, end_date, target, percent, fixed_amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...vals).lastInsertRowid);
      audit('rebate_save', { entity: 'supplier', entityId: vals[0], details: { name: vals[1] } });
      return id;
    },
    /** Books the bonus: the supplier's balance goes down by the amount (we owe them less). */
    settle({ id, amount = null, notes = '' } = {}) {
      const u = requirePerm('purchases').user;
      return transaction(db, () => {
        const r = db.prepare('SELECT * FROM supplier_rebates WHERE id = ?').get(id);
        if (!r) throw new PosError('NOT_FOUND');
        if (r.status !== 'open') throw new PosError('INVALID_STATUS');
        const value = amount == null || amount === '' ? rebateProgress(r).earned : Math.max(0, int(amount));
        if (!(value > 0)) throw new PosError('INVALID_AMOUNT');
        db.prepare("INSERT INTO supplier_payments (supplier_id, amount, method, user_id, notes, rebate_id) VALUES (?, ?, 'rebate', ?, ?, ?)")
          .run(r.supplier_id, value, u.id, str(notes) || r.name, r.id);
        db.prepare("UPDATE supplier_rebates SET status = 'settled', settled_amount = ?, settled_at = datetime('now', 'localtime') WHERE id = ?").run(value, id);
        audit('rebate_settle', { entity: 'supplier', entityId: r.supplier_id, details: { name: r.name, amount: value } });
        return rebateProgress(db.prepare('SELECT * FROM supplier_rebates WHERE id = ?').get(id));
      });
    },
    cancel(id) {
      requirePerm('purchases');
      const r = db.prepare('SELECT * FROM supplier_rebates WHERE id = ?').get(id);
      if (!r || r.status !== 'open') throw new PosError('INVALID_STATUS');
      db.prepare("UPDATE supplier_rebates SET status = 'cancelled' WHERE id = ?").run(id);
      audit('rebate_cancel', { entity: 'supplier', entityId: r.supplier_id, details: { name: r.name } });
      return true;
    },
  };

  // ---------- kitchen stations, tickets and the kitchen display ----------
  const activeStations = () => plainAll(db.prepare('SELECT * FROM kitchen_stations WHERE active = 1 ORDER BY sort, id').all());

  /**
   * Turns an order's unsent kitchen items into one ticket per station (the product's
   * station, else its category's, else the first station) and marks everything sent.
   * Returns the tickets with their station so the caller can print them.
   */
  function dispatchKitchen(order) {
    const stations = activeStations();
    const byId = new Map(stations.map((st) => [st.id, st]));
    const rows = db.prepare(`
      SELECT i.id, i.name, i.qty, i.kitchen_sent, i.note, i.modifiers, p.station_id AS p_station, c.station_id AS c_station
      FROM order_items i JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE i.order_id = ? AND p.kitchen = 1 AND i.qty > i.kitchen_sent ORDER BY i.id`).all(order.id);
    const groups = new Map();
    for (const r of rows) {
      const st = byId.get(r.p_station) || byId.get(r.c_station) || stations[0] || null;
      const key = st?.id ?? 0;
      if (!groups.has(key)) groups.set(key, { station: st, items: [] });
      const mods = r.modifiers ? JSON.parse(r.modifiers).map((m) => m.name).join('، ') : '';
      groups.get(key).items.push({ name: r.name, qty: r.qty - r.kitchen_sent, note: [mods, r.note].filter(Boolean).join(' — ') });
    }
    db.prepare('UPDATE order_items SET kitchen_sent = qty WHERE order_id = ?').run(order.id);
    const tickets = [];
    for (const g of groups.values()) {
      const id = Number(db.prepare('INSERT INTO kitchen_tickets (order_id, station_id, items, table_name, order_type, user_name, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(order.id, g.station?.id ?? null, JSON.stringify(g.items), order.table_name || '', order.order_type, order.user_name || session.user?.name || '', order.note || '').lastInsertRowid);
      tickets.push({ id, station: g.station, items: g.items });
    }
    return tickets;
  }

  const kitchenStations = {
    list() {
      requireUser();
      return plainAll(db.prepare('SELECT * FROM kitchen_stations ORDER BY sort, id').all());
    },
    save(st = {}) {
      requirePerm('settings');
      if (!str(st.name)) throw new PosError('NAME_REQUIRED');
      const vals = [str(st.name), str(st.printer_name), Math.min(5, Math.max(1, int(st.copies, 1))), st.print === false ? 0 : 1, st.display === false ? 0 : 1, int(st.sort), st.active === false ? 0 : 1];
      if (st.id) {
        db.prepare('UPDATE kitchen_stations SET name = ?, printer_name = ?, copies = ?, print = ?, display = ?, sort = ?, active = ? WHERE id = ?').run(...vals, st.id);
        return st.id;
      }
      return Number(db.prepare('INSERT INTO kitchen_stations (name, printer_name, copies, print, display, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...vals).lastInsertRowid);
    },
    remove(id) {
      requirePerm('settings');
      db.prepare('DELETE FROM kitchen_stations WHERE id = ?').run(id);
      return true;
    },
    /** Which station each category's dishes go to. */
    setCategory({ categoryId, stationId } = {}) {
      requirePerm('settings');
      db.prepare('UPDATE categories SET station_id = ? WHERE id = ?').run(int(stationId) || null, categoryId);
      return true;
    },
  };

  /**
   * The kitchen display. Not reachable through the app's IPC: the main process serves it
   * over a local HTTP server guarded by an access key, so no one has to sign in on it.
   */
  const NEXT = { new: 'preparing', preparing: 'ready', ready: 'served' };
  const kds = {
    state({ stationId = null } = {}) {
      const s = getSettings();
      const params = [];
      let where = "k.status IN ('new', 'preparing', 'ready')";
      if (int(stationId)) { where += ' AND k.station_id = ?'; params.push(int(stationId)); }
      const tickets = db.prepare(`
        SELECT k.*, st.name AS station_name, o.guests,
          CAST((julianday('now', 'localtime') - julianday(k.created_at)) * 1440 AS INTEGER) AS minutes
        FROM kitchen_tickets k LEFT JOIN kitchen_stations st ON st.id = k.station_id LEFT JOIN orders o ON o.id = k.order_id
        WHERE ${where} AND (st.id IS NULL OR st.display = 1) ORDER BY k.id`).all(...params)
        .map((k) => ({ ...plain(k), items: JSON.parse(k.items) }));
      return {
        business_name: s.business_name, language: s.language,
        stations: activeStations().filter((st) => st.display).map(({ id, name }) => ({ id, name })),
        tickets,
      };
    },
    /** Moves a ticket on: new → preparing → ready → served (or to a given status). */
    bump({ id, to = null } = {}) {
      const k = db.prepare('SELECT status FROM kitchen_tickets WHERE id = ?').get(int(id));
      if (!k) throw new PosError('NOT_FOUND');
      const next = to && ['new', 'preparing', 'ready', 'served'].includes(to) ? to : NEXT[k.status];
      if (!next) throw new PosError('INVALID_STATUS');
      const col = { preparing: 'started_at', ready: 'ready_at', served: 'served_at' }[next];
      db.prepare(`UPDATE kitchen_tickets SET status = ?${col ? `, ${col} = datetime('now', 'localtime')` : ''} WHERE id = ?`).run(next, int(id));
      return true;
    },
    /** Brings back the last ticket served by mistake. */
    recall({ stationId = null } = {}) {
      const k = int(stationId)
        ? db.prepare("SELECT id FROM kitchen_tickets WHERE status = 'served' AND station_id = ? ORDER BY served_at DESC, id DESC LIMIT 1").get(int(stationId))
        : db.prepare("SELECT id FROM kitchen_tickets WHERE status = 'served' ORDER BY served_at DESC, id DESC LIMIT 1").get();
      if (!k) return false;
      db.prepare("UPDATE kitchen_tickets SET status = 'ready', served_at = NULL WHERE id = ?").run(k.id);
      return true;
    },
    /** Creates the access key the first time (8 characters, no look-alike letters). */
    ensureKey() {
      let key = getSettings().kds_key;
      if (!key) {
        const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        key = Array.from(crypto.randomBytes(8), (b) => abc[b % abc.length]).join('');
        writeSettings({ kds_key: key });
      }
      return key;
    },
  };
  settings.newKdsKey = () => {
    requirePerm('settings');
    writeSettings({ kds_key: '' });
    audit('kds_key_reset');
    return kds.ensureKey();
  };

  // ---------- purchase orders (what we ask suppliers to deliver) ----------
  function getPo(id) {
    const po = plain(db.prepare(`SELECT po.*, s.name AS supplier_name, s.phone AS supplier_phone, u.name AS user_name
      FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id JOIN users u ON u.id = po.user_id WHERE po.id = ?`).get(id));
    if (!po) throw new PosError('NOT_FOUND');
    po.items = plainAll(db.prepare(`SELECT i.*, p.name, p.barcode, p.stock, p.min_stock, p.unit, pu.name AS unit_name, COALESCE(pu.factor, 1) AS unit_factor
      FROM purchase_order_items i JOIN products p ON p.id = i.product_id LEFT JOIN product_units pu ON pu.id = i.unit_id WHERE i.po_id = ? ORDER BY i.id`).all(id));
    po.total = po.items.reduce((sum, i) => sum + Math.round(i.qty * i.unit_cost), 0);
    if (!can('view_cost')) { po.items = po.items.map(({ unit_cost, ...i }) => i); delete po.total; }
    return po;
  }

  const purchaseOrders = {
    list({ status = '' } = {}) {
      requirePerm('purchases');
      return plainAll(db.prepare(`SELECT po.*, s.name AS supplier_name,
          (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = po.id) AS item_count,
          (SELECT COALESCE(SUM(i.qty * i.unit_cost), 0) FROM purchase_order_items i WHERE i.po_id = po.id) AS total
        FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
        ${status ? 'WHERE po.status = ?' : ''} ORDER BY po.id DESC LIMIT 300`).all(...(status ? [status] : [])));
    },
    get(id) {
      requirePerm('purchases');
      return getPo(id);
    },
    /**
     * Products at or below their reorder level, grouped by supplier, with a suggested
     * quantity that brings stock back to twice the reorder level.
     */
    suggest() {
      requirePerm('purchases');
      const rows = db.prepare(`SELECT p.id AS product_id, p.name, p.stock, p.min_stock, p.cost, p.unit, p.supplier_id, s.name AS supplier_name
        FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.active = 1 AND p.track_stock = 1 AND p.min_stock > 0 AND p.stock <= p.min_stock ORDER BY s.name, p.name`).all();
      const groups = new Map();
      for (const r of rows) {
        const key = r.supplier_id || 0;
        if (!groups.has(key)) groups.set(key, { supplier_id: r.supplier_id, supplier_name: r.supplier_name || '', items: [] });
        groups.get(key).items.push({ product_id: r.product_id, name: r.name, stock: r.stock, min_stock: r.min_stock, unit: r.unit,
          qty: Math.max(1, Math.ceil(r.min_stock * 2 - Math.max(0, r.stock))), unit_cost: can('view_cost') ? r.cost : 0 });
      }
      return [...groups.values()];
    },
    save(po = {}) {
      const u = requirePerm('purchases').user;
      const items = (po.items || []).map((i) => ({ product_id: int(i.product_id), unit_id: int(i.unit_id) || null, qty: num(i.qty), unit_cost: Math.max(0, int(i.unit_cost)) }))
        .filter((i) => i.product_id && i.qty > 0);
      if (!items.length) throw new PosError('EMPTY_CART');
      return transaction(db, () => {
        let id = int(po.id) || null;
        if (id) {
          const cur = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id);
          if (!cur) throw new PosError('NOT_FOUND');
          if (!['draft', 'sent'].includes(cur.status)) throw new PosError('INVALID_STATUS');
          db.prepare('UPDATE purchase_orders SET supplier_id = ?, notes = ? WHERE id = ?').run(int(po.supplier_id) || null, str(po.notes), id);
          db.prepare('DELETE FROM purchase_order_items WHERE po_id = ?').run(id);
        } else {
          const no = (db.prepare('SELECT MAX(po_no) AS n FROM purchase_orders').get().n || 0) + 1;
          id = Number(db.prepare('INSERT INTO purchase_orders (po_no, supplier_id, notes, user_id) VALUES (?, ?, ?, ?)').run(no, int(po.supplier_id) || null, str(po.notes), u.id).lastInsertRowid);
        }
        const ins = db.prepare('INSERT INTO purchase_order_items (po_id, product_id, unit_id, qty, unit_cost) VALUES (?, ?, ?, ?, ?)');
        for (const i of items) ins.run(id, i.product_id, i.unit_id, i.qty, i.unit_cost);
        audit('po_save', { entity: 'purchase_order', entityId: id, details: { items: items.length } });
        return getPo(id);
      });
    },
    setStatus({ id, status } = {}) {
      requirePerm('purchases');
      if (!['draft', 'sent', 'cancelled'].includes(status)) throw new PosError('INVALID_STATUS');
      const cur = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id);
      if (!cur || cur.status === 'received') throw new PosError('INVALID_STATUS');
      db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run(status, id);
      return getPo(id);
    },
  };

  // ---------- cash drawer ----------
  const drawer = {
    /** Opening the drawer without a sale needs 'open_drawer' (or a supervisor) and is logged. */
    authorize({ approval = null } = {}) {
      const { approvedBy } = requirePerm('open_drawer', approval);
      audit('drawer_open', { approvedBy });
      return true;
    },
  };

  // ---------- owner dashboard ----------
  function dashboard() {
    requirePerm('reports');
    const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };
    const today = day(0);
    const sales = (from, to) => plain(db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(credit), 0) AS credit
      FROM orders WHERE status = 'completed' AND completed_at >= ? AND completed_at < date(?, '+1 day')`).get(from, to));
    const profit = (from, to) => Math.round(db.prepare(`SELECT COALESCE(SUM(i.line_total * (i.qty - i.returned_qty) / i.qty - i.unit_cost * (i.qty - i.returned_qty)), 0) AS p
      FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status = 'completed' AND o.completed_at >= ? AND o.completed_at < date(?, '+1 day')`).get(from, to).p);
    const refunds = (from, to) => db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM returns WHERE created_at >= ? AND created_at < date(?, '+1 day')").get(from, to).t;
    const showCost = can('view_cost');
    const shift = currentShift();
    const aging = db.prepare('SELECT id FROM customers WHERE active = 1').all().map((c) => openItems(c.id).open).flat();
    const receivables = aging.reduce((sum, d) => sum + d.open, 0);
    const overdue = aging.filter((d) => d.due_date < today);
    const weekAhead = day(7);
    return {
      today: { ...sales(today, today), refunds: refunds(today, today), profit: showCost ? profit(today, today) : null },
      yesterday: { ...sales(day(-1), day(-1)), profit: showCost ? profit(day(-1), day(-1)) : null },
      month: { ...sales(today.slice(0, 8) + '01', today), profit: showCost ? profit(today.slice(0, 8) + '01', today) : null },
      last7: plainAll(db.prepare(`SELECT date(completed_at) AS day, COALESCE(SUM(total), 0) AS total, COUNT(*) AS orders FROM orders
        WHERE status = 'completed' AND completed_at >= date('now', 'localtime', '-6 days') GROUP BY day ORDER BY day`).all()),
      byHour: plainAll(db.prepare(`SELECT CAST(strftime('%H', completed_at) AS INTEGER) AS hour, SUM(total) AS total FROM orders
        WHERE status = 'completed' AND completed_at >= ? GROUP BY hour ORDER BY hour`).all(today)),
      topProducts: plainAll(db.prepare(`SELECT i.name, SUM(i.qty - i.returned_qty) AS qty, SUM(i.line_total * (i.qty - i.returned_qty) / i.qty) AS total
        FROM order_items i JOIN orders o ON o.id = i.order_id WHERE o.status = 'completed' AND o.completed_at >= ?
        GROUP BY COALESCE(i.product_id, i.name) ORDER BY total DESC LIMIT 5`).all(today)),
      shift: shift ? { id: shift.id, opened_at: shift.opened_at, expectedCash: shiftSummary(shift.id).expectedCash } : null,
      lowStock: plainAll(db.prepare(`SELECT id, name, stock, min_stock, unit FROM products WHERE active = 1 AND track_stock = 1 AND min_stock > 0 AND stock <= min_stock ORDER BY stock - min_stock LIMIT 8`).all()),
      lowStockCount: db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND track_stock = 1 AND min_stock > 0 AND stock <= min_stock').get().n,
      expiring: db.prepare("SELECT COUNT(*) AS n FROM batches WHERE qty > 0 AND expiry_date IS NOT NULL AND expiry_date <= date('now', 'localtime', '+30 days')").get().n,
      receivables, overdueAmount: overdue.reduce((sum, d) => sum + d.open, 0), overdueCount: overdue.length,
      chequesDue: plainAll(db.prepare(`SELECT p.id, p.amount, p.cheque_no, p.bank, p.cheque_due, c.name AS customer_name FROM customer_payments p JOIN customers c ON c.id = p.customer_id
        WHERE p.method = 'cheque' AND p.status = 'posted' AND p.cheque_status = 'pending' AND p.cheque_due <= ? ORDER BY p.cheque_due LIMIT 8`).all(weekAhead)),
      openOrders: db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'open'").get().n,
      payables: db.prepare(`SELECT COALESCE(SUM(b), 0) AS t FROM (SELECT ${SUPPLIER_BALANCE} AS b FROM suppliers s) WHERE b > 0`).get().t,
      hiddenProfit: !showCost,
    };
  }

  // ---------- modifiers (sizes, extras, "no onion") ----------
  const modifierGroups = () => {
    const groups = plainAll(db.prepare('SELECT * FROM modifier_groups ORDER BY sort, id').all());
    const opts = plainAll(db.prepare(`SELECT o.*, p.name AS ingredient_name, p.unit AS ingredient_unit FROM modifier_options o LEFT JOIN products p ON p.id = o.ingredient_id ORDER BY o.sort, o.id`).all());
    return groups.map((g) => ({ ...g, options: opts.filter((o) => o.group_id === g.id) }));
  };
  const modifiers = {
    list() {
      requireUser();
      return modifierGroups();
    },
    /** The groups (with active options) to choose from when selling a product. */
    forProduct(productId) {
      requireUser();
      const ids = db.prepare('SELECT group_id FROM product_modifier_groups WHERE product_id = ? ORDER BY sort').all(productId).map((r) => r.group_id);
      return modifierGroups().filter((g) => g.active && ids.includes(g.id))
        .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
        .map((g) => ({ ...g, options: g.options.filter((o) => o.active).map(({ ingredient_id, ingredient_qty, ingredient_name, ingredient_unit, ...o }) => o) }));
    },
    save(g = {}) {
      requirePerm('products');
      if (!str(g.name)) throw new PosError('NAME_REQUIRED');
      const options = (g.options || []).filter((o) => str(o.name));
      if (!options.length) throw new PosError('OPTIONS_REQUIRED');
      return transaction(db, () => {
        const vals = [str(g.name), Math.max(0, int(g.min_select)), Math.max(0, int(g.max_select, 1)), int(g.sort), g.active === false ? 0 : 1];
        let id = int(g.id) || null;
        if (id) db.prepare('UPDATE modifier_groups SET name = ?, min_select = ?, max_select = ?, sort = ?, active = ? WHERE id = ?').run(...vals, id);
        else id = Number(db.prepare('INSERT INTO modifier_groups (name, min_select, max_select, sort, active) VALUES (?, ?, ?, ?, ?)').run(...vals).lastInsertRowid);
        const keep = [];
        options.forEach((o, i) => {
          const ov = [str(o.name), Math.max(0, int(o.price)), int(o.ingredient_id) || null, Math.max(0, num(o.ingredient_qty)), i, o.active === false ? 0 : 1];
          if (o.id && db.prepare('SELECT 1 FROM modifier_options WHERE id = ? AND group_id = ?').get(o.id, id)) {
            db.prepare('UPDATE modifier_options SET name = ?, price = ?, ingredient_id = ?, ingredient_qty = ?, sort = ?, active = ? WHERE id = ?').run(...ov, o.id);
            keep.push(o.id);
          } else keep.push(Number(db.prepare('INSERT INTO modifier_options (group_id, name, price, ingredient_id, ingredient_qty, sort, active) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, ...ov).lastInsertRowid));
        });
        // Options already used on invoices are switched off rather than deleted.
        for (const { id: oid } of db.prepare('SELECT id FROM modifier_options WHERE group_id = ?').all(id)) {
          if (!keep.includes(oid)) db.prepare('UPDATE modifier_options SET active = 0 WHERE id = ?').run(oid);
        }
        audit('modifier_save', { entity: 'modifier_group', entityId: id, details: { name: vals[0] } });
        return id;
      });
    },
    remove(id) {
      requirePerm('products');
      db.prepare('UPDATE modifier_groups SET active = 0 WHERE id = ?').run(id);
      db.prepare('DELETE FROM product_modifier_groups WHERE group_id = ?').run(id);
      return true;
    },
  };

  // ---------- delivery ----------
  const delivery = {
    zones() {
      requireUser();
      return plainAll(db.prepare('SELECT * FROM delivery_zones ORDER BY active DESC, name').all());
    },
    saveZone(z = {}) {
      requirePerm('settings');
      if (!str(z.name)) throw new PosError('NAME_REQUIRED');
      const vals = [str(z.name), Math.max(0, int(z.fee)), z.active === false ? 0 : 1];
      if (z.id) { db.prepare('UPDATE delivery_zones SET name = ?, fee = ?, active = ? WHERE id = ?').run(...vals, z.id); return z.id; }
      return Number(db.prepare('INSERT INTO delivery_zones (name, fee, active) VALUES (?, ?, ?)').run(...vals).lastInsertRowid);
    },
    drivers() {
      requireUser();
      return plainAll(db.prepare('SELECT * FROM drivers ORDER BY active DESC, name').all());
    },
    saveDriver(d = {}) {
      requirePerm('settings');
      if (!str(d.name)) throw new PosError('NAME_REQUIRED');
      const vals = [str(d.name), str(d.phone), d.active === false ? 0 : 1];
      if (d.id) { db.prepare('UPDATE drivers SET name = ?, phone = ?, active = ? WHERE id = ?').run(...vals, d.id); return d.id; }
      return Number(db.prepare('INSERT INTO drivers (name, phone, active) VALUES (?, ?, ?)').run(...vals).lastInsertRowid);
    },
    /** Open delivery orders (waiting / out with a driver) and today's delivered ones. */
    board() {
      requireUser();
      const rows = plainAll(db.prepare(`
        SELECT o.id, o.invoice_no, o.status, o.total, o.delivery_fee, o.delivery_status, o.created_at, o.out_at, o.delivered_at, o.completed_at,
          COALESCE(c.name, o.customer_name) AS customer_name, COALESCE(c.phone, o.customer_phone) AS customer_phone, o.customer_address,
          z.name AS zone_name, d.name AS driver_name, o.driver_id,
          CAST((julianday('now', 'localtime') - julianday(o.created_at)) * 1440 AS INTEGER) AS minutes,
          (SELECT COUNT(*) FROM kitchen_tickets k WHERE k.order_id = o.id AND k.status IN ('new', 'preparing')) AS cooking
        FROM orders o LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN delivery_zones z ON z.id = o.zone_id LEFT JOIN drivers d ON d.id = o.driver_id
        WHERE o.order_type = 'delivery' AND (o.status = 'open' OR (o.status = 'completed' AND o.completed_at >= date('now', 'localtime')))
        ORDER BY o.created_at`).all());
      return {
        waiting: rows.filter((r) => r.status === 'open' && r.delivery_status !== 'out'),
        out: rows.filter((r) => r.status === 'open' && r.delivery_status === 'out'),
        delivered: rows.filter((r) => r.status === 'completed'),
      };
    },
    /** The order leaves with a driver. */
    dispatch({ orderId, driverId } = {}) {
      requireUser();
      const o = db.prepare("SELECT status, order_type FROM orders WHERE id = ?").get(orderId);
      if (!o || o.status !== 'open' || o.order_type !== 'delivery') throw new PosError('ORDER_NOT_OPEN');
      if (!db.prepare('SELECT 1 FROM drivers WHERE id = ? AND active = 1').get(int(driverId))) throw new PosError('DRIVER_REQUIRED');
      db.prepare("UPDATE orders SET driver_id = ?, delivery_status = 'out', out_at = datetime('now', 'localtime') WHERE id = ?").run(int(driverId), orderId);
      audit('delivery_out', { entity: 'order', entityId: orderId, details: { driver: db.prepare('SELECT name FROM drivers WHERE id = ?').get(int(driverId)).name } });
      return getOrder(orderId);
    },
    /** Per driver: orders delivered, money collected, fees — for settling with each driver. */
    drivers_report({ from, to } = {}) {
      requirePerm('reports');
      const [f, t] = dateRange(from, to);
      return plainAll(db.prepare(`
        SELECT d.id, d.name, COUNT(o.id) AS orders, COALESCE(SUM(o.total), 0) AS total, COALESCE(SUM(o.delivery_fee), 0) AS fees,
          COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.order_id = o.id AND p.method = 'cash')), 0) AS cash,
          COALESCE(SUM(o.credit), 0) AS on_account
        FROM drivers d JOIN orders o ON o.driver_id = d.id
        WHERE o.status = 'completed' AND o.completed_at >= ? AND o.completed_at < date(?, '+1 day')
        GROUP BY d.id ORDER BY total DESC`).all(f, t));
    },
  };

  return {
    session, settings, auth, users, categories, products, tables, shifts, orders, suppliers, purchases, expenses, customers, reports,
    auditLog, commissions, importer, priceLists, quotes, stockCounts, promotions, rebates, floor, kitchenStations, kds, purchaseOrders, drawer, modifiers, delivery, requireAdmin, requirePerm, audit, can,
  };
}

module.exports = { createServices, PosError, DEFAULT_SETTINGS, hashPin, verifyPin };
