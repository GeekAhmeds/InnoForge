import { useMemo, useState } from 'react'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useLive } from '../../hooks'
import { formatNumber, useT } from '../../i18n'
import { LinesChart } from '../../components/Charts'
import { BASE_SCENARIO, forecastCash, type Scenario } from '@shared/forecast'
import type { Company } from '@shared/types'

function Slider(props: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void }): React.JSX.Element {
  return (
    <div className="field">
      <label>
        {props.label}: <strong style={{ color: 'var(--ink)' }}>{props.value > 0 && props.suffix === '%' ? '+' : ''}{props.value}{props.suffix}</strong>
      </label>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </div>
  )
}

export function ForecastTab({ company }: { company: Company }): React.JSX.Element {
  const { lang, t } = useT()
  const [history] = useLive(() => window.azim.planning.forecastHistory(company.id), [company.id], ['metrics'])
  const [scenario, setScenario] = useState<Scenario>(BASE_SCENARIO)
  const [horizon, setHorizon] = useState(12)
  const set = (p: Partial<Scenario>): void => setScenario((s) => ({ ...s, ...p }))

  // Recomputed on every slider move: the engine is pure and runs in the renderer.
  const base = useMemo(() => forecastCash(history ?? [], BASE_SCENARIO, horizon), [history, horizon])
  const scen = useMemo(() => forecastCash(history ?? [], scenario, horizon), [history, scenario, horizon])
  if (!history) return <div className="empty">…</div>

  const data = base.points.map((p, i) => ({ period: p.period, baseline: Math.round(p.cash), scenario: Math.round(scen.points[i].cash) }))
  const fmt = (v: number): string => `${formatNumber(v, lang, Math.abs(v) >= 1e6)} ${company.currency}`
  const nextPeriod = base.points[0]?.period ?? new Date().toISOString().slice(0, 7)

  return (
    <div className="grid" style={{ gap: 20 }}>
      {(scen.warnings.length > 0 || !history.length) && (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          {!scen.startCashKnown && <div>⚠️ {t.warnNoCash}</div>}
          {scen.warnings.some((w) => w.startsWith('less_than')) && <div>⚠️ {t.warnShortHistory}</div>}
        </div>
      )}
      <div className="grid kpis">
        <div className="card kpi">
          <div className="label">{t.startCash}</div>
          <div className="value">{fmt(scen.startCash)}</div>
        </div>
        <div className="card kpi">
          <div className="label">{t.lowestCash}</div>
          <div className="value" style={{ color: scen.minCash < 0 ? 'var(--bad)' : undefined }}>{fmt(scen.minCash)}</div>
          <div className="period">{scen.minCashPeriod ?? '—'}</div>
        </div>
        <div className="card kpi">
          <div className="label">{t.runway}</div>
          <div className="value" style={{ color: scen.firstNegativePeriod ? 'var(--bad)' : 'var(--good)', fontSize: 18 }}>
            {scen.firstNegativePeriod ? `${scen.runwayMonths} ${t.months}` : t.noShortfall}
          </div>
          {scen.firstNegativePeriod && (
            <div className="period">
              {t.cashNegativeIn} {scen.firstNegativePeriod}
            </div>
          )}
        </div>
        <div className="card kpi">
          <div className="label">{t.detectedGrowth}</div>
          <div className="value" style={{ fontSize: 18 }}>
            {base.revenueGrowthPct >= 0 ? '+' : ''}
            {base.revenueGrowthPct.toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h3>{t.forecast}</h3>
          <LinesChart
            data={data}
            series={[
              { key: 'baseline', label: t.baseline, slot: 1, dashed: true },
              { key: 'scenario', label: t.withScenario, slot: 2 }
            ]}
          />
        </div>
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>{t.scenario}</h3>
            <div className="spacer" />
            <button className="btn sm" onClick={() => setScenario(BASE_SCENARIO)}>
              <RotateCcw size={13} /> {t.reset}
            </button>
          </div>
          <Slider label={t.revenueChange} value={scenario.revenueChangePct} min={-50} max={50} suffix="%" onChange={(v) => set({ revenueChangePct: v })} />
          <Slider label={t.expenseChange} value={scenario.expenseChangePct} min={-50} max={50} suffix="%" onChange={(v) => set({ expenseChangePct: v })} />
          <Slider label={t.collectionDelay} value={scenario.collectionDelayMonths} min={0} max={6} onChange={(v) => set({ collectionDelayMonths: v })} />
          <div className="field">
            <label className="check" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={scenario.growthOverridePct === null}
                onChange={(e) => set({ growthOverridePct: e.target.checked ? null : Math.round(base.revenueGrowthPct) })}
              />
              {t.growthOverride}: {t.auto}
            </label>
            {scenario.growthOverridePct !== null && (
              <Slider label={t.growthOverride} value={scenario.growthOverridePct} min={-15} max={15} suffix="%" onChange={(v) => set({ growthOverridePct: v })} />
            )}
          </div>
          <Slider label={t.horizon} value={horizon} min={3} max={36} onChange={setHorizon} />
          <div className="field">
            <label>{t.oneOffs}</label>
            {scenario.oneOffs.map((o, i) => (
              <div className="row" key={i} style={{ marginBottom: 6 }}>
                <input
                  className="input"
                  type="month"
                  value={o.period}
                  onChange={(e) => set({ oneOffs: scenario.oneOffs.map((x, j) => (j === i ? { ...x, period: e.target.value } : x)) })}
                />
                <input
                  className="input"
                  inputMode="decimal"
                  placeholder={t.amount}
                  value={o.amount || ''}
                  onChange={(e) => set({ oneOffs: scenario.oneOffs.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) || 0 } : x)) })}
                />
                <input
                  className="input"
                  placeholder={t.label}
                  value={o.label}
                  onChange={(e) => set({ oneOffs: scenario.oneOffs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                />
                <button className="btn ghost sm danger" onClick={() => set({ oneOffs: scenario.oneOffs.filter((_, j) => j !== i) })}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button className="btn sm" onClick={() => set({ oneOffs: [...scenario.oneOffs, { period: nextPeriod, amount: 0, label: '' }] })}>
              <Plus size={13} /> {t.addOneOff}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t.period}</th>
                <th style={{ textAlign: 'end' }}>{t.inflows}</th>
                <th style={{ textAlign: 'end' }}>{t.outflows}</th>
                <th style={{ textAlign: 'end' }}>{t.net}</th>
                <th style={{ textAlign: 'end' }}>{t.withScenario}</th>
                <th style={{ textAlign: 'end' }}>{t.baseline}</th>
              </tr>
            </thead>
            <tbody>
              {scen.points.map((p, i) => (
                <tr key={p.period}>
                  <td>{p.period}</td>
                  <td className="num">{formatNumber(Math.round(p.inflow), lang)}</td>
                  <td className="num">{formatNumber(Math.round(p.expenses), lang)}</td>
                  <td className="num" style={{ color: p.net < 0 ? 'var(--bad)' : undefined }}>{formatNumber(Math.round(p.net), lang)}</td>
                  <td className="num" style={{ fontWeight: 600, color: p.cash < 0 ? 'var(--bad)' : undefined }}>{formatNumber(Math.round(p.cash), lang)}</td>
                  <td className="num" style={{ color: 'var(--ink-2)' }}>{formatNumber(Math.round(base.points[i].cash), lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
