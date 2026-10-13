import { safeStorage } from 'electron'
import { getDb } from './db'
import { DEFAULT_SERVER_URL, type ProviderId, type Settings } from '@shared/types'

const DEFAULTS: Settings = {
  language: 'ar',
  theme: 'system',
  activeProvider: 'anthropic',
  providers: {
    anthropic: { enabled: true, model: 'claude-opus-5-5', baseUrl: '', hasKey: false },
    openai: { enabled: false, model: 'gpt-5', baseUrl: '', hasKey: false },
    gemini: { enabled: false, model: 'gemini-2.5-pro', baseUrl: '', hasKey: false },
    ollama: { enabled: false, model: 'qwen3:14b', baseUrl: 'http://localhost:11434/v1', hasKey: false }
  },
  autoOrganize: true,
  ocrLanguages: 'ara+eng',
  serverUrl: DEFAULT_SERVER_URL,
  syncEnabled: false,
  syncToken: '',
  lastSyncAt: null,
  anomalyThreshold: 25
}

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
  const stored = readRaw('app') ? (JSON.parse(readRaw('app')!) as Partial<Settings>) : {}
  const merged: Settings = { ...DEFAULTS, ...stored, providers: { ...DEFAULTS.providers } }
  for (const id of Object.keys(DEFAULTS.providers) as ProviderId[]) {
    merged.providers[id] = { ...DEFAULTS.providers[id], ...(stored.providers?.[id] ?? {}), hasKey: !!getApiKey(id) }
  }
  return merged
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const current = getSettings()
  const next: Settings = { ...current, ...patch, providers: { ...current.providers } }
  if (patch.providers) {
    for (const id of Object.keys(patch.providers) as ProviderId[]) {
      next.providers[id] = { ...current.providers[id], ...patch.providers[id] }
    }
  }
  writeRaw('app', JSON.stringify(next))
  return getSettings()
}

// API keys are encrypted with the OS keychain (DPAPI on Windows, libsecret on
// Linux) and never sent to the renderer.
export function setApiKey(provider: ProviderId, key: string): void {
  const name = `key:${provider}`
  if (!key) {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(name)
    return
  }
  const value = safeStorage.isEncryptionAvailable()
    ? 'enc:' + safeStorage.encryptString(key).toString('base64')
    : 'raw:' + key
  writeRaw(name, value)
}

export function getApiKey(provider: ProviderId): string {
  const value = readRaw(`key:${provider}`)
  if (!value) return ''
  if (value.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    } catch {
      return ''
    }
  }
  return value.slice(4)
}
