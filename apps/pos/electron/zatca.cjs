'use strict';
// Saudi e-invoicing (ZATCA / FATOORA, phase 2 "integration"): the UBL 2.1 XML of a sale or a
// return, its hash and the invoice chain (ICV counter + previous invoice hash), the
// cryptographic stamp (ECDSA secp256k1 + XAdES), the 9-field QR, the device key and the
// certificate request (CSR). Pure functions — the network part is zatca-submitter.cjs.
//
// Electron's crypto (BoringSSL) has no secp256k1, so the curve math is done here with BigInt
// (RFC 6979 deterministic signatures); the tests check it against OpenSSL.
//
// Hashing follows ZATCA's SDK: the document without ext:UBLExtensions, cac:Signature and the
// QR reference, in canonical XML. The XML is written already canonical (attributes sorted,
// no self-closing tags, no whitespace between elements), so the hash is a plain SHA-256 of
// that text. The signed-properties block keeps the SDK's exact layout: ZATCA hashes it as is.
//
// Built from ZATCA's published specifications and checked against open-source
// implementations. Run every new taxpayer through the developer/simulation portal first.
const crypto = require('node:crypto');

const ENDPOINTS = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};
const CSR_TEMPLATE = { sandbox: 'TSTZATCA-Code-Signing', simulation: 'PREZATCA-Code-Signing', production: 'ZATCA-Code-Signing' };
// The first invoice of a device points at this "previous hash" (base64 of the hex SHA-256 of "0").
const INITIAL_PIH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

// ---------------------------------------------------------------- DER
function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const der = (tag, ...content) => { const c = Buffer.concat(content); return Buffer.concat([Buffer.from([tag]), derLen(c.length), c]); };
const seq = (...c) => der(0x30, ...c);
const set = (...c) => der(0x31, ...c);
function oid(text) {
  const parts = text.split('.').map(Number);
  const out = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const stack = [p & 0x7f];
    for (let v = Math.floor(p / 128); v > 0; v = Math.floor(v / 128)) stack.unshift((v & 0x7f) | 0x80);
    out.push(...stack);
  }
  return der(0x06, Buffer.from(out));
}
const utf8 = (s) => der(0x0c, Buffer.from(String(s), 'utf8'));
const printable = (s) => der(0x13, Buffer.from(String(s), 'ascii'));
function derInt(big) {
  let hex = big.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let b = Buffer.from(hex, 'hex');
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return der(0x02, b);
}
const bitString = (b) => der(0x03, Buffer.from([0]), b);
const octet = (b) => der(0x04, b);
const ctx = (n, ...c) => der(0xa0 | n, ...c);

/** Reads one DER element: { tag, start (of content), end, total end }. */
function readDer(buf, pos = 0) {
  const tag = buf[pos];
  let len = buf[pos + 1];
  let off = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[off + i];
    off += n;
  }
  return { tag, start: off, end: off + len, pos };
}
function children(buf, node) {
  const out = [];
  for (let p = node.start; p < node.end;) { const c = readDer(buf, p); out.push(c); p = c.end; }
  return out;
}
function oidText(b) {
  const out = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (const x of b.subarray(1)) { v = v * 128 + (x & 0x7f); if (!(x & 0x80)) { out.push(v); v = 0; } }
  return out.join('.');
}

