'use strict';
// What a license allows: an edition (a bundle of features with default limits), add-on
// features sold on top, and limits (0 = unlimited). Shared by the app, the services and
// tools/license.cjs; tools/license-generator.html carries a copy (kept equal by a test).
const DATA = require('./editions.json');

const FEATURES = Object.keys(DATA.features);
const EDITIONS = Object.keys(DATA.editions);
const LIMITS = Object.keys(DATA.limits);

const FULL = Object.freeze({ edition: 'full', features: new Set(FEATURES), addons: [], limits: { users: 0, warehouses: 0 } });

/**
 * Turns a license payload into what it allows. Keys issued before editions existed carry
 * no `edition`; they were all issued by the vendor for full use, so they stay full.
 */
function entitlements(payload) {
  if (!payload || !payload.edition) return FULL;
  const ed = DATA.editions[payload.edition];
  if (!ed) return { edition: payload.edition, features: new Set(), addons: [], limits: { users: 1, warehouses: 1 } };
  const base = ed.features === '*' ? FEATURES : ed.features;
  const addons = (Array.isArray(payload.addons) ? payload.addons : []).filter((f) => FEATURES.includes(f));
  const limits = {};
  for (const k of LIMITS) {
    const v = payload.limits?.[k];
    limits[k] = Number.isInteger(v) && v >= 0 ? v : ed.limits[k] ?? 0;
  }
  // Selling several warehouses without allowing more than one would be pointless.
  if ((base.includes('warehouses') || addons.includes('warehouses')) && limits.warehouses === 1 && payload.limits?.warehouses == null) limits.warehouses = 3;
  return { edition: payload.edition, features: new Set([...base, ...addons]), addons, limits };
}

/** Plain JSON form for the renderer. */
const toJSON = (e) => ({ edition: e.edition, features: [...e.features], addons: e.addons, limits: e.limits });

/** Checks a reseller certificate allows this license (edition, add-ons, duration, limits). */
function resellerAllows(cert, payload) {
  if (cert.editions !== '*' && !(cert.editions || []).includes(payload.edition || 'full')) return 'RESELLER_EDITION';
  const addons = payload.addons || [];
  if (cert.addons !== '*' && addons.some((a) => !(cert.addons || []).includes(a))) return 'RESELLER_ADDON';
  if (cert.max_days > 0) {
    if (!payload.expires) return 'RESELLER_DURATION';
    const days = (Date.parse(payload.expires) - Date.parse(payload.issued)) / 86400000;
    if (days > cert.max_days + 1) return 'RESELLER_DURATION';
  }
  for (const k of LIMITS) {
    const cap = cert.max_limits?.[k];
    if (!cap) continue;
    const v = entitlements(payload).limits[k];
    if (v === 0 || v > cap) return 'RESELLER_LIMIT';
  }
  const issued = Date.parse(payload.issued);
  if (!(issued >= Date.parse(cert.issued)) || (cert.expires && issued > Date.parse(cert.expires))) return 'RESELLER_EXPIRED';
  if ((DATA.revoked_resellers || []).includes(cert.id)) return 'RESELLER_REVOKED';
  return null;
}

module.exports = { DATA, FEATURES, EDITIONS, LIMITS, FULL, entitlements, toJSON, resellerAllows };
