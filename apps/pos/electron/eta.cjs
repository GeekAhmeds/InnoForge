'use strict';
// Egyptian Tax Authority (ETA) e-invoice (B2B, document v1.0) and e-receipt (B2C, v1.2):
// turning a completed sale into the ETA JSON, the canonical serialization ETA hashes and
// signs, and the e-receipt UUID chain. Pure functions — the network part is eta-submitter.cjs.
//
// Built from ETA's published SDK documentation. It has NOT yet been run against the live
// ETA system: test every new taxpayer on the pre-production environment first.
const crypto = require('node:crypto');

const ENDPOINTS = {
  preprod: { id: 'https://id.preprod.eta.gov.eg', api: 'https://api.preprod.invoicing.eta.gov.eg', portal: 'https://preprod.invoicing.eta.gov.eg' },
  prod: { id: 'https://id.eta.gov.eg', api: 'https://api.invoicing.eta.gov.eg', portal: 'https://invoicing.eta.gov.eg' },
};

/**
 * ETA canonical serialization: every property name in upper case and quoted, every value
 * quoted; an array repeats its property name before each element.
 */
function serialize(value) {
  if (value === null || value === undefined) return '""';
  if (typeof value !== 'object') return `"${String(value)}"`;
  let out = '';
  for (const [key, v] of Object.entries(value)) {
    const name = `"${key.toUpperCase()}"`;
    if (Array.isArray(v)) {
      out += name;
      for (const el of v) out += name + serialize(el);
    } else {
      out += name + serialize(v);
    }
  }
  return out;
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** E-receipt UUID: SHA-256 of the serialized receipt with an empty uuid. */
function receiptUuid(receipt) {
  const copy = JSON.parse(JSON.stringify(receipt));
  copy.header.uuid = '';
  return sha256(serialize(copy));
}

const r5 = (n) => Math.round((n + Number.EPSILON) * 1e5) / 1e5;

/**
 * Splits a sale into ETA lines, each with: description, codes, qty, unit value, sales
 * total, discount, net, tax, total (decimal EGP). The cart discount, coupons and the
 * tax already inside prices are spread over the lines so they add up to the sale's net;
 * the service charge and delivery fee become lines of their own.
 */
function saleLines({ order, items, products = {}, settings }) {
  const scale = 10 ** (settings.decimals ?? 2);
  const rate = Number(order.tax) > 0 ? Number(settings.tax_rate) || 0 : 0;
  const inclusive = !!settings.prices_include_tax;
  const raw = items.map((it) => {
    const p = products[it.product_id] || {};
    return {
      description: it.name + (it.unit_name ? ` (${it.unit_name})` : ''),
      itemType: p.eta_item_type || settings.eta_item_type || 'EGS',
      itemCode: p.eta_item_code || settings.eta_item_code || '',
      unitType: p.eta_unit || settings.eta_unit || 'EA',
      internalCode: String(p.barcode || it.product_id || ''),
      qty: Number(it.qty),
      gross: Math.round(it.unit_price * it.qty), // before the line's own discount
      amount: it.line_total, // after it
    };
  });
  const extra = [['service', order.service], ['delivery_fee', order.delivery_fee]].filter(([, v]) => v > 0);
  for (const [kind, v] of extra) {
    raw.push({ description: settings[`eta_${kind}_name`] || (kind === 'service' ? 'خدمة' : 'توصيل'), itemType: settings.eta_item_type || 'EGS', itemCode: settings.eta_item_code || '', unitType: 'EA', internalCode: kind, qty: 1, gross: v, amount: v });
  }
  // What all lines must add up to before tax.
  const net = order.total - order.tax;
  const sum = raw.reduce((s, l) => s + l.amount, 0);
  let left = sum - net; // cart discount + tax inside prices (+ rounding)
  const shares = raw.map((l, i) => {
    if (i === raw.length - 1 || sum === 0) return left;
    const share = Math.round(((sum - net) * l.amount) / sum);
    left -= share;
    return share;
  });
  return raw.map((l, i) => {
    const netMinor = l.amount - shares[i];
    const gross = inclusive ? (l.gross * 100) / (100 + rate) : l.gross;
    const unitValue = r5(gross / scale / l.qty);
    const salesTotal = r5(unitValue * l.qty);
    const netTotal = r5(netMinor / scale);
    const discount = r5(Math.max(0, salesTotal - netTotal));
    const tax = r5((netTotal * rate) / 100);
    return { ...l, unitValue, salesTotal, discount, netTotal: r5(salesTotal - discount), tax, total: r5(salesTotal - discount + tax), rate };
  });
}

const taxItem = (l, settings) => ({ taxType: 'T1', amount: l.tax, subType: l.rate > 0 ? settings.eta_tax_subtype || 'V009' : settings.eta_tax_subtype_zero || 'V003', rate: l.rate });

const issuerAddress = (s) => ({
  branchID: String(s.eta_branch || '0'), country: s.eta_country || 'EG', governate: s.eta_governate || '', regionCity: s.eta_city || '',
  street: s.eta_street || '', buildingNumber: String(s.eta_building || ''),
});

/** "2026-10-11 14:30:05" (local) → "2026-10-11T12:30:05Z". */
function etaDate(localText) {
  const d = localText ? new Date(String(localText).replace(' ', 'T')) : new Date();
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** B2B e-invoice (documentType I = invoice, C = credit note). Unsigned; see signatures. */
function buildInvoice({ order, items, products, customer, settings, type = 'I', references }) {
  const lines = saleLines({ order, items, products, settings });
  const recv = customer?.eta || {};
  const receiverType = recv.type || (customer?.tax_number ? 'B' : 'P');
  const doc = {
    issuer: { address: issuerAddress(settings), type: 'B', id: String(settings.eta_rin || ''), name: settings.eta_name || settings.business_name || '' },
    receiver: {
      address: { country: recv.country || 'EG', governate: recv.governate || '', regionCity: recv.regionCity || '', street: recv.street || customer?.address || '', buildingNumber: String(recv.buildingNumber || '') },
      type: receiverType,
      id: receiverType === 'B' ? String(customer?.tax_number || '') : String(recv.id || ''),
      name: customer?.name || order.customer_name || '',
    },
    documentType: type,
    documentTypeVersion: '1.0',
    dateTimeIssued: etaDate(order.completed_at),
    taxpayerActivityCode: String(settings.eta_activity || ''),
    internalID: String(order.invoice_no ?? order.id),
    ...(references ? { references } : {}),
    invoiceLines: lines.map((l) => ({
      description: l.description, itemType: l.itemType, itemCode: l.itemCode, unitType: l.unitType, quantity: l.qty, internalCode: l.internalCode,
      salesTotal: l.salesTotal, total: l.total, valueDifference: 0, totalTaxableFees: 0, netTotal: l.netTotal, itemsDiscount: 0,
      unitValue: { currencySold: 'EGP', amountEGP: l.unitValue },
      discount: { rate: 0, amount: l.discount },
      taxableItems: [taxItem(l, settings)],
    })),
  };
  const totalSales = r5(lines.reduce((s, l) => s + l.salesTotal, 0));
  const totalDiscount = r5(lines.reduce((s, l) => s + l.discount, 0));
  const taxTotal = r5(lines.reduce((s, l) => s + l.tax, 0));
  Object.assign(doc, {
    totalDiscountAmount: totalDiscount,
    totalSalesAmount: totalSales,
    netAmount: r5(totalSales - totalDiscount),
    taxTotals: [{ taxType: 'T1', amount: taxTotal }],
    totalAmount: r5(totalSales - totalDiscount + taxTotal),
    extraDiscountAmount: 0,
    totalItemsDiscountAmount: 0,
  });
  return doc;
}

/** B2C e-receipt v1.2 (S = sale, R = return), with its UUID and the device chain. */
function buildReceipt({ order, items, products, customer, settings, device = {}, previousUUID = '', type = 'S', referenceUUID = '' }) {
  const lines = saleLines({ order, items, products, settings });
  const receipt = {
    header: {
      dateTimeIssued: etaDate(order.completed_at),
      receiptNumber: `${type === 'R' ? 'R' : ''}${order.invoice_no ?? order.id}`,
      uuid: '',
      previousUUID: previousUUID || '',
      referenceOldUUID: type === 'R' ? referenceUUID : '',
      currency: 'EGP',
      exchangeRate: 0,
      sOrderNameCode: '',
      orderdeliveryMode: order.order_type === 'delivery' ? 'FC' : '',
      grossWeight: 0,
      netWeight: 0,
    },
    documentType: { receiptType: type === 'R' ? 'r' : 's', typeVersion: '1.2' },
    seller: {
      rin: String(settings.eta_rin || ''),
      companyTradeName: settings.eta_name || settings.business_name || '',
      branchCode: String(settings.eta_branch || '0'),
      branchAddress: { country: settings.eta_country || 'EG', governate: settings.eta_governate || '', regionCity: settings.eta_city || '', street: settings.eta_street || '', buildingNumber: String(settings.eta_building || '') },
      deviceSerialNumber: String(device.serial || ''),
      syndicateLicenseNumber: '',
      activityCode: String(settings.eta_activity || ''),
    },
    buyer: {
      type: customer?.tax_number ? 'B' : 'P',
      id: customer?.tax_number || customer?.eta?.id || '',
      name: customer?.name || order.customer_name || '',
      mobileNumber: customer?.phone || order.customer_phone || '',
      paymentNumber: '',
    },
    itemData: lines.map((l) => ({
      internalCode: l.internalCode, description: l.description, itemType: l.itemType, itemCode: l.itemCode, unitType: l.unitType,
      quantity: l.qty, unitPrice: l.unitValue, netSale: l.netTotal, totalSale: l.salesTotal, total: l.total,
      commercialDiscountData: l.discount > 0 ? [{ amount: l.discount, description: 'خصم' }] : [],
      itemDiscountData: [],
      valueDifference: 0,
      taxableItems: [taxItem(l, settings)],
    })),
  };
  const totalSales = r5(lines.reduce((s, l) => s + l.salesTotal, 0));
  const totalDiscount = r5(lines.reduce((s, l) => s + l.discount, 0));
  const taxTotal = r5(lines.reduce((s, l) => s + l.tax, 0));
  Object.assign(receipt, {
    totalSales,
    totalCommercialDiscount: totalDiscount,
    totalItemsDiscount: 0,
    extraReceiptDiscountData: [],
    netAmount: r5(totalSales - totalDiscount),
    feesAmount: 0,
    totalAmount: r5(totalSales - totalDiscount + taxTotal),
    taxTotals: [{ taxType: 'T1', amount: taxTotal }],
    paymentMethod: 'C',
    adjustment: 0,
  });
  receipt.header.uuid = receiptUuid(receipt);
  return receipt;
}

/** What is missing before anything can be sent (setting keys). */
function missingSettings(s, kind) {
  const need = ['eta_rin', 'eta_activity', 'eta_governate', 'eta_city', 'eta_street', 'eta_building'];
  if (kind === 'invoice') need.push('eta_client_id', 'eta_client_secret_set');
  if (kind === 'receipt') need.push('eta_pos_serial', 'eta_pos_client_id', 'eta_pos_client_secret_set');
  return need.filter((k) => !s[k]);
}

/** Link to the document on the ETA portal (printed as a QR code on e-receipts). */
function portalUrl(env, kind, uuid, extra = '') {
  const base = (ENDPOINTS[env] || ENDPOINTS.preprod).portal;
  return kind === 'receipt' ? `${base}/receipts/search/${uuid}/share/${extra}` : `${base}/documents/${uuid}/share/${extra}`;
}

module.exports = { ENDPOINTS, serialize, sha256, receiptUuid, saleLines, buildInvoice, buildReceipt, missingSettings, portalUrl, etaDate };