// ---------------------------------------------------------------- secp256k1
const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
function inv(a, m = P) {
  let [lo, hi, x0, x1] = [mod(a, m), m, 1n, 0n];
  while (lo > 1n) { const q = hi / lo; [lo, hi] = [hi - q * lo, lo]; [x0, x1] = [x1 - q * x0, x0]; }
  return mod(x0, m);
}
// Jacobian points [X, Y, Z]; Z = 0 is the point at infinity.
function jDouble([X, Y, Z]) {
  if (Z === 0n || Y === 0n) return [0n, 1n, 0n];
  const YY = mod(Y * Y); const S = mod(4n * X * YY); const M = mod(3n * X * X);
  const X3 = mod(M * M - 2n * S);
  return [X3, mod(M * (S - X3) - 8n * YY * YY), mod(2n * Y * Z)];
}
function jAdd(p, q) {
  if (p[2] === 0n) return q;
  if (q[2] === 0n) return p;
  const Z1Z1 = mod(p[2] * p[2]); const Z2Z2 = mod(q[2] * q[2]);
  const U1 = mod(p[0] * Z2Z2); const U2 = mod(q[0] * Z1Z1);
  const S1 = mod(p[1] * q[2] * Z2Z2); const S2 = mod(q[1] * p[2] * Z1Z1);
  if (U1 === U2) return S1 === S2 ? jDouble(p) : [0n, 1n, 0n];
  const H = mod(U2 - U1); const R = mod(S2 - S1);
  const HH = mod(H * H); const HHH = mod(H * HH); const V = mod(U1 * HH);
  const X3 = mod(R * R - HHH - 2n * V);
  return [X3, mod(R * (V - X3) - S1 * HHH), mod(H * p[2] * q[2])];
}
function mul(k, [x, y] = G) {
  let r = [0n, 1n, 0n];
  let a = [x, y, 1n];
  for (let e = k; e > 0n; e >>= 1n) { if (e & 1n) r = jAdd(r, a); a = jDouble(a); }
  if (r[2] === 0n) return null;
  const zi = inv(r[2]);
  return [mod(r[0] * zi * zi), mod(r[1] * zi * zi * zi)];
}
const big = (b) => BigInt(`0x${Buffer.from(b).toString('hex') || '0'}`);
const bytes32 = (n) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');

/** RFC 6979 deterministic nonce for SHA-256. */
function nonce(d, h1) {
  const x = bytes32(d);
  const h = bytes32(mod(big(h1), N));
  let V = Buffer.alloc(32, 1);
  let K = Buffer.alloc(32, 0);
  const hmac = (key, ...data) => crypto.createHmac('sha256', key).update(Buffer.concat(data)).digest();
  K = hmac(K, V, Buffer.from([0]), x, h); V = hmac(K, V);
  K = hmac(K, V, Buffer.from([1]), x, h); V = hmac(K, V);
  for (;;) {
    V = hmac(K, V);
    const k = big(V);
    if (k > 0n && k < N) return k;
    K = hmac(K, V, Buffer.from([0])); V = hmac(K, V);
  }
}

/** ECDSA-SHA256 over `data` (a Buffer), DER-encoded — same as OpenSSL's createSign('sha256'). */
function ecdsaSign(data, privHex) {
  const d = BigInt(`0x${privHex}`);
  const h1 = crypto.createHash('sha256').update(data).digest();
  const z = mod(big(h1), N);
  for (let k = nonce(d, h1); ; k = mod(k + 1n, N)) {
    const R = mul(k);
    const r = mod(R[0], N);
    if (r === 0n) continue;
    let s = mod(inv(k, N) * (z + r * d), N);
    if (s === 0n) continue;
    if (s > N / 2n) s = N - s; // low-S
    return seq(derInt(r), derInt(s));
  }
}

function ecdsaVerify(data, sigDer, pubPoint) {
  try {
    const root = readDer(sigDer);
    const [rn, sn] = children(sigDer, root);
    const r = big(sigDer.subarray(rn.start, rn.end));
    const s = big(sigDer.subarray(sn.start, sn.end));
    if (r <= 0n || r >= N || s <= 0n || s >= N) return false;
    const z = mod(big(crypto.createHash('sha256').update(data).digest()), N);
    const w = inv(s, N);
    const a = mul(mod(z * w, N));
    const b = mul(mod(r * w, N), pubPoint);
    const sum = jAdd([a[0], a[1], 1n], [b[0], b[1], 1n]);
    if (sum[2] === 0n) return false;
    const zi = inv(sum[2]);
    return mod(mod(sum[0] * zi * zi), N) === r;
  } catch {
    return false;
  }
}

/** A new device key: { privateKey (hex), publicKey (SPKI DER, base64) }. */
function generateKey() {
  for (;;) {
    const d = big(crypto.randomBytes(32));
    if (d > 0n && d < N) return { privateKey: bytes32(d).toString('hex'), publicKey: spki(mul(d)).toString('base64') };
  }
}
const pointOf = (privHex) => mul(BigInt(`0x${privHex}`));
const spki = ([x, y]) => seq(seq(oid('1.2.840.10045.2.1'), oid('1.3.132.0.10')), bitString(Buffer.concat([Buffer.from([4]), bytes32(x), bytes32(y)])));
function pointFromSpki(spkiDer) {
  const root = readDer(spkiDer);
  const [, bits] = children(spkiDer, root);
  const raw = spkiDer.subarray(bits.start + 1, bits.end); // skip the unused-bits byte
  return [big(raw.subarray(1, 33)), big(raw.subarray(33, 65))];
}
/** The device key as a standard PEM (SEC1), for backups and other tools. */
function privateKeyPem(privHex) {
  const d = Buffer.from(privHex, 'hex');
  const body = seq(derInt(1n), octet(d), ctx(0, oid('1.3.132.0.10')), ctx(1, bitString(Buffer.concat([Buffer.from([4]), ...pointOf(privHex).map(bytes32)]))));
  return `-----BEGIN EC PRIVATE KEY-----\n${body.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END EC PRIVATE KEY-----\n`;
}

