// Types shared between the Electron main process and the renderer.

export type Lang = 'ar' | 'en'
export type Theme = 'system' | 'light' | 'dark'

export interface Company {
  id: string
  name: string
  industry: string
  role: string // Ahmed's position in this company (CFO, consultant, ...)
  currency: string
  color: string
  watchFolder: string | null
  notes: string
  createdAt: string
  updatedAt: string
}

export type DocKind = 'excel' | 'csv' | 'pdf' | 'word' | 'image' | 'text' | 'database' | 'other'

export interface DocumentRecord {
  id: string
  companyId: string
  name: string
  kind: DocKind
  category: string // AI/heuristic category: invoice, bank_statement, payroll, contract, ...
  tags: string[]
  period: string | null // e.g. 2026-09 or 2026-Q3
  summary: string
  size: number
  sha256: string
  storedPath: string
  originalPath: string
  status: 'pending' | 'processing' | 'ready' | 'error'
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface TableSheet {
  name: string
  columns: string[]
  rowCount: number
}

export interface Metric {
  id: string
  companyId: string
  metric: string // revenue, expenses, net_profit, cash, receivables, payables, ...
  period: string // YYYY-MM
  value: number
  currency: string
  sourceDocumentId: string | null
  note: string
  createdAt: string
}

export type Severity = 'info' | 'warning' | 'critical'

export interface Alert {
  id: string
  companyId: string | null
  severity: Severity
  title: string
  detail: string
  source: 'system' | 'ai' | 'user'
  resolved: boolean
  createdAt: string
}

export interface Decision {
  id: string
  companyId: string
  title: string
  rationale: string
  expectedOutcome: string
  actualOutcome: string
  status: 'open' | 'done' | 'cancelled'
  reviewDate: string | null
  createdAt: string
  updatedAt: string
}

export interface Report {
  id: string
  companyId: string | null
  title: string
  format: 'pdf' | 'xlsx' | 'docx'
  path: string
  createdAt: string
}

export interface ActivityItem {
  id: string
  companyId: string | null
  type: string
  message: string
  createdAt: string
}

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'compatible'

export interface ProviderSettings {
  enabled: boolean
  model: string
  fastModel: string // cheaper model for background work (filing clerk, scheduled tasks); '' = same model
  workspaceId?: string // Claude only: needed when the API key is not scoped to a workspace
  baseUrl: string // used by ollama / OpenAI-compatible servers
  hasKey: boolean // keys never leave the main process
}

export type Role = 'owner' | 'admin' | 'accountant' | 'viewer'

export interface Account {
  name: string
  role: Role
  companies: string[] | null // null = all
}

export interface Settings {
  language: Lang
  theme: Theme
  activeProvider: ProviderId
  providers: Record<ProviderId, ProviderSettings>
  agent: {
    fallback: boolean // try the other enabled providers if the active one fails
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' // Claude reasoning effort
    webSearch: boolean // Claude may search the web (exchange rates, tax rules...)
    maxSteps: number
  }
  autoOrganize: boolean // let the AI classify every imported file
  ocrLanguages: string // tesseract languages, e.g. "ara+eng"
  serverUrl: string // sync + update server
  syncEnabled: boolean
  syncToken: string
  lastSyncAt: string | null
  anomalyThreshold: number // percent change that raises an alert
  account: Account | null // from the Inno server; null = local owner
  smtp: { host: string; port: number; secure: boolean; user: string; from: string; hasPassword: boolean }
  whatsapp: { phoneNumberId: string; apiVersion: string; templateName: string; templateLanguage: string; hasToken: boolean }
  reminderRecipients: { emails: string[]; whatsapp: string[] }
  lock: { enabled: boolean; idleMinutes: number; hasPin: boolean }
  backup: { enabled: boolean; folder: string; intervalHours: number; keepLast: number; lastAt: string | null; hasPassword: boolean }
}

export type ReminderType = 'tax' | 'installment' | 'contract' | 'salary' | 'insurance' | 'other'

export interface Reminder {
  id: string
  companyId: string
  title: string
  type: ReminderType
  dueDate: string // YYYY-MM-DD
  amount: number | null
  currency: string
  recurrence: 'none' | 'monthly' | 'quarterly' | 'yearly'
  remindDays: number
  status: 'open' | 'done'
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Budget {
  id: string
  companyId: string
  metric: string
  period: string
  amount: number
  note: string
}

export interface BudgetLine {
  metric: string
  period: string
  budget: number
  actual: number | null
  variance: number | null
  variancePct: number | null
  favorable: boolean | null
}

export interface ReportSchedule {
  companyId: string
  enabled: boolean
  dayOfMonth: number
  emails: string[]
  whatsapp: string[]
  language: Lang
  format: 'pdf' | 'xlsx' | 'docx'
  aiSummary: boolean
  lastPeriodSent: string | null
  lastError: string | null
}

export type ConnectorType = 'innoerp' | 'innopos' | 'postgres' | 'mysql' | 'mssql' | 'sqlite' | 'odoo' | 'rest'

export interface Connector {
  id: string
  companyId: string
  name: string
  type: ConnectorType
  // host, port, database, user, file, url, headerName ... (never the password)
  config: Record<string, string | number | boolean>
  hasSecret: boolean
  allowAi: boolean
  refreshMinutes: number
  lastRunAt: string | null
  lastError: string | null
  datasets: Dataset[]
}

export interface Dataset {
  id: string
  connectorId: string
  name: string
  query: string
  mode: 'table' | 'metrics'
  documentId: string | null
  lastRows: number | null
  updatedAt: string
}

export interface ServerUser {
  id: string
  name: string
  role: Exclude<Role, 'owner'>
  companies: string[] | null
  disabled: boolean
  createdAt: string
  lastSeen: string | null
  token?: string
}

export interface ChatConversation {
  id: string
  companyId: string | null
  title: string
  createdAt: string
  updatedAt: string
}

export type ChartType = 'bar' | 'line' | 'area' | 'stacked_bar' | 'horizontal_bar' | 'donut'

/** A chart the agent draws: shown in chat and embedded in reports. */
export interface ChartSpec {
  type: ChartType
  title: string
  subtitle?: string
  labels: string[] // x-axis categories (periods, products, companies...)
  series: { name: string; values: (number | null)[] }[]
  unit?: string // EGP, %, units...
}

export interface ChatAttachment {
  type: 'report' | 'document' | 'chart' | 'table'
  id: string
  name: string
  path?: string
  chart?: ChartSpec
  table?: { columns: string[]; rows: (string | number | null)[][] }
}

export interface Memory {
  id: string
  companyId: string | null
  content: string
  createdAt: string
}

export interface AgentTask {
  id: string
  name: string
  prompt: string
  companyId: string | null
  schedule: 'daily' | 'weekly' | 'monthly'
  time: string // HH:MM local
  weekday: number // 0-6 for weekly
  dayOfMonth: number // 1-28 for monthly
  emails: string[]
  whatsapp: string[]
  enabled: boolean
  conversationId: string | null
  lastRunAt: string | null
  lastStatus: string | null
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  provider: ProviderId | null
  model: string | null
  toolSteps: ToolStep[]
  attachments: ChatAttachment[]
  createdAt: string
}

export interface ToolStep {
  name: string
  input: unknown
  ok: boolean
  summary: string
}

export type ChatEvent =
  | { type: 'text'; conversationId: string; delta: string }
  | { type: 'tool'; conversationId: string; step: ToolStep }
  | { type: 'done'; conversationId: string; message: ChatMessage }
  | { type: 'error'; conversationId: string; error: string }

export interface DashboardKpi {
  metric: string
  value: number
  previous: number | null
  period: string
  currency: string
}

export interface CompanyDashboard {
  company: Company
  kpis: DashboardKpi[]
  trend: { period: string; [metric: string]: number | string }[]
  categories: { category: string; count: number }[]
  documentCount: number
  alerts: Alert[]
  decisions: Decision[]
  activity: ActivityItem[]
}

export interface OverviewDashboard {
  companies: {
    company: Company
    documentCount: number
    openAlerts: number
    latest: Record<string, number>
    latestPeriod: string | null
  }[]
  totals: { metric: string; value: number }[]
  alerts: Alert[]
  activity: ActivityItem[]
}

export interface SearchHit {
  documentId: string
  companyId: string
  name: string
  snippet: string
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error'
  version?: string
  progress?: number
  error?: string
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'ok' | 'error' | 'disabled'
  lastSyncAt: string | null
  error?: string
}

export const APP_DEVELOPER = 'Inno Source For Software Solutions'
// Inno Server hosts several Inno products; this app lives under its own namespace.
export const DEFAULT_SERVER_URL = 'http://196.221.144.94:9991'
export const SERVER_APP_ID = 'azim-command'
