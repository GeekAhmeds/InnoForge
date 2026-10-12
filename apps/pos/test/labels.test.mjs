// Barcode sticker design: parts switch on/off, sizes, broken designs fall back to defaults.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { labelsHtml, labelLayout, labelSetting, labelSize, DEFAULT_LABEL } = await import(pathToFileURL(path.join(root, 'src/lib/labels.js')).href);

const settings = (layout) => ({ business_name: 'محل النيل', currency_symbol: 'ج.م', decimals: 2, label_layout: layout ? JSON.stringify(layout) : '' });
const label = { name: 'تيشيرت بولو — أحمر / L', label: 'تيشيرت بولو', attrs: 'أحمر / L', code: '6221000000011', price: 25000, copies: 2 };

test('default sticker: name, size/colour, bars, number and price', () => {
  const s = settings();
  const html = labelsHtml([label], { size: '38x25', layout: labelLayout(s), settings: s });
  for (const x of ['تيشيرت بولو', 'أحمر / L', '6221000000011', '250.00 ج.م', 'size: 38mm 25mm']) assert.ok(html.includes(x), x);
  assert.equal((html.match(/class="lb"/g) || []).length, 2, 'two copies');
  assert.ok(!html.includes('محل النيل'));
  assert.ok(!html.includes('تيشيرت بولو — أحمر'), 'size/colour not repeated in the name');
  const noAttrs = settings({ show: { attrs: false } });
  assert.ok(labelsHtml([label], { size: '38x25', layout: labelLayout(noAttrs), settings: noAttrs }).includes('تيشيرت بولو — أحمر / L'));
});

test('switched-off parts, extra line, no currency, rotation and custom size', () => {
  const s = settings({ show: { name: false, code: false, business: true, custom: true }, customText: 'صنع في مصر', currency: false, rotate: true, customW: 60, customH: 20, bars: 60 });
  const l = labelLayout(s);
  const html = labelsHtml([label], { size: 'custom', layout: l, settings: s });
  assert.ok(!html.includes('<div class="nm">') && !html.includes('<div class="cd">'));
  for (const x of ['محل النيل', 'صنع في مصر', '>250.00<', 'rotate(180deg)', 'size: 60mm 20mm', 'height: 60%']) assert.ok(html.includes(x), x);
});

test('A4 sheets and limits', () => {
  const s = settings();
  assert.ok(labelsHtml([label], { size: 'a4_40', layout: labelLayout(s), settings: s }).includes('repeat(4, 52.5mm)'));
  const l = labelLayout(settings({ nameSize: 99, bars: 1, customW: 'x' }));
  assert.equal(l.nameSize, 16);
  assert.equal(l.bars, 20);
  assert.equal(l.customW, DEFAULT_LABEL.customW);
  assert.deepEqual(labelSize('nope', l), [38, 25]);
  assert.deepEqual(labelLayout({ label_layout: '{bad' }), labelLayout({}));
  assert.equal(JSON.parse(labelSetting({ show: { price: false } })).show.price, false);
});