// ---------------------------------------------------------------- CSR
/**
 * Certificate request for this device (EGS unit).
 * info: { vat, commonName, orgName, orgUnit, serial ("1-…|2-…|3-…"), invoiceTypes ("1100"),
 *         address (registeredAddress), industry (businessCategory) }
 * Returns the base64 of the PEM text — what /compliance expects.
 */
function buildCsr(info, privHex, env = 'production') {
  const rdn = (o, v) => set(seq(oid(o), v));
  const subject = seq(rdn('2.5.4.6', printable('SA')), rdn('2.5.4.11', utf8(info.orgUnit)), rdn('2.5.4.10', utf8(info.orgName)), rdn('2.5.4.3', utf8(info.commonName)));
  const dirName = seq(rdn('2.5.4.4', utf8(info.serial)), rdn('0.9.2342.19200300.100.1.1', utf8(info.vat)), rdn('2.5.4.12', utf8(info.invoiceTypes || '1100')),
    rdn('2.5.4.26', utf8(info.address)), rdn('2.5.4.15', utf8(info.industry)));
  const extensions = seq(
    seq(oid('1.3.6.1.4.1.311.20.2'), octet(utf8(CSR_TEMPLATE[env] || CSR_TEMPLATE.production))),
    seq(oid('2.5.29.17'), octet(seq(der(0xa4, dirName)))),
  );
  const cri = seq(derInt(0n), subject, spki(pointOf(privHex)), ctx(0, seq(oid('1.2.840.113549.1.9.14'), set(extensions))));
  const csr = seq(cri, seq(oid('1.2.840.10045.4.3.2')), bitString(ecdsaSign(cri, privHex)));
  const pem = `-----BEGIN CERTIFICATE REQUEST-----\n${csr.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE REQUEST-----\n`;
  return Buffer.from(pem).toString('base64');
}

