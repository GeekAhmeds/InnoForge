// Local-first sync with the Inno server. The desktop database is the source
// of truth on this machine; the server keeps a replica (and the original
// files) so other devices — and the mobile app — can read the same data.
// Conflicts resolve last-write-wins on updated_at.
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { extname, join } from 'path'
import { hostname } from 'os'
import { getDb, now, SYNC_TABLES } from './db'
import { broadcast, dataChanged } from './events'
import { getSettings, updateSettings } from './settings'
import { vaultDir } from './paths'
import { reprocess } from './ingest'
import { SERVER_APP_ID, type Account, type SyncStatus } from '@shared/types'

type Row = Record<string, unknown>

let status: SyncStatus = { state: 'idle', lastSyncAt: null }
let syncing = false
let timer: NodeJS.Timeout | null = null

function set(next: SyncStatus): void {
  status = next
  broadcast('sync:status', status)
}

export const getSyncStatus = (): SyncStatus => ({ ...status, lastSyncAt: getSettings().lastSyncAt })

function deviceId(): string {
  const d = getDb()
  const row = d.prepare("SELECT value FROM settings WHERE key = 'deviceId'").get() as { value: string } | undefined
  if (row) return row.value
  const id = `${hostname()}-${Math.random().toString(36).slice(2, 10)}`
  d.prepare("INSERT INTO settings (key, value) VALUES ('deviceId', ?)").run(id)
  return id
}

// push cursor: local ISO timestamp; pull cursor: the server's sequence number.
function cursor(name: 'push' | 'pull'): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(`cursor:${name}`) as { value: string } | undefined
  return row?.value ?? (name === 'push' ? '1970-01-01T00:00:00.000Z' : '0')
}

function setCursor(name: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(`cursor:${name}`, value)
}

/** Request against this app's namespace on the Inno server. */
export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const s = getSettings()
  const res = await fetch(`${s.serverUrl.replace(/\/+$/, '')}/api/${SERVER_APP_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${s.syncToken}`, 'X-Device-Id': deviceId(), ...(init.headers ?? {}) }
  })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text().catch(() => '')}`)
  return res
}

// Ids end up in file paths; reject anything that is not a plain token.
const SAFE_ID = /^[\w-]{1,64}$/

const LOCAL_ONLY_COLUMNS = new Set(['uploaded', 'stored_path'])

async function push(): Promise<void> {
  const d = getDb()
  const since = cursor('push')
  const started = now()
  const changes: Record<string, Row[]> = {}
  for (const table of SYNC_TABLES) {
    const rows = d.prepare(`SELECT * FROM ${table} WHERE updated_at > ?`).all(since) as Row[]
    if (rows.length) changes[table] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !LOCAL_ONLY_COLUMNS.has(k))))
  }
  if (Object.keys(changes).length) {
    await api('/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes })
    })
  }
  setCursor('push', started)

  // Upload original files that the server does not have yet.
  const pending = d.prepare('SELECT id, stored_path FROM documents WHERE uploaded = 0 AND deleted = 0 LIMIT 50').all() as {
    id: string
    stored_path: string
  }[]
  for (const doc of pending) {
    if (!existsSync(doc.stored_path)) continue
    await api(`/files/${doc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: await readFile(doc.stored_path)
    })
    d.prepare('UPDATE documents SET uploaded = 1 WHERE id = ?').run(doc.id)
  }
}

async function pull(): Promise<void> {
  const d = getDb()
  const res = await api(`/sync/pull?since=${encodeURIComponent(cursor('pull'))}`)
  const body = (await res.json()) as { serverTime: string; changes: Record<string, Row[]>; more?: boolean }
  const toFetch: { id: string; company_id: string; name: string }[] = []
  d.transaction(() => {
    for (const table of SYNC_TABLES) {
      // Only accept columns that exist locally; never interpolate unknown keys.
      const known = new Set((d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name))
      for (const row of body.changes[table] ?? []) {
        const local = d.prepare(`SELECT updated_at FROM ${table} WHERE id = ?`).get(row.id) as { updated_at: string } | undefined
        if (!SAFE_ID.test(String(row.id)) || (table === 'documents' && !SAFE_ID.test(String(row.company_id))) || (local && local.updated_at >= String(row.updated_at))) continue
        const cols = Object.keys(row).filter((k) => known.has(k) && !LOCAL_ONLY_COLUMNS.has(k))
        const values = cols.map((k) => row[k])
        if (table === 'documents') {
          const existing = d.prepare('SELECT stored_path FROM documents WHERE id = ?').get(row.id) as { stored_path: string } | undefined
          cols.push('stored_path', 'uploaded')
          values.push(existing?.stored_path ?? join(vaultDir(String(row.company_id)), `${row.id}${extname(String(row.name)).toLowerCase()}`), 1)
          if (!existing && !row.deleted) toFetch.push({ id: String(row.id), company_id: String(row.company_id), name: String(row.name) })
        }
        d.prepare(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
           ON CONFLICT(id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`
        ).run(...values)
      }
    }
  })()
  for (const doc of toFetch) {
    const file = join(vaultDir(doc.company_id), `${doc.id}${extname(doc.name).toLowerCase()}`)
    try {
      const r = await api(`/files/${doc.id}`)
      await writeFile(file, Buffer.from(await r.arrayBuffer()))
      reprocess(doc.id) // build local search index for the downloaded file
    } catch {
      // File not on the server yet; it will be fetched on a later sync.
    }
  }
  setCursor('pull', body.serverTime)
  if (body.more) await pull()
  if (Object.values(body.changes).some((rows) => rows.length)) {
    for (const t of SYNC_TABLES) dataChanged(t)
  }
}

/** Who this device signs in as; decides what the UI allows. */
export async function refreshAccount(): Promise<Account> {
  const me = (await (await api('/me')).json()) as Account
  const account: Account = { name: me.name, role: me.role, companies: me.companies ?? null }
  if (JSON.stringify(account) !== JSON.stringify(getSettings().account)) {
    updateSettings({ account })
    broadcast('account:changed', account)
  }
  return account
}

export async function syncNow(): Promise<SyncStatus> {
  const s = getSettings()
  if (!s.syncEnabled || !s.serverUrl) {
    set({ state: 'disabled', lastSyncAt: s.lastSyncAt })
    return status
  }
  if (syncing) return status
  syncing = true
  set({ state: 'syncing', lastSyncAt: s.lastSyncAt })
  try {
    await refreshAccount()
    await push()
    await pull()
    const at = now()
    updateSettings({ lastSyncAt: at })
    set({ state: 'ok', lastSyncAt: at })
  } catch (e) {
    set({ state: 'error', lastSyncAt: s.lastSyncAt, error: (e as Error).message })
  } finally {
    syncing = false
  }
  return status
}

export function startSync(): void {
  if (timer) clearInterval(timer)
  timer = setInterval(() => void syncNow(), 2 * 60_000)
  void syncNow()
}
