// Data access for every entity. Row <-> object mapping lives here so the rest
// of the main process works with the shared types only.
import { getDb, logActivity, now, uid } from './db'
import { dataChanged } from './events'
import type {
  ActivityItem,
  Alert,
  Company,
  Decision,
  DocumentRecord,
  Metric,
  Report,
  Severity,
  TableSheet
} from '@shared/types'

type Row = Record<string, any>

const toCompany = (r: Row): Company => ({
  id: r.id,
  name: r.name,
  industry: r.industry,
  role: r.role,
  currency: r.currency,
  color: r.color,
  watchFolder: r.watch_folder,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export const toDocument = (r: Row): DocumentRecord => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  kind: r.kind,
  category: r.category,
  tags: JSON.parse(r.tags || '[]'),
  period: r.period,
  summary: r.summary,
  size: r.size,
  sha256: r.sha256,
  storedPath: r.stored_path,
  originalPath: r.original_path,
  status: r.status,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toMetric = (r: Row): Metric => ({
  id: r.id,
  companyId: r.company_id,
  metric: r.metric,
  period: r.period,
  value: r.value,
  currency: r.currency,
  sourceDocumentId: r.source_document_id,
  note: r.note,
  createdAt: r.created_at
})

const toAlert = (r: Row): Alert => ({
  id: r.id,
  companyId: r.company_id,
  severity: r.severity,
  title: r.title,
  detail: r.detail,
  source: r.source,
  resolved: !!r.resolved,
  createdAt: r.created_at
})

const toDecision = (r: Row): Decision => ({
  id: r.id,
  companyId: r.company_id,
  title: r.title,
  rationale: r.rationale,
  expectedOutcome: r.expected_outcome,
  actualOutcome: r.actual_outcome,
  status: r.status,
  reviewDate: r.review_date,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toReport = (r: Row): Report => ({
  id: r.id,
  companyId: r.company_id,
  title: r.title,
  format: r.format,
  path: r.path,
  createdAt: r.created_at
})

const toActivity = (r: Row): ActivityItem => ({
  id: r.id,
  companyId: r.company_id,
  type: r.type,
  message: r.message,
  createdAt: r.created_at
})

// ---------- companies ----------

export function listCompanies(): Company[] {
  return (getDb().prepare('SELECT * FROM companies WHERE deleted = 0 ORDER BY name').all() as Row[]).map(toCompany)
}

export function getCompany(id: string): Company | null {
  const r = getDb().prepare('SELECT * FROM companies WHERE id = ? AND deleted = 0').get(id) as Row | undefined
  return r ? toCompany(r) : null
}

export function saveCompany(input: Partial<Company> & { name: string }): Company {
  const d = getDb()
  const ts = now()
  if (input.id && getCompany(input.id)) {
    const c = { ...getCompany(input.id)!, ...input }
    d.prepare(
      `UPDATE companies SET name=?, industry=?, role=?, currency=?, color=?, watch_folder=?, notes=?, updated_at=? WHERE id=?`
    ).run(c.name, c.industry, c.role, c.currency, c.color, c.watchFolder, c.notes, ts, c.id)
    dataChanged('companies')
    return getCompany(c.id)!
  }
  const id = uid()
  d.prepare(
    `INSERT INTO companies (id, name, industry, role, currency, color, watch_folder, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.industry ?? '',
    input.role ?? '',
    input.currency ?? 'EGP',
    input.color ?? '#2a78d6',
    input.watchFolder ?? null,
    input.notes ?? '',
    ts,
    ts
  )
  logActivity(id, 'company', `Company created: ${input.name}`)
  dataChanged('companies')
  return getCompany(id)!
}

export function deleteCompany(id: string): void {
  const ts = now()
  const d = getDb()
  d.transaction(() => {
    d.prepare('UPDATE companies SET deleted = 1, updated_at = ? WHERE id = ?').run(ts, id)
    d.prepare('UPDATE documents SET deleted = 1, updated_at = ? WHERE company_id = ?').run(ts, id)
    d.prepare('DELETE FROM document_text WHERE company_id = ?').run(id)
  })()
  dataChanged('companies')
}

// ---------- documents ----------

export function listDocuments(filter: { companyId?: string; category?: string; query?: string; limit?: number } = {}): DocumentRecord[] {
  const where = ['deleted = 0']
  const params: unknown[] = []
  if (filter.companyId) {
    where.push('company_id = ?')
    params.push(filter.companyId)
  }
  if (filter.category) {
    where.push('category = ?')
    params.push(filter.category)
  }
  if (filter.query) {
    where.push('(name LIKE ? OR summary LIKE ? OR tags LIKE ?)')
    const q = `%${filter.query}%`
    params.push(q, q, q)
  }
  params.push(filter.limit ?? 500)
  return (
    getDb()
      .prepare(`SELECT * FROM documents WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as Row[]
  ).map(toDocument)
}

export function getDocument(id: string): DocumentRecord | null {
  const r = getDb().prepare('SELECT * FROM documents WHERE id = ? AND deleted = 0').get(id) as Row | undefined
  return r ? toDocument(r) : null
}

export function findDocumentByHash(companyId: string, sha256: string): DocumentRecord | null {
  const r = getDb()
    .prepare('SELECT * FROM documents WHERE company_id = ? AND sha256 = ? AND deleted = 0')
    .get(companyId, sha256) as Row | undefined
  return r ? toDocument(r) : null
}

export function insertDocument(doc: Omit<DocumentRecord, 'createdAt' | 'updatedAt'>): DocumentRecord {
  const ts = now()
  getDb()
    .prepare(
      `INSERT INTO documents (id, company_id, name, kind, category, tags, period, summary, size, sha256, stored_path,
        original_path, status, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      doc.id,
      doc.companyId,
      doc.name,
      doc.kind,
      doc.category,
      JSON.stringify(doc.tags),
      doc.period,
      doc.summary,
      doc.size,
      doc.sha256,
      doc.storedPath,
      doc.originalPath,
      doc.status,
      doc.error,
      ts,
      ts
    )
  dataChanged('documents')
  return getDocument(doc.id)!
}

export function updateDocument(
  id: string,
  patch: Partial<Pick<DocumentRecord, 'name' | 'category' | 'tags' | 'period' | 'summary' | 'status' | 'error'>>
): DocumentRecord | null {
  const doc = getDocument(id)
  if (!doc) return null
  const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
  const next = { ...doc, ...defined }
  getDb()
    .prepare(
      'UPDATE documents SET name=?, category=?, tags=?, period=?, summary=?, status=?, error=?, updated_at=? WHERE id=?'
    )
    .run(next.name, next.category, JSON.stringify(next.tags), next.period, next.summary, next.status, next.error, now(), id)
  dataChanged('documents')
  return getDocument(id)
}

export function deleteDocument(id: string): void {
  const d = getDb()
  d.prepare('UPDATE documents SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), id)
  d.prepare('DELETE FROM document_text WHERE document_id = ?').run(id)
  d.prepare('DELETE FROM document_tables WHERE document_id = ?').run(id)
  dataChanged('documents')
}

export function setDocumentText(doc: DocumentRecord, text: string): void {
  const d = getDb()
  d.prepare('DELETE FROM document_text WHERE document_id = ?').run(doc.id)
  d.prepare('INSERT INTO document_text (document_id, company_id, name, content) VALUES (?, ?, ?, ?)').run(
    doc.id,
    doc.companyId,
    doc.name,
    text
  )
}

export function getDocumentText(id: string): string {
  const r = getDb().prepare('SELECT content FROM document_text WHERE document_id = ?').get(id) as Row | undefined
  return r?.content ?? ''
}

export function setDocumentTable(documentId: string, sheet: string, columns: string[], rows: unknown[][]): void {
  getDb()
    .prepare(
      `INSERT INTO document_tables (document_id, sheet, columns, rows, row_count) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(document_id, sheet) DO UPDATE SET columns=excluded.columns, rows=excluded.rows, row_count=excluded.row_count`
    )
    .run(documentId, sheet, JSON.stringify(columns), JSON.stringify(rows), rows.length)
}

export function listDocumentSheets(documentId: string): TableSheet[] {
  return (
    getDb().prepare('SELECT sheet, columns, row_count FROM document_tables WHERE document_id = ?').all(documentId) as Row[]
  ).map((r) => ({ name: r.sheet, columns: JSON.parse(r.columns), rowCount: r.row_count }))
}

export function getDocumentTable(documentId: string, sheet?: string): { sheet: string; columns: string[]; rows: unknown[][] } | null {
  const r = (
    sheet
      ? getDb().prepare('SELECT * FROM document_tables WHERE document_id = ? AND sheet = ?').get(documentId, sheet)
      : getDb().prepare('SELECT * FROM document_tables WHERE document_id = ? LIMIT 1').get(documentId)
  ) as Row | undefined
  return r ? { sheet: r.sheet, columns: JSON.parse(r.columns), rows: JSON.parse(r.rows) } : null
}

// ---------- metrics ----------

export function listMetrics(filter: { companyId?: string; metric?: string; from?: string; to?: string } = {}): Metric[] {
  const where = ['deleted = 0']
  const params: unknown[] = []
  if (filter.companyId) {
    where.push('company_id = ?')
    params.push(filter.companyId)
  }
  if (filter.metric) {
    where.push('metric = ?')
    params.push(filter.metric)
  }
  if (filter.from) {
    where.push('period >= ?')
    params.push(filter.from)
  }
  if (filter.to) {
    where.push('period <= ?')
    params.push(filter.to)
  }
  return (
    getDb().prepare(`SELECT * FROM metrics WHERE ${where.join(' AND ')} ORDER BY period, metric`).all(...params) as Row[]
  ).map(toMetric)
}

export function upsertMetric(m: {
  companyId: string
  metric: string
  period: string
  value: number
  currency?: string
  sourceDocumentId?: string | null
  note?: string
}): Metric {
  const d = getDb()
  const ts = now()
  const metric = m.metric.trim().toLowerCase().replace(/\s+/g, '_')
  const existing = d
    .prepare('SELECT id FROM metrics WHERE company_id = ? AND metric = ? AND period = ? AND deleted = 0')
    .get(m.companyId, metric, m.period) as Row | undefined
  const id = existing?.id ?? uid()
  if (existing) {
    d.prepare('UPDATE metrics SET value=?, currency=?, source_document_id=?, note=?, updated_at=? WHERE id=?').run(
      m.value,
      m.currency ?? '',
      m.sourceDocumentId ?? null,
      m.note ?? '',
      ts,
      id
    )
  } else {
    d.prepare(
      `INSERT INTO metrics (id, company_id, metric, period, value, currency, source_document_id, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, m.companyId, metric, m.period, m.value, m.currency ?? '', m.sourceDocumentId ?? null, m.note ?? '', ts, ts)
  }
  dataChanged('metrics')
  return toMetric(d.prepare('SELECT * FROM metrics WHERE id = ?').get(id) as Row)
}

export function deleteMetric(id: string): void {
  getDb().prepare('UPDATE metrics SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), id)
  dataChanged('metrics')
}

// ---------- alerts ----------

export function listAlerts(filter: { companyId?: string; includeResolved?: boolean; limit?: number } = {}): Alert[] {
  const where = ['deleted = 0']
  const params: unknown[] = []
  if (filter.companyId) {
    where.push('company_id = ?')
    params.push(filter.companyId)
  }
  if (!filter.includeResolved) where.push('resolved = 0')
  params.push(filter.limit ?? 100)
  return (
    getDb()
      .prepare(`SELECT * FROM alerts WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as Row[]
  ).map(toAlert)
}

export function createAlert(a: {
  companyId: string | null
  severity: Severity
  title: string
  detail?: string
  source?: Alert['source']
}): Alert {
  const d = getDb()
  // Do not stack identical open alerts.
  const dup = d
    .prepare(`SELECT * FROM alerts WHERE IFNULL(company_id, '') = IFNULL(?, '') AND title = ? AND resolved = 0 AND deleted = 0`)
    .get(a.companyId, a.title) as Row | undefined
  if (dup) return toAlert(dup)
  const id = uid()
  const ts = now()
  d.prepare(
    `INSERT INTO alerts (id, company_id, severity, title, detail, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, a.companyId, a.severity, a.title, a.detail ?? '', a.source ?? 'system', ts, ts)
  dataChanged('alerts')
  return toAlert(d.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as Row)
}

export function resolveAlert(id: string): void {
  getDb().prepare('UPDATE alerts SET resolved = 1, updated_at = ? WHERE id = ?').run(now(), id)
  dataChanged('alerts')
}

// ---------- decisions ----------

export function listDecisions(companyId?: string): Decision[] {
  const rows = companyId
    ? getDb().prepare('SELECT * FROM decisions WHERE deleted = 0 AND company_id = ? ORDER BY created_at DESC').all(companyId)
    : getDb().prepare('SELECT * FROM decisions WHERE deleted = 0 ORDER BY created_at DESC').all()
  return (rows as Row[]).map(toDecision)
}

export function saveDecision(input: Partial<Decision> & { companyId: string; title: string }): Decision {
  const d = getDb()
  const ts = now()
  const existing = input.id ? (d.prepare('SELECT * FROM decisions WHERE id = ?').get(input.id) as Row | undefined) : undefined
  if (existing) {
    const c = { ...toDecision(existing), ...input }
    d.prepare(
      `UPDATE decisions SET title=?, rationale=?, expected_outcome=?, actual_outcome=?, status=?, review_date=?, updated_at=? WHERE id=?`
    ).run(c.title, c.rationale, c.expectedOutcome, c.actualOutcome, c.status, c.reviewDate, ts, c.id)
    dataChanged('decisions')
    return toDecision(d.prepare('SELECT * FROM decisions WHERE id = ?').get(c.id) as Row)
  }
  const id = uid()
  d.prepare(
    `INSERT INTO decisions (id, company_id, title, rationale, expected_outcome, actual_outcome, status, review_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.companyId,
    input.title,
    input.rationale ?? '',
    input.expectedOutcome ?? '',
    input.actualOutcome ?? '',
    input.status ?? 'open',
    input.reviewDate ?? null,
    ts,
    ts
  )
  logActivity(input.companyId, 'decision', `Decision logged: ${input.title}`)
  dataChanged('decisions')
  return toDecision(d.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as Row)
}

export function deleteDecision(id: string): void {
  getDb().prepare('UPDATE decisions SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), id)
  dataChanged('decisions')
}

// ---------- reports ----------

export function listReports(companyId?: string): Report[] {
  const rows = companyId
    ? getDb().prepare('SELECT * FROM reports WHERE deleted = 0 AND company_id = ? ORDER BY created_at DESC').all(companyId)
    : getDb().prepare('SELECT * FROM reports WHERE deleted = 0 ORDER BY created_at DESC').all()
  return (rows as Row[]).map(toReport)
}

export function insertReport(r: Omit<Report, 'id' | 'createdAt'>): Report {
  const id = uid()
  const ts = now()
  getDb()
    .prepare('INSERT INTO reports (id, company_id, title, format, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, r.companyId, r.title, r.format, r.path, ts, ts)
  logActivity(r.companyId, 'report', `Report generated: ${r.title} (${r.format.toUpperCase()})`)
  dataChanged('reports')
  return toReport(getDb().prepare('SELECT * FROM reports WHERE id = ?').get(id) as Row)
}

// ---------- activity ----------

export function listActivity(companyId?: string, limit = 30): ActivityItem[] {
  const rows = companyId
    ? getDb().prepare('SELECT * FROM activity WHERE company_id = ? ORDER BY created_at DESC LIMIT ?').all(companyId, limit)
    : getDb().prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT ?').all(limit)
  return (rows as Row[]).map(toActivity)
}
