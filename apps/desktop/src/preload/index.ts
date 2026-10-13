import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AzimApi } from '@shared/api'

const invoke = (channel: string, ...args: unknown[]): Promise<any> => ipcRenderer.invoke(channel, ...args)

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: AzimApi = {
  companies: {
    list: () => invoke('companies:list'),
    save: (input) => invoke('companies:save', input),
    remove: (id) => invoke('companies:remove', id),
    pickFolder: () => invoke('companies:pickFolder')
  },
  documents: {
    list: (filter) => invoke('documents:list', filter),
    pickAndImport: (companyId) => invoke('documents:pickAndImport', companyId),
    importPaths: (companyId, paths) => invoke('documents:importPaths', companyId, paths),
    update: (id, patch) => invoke('documents:update', id, patch),
    remove: (id) => invoke('documents:remove', id),
    reprocess: (id) => invoke('documents:reprocess', id),
    open: (id) => invoke('documents:open', id),
    reveal: (id) => invoke('documents:reveal', id),
    sheets: (id) => invoke('documents:sheets', id),
    table: (id, sheet) => invoke('documents:table', id, sheet),
    text: (id) => invoke('documents:text', id),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  search: (query, companyId) => invoke('search', query, companyId),
  dashboard: {
    overview: () => invoke('dashboard:overview'),
    company: (id) => invoke('dashboard:company', id)
  },
  metrics: {
    list: (companyId) => invoke('metrics:list', companyId),
    save: (m) => invoke('metrics:save', m),
    remove: (id) => invoke('metrics:remove', id)
  },
  alerts: {
    list: (companyId) => invoke('alerts:list', companyId),
    resolve: (id) => invoke('alerts:resolve', id)
  },
  decisions: {
    list: (companyId) => invoke('decisions:list', companyId),
    save: (input) => invoke('decisions:save', input),
    remove: (id) => invoke('decisions:remove', id)
  },
  reports: {
    list: (companyId) => invoke('reports:list', companyId),
    open: (path) => invoke('reports:open', path),
    reveal: (path) => invoke('reports:reveal', path)
  },
  chat: {
    conversations: () => invoke('chat:conversations'),
    create: (companyId) => invoke('chat:create', companyId),
    remove: (id) => invoke('chat:remove', id),
    messages: (id) => invoke('chat:messages', id),
    send: (id, text) => invoke('chat:send', id, text),
    cancel: (id) => invoke('chat:cancel', id),
    onEvent: (cb) => subscribe('chat:event', cb)
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    setApiKey: (provider, key) => invoke('settings:setApiKey', provider, key),
    setSecret: (name, value) => invoke('settings:setSecret', name, value),
    testProvider: () => invoke('settings:testProvider'),
    testMessaging: (channel, to) => invoke('messaging:test', channel, to)
  },
  reminders: {
    list: (filter) => invoke('reminders:list', filter),
    save: (input) => invoke('reminders:save', input),
    complete: (id) => invoke('reminders:complete', id),
    remove: (id) => invoke('reminders:remove', id)
  },
  planning: {
    budgets: (companyId) => invoke('budgets:list', companyId),
    saveBudget: (b) => invoke('budgets:save', b),
    removeBudget: (id) => invoke('budgets:remove', id),
    budgetVsActual: (companyId, from, to) => invoke('budgets:vsActual', companyId, from, to),
    forecastHistory: (companyId) => invoke('forecast:history', companyId)
  },
  schedule: {
    get: (companyId) => invoke('schedule:get', companyId),
    save: (s) => invoke('schedule:save', s),
    send: (companyId, period) => invoke('schedule:send', companyId, period),
    preview: (companyId, period) => invoke('schedule:preview', companyId, period)
  },
  connectors: {
    list: (companyId) => invoke('connectors:list', companyId),
    save: (input) => invoke('connectors:save', input),
    remove: (id) => invoke('connectors:remove', id),
    test: (id) => invoke('connectors:test', id),
    refresh: (id) => invoke('connectors:refresh', id),
    saveDataset: (input) => invoke('connectors:saveDataset', input),
    removeDataset: (id) => invoke('connectors:removeDataset', id),
    preview: (id, query) => invoke('connectors:preview', id, query),
    pickFile: () => invoke('connectors:pickFile')
  },
  accounts: {
    list: () => invoke('accounts:list'),
    create: (u) => invoke('accounts:create', u),
    update: (id, patch) => invoke('accounts:update', id, patch),
    rotate: (id) => invoke('accounts:rotate', id),
    remove: (id) => invoke('accounts:remove', id)
  },
  lock: {
    status: () => invoke('lock:status'),
    unlock: (pin) => invoke('lock:unlock', pin),
    lockNow: () => invoke('lock:lockNow'),
    setPin: (pin, current) => invoke('lock:setPin', pin, current),
    clearPin: (current) => invoke('lock:clearPin', current),
    onChange: (cb) => subscribe('lock:changed', cb)
  },
  backup: {
    pickFolder: () => invoke('backup:pickFolder'),
    create: (password) => invoke('backup:create', password),
    runNow: () => invoke('backup:runNow'),
    restore: (password) => invoke('backup:restore', password)
  },
  sync: {
    status: () => invoke('sync:status'),
    now: () => invoke('sync:now'),
    onStatus: (cb) => subscribe('sync:status', cb)
  },
  updates: {
    status: () => invoke('updates:status'),
    check: () => invoke('updates:check'),
    install: () => invoke('updates:install'),
    onStatus: (cb) => subscribe('update:status', cb)
  },
  app: {
    version: () => invoke('app:version'),
    onDataChanged: (cb) => subscribe('data:changed', cb),
    onAccountChanged: (cb) => subscribe('account:changed', () => cb()),
    openExternal: (url) => invoke('app:openExternal', url)
  }
}

contextBridge.exposeInMainWorld('azim', api)
