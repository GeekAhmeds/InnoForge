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


/**
 * A report as a formatted sheet: business name and title on top, the period, a coloured
 * header row, number formats per column type, zebra rows, a bold totals row, frozen
 * header, auto-filter and right-to-left layout for Arabic.
 * `report` = services.reports.run() output; `labels` = translated texts from the renderer.
 */
async function writeReport(file, report, { labels, business = '', decimals = 2, currency = '', rtl = true }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'InnoForge POS';
  wb.created = new Date();
  const ws = wb.addWorksheet(String(labels.title || 'Report').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), {
    views: [{ rightToLeft: rtl, state: 'frozen', ySplit: 5 }],
    pageSetup: { paperSize: 9, orientation: report.columns.length > 6 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: '&LInnoForge POS&C&P / &N&R&D' },
  });
  const money = decimals ? `#,##0.${'0'.repeat(decimals)}` : '#,##0';
  const FMT = { money, qty: '#,##0.###', int: '#,##0', pct: '0.0"%"', date: 'yyyy-mm-dd', datetime: 'yyyy-mm-dd hh:mm' };
  const cols = report.columns;
  const n = cols.length;
  const BRAND = 'FF0A43C9';
  const LIGHT = 'FFEEF4FF';

  // Title block
  ws.mergeCells(1, 1, 1, n);
  ws.getCell(1, 1).value = business;
  ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: BRAND } };
  ws.mergeCells(2, 1, 2, n);
  ws.getCell(2, 1).value = labels.title;
  ws.getCell(2, 1).font = { bold: true, size: 13 };
  ws.mergeCells(3, 1, 3, n);
  ws.getCell(3, 1).value = labels.period || '';
  ws.getCell(3, 1).font = { color: { argb: 'FF64748B' } };
  for (const r of [1, 2, 3]) ws.getCell(r, 1).alignment = { horizontal: rtl ? 'right' : 'left' };

  // Header
  const header = ws.getRow(5);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = labels.columns[c.key] || c.key;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF1E3A8A' } } };
  });
  header.height = 24;

  const value = (c, v) => {
    if (v == null || v === '') return null;
    if (c.type === 'money') return Number(v) / 10 ** decimals;
    if (['qty', 'int', 'pct'].includes(c.type)) return Number(v);
    if (c.type === 'date') return new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
    if (c.type === 'datetime') return new Date(`${String(v).replace(' ', 'T')}Z`);
    return labels.values?.[c.key]?.[v] ?? v;
  };
  report.rows.forEach((row, ri) => {
    const r = ws.getRow(6 + ri);
    cols.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.value = value(c, row[c.key]);
      if (FMT[c.type]) cell.numFmt = FMT[c.type];
      if (c.type === 'money' && Number(row[c.key]) < 0) cell.font = { color: { argb: 'FFB91C1C' } };
      if (ri % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
    });
    if (row.kind === 'sum') r.font = { bold: true };
  });

  // Totals
  const hasTotals = cols.some((c) => c.total);
  if (hasTotals && report.rows.length) {
    const r = ws.getRow(6 + report.rows.length);
    cols.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      if (i === 0) cell.value = labels.total;
      else if (c.total) {
        cell.value = c.type === 'money' ? report.totals[c.key] / 10 ** decimals : report.totals[c.key];
        cell.numFmt = FMT[c.type] || FMT.int;
      }
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
      cell.border = { top: { style: 'medium', color: { argb: BRAND } } };
    });
  }
  // Summary lines (e.g. margins)
  let line = 6 + report.rows.length + (hasTotals ? 2 : 1);
  for (const sline of labels.summary || []) {
    ws.getCell(line, 1).value = sline;
    ws.getCell(line, 1).font = { bold: true };
    line += 1;
  }
  if (currency) {
    ws.getCell(line + 1, 1).value = labels.currencyNote;
    ws.getCell(line + 1, 1).font = { italic: true, color: { argb: 'FF94A3B8' } };
  }

  // Widths from content
  cols.forEach((c, i) => {
    const longest = Math.max(String(labels.columns[c.key] || '').length, ...report.rows.slice(0, 500).map((row) => String(value(c, row[c.key]) instanceof Date ? '2026-01-01 00:00' : row[c.key] ?? '').length));
    ws.getColumn(i + 1).width = Math.min(48, Math.max(10, longest + 3));
  });
  if (report.rows.length) ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + report.rows.length, column: n } };
  await wb.xlsx.writeFile(file);
}

module.exports = { COLUMNS, parseFile, writeTemplate, writeSheets, writeReport, mapHeaders };
