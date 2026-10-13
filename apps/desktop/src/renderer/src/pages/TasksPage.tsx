import { useState } from 'react'
import { MessageSquare, Play, Plus, Trash2, Timer } from 'lucide-react'
import { useLive } from '../hooks'
import { formatDate, useT } from '../i18n'
import { toast } from '../components/Toast'
import type { AgentTask, Company } from '@shared/types'

const errText = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const split = (v: string): string[] => v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)

export function TasksPage({ companies, onOpenChat }: { companies: Company[]; onOpenChat: (companyId: string | null) => void }): React.JSX.Element {
  const { lang, t } = useT()
  const [tasks] = useLive(() => window.azim.agent.tasks(), [], ['tasks'])
  const [editing, setEditing] = useState<Partial<AgentTask> | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const days = t.days.split(',')
  const when = (task: AgentTask): string =>
    task.schedule === 'daily' ? `${t.daily} ${task.time}` : task.schedule === 'weekly' ? `${t.weekly} · ${days[task.weekday]} ${task.time}` : `${t.monthly} · ${task.dayOfMonth} · ${task.time}`

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.agentTasks}</h1>
          <div className="sub" style={{ maxWidth: 760 }}>
            {t.agentTasksHint}
          </div>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setEditing({ schedule: 'weekly', time: '08:00', weekday: 0, dayOfMonth: 1, enabled: true })}>
          <Plus size={15} /> {t.newTask}
        </button>
      </div>
      <div className="card">
        {!tasks?.length && <div className="empty">{t.noData}</div>}
        <div className="list">
          {(tasks ?? []).map((task) => (
            <div className="list-item" key={task.id} style={{ opacity: task.enabled ? 1 : 0.55 }}>
              <Timer size={18} color="var(--accent)" />
              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setEditing(task)}>
                <strong>{task.name}</strong> <span className="chip">{when(task)}</span>
                {task.companyId && <span className="chip">{companies.find((c) => c.id === task.companyId)?.name}</span>}
                <div className="meta" style={{ whiteSpace: 'pre-wrap' }}>{task.prompt.slice(0, 200)}</div>
                <div className="meta">
                  {t.lastRun}: {task.lastRunAt ? formatDate(task.lastRunAt, lang) : '—'}
                  {task.lastStatus && task.lastStatus !== 'ok' && <span style={{ color: 'var(--bad)' }}> · {task.lastStatus}</span>}
                </div>
              </div>
              {task.conversationId && (
                <button className="btn sm" onClick={() => onOpenChat(task.companyId)} title={t.openChat}>
                  <MessageSquare size={13} />
                </button>
              )}
              <button
                className="btn sm"
                disabled={running === task.id}
                onClick={async () => {
                  setRunning(task.id)
                  try {
                    await window.azim.agent.runTask(task.id)
                    toast(`✓ ${task.name}`)
                  } catch (e) {
                    toast(`✗ ${errText(e)}`)
                  }
                  setRunning(null)
                }}
              >
                <Play size={13} /> {running === task.id ? '…' : t.runNow}
              </button>
            </div>
          ))}
        </div>
      </div>
      {editing && <TaskForm initial={editing} companies={companies} onClose={() => setEditing(null)} />}
    </>
  )
}

function TaskForm({ initial, companies, onClose }: { initial: Partial<AgentTask>; companies: Company[]; onClose: () => void }): React.JSX.Element {
  const { t } = useT()
  const [task, setTask] = useState<Partial<AgentTask>>(initial)
  const [emails, setEmails] = useState((initial.emails ?? []).join(', '))
  const [phones, setPhones] = useState((initial.whatsapp ?? []).join(', '))
  const set = (p: Partial<AgentTask>): void => setTask((x) => ({ ...x, ...p }))
  const days = t.days.split(',')
  return (
    <div className="modal-bg" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault()
          if (!task.name?.trim() || !task.prompt?.trim()) return
          await window.azim.agent.saveTask({ ...task, name: task.name.trim(), prompt: task.prompt.trim(), emails: split(emails), whatsapp: split(phones) })
          onClose()
        }}
      >
        <h2>{task.id ? task.name : t.newTask}</h2>
        <div className="field">
          <label>{t.name}</label>
          <input className="input" required autoFocus value={task.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="field">
          <label>{t.taskPrompt}</label>
          <textarea className="input" rows={4} required value={task.prompt ?? ''} onChange={(e) => set({ prompt: e.target.value })} placeholder={t.sug2} />
        </div>
        <div className="row">
          <div className="field">
            <label>{t.scope}</label>
            <select className="input" value={task.companyId ?? ''} onChange={(e) => set({ companyId: e.target.value || null })}>
              <option value="">{t.allCompanies}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t.schedule}</label>
            <select className="input" value={task.schedule} onChange={(e) => set({ schedule: e.target.value as AgentTask['schedule'] })}>
              <option value="daily">{t.daily}</option>
              <option value="weekly">{t.weekly}</option>
              <option value="monthly">{t.monthly}</option>
            </select>
          </div>
          {task.schedule === 'weekly' && (
            <div className="field">
              <label>{t.weekday}</label>
              <select className="input" value={task.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
                {days.map((d, i) => (
                  <option key={i} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
          {task.schedule === 'monthly' && (
            <div className="field">
              <label>{t.dayOfMonth}</label>
              <input className="input" type="number" min={1} max={28} value={task.dayOfMonth} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })} />
            </div>
          )}
          <div className="field">
            <label>{t.time}</label>
            <input className="input" type="time" value={task.time} onChange={(e) => set({ time: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>{t.emails}</label>
          <input className="input" dir="ltr" value={emails} onChange={(e) => setEmails(e.target.value)} />
        </div>
        <div className="field">
          <label>{t.whatsappNumbers}</label>
          <input className="input" dir="ltr" value={phones} onChange={(e) => setPhones(e.target.value)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={task.enabled ?? true} onChange={(e) => set({ enabled: e.target.checked })} />
          {t.enabled}
        </label>
        <div className="modal-actions">
          {task.id && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                await window.azim.agent.removeTask(task.id!)
                onClose()
              }}
            >
              <Trash2 size={14} /> {t.delete}
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="btn primary">
            {t.save}
          </button>
        </div>
      </form>
    </div>
  )
}
