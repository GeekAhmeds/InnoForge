import { safeStorage } from 'electron'
import { getDb } from './db'
import { DEFAULT_SERVER_URL, type ProviderId, type Settings } from '@shared/types'
import type { SettingsPatch } from '@shared/api'

// Settings that live in the JSON blob. Flags such as hasKey / hasPin are
// derived from the secret store and never persisted.
const DEFAULTS: Settings = {
  language: 'ar',
  theme: 'system',
  activeProvider: 'anthropic',
  providers: {
    anthropic: { enabled: true, model: 'claude-opus-5-5', fastModel: 'claude-haiku-5-5', baseUrl: '', hasKey: false },
    openai: { enabled: false, model: 'gpt-5', fastModel: '', baseUrl: '', hasKey: false },
    gemini: { enabled: false, model: 'gemini-2.5-pro', fastModel: 'gemini-2.5-flash', baseUrl: '', hasKey: false },
    ollama: { enabled: false, model: 'qwen3:14b', fastModel: '', baseUrl: 'http://localhost:11434/v1', hasKey: false },
    compatible: { enabled: false, model: '', fastModel: '', baseUrl: 'https://openrouter.ai/api/v1', hasKey: false }
  },
  agent: { fallback: true, effort: 'high', webSearch: true, maxSteps: 40 },
  autoOrganize: true,
  ocrLanguages: 'ara+eng',
  serverUrl: DEFAULT_SERVER_URL,
  syncEnabled: false,
  syncToken: '',
  lastSyncAt: null,
  anomalyThreshold: 25,
  account: null,
  smtp: { host: '', port: 587, secure: false, user: '', from: '', hasPassword: false },
  whatsapp: { phoneNumberId: '', apiVersion: 'v21.0', templateName: '', templateLanguage: 'ar', hasToken: false },
  reminderRecipients: { emails: [], whatsapp: [] },
  lock: { enabled: false, idleMinutes: 10, hasPin: false },
  backup: { enabled: false, folder: '', intervalHours: 24, keepLast: 14, lastAt: null, hasPassword: false }
}

export type SecretName = `key:${ProviderId}` | 'smtp' | 'whatsapp' | 'backup' | 'pin'

function readRaw(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

function writeRaw(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

export function getSettings(): Settings {
  const raw = readRaw('app')
  const stored = raw ? (JSON.parse(raw) as Partial<Settings>) : {}
  const merged: Settings = {
    ...DEFAULTS,
    ...stored,
    providers: { ...DEFAULTS.providers },
    smtp: { ...DEFAULTS.smtp, ...stored.smtp, hasPassword: !!getSecret('smtp') },
    whatsapp: { ...DEFAULTS.whatsapp, ...stored.whatsapp, hasToken: !!getSecret('whatsapp') },
    reminderRecipients: { ...DEFAULTS.reminderRecipients, ...stored.reminderRecipients },
    agent: { ...DEFAULTS.agent, ...stored.agent },
    lock: { ...DEFAULTS.lock, ...stored.lock, hasPin: !!getSecret('pin') },
    backup: { ...DEFAULTS.backup, ...stored.backup, hasPassword: !!getSecret('backup') }
  }
  for (const id of Object.keys(DEFAULTS.providers) as ProviderId[]) {
    merged.providers[id] = { ...DEFAULTS.providers[id], ...(stored.providers?.[id] ?? {}), hasKey: !!getSecret(`key:${id}`) }
  }
  return merged
}

export type { SettingsPatch }

export function updateSettings(patch: SettingsPatch): Settings {
  const current = getSettings()
  const next: Settings = {
    ...current,
    ...(patch as Partial<Settings>),
    providers: { ...current.providers },
    smtp: { ...current.smtp, ...patch.smtp },
    whatsapp: { ...current.whatsapp, ...patch.whatsapp },
    lock: { ...current.lock, ...patch.lock },
    backup: { ...current.backup, ...patch.backup },
    reminderRecipients: { ...current.reminderRecipients, ...patch.reminderRecipients },
    agent: { ...current.agent, ...patch.agent }
  }
  for (const id of Object.keys(patch.providers ?? {}) as ProviderId[]) {
    next.providers[id] = { ...current.providers[id], ...patch.providers![id] }
  }
  writeRaw('app', JSON.stringify(next))
  return getSettings()
}

// Secrets are encrypted with the OS keychain (DPAPI on Windows, libsecret on
// Linux) and never sent to the renderer.
export function setSecret(name: SecretName, value: string): void {
  const key = `secret:${name}`
  if (!value) {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
    return
  }
  writeRaw(key, encrypt(value))
}

export function getSecret(name: SecretName): string {
  const value = readRaw(`secret:${name}`) ?? (name.startsWith('key:') ? readRaw(name) : undefined) // v0.1 stored keys as "key:<provider>"
  return value ? decrypt(value) : ''
}

export function encrypt(value: string): string {
  return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(value).toString('base64') : 'raw:' + value
}

export function decrypt(value: string): string {
  if (value.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    } catch {
      return ''
    }
  }
  return value.slice(4)
}

export const setApiKey = (provider: ProviderId, key: string): void => setSecret(`key:${provider}`, key)
export const getApiKey = (provider: ProviderId): string => getSecret(`key:${provider}`)
