import { app, dialog, ipcMain, shell, BrowserWindow } from 'electron'
import { resolve } from 'path'
import * as repo from './repo'
import { importFiles, reprocess } from './ingest'
import { SUPPORTED_EXTENSIONS } from './ingest/extractors'
import { getCompanyDashboard, getOverview, runChecks, search } from './insights'
import * as chat from './ai/chat'
import { complete, listModels } from './ai/providers'
import * as agent from './ai/agent'
import { getSettings, setApiKey, setSecret, updateSettings, type SettingsPatch } from './settings'
import { getSyncStatus, startSync, syncNow } from './sync'
import { checkForUpdates, getUpdateStatus, installUpdate } from './updater'
import { refreshWatchers } from './watcher'
import { reportsDir } from './paths'
import * as planning from './planning'
import * as reminders from './reminders'
import * as monthly from './monthly'
import * as connectors from './connectors'
import * as accounts from './accounts'
import * as lock from './lock'
import * as backup from './backup'
import { emailConfigured, sendEmail, sendWhatsApp } from './messaging'
import type { ImportSummary } from '@shared/api'
import type { ProviderId } from '@shared/types'

function summarize(r: Awaited<ReturnType<typeof importFiles>>): ImportSummary {
  return { imported: r.imported.length, duplicates: r.duplicates, failed: r.failed }
}

// Only open files that live in the vault or the reports folder.
function isAppFile(path: string): boolean {
  const p = resolve(path)
  return p.startsWith(resolve(reportsDir())) || repo.listReports().some((r) => resolve(r.path) === p)
}

// Channels usable while the PIN lock is active.
const WHILE_LOCKED = new Set(['lock:status', 'lock:unlock', 'settings:get', 'app:version'])

