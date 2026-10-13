// Pure calculations over the replicated tables (mirrors apps/desktop/src/main/insights.ts & planning.ts).
import type { Alert, Budget, Company, Metric, Reminder } from './api'
import { daysUntil } from './format'

export const KPI_ORDER = ['revenue', 'expenses', 'net_profit', 'cash', 'receivables', 'payables', 'gross_margin', 'payroll']
export const CONSOLIDATED_METRICS = ['revenue', 'expenses', 'net_profit', 'cash']

/** Metrics where a rise is bad news. */
export const RISING_IS_BAD = new Set(['expenses', 'payables', 'payroll', 'debt', 'cost_of_sales'])

const kpiRank = (m: string) => {
  const i = KPI_ORDER.indexOf(m)
  return i < 0 ? 99 : i
}

export interface Kpi {
  metric: string
  value: number
  previous: number | null
  changePct: number | null
  period: string
  currency: string | null
  /** true = good news, false = bad news, null = flat / unknown */
  good: boolean | null
}

const byPeriod = (a: { period: string }, b: { period: string }) => a.period.localeCompare(b.period)

export function companyKpis(metrics: Metric[], company?: Company): Kpi[] {
  const groups = new Map<string, Metric[]>()
  for (const m of metrics) {
    if (!groups.has(m.metric)) groups.set(m.metric, [])
    groups.get(m.metric)!.push(m)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => kpiRank(a) - kpiRank(b) || a.localeCompare(b))
    .map(([metric, rows]) => {
      const series = [...rows].sort(byPeriod)
      const last = series[series.length - 1]
      const prev = series.length > 1 ? series[series.length - 2] : null
      const changePct = prev && prev.value !== 0 ? ((last.value - prev.value) / Math.abs(prev.value)) * 100 : null
      const good = changePct === null || changePct === 0 ? null : RISING_IS_BAD.has(metric) ? changePct < 0 : changePct > 0
      return {
        metric,
        value: last.value,
        previous: prev?.value ?? null,
        changePct,
        period: last.period,
        currency: last.currency || company?.currency || null,
        good
      }
    })
}

export interface ConsolidatedKpi {
  metric: string
  totals: { currency: string; value: number }[]
}

/** Sums each company's latest value per metric, kept separate per currency. */
export function consolidatedKpis(metrics: Metric[], companies: Company[]): ConsolidatedKpi[] {
  const companyById = new Map(companies.map((c) => [c.id, c]))
  const latest = new Map<string, Metric>() // `${company}|${metric}` -> latest row
  for (const m of metrics) {
    if (!CONSOLIDATED_METRICS.includes(m.metric)) continue
    const key = `${m.company_id}|${m.metric}`
    const cur = latest.get(key)
    if (!cur || m.period > cur.period) latest.set(key, m)
  }
  return CONSOLIDATED_METRICS.map((metric) => {
    const sums = new Map<string, number>()
    for (const m of latest.values()) {
      if (m.metric !== metric) continue
      const cur = m.currency || companyById.get(m.company_id)?.currency || ''
      sums.set(cur, (sums.get(cur) ?? 0) + m.value)
    }
    return { metric, totals: [...sums.entries()].map(([currency, value]) => ({ currency, value })) }
  }).filter((k) => k.totals.length > 0)
}

export interface TrendPoint {
  period: string
  revenue: number | null
  expenses: number | null
}

export function revenueExpenseTrend(metrics: Metric[], months = 12): TrendPoint[] {
  const periods = [...new Set(metrics.filter((m) => m.metric === 'revenue' || m.metric === 'expenses').map((m) => m.period))]
    .sort()
    .slice(-months)
  return periods.map((period) => {
    const find = (metric: string) => metrics.find((m) => m.metric === metric && m.period === period)?.value ?? null
    return { period, revenue: find('revenue'), expenses: find('expenses') }
  })
}

export interface BudgetLine {
  metric: string
  period: string
  budget: number
  actual: number | null
  variance: number | null
  variancePct: number | null
  favorable: boolean | null
}

/** Budget vs actual for the latest budgeted period. */
export function budgetVsActual(budgets: Budget[], metrics: Metric[]): { period: string | null; lines: BudgetLine[] } {
  const period = budgets.reduce<string | null>((p, b) => (!p || b.period > p ? b.period : p), null)
  if (!period) return { period: null, lines: [] }
  const lines = budgets
    .filter((b) => b.period === period)
    .sort((a, b) => kpiRank(a.metric) - kpiRank(b.metric))
    .map((b) => {
      const actual = metrics.find((m) => m.metric === b.metric && m.period === period)?.value ?? null
      const variance = actual === null ? null : actual - b.amount
      const variancePct = variance === null || !b.amount ? null : (variance / Math.abs(b.amount)) * 100
      const favorable = variance === null ? null : RISING_IS_BAD.has(b.metric) ? variance <= 0 : variance >= 0
      return { metric: b.metric, period, budget: b.amount, actual, variance, variancePct, favorable }
    })
  return { period, lines }
}

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const

export function openAlerts(alerts: Alert[]): Alert[] {
  return alerts
    .filter((a) => !Number(a.resolved))
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) || b.created_at.localeCompare(a.created_at))
}

export function openReminders(reminders: Reminder[]): Reminder[] {
  return reminders.filter((r) => r.status === 'open' && r.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))
}

export type ReminderBucket = 'overdue' | 'thisWeek' | 'thisMonth' | 'later'

export function bucketOf(r: Reminder, now = new Date()): ReminderBucket {
  const d = daysUntil(r.due_date, now)
  if (d < 0) return 'overdue'
  if (d <= 7) return 'thisWeek'
  if (d <= 31) return 'thisMonth'
  return 'later'
}

export function groupReminders(reminders: Reminder[], now = new Date()): { bucket: ReminderBucket; items: Reminder[] }[] {
  const order: ReminderBucket[] = ['overdue', 'thisWeek', 'thisMonth', 'later']
  const map = new Map<ReminderBucket, Reminder[]>(order.map((b) => [b, []]))
  for (const r of openReminders(reminders)) map.get(bucketOf(r, now))!.push(r)
  return order.map((bucket) => ({ bucket, items: map.get(bucket)! })).filter((g) => g.items.length > 0)
}

export function parseTags(tags: string | null): string[] {
  if (!tags) return []
  try {
    const v: unknown = JSON.parse(tags)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}
