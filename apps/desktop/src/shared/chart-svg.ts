// Static SVG rendering of a ChartSpec for reports (PDF/Word/Excel). The chat
// renders the same spec interactively with recharts. Colors follow the app's
// categorical palette in fixed order; one value axis per chart.
import type { ChartSpec } from './types'

export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const INK = '#0b0b0b'
const INK2 = '#52514e'
const MUTED = '#898781'
const GRID = '#e1e0d9'
const AXIS = '#c3c2b7'

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function compact(v: number, lang: 'ar' | 'en' = 'en'): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) max = min + 1
  const span = max - min
  const step0 = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag
  // Cover the whole range: the last tick is at or above the maximum.
  const ticks: number[] = []
  let v = Math.floor(min / step) * step
  do {
    ticks.push(Math.round(v * 1e6) / 1e6)
    v += step
  } while (ticks[ticks.length - 1] < max - step * 1e-9)
  return ticks
}

export function renderChartSvg(spec: ChartSpec, opts: { width?: number; height?: number; lang?: 'ar' | 'en' } = {}): string {
  const W = opts.width ?? 760
  const H = opts.height ?? 360
  const lang = opts.lang ?? 'en'
  const rtl = lang === 'ar'
  const font = `font-family="Segoe UI, Noto Sans Arabic, Tahoma, Arial, sans-serif"`
  const series = spec.series.slice(0, 8)
  const labels = spec.labels
  const head = `<text x="${rtl ? W - 8 : 8}" y="22" text-anchor="${rtl ? 'end' : 'start'}" font-size="15" font-weight="600" fill="${INK}">${esc(spec.title)}</text>` +
    (spec.subtitle ? `<text x="${rtl ? W - 8 : 8}" y="40" text-anchor="${rtl ? 'end' : 'start'}" font-size="11" fill="${INK2}">${esc(spec.subtitle)}</text>` : '')
  // Legend (always for 2+ series): text in ink, swatch carries the color.
  let legend = ''
  if (series.length > 1 || spec.type === 'donut') {
    const items = spec.type === 'donut' ? labels.map((l, i) => ({ name: l, color: SERIES_COLORS[i % 8] })) : series.map((s, i) => ({ name: s.name, color: SERIES_COLORS[i] }))
    let x = rtl ? W - 8 : 8
    const y = spec.subtitle ? 58 : 44
    for (const it of items) {
      const w = Math.min(160, 22 + it.name.length * 6.5)
      const sx = rtl ? x - 12 : x
      legend += `<rect x="${sx}" y="${y - 8}" width="12" height="4" rx="2" fill="${it.color}"/>` +
        `<text x="${rtl ? sx - 6 : sx + 18}" y="${y - 3}" text-anchor="${rtl ? 'end' : 'start'}" font-size="11" fill="${INK2}">${esc(it.name)}</text>`
      x += rtl ? -w : w
    }
  }
  const top = (spec.subtitle ? 58 : 44) + (legend ? 16 : 0)

  if (spec.type === 'donut') {
    const values = (series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0))
    const total = values.reduce((a, b) => a + b, 0) || 1
    const cx = W / 2
    const cy = top + (H - top) / 2
    const r = Math.min(W, H - top) / 2 - 16
    let a0 = -Math.PI / 2
    let arcs = ''
    values.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2
      const large = a1 - a0 > Math.PI ? 1 : 0
      const p = (a: number, rr: number): string => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`
      arcs += `<path d="M${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(a1, r)} L${p(a1, r * 0.6)} A${r * 0.6},${r * 0.6} 0 ${large} 0 ${p(a0, r * 0.6)} Z" fill="${SERIES_COLORS[i % 8]}" stroke="#fff" stroke-width="2"/>`
      const mid = (a0 + a1) / 2
      if (v / total > 0.06) arcs += `<text x="${cx + r * 0.8 * Math.cos(mid)}" y="${cy + r * 0.8 * Math.sin(mid) + 4}" text-anchor="middle" font-size="11" fill="#fff" font-weight="600">${Math.round((v / total) * 100)}%</text>`
      a0 = a1
    })
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${font}><rect width="${W}" height="${H}" fill="#fff"/>${head}${legend}${arcs}</svg>`
  }

  const horizontal = spec.type === 'horizontal_bar'
  const stacked = spec.type === 'stacked_bar'
  const allValues = stacked
    ? labels.map((_, i) => series.reduce((s, se) => s + Math.max(0, se.values[i] ?? 0), 0)).concat(labels.map((_, i) => series.reduce((s, se) => s + Math.min(0, se.values[i] ?? 0), 0)))
    : series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const ticks = niceTicks(Math.min(0, ...allValues), Math.max(0, ...allValues))
  const vmin = ticks[0]
  const vmax = ticks[ticks.length - 1]
  const left = horizontal ? 130 : 56
  const pad = { l: rtl ? 16 : left, r: rtl ? left : 16, t: top + 8, b: horizontal ? 24 : 40 }
  const pw = W - pad.l - pad.r
  const ph = H - pad.t - pad.b
  let body = ''

  if (horizontal) {
    // RTL: zero sits on the plot's right edge and bars grow leftwards.
    const frac = (v: number): number => (v - vmin) / (vmax - vmin)
    const xs = (v: number): number => (rtl ? pad.l + pw - frac(v) * pw : pad.l + frac(v) * pw)
    for (const t of ticks) {
      body += `<line x1="${xs(t)}" x2="${xs(t)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="${GRID}"/>` +
        `<text x="${xs(t)}" y="${pad.t + ph + 16}" text-anchor="middle" font-size="10" fill="${MUTED}">${compact(t, lang)}</text>`
    }
    const band = ph / Math.max(1, labels.length)
    const barH = Math.min(22, (band - 6) / series.length)
    labels.forEach((label, i) => {
      const y0 = pad.t + i * band + (band - barH * series.length) / 2
      body += `<text x="${rtl ? pad.l + pw + 8 : pad.l - 8}" y="${y0 + (barH * series.length) / 2 + 4}" text-anchor="${rtl ? 'start' : 'end'}" font-size="11" fill="${INK2}">${esc(label.slice(0, 22))}</text>`
      series.forEach((s, j) => {
        const v = s.values[i] ?? 0
        const a = xs(Math.min(0, v))
        const b = xs(Math.max(0, v))
        body += `<rect x="${Math.min(a, b)}" y="${y0 + j * barH}" width="${Math.max(1, Math.abs(b - a))}" height="${barH - 2}" rx="4" fill="${SERIES_COLORS[j]}"/>`
      })
    })
  } else {
    const yScale = (v: number): number => pad.t + ph - ((v - vmin) / (vmax - vmin)) * ph
    for (const t of ticks) {
      body += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${yScale(t)}" y2="${yScale(t)}" stroke="${t === 0 ? AXIS : GRID}"/>` +
        `<text x="${rtl ? pad.l + pw + 8 : pad.l - 8}" y="${yScale(t) + 4}" text-anchor="${rtl ? 'start' : 'end'}" font-size="10" fill="${MUTED}">${compact(t, lang)}</text>`
    }
    const n = Math.max(1, labels.length)
    const band = pw / n
    const xAt = (i: number): number => (rtl ? pad.l + pw - (i + 0.5) * band : pad.l + (i + 0.5) * band)
    const every = Math.ceil(n / 12)
    labels.forEach((l, i) => {
      if (i % every === 0) body += `<text x="${xAt(i)}" y="${pad.t + ph + 18}" text-anchor="middle" font-size="10" fill="${MUTED}">${esc(l.slice(0, 12))}</text>`
    })
    if (spec.type === 'line' || spec.type === 'area') {
      series.forEach((s, j) => {
        const pts = s.values.map((v, i) => (v === null ? null : [xAt(i), yScale(v)])).filter((p): p is number[] => !!p)
        if (!pts.length) return
        const d = pts.map((p, k) => `${k ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')
        if (spec.type === 'area') body += `<path d="${d} L${pts[pts.length - 1][0]},${yScale(Math.max(0, vmin))} L${pts[0][0]},${yScale(Math.max(0, vmin))} Z" fill="${SERIES_COLORS[j]}" fill-opacity="0.14"/>`
        body += `<path d="${d}" fill="none" stroke="${SERIES_COLORS[j]}" stroke-width="2"/>`
        const last = pts[pts.length - 1]
        body += `<circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${SERIES_COLORS[j]}" stroke="#fff" stroke-width="2"/>`
      })
    } else {
      const groupW = band * 0.72
      const barW = stacked ? groupW : groupW / series.length
      labels.forEach((_, i) => {
        let posBase = 0
        let negBase = 0
        series.forEach((s, j) => {
          const v = s.values[i] ?? 0
          let y0: number, y1: number
          if (stacked) {
            const base = v >= 0 ? posBase : negBase
            y0 = yScale(base)
            y1 = yScale(base + v)
            if (v >= 0) posBase += v
            else negBase += v
          } else {
            y0 = yScale(0)
            y1 = yScale(v)
          }
          const x = xAt(i) - groupW / 2 + (stacked ? 0 : (rtl ? series.length - 1 - j : j) * barW)
          body += `<rect x="${x + 1}" y="${Math.min(y0, y1)}" width="${Math.max(1, barW - 2)}" height="${Math.max(1, Math.abs(y1 - y0) - (stacked ? 2 : 0))}" rx="${stacked ? 2 : 4}" fill="${SERIES_COLORS[j]}"/>`
        })
      })
    }
  }
  const unit = spec.unit ? `<text x="${rtl ? W - 8 : 8}" y="${H - 6}" text-anchor="${rtl ? 'end' : 'start'}" font-size="10" fill="${MUTED}">${esc(spec.unit)}</text>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${font}><rect width="${W}" height="${H}" fill="#fff"/>${head}${legend}${body}${unit}</svg>`
}

/** Validate a chart spec coming from the model. */
export function cleanChartSpec(input: unknown): ChartSpec {
  const s = (input ?? {}) as Record<string, unknown>
  const types = ['bar', 'line', 'area', 'stacked_bar', 'horizontal_bar', 'donut']
  const labels = Array.isArray(s.labels) ? s.labels.map((l) => String(l)) : []
  const series = Array.isArray(s.series)
    ? (s.series as Record<string, unknown>[]).slice(0, 8).map((se) => ({
        name: String(se.name ?? ''),
        values: labels.map((_, i) => {
          const v = Array.isArray(se.values) ? se.values[i] : null
          const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : NaN
          return Number.isFinite(n) ? n : null
        })
      }))
    : []
  if (!labels.length || !series.length) throw new Error('chart needs labels and at least one series')
  return {
    type: (types.includes(String(s.type)) ? s.type : 'bar') as ChartSpec['type'],
    title: String(s.title ?? ''),
    subtitle: s.subtitle ? String(s.subtitle) : undefined,
    labels,
    series,
    unit: s.unit ? String(s.unit) : undefined
  }
}
