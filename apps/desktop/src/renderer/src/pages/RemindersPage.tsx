import { useState } from 'react'
import { useLive } from '../hooks'
import { useT } from '../i18n'
import { NewReminderButton, ReminderForm, ReminderList } from '../components/Reminders'
import type { Company, Reminder } from '@shared/types'

// All deadlines across companies, grouped by urgency.
export function RemindersPage({ companies, canEdit }: { companies: Company[]; canEdit: boolean }): React.JSX.Element {
  const { t } = useT()
  const [companyId, setCompanyId] = useState('')
  const [editing, setEditing] = useState<Partial<Reminder> | null>(null)
  const [reminders] = useLive(() => window.azim.reminders.list({ status: 'open', companyId: companyId || undefined }), [companyId], ['reminders'])
  return (
    <>
      <div className="page-head">
        <h1>{t.calendar}</h1>
        <select className="input" style={{ maxWidth: 240 }} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">{t.allCompanies}</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="spacer" />
        {canEdit && companies.length > 0 && <NewReminderButton onClick={() => setEditing({ companyId: companyId || undefined })} />}
      </div>
      <div className="card">
        <ReminderList reminders={reminders ?? []} companies={companies} showCompany={!companyId} canEdit={canEdit} onEdit={setEditing} />
      </div>
      {editing && <ReminderForm initial={editing} companies={companies} onClose={() => setEditing(null)} />}
    </>
  )
}
