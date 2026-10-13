import { useEffect, useState } from 'react'
import { Send, Eye } from 'lucide-react'
import { useT } from '../../i18n'
import { toast } from '../../components/Toast'
import type { Company, ReportSchedule } from '@shared/types'

const lastMonth = (): string => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.toISOString().slice(0, 7)
}

const errText = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function AutomationTab({ company }: { company: Company }): React.JSX.Element {
  const { t } = useT()
  const [s, setS] = useState<ReportSchedule | null>(null)
  const [emails, setEmails] = useState('')
  const [phones, setPhones] = useState('')
  const [period, setPeriod] = useState(lastMonth())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.azim.schedule.get(company.id).then((x) => {
      setS(x)
      setEmails(x.emails.join(', '))
      setPhones(x.whatsapp.join(', '))
    })
  }, [company.id])
  if (!s) return <div className="empty">…</div>

  const split = (v: string): string[] => v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)
  const save = async (patch: Partial<ReportSchedule> = {}): Promise<void> => {
    const next = await window.azim.schedule.save({ ...s, emails: split(emails), whatsapp: split(phones), ...patch })
    setS(next)
  }

  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <h3>{t.monthlyReport}</h3>
      <p style={{ color: 'var(--ink-2)', marginTop: 0 }}>{t.monthlyReportHint}</p>
      <label className="check">
        <input type="checkbox" checked={s.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
        <strong>{t.enabled}</strong>
      </label>
      <div className="row">
        <div className="field">
          <label>{t.dayOfMonth}</label>
          <input className="input" type="number" min={1} max={28} value={s.dayOfMonth} onChange={(e) => setS({ ...s, dayOfMonth: Number(e.target.value) })} onBlur={() => save()} />
        </div>
        <div className="field">
          <label>{t.language}</label>
          <select className="input" value={s.language} onChange={(e) => save({ language: e.target.value as ReportSchedule['language'] })}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="field">
          <label>{t.format}</label>
          <select className="input" value={s.format} onChange={(e) => save({ format: e.target.value as ReportSchedule['format'] })}>
            <option value="pdf">PDF</option>
            <option value="xlsx">Excel</option>
            <option value="docx">Word</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>{t.emails}</label>
        <input className="input" dir="ltr" value={emails} onChange={(e) => setEmails(e.target.value)} onBlur={() => save()} placeholder="ahmed@example.com, board@example.com" />
      </div>
      <div className="field">
        <label>{t.whatsappNumbers}</label>
        <input className="input" dir="ltr" value={phones} onChange={(e) => setPhones(e.target.value)} onBlur={() => save()} placeholder="+201001234567" />
      </div>
      <label className="check">
        <input type="checkbox" checked={s.aiSummary} onChange={(e) => save({ aiSummary: e.target.checked })} />
        {t.aiSummary}
      </label>
      <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <input className="input" type="month" style={{ maxWidth: 170 }} value={period} onChange={(e) => setPeriod(e.target.value)} />
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await window.azim.schedule.preview(company.id, period)
              await window.azim.reports.open(r.path)
            } catch (e) {
              toast(`✗ ${errText(e)}`)
            }
            setBusy(false)
          }}
        >
          <Eye size={14} /> {t.previewReport}
        </button>
        <button
          className="btn primary"
          disabled={busy || (!split(emails).length && !split(phones).length)}
          onClick={async () => {
            setBusy(true)
            await save()
            try {
              const r = await window.azim.schedule.send(company.id, period)
              toast(r.errors.length ? `✗ ${r.errors.join(' · ')}` : `✓ ${t.sendNow}`)
              setS(await window.azim.schedule.get(company.id))
            } catch (e) {
              toast(`✗ ${errText(e)}`)
            }
            setBusy(false)
          }}
        >
          <Send size={14} /> {t.sendNow}
        </button>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 10 }}>
        {t.lastSent}: {s.lastPeriodSent ?? '—'}
        {s.lastError && <div style={{ color: 'var(--bad)', whiteSpace: 'pre-wrap' }}>{s.lastError}</div>}
      </div>
    </div>
  )
}
