// Deadlines (taxes, installments, contract renewals...). Due-soon reminders
// raise a desktop notification and a dashboard alert, and are sent once to
// Azim's own email/WhatsApp when those channels are configured.
import { Notification } from 'electron'
import { getDb, logActivity, now, uid } from './db'
import { dataChanged } from './events'
import * as repo from './repo'
import { deliver } from './messaging'
import { getSettings } from './settings'
import { addMonths } from '@shared/forecast'
import type { Reminder } from '@shared/types'

type Row = Record<string, any>

const toReminder = (r: Row): Reminder => ({
  id: r.id,
  companyId: r.company_id,
  title: r.title,
  type: r.type,
  dueDate: r.due_date,
  amount: r.amount,
  currency: r.currency,
  recurrence: r.recurrence,
  remindDays: r.remind_days,
  status: r.status,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export function listReminders(filter: { companyId?: string; status?: 'open' | 'done'; until?: string } = {}): Reminder[] {
  const where = ['deleted = 0']
  const params: unknown[] = []
  if (filter.companyId) {
    where.push('company_id = ?')
    params.push(filter.companyId)
  }
  if (filter.status) {
    where.push('status = ?')
    params.push(filter.status)
  }
  if (filter.until) {
    where.push('due_date <= ?')
    params.push(filter.until)
  }
  return (getDb().prepare(`SELECT * FROM reminders WHERE ${where.join(' AND ')} ORDER BY due_date`).all(...params) as Row[]).map(
    toReminder
  )
}

export function saveReminder(input: Partial<Reminder> & { companyId: string; title: string; dueDate: string }): Reminder {
  const d = getDb()
  const ts = now()
  const existing = input.id ? (d.prepare('SELECT * FROM reminders WHERE id = ?').get(input.id) as Row | undefined) : undefined
  const r = { ...(existing ? toReminder(existing) : {}), ...input } as Reminder
  const id = existing?.id ?? uid()
  const values = [
    r.companyId,
    r.title,
    r.type ?? 'other',
    r.dueDate,
    r.amount ?? null,
    r.currency ?? '',
    r.recurrence ?? 'none',
    r.remindDays ?? 7,
    r.status ?? 'open',
    r.notes ?? ''
  ]
  if (existing) {
    d.prepare(
      `UPDATE reminders SET company_id=?, title=?, type=?, due_date=?, amount=?, currency=?, recurrence=?, remind_days=?, status=?, notes=?,
       last_notified = CASE WHEN due_date = ? THEN last_notified ELSE NULL END, updated_at=? WHERE id=?`
    ).run(...values, r.dueDate, ts, id)
  } else {
    d.prepare(
      `INSERT INTO reminders (company_id, title, type, due_date, amount, currency, recurrence, remind_days, status, notes, id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(...values, id, ts, ts)
    logActivity(r.companyId, 'reminder', `Reminder added: ${r.title} (${r.dueDate})`)
  }
  dataChanged('reminders')
  return toReminder(d.prepare('SELECT * FROM reminders WHERE id = ?').get(id) as Row)
}

export function deleteReminder(id: string): void {
  getDb().prepare('UPDATE reminders SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), id)
  dataChanged('reminders')
}

const STEP: Record<Reminder['recurrence'], number> = { none: 0, monthly: 1, quarterly: 3, yearly: 12 }

function shiftDate(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const period = addMonths(`${y}-${String(m).padStart(2, '0')}`, months)
  const [ny, nm] = period.split('-').map(Number)
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${period}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

/** Mark done; recurring reminders roll forward to their next due date. */
export function completeReminder(id: string): Reminder | null {
  const row = getDb().prepare('SELECT * FROM reminders WHERE id = ?').get(id) as Row | undefined
  if (!row) return null
  const r = toReminder(row)
  logActivity(r.companyId, 'reminder', `Done: ${r.title} (${r.dueDate})`)
  if (r.recurrence !== 'none') return saveReminder({ ...r, dueDate: shiftDate(r.dueDate, STEP[r.recurrence]), status: 'open' })
  return saveReminder({ ...r, status: 'done' })
}

export const daysUntil = (date: string): number => Math.round((Date.parse(date) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000)

export async function checkReminders(): Promise<void> {
  const d = getDb()
  const today = new Date().toISOString().slice(0, 10)
  const due = listReminders({ status: 'open' }).filter((r) => daysUntil(r.dueDate) <= r.remindDays)
  const fresh: Reminder[] = []
  for (const r of due) {
    const row = d.prepare('SELECT last_notified FROM reminders WHERE id = ?').get(r.id) as Row
    if (row.last_notified === today) continue
    // Notify once when it enters the window, then daily once overdue.
    const days = daysUntil(r.dueDate)
    if (row.last_notified && days > 0) continue
    d.prepare('UPDATE reminders SET last_notified = ? WHERE id = ?').run(today, r.id)
    fresh.push(r)
  }
  if (!fresh.length) return
  const lang = getSettings().language
  const lines = fresh.map((r) => {
    const company = repo.getCompany(r.companyId)?.name ?? ''
    const days = daysUntil(r.dueDate)
    const when =
      lang === 'ar'
        ? days < 0
          ? `متأخر ${-days} يوم`
          : days === 0
            ? 'اليوم'
            : `بعد ${days} يوم`
        : days < 0
          ? `${-days} days overdue`
          : days === 0
            ? 'today'
            : `in ${days} days`
    const amount = r.amount ? ` — ${r.amount.toLocaleString()} ${r.currency}` : ''
    repo.createAlert({
      companyId: r.companyId,
      severity: days < 0 ? 'critical' : 'warning',
      title: `${company}: ${r.title} (${r.dueDate})`,
      detail: `${when}${amount}`
    })
    return `• ${company} — ${r.title}: ${r.dueDate} (${when})${amount}`
  })
  const title = lang === 'ar' ? 'Azim Command — مواعيد مستحقة' : 'Azim Command — upcoming deadlines'
  if (Notification.isSupported()) new Notification({ title, body: lines.slice(0, 4).join('\n') }).show()
  await deliver(getSettings().reminderRecipients, title, lines.join('\n'))
}
