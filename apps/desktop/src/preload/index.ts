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
    testProvider: () => invoke('settings:testProvider')
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
    openExternal: (url) => invoke('app:openExternal', url)
  }
}

contextBridge.exposeInMainWorld('azim', api)
