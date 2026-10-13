// Azim Command server
//  - /updates/<os>/...        electron-builder update feed (latest.yml + installers)
//  - /api/releases            CI publishes new versions here; clients are notified instantly
//  - /api/events              server-sent events (release announcements)
//  - /api/sync/push|pull      replica of every desktop database (last-write-wins)
//  - /api/files/:id           original documents, for other devices and the mobile app
//  - /api/data/:table         read API for the mobile app
// Developed by Inno Source For Software Solutions.
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import fastifyStatic from '@fastify/static'
import Database from 'better-sqlite3'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { timingSafeEqual } from 'node:crypto'

const PORT = Number(process.env.PORT ?? 9991)
const HOST = process.env.HOST ?? '0.0.0.0'
const DATA_DIR = resolve(process.env.DATA_DIR ?? './data')
const TOKENS = (process.env.AZIM_TOKENS ?? '').split(',').map((t) => t.trim()).filter(Boolean)
const ADMIN_TOKEN = process.env.AZIM_ADMIN_TOKEN ?? ''
const MAX_UPLOAD = 1024 * 1024 * 1024 // 1 GB (installers, large scans)

const FILES_DIR = join(DATA_DIR, 'files')
const UPDATES_DIR = join(DATA_DIR, 'updates')
for (const d of [DATA_DIR, FILES_DIR, UPDATES_DIR, ...['win', 'linux', 'mac'].map((o) => join(UPDATES_DIR, o))]) {
  mkdirSync(d, { recursive: true })
}

const TABLES = new Set(['companies', 'documents', 'metrics', 'alerts', 'decisions', 'reports'])
const OSES = new Set(['win', 'linux', 'mac'])
const SAFE_ID = /^[\w-]{1,64}$/
const SAFE_FILE = /^[\w .()+-]{1,200}$/

const db = new Database(join(DATA_DIR, 'azim-server.db'))
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    tbl TEXT NOT NULL,
    id TEXT NOT NULL,
    company_id TEXT,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL,
    device TEXT,
    UNIQUE (tbl, id)
  );
  CREATE INDEX IF NOT EXISTS idx_records_tbl ON records(tbl, company_id);
  CREATE TABLE IF NOT EXISTS releases (
    os TEXT NOT NULL,
    version TEXT NOT NULL,
    published_at TEXT NOT NULL,
    PRIMARY KEY (os, version)
  );
`)

const app = Fastify({ logger: true, bodyLimit: MAX_UPLOAD, trustProxy: true })
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body))

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function bearer(req: FastifyRequest): string {
  const h = req.headers.authorization ?? ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

async function requireDevice(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = bearer(req)
  if (!token || !TOKENS.some((t) => safeEqual(t, token))) {
    await reply.code(401).send({ error: 'unauthorized' })
  }
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = bearer(req)
  if (!ADMIN_TOKEN || !token || !safeEqual(ADMIN_TOKEN, token)) {
    await reply.code(401).send({ error: 'unauthorized' })
  }
}

// ---------------- events (SSE) ----------------

const listeners = new Set<FastifyReply>()

function announce(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const reply of listeners) reply.raw.write(payload)
}

app.get('/api/events', (req, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  reply.raw.write(`event: hello\ndata: ${JSON.stringify({ latest: latestReleases() })}\n\n`)
  listeners.add(reply)
  const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000)
  req.raw.on('close', () => {
    clearInterval(ping)
    listeners.delete(reply)
  })
})

// ---------------- health ----------------

app.get('/api/health', async () => ({ ok: true, name: 'Azim Command server', time: new Date().toISOString(), latest: latestReleases() }))

// ---------------- releases & update feed ----------------

function latestReleases(): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const os of OSES) {
    const row = db.prepare('SELECT version FROM releases WHERE os = ? ORDER BY published_at DESC LIMIT 1').get(os) as
      | { version: string }
      | undefined
    out[os] = row?.version ?? null
  }
  return out
}

app.register(fastifyStatic, { root: UPDATES_DIR, prefix: '/updates/', decorateReply: false, cacheControl: false })

app.get('/api/releases', async () => ({
  latest: latestReleases(),
  history: db.prepare('SELECT * FROM releases ORDER BY published_at DESC LIMIT 50').all()
}))

// CI uploads every artifact with PUT, the update manifest (latest*.yml) last.
// Writing the manifest is what makes the release live, so it is written
// atomically and then announced to every connected app.
app.put<{ Params: { os: string; file: string } }>(
  '/api/releases/:os/:file',
  { preHandler: requireAdmin },
  async (req, reply) => {
    const { os, file } = req.params
    if (!OSES.has(os) || !SAFE_FILE.test(file) || file.startsWith('.')) return reply.code(400).send({ error: 'bad path' })
    const body = req.body as Buffer
    if (!Buffer.isBuffer(body) || !body.length) return reply.code(400).send({ error: 'empty body' })
    const target = join(UPDATES_DIR, os, file)
    await writeFile(`${target}.part`, body)
    await rename(`${target}.part`, target)
    if (/^latest.*\.yml$/.test(file)) {
      const version = /^version:\s*(.+)$/m.exec(body.toString('utf8'))?.[1]?.trim() ?? 'unknown'
      db.prepare('INSERT OR REPLACE INTO releases (os, version, published_at) VALUES (?, ?, ?)').run(os, version, new Date().toISOString())
      announce('release', { os, version })
      req.log.info({ os, version }, 'release published')
    }
    return { ok: true, file, size: body.length }
  }
)

// Remove old artifacts, keeping the files referenced by the current manifest.
app.post<{ Params: { os: string } }>('/api/releases/:os/prune', { preHandler: requireAdmin }, async (req, reply) => {
  const { os } = req.params
  if (!OSES.has(os)) return reply.code(400).send({ error: 'bad os' })
  const dir = join(UPDATES_DIR, os)
  const manifests = readdirSync(dir).filter((f) => /^latest.*\.yml$/.test(f))
  const keep = new Set(manifests)
  for (const m of manifests) {
    for (const match of readFileSync(join(dir, m), 'utf8').matchAll(/(?:url|path):\s*(.+)/g)) {
      const name = decodeURIComponent(match[1].trim())
      keep.add(name)
      keep.add(`${name}.blockmap`)
    }
  }
  const removed: string[] = []
  for (const f of readdirSync(dir)) {
    if (!keep.has(f)) {
      unlinkSync(join(dir, f))
      removed.push(f)
    }
  }
  return { removed }
})

// ---------------- sync ----------------

interface PushBody {
  changes: Record<string, Record<string, unknown>[]>
}

const upsert = db.prepare(`
  INSERT INTO records (tbl, id, company_id, updated_at, deleted, data, device)
  VALUES (@tbl, @id, @company_id, @updated_at, @deleted, @data, @device)
  ON CONFLICT(tbl, id) DO UPDATE SET
    seq = (SELECT IFNULL(MAX(seq), 0) + 1 FROM records),
    company_id = excluded.company_id, updated_at = excluded.updated_at, deleted = excluded.deleted,
    data = excluded.data, device = excluded.device
  WHERE excluded.updated_at > records.updated_at
