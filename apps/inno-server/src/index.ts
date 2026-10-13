// Inno Server — the shared backend of Inno Source For Software Solutions.
// Each product is an "app" namespace (Azim Command is `azim-command`), so
// several products can live on the same server without their data, users or
// update feeds getting mixed up.
//
//   GET  /api/health
//   GET  /updates/<app>/<os>/...                 electron-builder update feed
//   GET  /api/<app>/releases                     release history
//   PUT  /api/<app>/releases/<os>/<file>         publish (INNO_PUBLISH_TOKEN)
//   GET  /api/<app>/events                       SSE: release announcements
//   GET  /api/<app>/me                           who am I (role, companies)
//   *    /api/<app>/users                        accounts & permissions (admin)
//   POST /api/<app>/sync/push · GET /sync/pull   replica (last-write-wins)
//   PUT|GET /api/<app>/files/<id>                original documents
//   GET  /api/<app>/data/<table>                 read API (mobile app)
//   POST /api/<app>/push/register                mobile push notifications
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import Database from 'better-sqlite3'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

const PORT = Number(process.env.PORT ?? 9991)
const HOST = process.env.HOST ?? '0.0.0.0'
const DATA_DIR = resolve(process.env.DATA_DIR ?? './data')
const APPS = new Set((process.env.INNO_APPS ?? 'azim-command').split(',').map((a) => a.trim()).filter(Boolean))
const OWNER_TOKENS = (process.env.INNO_OWNER_TOKENS ?? '').split(',').map((t) => t.trim()).filter(Boolean)
const PUBLISH_TOKEN = process.env.INNO_PUBLISH_TOKEN ?? ''
const MAX_UPLOAD = 1024 * 1024 * 1024

const UPDATES_DIR = join(DATA_DIR, 'updates')
const OSES = ['win', 'linux', 'mac']
for (const app of APPS) {
  for (const os of OSES) mkdirSync(join(UPDATES_DIR, app, os), { recursive: true })
  mkdirSync(join(DATA_DIR, 'files', app), { recursive: true })
}

// Tables replicated from the desktop app. Connector credentials and report
// schedules never leave the desktop.
const TABLES = new Set(['companies', 'documents', 'metrics', 'alerts', 'decisions', 'reports', 'reminders', 'budgets'])
const SAFE_ID = /^[\w-]{1,64}$/
const SAFE_FILE = /^[\w .()+-]{1,200}$/

type Role = 'owner' | 'admin' | 'accountant' | 'viewer'
interface Principal {
  id: string
  name: string
  role: Role
  companies: string[] | null // null = all companies
}

// What each role may write, and what it may never read.
const WRITABLE: Record<Role, Set<string> | 'all'> = {
  owner: 'all',
  admin: 'all',
  accountant: new Set(['documents', 'reminders']),
  viewer: new Set()
}
const HIDDEN: Record<Role, Set<string>> = {
  owner: new Set(),
  admin: new Set(),
  accountant: new Set(['decisions']),
  viewer: new Set()
}

