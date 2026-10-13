// Live connections to company databases and accounting systems. Each
// connector has datasets (saved read-only queries). A dataset is stored as a
// virtual document so search, preview and the AI's query_table work on it;
// "metrics" datasets also feed the dashboard directly.
import Database from 'better-sqlite3'
import pg from 'pg'
import mysql from 'mysql2/promise'
import mssql from 'mssql'
import { getDb, logActivity, now, uid } from './db'
import { dataChanged } from './events'
import * as repo from './repo'
import { decrypt, encrypt } from './settings'
import { runChecks } from './insights'
import { INNOPOS_DATASETS, innoPosQuery, newDeviceId } from './connectors-inno'
import type { Connector, ConnectorType, Dataset } from '@shared/types'

type Row = Record<string, any>
export interface QueryResult {
  columns: string[]
  rows: unknown[][]
}

const MAX_ROWS = 50_000

const toDataset = (r: Row): Dataset => ({
  id: r.id,
  connectorId: r.connector_id,
  name: r.name,
  query: r.query,
  mode: r.mode,
  documentId: r.document_id,
  lastRows: r.last_rows,
  updatedAt: r.updated_at
})

function toConnector(r: Row): Connector {
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    type: r.type,
    config: JSON.parse(r.config),
    hasSecret: !!r.secret,
    allowAi: !!r.allow_ai,
    refreshMinutes: r.refresh_minutes,
    lastRunAt: r.last_run_at,
    lastError: r.last_error,
    datasets: (getDb().prepare('SELECT * FROM datasets WHERE connector_id = ? ORDER BY name').all(r.id) as Row[]).map(toDataset)
  }
}

export function listConnectors(companyId?: string): Connector[] {
  const rows = companyId
    ? getDb().prepare('SELECT * FROM connectors WHERE company_id = ? ORDER BY name').all(companyId)
    : getDb().prepare('SELECT * FROM connectors ORDER BY name').all()
  return (rows as Row[]).map(toConnector)
}

export function getConnector(id: string): Connector | null {
  const r = getDb().prepare('SELECT * FROM connectors WHERE id = ?').get(id) as Row | undefined
  return r ? toConnector(r) : null
}

export function saveConnector(
  input: Partial<Omit<Connector, 'datasets' | 'hasSecret'>> & { companyId: string; name: string; type: ConnectorType; secret?: string }
): Connector {
  const d = getDb()
  const ts = now()
  const existing = input.id ? (d.prepare('SELECT * FROM connectors WHERE id = ?').get(input.id) as Row | undefined) : undefined
  const id = existing?.id ?? uid()
  if (input.type === 'innoerp') throw new Error('Inno Source ERP integration is not available yet')
  if (input.type === 'innopos') {
    // The POS identifies each connected computer by a stable id.
    const previous = existing ? (JSON.parse(existing.config) as Record<string, unknown>) : {}
    input = { ...input, config: { port: 7790, ...input.config, deviceId: String(previous.deviceId ?? input.config?.deviceId ?? newDeviceId()) } }
  }
  const secret = input.secret !== undefined ? (input.secret ? encrypt(input.secret) : null) : (existing?.secret ?? null)
  const values = [input.companyId, input.name, input.type, JSON.stringify(input.config ?? {}), secret, input.allowAi ? 1 : 0, input.refreshMinutes ?? 60]
  if (existing) {
    d.prepare('UPDATE connectors SET company_id=?, name=?, type=?, config=?, secret=?, allow_ai=?, refresh_minutes=?, updated_at=? WHERE id=?').run(
      ...values,
      ts,
      id
    )
  } else {
    d.prepare(
      'INSERT INTO connectors (company_id, name, type, config, secret, allow_ai, refresh_minutes, id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(...values, id, ts, ts)
  }
  if (!existing && input.type === 'innopos') {
    for (const ds of INNOPOS_DATASETS) saveDataset({ connectorId: id, ...ds })
  }
  dataChanged('connectors')
  return getConnector(id)!
}

export function deleteConnector(id: string): void {
  const c = getConnector(id)
  if (!c) return
  for (const ds of c.datasets) if (ds.documentId) repo.deleteDocument(ds.documentId)
  getDb().prepare('DELETE FROM connectors WHERE id = ?').run(id)
  dataChanged('connectors')
}

export function saveDataset(input: Partial<Dataset> & { connectorId: string; name: string; query: string }): Dataset {
  const d = getDb()
  const ts = now()
  const existing = input.id ? (d.prepare('SELECT * FROM datasets WHERE id = ?').get(input.id) as Row | undefined) : undefined
  const id = existing?.id ?? uid()
  if (existing) {
    d.prepare('UPDATE datasets SET name = ?, query = ?, mode = ?, updated_at = ? WHERE id = ?').run(input.name, input.query, input.mode ?? 'table', ts, id)
  } else {
    d.prepare('INSERT INTO datasets (id, connector_id, name, query, mode, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      input.connectorId,
      input.name,
      input.query,
      input.mode ?? 'table',
      ts
    )
  }
  dataChanged('connectors')
  return toDataset(d.prepare('SELECT * FROM datasets WHERE id = ?').get(id) as Row)
}

export function deleteDataset(id: string): void {
  const ds = getDb().prepare('SELECT * FROM datasets WHERE id = ?').get(id) as Row | undefined
  if (ds?.document_id) repo.deleteDocument(ds.document_id)
  getDb().prepare('DELETE FROM datasets WHERE id = ?').run(id)
  dataChanged('connectors')
}

// ---------------- drivers ----------------

/** Only single SELECT/WITH statements. Use a read-only DB user as well. */
export function assertReadOnly(sql: string): void {
  const q = sql.trim().replace(/;\s*$/, '')
  const stripped = q.replace(/'(?:[^']|'')*'/g, "''").replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  if (!/^(select|with)\b/i.test(stripped.trim())) throw new Error('Only SELECT queries are allowed')
  if (stripped.includes(';')) throw new Error('Only one statement is allowed')
  if (/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|exec|execute|call|into)\b/i.test(stripped)) {
    throw new Error('Query contains a write keyword')
  }
}

