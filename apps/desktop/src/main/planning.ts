// Budgets, budget-vs-actual, and the data feed for cash forecasts.
import { getDb, now, uid } from './db'
import { dataChanged } from './events'
import * as repo from './repo'
import { forecastCash, RISING_IS_BAD, type Forecast, type HistoryPoint, type Scenario } from '@shared/forecast'
import type { Budget, BudgetLine } from '@shared/types'

type Row = Record<string, any>

const toBudget = (r: Row): Budget => ({
  id: r.id,
  companyId: r.company_id,
  metric: r.metric,
  period: r.period,
  amount: r.amount,
  note: r.note
})

export function listBudgets(companyId: string, from?: string, to?: string): Budget[] {
  const where = ['company_id = ?', 'deleted = 0']
  const params: unknown[] = [companyId]
  if (from) {
    where.push('period >= ?')
    params.push(from)
  }
  if (to) {
    where.push('period <= ?')
    params.push(to)
  }
  const rows = getDb().prepare(`SELECT * FROM budgets WHERE ${where.join(' AND ')} ORDER BY period, metric`).all(...params) as Row[]
  return rows.map(toBudget)
}

export function setBudget(b: { companyId: string; metric: string; period: string; amount: number; note?: string }): Budget {
  const d = getDb()
  const ts = now()
  const metric = b.metric.trim().toLowerCase().replace(/\s+/g, '_')
  const existing = d
    .prepare('SELECT id FROM budgets WHERE company_id = ? AND metric = ? AND period = ? AND deleted = 0')
    .get(b.companyId, metric, b.period) as Row | undefined
  const id = existing?.id ?? uid()
  if (existing) {
    d.prepare('UPDATE budgets SET amount = ?, note = ?, updated_at = ? WHERE id = ?').run(b.amount, b.note ?? '', ts, id)
  } else {
    d.prepare(
      'INSERT INTO budgets (id, company_id, metric, period, amount, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, b.companyId, metric, b.period, b.amount, b.note ?? '', ts, ts)
  }
  dataChanged('budgets')
  return toBudget(d.prepare('SELECT * FROM budgets WHERE id = ?').get(id) as Row)
}

export function deleteBudget(id: string): void {
  getDb().prepare('UPDATE budgets SET deleted = 1, updated_at = ? WHERE id = ?').run(now(), id)
  dataChanged('budgets')
}

export function budgetVsActual(companyId: string, from?: string, to?: string): BudgetLine[] {
  const actuals = new Map(repo.listMetrics({ companyId, from, to }).map((m) => [`${m.metric}|${m.period}`, m.value]))
  return listBudgets(companyId, from, to).map((b) => {
    const actual = actuals.get(`${b.metric}|${b.period}`) ?? null
    const variance = actual === null ? null : actual - b.amount
    const variancePct = variance === null || !b.amount ? null : (variance / Math.abs(b.amount)) * 100
    const favorable = variance === null ? null : RISING_IS_BAD.has(b.metric) ? variance <= 0 : variance >= 0
    return { metric: b.metric, period: b.period, budget: b.amount, actual, variance, variancePct, favorable }
  })
}

export function forecastHistory(companyId: string): HistoryPoint[] {
  const byPeriod = new Map<string, HistoryPoint>()
  for (const m of repo.listMetrics({ companyId })) {
    if (!['revenue', 'expenses', 'cash'].includes(m.metric) || !/^\d{4}-\d{2}$/.test(m.period)) continue
    const p = byPeriod.get(m.period) ?? { period: m.period }
    p[m.metric as 'revenue' | 'expenses' | 'cash'] = m.value
    byPeriod.set(m.period, p)
  }
  return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period))
}

export function companyForecast(companyId: string, scenario?: Scenario, horizon = 12): Forecast {
  return forecastCash(forecastHistory(companyId), scenario, horizon)
}
