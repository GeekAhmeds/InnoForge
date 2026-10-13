// PIN lock. The app locks on start (when enabled) and after the system has
// been idle for the configured minutes. While locked, the IPC layer rejects
// every call except unlocking.
import { powerMonitor } from 'electron'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { broadcast } from './events'
import { getSecret, getSettings, setSecret } from './settings'

let locked = false
let failures = 0
let blockedUntil = 0

export const isLocked = (): boolean => locked

function setLocked(v: boolean): void {
  locked = v
  broadcast('lock:changed', locked)
}

export function lockNow(): void {
  if (getSettings().lock.enabled && getSecret('pin')) setLocked(true)
}

function hash(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 })
}

export function setPin(pin: string): void {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must be 4-8 digits')
  const salt = randomBytes(16)
  setSecret('pin', `${salt.toString('hex')}:${hash(pin, salt).toString('hex')}`)
}

export function clearPin(): void {
  setSecret('pin', '')
  setLocked(false)
}

export function verifyPin(pin: string): boolean {
  const stored = getSecret('pin')
  if (!stored) return true
  const [salt, digest] = stored.split(':')
  const actual = hash(pin, Buffer.from(salt, 'hex'))
  return timingSafeEqual(actual, Buffer.from(digest, 'hex'))
}

/** waitSeconds > 0 means too many failed attempts: try again later. */
export function unlock(pin: string): { ok: boolean; waitSeconds: number } {
  if (Date.now() < blockedUntil) return { ok: false, waitSeconds: Math.ceil((blockedUntil - Date.now()) / 1000) }
  if (verifyPin(pin)) {
    failures = 0
    setLocked(false)
    return { ok: true, waitSeconds: 0 }
  }
  failures++
  // Back off after repeated failures: 5 tries, then 30s, 60s, 120s...
  if (failures >= 5) blockedUntil = Date.now() + 30_000 * 2 ** Math.min(failures - 5, 6)
  return { ok: false, waitSeconds: Date.now() < blockedUntil ? Math.ceil((blockedUntil - Date.now()) / 1000) : 0 }
}

export function startLockWatcher(): void {
  lockNow()
  powerMonitor.on('lock-screen', lockNow)
  powerMonitor.on('suspend', lockNow)
  setInterval(() => {
    const { enabled, idleMinutes } = getSettings().lock
    if (enabled && !locked && idleMinutes > 0 && powerMonitor.getSystemIdleTime() >= idleMinutes * 60) lockNow()
  }, 15_000)
}
