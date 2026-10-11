'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { parseFile, writeTemplate, mapHeaders, writeSheets } = require('../electron/excel.cjs');

test('template round-trips through the parser', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-')), 't.xlsx');
  await writeTemplate('products', file);
  const r = await parseFile('products', file);
  assert.equal(r.unknown.length, 0);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].name, 'مياه معدنية 600مل');
  assert.equal(r.rows[0].price, 7);
  assert.equal(r.rows[0].barcode, '6221000000011');
});

test('free-form sheets: headers in any order/language, title rows above, blank rows skipped', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-')), 'f.xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('x');
  ws.addRow(['قائمة أسعار المحل']);
  ws.addRow(['Price', 'Product', 'سعر الشراء', 'Qty', 'ملاحظة غريبة']);
  ws.addRow([12.5, 'Tea', 9, 30, 'x']);
  ws.addRow([]);
  ws.addRow([{ formula: '2+3', result: 5 }, { richText: [{ text: 'Cof' }, { text: 'fee' }] }, 3, 10, '']);
  await wb.xlsx.writeFile(file);
  const r = await parseFile('products', file);
  assert.deepEqual(r.fields.slice(0, 4), ['price', 'name', 'cost', 'stock']);
  assert.deepEqual(r.unknown, ['ملاحظة غريبة']);
  assert.deepEqual(r.rows.map((x) => [x.name, x.price, x.cost]), [['Tea', 12.5, 9], ['Coffee', 5, 3]]);
});

test('customer headers map balance and limit separately', () => {
  assert.deepEqual(mapHeaders('customers', ['الاسم', 'الهاتف', 'حد الائتمان', 'الرصيد']), ['name', 'phone', 'credit_limit', 'opening_balance']);
});

test('export writes money in major units', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-')), 'e.xlsx');
  await writeSheets(file, [{ name: 's', columns: [{ header: 'n', key: 'n' }, { header: 'p', key: 'p', money: true }], rows: [{ n: 'a', p: 1250 }] }], 2);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  assert.equal(wb.worksheets[0].getRow(2).getCell(2).value, 12.5);
});
