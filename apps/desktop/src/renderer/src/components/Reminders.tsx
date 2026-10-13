import { useState } from 'react'
import { CalendarClock, Check, Plus, Repeat } from 'lucide-react'
import { formatNumber, useT, type Dict } from '../i18n'
import type { Company, Reminder, ReminderType } from '@shared/types'

const TYPES: ReminderType[] = ['tax', 'installment', 'contract', 'salary', 'insurance', 'other']

export const typeLabel = (t: Dict, type: ReminderType): string => t[`rt_${type}` as keyof Dict]

export function daysUntil(date: string): number {
  return Math.round((Date.parse(date) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000)
}

function bucket(days: number): 'overdue' | 'thisWeek' | 'thisMonth' | 'later' {
  if (days < 0) return 'overdue'
  if (days <= 7) return 'thisWeek'
  if (days <= 31) return 'thisMonth'
  return 'later'
}

export function ReminderList(props: {
  reminders: Reminder[]
  companies: Company[]
  showCompany?: boolean
  canEdit: boolean
  onEdit: (r: Reminder) => void
}): React.JSX.Element {
  const { lang, t } = useT()
  if (!props.reminders.length) return <div className="empty">{t.noData}</div>
  const groups = (['overdue', 'thisWeek', 'thisMonth', 'later'] as const)
    .map((b) => ({ b, items: props.reminders.filter((r) => bucket(daysUntil(r.dueDate)) === b) }))
    .filter((g) => g.items.length)
  return (
    <div>
      {groups.map((g) => (
        <div key={g.b} style={{ marginBottom: 14 }}>
          <h3 style={{ color: g.b === 'overdue' ? 'var(--critical)' : undefined }}>
            {t[g.b]} ({g.items.length})
          </h3>
          <div className="list">
            {g.items.map((r) => {
              const days = daysUntil(r.dueDate)
              const company = props.companies.find((c) => c.id === r.companyId)
              return (
                <div className="list-item" key={r.id}>
                  <CalendarClock size={18} color={days < 0 ? 'var(--critical)' : days <= 7 ? 'var(--warning)' : 'var(--accent)'} />
                  <div style={{ flex: 1, cursor: props.canEdit ? 'pointer' : undefined }} onClick={() => props.canEdit && props.onEdit(r)}>
                    <div>
                      <strong>{r.title}</strong> <span className="chip">{typeLabel(t, r.type)}</span>
                      {r.recurrence !== 'none' && <Repeat size={12} style={{ marginInlineStart: 6, color: 'var(--muted)' }} />}
                    </div>
                    <div className="meta">
                      {props.showCompany && company && (
                        <>
                          <span className="dot" style={{ background: company.color, display: 'inline-block', marginInlineEnd: 4 }} />
                          {company.name} ·{' '}
                        </>
                      )}
                      {r.dueDate} · {days === 0 ? t.today : days > 0 ? `${days} ${t.daysLeft}` : `${-days} ${t.daysLate}`}
                      {r.amount ? ` · ${formatNumber(r.amount, lang)} ${r.currency}` : ''}
                    </div>
                  </div>
                  {props.canEdit && (
                    <button className="btn sm" onClick={() => window.azim.reminders.complete(r.id)}>
                      <Check size={13} /> {t.markDone}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

export function ReminderForm(props: { initial: Partial<Reminder>; companies: Company[]; onClose: () => void }): React.JSX.Element {
  const { t } = useT()
  const [r, setR] = useState<Partial<Reminder>>({ type: 'tax', recurrence: 'none', remindDays: 7, ...props.initial })
  const set = (p: Partial<Reminder>): void => setR((x) => ({ ...x, ...p }))
  return (
    <div className="modal-bg" onClick={props.onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault()
          if (!r.title?.trim() || !r.dueDate || !r.companyId) return
          const company = props.companies.find((c) => c.id === r.companyId)
          await window.azim.reminders.save({ ...r, currency: r.currency || company?.currency || '', companyId: r.companyId, title: r.title.trim(), dueDate: r.dueDate })
          props.onClose()
        }}
      >
        <h2>{r.id ? r.title : t.newReminder}</h2>
        {!props.initial.companyId && (
          <div className="field">
            <label>{t.companies}</label>
            <select className="input" required value={r.companyId ?? ''} onChange={(e) => set({ companyId: e.target.value })}>
              <option value="" />
              {props.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>{t.title}</label>
          <input className="input" required autoFocus value={r.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="row">
          <div className="field">
            <label>{t.type}</label>
            <select className="input" value={r.type} onChange={(e) => set({ type: e.target.value as ReminderType })}>
              {TYPES.map((x) => (
                <option key={x} value={x}>
                  {typeLabel(t, x)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t.dueDate}</label>
            <input className="input" type="date" required value={r.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value })} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>{t.amount}</label>
            <input className="input" inputMode="decimal" value={r.amount ?? ''} onChange={(e) => set({ amount: e.target.value === '' ? null : Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>{t.recurrence}</label>
            <select className="input" value={r.recurrence} onChange={(e) => set({ recurrence: e.target.value as Reminder['recurrence'] })}>
              <option value="none">{t.none}</option>
              <option value="monthly">{t.monthly}</option>
              <option value="quarterly">{t.quarterly}</option>
              <option value="yearly">{t.yearly}</option>
            </select>
          </div>
          <div className="field">
            <label>{t.remindBefore}</label>
            <input className="input" type="number" min={0} value={r.remindDays ?? 7} onChange={(e) => set({ remindDays: Number(e.target.value) })} />
          </div>
        </div>
        <div className="field">
          <label>{t.notes}</label>
          <textarea className="input" rows={2} value={r.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
        </div>
        <div className="modal-actions">
          {r.id && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                await window.azim.reminders.remove(r.id!)
                props.onClose()
              }}
            >
              {t.delete}
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn" onClick={props.onClose}>
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

export function NewReminderButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  const { t } = useT()
  return (
    <button className="btn primary" onClick={onClick}>
      <Plus size={15} /> {t.newReminder}
    </button>
  )
}
