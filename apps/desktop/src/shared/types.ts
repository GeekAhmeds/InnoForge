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

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama'

export interface ProviderSettings {
  enabled: boolean
  model: string
  baseUrl: string // used by ollama / OpenAI-compatible servers
  hasKey: boolean // keys never leave the main process
}

export interface Settings {
  language: Lang
  theme: Theme
  activeProvider: ProviderId
  providers: Record<ProviderId, ProviderSettings>
  autoOrganize: boolean // let the AI classify every imported file
  ocrLanguages: string // tesseract languages, e.g. "ara+eng"
  serverUrl: string // sync + update server
  syncEnabled: boolean
  syncToken: string
  lastSyncAt: string | null
  anomalyThreshold: number // percent change that raises an alert
}

export interface ChatConversation {
  id: string
  companyId: string | null
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChatAttachment {
  type: 'report' | 'document'
  id: string
  name: string
  path?: string
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
export const DEFAULT_SERVER_URL = 'http://196.221.144.94:9991'
