import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'

function ensure(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

export const dataDir = (): string => ensure(join(app.getPath('userData'), 'data'))
export const dbPath = (): string => join(dataDir(), 'azim.db')
export const vaultDir = (companyId: string): string => ensure(join(dataDir(), 'vault', companyId))
export const reportsDir = (): string => ensure(join(app.getPath('documents'), 'Azim Command', 'Reports'))
export const ocrCacheDir = (): string => ensure(join(dataDir(), 'ocr'))
