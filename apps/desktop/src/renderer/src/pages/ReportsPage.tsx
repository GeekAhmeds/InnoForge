import { FileSpreadsheet, FileText, FileType, FolderOpen } from 'lucide-react'
import { useLive } from '../hooks'
import { formatDate, useT } from '../i18n'
import type { Company } from '@shared/types'

const ICONS = { pdf: FileText, xlsx: FileSpreadsheet, docx: FileType } as const

export function ReportsPage({ companies }: { companies: Company[] }): React.JSX.Element {
  const { lang, t } = useT()
  const [reports] = useLive(() => window.azim.reports.list(), [], ['reports'])
  return (
    <>
      <div className="page-head">
        <h1>{t.generatedReports}</h1>
      </div>
      <div className="card">
        {!reports?.length && <div className="empty">{t.noReports}</div>}
        <div className="list">
          {(reports ?? []).map((r) => {
            const Icon = ICONS[r.format]
            return (
              <div className="list-item" key={r.id}>
                <Icon size={22} color="var(--accent)" />
                <div style={{ flex: 1 }}>
                  <strong>{r.title}</strong>
                  <div className="meta">
                    {(r.companyId && companies.find((c) => c.id === r.companyId)?.name) || t.allCompanies} · {r.format.toUpperCase()} ·{' '}
                    {formatDate(r.createdAt, lang)}
                  </div>
                </div>
                <button className="btn sm" onClick={() => window.azim.reports.open(r.path)}>
                  {t.open}
                </button>
                <button className="btn sm ghost" onClick={() => window.azim.reports.reveal(r.path)} title={t.showInFolder}>
                  <FolderOpen size={14} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
