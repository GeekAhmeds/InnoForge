'use strict';
// Service namespaces the window may call (through pos:call), and — for the main computer's
// network server — the few extra functions the main process of another computer needs.
// Anything else (e.g. kds, admitDevice) is never reachable from a window or the network.
const EXPOSED = ['settings', 'auth', 'users', 'categories', 'products', 'tables', 'shifts', 'orders', 'suppliers', 'purchases', 'expenses', 'customers', 'reports', 'auditLog', 'commissions', 'importer', 'priceLists', 'quotes', 'stockCounts', 'promotions', 'rebates', 'floor', 'kitchenStations', 'purchaseOrders', 'modifiers', 'delivery', 'treasury', 'warehouses', 'installments', 'coupons', 'giftCards', 'employees', 'devices', 'eta', 'zatca'];

const REMOTE_EXTRA = new Set([
  'requirePerm', 'audit', 'can', 'license.get', 'license.requireFeature', 'drawer.authorize',
  'kds.ensureKey', 'kds.state', 'kds.bump', 'kds.recall',
]);

/** Can this "ns.method" (or top-level function) be called from another computer? */
const remoteAllowed = (path) => {
  if (REMOTE_EXTRA.has(path)) return true;
  const [ns, method, extra] = String(path).split('.');
  return !!method && extra === undefined && EXPOSED.includes(ns);
};

module.exports = { EXPOSED, remoteAllowed };
