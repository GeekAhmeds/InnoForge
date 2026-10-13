import { Plus } from 'lucide-react'
import { useLive } from '../hooks'
import { formatNumber, metricLabel, useT } from '../i18n'
import { HBarChart } from '../components/Charts'
import { ActivityList, AlertList } from '../components/Widgets'
import { ReminderList } from '../components/Reminders'

export function Overview(props: { onOpen: (companyId: string) => void; onAdd?: () => void; onReminders: () => void }): React.JSX.Element {
  const { lang, t } = useT()
  const [data] = useLive(() => window.azim.dashboard.overview(), [])
  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
  const [reminders] = useLive(() => window.azim.reminders.list({ status: 'open', until: soon }), [], ['reminders'])
  if (!data) return <div className="empty">…</div>

  const nameOf = (id: string | null): string => data.companies.find((c) => c.company.id === id)?.company.name ?? t.allCompanies
  const metricsShown = ['revenue', 'expenses', 'net_profit', 'cash'].filter((m) => data.companies.some((c) => m in c.latest))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.overview}</h1>
          <div className="sub">
            {data.companies.length} {t.companies}
          </div>
        </div>
        <div className="spacer" />
        {props.onAdd && (
          <button className="btn primary" onClick={props.onAdd}>
            <Plus size={15} /> {t.addCompany}
          </button>
        )}
      </div>

      {!data.companies.length ? (
        <div className="card empty">{t.noCompanies}</div>
      ) : (
        <div className="grid" style={{ gap: 20 }}>
          {data.totals.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 10px', color: 'var(--ink-2)', fontSize: 14 }}>{t.consolidated}</h3>
              <div className="grid kpis">
                {data.totals.map((x) => (
                  <div className="card kpi" key={x.metric}>
                    <div className="label">{metricLabel(x.metric, lang)}</div>
                    <div className="value">{formatNumber(x.value, lang, Math.abs(x.value) >= 1e6)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <h3>{t.companies}</h3>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{t.name}</th>
                    <th>{t.role}</th>
                    {metricsShown.map((m) => (
                      <th key={m} style={{ textAlign: 'end' }}>
                        {metricLabel(m, lang)}
                      </th>
                    ))}
                    <th>{t.period}</th>
                    <th style={{ textAlign: 'end' }}>{t.documents}</th>
                    <th style={{ textAlign: 'end' }}>{t.openAlerts}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.companies.map((c) => (
                    <tr key={c.company.id} style={{ cursor: 'pointer' }} onClick={() => props.onOpen(c.company.id)}>
                      <td>
                        <span className="dot" style={{ background: c.company.color, display: 'inline-block', marginInlineEnd: 8 }} />
                        <strong>{c.company.name}</strong>
                        <div className="meta" style={{ color: 'var(--muted)', fontSize: 12 }}>{c.company.industry}</div>
                      </td>
                      <td>{c.company.role}</td>
                      {metricsShown.map((m) => (
                        <td key={m} className="num">
                          {m in c.latest ? formatNumber(c.latest[m], lang) : '—'}
                        </td>
                      ))}
                      <td>{c.latestPeriod ?? '—'}</td>
                      <td className="num">{c.documentCount}</td>
                      <td className="num" style={{ color: c.openAlerts ? 'var(--critical)' : undefined }}>
                        {c.openAlerts}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {metricsShown.includes('revenue') && (
            <div className="card">
              <h3>{metricLabel('revenue', lang)}</h3>
              <HBarChart
                data={data.companies
                  .filter((c) => 'revenue' in c.latest)
                  .map((c) => ({ label: c.company.name, value: c.latest.revenue, color: c.company.color }))}
              />
            </div>
          )}

          {reminders && reminders.length > 0 && (
            <div className="card">
              <div className="row" style={{ marginBottom: 6 }}>
                <h3 style={{ margin: 0 }}>{t.calendar} — 30</h3>
                <div className="spacer" />
                <button className="btn sm" onClick={props.onReminders}>
                  {t.calendar}
                </button>
              </div>
              <ReminderList reminders={reminders.slice(0, 8)} companies={data.companies.map((c) => c.company)} showCompany canEdit={false} onEdit={() => undefined} />
            </div>
          )}

          <div className="grid half">
            <div className="card">
              <h3>{t.openAlerts}</h3>
              <AlertList alerts={data.alerts} companyName={nameOf} />
            </div>
            <div className="card">
              <h3>{t.activity}</h3>
              <ActivityList items={data.activity} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
