// Inno Server client (app namespace `azim-command`). See apps/inno-server/src/index.ts.

export const APP_ID = 'azim-command'
export const DEFAULT_SERVER = 'http://196.221.144.94:9991'

export type Role = 'owner' | 'admin' | 'accountant' | 'viewer'

export interface Me {
  id: string
  name: string
  role: Role
  companies: string[] | null
}

export interface ServerConfig {
  url: string
  token: string
}

export interface Company {
  id: string
  name: string
  industry: string | null
  role: string | null
  currency: string | null
  color: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Metric {
  id: string
  company_id: string
  metric: string
  period: string // YYYY-MM
  value: number
  currency: string | null
  note: string | null
}

export type Severity = 'info' | 'warning' | 'critical'

export interface Alert {
  id: string
  company_id: string | null
  severity: Severity
  title: string
  detail: string | null
  source: string | null
  resolved: number
  created_at: string
}

export type ReminderType = 'tax' | 'installment' | 'contract' | 'salary' | 'insurance' | 'other'

export interface Reminder {
  id: string
  company_id: string | null
  title: string
  type: ReminderType
  due_date: string // YYYY-MM-DD
  amount: number | null
  currency: string | null
  recurrence: 'none' | 'monthly' | 'quarterly' | 'yearly'
  remind_days: number
  status: 'open' | 'done'
  notes: string | null
}

export interface Budget {
  id: string
  company_id: string
  metric: string
  period: string
  amount: number
  note: string | null
}

export interface Decision {
  id: string
  company_id: string | null
  title: string
  rationale: string | null
  expected_outcome: string | null
  actual_outcome: string | null
  status: 'open' | 'done' | 'cancelled'
  review_date: string | null
}

export interface DocumentRow {
  id: string
  company_id: string | null
  name: string
  kind: string | null
  category: string | null
  tags: string | null
  period: string | null
  summary: string | null
  size: number | null
  status: string | null
  created_at: string
}

export interface Report {
  id: string
  company_id: string | null
  title: string
  format: 'pdf' | 'xlsx' | 'docx'
  created_at: string
}

export interface Tables {
  companies: Company
  metrics: Metric
  alerts: Alert
  reminders: Reminder
  budgets: Budget
  decisions: Decision
  documents: DocumentRow
  reports: Report
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export function normalizeUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`
  return u
}

const TIMEOUT_MS = 20_000

async function request<T>(cfg: ServerConfig, path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${cfg.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers
      }
    })
    if (!res.ok) {
      let message = res.statusText
      try {
        message = ((await res.json()) as { error?: string }).error ?? message
      } catch {
        // non-JSON error body
      }
      throw new ApiError(res.status, message)
    }
    return (await res.json()) as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(0, e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network')
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  health: (url: string) => request<{ ok: boolean; name: string; time: string }>({ url, token: '' }, '/api/health'),

  me: (cfg: ServerConfig) => request<Me>(cfg, `/api/${APP_ID}/me`),

  async table<K extends keyof Tables>(cfg: ServerConfig, table: K, opts: { companyId?: string; limit?: number } = {}): Promise<Tables[K][]> {
    const qs = new URLSearchParams()
    if (opts.companyId) qs.set('companyId', opts.companyId)
    qs.set('limit', String(opts.limit ?? 2000))
    try {
      return await request<Tables[K][]>(cfg, `/api/${APP_ID}/data/${table}?${qs.toString()}`)
    } catch (e) {
      // Tables hidden from a role (e.g. decisions for accountants) answer 404.
      if (e instanceof ApiError && e.status === 404) return []
      throw e
    }
  },

  registerPush: (cfg: ServerConfig, token: string, platform: string) =>
    request<{ ok: boolean }>(cfg, `/api/${APP_ID}/push/register`, { method: 'POST', body: JSON.stringify({ token, platform }) }),

  fileUrl: (cfg: ServerConfig, documentId: string) => `${cfg.url}/api/${APP_ID}/files/${encodeURIComponent(documentId)}`
}
