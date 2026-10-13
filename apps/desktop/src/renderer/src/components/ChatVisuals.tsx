import { useEffect, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Copy, Table2 } from 'lucide-react'
import { formatNumber, useT } from '../i18n'
import { toast } from './Toast'
import type { ChartSpec } from '@shared/types'

function useTokens(): Record<string, string> {
  const read = (): Record<string, string> => {
    const cs = getComputedStyle(document.documentElement)
    return Object.fromEntries(['grid', 'axis', 'muted', 'ink-2', 'surface', ...Array.from({ length: 8 }, (_, i) => `series-${i + 1}`)].map((n) => [n, cs.getPropertyValue(`--${n}`).trim()]))
  }
  const [tk, setTk] = useState(read)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setTk(read())
    mq.addEventListener('change', update)
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mq.removeEventListener('change', update)
      obs.disconnect()
    }
  }, [])
  return tk
}

/** A chart the agent drew, rendered interactively. */
export function ChatChart({ spec }: { spec: ChartSpec }): React.JSX.Element {
  const { lang, t } = useT()
  const tk = useTokens()
  const [asTable, setAsTable] = useState(false)
  const color = (i: number): string => tk[`series-${(i % 8) + 1}`]
  const data = spec.labels.map((label, i) => Object.fromEntries([['label', label], ...spec.series.map((s, j) => [`s${j}`, s.values[i]])]))
  const fmt = (v: number): string => formatNumber(v, lang, true)
  const tip = (
    <Tooltip
      cursor={{ fill: tk.grid, opacity: 0.35, stroke: tk.axis }}
      content={({ active, payload, label }) =>
        active && payload?.length ? (
          <div className="chart-tip">
            <div className="t">{label ?? payload[0]?.name}</div>
            {payload.map((p) => (
              <div key={String(p.dataKey)}>
                <span style={{ color: p.color ?? p.payload?.fill }}>●</span> {spec.type === 'donut' ? p.name : spec.series[Number(String(p.dataKey).slice(1))]?.name}:{' '}
                <strong>{formatNumber(Number(p.value), lang)}</strong> {spec.unit ?? ''}
              </div>
            ))}
          </div>
        ) : null
      }
    />
  )
  const xAxis = <XAxis dataKey="label" stroke={tk.axis} tick={{ fill: tk.muted, fontSize: 11 }} tickLine={false} reversed={lang === 'ar'} />
  const yAxis = <YAxis stroke={tk.axis} tick={{ fill: tk.muted, fontSize: 11 }} tickFormatter={fmt} axisLine={false} tickLine={false} width={56} orientation={lang === 'ar' ? 'right' : 'left'} />
  const grid = <CartesianGrid stroke={tk.grid} vertical={false} />
  const margin = { top: 8, right: 12, left: 8, bottom: 0 }

  let chart: React.ReactElement
  if (spec.type === 'line') {
    chart = (
      <LineChart data={data} margin={margin}>
        {grid}
        {xAxis}
        {yAxis}
        {tip}
        {spec.series.map((s, j) => (
          <Line key={j} dataKey={`s${j}`} stroke={color(j)} strokeWidth={2} dot={{ r: 3, fill: color(j), stroke: tk.surface, strokeWidth: 2 }} connectNulls />
        ))}
      </LineChart>
    )
  } else if (spec.type === 'area') {
    chart = (
      <AreaChart data={data} margin={margin}>
        {grid}
        {xAxis}
        {yAxis}
        {tip}
        {spec.series.map((s, j) => (
          <Area key={j} dataKey={`s${j}`} stroke={color(j)} strokeWidth={2} fill={color(j)} fillOpacity={0.15} connectNulls />
        ))}
      </AreaChart>
    )
  } else if (spec.type === 'donut') {
    const slices = spec.labels.map((label, i) => ({ name: label, value: spec.series[0]?.values[i] ?? 0 }))
    chart = (
      <PieChart>
        {tip}
        <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" stroke={tk.surface} strokeWidth={2}>
          {slices.map((_, i) => (
            <Cell key={i} fill={color(i)} />
          ))}
        </Pie>
      </PieChart>
    )
  } else if (spec.type === 'horizontal_bar') {
    chart = (
      <BarChart data={data} layout="vertical" margin={margin} barCategoryGap={6}>
        <CartesianGrid stroke={tk.grid} horizontal={false} />
        <XAxis type="number" stroke={tk.axis} tick={{ fill: tk.muted, fontSize: 11 }} tickFormatter={fmt} reversed={lang === 'ar'} />
        <YAxis type="category" dataKey="label" width={130} tick={{ fill: tk['ink-2'], fontSize: 12 }} axisLine={false} tickLine={false} orientation={lang === 'ar' ? 'right' : 'left'} />
        {tip}
        {spec.series.map((s, j) => (
          <Bar key={j} dataKey={`s${j}`} fill={color(j)} radius={4} maxBarSize={22} />
        ))}
      </BarChart>
    )
  } else {
    const stacked = spec.type === 'stacked_bar'
    chart = (
      <BarChart data={data} margin={margin}>
        {grid}
        {xAxis}
        {yAxis}
        {tip}
        {spec.series.map((s, j) => (
          <Bar key={j} dataKey={`s${j}`} fill={color(j)} stackId={stacked ? 'a' : undefined} radius={stacked ? 0 : [4, 4, 0, 0]} maxBarSize={40} />
        ))}
      </BarChart>
    )
  }

  const legendItems = spec.type === 'donut' ? spec.labels : spec.series.length > 1 ? spec.series.map((s) => s.name) : []
  return (
    <div className="visual">
      <div className="visual-head">
        <div>
          <strong>{spec.title}</strong>
          {spec.subtitle && <div className="meta">{spec.subtitle}</div>}
        </div>
        <button className="btn ghost sm" title={t.tableView} onClick={() => setAsTable((v) => !v)}>
          <Table2 size={14} />
        </button>
      </div>
      {legendItems.length > 0 && (
        <div className="legend">
          {legendItems.map((name, i) => (
            <span key={i}>
              <i style={{ background: color(i) }} />
              {name}
            </span>
          ))}
        </div>
      )}
      {asTable ? (
        <DataTable columns={['', ...spec.series.map((s) => s.name)]} rows={spec.labels.map((l, i) => [l, ...spec.series.map((s) => s.values[i])])} />
      ) : (
        <ResponsiveContainer width="100%" height={spec.type === 'horizontal_bar' ? Math.max(200, spec.labels.length * 30) : 280}>
          {chart}
        </ResponsiveContainer>
      )}
      {spec.unit && <div className="meta">{spec.unit}</div>}
    </div>
  )
}

