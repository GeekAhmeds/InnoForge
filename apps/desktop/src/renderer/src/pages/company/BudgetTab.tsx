import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useLive } from '../../hooks'
import { formatNumber, metricLabel, useT } from '../../i18n'
import { RISING_IS_BAD } from '@shared/forecast'
import type { Company } from '@shared/types'

const METRICS = ['revenue', 'expenses', 'net_profit', 'payroll', 'gross_margin', 'cash']

export function BudgetTab({ company, canEdit }: { company: Company; canEdit: boolean }): React.JSX.Element {
  const { lang, t } = useT()
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const from = `${year}-01`
  const to = `${year}-12`
  const [lines] = useLive(() => window.azim.planning.budgetVsActual(company.id, from, to), [company.id, year], ['budgets', 'metrics'])
  const [budgets] = useLive(() => window.azim.planning.budgets(company.id), [company.id], ['budgets'])
  const [form, setForm] = useState({ metric: 'revenue', period: new Date().toISOString().slice(0, 7), amount: '' })
  const budgetId = (metric: string, period: string): string | undefined => budgets?.find((b) => b.metric === metric && b.period === period)?.id

  // Year-to-date totals per metric (only months that have actuals).
  const ytd = new Map<string, { budget: number; actual: number }>()
  for (const l of lines ?? []) {
    if (l.actual === null) continue
    const cur = ytd.get(l.metric) ?? { budget: 0, actual: 0 }
    cur.budget += l.budget
    cur.actual += l.actual
    ytd.set(l.metric, cur)
  }

  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="row">
        <select className="input" style={{ maxWidth: 140 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t.budgetHint}</span>
      </div>

      {ytd.size > 0 && (
        <div className="grid kpis">
          {[...ytd.entries()].map(([metric, v]) => {
            const pct = v.budget ? ((v.actual - v.budget) / Math.abs(v.budget)) * 100 : 0
            const good = RISING_IS_BAD.has(metric) ? v.actual <= v.budget : v.actual >= v.budget
            return (
              <div className="card kpi" key={metric}>
                <div className="label">{metricLabel(metric, lang)} — YTD</div>
                <div className="value">{formatNumber(v.actual, lang, Math.abs(v.actual) >= 1e6)}</div>
                <div className={`delta ${good ? 'good' : 'bad'}`}>
                  {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% {good ? t.favorable : t.unfavorable}
                </div>
                <div className="period">
                  {t.budget}: {formatNumber(v.budget, lang)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="card">
        {canEdit && (
          <form
            className="row"
            style={{ marginBottom: 14, alignItems: 'flex-end' }}
            onSubmit={async (e) => {
              e.preventDefault()
              const amount = Number(form.amount)
              if (!Number.isFinite(amount) || !/^\d{4}-\d{2}$/.test(form.period)) return
              await window.azim.planning.saveBudget({ companyId: company.id, metric: form.metric, period: form.period, amount })
              setForm({ ...form, amount: '' })
            }}
          >
            <div className="field">
              <label>{t.metric}</label>
              <select className="input" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}>
                {METRICS.map((m) => (
                  <option key={m} value={m}>
                    {metricLabel(m, lang)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>{t.period}</label>
              <input className="input" type="month" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} />
            </div>
            <div className="field">
              <label>{t.amount}</label>
              <input className="input" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <button className="btn primary" type="submit" style={{ marginBottom: 12 }}>
              {t.addBudget}
            </button>
          </form>
        )}
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t.period}</th>
                <th>{t.metric}</th>
                <th style={{ textAlign: 'end' }}>{t.budget}</th>
                <th style={{ textAlign: 'end' }}>{t.actual}</th>
                <th style={{ textAlign: 'end' }}>{t.variance}</th>
                <th style={{ textAlign: 'end' }}>%</th>
                <th>{t.status}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(lines ?? []).map((l) => (
                <tr key={`${l.metric}-${l.period}`}>
                  <td>{l.period}</td>
                  <td>{metricLabel(l.metric, lang)}</td>
                  <td className="num">{formatNumber(l.budget, lang)}</td>
                  <td className="num">{l.actual === null ? '—' : formatNumber(l.actual, lang)}</td>
                  <td className="num">{l.variance === null ? '—' : formatNumber(l.variance, lang)}</td>
                  <td className="num">{l.variancePct === null ? '—' : `${l.variancePct > 0 ? '+' : ''}${l.variancePct.toFixed(1)}%`}</td>
                  <td>
                    {l.favorable === null ? (
                      '—'
                    ) : (
                      <span className={`delta ${l.favorable ? 'good' : 'bad'}`}>
                        {l.favorable ? '✓' : '✗'} {l.favorable ? t.favorable : t.unfavorable}
                      </span>
                    )}
                  </td>
                  <td>
                    {canEdit && budgetId(l.metric, l.period) && (
                      <button className="btn ghost sm danger" onClick={() => window.azim.planning.removeBudget(budgetId(l.metric, l.period)!)}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!lines?.length && <div className="empty">{t.noData}</div>}
        </div>
      </div>
    </div>
  )
}
