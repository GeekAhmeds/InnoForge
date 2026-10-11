'use strict';
// Excel (.xlsx) templates, import parsing and exports. Column headers are matched
// loosely (Arabic or English, any order), so people can fill their own sheets too.
const ExcelJS = require('exceljs');

// field → [template header, ...aliases]. The first entry is what templates use.
const COLUMNS = {
  products: {
    name: ['اسم الصنف | Name', 'اسم الصنف', 'الصنف', 'الاسم', 'name', 'product', 'item'],
    barcode: ['الباركود | Barcode', 'الباركود', 'باركود', 'كود', 'barcode', 'isbn', 'code', 'sku'],
    category: ['التصنيف | Category', 'التصنيف', 'القسم', 'المجموعة', 'category', 'group'],
    price: ['سعر البيع | Price', 'سعر البيع', 'سعر', 'price', 'sale price'],
    cost: ['التكلفة | Cost', 'التكلفة', 'سعر الشراء', 'cost', 'purchase price'],
    stock: ['الكمية | Stock', 'الكمية', 'المخزون', 'الرصيد', 'stock', 'qty', 'quantity'],
    min_stock: ['حد الطلب | Reorder level', 'حد الطلب', 'حد إعادة الطلب', 'reorder', 'min stock'],
    unit: ['الوحدة | Unit', 'الوحدة', 'unit'],
    track_stock: ['متابعة المخزون (نعم/لا) | Track stock', 'متابعة المخزون', 'track stock'],
    author: ['المؤلف | Author', 'المؤلف', 'author'],
    publisher: ['الناشر | Publisher', 'الناشر', 'publisher'],
    kitchen: ['يتبعت للمطبخ (نعم/لا) | Kitchen', 'المطبخ', 'kitchen'],
  },
  customers: {
    name: ['اسم العميل | Name', 'اسم العميل', 'العميل', 'الاسم', 'name', 'customer'],
    phone: ['التليفون | Phone', 'التليفون', 'الهاتف', 'الموبايل', 'تليفون', 'phone', 'mobile'],
    address: ['العنوان | Address', 'العنوان', 'address'],
    tax_number: ['الرقم الضريبي | Tax number', 'الرقم الضريبي', 'السجل التجاري', 'tax'],
    credit_limit: ['حد الائتمان | Credit limit', 'حد الائتمان', 'credit limit', 'limit'],
    opening_balance: ['رصيد أول المدة (عليه) | Opening balance', 'رصيد أول المدة', 'الرصيد', 'المديونية', 'opening', 'balance'],
    notes: ['ملاحظات | Notes', 'ملاحظات', 'notes'],
  },
  suppliers: {
    name: ['اسم المورد | Name', 'اسم المورد', 'المورد', 'الاسم', 'name', 'supplier'],
    phone: ['التليفون | Phone', 'التليفون', 'الهاتف', 'الموبايل', 'phone', 'mobile'],
    address: ['العنوان | Address', 'العنوان', 'address'],
    opening_balance: ['رصيد أول المدة (ليه) | Opening balance', 'رصيد أول المدة', 'الرصيد', 'opening', 'balance'],
    notes: ['ملاحظات | Notes', 'ملاحظات', 'notes'],
  },
};

const EXAMPLES = {
  products: [
    ['مياه معدنية 600مل', '6221000000011', 'مشروبات', 7, 5, 100, 10, 'قطعة', 'نعم', '', '', 'لا'],
    ['شيبسي كبير', '6221000000042', 'سناكس', 15, 11, 50, 5, 'قطعة', 'نعم', '', '', 'لا'],
  ],
  customers: [['شركة الأمل للتجارة', '01001234567', 'القاهرة', '123-456-789', 20000, 3500, '']],
  suppliers: [['شركة النيل للتوريدات', '01112223334', 'الجيزة', 1200, '']],
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_\-()|:./]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

/** Maps each sheet header to a field: exact match first, then the longest alias it contains. */
function mapHeaders(kind, headers) {
  const columns = COLUMNS[kind];
  const used = new Set();
  return headers.map((h) => {
    const n = norm(h);
    if (!n) return null;
    let best = null;
    let bestLen = 0;
    for (const [field, aliases] of Object.entries(columns)) {
      if (used.has(field)) continue;
      for (const a of aliases) {
        const na = norm(a);
        if (n === na) { best = field; bestLen = Infinity; break; }
        if (na.length > bestLen && n.includes(na)) { best = field; bestLen = na.length; }
      }
      if (bestLen === Infinity) break;
    }
    if (best) used.add(best);
    return best;
  });
}

function cellValue(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('result' in v) return cellValue(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return typeof v === 'number' ? v : String(v).trim();
}

async function parseFile(kind, file) {
  if (!COLUMNS[kind]) throw new Error(`Unknown import kind ${kind}`);
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(file)) await wb.csv.readFile(file);
  else await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], headers: [], fields: [], unknown: [] };
  // The header row is the first row with at least two filled cells.
  let headerRow = 1;
  for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
    const filled = (ws.getRow(r).values || []).filter((v) => cellValue(v) !== '').length;
    if (filled >= 2) { headerRow = r; break; }
  }
  const headers = [];
  ws.getRow(headerRow).eachCell({ includeEmpty: true }, (cell, col) => { headers[col - 1] = String(cellValue(cell.value)); });
  const fields = mapHeaders(kind, headers);
  const rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = { __row: r };
    let any = false;
    fields.forEach((f, i) => {
      if (!f) return;
      const v = cellValue(row.getCell(i + 1).value);
      if (v !== '') any = true;
      obj[f] = v;
    });
    if (any) rows.push(obj);
  }
  return {
    rows,
    headers,
    fields,
    unknown: headers.filter((h, i) => h && !fields[i]),
    missing: ['name'].filter((f) => !fields.includes(f)),
  };
}

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A43C9' } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.height = 34;
  ws.views = [{ state: 'frozen', ySplit: 1, rightToLeft: true }];
}

async function writeTemplate(kind, file) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'InnoForge POS';
  const ws = wb.addWorksheet(kind);
  ws.columns = Object.values(COLUMNS[kind]).map((a) => ({ header: a[0], width: Math.max(16, a[0].length + 4) }));
  for (const ex of EXAMPLES[kind]) ws.addRow(ex);
  styleHeader(ws);
  await wb.xlsx.writeFile(file);
}

/**
 * Writes one or more sheets: [{ name, columns: [{ header, key, width, money }], rows }].
 * Money columns arrive in minor units and are written as numbers in major units.
 */
async function writeSheets(file, sheets, decimals = 2) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'InnoForge POS';
  const fmt = decimals ? `#,##0.${'0'.repeat(decimals)}` : '#,##0';
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31));
    ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 16, style: c.money ? { numFmt: fmt } : {} }));
    for (const r of sheet.rows) {
      const out = {};
      for (const c of sheet.columns) out[c.key] = c.money && r[c.key] != null ? r[c.key] / 10 ** decimals : r[c.key];
      ws.addRow(out);
    }
    styleHeader(ws);
  }
  await wb.xlsx.writeFile(file);
}

module.exports = { COLUMNS, parseFile, writeTemplate, writeSheets, mapHeaders };
