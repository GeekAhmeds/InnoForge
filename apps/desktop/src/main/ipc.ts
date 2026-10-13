import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { resolve } from 'path'
import * as repo from './repo'
import { importFiles, reprocess } from './ingest'
import { SUPPORTED_EXTENSIONS } from './ingest/extractors'
import { getCompanyDashboard, getOverview, runChecks, search } from './insights'
import * as chat from './ai/chat'
import { complete } from './ai/providers'
import { getSettings, setApiKey, updateSettings } from './settings'
import { getSyncStatus, startSync, syncNow } from './sync'
import { checkForUpdates, getUpdateStatus, installUpdate } from './updater'
import { refreshWatchers } from './watcher'
import { reportsDir } from './paths'
import type { ImportSummary } from '@shared/api'
import type { ProviderId, Settings } from '@shared/types'

function summarize(r: Awaited<ReturnType<typeof importFiles>>): ImportSummary {
  return { imported: r.imported.length, duplicates: r.duplicates, failed: r.failed }
}

// Only open files that live in the vault or the reports folder.
function isAppFile(path: string): boolean {
  const p = resolve(path)
  return p.startsWith(resolve(reportsDir())) || repo.listReports().some((r) => resolve(r.path) === p)
}

export function registerIpc(): void {
  const h = ipcMain.handle.bind(ipcMain)

  h('companies:list', () => repo.listCompanies())
  h('companies:save', (_, input) => {
    const c = repo.saveCompany(input)
    refreshWatchers()
    return c
  })
  h('companies:remove', (_, id: string) => {
    repo.deleteCompany(id)
    refreshWatchers()
  })
  h('companies:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  h('documents:list', (_, filter) => repo.listDocuments(filter ?? {}))
  h('documents:pickAndImport', async (e, companyId: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)!
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported files', extensions: SUPPORTED_EXTENSIONS.map((x) => x.slice(1)) },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (r.canceled) return { imported: 0, duplicates: [], failed: [] }
    return summarize(await importFiles(companyId, r.filePaths))
  })
  h('documents:importPaths', async (_, companyId: string, paths: string[]) => summarize(await importFiles(companyId, paths)))
  h('documents:update', (_, id: string, patch) => repo.updateDocument(id, patch))
  h('documents:remove', (_, id: string) => repo.deleteDocument(id))
  h('documents:reprocess', (_, id: string) => reprocess(id))
  h('documents:open', async (_, id: string) => {
    const d = repo.getDocument(id)
    if (d) await shell.openPath(d.storedPath)
  })
  h('documents:reveal', (_, id: string) => {
    const d = repo.getDocument(id)
    if (d) shell.showItemInFolder(d.storedPath)
  })
  h('documents:sheets', (_, id: string) => repo.listDocumentSheets(id))
  h('documents:table', (_, id: string, sheet?: string) => repo.getDocumentTable(id, sheet))
  h('documents:text', (_, id: string) => repo.getDocumentText(id))

  h('search', (_, q: string, companyId?: string) => search(q, companyId))

  h('dashboard:overview', () => getOverview())
  h('dashboard:company', (_, id: string) => getCompanyDashboard(id))

  h('metrics:list', (_, companyId: string) => repo.listMetrics({ companyId }))
  h('metrics:save', (_, m) => {
    const saved = repo.upsertMetric(m)
    runChecks(m.companyId)
    return saved
  })
  h('metrics:remove', (_, id: string) => repo.deleteMetric(id))

  h('alerts:list', (_, companyId?: string) => repo.listAlerts({ companyId }))
  h('alerts:resolve', (_, id: string) => repo.resolveAlert(id))

  h('decisions:list', (_, companyId?: string) => repo.listDecisions(companyId))
  h('decisions:save', (_, input) => repo.saveDecision(input))
  h('decisions:remove', (_, id: string) => repo.deleteDecision(id))

  h('reports:list', (_, companyId?: string) => repo.listReports(companyId))
  h('reports:open', async (_, path: string) => {
    if (isAppFile(path)) await shell.openPath(path)
  })
  h('reports:reveal', (_, path: string) => {
    if (isAppFile(path)) shell.showItemInFolder(path)
  })

  h('chat:conversations', () => chat.listConversations())
  h('chat:create', (_, companyId: string | null) => chat.createConversation(companyId))
  h('chat:remove', (_, id: string) => chat.deleteConversation(id))
  h('chat:messages', (_, id: string) => chat.listMessages(id))
  h('chat:send', (_, id: string, text: string) => chat.sendMessage(id, text))
  h('chat:cancel', (_, id: string) => chat.cancel(id))

  h('settings:get', () => getSettings())
  h('settings:update', (_, patch: Partial<Settings>) => {
    const before = getSettings()
    const s = updateSettings(patch)
    if (patch.syncEnabled !== undefined && patch.syncEnabled !== before.syncEnabled && s.syncEnabled) startSync()
    return s
  })
  h('settings:setApiKey', (_, provider: ProviderId, key: string) => {
    setApiKey(provider, key.trim())
    return getSettings()
  })
  h('settings:testProvider', async () => {
    try {
      const text = await complete('Reply with the single word: OK', 'ping')
      return { ok: true, message: text.slice(0, 120) || 'OK' }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  })

  h('sync:status', () => getSyncStatus())
  h('sync:now', () => syncNow())

  h('updates:status', () => getUpdateStatus())
  h('updates:check', () => checkForUpdates())
  h('updates:install', () => installUpdate())

  h('app:version', () => app.getVersion())
  h('app:openExternal', async (_, url: string) => {
    if (/^https?:\/\//.test(url)) await shell.openExternal(url)
  })
}