`)

app.post<{ Body: PushBody }>('/api/sync/push', { preHandler: requireDevice }, async (req, reply) => {
  const changes = req.body?.changes
  if (!changes || typeof changes !== 'object') return reply.code(400).send({ error: 'changes required' })
  const device = String(req.headers['x-device-id'] ?? '').slice(0, 100)
  let applied = 0
  db.transaction(() => {
    for (const [tbl, rows] of Object.entries(changes)) {
      if (!TABLES.has(tbl) || !Array.isArray(rows)) continue
      for (const row of rows) {
        const id = String(row.id ?? '')
        if (!SAFE_ID.test(id) || typeof row.updated_at !== 'string') continue
        const companyId = tbl === 'companies' ? id : row.company_id ? String(row.company_id) : null
        const r = upsert.run({
          tbl,
          id,
          company_id: companyId,
          updated_at: row.updated_at,
          deleted: row.deleted ? 1 : 0,
          data: JSON.stringify(row),
          device
        })
        applied += r.changes
      }
    }
  })()
  return { ok: true, applied }
})

app.get<{ Querystring: { since?: string } }>('/api/sync/pull', { preHandler: requireDevice }, async (req) => {
  const since = Number.parseInt(req.query.since ?? '0', 10) || 0
  const rows = db.prepare('SELECT seq, tbl, data FROM records WHERE seq > ? ORDER BY seq LIMIT 5000').all(since) as {
    seq: number
    tbl: string
    data: string
  }[]
  const changes: Record<string, unknown[]> = {}
  for (const r of rows) (changes[r.tbl] ??= []).push(JSON.parse(r.data))
  const last = rows.length ? rows[rows.length - 1].seq : since
  return { serverTime: String(last), changes, more: rows.length === 5000 }
})

// ---------------- files ----------------

app.put<{ Params: { id: string } }>('/api/files/:id', { preHandler: requireDevice }, async (req, reply) => {
  const { id } = req.params
  if (!SAFE_ID.test(id)) return reply.code(400).send({ error: 'bad id' })
  const body = req.body as Buffer
  if (!Buffer.isBuffer(body)) return reply.code(400).send({ error: 'binary body required' })
  const target = join(FILES_DIR, id)
  await writeFile(`${target}.part`, body)
  await rename(`${target}.part`, target)
  return { ok: true, size: body.length }
})

app.get<{ Params: { id: string } }>('/api/files/:id', { preHandler: requireDevice }, async (req, reply) => {
  const { id } = req.params
  const target = join(FILES_DIR, id)
  if (!SAFE_ID.test(id) || !existsSync(target)) return reply.code(404).send({ error: 'not found' })
  reply.header('Content-Length', statSync(target).size)
  return reply.type('application/octet-stream').send(createReadStream(target))
})

// ---------------- read API (mobile app) ----------------

app.get<{ Params: { table: string }; Querystring: { companyId?: string; limit?: string } }>(
  '/api/data/:table',
  { preHandler: requireDevice },
  async (req, reply) => {
    const { table } = req.params
    if (!TABLES.has(table)) return reply.code(404).send({ error: 'unknown table' })
    const limit = Math.min(Number.parseInt(req.query.limit ?? '500', 10) || 500, 5000)
    const rows = (
      req.query.companyId
        ? db
            .prepare('SELECT data FROM records WHERE tbl = ? AND company_id = ? AND deleted = 0 ORDER BY updated_at DESC LIMIT ?')
            .all(table, req.query.companyId, limit)
        : db.prepare('SELECT data FROM records WHERE tbl = ? AND deleted = 0 ORDER BY updated_at DESC LIMIT ?').all(table, limit)
    ) as { data: string }[]
    return rows.map((r) => JSON.parse(r.data))
  }
)

if (!TOKENS.length) app.log.warn('AZIM_TOKENS is empty: sync endpoints will reject every request')
if (!ADMIN_TOKEN) app.log.warn('AZIM_ADMIN_TOKEN is empty: publishing releases is disabled')

app.listen({ port: PORT, host: HOST }).catch((e) => {
  app.log.error(e)
  process.exit(1)
})
