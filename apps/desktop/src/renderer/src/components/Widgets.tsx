import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react'
import { formatDate, formatNumber, metricLabel, useT } from '../i18n'
import type { ActivityItem, Alert, DashboardKpi } from '@shared/types'

const RISING_IS_BAD = new Set(['expenses', 'payables', 'payroll', 'debt', 'cost_of_sales'])

export function KpiCard({ kpi }: { kpi: DashboardKpi }): React.JSX.Element {
  const { lang, t } = useT()
  const change = kpi.previous ? ((kpi.value - kpi.previous) / Math.abs(kpi.previous)) * 100 : null
  const good = change === null ? null : RISING_IS_BAD.has(kpi.metric) ? change <= 0 : change >= 0
  return (
    <div className="card kpi">
      <div className="label">{metricLabel(kpi.metric, lang)}</div>
      <div className="value">
        {formatNumber(kpi.value, lang, Math.abs(kpi.value) >= 1e6)} <small style={{ fontSize: 12, fontWeight: 400 }}>{kpi.currency}</small>
      </div>
      {change !== null && (
        <div className={`delta ${good ? 'good' : 'bad'}`}>
          {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% <span style={{ color: 'var(--muted)' }}>{t.vsPrev}</span>
        </div>
      )}
      <div className="period">{kpi.period}</div>
    </div>
  )
}

export function SeverityBadge({ severity }: { severity: Alert['severity'] }): React.JSX.Element {
  const Icon = severity === 'critical' ? OctagonAlert : severity === 'warning' ? AlertTriangle : Info
  return (
    <span className={`sev ${severity}`}>
      <Icon size={15} />
    </span>
  )
}

export function AlertList({ alerts, companyName }: { alerts: Alert[]; companyName?: (id: string | null) => string }): React.JSX.Element {
  const { lang, t } = useT()
  if (!alerts.length)
    return (
      <div className="empty">
        <CheckCircle2 size={18} style={{ verticalAlign: 'middle' }} /> {t.noData}
      </div>
    )
  return (
    <div className="list">
      {alerts.map((a) => (
        <div className="list-item" key={a.id}>
          <SeverityBadge severity={a.severity} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{a.title}</div>
            {a.detail && <div className="meta" style={{ whiteSpace: 'pre-wrap' }}>{a.detail.slice(0, 300)}</div>}
            <div className="meta">
              {companyName ? `${companyName(a.companyId)} · ` : ''}
              {formatDate(a.createdAt, lang)} · {a.source}
            </div>
          </div>
          <button className="btn sm" onClick={() => window.azim.alerts.resolve(a.id)}>
            {t.resolve}
          </button>
        </div>
      ))}
    </div>
  )
}

export function ActivityList({ items }: { items: ActivityItem[] }): React.JSX.Element {
  const { lang, t } = useT()
  if (!items.length) return <div className="empty">{t.noData}</div>
  return (
    <div className="list">
      {items.map((a) => (
        <div className="list-item" key={a.id}>
          <div style={{ flex: 1 }}>
            <div>{a.message}</div>
            <div className="meta">{formatDate(a.createdAt, lang)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