function secretOf(id: string): string {
  const r = getDb().prepare('SELECT secret FROM connectors WHERE id = ?').get(id) as Row | undefined
  return r?.secret ? decrypt(r.secret) : ''
}

const cfg = (c: Connector, k: string, d = ''): string => String(c.config[k] ?? d)

function normalizeRows(objects: Record<string, unknown>[]): QueryResult {
  const columns = [...new Set(objects.flatMap((o) => Object.keys(o)))]
  const rows = objects.slice(0, MAX_ROWS).map((o) =>
    columns.map((col) => {
      const v = o[col]
      if (v instanceof Date) return v.toISOString().slice(0, 10)
      if (typeof v === 'bigint') return Number(v)
      if (Buffer.isBuffer(v)) return '[binary]'
      if (v !== null && typeof v === 'object') return Array.isArray(v) && v.length === 2 && typeof v[1] === 'string' ? v[1] : JSON.stringify(v) // Odoo many2one -> name
      return v ?? null
    })
  )
  return { columns, rows }
}

async function odooCall(url: string, service: string, method: string, args: unknown[]): Promise<any> {
  const res = await fetch(`${url.replace(/\/+$/, '')}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() })
  })
  const body = await res.json()
  if (body.error) throw new Error(body.error.data?.message ?? body.error.message ?? 'Odoo error')
  return body.result
}

export async function runQuery(c: Connector, query: string): Promise<QueryResult> {
  const password = secretOf(c.id)
  switch (c.type) {
    case 'innoerp':
      throw new Error('Inno Source ERP integration is not available yet')
    case 'innopos':
      return innoPosQuery(c, password, query)
    case 'postgres': {
      assertReadOnly(query)
      const client = new pg.Client({
        host: cfg(c, 'host'),
        port: Number(cfg(c, 'port', '5432')),
        database: cfg(c, 'database'),
        user: cfg(c, 'user'),
        password,
        ssl: c.config.ssl ? { rejectUnauthorized: false } : undefined,
        statement_timeout: 60_000
      })
      await client.connect()
      try {
        await client.query('BEGIN TRANSACTION READ ONLY')
        const r = await client.query(query)
        await client.query('ROLLBACK')
        return normalizeRows(r.rows)
      } finally {
        await client.end()
      }
    }
    case 'mysql': {
      assertReadOnly(query)
      const conn = await mysql.createConnection({
        host: cfg(c, 'host'),
        port: Number(cfg(c, 'port', '3306')),
        database: cfg(c, 'database'),
        user: cfg(c, 'user'),
        password,
        dateStrings: true
      })
      try {
        await conn.query('START TRANSACTION READ ONLY')
        const [rows] = await conn.query({ sql: query, timeout: 60_000 })
        await conn.query('ROLLBACK')
        return normalizeRows(rows as Record<string, unknown>[])
      } finally {
        await conn.end()
      }
    }
    case 'mssql': {
      assertReadOnly(query)
      const pool = await mssql.connect({
        server: cfg(c, 'host'),
        port: Number(cfg(c, 'port', '1433')),
        database: cfg(c, 'database'),
        user: cfg(c, 'user'),
        password,
        requestTimeout: 60_000,
        options: { encrypt: !!c.config.encrypt, trustServerCertificate: true }
      })
      try {
        const r = await pool.request().query(query)
        return normalizeRows(r.recordset as Record<string, unknown>[])
      } finally {
        await pool.close()
      }
    }
    case 'sqlite': {
      assertReadOnly(query)
      const src = new Database(cfg(c, 'file'), { readonly: true, fileMustExist: true })
      try {
        return normalizeRows(src.prepare(query).all() as Record<string, unknown>[])
      } finally {
        src.close()
      }
    }
    case 'odoo': {
      // query: {"model":"account.move","domain":[["state","=","posted"]],"fields":["name","amount_total"],"limit":1000}
      const spec = JSON.parse(query) as { model: string; domain?: unknown[]; fields?: string[]; limit?: number }
      if (!spec.model) throw new Error('Odoo dataset needs a "model"')
      const url = cfg(c, 'url')
      const dbName = cfg(c, 'database')
      const uidOdoo = await odooCall(url, 'common', 'login', [dbName, cfg(c, 'user'), password])
      if (!uidOdoo) throw new Error('Odoo login failed')
      const rows = await odooCall(url, 'object', 'execute_kw', [
        dbName,
        uidOdoo,
        password,
        spec.model,
        'search_read',
        [spec.domain ?? []],
        { fields: spec.fields ?? [], limit: Math.min(spec.limit ?? 5000, MAX_ROWS) }
      ])
      return normalizeRows(rows)
    }
    case 'rest': {
      // query: path appended to the base URL, e.g. /api/invoices?from=2026-01-01
      const url = new URL(query, cfg(c, 'url')).toString()
      const headerName = cfg(c, 'headerName', 'Authorization')
      const res = await fetch(url, { headers: password ? { [headerName]: password } : {} })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      const list = Array.isArray(body) ? body : (body.data ?? body.items ?? body.results ?? body.rows)
      if (!Array.isArray(list)) throw new Error('Response is not a JSON array (or {data: [...]})')
      return normalizeRows(list)
    }
  }
}

export async function testConnector(id: string): Promise<{ ok: boolean; message: string }> {
  const c = getConnector(id)
  if (!c) return { ok: false, message: 'not found' }
  const probe: Record<ConnectorType, string> = {
    innoerp: '',
    innopos: '{"call":"reports.catalog"}',
    postgres: 'SELECT 1 AS ok',
    mysql: 'SELECT 1 AS ok',
    mssql: 'SELECT 1 AS ok',
    sqlite: "SELECT name FROM sqlite_master WHERE type = 'table'",
    odoo: JSON.stringify({ model: 'res.company', fields: ['name'], limit: 1 }),
    rest: c.datasets[0]?.query ?? '/'
  }
  try {
    const r = await runQuery(c, probe[c.type])
    return { ok: true, message: `OK (${r.rows.length} rows)` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// ---------------- refresh ----------------

/** Long format (period, metric, value) or wide (period + numeric columns). */
function toMetrics(companyId: string, res: QueryResult, documentId: string, currency: string): number {
  const idx = (name: string): number => res.columns.findIndex((c) => c.toLowerCase() === name)
  const pIdx = idx('period')
  if (pIdx < 0) throw new Error('Metrics datasets need a "period" column (YYYY-MM)')
  const periodOf = (v: unknown): string | null => {
    const s = String(v ?? '').slice(0, 7)
    return /^\d{4}-\d{2}$/.test(s) ? s : null
  }
  let n = 0
  const mIdx = idx('metric')
  const vIdx = idx('value')
  for (const row of res.rows) {
    const period = periodOf(row[pIdx])
    if (!period) continue
    const pairs: [string, unknown][] =
      mIdx >= 0 && vIdx >= 0 ? [[String(row[mIdx]), row[vIdx]]] : res.columns.map((c, i) => [c, row[i]] as [string, unknown]).filter(([, v], i) => i !== pIdx && typeof v === 'number')
    for (const [metric, v] of pairs) {
      const value = typeof v === 'number' ? v : Number(v)
      if (!metric || !Number.isFinite(value)) continue
      repo.upsertMetric({ companyId, metric, period, value, currency, sourceDocumentId: documentId, note: 'connector' })
      n++
    }
  }
  return n
}

export async function refreshDataset(datasetId: string): Promise<number> {
  const d = getDb()
  const ds = toDataset(d.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId) as Row)
  const c = getConnector(ds.connectorId)!
  const company = repo.getCompany(c.companyId)
  const res = await runQuery(c, ds.query)
  let documentId = ds.documentId && repo.getDocument(ds.documentId) ? ds.documentId : null
  if (!documentId) {
    documentId = uid()
    repo.insertDocument({
      id: documentId,
      companyId: c.companyId,
      name: `🔌 ${c.name} — ${ds.name}`,
      kind: 'database',
      category: 'report',
      tags: ['connector', c.type],
      period: null,
      summary: '',
      size: 0,
      sha256: `connector:${ds.id}`,
      storedPath: '',
      originalPath: `${c.type}:${c.name}`,
      status: 'ready',
      error: null
    })
    d.prepare('UPDATE documents SET uploaded = 1 WHERE id = ?').run(documentId) // nothing to upload
    d.prepare('UPDATE datasets SET document_id = ? WHERE id = ?').run(documentId, ds.id)
  }
  const doc = repo.getDocument(documentId)!
  repo.setDocumentTable(documentId, ds.name, res.columns, res.rows)
  const preview = [res.columns.join(' | '), ...res.rows.slice(0, 2000).map((r) => r.map((v) => (v === null ? '' : String(v))).join(' | '))].join('\n')
  repo.setDocumentText(doc, `# ${ds.name}\n${preview}`)
  repo.updateDocument(documentId, { summary: `${res.rows.length} rows · ${new Date().toLocaleString()}`, status: 'ready', error: null })
  if (ds.mode === 'metrics') {
    const n = toMetrics(c.companyId, res, documentId, company?.currency ?? '')
    if (n) runChecks(c.companyId)
  }
  d.prepare('UPDATE datasets SET last_rows = ?, updated_at = ? WHERE id = ?').run(res.rows.length, now(), ds.id)
  return res.rows.length
}

export async function refreshConnector(id: string): Promise<{ ok: boolean; message: string }> {
  const c = getConnector(id)
  if (!c) return { ok: false, message: 'not found' }
  const errors: string[] = []
  let rows = 0
  for (const ds of c.datasets) {
    try {
      rows += await refreshDataset(ds.id)
    } catch (e) {
      errors.push(`${ds.name}: ${(e as Error).message}`)
    }
  }
  getDb().prepare('UPDATE connectors SET last_run_at = ?, last_error = ? WHERE id = ?').run(now(), errors.join('\n') || null, id)
  logActivity(c.companyId, 'connector', `${c.name}: refreshed ${c.datasets.length} dataset(s), ${rows} rows${errors.length ? `, ${errors.length} error(s)` : ''}`)
  dataChanged('connectors')
  return { ok: !errors.length, message: errors.join('\n') || `${rows} rows` }
}

export async function refreshDueConnectors(): Promise<void> {
  for (const c of listConnectors()) {
    if (!c.datasets.length || c.refreshMinutes <= 0) continue
    const last = c.lastRunAt ? Date.parse(c.lastRunAt) : 0
    if (Date.now() - last >= c.refreshMinutes * 60_000) await refreshConnector(c.id)
  }
}
