'use strict';
// Role defaults + per-user overrides. A user's effective permissions are the
// role's defaults with their own overrides on top; admins always have everything
// so nobody can lock themselves out.

// Boolean permissions, in the order the settings screen lists them.
const PERMISSIONS = [
  'discount',        // give line / invoice discounts (up to max_discount %)
  'price_override',  // change a product's price in the cart
  'credit_sale',     // sell on a customer's account
  'refund',          // returns from completed invoices
  'void',            // cancel open orders already sent to the kitchen
  'open_drawer',     // open the cash drawer without a sale
  'view_cost',       // see cost prices and profit
  'products',        // manage products, categories, stock
  'purchases',       // suppliers, purchase invoices, purchase returns, stock counts
  'expenses',        // record expenses outside the drawer, delete expenses
  'treasury',        // cash boxes and bank accounts: balances, transfers, cheques
  'employees',       // employees, attendance corrections, advances, payroll
  'customers_edit',  // credit limits, price lists, deactivate customers
  'reports',         // reports & commissions
  'shifts_all',      // see every shift, not just the current one
  'audit',           // read the activity log
  'settings',        // business settings, tables, printing, price lists, promotions
  'users',           // users and permissions
  'backup',          // backup / restore / import / export
  'approve',         // approve other users' restricted actions with their PIN
];

const ALL = Object.fromEntries(PERMISSIONS.map((p) => [p, true]));

const ROLE_DEFAULTS = {
  admin: { ...ALL, max_discount: 100 },
  supervisor: {
    ...ALL, settings: false, users: false, backup: false, max_discount: 30,
  },
  cashier: {
    ...Object.fromEntries(PERMISSIONS.map((p) => [p, false])), discount: true, credit_sale: true, max_discount: 10,
  },
};

function parseOverrides(json) {
  try {
    const o = typeof json === 'string' ? JSON.parse(json || '{}') : json || {};
    const clean = {};
    for (const p of PERMISSIONS) if (typeof o[p] === 'boolean') clean[p] = o[p];
    if (o.max_discount != null && Number.isFinite(Number(o.max_discount))) clean.max_discount = Math.min(100, Math.max(0, Number(o.max_discount)));
    return clean;
  } catch {
    return {};
  }
}

function effectivePermissions(user) {
  if (!user) return {};
  if (user.role === 'admin') return { ...ROLE_DEFAULTS.admin };
  return { ...(ROLE_DEFAULTS[user.role] || ROLE_DEFAULTS.cashier), ...parseOverrides(user.permissions) };
}

module.exports = { PERMISSIONS, ROLE_DEFAULTS, effectivePermissions, parseOverrides };
