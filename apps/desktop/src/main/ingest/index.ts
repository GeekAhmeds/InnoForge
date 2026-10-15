import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { copyFile, readFile, stat } from 'fs/promises'
import { basename, extname, join } from 'path'
import { logActivity, uid } from '../db'
import * as repo from '../repo'
import { getSettings } from '../settings'
import { detectKind, extract } from './extractors'
import { vaultDir } from '../paths'
import { organizeDocument } from '../ai/organize'
import { runChecks } from '../insights'
import type { DocumentRecord } from '@shared/types'

// Filename keywords -> category. Used before (or without) the AI.
const CATEGORY_RULES: [RegExp, string][] = [
  [/invoice|فاتور/i, 'invoice'],
  [/bank|statement|كشف|بنك/i, 'bank_statement'],
  [/payroll|salar|رواتب|مرتب|أجور/i, 'payroll'],
  [/contract|agreement|عقد|اتفاق/i, 'contract'],
  [/budget|موازن/i, 'budget'],
  [/balance|ميزاني/i, 'balance_sheet'],
  [/p&l|profit|loss|income|أرباح|خسائر|دخل/i, 'income_statement'],
  [/cash ?flow|تدفق/i, 'cash_flow'],
  [/tax|vat|ضريب/i, 'tax'],
  [/inventory|stock|مخزون/i, 'inventory'],
  [/purchase|po\b|مشتري/i, 'purchase'],
  [/sales|مبيعات/i, 'sales'],
  [/expense|مصروف/i, 'expenses'],
  [/report|تقرير/i, 'report']
]

function guessCategory(name: string): string {
  return CATEGORY_RULES.find(([re]) => re.test(name))?.[1] ?? 'uncategorized'
}

function guessPeriod(name: string): string | null {
  const ym = name.match(/(20\d{2})[-_. ]?(0[1-9]|1[0-2])/)
  if (ym) return `${ym[1]}-${ym[2]}`
  const q = name.match(/(20\d{2})[-_ ]?q([1-4])|q([1-4])[-_ ]?(20\d{2})/i)
  if (q) return `${q[1] ?? q[4]}-Q${q[2] ?? q[3]}`
  const y = name.match(/\b(20\d{2})\b/)
  return y ? y[1] : null
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export interface ImportResult {
  imported: DocumentRecord[]
  duplicates: string[]
  existing: DocumentRecord[] // the already-imported copies of the duplicates
  failed: { path: string; error: string }[]
}

export async function importFiles(companyId: string, paths: string[]): Promise<ImportResult> {
  const result: ImportResult = { imported: [], duplicates: [], existing: [], failed: [] }
  for (const path of paths) {
    try {
      const hash = await sha256(path)
      const existing = repo.findDocumentByHash(companyId, hash)
      if (existing) {
        result.duplicates.push(basename(path))
        result.existing.push(existing)
        continue
      }
      const id = uid()
      const stored = join(vaultDir(companyId), `${id}${extname(path).toLowerCase()}`)
      await copyFile(path, stored)
      const name = basename(path)
      const doc = repo.insertDocument({
        id,
        companyId,
        name,
        kind: detectKind(path),
        category: guessCategory(name),
        tags: [],
        period: guessPeriod(name),
        summary: '',
        size: (await stat(path)).size,
        sha256: hash,
        storedPath: stored,
        originalPath: path,
        status: 'pending',
        error: null
      })
      result.imported.push(doc)
      enqueue(doc.id)
    } catch (e) {
      result.failed.push({ path, error: (e as Error).message })
    }
  }
  if (result.imported.length) {
    logActivity(companyId, 'import', `Imported ${result.imported.length} file(s)`)
  }
  if (result.duplicates.length) {
    repo.createAlert({
      companyId,
      severity: 'info',
      title: `Duplicate files skipped (${result.duplicates.length})`,
      detail: result.duplicates.join(', ')
    })
  }
  return result
}

// Small background queue so a folder of 500 files does not freeze the app.
const queue: string[] = []
let running = 0
const CONCURRENCY = 2

function enqueue(id: string): void {
  queue.push(id)
  pump()
}

function pump(): void {
  while (running < CONCURRENCY && queue.length) {
    const id = queue.shift()!
    running++
    processDocument(id)
      .catch(() => undefined)
      .finally(() => {
        running--
        pump()
      })
  }
}

export async function processDocument(id: string): Promise<void> {
  const doc = repo.getDocument(id)
  if (!doc || !doc.storedPath || !existsSync(doc.storedPath)) return // connector datasets have no file
  repo.updateDocument(id, { status: 'processing', error: null })
  try {
    const { text, tables } = await extract(doc.storedPath, doc.kind, getSettings().ocrLanguages)
    repo.setDocumentText(doc, text)
    for (const t of tables) repo.setDocumentTable(id, t.sheet, t.columns, t.rows)
    const summary =
      doc.kind === 'pdf' && !text
        ? 'Scanned PDF without a text layer.'
        : tables.length
          ? `${tables.length} table(s): ${tables.map((t) => `${t.sheet} (${t.rows.length} rows)`).join(', ')}`
          : text.slice(0, 280).replace(/\s+/g, ' ')
    repo.updateDocument(id, { status: 'ready', summary })
  } catch (e) {
    repo.updateDocument(id, { status: 'error', error: (e as Error).message })
    return
  }
  if (getSettings().autoOrganize) {
    try {
      await organizeDocument(id)
    } catch (e) {
      logActivity(doc.companyId, 'ai', `AI organize skipped for ${doc.name}: ${(e as Error).message}`)
    }
  }
  runChecks(doc.companyId)
}

export function reprocess(id: string): void {
  enqueue(id)
}