export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number | null)[][] }): React.JSX.Element {
  const { lang } = useT()
  return (
    <div className="table-wrap" style={{ maxHeight: 360 }}>
      <table className="data">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} style={{ textAlign: i && rows.some((r) => typeof r[i] === 'number') ? 'end' : undefined }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((r, i) => (
            <tr key={i}>
              {columns.map((_, j) => (
                <td key={j} className={typeof r[j] === 'number' ? 'num' : ''}>
                  {typeof r[j] === 'number' ? formatNumber(r[j] as number, lang) : String(r[j] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A table the agent showed; copies as tab-separated text that pastes straight into Excel. */
export function ChatTable({ title, columns, rows }: { title: string; columns: string[]; rows: (string | number | null)[][] }): React.JSX.Element {
  const { t } = useT()
  return (
    <div className="visual">
      <div className="visual-head">
        <strong>{title}</strong>
        <button
          className="btn ghost sm"
          title={t.copyForExcel}
          onClick={async () => {
            const tsv = [columns, ...rows].map((r) => r.map((v) => String(v ?? '').replace(/\t|\n/g, ' ')).join('\t')).join('\n')
            await navigator.clipboard.writeText(tsv)
            toast(t.copied)
          }}
        >
          <Copy size={14} /> {t.copyForExcel}
        </button>
      </div>
      <DataTable columns={columns} rows={rows} />
    </div>
  )
}
