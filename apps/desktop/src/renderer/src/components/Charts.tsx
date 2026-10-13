import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber, metricLabel, useT } from '../i18n'

// SVG attributes cannot read CSS variables, so resolve the theme tokens and
// re-resolve when the color scheme changes.
function useTokens(): Record<string, string> {
  const read = (): Record<string, string> => {
    const cs = getComputedStyle(document.documentElement)
    const names = ['grid', 'axis', 'muted', 'ink-2', 'surface', 'series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6']
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(`--${n}`).trim()]))
  }
  const [tokens, setTokens] = useState(read)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setTokens(read())
    mq.addEventListener('change', update)
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mq.removeEventListener('change', update)
      obs.disconnect()
    }
  }, [])
  return tokens
}

// Fixed categorical order: a metric always keeps the same color.
const SERIES_SLOT: Record<string, number> = { revenue: 1, expenses: 2, net_profit: 3, cash: 4 }

export function TrendChart(props: { data: { period: string; [k: string]: number | string }[]; metrics: string[] }): React.JSX.Element {
  const { lang } = useT()
  const tk = useTokens()
  const metrics = props.metrics.slice(0, 4)
  const color = (m: string, i: number): string => tk[`series-${SERIES_SLOT[m] ?? i + 1}`]
  return (
    <div>
      {metrics.length > 1 && (
        <div className="legend">
          {metrics.map((m, i) => (
            <span key={m}>
              <i style={{ background: color(m, i) }} />
              {metricLabel(m, lang)}
            </span>
          ))}
        </div>
      )}
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={props.data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={tk.grid} vertical={false} />
          <XAxis dataKey="period" stroke={tk.axis} tick={{ fill: tk.muted, fontSize: 11 }} reversed={lang === 'ar'} tickLine={false} />
          <YAxis
            stroke={tk.axis}
            tick={{ fill: tk.muted, fontSize: 11 }}
            tickFormatter={(v: number) => formatNumber(v, lang, true)}
            orientation={lang === 'ar' ? 'right' : 'left'}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip
            cursor={{ stroke: tk.axis }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="chart-tip">
                  <div className="t">{label}</div>
                  {payload.map((p) => (
                    <div key={String(p.dataKey)}>
                      <span style={{ color: p.color }}>●</span> {metricLabel(String(p.dataKey), lang)}:{' '}
                      <strong>{formatNumber(Number(p.value), lang)}</strong>
                    </div>
                  ))}
                </div>
              ) : null
            }
          />
          {metrics.map((m, i) => (
            <Line
              key={m}
              type="monotone"
              dataKey={m}
              stroke={color(m, i)}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, stroke: tk.surface, fill: color(m, i) }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function HBarChart(props: { data: { label: string; value: number; color?: string }[]; height?: number }): React.JSX.Element {
  const { lang } = useT()
  const tk = useTokens()
  return (
    <ResponsiveContainer width="100%" height={props.height ?? Math.max(120, props.data.length * 34)}>
      <BarChart data={props.data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap={6}>
        <CartesianGrid stroke={tk.grid} horizontal={false} />
        <XAxis type="number" hide reversed={lang === 'ar'} />
        <YAxis
          type="category"
          dataKey="label"
          width={130}
          tick={{ fill: tk['ink-2'], fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          orientation={lang === 'ar' ? 'right' : 'left'}
        />
        <Tooltip
          cursor={{ fill: tk.grid, opacity: 0.4 }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <div className="chart-tip">
                <div className="t">{String(payload[0].payload.label)}</div>
                <strong>{formatNumber(Number(payload[0].value), lang)}</strong>
              </div>
            ) : null
          }
        />
        <Bar
          dataKey="value"
          fill={tk['series-1']}
          radius={lang === 'ar' ? [4, 0, 0, 4] : [0, 4, 4, 0]}
          maxBarSize={22}
          shape={(p: any) => (
            // On a mirrored (RTL) axis recharts reports a negative width.
            <rect x={p.width < 0 ? p.x + p.width : p.x} y={p.y} width={Math.abs(p.width)} height={p.height} rx={4} fill={p.payload.color ?? tk['series-1']} />
          )}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Generic multi-line chart (same unit on one axis) with a zero baseline.
export function LinesChart(props: {
  data: Record<string, number | string>[]
  series: { key: string; label: string; slot: number; dashed?: boolean }[]
  height?: number
}): React.JSX.Element {
  const { lang } = useT()
  const tk = useTokens()
  const color = (slot: number): string => tk[`series-${slot}`]
  return (
    <div>
      <div className="legend">
        {props.series.map((s) => (
          <span key={s.key}>
            <i style={{ background: color(s.slot), opacity: s.dashed ? 0.6 : 1 }} />
            {s.label}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={props.height ?? 280}>
        <LineChart data={props.data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={tk.grid} vertical={false} />
          <XAxis dataKey="period" stroke={tk.axis} tick={{ fill: tk.muted, fontSize: 11 }} reversed={lang === 'ar'} tickLine={false} />
          <YAxis
            stroke={tk.axis}
            tick={{ fill: tk.muted, fontSize: 11 }}
            tickFormatter={(v: number) => formatNumber(v, lang, true)}
            orientation={lang === 'ar' ? 'right' : 'left'}
            axisLine={false}
            tickLine={false}
            width={60}
          />
          <ReferenceLine y={0} stroke={tk.axis} />
          <Tooltip
            cursor={{ stroke: tk.axis }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="chart-tip">
                  <div className="t">{label}</div>
                  {payload.map((p) => (
                    <div key={String(p.dataKey)}>
                      <span style={{ color: p.color }}>●</span> {props.series.find((s) => s.key === p.dataKey)?.label}:{' '}
                      <strong>{formatNumber(Number(p.value), lang)}</strong>
                    </div>
                  ))}
                </div>
              ) : null
            }
          />
          {props.series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={color(s.slot)}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              dot={false}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
