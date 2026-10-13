// Accounts & permissions. Accounts live on the Inno server (so they apply on
// every device); this module manages them and enforces the signed-in role
// locally so the UI and IPC match what the server allows.
import { api } from './sync'
import { getSettings } from './settings'
import type { Role, ServerUser } from '@shared/types'

export function currentRole(): Role {
  const s = getSettings()
  return s.syncEnabled && s.account ? s.account.role : 'owner'
}

export const isAdmin = (): boolean => ['owner', 'admin'].includes(currentRole())

// IPC channels each restricted role may call. Owners and admins may call all.
const ACCOUNTANT = new Set([
  'documents:pickAndImport',
  'documents:importPaths',
  'documents:update',
  'documents:reprocess',
  'reminders:save',
  'reminders:complete'
])

/** Channels that change data; everything else is read-only. */
const MUTATING = /:(save|remove|resolve|update|import|importPaths|pickAndImport|reprocess|complete|refresh|send|setApiKey|setSecret|set|test|create|backup|restore|delete|rotate)/i

export function canCall(channel: string): boolean {
  const role = currentRole()
  if (role === 'owner' || role === 'admin') return true
  if (channel.startsWith('lock:') || channel.startsWith('sync:') || channel.startsWith('updates:') || channel.startsWith('app:')) return true
  if (channel === 'settings:update') return true // language/theme; sensitive keys are filtered in ipc.ts
  if (channel.startsWith('chat:') || channel.startsWith('connectors:') || channel.startsWith('accounts:') || channel.startsWith('backup:') || channel.startsWith('schedule:')) {
    return false
  }
  if (!MUTATING.test(channel)) return true
  return role === 'accountant' && ACCOUNTANT.has(channel)
}

export async function listUsers(): Promise<ServerUser[]> {
  return (await api('/users')).json()
}

export async function createUser(u: { name: string; role: ServerUser['role']; companies: string[] | null }): Promise<ServerUser> {
  return (await api('/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(u) })).json()
}

export async function updateUser(id: string, patch: Partial<Pick<ServerUser, 'name' | 'role' | 'companies' | 'disabled'>>): Promise<ServerUser> {
  return (await api(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })).json()
}

export async function rotateUser(id: string): Promise<{ token: string }> {
  return (await api(`/users/${encodeURIComponent(id)}/rotate`, { method: 'POST' })).json()
}

export async function deleteUser(id: string): Promise<void> {
  await api(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
