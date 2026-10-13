// Background jobs: deadlines, monthly reports, connector refreshes and
// automatic backups. Runs while the app is open (it also starts minimized
// with the OS if the user enables that).
import { checkReminders } from './reminders'
import { runDueMonthlyReports } from './monthly'
import { refreshDueConnectors } from './connectors'
import { runAutoBackup } from './backup'
import { logActivity } from './db'

const jobs: [string, () => Promise<unknown>][] = [
  ['reminders', checkReminders],
  ['monthly-reports', runDueMonthlyReports],
  ['connectors', refreshDueConnectors],
  ['backup', () => runAutoBackup()]
]

let running = false

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    for (const [name, job] of jobs) {
      try {
        await job()
      } catch (e) {
        logActivity(null, 'scheduler', `${name} failed: ${(e as Error).message}`)
      }
    }
  } finally {
    running = false
  }
}

export function startScheduler(): void {
  setTimeout(() => void tick(), 20_000)
  setInterval(() => void tick(), 15 * 60_000)
}
