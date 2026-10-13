// Cash-flow forecast and what-if scenarios. Pure functions shared by the main
// process (reports, AI tool) and the renderer (live sliders).

export interface HistoryPoint {
  period: string // YYYY-MM
  revenue?: number
  expenses?: number
  cash?: number
}

export interface OneOff {
  period: string
  amount: number // positive = inflow, negative = outflow
  label: string
}

export interface Scenario {
  revenueChangePct: number // applied on top of the trend, e.g. -10
  expenseChangePct: number
  collectionDelayMonths: number // revenue is collected N months later
  growthOverridePct: number | null // replace the detected monthly revenue growth
  oneOffs: OneOff[]
}

export const BASE_SCENARIO: Scenario = {
  revenueChangePct: 0,
  expenseChangePct: 0,
  collectionDelayMonths: 0,
  growthOverridePct: null,
  oneOffs: []
}

export interface ForecastPoint {
  period: string
  revenue: number
  inflow: number
  expenses: number
  net: number
  cash: number
}

export interface Forecast {
  startCash: number
  startCashKnown: boolean
  revenueGrowthPct: number
  expenseGrowthPct: number
  points: ForecastPoint[]
  minCash: number
  minCashPeriod: string | null
  firstNegativePeriod: string | null
  runwayMonths: number | null // months until cash runs out; null = never within horizon
  warnings: string[]
}

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

// Average month-over-month growth across the last `window` months.
function monthlyGrowth(values: number[], window = 6): number {
  const v = values.slice(-window - 1)
  const rates: number[] = []
  for (let i = 1; i < v.length; i++) if (v[i - 1] > 0) rates.push(v[i] / v[i - 1] - 1)
  if (!rates.length) return 0
  return clamp(rates.reduce((a, b) => a + b, 0) / rates.length, -0.2, 0.2)
}

const avgLast = (values: number[], n = 3): number => {
  const v = values.slice(-n)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
}

export function forecastCash(history: HistoryPoint[], scenario: Scenario = BASE_SCENARIO, horizon = 12): Forecast {
  const hist = [...history].filter((h) => /^\d{4}-\d{2}$/.test(h.period)).sort((a, b) => a.period.localeCompare(b.period))
  const warnings: string[] = []
  const revenues = hist.filter((h) => h.revenue !== undefined).map((h) => h.revenue!)
  const expenses = hist.filter((h) => h.expenses !== undefined).map((h) => h.expenses!)
  if (revenues.length < 3) warnings.push('less_than_3_months_revenue')
  if (expenses.length < 3) warnings.push('less_than_3_months_expenses')

  const cashPoint = [...hist].reverse().find((h) => h.cash !== undefined)
  const startCash = cashPoint?.cash ?? 0
  if (!cashPoint) warnings.push('no_cash_balance')

  const revGrowth = scenario.growthOverridePct !== null ? scenario.growthOverridePct / 100 : monthlyGrowth(revenues)
  const expGrowth = monthlyGrowth(expenses)
  const revBase = avgLast(revenues)
  const expBase = avgLast(expenses)
  const lastPeriod = hist.length ? hist[hist.length - 1].period : new Date().toISOString().slice(0, 7)
  const startPeriod = cashPoint?.period ?? lastPeriod

  const projectedRevenue: number[] = []
  const points: ForecastPoint[] = []
  let cash = startCash
  for (let i = 1; i <= horizon; i++) {
    const period = addMonths(startPeriod, i)
    const revenue = revBase * Math.pow(1 + revGrowth, i) * (1 + scenario.revenueChangePct / 100)
    projectedRevenue.push(revenue)
    // With a collection delay, this month's cash comes from revenue earned
    // `delay` months earlier (actuals for the first months).
    const delay = Math.max(0, Math.round(scenario.collectionDelayMonths))
    const sourceIndex = i - 1 - delay
    const inflow = sourceIndex >= 0 ? projectedRevenue[sourceIndex] : (revenues[revenues.length + sourceIndex] ?? revBase)
    const exp = expBase * Math.pow(1 + expGrowth, i) * (1 + scenario.expenseChangePct / 100)
    const oneOff = scenario.oneOffs.filter((o) => o.period === period).reduce((s, o) => s + o.amount, 0)
    const net = inflow - exp + oneOff
    cash += net
    points.push({ period, revenue, inflow, expenses: exp, net, cash })
  }

  let minCash = startCash
  let minCashPeriod: string | null = null
  for (const p of points) {
    if (p.cash < minCash) {
      minCash = p.cash
      minCashPeriod = p.period
    }
  }
  const negIndex = points.findIndex((p) => p.cash < 0)
  return {
    startCash,
    startCashKnown: !!cashPoint,
    revenueGrowthPct: revGrowth * 100,
    expenseGrowthPct: expGrowth * 100,
    points,
    minCash,
    minCashPeriod,
    firstNegativePeriod: negIndex >= 0 ? points[negIndex].period : null,
    runwayMonths: negIndex >= 0 ? negIndex : null,
    warnings
  }
}

// Metrics where spending less than budget is the good outcome.
export const RISING_IS_BAD = new Set(['expenses', 'payables', 'payroll', 'debt', 'cost_of_sales'])
