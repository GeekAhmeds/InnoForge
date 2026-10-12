'use strict';
// UAE e-invoicing (B2B / B2G, from July 2027 for most businesses): the Peppol PINT AE UBL
// invoice and credit note. The UAE uses a five-corner model: the seller's Accredited Service
// Provider (ASP) carries the document to the buyer's ASP and reports it to the FTA, so the POS
// only produces the XML and hands it to the ASP the business chose (or exports it).
// Consumer sales (B2C) are outside the mandate for now.
//
// Built from the published PINT AE specification (billing 1.0.x). The final validation rules
// belong to the ASP: run the first invoices of every new customer through its test system.
const crypto = require('node:crypto');
const { amounts } = require('./zatca.cjs');

const CUSTOMIZATION = 'urn:peppol:pint:billing-1@ae-1';
const PROFILE = 'urn:peppol:bis:billing';
const EMIRATES = ['AUH', 'DXB', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ'];
const PAYMENT_CODES = { cash: '10', card: '48', bank: '30', wallet: '30', cheque: '20', other: '1', credit: '30' };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function el(name, attrs, ...kids) {
  if (typeof attrs === 'string' || typeof attrs === 'number' || Array.isArray(attrs)) { kids.unshift(attrs); attrs = null; }
  const a = Object.entries(attrs || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return `<${name}${a}>${kids.flat().filter((k) => k != null && k !== false && k !== '').join('')}</${name}>`;
}
const text = (name, value, attrs) => (value == null || value === '' ? null : el(name, attrs || null, esc(value)));
const amt = (fils) => (fils < 0 ? '-' : '') + `${Math.floor(Math.abs(fils) / 100)}.${String(Math.abs(fils) % 100).padStart(2, '0')}`;
const dec = (x, max = 6) => Number(x).toFixed(max).replace(/\.?0+$/, '') || '0';

/** TRN (15 digits) → TIN (first 10), the Peppol participant ID under scheme 0235. */
const tinOf = (trn) => String(trn || '').replace(/\D/g, '').slice(0, 10);
const validTrn = (trn) => /^\d{15}$/.test(String(trn || '').trim());

function missingSettings(s) {
  const need = { tax_number: /^\d{15}$/, uae_name: /\S/, uae_street: /\S/, uae_city: /\S/, uae_emirate: new RegExp(`^(${EMIRATES.join('|')})$`) };
  return Object.entries(need).filter(([k, re]) => !re.test(String(s[k] ?? '').trim())).map(([k]) => k);
}

/** A buyer the mandate applies to: VAT-registered (TRN) with an address. */
function b2bBuyer(customer) {
  const u = customer?.uae || {};
  if (!validTrn(customer?.tax_number) || !u.street || !u.city || !EMIRATES.includes(u.emirate)) return null;
  return { name: customer.name, trn: String(customer.tax_number).trim(), address: u, tl: u.tl, authority: u.authority, email: customer.email || u.email };
}

function party(p, s) {
  return el('cac:Party',
    text('cbc:EndpointID', tinOf(p.trn), { schemeID: '0235' }),
    el('cac:PartyName', text('cbc:Name', p.tradeName || p.name)),
    el('cac:PostalAddress', text('cbc:StreetName', p.address.street), text('cbc:CityName', p.address.city),
      text('cbc:CountrySubentity', p.address.emirate), el('cac:Country', text('cbc:IdentificationCode', 'AE'))),
    el('cac:PartyTaxScheme', text('cbc:CompanyID', p.trn), el('cac:TaxScheme', text('cbc:ID', 'VAT'))),
    el('cac:PartyLegalEntity', text('cbc:RegistrationName', p.name),
      p.tl ? text('cbc:CompanyID', p.tl, { schemeAgencyID: 'TL', schemeAgencyName: p.authority || s?.uae_tl_authority }) : null),
    p.email || p.phone ? el('cac:Contact', text('cbc:Telephone', p.phone), text('cbc:ElectronicMail', p.email)) : null);
}

/**
 * PINT AE XML for a sale (invoice 380) or a return (credit note 381).
 * doc: { kind 'invoice' | 'credit', id, uuid, issued ('YYYY-MM-DD HH:MM:SS'), original { id, date }, reason, payment }
 */
function buildXml({ doc, order, items, customer, settings }) {
  const buyer = b2bBuyer(customer);
  if (!buyer) throw Object.assign(new Error('buyer'), { code: 'UAE_BUYER' });
  const scale = 10 ** (settings.decimals ?? 2);
  const f = (minor) => Math.round((minor * 100) / scale); // → fils
  const lines = items.filter((it) => Number(it.qty) > 0).map((it) => ({ name: it.name + (it.unit_name ? ` (${it.unit_name})` : ''), qty: Number(it.qty), amount: f(it.line_total) }));
  if (order.service > 0) lines.push({ name: 'Service charge', qty: 1, amount: f(order.service) });
  if (order.delivery_fee > 0) lines.push({ name: 'Delivery', qty: 1, amount: f(order.delivery_fee) });
  const rate = Number(order.tax) > 0 ? Number(settings.tax_rate) || 5 : 0;
  if (!rate) throw Object.assign(new Error('zero-rated'), { code: 'UAE_ZERO_VAT' });
  const total = f(order.total);
  const { X, T, rounding, nets } = amounts({ total, rate, lines });
  const [date, time] = String(doc.issued || '').split(/[ T]/);
  const credit = doc.kind === 'credit';
  const root = credit ? 'CreditNote' : 'Invoice';
  const cur = 'AED';
  const money = (name, v) => text(name, amt(v), { currencyID: cur });
  const seller = {
    name: settings.uae_name || settings.business_name, tradeName: settings.business_name, trn: String(settings.tax_number).trim(),
    address: { street: settings.uae_street, city: settings.uae_city, emirate: settings.uae_emirate }, tl: settings.uae_tl, authority: settings.uae_tl_authority,
    phone: settings.phone,
  };
  const sum = nets.reduce((s, l) => s + l.net, 0);
  const body = [
    text('cbc:CustomizationID', CUSTOMIZATION),
    text('cbc:ProfileID', PROFILE),
    text('cbc:ProfileExecutionID', '00000000'), // transaction type flags: a standard supply
    text('cbc:ID', doc.id),
    text('cbc:UUID', doc.uuid),
    text('cbc:IssueDate', date),
    text('cbc:IssueTime', time),
    text(credit ? 'cbc:CreditNoteTypeCode' : 'cbc:InvoiceTypeCode', credit ? '381' : '380'),
    credit ? text('cbc:Note', doc.reason || 'Return') : null,
    text('cbc:DocumentCurrencyCode', cur),
    text('cbc:TaxCurrencyCode', cur),
    text('cbc:BuyerReference', customer?.uae?.reference || buyer.name),
    credit ? el('cac:BillingReference', el('cac:InvoiceDocumentReference', text('cbc:ID', doc.original?.id), text('cbc:IssueDate', doc.original?.date))) : null,
    el('cac:AccountingSupplierParty', party(seller, settings)),
    el('cac:AccountingCustomerParty', party(buyer, settings)),
    el('cac:Delivery', text('cbc:ActualDeliveryDate', date)),
    el('cac:PaymentMeans', text('cbc:PaymentMeansCode', PAYMENT_CODES[doc.payment] || '10')),
    el('cac:TaxTotal', money('cbc:TaxAmount', T), el('cac:TaxSubtotal', money('cbc:TaxableAmount', X), money('cbc:TaxAmount', T),
      el('cac:TaxCategory', text('cbc:ID', 'S'), text('cbc:Percent', amt(rate * 100)), el('cac:TaxScheme', text('cbc:ID', 'VAT'))))),
    el('cac:LegalMonetaryTotal', money('cbc:LineExtensionAmount', sum), money('cbc:TaxExclusiveAmount', X), money('cbc:TaxInclusiveAmount', X + T),
      rounding ? money('cbc:PayableRoundingAmount', rounding) : null, money('cbc:PayableAmount', total)),
    ...lines.map((l, i) => {
      const { net, vat } = nets[i];
      let price = '';
      for (let d = 2; d <= 10; d++) { price = dec(net / 100 / l.qty, d); if (Math.round(Number(price) * l.qty * 100) === net) break; }
      return el(credit ? 'cac:CreditNoteLine' : 'cac:InvoiceLine',
        text('cbc:ID', i + 1),
        text(credit ? 'cbc:CreditedQuantity' : 'cbc:InvoicedQuantity', dec(l.qty), { unitCode: 'C62' }),
        money('cbc:LineExtensionAmount', net),
        el('cac:Item', text('cbc:Description', l.name), text('cbc:Name', l.name),
          el('cac:ClassifiedTaxCategory', text('cbc:ID', 'S'), text('cbc:Percent', amt(rate * 100)), el('cac:TaxScheme', text('cbc:ID', 'VAT')))),
        el('cac:Price', text('cbc:PriceAmount', price, { currencyID: cur }), text('cbc:BaseQuantity', '1', { unitCode: 'C62' }),
          el('cac:AllowanceCharge', text('cbc:ChargeIndicator', 'false'), money('cbc:Amount', 0), text('cbc:BaseAmount', price, { currencyID: cur }))),
        el('cac:ItemPriceExtension', money('cbc:Amount', net + vat), el('cac:TaxTotal', money('cbc:TaxAmount', vat))));
    }),
  ];
  const ns = { xmlns: `urn:oasis:names:specification:ubl:schema:xsd:${root}-2`, 'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2', 'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2' };
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${el(root, ns, ...body)}`, totals: { taxable: X, vat: T, total, rounding } };
}

const uuid = () => crypto.randomUUID();

module.exports = { CUSTOMIZATION, PROFILE, EMIRATES, buildXml, missingSettings, b2bBuyer, tinOf, validTrn, uuid };
