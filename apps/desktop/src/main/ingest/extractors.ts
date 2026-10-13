// Turns any supported file into searchable text plus, where possible,
// structured tables. Everything runs locally; nothing leaves the machine here.
import { readFile } from 'fs/promises'
import { extname } from 'path'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { createWorker } from 'tesseract.js'
import Database from 'better-sqlite3'
import { ocrCacheDir } from '../paths'
import type { DocKind } from '@shared/types'

export interface ExtractedTable {
  sheet: string
  columns: string[]
  rows: unknown[][]
}

export interface Extraction {
  text: string
  tables: ExtractedTable[]
}

const EXT_KIND: Record<string, DocKind> = {
  '.xlsx': 'excel',
  '.xlsm': 'excel',
  '.csv': 'csv',
  '.tsv': 'csv',
  '.pdf': 'pdf',
  '.docx': 'word',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.bmp': 'image',
  '.tif': 'image',
  '.tiff': 'image',
  '.txt': 'text',
  '.md': 'text',
  '.json': 'text',
  '.xml': 'text',
  '.db': 'database',
  '.sqlite': 'database',
  '.sqlite3': 'database'
}

export function detectKind(path: string): DocKind {
  return EXT_KIND[extname(path).toLowerCase()] ?? 'other'
}

export const SUPPORTED_EXTENSIONS = Object.keys(EXT_KIND)

const MAX_TABLE_ROWS = 50_000

export async function extract(path: string, kind: DocKind, ocrLanguages: string): Promise<Extraction> {
  switch (kind) {
    case 'excel':
      return extractExcel(path)
    case 'csv':
      return extractCsv(path)
    case 'pdf':
      return extractPdf(path)
    case 'word':
      return { text: (await mammoth.extractRawText({ path })).value, tables: [] }
    case 'image':
      return { text: await ocrImage(path, ocrLanguages), tables: [] }
    case 'text':
      return { text: await readFile(path, 'utf8'), tables: [] }
    case 'database':
      return extractSqlite(path)
    default:
      return { text: '', tables: [] }
  }
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result as ExcelJS.CellValue) // formula
    if ('richText' in v) return v.richText.map((t) => t.text).join('')
    if ('text' in v) return v.text // hyperlink
    if ('error' in v) return null
  }
  return v
}

// Many real-world sheets have titles or blank rows above the header. Use the
// first row that has at least two non-empty cells as the header.
function splitHeader(matrix: unknown[][]): { columns: string[]; rows: unknown[][] } {
  const headerIndex = matrix.findIndex((r) => r.filter((c) => c !== null && c !== '').length >= 2)
  if (headerIndex < 0) return { columns: [], rows: [] }
  const header = matrix[headerIndex]
  const width = Math.max(...matrix.map((r) => r.length))
  const columns = Array.from({ length: width }, (_, i) => {
    const h = header[i]
    return h === null || h === undefined || h === '' ? `col_${i + 1}` : String(h).trim()
  })
  const rows = matrix
    .slice(headerIndex + 1)
    .filter((r) => r.some((c) => c !== null && c !== ''))
    .slice(0, MAX_TABLE_ROWS)
  return { columns, rows }
}

function tableToText(t: ExtractedTable): string {
  const lines = [`# ${t.sheet}`, t.columns.join(' | ')]
  for (const r of t.rows.slice(0, 2000)) lines.push(r.map((c) => (c === null ? '' : String(c))).join(' | '))
  if (t.rows.length > 2000) lines.push(`... (${t.rows.length - 2000} more rows)`)
  return lines.join('\n')
}

async function extractExcel(path: string): Promise<Extraction> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const tables: ExtractedTable[] = []
  wb.eachSheet((ws) => {
    const matrix: unknown[][] = []
    ws.eachRow({ includeEmpty: true }, (row) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue)
      matrix.push(values)
    })
    const { columns, rows } = splitHeader(matrix)
    if (columns.length) tables.push({ sheet: ws.name, columns, rows })
  })
  return { text: tables.map(tableToText).join('\n\n'), tables }
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      out.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    out.push(row)
  }
  return out
}

function coerce(v: string): unknown {
  const s = v.trim()
  if (s === '') return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) && /^-?[\d,]*\.?\d+$/.test(s) ? n : s
}

async function extractCsv(path: string): Promise<Extraction> {
  const raw = (await readFile(path, 'utf8')).replace(/^﻿/, '')
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = path.toLowerCase().endsWith('.tsv')
    ? '\t'
    : [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]
  const matrix = parseDelimited(raw, delimiter).map((r) => r.map(coerce))
  const { columns, rows } = splitHeader(matrix)
  const table = { sheet: 'data', columns, rows }
  return { text: tableToText(table), tables: columns.length ? [table] : [] }
}

async function extractPdf(path: string): Promise<Extraction> {
  const parser = new PDFParse({ data: await readFile(path) })
  try {
    const result = await parser.getText()
    const text = result.text.trim()
    const tables: ExtractedTable[] = []
    try {
      const t = await parser.getTable()
      t.pages.forEach((p) =>
        p.tables.forEach((tbl, i) => {
          const { columns, rows } = splitHeader(tbl)
          if (columns.length) tables.push({ sheet: `page_${p.num}_table_${i + 1}`, columns, rows })
        })
      )
    } catch {
      // Table detection is best-effort.
    }
    return { text, tables }
  } finally {
    await parser.destroy()
  }
}

async function ocrImage(path: string, languages: string): Promise<string> {
  const worker = await createWorker(languages.split('+'), undefined, { cachePath: ocrCacheDir() })
  try {
    const { data } = await worker.recognize(path)
    return data.text
  } finally {
    await worker.terminate()
  }
}

async function extractSqlite(path: string): Promise<Extraction> {
  const src = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const names = (
      src.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    ).map((r) => r.name)
    const tables: ExtractedTable[] = names.map((name) => {
      const stmt = src.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}" LIMIT ${MAX_TABLE_ROWS}`)
      const columns = stmt.columns().map((c) => c.name)
      const rows = (stmt.raw(true).all() as unknown[][]).map((r) =>
        r.map((v) => (Buffer.isBuffer(v) ? '[binary]' : typeof v === 'bigint' ? Number(v) : v))
      )
      return { sheet: name, columns, rows }
    })
    return { text: tables.map(tableToText).join('\n\n'), tables }
  } finally {
    src.close()
  }
}
