import { BrowserWindow } from 'electron'

// Push an event to every renderer window. The renderer refreshes dashboards
// on 'data:changed', which is what makes them update live.
export function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

let pending: NodeJS.Timeout | null = null
const scopes = new Set<string>()

export function dataChanged(scope: string): void {
  scopes.add(scope)
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    broadcast('data:changed', [...scopes])
    scopes.clear()
  }, 150)
}
