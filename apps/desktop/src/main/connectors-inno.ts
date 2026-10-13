// Connectors for Inno Source's own systems.
// (Inno Source ERP — innovationsrc.com — is listed in the UI as "not yet";
// its API will be wired here once its documentation is available.)
//
// innopos  — InnoForge POS (Inno Source's point of sale / ERP for shops) through
//            the main computer's network server (Settings → Network in the POS).
//            Azim joins as one connected computer, signs in as a POS user and
//            runs the POS's own reports. A dataset query is JSON:
//            {"report": "sales_by_day", "range": "last_30_days"}
//            {"call": "reports.dashboard"}
//            {"preset": "monthly_pl", "months": 12}   → dashboard metrics
import { randomUUID } from 'crypto'
import type { Connector } from '@shared/types'
import type { QueryResult } from './connectors'

type Json = Record<string, unknown>

export type RangeName = 'today' | 'this_month' | 'last_month' | 'last_30_days' | 'last_90_days' | 'ytd' | 'last_12_months'

const iso = (d: Date): string => d.toISOString().slice(0, 10)

export function rangeDates(range: RangeName | undefined): { from: string; to: string } {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const back = (days: number): string => iso(new Date(Date.now() - days * 86_400_000))
  switch (range) {
    case 'today':
      return { from: iso(now), to: iso(now) }
    case 'this_month':
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(now) }
    case 'last_month':
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) }
    case 'last_90_days':
      return { from: back(90), to: iso(now) }
    case 'ytd':
      return { from: `${y}-01-01`, to: iso(now) }
    case 'last_12_months':
      return { from: iso(new Date(Date.UTC(y, m - 11, 1))), to: iso(now) }
    default:
      return { from: back(30), to: iso(now) }
  }
}

function toTable(list: unknown[]): QueryResult {
  const objects = list.map((x) => (x && typeof x === 'object' ? (x as Json) : { value: x }))
  const columns = [...new Set(objects.flatMap((o) => Object.keys(o)))]
  return {
    columns,
    rows: objects.map((o) => columns.map((c) => {
      const v = o[c]
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : (v as unknown) ?? null
    }))
  }
}

// ---------------- InnoForge POS ----------------

interface PosColumn {
  key: string
  label: string
  type: string
}

export class InnoPosClient {
  private base: string
  private headers: Record<string, string>
  private decimals = 2

  constructor(private c: Connector, private secret: { key: string; pin: string }) {
    this.base = `http://${String(c.config.host).trim()}:${Number(c.config.port) || 7790}`
    this.headers = {
      'Content-Type': 'application/json',
      'X-Pos-Key': secret.key,
      'X-Pos-Device': String(c.config.deviceId),
      'X-Pos-Device-Name': encodeURIComponent('Azim Command')
    }
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(this.base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: this.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000)
      })
    } catch (e) {
      throw new Error(`InnoForge POS is not reachable at ${this.base} (${(e as Error).message})`)
    }
    const data = (await res.json().catch(() => ({ ok: false, code: `HTTP ${res.status}` }))) as { ok: boolean; data?: unknown; code?: string; message?: string }
    if (!data.ok) throw new Error(`InnoForge POS: ${data.code}${data.message && data.message !== data.code ? ` — ${data.message}` : ''}`)
    return data.data
  }

  call(path: string, ...args: unknown[]): Promise<unknown> {
    return this.request('/api/call', { path, args })
  }

  /** Fresh session, sign in, and learn the currency's decimals. */
  async open(): Promise<void> {
    await this.request('/api/reset', {})
    await this.call('auth.login', { username: this.c.config.username, pin: this.secret.pin })
    const settings = (await this.call('settings.get').catch(() => ({}))) as { decimals?: number }
    this.decimals = Number.isInteger(settings.decimals) ? Number(settings.decimals) : 2
  }

  /** POS amounts are stored in minor units (piasters). */
  money(v: unknown): number | null {
    return typeof v === 'number' ? v / 10 ** this.decimals : null
  }

  async report(id: string, from?: string, to?: string): Promise<{ columns: PosColumn[]; rows: Json[]; totals: Json }> {
    return (await this.call('reports.run', { id, from, to })) as { columns: PosColumn[]; rows: Json[]; totals: Json }
  }

  reportTable(r: { columns: PosColumn[]; rows: Json[] }): QueryResult {
    const label = (c: PosColumn): string => c.key
    return {
      columns: r.columns.map(label),
      rows: r.rows.map((row) =>
        r.columns.map((c) => {
          const v = row[c.key]
          if (c.type === 'money') return this.money(v)
          return typeof v === 'string' && v.startsWith('rep.') ? v.replace(/^rep\.(pl\.)?/, '') : ((v as unknown) ?? null)
        })
      )
    }
  }
}

function monthBounds(offset: number): { period: string; from: string; to: string } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
  return { period: start.toISOString().slice(0, 7), from: iso(start), to: iso(end) }
}

