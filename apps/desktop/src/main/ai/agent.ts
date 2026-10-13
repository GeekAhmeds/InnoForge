// The agent's long-term memory and its scheduled tasks.
import { Notification } from 'electron'
import { getDb, logActivity, now, uid } from '../db'
import { dataChanged } from '../events'
import { deliver } from '../messaging'
import type { AgentTask, Memory } from '@shared/types'

type Row = Record<string, any>

// ---------------- memory ----------------

export function listMemories(companyId?: string | null): Memory[] {
  const rows =
    companyId === undefined
      ? getDb().prepare('SELECT * FROM memories ORDER BY created_at').all()
      : getDb().prepare('SELECT * FROM memories WHERE company_id IS NULL OR company_id = ? ORDER BY created_at').all(companyId)
  return (rows as Row[]).map((r) => ({ id: r.id, companyId: r.company_id, content: r.content, createdAt: r.created_at }))
}

export function remember(content: string, companyId: string | null): Memory {
  const id = uid()
  getDb().prepare('INSERT INTO memories (id, company_id, content, created_at) VALUES (?, ?, ?, ?)').run(id, companyId, content.trim().slice(0, 1000), now())
  dataChanged('memories')
  return listMemories().find((m) => m.id === id)!
}

export function forget(id: string): void {
  getDb().prepare('DELETE FROM memories WHERE id = ?').run(id)
  dataChanged('memories')
}

// ---------------- scheduled tasks ----------------

const toTask = (r: Row): AgentTask => ({
  id: r.id,
  name: r.name,
  prompt: r.prompt,
  companyId: r.company_id,
  schedule: r.schedule,
  time: r.time,
  weekday: r.weekday,
  dayOfMonth: r.day_of_month,
  emails: JSON.parse(r.emails),
  whatsapp: JSON.parse(r.whatsapp),
  enabled: !!r.enabled,
  conversationId: r.conversation_id,
  lastRunAt: r.last_run_at,
  lastStatus: r.last_status
})

export function listTasks(): AgentTask[] {
  return (getDb().prepare('SELECT * FROM agent_tasks ORDER BY created_at').all() as Row[]).map(toTask)
}

export function getTask(id: string): AgentTask | null {
  const r = getDb().prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id) as Row | undefined
  return r ? toTask(r) : null
}

export function saveTask(t: Partial<AgentTask> & { name: string; prompt: string }): AgentTask {
  const d = getDb()
  const existing = t.id ? getTask(t.id) : null
  const v = { schedule: 'weekly', time: '08:00', weekday: 0, dayOfMonth: 1, emails: [], whatsapp: [], enabled: true, companyId: null, ...existing, ...t } as AgentTask
  if (!/^\d{2}:\d{2}$/.test(v.time)) v.time = '08:00'
  const values = [v.name, v.prompt, v.companyId, v.schedule, v.time, v.weekday, Math.min(28, Math.max(1, v.dayOfMonth)), JSON.stringify(v.emails), JSON.stringify(v.whatsapp), v.enabled ? 1 : 0]
  const id = existing?.id ?? uid()
  if (existing) {
    d.prepare('UPDATE agent_tasks SET name=?, prompt=?, company_id=?, schedule=?, time=?, weekday=?, day_of_month=?, emails=?, whatsapp=?, enabled=? WHERE id=?').run(...values, id)
  } else {
    d.prepare(
      'INSERT INTO agent_tasks (name, prompt, company_id, schedule, time, weekday, day_of_month, emails, whatsapp, enabled, id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(...values, id, now())
  }
  dataChanged('tasks')
  return getTask(id)!
}

export function deleteTask(id: string): void {
  getDb().prepare('DELETE FROM agent_tasks WHERE id = ?').run(id)
  dataChanged('tasks')
}

/** The most recent moment this task was due (local time), or null if never yet. */
export function lastDue(t: AgentTask, at = new Date()): Date | null {
  const [hh, mm] = t.time.split(':').map(Number)
  const candidate = new Date(at)
  candidate.setHours(hh, mm, 0, 0)
  if (t.schedule === 'daily') {
    if (candidate > at) candidate.setDate(candidate.getDate() - 1)
    return candidate
  }
  if (t.schedule === 'weekly') {
    const diff = (candidate.getDay() - t.weekday + 7) % 7
    candidate.setDate(candidate.getDate() - diff)
    if (candidate > at) candidate.setDate(candidate.getDate() - 7)
    return candidate
  }
  candidate.setDate(t.dayOfMonth)
  if (candidate > at) candidate.setMonth(candidate.getMonth() - 1)
  return candidate
}

let runner: ((task: AgentTask) => Promise<{ text: string; conversationId: string }>) | null = null

/** chat.ts registers how a task is executed (keeps this module free of a cycle). */
export function setTaskRunner(fn: typeof runner): void {
  runner = fn
}

export async function runTask(id: string): Promise<string> {
  const t = getTask(id)
  if (!t || !runner) throw new Error('task not found')
  try {
    const { text, conversationId } = await runner(t)
    getDb().prepare('UPDATE agent_tasks SET last_run_at = ?, last_status = ?, conversation_id = ? WHERE id = ?').run(now(), 'ok', conversationId, id)
    const errors = await deliver({ emails: t.emails, whatsapp: t.whatsapp }, `Azim Command — ${t.name}`, text)
    if (Notification.isSupported()) new Notification({ title: `Azim Command — ${t.name}`, body: text.replace(/[#*|_`>]/g, '').slice(0, 200) }).show()
    logActivity(t.companyId, 'agent', `Agent task "${t.name}" completed${errors.length ? ` (delivery: ${errors.join('; ')})` : ''}`)
    dataChanged('tasks')
    return text
  } catch (e) {
    getDb().prepare('UPDATE agent_tasks SET last_run_at = ?, last_status = ? WHERE id = ?').run(now(), `error: ${(e as Error).message}`, id)
    dataChanged('tasks')
    throw e
  }
}

export async function runDueTasks(): Promise<void> {
  const at = new Date()
  for (const t of listTasks()) {
    if (!t.enabled) continue
    const due = lastDue(t, at)
    if (!due || (t.lastRunAt && Date.parse(t.lastRunAt) >= due.getTime())) continue
    // Do not run a task that was created after its last due moment.
    const created = getDb().prepare('SELECT created_at FROM agent_tasks WHERE id = ?').get(t.id) as Row
    if (Date.parse(created.created_at) > due.getTime()) continue
    await runTask(t.id).catch(() => undefined)
  }
}