const db = new Database(join(DATA_DIR, 'inno-server.db'))
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    app TEXT NOT NULL,
    tbl TEXT NOT NULL,
    id TEXT NOT NULL,
    company_id TEXT,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    author TEXT,
    UNIQUE (app, tbl, id)
  );
  CREATE INDEX IF NOT EXISTS idx_records_company ON records(app, tbl, company_id);
  CREATE TABLE IF NOT EXISTS releases (
    app TEXT NOT NULL, os TEXT NOT NULL, version TEXT NOT NULL, published_at TEXT NOT NULL,
    PRIMARY KEY (app, os, version)
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    app TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    companies TEXT, -- JSON array or NULL for all
    token_hash TEXT NOT NULL UNIQUE,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_seen TEXT
  );
  CREATE TABLE IF NOT EXISTS push_devices (
    token TEXT PRIMARY KEY,
    app TEXT NOT NULL,
    user_id TEXT NOT NULL,
    platform TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS push_sent (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
`)

const app = Fastify({ logger: true, bodyLimit: MAX_UPLOAD, trustProxy: true })
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body))

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function bearer(req: FastifyRequest): string {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal
    appId?: string
  }
}

function principalFor(appId: string, token: string): Principal | null {
  if (!token) return null
  if (OWNER_TOKENS.some((t) => safeEqual(t, token))) return { id: 'owner', name: 'Owner', role: 'owner', companies: null }
  const row = db
    .prepare('SELECT * FROM users WHERE app = ? AND token_hash = ? AND disabled = 0')
    .get(appId, sha256(token)) as Record<string, string> | undefined
  if (!row) return null
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(new Date().toISOString(), row.id)
  return { id: row.id, name: row.name, role: row.role as Role, companies: row.companies ? JSON.parse(row.companies) : null }
}

async function auth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const appId = (req.params as { app?: string }).app ?? ''
  if (!APPS.has(appId)) return void (await reply.code(404).send({ error: 'unknown app' }))
  const p = principalFor(appId, bearer(req))
  if (!p) return void (await reply.code(401).send({ error: 'unauthorized' }))
  req.principal = p
  req.appId = appId
}

async function adminOnly(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await auth(req, reply)
  if (reply.sent) return
  if (req.principal!.role !== 'owner' && req.principal!.role !== 'admin') await reply.code(403).send({ error: 'admin only' })
}

async function publisher(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const appId = (req.params as { app?: string }).app ?? ''
  const token = bearer(req)
  if (!APPS.has(appId)) return void (await reply.code(404).send({ error: 'unknown app' }))
  if (!PUBLISH_TOKEN || !token || !safeEqual(PUBLISH_TOKEN, token)) await reply.code(401).send({ error: 'unauthorized' })
}

const canSeeCompany = (p: Principal, companyId: string | null): boolean => !p.companies || (!!companyId && p.companies.includes(companyId))

// ---------------- health & events ----------------

app.get('/api/health', async () => ({
  ok: true,
  name: 'Inno Server',
  by: 'Inno Source For Software Solutions',
  apps: [...APPS].map((a) => ({ app: a, latest: latestReleases(a) })),
  time: new Date().toISOString()
}))

const listeners = new Map<string, Set<FastifyReply>>()

function announce(appId: string, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const reply of listeners.get(appId) ?? []) reply.raw.write(payload)
}

app.get<{ Params: { app: string } }>('/api/:app/events', (req, reply) => {
  const appId = req.params.app
  if (!APPS.has(appId)) return reply.code(404).send({ error: 'unknown app' })
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  reply.raw.write(`event: hello\ndata: ${JSON.stringify({ latest: latestReleases(appId) })}\n\n`)
  if (!listeners.has(appId)) listeners.set(appId, new Set())
  listeners.get(appId)!.add(reply)
  const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000)
  req.raw.on('close', () => {
    clearInterval(ping)
    listeners.get(appId)?.delete(reply)
  })
})

// ---------------- releases & update feed ----------------

function latestReleases(appId: string): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const os of OSES) {
    const row = db
      .prepare('SELECT version FROM releases WHERE app = ? AND os = ? ORDER BY published_at DESC LIMIT 1')
      .get(appId, os) as { version: string } | undefined
    out[os] = row?.version ?? null
  }
  return out
}

app.register(fastifyStatic, { root: UPDATES_DIR, prefix: '/updates/', decorateReply: false, cacheControl: false })

app.get<{ Params: { app: string } }>('/api/:app/releases', async (req, reply) => {
  if (!APPS.has(req.params.app)) return reply.code(404).send({ error: 'unknown app' })
  return {
    latest: latestReleases(req.params.app),
    history: db.prepare('SELECT os, version, published_at FROM releases WHERE app = ? ORDER BY published_at DESC LIMIT 50').all(req.params.app)
  }
})

// Artifacts first, latest*.yml last: writing the manifest makes the release
// live, and every connected app is told immediately.
app.put<{ Params: { app: string; os: string; file: string } }>(
  '/api/:app/releases/:os/:file',
  { preHandler: publisher },
  async (req, reply) => {
    const { app: appId, os, file } = req.params
    if (!OSES.includes(os) || !SAFE_FILE.test(file) || file.startsWith('.')) return reply.code(400).send({ error: 'bad path' })
    const body = req.body as Buffer
    if (!Buffer.isBuffer(body) || !body.length) return reply.code(400).send({ error: 'empty body' })
    const target = join(UPDATES_DIR, appId, os, file)
    await writeFile(`${target}.part`, body)
    await rename(`${target}.part`, target)
    if (/^latest.*\.yml$/.test(file)) {
      const version = /^version:\s*(.+)$/m.exec(body.toString('utf8'))?.[1]?.trim() ?? 'unknown'
      db.prepare('INSERT OR REPLACE INTO releases (app, os, version, published_at) VALUES (?, ?, ?, ?)').run(
        appId,
        os,
        version,
        new Date().toISOString()
      )
      announce(appId, 'release', { os, version })
      req.log.info({ app: appId, os, version }, 'release published')
    }
    return { ok: true, file, size: body.length }
  }
)

app.post<{ Params: { app: string; os: string } }>('/api/:app/releases/:os/prune', { preHandler: publisher }, async (req, reply) => {
  const { app: appId, os } = req.params
  if (!OSES.includes(os)) return reply.code(400).send({ error: 'bad os' })
  const dir = join(UPDATES_DIR, appId, os)
  const manifests = readdirSync(dir).filter((f) => /^latest.*\.yml$/.test(f))
  const keep = new Set(manifests)
  for (const m of manifests) {
    for (const match of readFileSync(join(dir, m), 'utf8').matchAll(/(?:url|path):\s*(.+)/g)) {
      const name = decodeURIComponent(match[1].trim())
      keep.add(name)
      keep.add(`${name}.blockmap`)
    }
  }
  const removed = readdirSync(dir).filter((f) => !keep.has(f))
  for (const f of removed) unlinkSync(join(dir, f))
  return { removed }
})

// ---------------- accounts & permissions ----------------

const publicUser = (r: Record<string, unknown>): Record<string, unknown> => ({
  id: r.id,
  name: r.name,
  role: r.role,
  companies: r.companies ? JSON.parse(String(r.companies)) : null,
  disabled: !!r.disabled,
  createdAt: r.created_at,
  lastSeen: r.last_seen
})

app.get('/api/:app/me', { preHandler: auth }, async (req) => req.principal)

app.get('/api/:app/users', { preHandler: adminOnly }, async (req) =>
  (db.prepare('SELECT * FROM users WHERE app = ? ORDER BY created_at').all(req.appId) as Record<string, unknown>[]).map(publicUser)
)

interface UserBody {
  name?: string
  role?: Role
  companies?: string[] | null
  disabled?: boolean
}

function validUser(b: UserBody): string | null {
  if (!b.name?.trim()) return 'name required'
  if (!b.role || !['admin', 'accountant', 'viewer'].includes(b.role)) return 'role must be admin, accountant or viewer'
  if (b.companies && (!Array.isArray(b.companies) || !b.companies.every((c) => SAFE_ID.test(c)))) return 'bad companies'
  return null
}

// The token is returned once; only its hash is stored.
app.post<{ Params: { app: string }; Body: UserBody }>('/api/:app/users', { preHandler: adminOnly }, async (req, reply) => {
  const err = validUser(req.body ?? {})
  if (err) return reply.code(400).send({ error: err })
  const id = randomUUID()
  const token = `inno_${randomBytes(24).toString('hex')}`
  const b = req.body
  db.prepare('INSERT INTO users (id, app, name, role, companies, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    req.appId,
    b.name!.trim(),
    b.role,
    b.role === 'admin' || !b.companies ? null : JSON.stringify(b.companies),
    sha256(token),
    new Date().toISOString()
  )
  return { ...publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown>), token }
})

app.patch<{ Params: { app: string; id: string }; Body: UserBody }>('/api/:app/users/:id', { preHandler: adminOnly }, async (req, reply) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ? AND app = ?').get(req.params.id, req.appId) as Record<string, unknown> | undefined
  if (!row) return reply.code(404).send({ error: 'not found' })
  const merged: UserBody = {
    name: req.body?.name ?? String(row.name),
    role: req.body?.role ?? (row.role as Role),
    companies: req.body?.companies !== undefined ? req.body.companies : row.companies ? JSON.parse(String(row.companies)) : null,
    disabled: req.body?.disabled ?? !!row.disabled
  }
  const err = validUser(merged)
  if (err) return reply.code(400).send({ error: err })
  db.prepare('UPDATE users SET name = ?, role = ?, companies = ?, disabled = ? WHERE id = ?').run(
    merged.name!.trim(),
    merged.role,
    merged.role === 'admin' || !merged.companies ? null : JSON.stringify(merged.companies),
    merged.disabled ? 1 : 0,
    req.params.id
  )
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as Record<string, unknown>)
})

app.post<{ Params: { app: string; id: string } }>('/api/:app/users/:id/rotate', { preHandler: adminOnly }, async (req, reply) => {
  const token = `inno_${randomBytes(24).toString('hex')}`
  const r = db.prepare('UPDATE users SET token_hash = ? WHERE id = ? AND app = ?').run(sha256(token), req.params.id, req.appId)
  if (!r.changes) return reply.code(404).send({ error: 'not found' })
  return { token }
})

app.delete<{ Params: { app: string; id: string } }>('/api/:app/users/:id', { preHandler: adminOnly }, async (req) => {
  db.prepare('DELETE FROM users WHERE id = ? AND app = ?').run(req.params.id, req.appId)
  db.prepare('DELETE FROM push_devices WHERE user_id = ?').run(req.params.id)
  return { ok: true }
})

// ---------------- sync ----------------

const upsert = db.prepare(`
  INSERT INTO records (app, tbl, id, company_id, updated_at, deleted, data, author)
  VALUES (@app, @tbl, @id, @company_id, @updated_at, @deleted, @data, @author)
  ON CONFLICT(app, tbl, id) DO UPDATE SET
    seq = (SELECT IFNULL(MAX(seq), 0) + 1 FROM records),
    company_id = excluded.company_id, updated_at = excluded.updated_at, deleted = excluded.deleted,
    data = excluded.data, author = excluded.author
  WHERE excluded.updated_at > records.updated_at
`)

app.post<{ Params: { app: string }; Body: { changes?: Record<string, Record<string, unknown>[]> } }>(
  '/api/:app/sync/push',
  { preHandler: auth },
  async (req, reply) => {
    const p = req.principal!
    const changes = req.body?.changes
    if (!changes || typeof changes !== 'object') return reply.code(400).send({ error: 'changes required' })
    const writable = WRITABLE[p.role]
    let applied = 0
    let rejected = 0
    const newCritical: Record<string, unknown>[] = []
    db.transaction(() => {
      for (const [tbl, rows] of Object.entries(changes)) {
        if (!TABLES.has(tbl) || !Array.isArray(rows)) continue
        for (const row of rows) {
          const id = String(row.id ?? '')
          const companyId = tbl === 'companies' ? id : row.company_id ? String(row.company_id) : null
          const allowed = (writable === 'all' || writable.has(tbl)) && canSeeCompany(p, companyId)
          if (!SAFE_ID.test(id) || typeof row.updated_at !== 'string' || !allowed) {
            rejected++
            continue
          }
          const existed = db.prepare('SELECT 1 FROM records WHERE app = ? AND tbl = ? AND id = ?').get(req.appId, tbl, id)
          const r = upsert.run({
            app: req.appId,
            tbl,
            id,
            company_id: companyId,
            updated_at: row.updated_at,
            deleted: row.deleted ? 1 : 0,
            data: JSON.stringify(row),
            author: p.name
          })
          applied += r.changes
          if (r.changes && !existed && tbl === 'alerts' && row.severity === 'critical' && !row.resolved) newCritical.push(row)
        }
      }
    })()
    for (const a of newCritical) void notify(req.appId!, a.company_id ? String(a.company_id) : null, '⚠️ Azim Command', String(a.title))
    return { ok: true, applied, rejected }
  }
)

app.get<{ Params: { app: string }; Querystring: { since?: string } }>('/api/:app/sync/pull', { preHandler: auth }, async (req) => {
  const p = req.principal!
  const since = Number.parseInt(req.query.since ?? '0', 10) || 0
  const rows = db.prepare('SELECT seq, tbl, company_id, data FROM records WHERE app = ? AND seq > ? ORDER BY seq LIMIT 5000').all(req.appId, since) as {
    seq: number
    tbl: string
    company_id: string | null
    data: string
  }[]
  const changes: Record<string, unknown[]> = {}
  for (const r of rows) {
    if (HIDDEN[p.role].has(r.tbl) || !canSeeCompany(p, r.company_id)) continue
    ;(changes[r.tbl] ??= []).push(JSON.parse(r.data))
  }
  const last = rows.length ? rows[rows.length - 1].seq : since
  return { serverTime: String(last), changes, more: rows.length === 5000 }
})

// ---------------- files ----------------

function documentCompany(appId: string, id: string): string | null | undefined {
  const row = db.prepare("SELECT company_id FROM records WHERE app = ? AND tbl = 'documents' AND id = ?").get(appId, id) as
    | { company_id: string | null }
    | undefined
  return row ? row.company_id : undefined
}

app.put<{ Params: { app: string; id: string } }>('/api/:app/files/:id', { preHandler: auth }, async (req, reply) => {
  const { id } = req.params
  const p = req.principal!
  if (!SAFE_ID.test(id)) return reply.code(400).send({ error: 'bad id' })
  const companyId = documentCompany(req.appId!, id)
  const writable = WRITABLE[p.role]
  if (companyId === undefined || !(writable === 'all' || writable.has('documents')) || !canSeeCompany(p, companyId)) {
    return reply.code(403).send({ error: 'forbidden' })
  }
  const body = req.body as Buffer
  if (!Buffer.isBuffer(body)) return reply.code(400).send({ error: 'binary body required' })
  const target = join(DATA_DIR, 'files', req.appId!, id)
  await writeFile(`${target}.part`, body)
  await rename(`${target}.part`, target)
  return { ok: true, size: body.length }
})

app.get<{ Params: { app: string; id: string } }>('/api/:app/files/:id', { preHandler: auth }, async (req, reply) => {
  const { id } = req.params
  const target = join(DATA_DIR, 'files', req.appId!, id)
  const companyId = SAFE_ID.test(id) ? documentCompany(req.appId!, id) : undefined
  if (companyId === undefined || !canSeeCompany(req.principal!, companyId) || !existsSync(target)) {
    return reply.code(404).send({ error: 'not found' })
  }
  reply.header('Content-Length', statSync(target).size)
  return reply.type('application/octet-stream').send(createReadStream(target))
})

// ---------------- read API (mobile) ----------------

app.get<{ Params: { app: string; table: string }; Querystring: { companyId?: string; limit?: string } }>(
  '/api/:app/data/:table',
  { preHandler: auth },
  async (req, reply) => {
    const p = req.principal!
    const { table } = req.params
    if (!TABLES.has(table) || HIDDEN[p.role].has(table)) return reply.code(404).send({ error: 'unknown table' })
    const limit = Math.min(Number.parseInt(req.query.limit ?? '500', 10) || 500, 5000)
    const rows = (
      req.query.companyId
        ? db
            .prepare('SELECT company_id, data FROM records WHERE app = ? AND tbl = ? AND company_id = ? AND deleted = 0 ORDER BY updated_at DESC LIMIT ?')
            .all(req.appId, table, req.query.companyId, limit)
        : db
            .prepare('SELECT company_id, data FROM records WHERE app = ? AND tbl = ? AND deleted = 0 ORDER BY updated_at DESC LIMIT ?')
            .all(req.appId, table, limit)
    ) as { company_id: string | null; data: string }[]
    return rows.filter((r) => canSeeCompany(p, r.company_id)).map((r) => JSON.parse(r.data))
  }
)

// ---------------- push notifications (Expo) ----------------

app.post<{ Params: { app: string }; Body: { token?: string; platform?: string } }>(
  '/api/:app/push/register',
  { preHandler: auth },
  async (req, reply) => {
    const token = req.body?.token ?? ''
    if (!/^ExponentPushToken\[[\w-]+\]$/.test(token)) return reply.code(400).send({ error: 'bad expo token' })
    db.prepare('INSERT OR REPLACE INTO push_devices (token, app, user_id, platform, created_at) VALUES (?, ?, ?, ?, ?)').run(
      token,
      req.appId,
      req.principal!.id,
      String(req.body?.platform ?? ''),
      new Date().toISOString()
    )
    return { ok: true }
  }
)

async function notify(appId: string, companyId: string | null, title: string, body: string): Promise<void> {
  const devices = db.prepare('SELECT token, user_id FROM push_devices WHERE app = ?').all(appId) as { token: string; user_id: string }[]
  const targets = devices.filter((d) => {
    if (d.user_id === 'owner') return true
    const u = db.prepare('SELECT role, companies FROM users WHERE id = ? AND disabled = 0').get(d.user_id) as
      | { role: Role; companies: string | null }
      | undefined
    if (!u) return false
    return canSeeCompany({ id: d.user_id, name: '', role: u.role, companies: u.companies ? JSON.parse(u.companies) : null }, companyId)
  })
  if (!targets.length) return
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(targets.map((t) => ({ to: t.token, title, body, sound: 'default', data: { companyId } })))
    })
  } catch (e) {
    app.log.warn(e, 'push failed')
  }
}

// Daily: push reminders that are due soon (each reminder/due date once).
function checkReminders(): void {
  for (const appId of APPS) {
    const rows = db.prepare("SELECT company_id, data FROM records WHERE app = ? AND tbl = 'reminders' AND deleted = 0").all(appId) as {
      company_id: string | null
      data: string
    }[]
    const today = new Date().toISOString().slice(0, 10)
    for (const r of rows) {
      const rem = JSON.parse(r.data) as { id: string; title: string; due_date: string; remind_days: number; status: string }
      if (rem.status !== 'open' || !rem.due_date) continue
      const days = Math.round((Date.parse(rem.due_date) - Date.parse(today)) / 86_400_000)
      if (days > (rem.remind_days ?? 7)) continue
      const key = `${appId}:${rem.id}:${rem.due_date}`
      if (db.prepare('SELECT 1 FROM push_sent WHERE key = ?').get(key)) continue
      db.prepare('INSERT INTO push_sent (key, sent_at) VALUES (?, ?)').run(key, new Date().toISOString())
      void notify(appId, r.company_id, '⏰ Azim Command', `${rem.title} — ${rem.due_date}`)
    }
  }
}
setInterval(checkReminders, 6 * 60 * 60 * 1000)
setTimeout(checkReminders, 30_000)

if (!OWNER_TOKENS.length) app.log.warn('INNO_OWNER_TOKENS is empty: nobody can sign in until it is set')
if (!PUBLISH_TOKEN) app.log.warn('INNO_PUBLISH_TOKEN is empty: publishing releases is disabled')

app.listen({ port: PORT, host: HOST }).catch((e) => {
  app.log.error(e)
  process.exit(1)
})