export function registerIpc(): void {
  // Every handler goes through the lock and role checks.
  const h = (channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (e, ...args) => {
      if (lock.isLocked() && !WHILE_LOCKED.has(channel)) throw new Error('locked')
      if (!accounts.canCall(channel)) throw new Error('forbidden')
      return fn(e, ...args)
    })
  }

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
    if (d?.storedPath) await shell.openPath(d.storedPath)
  })
  h('documents:reveal', (_, id: string) => {
    const d = repo.getDocument(id)
    if (d?.storedPath) shell.showItemInFolder(d.storedPath)
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
  h('settings:update', (_, patch: SettingsPatch) => {
    const before = getSettings()
    // Restricted accounts may only change how the app looks.
    if (!accounts.isAdmin()) patch = { language: patch.language, theme: patch.theme }
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

  h('settings:setSecret', (_, name: 'smtp' | 'whatsapp' | 'backup', value: string) => {
    if (!['smtp', 'whatsapp', 'backup'].includes(name)) throw new Error('bad secret')
    setSecret(name, value)
    return getSettings()
  })

  h('reminders:list', (_, filter) => reminders.listReminders(filter ?? {}))
  h('reminders:save', (_, input) => reminders.saveReminder(input))
  h('reminders:complete', (_, id: string) => reminders.completeReminder(id))
  h('reminders:remove', (_, id: string) => reminders.deleteReminder(id))

  h('budgets:list', (_, companyId: string) => planning.listBudgets(companyId))
  h('budgets:save', (_, b) => {
    const saved = planning.setBudget(b)
    runChecks(b.companyId)
    return saved
  })
  h('budgets:remove', (_, id: string) => planning.deleteBudget(id))
  h('budgets:vsActual', (_, companyId: string, from?: string, to?: string) => planning.budgetVsActual(companyId, from, to))
  h('forecast:history', (_, companyId: string) => planning.forecastHistory(companyId))

  h('schedule:get', (_, companyId: string) => monthly.getSchedule(companyId))
  h('schedule:save', (_, s) => monthly.saveSchedule(s))
  h('schedule:send', async (_, companyId: string, period?: string) => {
    const r = await monthly.sendMonthlyReport(companyId, period)
    return { report: r.report, errors: r.errors }
  })
  h('schedule:preview', (_, companyId: string, period: string) => {
    const s = monthly.getSchedule(companyId)
    return monthly.buildMonthlyReport(companyId, period, s.language, s.format, s.aiSummary)
  })
  h('messaging:test', async (_, channel: 'email' | 'whatsapp', to: string) => {
    try {
      const text = 'Azim Command — test message ✓ (Inno Source For Software Solutions)'
      if (channel === 'email') {
        if (!emailConfigured()) throw new Error('SMTP is not configured')
        await sendEmail([to], 'Azim Command — test', text)
      } else await sendWhatsApp([to], text)
      return { ok: true, message: 'sent' }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  })

  h('connectors:list', (_, companyId?: string) => connectors.listConnectors(companyId))
  h('connectors:save', (_, input) => connectors.saveConnector(input))
  h('connectors:remove', (_, id: string) => connectors.deleteConnector(id))
  h('connectors:test', (_, id: string) => connectors.testConnector(id))
  h('connectors:refresh', (_, id: string) => connectors.refreshConnector(id))
  h('connectors:saveDataset', (_, input) => connectors.saveDataset(input))
  h('connectors:removeDataset', (_, id: string) => connectors.deleteDataset(id))
  h('connectors:preview', async (_, id: string, query: string) => {
    const c = connectors.getConnector(id)
    if (!c) throw new Error('not found')
    const r = await connectors.runQuery(c, query)
    return { columns: r.columns, rows: r.rows.slice(0, 50), total: r.rows.length }
  })
  h('connectors:pickFile', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, {
      properties: ['openFile'],
      filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })

  h('accounts:list', () => accounts.listUsers())
  h('accounts:create', (_, u) => accounts.createUser(u))
  h('accounts:update', (_, id: string, patch) => accounts.updateUser(id, patch))
  h('accounts:rotate', (_, id: string) => accounts.rotateUser(id))
  h('accounts:remove', (_, id: string) => accounts.deleteUser(id))

  h('lock:status', () => lock.isLocked())
  h('lock:unlock', (_, pin: string) => lock.unlock(pin))
  h('lock:lockNow', () => lock.lockNow())
  h('lock:setPin', (_, pin: string, current?: string) => {
    if (getSettings().lock.hasPin && !lock.verifyPin(current ?? '')) throw new Error('wrong current PIN')
    lock.setPin(pin)
    return getSettings()
  })
  h('lock:clearPin', (_, current: string) => {
    if (!lock.verifyPin(current)) throw new Error('wrong current PIN')
    lock.clearPin()
    return updateSettings({ lock: { enabled: false } })
  })

  h('backup:pickFolder', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  h('backup:create', async (e, password: string) => {
    const stamp = new Date().toISOString().slice(0, 10)
    const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender)!, {
      defaultPath: `AzimCommand-Backup-${stamp}.azimbak`,
      filters: [{ name: 'Azim Command backup', extensions: ['azimbak'] }]
    })
    if (r.canceled || !r.filePath) return null
    return backup.createBackup(r.filePath, password)
  })
  h('backup:runNow', () => backup.runAutoBackup(true))
  h('backup:restore', async (e, password: string) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, {
      properties: ['openFile'],
      filters: [{ name: 'Azim Command backup', extensions: ['azimbak'] }]
    })
    if (r.canceled) return false
    const staging = await backup.verifyAndStage(r.filePaths[0], password)
    await backup.applyRestore(staging)
    return true
  })

  h('ai:listModels', (_, provider: ProviderId) => listModels(provider))
  h('memories:list', () => agent.listMemories())
  h('memories:remove', (_, id: string) => agent.forget(id))
  h('tasks:list', () => agent.listTasks())
  h('tasks:save', (_, t) => agent.saveTask(t))
  h('tasks:remove', (_, id: string) => agent.deleteTask(id))
  h('tasks:run', (_, id: string) => agent.runTask(id))

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
