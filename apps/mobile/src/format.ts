import type { Lang } from './i18n'

const locale = (lang: Lang) => (lang === 'ar' ? 'ar-EG' : 'en-US')

export function formatNumber(v: number, lang: Lang, compact = false): string {
  return new Intl.NumberFormat(locale(lang), {
    notation: compact && Math.abs(v) >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2
  }).format(v)
}

export function formatMoney(v: number, currency: string | null | undefined, lang: Lang, compact = true): string {
  const n = formatNumber(v, lang, compact)
  return currency ? `${n} ${currency}` : n
}

export function formatPercent(v: number, lang: Lang, signed = true): string {
  return new Intl.NumberFormat(locale(lang), {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: signed ? 'exceptZero' : 'auto'
  }).format(v / 100)
}

const parseDay = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`)

export function formatDate(d: string, lang: Lang): string {
  const date = d.length <= 10 ? parseDay(d) : new Date(d)
  if (Number.isNaN(date.getTime())) return d
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export function formatPeriod(p: string, lang: Lang): string {
  const date = new Date(`${p.slice(0, 7)}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return p
  return new Intl.DateTimeFormat(locale(lang), { month: 'short', year: 'numeric' }).format(date)
}

export function formatShortPeriod(p: string, lang: Lang): string {
  const date = new Date(`${p.slice(0, 7)}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return p
  return new Intl.DateTimeFormat(locale(lang), { month: 'short' }).format(date)
}

export function formatSize(bytes: number | null, lang: Lang): string {
  if (!bytes) return ''
  const units = lang === 'ar' ? ['بايت', 'ك.ب', 'م.ب', 'ج.ب'] : ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${formatNumber(Math.round(v * 10) / 10, lang)} ${units[i]}`
}

/** Whole days from today (local) to a YYYY-MM-DD date; negative = past. */
export function daysUntil(day: string, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((parseDay(day).getTime() - today.getTime()) / 86_400_000)
}