export async function innoPosQuery(c: Connector, rawSecret: string, query: string): Promise<QueryResult> {
  if (!c.config.host || !c.config.username) throw new Error('Set the POS main computer address and a POS user')
  let secret: { key: string; pin: string }
  try {
    secret = JSON.parse(rawSecret)
  } catch {
    throw new Error('Enter the POS network key and the user PIN')
  }
  const pos = new InnoPosClient(c, secret)
  await pos.open()
  const spec = JSON.parse(query || '{}') as { report?: string; range?: RangeName; call?: string; preset?: string; months?: number }

  if (spec.preset === 'monthly_pl') {
    // One profit & loss per month + today's receivables/payables → long format.
    const rows: unknown[][] = []
    const months = Math.min(Math.max(spec.months ?? 12, 1), 36)
    for (let i = months - 1; i >= 0; i--) {
      const { period, from, to } = monthBounds(i)
      const pl = await pos.report('profit_loss', from, to).catch(() => null)
      if (!pl) continue
      const item = (k: string): number | null => pos.money(pl.rows.find((r) => r.item === k)?.amount)
      const expenses = pl.rows.filter((r) => r.raw).reduce((s, r) => s + (pos.money(r.amount) ?? 0), 0)
      if (!item('rep.pl.sales') && !expenses) continue // no activity that month (e.g. before the POS was used)
      const pairs: [string, number | null][] = [
        ['revenue', item('rep.pl.sales')],
        ['cost_of_sales', item('rep.pl.cogs') === null ? null : Math.abs(item('rep.pl.cogs')!)],
        ['gross_margin', item('rep.pl.gross')],
        ['expenses', Math.abs(expenses)],
        ['net_profit', item('rep.pl.net')]
      ]
      for (const [metric, value] of pairs) if (value !== null) rows.push([period, metric, value])
    }
    const dash = (await pos.call('reports.dashboard').catch(() => null)) as Json | null
    const current = monthBounds(0).period
    if (dash) {
      for (const [metric, key] of [
        ['receivables', 'receivables'],
        ['payables', 'payables']
      ] as const) {
        const v = pos.money(dash[key])
        if (v !== null) rows.push([current, metric, v])
      }
    }
    const treasury = await pos.report('treasury', monthBounds(0).from, iso(new Date())).catch(() => null)
    if (treasury) rows.push([current, 'cash', treasury.rows.reduce((s, r) => s + (pos.money(r.closing) ?? 0), 0)])
    return { columns: ['period', 'metric', 'value'], rows }
  }

  if (spec.call) {
    if (!/^(reports\.(dashboard|catalog)|installments\.due|customers\.list|suppliers\.list|products\.list)$/.test(spec.call)) {
      throw new Error(`Call not allowed from Azim: ${spec.call}`)
    }
    const data = await pos.call(spec.call)
    if (Array.isArray(data)) return toTable(data)
    // Dashboard: flatten numbers into metric/value rows (money in major units).
    const flat: unknown[][] = []
    for (const [k, v] of Object.entries((data ?? {}) as Json)) {
      if (typeof v === 'number') flat.push([k, ['receivables', 'payables', 'overdueAmount'].includes(k) ? pos.money(v) : v])
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v as Json)) if (typeof v2 === 'number') flat.push([`${k}.${k2}`, ['total', 'credit', 'refunds', 'profit'].includes(k2) ? pos.money(v2) : v2])
      }
    }
    return { columns: ['metric', 'value'], rows: flat }
  }

  if (!spec.report) throw new Error('POS dataset needs "report", "call" or "preset"')
  const { from, to } = rangeDates(spec.range)
  return pos.reportTable(await pos.report(spec.report, from, to))
}

/** Datasets created automatically for a new InnoForge POS connection. */
export const INNOPOS_DATASETS: { name: string; query: string; mode: 'table' | 'metrics' }[] = [
  { name: 'المؤشرات الشهرية (أرباح وخسائر)', query: '{"preset":"monthly_pl","months":12}', mode: 'metrics' },
  { name: 'المبيعات اليومية', query: '{"report":"sales_by_day","range":"last_90_days"}', mode: 'table' },
  { name: 'المبيعات حسب المنتج', query: '{"report":"sales_by_product","range":"last_30_days"}', mode: 'table' },
  { name: 'أرصدة العملاء', query: '{"report":"customer_balances"}', mode: 'table' },
  { name: 'أعمار الديون', query: '{"report":"aging"}', mode: 'table' },
  { name: 'أرصدة الموردين', query: '{"report":"supplier_balances"}', mode: 'table' },
  { name: 'المصروفات حسب البند', query: '{"report":"expenses_by_category","range":"last_90_days"}', mode: 'table' },
  { name: 'تقييم المخزون', query: '{"report":"stock_valuation"}', mode: 'table' },
  { name: 'نواقص المخزون', query: '{"report":"low_stock"}', mode: 'table' },
  { name: 'أقساط مستحقة', query: '{"report":"installments_due"}', mode: 'table' }
]

export const newDeviceId = (): string => `azim-${randomUUID()}`
