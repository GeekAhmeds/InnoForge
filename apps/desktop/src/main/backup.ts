// Encrypted backups: database + every company's file vault + generated
// reports in one file, compressed and encrypted with AES-256-GCM using a key
// derived from the backup password (scrypt). Wrong password or a tampered
// file fails the GCM check and nothing is restored.
//
// File layout: "AZIMBK01" | salt(16) | iv(12) | ciphertext | tag(16)
// Plaintext (gzip): repeated [u32 headerLen][header JSON {path,size}][bytes], then u32 0.
import { app } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, statSync, writeSync } from 'fs'
import { appendFile, open, readdir, rename, rm, unlink } from 'fs/promises'
import { dirname, join, relative, resolve, sep } from 'path'
import { pipeline } from 'stream/promises'
import { Writable } from 'stream'
import { createGunzip, createGzip } from 'zlib'
import { getDb } from './db'
import { dataDir, reportsDir } from './paths'
import { getSecret, getSettings, updateSettings } from './settings'

const MAGIC = Buffer.from('AZIMBK01')
const HEADER = MAGIC.length + 16 + 12

const deriveKey = (password: string, salt: Buffer): Buffer => scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
}

async function* archive(entries: { path: string; file: string }[]): AsyncGenerator<Buffer> {
  for (const e of entries) {
    const header = Buffer.from(JSON.stringify({ path: e.path, size: statSync(e.file).size }))
    const len = Buffer.alloc(4)
    len.writeUInt32BE(header.length)
    yield Buffer.concat([len, header])
    for await (const chunk of createReadStream(e.file)) yield chunk as Buffer
  }
  yield Buffer.alloc(4) // terminator
}

export async function createBackup(target: string, password: string): Promise<{ path: string; size: number }> {
  if (password.length < 8) throw new Error('Backup password must be at least 8 characters')
  const snapshot = join(dataDir(), `backup-snapshot-${Date.now()}.db`)
  await getDb().backup(snapshot) // consistent copy while the app keeps running
  try {
    const entries = [
      { path: 'data/azim.db', file: snapshot },
      ...walk(join(dataDir(), 'vault')).map((f) => ({ path: `data/${relative(dataDir(), f).split(sep).join('/')}`, file: f })),
      ...walk(reportsDir()).map((f) => ({ path: `reports/${relative(reportsDir(), f).split(sep).join('/')}`, file: f }))
    ]
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv)
    mkdirSync(dirname(target), { recursive: true })
    const partial = `${target}.part`
    const out = createWriteStream(partial)
    out.write(Buffer.concat([MAGIC, salt, iv]))
    await pipeline(archive(entries), createGzip(), cipher, out)
    await appendFile(partial, cipher.getAuthTag())
    await rename(partial, target)
    return { path: target, size: statSync(target).size }
  } finally {
    await unlink(snapshot).catch(() => undefined)
  }
}

/** Parses the archive stream and writes entries under `dest`. */
class Extractor extends Writable {
  private buf = Buffer.alloc(0)
  private current: { remaining: number; fd: number } | null = null
  private finishedArchive = false
  constructor(private dest: string) {
    super()
  }

  _write(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    try {
      this.buf = Buffer.concat([this.buf, chunk])
      this.drain()
      cb()
    } catch (e) {
      cb(e as Error)
    }
  }

  private drain(): void {
    for (;;) {
      if (this.finishedArchive) return
      if (this.current) {
        const take = Math.min(this.current.remaining, this.buf.length)
        if (take) writeSync(this.current.fd, this.buf.subarray(0, take))
        this.buf = this.buf.subarray(take)
        this.current.remaining -= take
        if (this.current.remaining > 0) return
        closeSync(this.current.fd)
        this.current = null
        continue
      }
      if (this.buf.length < 4) return
      const len = this.buf.readUInt32BE(0)
      if (len === 0) {
        this.finishedArchive = true
        return
      }
      if (this.buf.length < 4 + len) return
      const header = JSON.parse(this.buf.subarray(4, 4 + len).toString()) as { path: string; size: number }
      this.buf = this.buf.subarray(4 + len)
      const target = resolve(this.dest, header.path)
      if (!target.startsWith(resolve(this.dest) + sep)) throw new Error('Invalid path in backup')
      mkdirSync(dirname(target), { recursive: true })
      this.current = { remaining: header.size, fd: openSync(target, 'w') }
      if (header.size === 0) {
        closeSync(this.current.fd)
        this.current = null
      }
    }
  }
}

/** Decrypts and verifies into a staging folder; returns it for applyRestore. */
export async function verifyAndStage(file: string, password: string): Promise<string> {
  const size = statSync(file).size
  const fh = await open(file, 'r')
  const head = Buffer.alloc(HEADER)
  const tag = Buffer.alloc(16)
  await fh.read(head, 0, HEADER, 0)
  await fh.read(tag, 0, 16, size - 16)
  await fh.close()
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an Azim Command backup file')
  const salt = head.subarray(MAGIC.length, MAGIC.length + 16)
  const iv = head.subarray(MAGIC.length + 16, HEADER)
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv)
  decipher.setAuthTag(tag)
  const staging = join(app.getPath('userData'), `restore-${Date.now()}`)
  mkdirSync(staging, { recursive: true })
  try {
    await pipeline(createReadStream(file, { start: HEADER, end: size - 17 }), decipher, createGunzip(), new Extractor(staging))
  } catch (e) {
    await rm(staging, { recursive: true, force: true })
    const msg = (e as Error).message
    throw new Error(/auth|unable to authenticate|incorrect header|unexpected end/i.test(msg) ? 'Wrong password or damaged backup file' : msg)
  }
  return staging
}

/** Swap the staged data in and relaunch. The previous data is kept aside. */
export async function applyRestore(staging: string): Promise<void> {
  getDb().close()
  const current = dataDir()
  await rename(current, `${current}-before-restore-${Date.now()}`)
  await rename(join(staging, 'data'), current)
  const stagedReports = join(staging, 'reports')
  if (existsSync(stagedReports)) {
    for (const f of await readdir(stagedReports, { recursive: true, withFileTypes: true })) {
      if (!f.isFile()) continue
      const src = join(f.parentPath, f.name)
      const dest = join(reportsDir(), relative(stagedReports, src))
      mkdirSync(dirname(dest), { recursive: true })
      if (!existsSync(dest)) await rename(src, dest)
    }
  }
  await rm(staging, { recursive: true, force: true })
  app.relaunch()
  app.exit(0)
}

export async function runAutoBackup(force = false): Promise<string | null> {
  const b = getSettings().backup
  const password = getSecret('backup')
  if (!b.enabled || !b.folder || !password) return null
  if (!force && b.lastAt && Date.now() - Date.parse(b.lastAt) < b.intervalHours * 3_600_000) return null
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const { path } = await createBackup(join(b.folder, `AzimCommand-Backup-${stamp}.azimbak`), password)
  updateSettings({ backup: { lastAt: new Date().toISOString() } })
  const old = readdirSync(b.folder)
    .filter((f) => /^AzimCommand-Backup-.*\.azimbak$/.test(f))
    .sort()
    .reverse()
    .slice(Math.max(1, b.keepLast))
  for (const f of old) await unlink(join(b.folder, f)).catch(() => undefined)
  return path
}
