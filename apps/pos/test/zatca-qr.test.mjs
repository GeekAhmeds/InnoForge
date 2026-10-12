// Saudi e-invoice QR (TLV) and the QR code generator it is drawn with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zatcaTlv, zatcaTlvDecode, zatcaQrForOrder } from '../src/lib/zatca-qr.js';
import { qrEncode, qrSvg } from '../src/lib/qr.js';

test('TLV matches the ZATCA example', () => {
  // The example from ZATCA's QR guideline (Bobs Records, 2022-04-25T15:30:00Z, 1000.00, 150.00).
  const b64 = zatcaTlv(['Bobs Records', '310122393500003', '2022-04-25T15:30:00Z', '1000.00', '150.00']);
  assert.equal(b64, 'AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==');
  assert.deepEqual(zatcaTlvDecode(b64), { 1: 'Bobs Records', 2: '310122393500003', 3: '2022-04-25T15:30:00Z', 4: '1000.00', 5: '150.00' });
});

test('QR for an order: Arabic seller name, only in Saudi Arabia with a VAT number', () => {
  const order = { completed_at: '2026-10-12 14:05:09', total: 115000, tax: 15000 };
  const s = { country: 'SA', tax_number: '300000000000003', business_name: 'سوبر ماركت النور', decimals: 2 };
  assert.deepEqual(zatcaTlvDecode(zatcaQrForOrder(order, s)), { 1: 'سوبر ماركت النور', 2: '300000000000003', 3: '2026-10-12T14:05:09', 4: '1150.00', 5: '150.00' });
  assert.equal(zatcaQrForOrder(order, { ...s, country: 'EG' }), '');
  assert.equal(zatcaQrForOrder(order, { ...s, tax_number: '' }), '');
  assert.equal(zatcaQrForOrder({ ...order, zatca_qr: 'SIGNED' }, s), 'SIGNED');
});

test('QR code generator: sizes and finder patterns', () => {
  const q = qrEncode('AQxCb2JzIFJlY29yZHM=', 'M');
  assert.equal(q.size, q.version * 4 + 17);
  // Finder pattern corners: dark border, light ring, dark centre.
  for (const [x, y] of [[0, 0], [q.size - 7, 0], [0, q.size - 7]]) {
    assert.equal(q.get(x, y), true); assert.equal(q.get(x + 1, y + 1), false); assert.equal(q.get(x + 3, y + 3), true);
  }
  assert.equal(qrEncode('x'.repeat(700), 'M').version, 21); // byte capacity at M: v20 = 666, v21 = 711
  assert.match(qrSvg('hello'), /^<svg[^>]+viewBox="0 0 29 29"/);
  assert.throws(() => qrEncode('x'.repeat(3000), 'H'), /too long/);
});