// ---------------------------------------------------------------- certificate
const DN = { '2.5.4.3': 'CN', '2.5.4.4': 'SN', '2.5.4.5': 'SERIALNUMBER', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.12': 'T', '0.9.2342.19200300.100.1.1': 'UID', '0.9.2342.19200300.100.1.25': 'DC', '1.2.840.113549.1.9.1': 'E' };

/** The certificate DER from what ZATCA returns (binarySecurityToken), a PEM or plain base64. */
function certDer(input) {
  const text = String(input || '').trim();
  if (text.includes('BEGIN CERTIFICATE')) return Buffer.from(text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
  const once = Buffer.from(text, 'base64');
  if (once[0] === 0x30) return once;
  const inner = once.toString('utf8').trim();
  if (inner.includes('BEGIN CERTIFICATE')) return certDer(inner);
  return Buffer.from(inner.replace(/\s+/g, ''), 'base64');
}

/** What the stamp needs from the certificate. */
function parseCert(input) {
  const cert = certDer(input);
  const root = readDer(cert);
  if (root.tag !== 0x30 || root.end !== cert.length) throw new Error('certificate is not valid DER');
  const [tbs, , sig] = children(cert, root);
  const t = children(cert, tbs);
  const o = t[0].tag === 0xa0 ? 1 : 0;
  const name = (node) => children(cert, node).map((rdnSet) => {
    const [attr] = children(cert, rdnSet);
    const [on, vn] = children(cert, attr);
    const key = oidText(cert.subarray(on.start, on.end));
    return `${DN[key] || key}=${cert.subarray(vn.start, vn.end).toString('utf8')}`;
  }).reverse().join(', ');
  const time = (node) => {
    const s = cert.subarray(node.start, node.end).toString('ascii');
    const full = node.tag === 0x17 ? (Number(s.slice(0, 2)) < 50 ? '20' : '19') + s : s;
    return new Date(`${full.slice(0, 4)}-${full.slice(4, 6)}-${full.slice(6, 8)}T${full.slice(8, 10)}:${full.slice(10, 12)}:${full.slice(12, 14)}Z`);
  };
  const [nb, na] = children(cert, t[o + 3]);
  const base64 = cert.toString('base64');
  const pub = cert.subarray(t[o + 5].pos, t[o + 5].end);
  return {
    base64,
    issuer: name(t[o + 2]),
    subject: name(t[o + 4]),
    serial: big(cert.subarray(t[o].start, t[o].end)).toString(10),
    validFrom: time(nb),
    validTo: time(na),
    publicKey: Buffer.from(pub),
    signature: Buffer.from(cert.subarray(sig.start + 1, sig.end)),
    // ZATCA's certificate digest: base64 of the HEX sha-256 of the base64 text.
    digest: Buffer.from(crypto.createHash('sha256').update(base64, 'utf8').digest('hex')).toString('base64'),
  };
}

// ---------------------------------------------------------------- QR
function tlv(values) {
  const parts = values.map((v, i) => {
    const b = Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8');
    const len = b.length < 0x80 ? Buffer.from([b.length]) : b.length < 0x100 ? Buffer.from([0x81, b.length]) : Buffer.from([0x82, b.length >> 8, b.length & 0xff]);
    return Buffer.concat([Buffer.from([i + 1]), len, b]);
  });
  return Buffer.concat(parts).toString('base64');
}

// ---------------------------------------------------------------- XML
const escText = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const escAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');
/** Canonical element: attributes sorted, never self-closing; children are strings (already XML). */
function el(name, attrs, ...kids) {
  if (typeof attrs === 'string' || typeof attrs === 'number' || Array.isArray(attrs)) { kids.unshift(attrs); attrs = null; }
  const a = Object.entries(attrs || {}).filter(([, v]) => v != null).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  return `<${name}${a}>${kids.flat().filter((k) => k != null && k !== false).join('')}</${name}>`;
}
const text = (name, value, attrs) => el(name, attrs || null, escText(value));

const NS = {
  xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  'xmlns:ext': 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
};

/** Halalas (integer) → "12.34". */
const amt = (h) => (h < 0 ? '-' : '') + `${Math.floor(Math.abs(h) / 100)}.${String(Math.abs(h) % 100).padStart(2, '0')}`;
const roundHalfUp = (x) => Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
/** A decimal with up to `max` fraction digits, no trailing zeros. */
function dec(x, max = 6) {
  const s = Number(x).toFixed(max).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * The amounts ZATCA checks, in halalas: taxable amount X and VAT T with T = round(X × rate) and
 * X + T = the total the customer paid (a 1-halala payable rounding when no X fits), then the
 * lines' net amounts adding up to X (cart discount spread over them; service and delivery as lines).
 */
function amounts({ total, rate, lines }) {
  const vatOf = (x) => roundHalfUp((x * rate) / 100);
  const guess = Math.round((total * 100) / (100 + rate));
  let X = null;
  for (const d of [0, -1, 1, -2, 2, -3, 3]) if ((guess + d) + vatOf(guess + d) === total) { X = guess + d; break; }
  let rounding = 0;
  if (X === null) { X = guess; rounding = total - (X + vatOf(X)); }
  const T = vatOf(X);
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  let left = sum - X;
  const nets = lines.map((l, i) => {
    if (i === lines.length - 1 || sum === 0) return l.amount - left;
    const share = Math.round(((sum - X) * l.amount) / sum);
    left -= share;
    return l.amount - share;
  });
  return { X, T, rounding, nets: nets.map((net) => ({ net, vat: vatOf(net) })) };
}

/** The lines of a sale, in halalas, before the cart discount is spread. */
function saleLines({ order, items, settings }) {
  const scale = 10 ** (settings.decimals ?? 2);
  const h = (minor) => Math.round((minor * 100) / scale);
  const lines = items.filter((it) => Number(it.qty) > 0).map((it) => ({ name: it.name + (it.unit_name ? ` (${it.unit_name})` : ''), qty: Number(it.qty), amount: h(it.line_total) }));
  if (order.service > 0) lines.push({ name: 'رسوم الخدمة — Service', qty: 1, amount: h(order.service) });
  if (order.delivery_fee > 0) lines.push({ name: 'التوصيل — Delivery', qty: 1, amount: h(order.delivery_fee) });
  return { lines, total: h(order.total), scale };
}

/** "2026-10-12 14:05:09" → { date: '2026-10-12', time: '14:05:09' }. */
function issueParts(localText) {
  const m = String(localText || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (m) return { date: m[1], time: m[2] };
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` };
}

const PAYMENT_CODES = { cash: '10', card: '48', bank: '42', wallet: '30', cheque: '20', other: '1', credit: '30' };

function address(a, country = 'SA') {
  return el('cac:PostalAddress',
    text('cbc:StreetName', a.street),
    a.building ? text('cbc:BuildingNumber', a.building) : null,
    a.plot ? text('cbc:PlotIdentification', a.plot) : null,
    a.district ? text('cbc:CitySubdivisionName', a.district) : null,
    text('cbc:CityName', a.city),
    a.postal ? text('cbc:PostalZone', a.postal) : null,
    el('cac:Country', text('cbc:IdentificationCode', a.country || country)));
}

/** What a seller must have filled in before invoices can be stamped. */
function missingSettings(s) {
  const need = { tax_number: /^3\d{13}3$/, zatca_name: /\S/, zatca_crn: /\S/, zatca_street: /\S/, zatca_building: /^\d{4}$/, zatca_district: /\S/, zatca_city: /\S/, zatca_postal: /^\d{5}$/ };
  return Object.entries(need).filter(([k, re]) => !re.test(String(s[k] ?? '').trim())).map(([k]) => k);
}

/** A buyer good enough for a standard (B2B, cleared) tax invoice. */
function b2bBuyer(customer) {
  const z = customer?.zatca || {};
  if (!customer?.tax_number || !/^3\d{13}3$/.test(String(customer.tax_number))) return null;
  if (!z.street || !z.city || !/^\d{5}$/.test(String(z.postal || '')) || !z.district || !/^\d{4}$/.test(String(z.building || ''))) return null;
  return { name: customer.name, vat: String(customer.tax_number), address: z };
}

/**
 * The unsigned UBL invoice.
 * doc: { kind 'invoice' | 'credit' | 'debit', standard, id, uuid, icv, pih, issued ('YYYY-MM-DD HH:MM:SS'),
 *        original (invoice no a credit note refers to), reason, payment }
 */
function buildXml({ doc, order, items, customer, settings }) {
  const { lines, total } = saleLines({ order, items, settings });
  if (!lines.length) throw Object.assign(new Error('no lines'), { code: 'ZATCA_EMPTY' });
  const rate = Number(order.tax) > 0 ? Number(settings.tax_rate) || 15 : 0;
  if (!rate) throw Object.assign(new Error('zero-rated sales are not supported'), { code: 'ZATCA_ZERO_VAT' });
  const { X, T, rounding, nets } = amounts({ total, rate, lines });
  const { date, time } = issueParts(doc.issued);
  const buyer = doc.standard ? b2bBuyer(customer) : null;
  const typeCode = { credit: '381', debit: '383' }[doc.kind] || '388';
  const note = doc.kind === 'credit' || doc.kind === 'debit';
  const cur = 'SAR';
  const money = (name, h) => text(name, amt(h), { currencyID: cur });
  const sum = nets.reduce((s, l) => s + l.net, 0);
  const seller = {
    street: settings.zatca_street, building: settings.zatca_building, plot: settings.zatca_plot, district: settings.zatca_district,
    city: settings.zatca_city, postal: settings.zatca_postal,
  };
  const body = [
    text('cbc:ProfileID', 'reporting:1.0'),
    text('cbc:ID', doc.id),
    text('cbc:UUID', doc.uuid),
    text('cbc:IssueDate', date),
    text('cbc:IssueTime', time),
    text('cbc:InvoiceTypeCode', typeCode, { name: doc.standard ? '0100000' : '0200000' }),
    text('cbc:DocumentCurrencyCode', cur),
    text('cbc:TaxCurrencyCode', cur),
    note ? el('cac:BillingReference', el('cac:InvoiceDocumentReference', text('cbc:ID', doc.original))) : null,
    el('cac:AdditionalDocumentReference', text('cbc:ID', 'ICV'), text('cbc:UUID', doc.icv)),
    el('cac:AdditionalDocumentReference', text('cbc:ID', 'PIH'), el('cac:Attachment', text('cbc:EmbeddedDocumentBinaryObject', doc.pih, { mimeCode: 'text/plain' }))),
    '<!--QR-->',
    '<!--SIGNATURE-->',
    el('cac:AccountingSupplierParty', el('cac:Party',
      el('cac:PartyIdentification', text('cbc:ID', settings.zatca_crn, { schemeID: settings.zatca_id_scheme || 'CRN' })),
      address(seller),
      el('cac:PartyTaxScheme', text('cbc:CompanyID', settings.tax_number), el('cac:TaxScheme', text('cbc:ID', 'VAT'))),
      el('cac:PartyLegalEntity', text('cbc:RegistrationName', settings.zatca_name || settings.business_name)))),
    buyer
      ? el('cac:AccountingCustomerParty', el('cac:Party', address(buyer.address),
        el('cac:PartyTaxScheme', text('cbc:CompanyID', buyer.vat), el('cac:TaxScheme', text('cbc:ID', 'VAT'))),
        el('cac:PartyLegalEntity', text('cbc:RegistrationName', buyer.name))))
      : el('cac:AccountingCustomerParty'),
    doc.standard ? el('cac:Delivery', text('cbc:ActualDeliveryDate', date)) : null,
    el('cac:PaymentMeans', text('cbc:PaymentMeansCode', PAYMENT_CODES[doc.payment] || '10'), note ? text('cbc:InstructionNote', doc.reason || 'Return') : null),
    el('cac:TaxTotal', money('cbc:TaxAmount', T)),
    el('cac:TaxTotal', money('cbc:TaxAmount', T), el('cac:TaxSubtotal', money('cbc:TaxableAmount', X), money('cbc:TaxAmount', T),
      el('cac:TaxCategory', text('cbc:ID', 'S', { schemeAgencyID: '6', schemeID: 'UN/ECE 5305' }), text('cbc:Percent', amt(rate * 100)),
        el('cac:TaxScheme', text('cbc:ID', 'VAT', { schemeAgencyID: '6', schemeID: 'UN/ECE 5153' }))))),
    el('cac:LegalMonetaryTotal', money('cbc:LineExtensionAmount', sum), money('cbc:TaxExclusiveAmount', X), money('cbc:TaxInclusiveAmount', X + T),
      money('cbc:AllowanceTotalAmount', 0), money('cbc:PrepaidAmount', 0), rounding ? money('cbc:PayableRoundingAmount', rounding) : null, money('cbc:PayableAmount', total)),
    ...lines.map((l, i) => {
      const { net, vat } = nets[i];
      // Unit price with enough decimals that quantity × price rounds to the line amount.
      let price = '';
      for (let digits = 2; digits <= 10; digits++) { price = dec(net / 100 / l.qty, digits); if (Math.round(Number(price) * l.qty * 100) === net) break; }
      return el('cac:InvoiceLine', text('cbc:ID', i + 1), text('cbc:InvoicedQuantity', dec(l.qty), { unitCode: 'PCE' }), money('cbc:LineExtensionAmount', net),
        el('cac:TaxTotal', money('cbc:TaxAmount', vat), money('cbc:RoundingAmount', net + vat)),
        el('cac:Item', text('cbc:Name', l.name), el('cac:ClassifiedTaxCategory', text('cbc:ID', 'S'), text('cbc:Percent', amt(rate * 100)), el('cac:TaxScheme', text('cbc:ID', 'VAT')))),
        el('cac:Price', text('cbc:PriceAmount', price, { currencyID: cur })));
    }),
  ];
  return { xml: el('Invoice', NS, '<!--EXT-->', ...body), totals: { taxable: X, vat: T, total, rounding }, date, time };
}

const SIGNATURE_REF = el('cac:Signature', text('cbc:ID', 'urn:oasis:names:specification:ubl:signature:Invoice'), text('cbc:SignatureMethod', 'urn:oasis:names:specification:ubl:dsig:enveloped:xades'));
const qrRef = (qr) => el('cac:AdditionalDocumentReference', text('cbc:ID', 'QR'), el('cac:Attachment', text('cbc:EmbeddedDocumentBinaryObject', qr, { mimeCode: 'text/plain' })));

/** The invoice hash: SHA-256 (base64) of the canonical document without extensions, signature and QR. */
function invoiceHash(xmlWithMarkers) {
  const canonical = xmlWithMarkers.replace('<!--EXT-->', '').replace('<!--QR-->', '').replace('<!--SIGNATURE-->', '');
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('base64');
}

// The signed properties exactly as ZATCA's SDK lays them out (ZATCA hashes this text).
function signedProperties(signingTime, cert, forHash) {
  const ds = forHash ? ' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"' : '';
  return `<xades:SignedProperties${forHash ? ' xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"' : ''} Id="xadesSignedProperties">
                                    <xades:SignedSignatureProperties>
                                        <xades:SigningTime>${signingTime}</xades:SigningTime>
                                        <xades:SigningCertificate>
                                            <xades:Cert>
                                                <xades:CertDigest>
                                                    <ds:DigestMethod${ds} Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                                    <ds:DigestValue${ds}>${cert.digest}</ds:DigestValue>
                                                </xades:CertDigest>
                                                <xades:IssuerSerial>
                                                    <ds:X509IssuerName${ds}>${escText(cert.issuer)}</ds:X509IssuerName>
                                                    <ds:X509SerialNumber${ds}>${cert.serial}</ds:X509SerialNumber>
                                                </xades:IssuerSerial>
                                            </xades:Cert>
                                        </xades:SigningCertificate>
                                    </xades:SignedSignatureProperties>
                                </xades:SignedProperties>`;
}

function extensions({ hash, signature, cert, signingTime }) {
  const propsDigest = Buffer.from(crypto.createHash('sha256').update(signedProperties(signingTime, cert, true), 'utf8').digest('hex')).toString('base64');
  return `<ext:UBLExtensions>
    <ext:UBLExtension>
        <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
        <ext:ExtensionContent>
            <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">
                <sac:SignatureInformation>
                    <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
                    <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
                    <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">
                        <ds:SignedInfo>
                            <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                            <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>
                            <ds:Reference Id="invoiceSignedData" URI="">
                                <ds:Transforms>
                                    <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                        <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>
                                    </ds:Transform>
                                    <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                        <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>
                                    </ds:Transform>
                                    <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                        <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>
                                    </ds:Transform>
                                    <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                                </ds:Transforms>
                                <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                <ds:DigestValue>${hash}</ds:DigestValue>
                            </ds:Reference>
                            <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">
                                <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                <ds:DigestValue>${propsDigest}</ds:DigestValue>
                            </ds:Reference>
                        </ds:SignedInfo>
                        <ds:SignatureValue>${signature}</ds:SignatureValue>
                        <ds:KeyInfo>
                            <ds:X509Data>
                                <ds:X509Certificate>${cert.base64}</ds:X509Certificate>
                            </ds:X509Data>
                        </ds:KeyInfo>
                        <ds:Object>
                            <xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">
                                ${signedProperties(signingTime, cert, false)}
                            </xades:QualifyingProperties>
                        </ds:Object>
                    </ds:Signature>
                </sac:SignatureInformation>
            </sig:UBLDocumentSignatures>
        </ext:ExtensionContent>
    </ext:UBLExtension>
</ext:UBLExtensions>`;
}

/**
 * Builds and stamps a document. keys: { privateKey (hex), certificate (binarySecurityToken / PEM) }.
 * Returns { xml (signed, with declaration), hash, qr, signature, totals }.
 */
function stamp(input, keys, now = new Date()) {
  const built = buildXml(input);
  const hash = invoiceHash(built.xml);
  const cert = parseCert(keys.certificate);
  const signature = ecdsaSign(Buffer.from(hash, 'base64'), keys.privateKey).toString('base64');
  const signingTime = now.toISOString().replace(/\.\d{3}Z$/, '');
  const s = input.settings;
  const qr = tlv([
    s.zatca_name || s.business_name, s.tax_number, `${built.date}T${built.time}`, amt(built.totals.total), amt(built.totals.vat), // total = amount due (BT-115)
    hash, signature, cert.publicKey, cert.signature,
  ]);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${built.xml
    .replace('<!--EXT-->', extensions({ hash, signature, cert, signingTime }))
    .replace('<!--QR-->', qrRef(qr))
    .replace('<!--SIGNATURE-->', SIGNATURE_REF)}`;
  return { xml, hash, qr, signature, totals: built.totals };
}

/** A fresh UUID v4 for a document. */
const uuid = () => crypto.randomUUID();

module.exports = {
  ENDPOINTS, CSR_TEMPLATE, INITIAL_PIH, generateKey, privateKeyPem, pointOf, pointFromSpki, buildCsr, parseCert, certDer,
  ecdsaSign, ecdsaVerify, tlv, buildXml, invoiceHash, stamp, amounts, missingSettings, b2bBuyer, uuid, amt,
};
