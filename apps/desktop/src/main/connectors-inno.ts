// Connectors for Inno Source's own systems.
//
// innoerp  — Inno Source ERP (innovationsrc.com) through its API keys
//            (Inno Data API v1, docs/inno-data-api.md). See the bottom of this file.
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

// ---------------- Inno Source ERP (Inno Data API v1) ----------------
// Contract: docs/inno-data-api.md. Read-only GETs with an API key that the ERP
// admin scopes (datasets, hidden fields, companies, history, limits).
// A dataset query is JSON:
//   {"dataset": "sales_invoices", "range": "last_90_days", "params": {"status": "unpaid"}}
//   {"dataset": "monthly_pl", "range": "last_12_months"}       (or "from"/"to")
//   {"call": "catalog"} | {"call": "me"}

export interface ErpCatalogEntry {
  key: string
  name: string
  name_ar?: string
  description?: string
  kind?: 'table' | 'metrics'
  params?: { name: string; type?: string; required?: boolean }[]
}

const ERP_MAX_ROWS = 50_000
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class InnoErpClient {
  private base: string

  constructor(
    private c: Connector,
    private key: string
  ) {
    if (!c.config.url) throw new Error('Set the Inno Source ERP API URL (…/api/data/v1)')
    if (!key) throw new Error('Enter the API key created in Inno Source ERP')
    this.base = String(c.config.url).trim().replace(/\/+$/, '')
  }

  async get(path: string, query: Record<string, string | number | undefined> = {}, retried = false): Promise<{ data: unknown; meta?: Record<string, unknown> }> {
    const url = new URL(this.base + path)
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    let res: Response
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${this.key}`, Accept: 'application/json', 'User-Agent': 'AzimCommand' }, signal: AbortSignal.timeout(60_000) })
    } catch (e) {
      throw new Error(`Inno Source ERP is not reachable at ${this.base} (${(e as Error).message})`)
    }
    const body = (await res.json().catch(() => null)) as { data?: unknown; meta?: Record<string, unknown>; error?: { code?: string; message?: string } } | null
    if (res.status === 429 && !retried) {
      const wait = Math.min(Number(res.headers.get('retry-after')) || 5, 20)
      await sleep(wait * 1000)
      return this.get(path, query, true)
    }
    if (!res.ok || !body || body.error) {
      const code = body?.error?.code ?? `HTTP ${res.status}`
      throw new Error(`Inno Source ERP: ${code}${body?.error?.message ? ` — ${body.error.message}` : ''}${ERP_HINTS[code] ? `\n${ERP_HINTS[code]}` : ''}`)
    }
    return { data: body.data, meta: body.meta }
  }

  async catalog(): Promise<ErpCatalogEntry[]> {
    const { data } = await this.get('/datasets')
    return Array.isArray(data) ? (data as ErpCatalogEntry[]).filter((d) => d && typeof d.key === 'string') : []
  }

  /** Every page of a dataset, up to the row cap. */
  async rows(dataset: string, query: Record<string, string | number | undefined>): Promise<unknown[]> {
    const out: unknown[] = []
    for (let page = 1; out.length < ERP_MAX_ROWS; page++) {
      const { data, meta } = await this.get(`/datasets/${encodeURIComponent(dataset)}`, { ...query, page, page_size: 5000 })
      if (!Array.isArray(data)) throw new Error('Inno Source ERP: the response has no "data" list')
      out.push(...data)
      if (!meta?.has_more || !data.length) break
    }
    return out.slice(0, ERP_MAX_ROWS)
  }
}

const ERP_HINTS: Record<string, string> = {
  invalid_key: 'المفتاح غلط أو اتلغى — اعمل مفتاح جديد من الـ ERP. | The key is wrong or revoked.',
  key_expired: 'المفتاح انتهت صلاحيته — مدّها أو اعمل rotate من الـ ERP. | The key has expired.',
  key_disabled: 'المفتاح متوقف من الـ ERP. | The key is disabled in the ERP.',
  ip_denied: 'عنوان الجهاز ده مش في قائمة الـ IPs المسموحة للمفتاح. | This computer’s IP is not allowed for the key.',
  scope_denied: 'المفتاح مش مسموحله يقرا الداتا دي — فعّلها من إعدادات المفتاح. | The key is not allowed to read this dataset.',
  company_denied: 'المفتاح مش مسموحله بالشركة دي. | The key cannot read this company.',
  history_limit: 'الفترة المطلوبة أقدم من المسموح للمفتاح. | The date range is older than the key allows.',
  quota_exceeded: 'المفتاح خلّص عدد الطلبات المسموح بيه النهارده. | The key used up today’s quota.'
}

export async function innoErpQuery(c: Connector, key: string, query: string): Promise<QueryResult> {
  const erp = new InnoErpClient(c, key)
  const spec = JSON.parse(query || '{}') as {
    dataset?: string
    call?: 'catalog' | 'me'
    range?: RangeName
    from?: string
    to?: string
    company_id?: string
    params?: Record<string, string | number>
  }
  if (spec.call === 'me') {
    const { data } = await erp.get('/me')
    const me = (data ?? {}) as Json
    const flat: unknown[][] = []
    const walk = (prefix: string, v: unknown): void => {
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Json)) walk(prefix ? `${prefix}.${k}` : k, x)
      else flat.push([prefix, Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? ((x as Json).name ?? (x as Json).id) : x)).join(', ') : v ?? null])
    }
    walk('', me)
    return { columns: ['field', 'value'], rows: flat }
  }
  if (spec.call === 'catalog') {
    return toTable((await erp.catalog()).map((d) => ({ key: d.key, name: d.name_ar || d.name, kind: d.kind ?? 'table', description: d.description ?? '', params: (d.params ?? []).map((p) => p.name).join(', ') })))
  }
  if (!spec.dataset) throw new Error('Inno Source ERP dataset needs "dataset" (or {"call":"catalog"})')
  const dates = spec.from || spec.to ? { from: spec.from, to: spec.to } : spec.range ? rangeDates(spec.range) : {}
  const rows = await erp.rows(spec.dataset, {
    ...(spec.params ?? {}),
    ...dates,
    company_id: spec.company_id ?? (c.config.companyId ? String(c.config.companyId) : undefined)
  })
  return toTable(rows)
}

/** Datasets for a new ERP connection, built from what the key may read. */
export async function innoErpDefaultDatasets(c: Connector, key: string): Promise<{ name: string; query: string; mode: 'table' | 'metrics' }[]> {
  const catalog = await new InnoErpClient(c, key).catalog()
  return catalog
    .filter((d) => d.key !== 'companies')
    .map((d) => {
      const dated = (d.params ?? []).some((p) => p.name === 'from' || p.name === 'to')
      const metrics = d.kind === 'metrics'
      const q: Json = { dataset: d.key }
      if (dated) q.range = metrics ? 'last_12_months' : 'last_90_days'
      return { name: d.name_ar || d.name || d.key, query: JSON.stringify(q), mode: metrics ? 'metrics' : 'table' }
    })
}
