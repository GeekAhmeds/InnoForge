// Dashboards, automatic checks (anomalies, data quality) and search.
import { getDb } from './db'
import * as repo from './repo'
import { getSettings } from './settings'
import type { CompanyDashboard, DashboardKpi, OverviewDashboard, SearchHit } from '@shared/types'

export const KPI_ORDER = ['revenue', 'expenses', 'net_profit', 'cash', 'receivables', 'payables', 'gross_margin', 'payroll']

// Metrics where a rise is bad news.
const RISING_IS_BAD = new Set(['expenses', 'payables', 'payroll', 'debt', 'cost_of_sales'])

function latestPeriods(companyId: string): string[] {
  return (
    getDb()
      .prepare('SELECT DISTINCT period FROM metrics WHERE company_id = ? AND deleted = 0 ORDER BY period DESC LIMIT 12')
      .all(companyId) as { period: string }[]
  ).map((r) => r.period)
}

export function getCompanyDashboard(companyId: string): CompanyDashboard | null {
  const company = repo.getCompany(companyId)
  if (!company) return null
  const metrics = repo.listMetrics({ companyId })
  const byMetric = new Map<string, { period: string; value: number; currency: string }[]>()
  for (const m of metrics) {
    if (!byMetric.has(m.metric)) byMetric.set(m.metric, [])
    byMetric.get(m.metric)!.push({ period: m.period, value: m.value, currency: m.currency })
  }
  const kpis: DashboardKpi[] = []
  const names = [...byMetric.keys()].sort((a, b) => {
    const ia = KPI_ORDER.indexOf(a)
    const ib = KPI_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
  for (const name of names) {
    const series = byMetric.get(name)!
    const last = series[series.length - 1]
    const prev = series.length > 1 ? series[series.length - 2] : null
    kpis.push({
      metric: name,
      value: last.value,
      previous: prev?.value ?? null,
      period: last.period,
      currency: last.currency || company.currency
    })
  }
  const periods = latestPeriods(companyId).reverse()
  const trend = periods.map((period) => {
    const point: { period: string; [k: string]: number | string } = { period }
    for (const m of metrics) if (m.period === period) point[m.metric] = m.value
    return point
  })
  const categories = getDb()
    .prepare(
      'SELECT category, COUNT(*) AS count FROM documents WHERE company_id = ? AND deleted = 0 GROUP BY category ORDER BY count DESC'
    )
    .all(companyId) as { category: string; count: number }[]
  return {
    company,
    kpis,
    trend,
    categories,
    documentCount: categories.reduce((s, c) => s + c.count, 0),
    alerts: repo.listAlerts({ companyId, limit: 20 }),
    decisions: repo.listDecisions(companyId).slice(0, 10),
    activity: repo.listActivity(companyId, 20)
  }
}

export function getOverview(): OverviewDashboard {
  const companies = repo.listCompanies().map((company) => {
    const periods = latestPeriods(company.id)
    const latestPeriod = periods[0] ?? null
    const latest: Record<string, number> = {}
    if (latestPeriod) {
      for (const m of repo.listMetrics({ companyId: company.id, from: latestPeriod, to: latestPeriod })) latest[m.metric] = m.value
    }
    const documentCount = (
      getDb().prepare('SELECT COUNT(*) AS n FROM documents WHERE company_id = ? AND deleted = 0').get(company.id) as { n: number }
    ).n
    return { company, documentCount, openAlerts: repo.listAlerts({ companyId: company.id }).length, latest, latestPeriod }
  })
  const totals = new Map<string, number>()
  for (const c of companies) for (const [k, v] of Object.entries(c.latest)) totals.set(k, (totals.get(k) ?? 0) + v)
  return {
    companies,
    totals: KPI_ORDER.filter((k) => totals.has(k)).map((metric) => ({ metric, value: totals.get(metric)! })),
    alerts: repo.listAlerts({ limit: 20 }),
    activity: repo.listActivity(undefined, 25)
  }
}

// Automatic checks run after every import and metric change.
export function runChecks(companyId: string): void {
  const threshold = getSettings().anomalyThreshold
  const company = repo.getCompany(companyId)
  if (!company) return
  const metrics = repo.listMetrics({ companyId })
  const byMetric = new Map<string, { period: string; value: number }[]>()
  for (const m of metrics) {
    if (!byMetric.has(m.metric)) byMetric.set(m.metric, [])
    byMetric.get(m.metric)!.push(m)
  }
  for (const [metric, series] of byMetric) {
    if (series.length < 2) continue
    const last = series[series.length - 1]
    const prev = series[series.length - 2]
    if (!prev.value) continue
    const change = ((last.value - prev.value) / Math.abs(prev.value)) * 100
    if (Math.abs(change) < threshold) continue
    const bad = RISING_IS_BAD.has(metric) ? change > 0 : change < 0
    repo.createAlert({
      companyId,
      severity: bad ? (Math.abs(change) >= threshold * 2 ? 'critical' : 'warning') : 'info',
      title: `${company.name}: ${metric} ${change > 0 ? '+' : ''}${change.toFixed(1)}% (${prev.period} → ${last.period})`,
      detail: `${metric}: ${prev.value.toLocaleString()} → ${last.value.toLocaleString()}`
    })
  }
  const np = byMetric.get('net_profit')
  if (np && np[np.length - 1].value < 0) {
    repo.createAlert({
      companyId,
      severity: 'critical',
      title: `${company.name}: net loss in ${np[np.length - 1].period}`,
      detail: `Net profit = ${np[np.length - 1].value.toLocaleString()}`
    })
  }
  const failed = repo.listDocuments({ companyId }).filter((d) => d.status === 'error')
  if (failed.length) {
    repo.createAlert({
      companyId,
      severity: 'warning',
      title: `${company.name}: ${failed.length} file(s) could not be read`,
      detail: failed.map((d) => `${d.name}: ${d.error}`).join('\n')
    })
  }
}

// FTS5 search over every extracted document. Terms are quoted so user input
// cannot inject FTS syntax.
export function search(query: string, companyId?: string, limit = 20): SearchHit[] {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ''))
    .filter(Boolean)
    .map((t) => `"${t}"*`)
  if (!terms.length) return []
  const match = terms.join(' ')
  const sql = `SELECT document_id, company_id, name, snippet(document_text, 3, '[', ']', ' … ', 24) AS snippet
               FROM document_text WHERE document_text MATCH ? ${companyId ? 'AND company_id = ?' : ''}
               ORDER BY rank LIMIT ?`
  const params = companyId ? [match, companyId, limit] : [match, limit]
  try {
    return (getDb().prepare(sql).all(...params) as Record<string, string>[]).map((r) => ({
      documentId: r.document_id,
      companyId: r.company_id,
      name: r.name,
      snippet: r.snippet
    }))
  } catch {
    return []
  }
}
