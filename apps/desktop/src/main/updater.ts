// Auto-update from the Inno server. It publishes electron-builder artifacts
// under /updates/azim-command/<os>/ and announces releases on /api/azim-command/events,
// so the app learns about an update within seconds of it being uploaded.
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { broadcast } from './events'
import { getSettings } from './settings'
import { SERVER_APP_ID, type UpdateStatus } from '@shared/types'

const { autoUpdater } = electronUpdater

let status: UpdateStatus = { state: 'idle' }
let started = false

function set(next: UpdateStatus): void {
  status = next
  broadcast('update:status', status)
}

export const getUpdateStatus = (): UpdateStatus => status

const osDir = (): string => (process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux')

function configureFeed(): void {
  const base = getSettings().serverUrl.replace(/\/+$/, '')
  autoUpdater.setFeedURL({ provider: 'generic', url: `${base}/updates/${SERVER_APP_ID}/${osDir()}` })
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    set({ state: 'none', error: 'Updates are only available in the installed app.' })
    return status
  }
  configureFeed()
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ state: 'error', error: (e as Error).message })
  }
  return status
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}

async function listenForReleases(): Promise<void> {
  // Server-sent events; reconnects forever with a back-off.
  let delay = 5_000
  for (;;) {
    try {
      const base = getSettings().serverUrl.replace(/\/+$/, '')
      const res = await fetch(`${base}/api/${SERVER_APP_ID}/events`, { headers: { Accept: 'text/event-stream' } })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      delay = 5_000
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          if (/^event: release/m.test(chunk)) void checkForUpdates()
        }
      }
    } catch {
      // server unreachable; retry later
    }
    await new Promise((r) => setTimeout(r, delay))
    delay = Math.min(delay * 2, 10 * 60_000)
  }
}

export function startUpdater(): void {
  if (started) return
  started = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => set({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', version: status.version, progress: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (e) => set({ state: 'error', error: e.message }))
  if (!app.isPackaged) return
  void checkForUpdates()
  setInterval(() => void checkForUpdates(), 30 * 60_000)
  void listenForReleases()
}
