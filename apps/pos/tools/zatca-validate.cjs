#!/usr/bin/env node
'use strict';
// Checks our Saudi e-invoices with ZATCA's own validator (the "fatoora" Java SDK) before a
// release: real sales through the services (simplified + B2B invoice, both credit notes,
// discount, fractional quantity), stamped with the SDK's test certificate and key, chained.
//
//   node tools/zatca-validate.cjs <path to zatca-einvoicing-sdk-Java-238-R3.4.8>
//
// Needs Java 11 (newer Java dropped secp256k1): set JAVA_HOME_11 or have `java` be v11.
// The SDK is downloaded from ZATCA's developer portal (or the zatca-sdk project's resources/).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { openDatabase } = require('../electron/db.cjs');
const { createServices } = require('../electron/services/index.cjs');
const { entitlements } = require('../electron/editions.cjs');

const SDK = process.argv[2];
if (!SDK || !fs.existsSync(path.join(SDK, 'Apps'))) { console.error('usage: node tools/zatca-validate.cjs <zatca-einvoicing-sdk folder>'); process.exit(2); }
const version = JSON.parse(fs.readFileSync(path.join(SDK, 'Apps/global.json'), 'utf8')).version;
const jar = path.join(SDK, `Apps/zatca-einvoicing-sdk-${version}.jar`);
const java = process.env.JAVA_HOME_11 ? path.join(process.env.JAVA_HOME_11, 'bin/java') : 'java';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'zatca-'));
const pihFile = path.join(work, 'pih.txt');
const config = path.join(work, 'config.json');
fs.writeFileSync(config, JSON.stringify({
  xsdPath: path.join(SDK, 'Data/Schemas/xsds/UBL2.1/xsd/maindoc/UBL-Invoice-2.1.xsd'),
  enSchematron: path.join(SDK, 'Data/Rules/Schematrons/CEN-EN16931-UBL.xsl'),
  zatcaSchematron: path.join(SDK, 'Data/Rules/Schematrons/20210819_ZATCA_E-invoice_Validation_Rules.xsl'),
  certPath: path.join(SDK, 'Data/Certificates/cert.pem'),
  privateKeyPath: path.join(SDK, 'Data/Certificates/ec-secp256k1-priv-key.pem'),
  pihPath: pihFile, inputPath: path.join(SDK, 'Data/Input'), usagePathFile: path.join(SDK, 'Configuration/usage.txt'),
}));
const run = (args) => execFileSync(java, ['-Dfile.encoding=UTF-8', '-Djdk.sunec.disableNative=false', '-jar', jar, '--globalVersion', version, ...args],
  { env: { ...process.env, SDK_CONFIG: config, LANG: 'C.UTF-8' }, stdio: 'pipe', maxBuffer: 64 << 20 }).toString();

// A Saudi shop with the SDK's test certificate.
const keyText = fs.readFileSync(path.join(SDK, 'Data/Certificates/ec-secp256k1-priv-key.pem'), 'utf8').trim();
const jwk = crypto.createPrivateKey(keyText.includes('BEGIN') ? keyText : `-----BEGIN EC PRIVATE KEY-----\n${keyText}\n-----END EC PRIVATE KEY-----`).export({ format: 'jwk' });
const db = openDatabase(':memory:');
const s = createServices(db, { entitlements: () => entitlements({ edition: 'full', country: 'SA' }) });
s.auth.setup({ business: { business_name: 'مطعم الاختبار', business_type: 'retail', country: 'SA', currency: 'SAR', tax_rate: 15, prices_include_tax: true, tax_number: '399999999900003' }, admin: { name: 'A', username: 'admin', pin: '1234' } });
s.auth.login({ username: 'admin', pin: '1234' });
s.settings.save({ zatca_name: 'شركة الاختبار للتجارة', zatca_crn: '1010010000', zatca_street: 'طريق الملك فهد', zatca_building: '2322', zatca_plot: '1234', zatca_district: 'العليا', zatca_city: 'الرياض', zatca_postal: '12345', zatca_env: 'simulation' });
s.zatcaQueue.saveCredentials({ zatca_key: Buffer.from(jwk.d, 'base64url').toString('hex'), zatca_cert: fs.readFileSync(path.join(SDK, 'Data/Certificates/cert.pem'), 'utf8'), zatca_secret: '-', zatca_onboarded_env: 'simulation' });
s.settings.save({ zatca_enabled: true });
s.shifts.open({});
const a = s.products.save({ name: 'وجبة دجاج 8 قطع', price: 3300, cost: 1000, stock: 100 });
const b = s.products.save({ name: 'عصير & ماء <1L>', price: 350, cost: 100, stock: 100 });
const cust = s.customers.save({ name: 'شركة الأمل للمقاولات', tax_number: '399999999800003', zatca: { street: 'شارع العليا', building: '1111', district: 'الملز', city: 'الرياض', postal: '12345' } });
const o1 = s.orders.checkout({ items: [{ product_id: a, qty: 3 }, { product_id: b, qty: 7 }], discount: 450, payments: [{ method: 'cash', amount: 20000 }] });
const o2 = s.orders.checkout({ customer_id: cust, items: [{ product_id: a, qty: 2 }, { product_id: b, qty: 1.5 }], payments: [{ method: 'cash', amount: 10000 }] });
s.orders.refund({ orderId: o1.id, items: [{ order_item_id: o1.items[0].id, qty: 1 }], reason: 'وجبة باردة' });
s.orders.refund({ orderId: o2.id, items: [{ order_item_id: o2.items[1].id, qty: 1.5 }], reason: 'خطأ' });

let pih = fs.readFileSync(path.join(SDK, 'Data/PIH/pih.txt'), 'utf8').trim();
let failed = 0;
for (const d of db.prepare('SELECT * FROM zatca_documents ORDER BY icv').all()) {
  const file = path.join(work, `doc${d.icv}.xml`);
  fs.writeFileSync(file, d.xml);
  fs.writeFileSync(pihFile, pih); // the validator checks the PIH against this file
  const out = run(['-validate', '-invoice', file]);
  const ok = out.includes('GLOBAL VALIDATION RESULT = PASSED');
  const problems = out.split('\n').filter((l) => /CODE :/.test(l)).map((l) => l.replace(/^.*- /, '   '));
  console.log(`${ok ? '✓' : '✗'} ${d.kind} ${d.standard ? 'B2B' : 'B2C'} ${d.doc_no}`);
  if (problems.length) console.log(problems.join('\n'));
  if (!ok) failed++;
  const ours = d.hash;
  const theirs = (/INVOICE HASH = (\S+)/.exec(run(['-generateHash', '-invoice', file])) || [])[1];
  if (ours !== theirs) { console.log(`   hash differs: ours ${ours}, ZATCA ${theirs}`); failed++; }
  pih = ours;
}
console.log(failed ? `\n${failed} problem(s)` : '\nAll documents pass ZATCA\'s validator.');
process.exit(failed ? 1 : 0);
