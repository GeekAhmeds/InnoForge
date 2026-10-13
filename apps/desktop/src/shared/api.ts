// The contract between the renderer and the main process (exposed by preload
// as window.azim). Every method maps 1:1 to an ipcMain.handle channel.
import type {
  Alert,
  Budget,
  BudgetLine,
  Connector,
  ConnectorType,
  Dataset,
  Reminder,
  ReportSchedule,
  ServerUser,
  ChatConversation,
  ChatEvent,
  ChatMessage,
  Company,
  CompanyDashboard,
  Decision,
  DocumentRecord,
  Metric,
  OverviewDashboard,
  ProviderId,
  Report,
  SearchHit,
  Settings,
  SyncStatus,
  TableSheet,
  UpdateStatus
} from './types'
import type { HistoryPoint } from './forecast'

export type SettingsPatch = Partial<Omit<Settings, 'providers' | 'smtp' | 'whatsapp' | 'lock' | 'backup' | 'reminderRecipients'>> & {
  providers?: Partial<Record<ProviderId, Partial<Settings['providers'][ProviderId]>>>
  smtp?: Partial<Settings['smtp']>
  whatsapp?: Partial<Settings['whatsapp']>
  lock?: Partial<Settings['lock']>
  backup?: Partial<Settings['backup']>
  reminderRecipients?: Partial<Settings['reminderRecipients']>
}

export interface ImportSummary {
  imported: number
  duplicates: string[]
  failed: { path: string; error: string }[]
}

export interface AzimApi {
  companies: {
    list(): Promise<Company[]>
    save(input: Partial<Company> & { name: string }): Promise<Company>
    remove(id: string): Promise<void>
    pickFolder(): Promise<string | null>
  }
  documents: {
    list(filter: { companyId?: string; category?: string; query?: string }): Promise<DocumentRecord[]>
    pickAndImport(companyId: string): Promise<ImportSummary>
    importPaths(companyId: string, paths: string[]): Promise<ImportSummary>
    update(id: string, patch: Partial<Pick<DocumentRecord, 'name' | 'category' | 'tags' | 'period' | 'summary'>>): Promise<DocumentRecord | null>
    remove(id: string): Promise<void>
    reprocess(id: string): Promise<void>
    open(id: string): Promise<void>
    reveal(id: string): Promise<void>
    sheets(id: string): Promise<TableSheet[]>
    table(id: string, sheet?: string): Promise<{ sheet: string; columns: string[]; rows: unknown[][] } | null>
    text(id: string): Promise<string>
    pathForFile(file: File): string
  }
  search(query: string, companyId?: string): Promise<SearchHit[]>
  dashboard: {
    overview(): Promise<OverviewDashboard>
    company(id: string): Promise<CompanyDashboard | null>
  }
  metrics: {
    list(companyId: string): Promise<Metric[]>
    save(m: { companyId: string; metric: string; period: string; value: number; currency?: string; note?: string }): Promise<Metric>
    remove(id: string): Promise<void>
  }
  alerts: {
    list(companyId?: string): Promise<Alert[]>
    resolve(id: string): Promise<void>
  }
  decisions: {
    list(companyId?: string): Promise<Decision[]>
    save(input: Partial<Decision> & { companyId: string; title: string }): Promise<Decision>
    remove(id: string): Promise<void>
  }
  reports: {
    list(companyId?: string): Promise<Report[]>
    open(path: string): Promise<void>
    reveal(path: string): Promise<void>
  }
  chat: {
    conversations(): Promise<ChatConversation[]>
    create(companyId: string | null): Promise<ChatConversation>
    remove(id: string): Promise<void>
    messages(conversationId: string): Promise<ChatMessage[]>
    send(conversationId: string, text: string): Promise<ChatMessage>
    cancel(conversationId: string): Promise<void>
    onEvent(cb: (e: ChatEvent) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
    setApiKey(provider: ProviderId, key: string): Promise<Settings>
    setSecret(name: 'smtp' | 'whatsapp' | 'backup', value: string): Promise<Settings>
    testProvider(): Promise<{ ok: boolean; message: string }>
    testMessaging(channel: 'email' | 'whatsapp', to: string): Promise<{ ok: boolean; message: string }>
  }
  reminders: {
    list(filter?: { companyId?: string; status?: 'open' | 'done'; until?: string }): Promise<Reminder[]>
    save(input: Partial<Reminder> & { companyId: string; title: string; dueDate: string }): Promise<Reminder>
    complete(id: string): Promise<Reminder | null>
    remove(id: string): Promise<void>
  }
  planning: {
    budgets(companyId: string): Promise<Budget[]>
    saveBudget(b: { companyId: string; metric: string; period: string; amount: number; note?: string }): Promise<Budget>
    removeBudget(id: string): Promise<void>
    budgetVsActual(companyId: string, from?: string, to?: string): Promise<BudgetLine[]>
    forecastHistory(companyId: string): Promise<HistoryPoint[]>
  }
  schedule: {
    get(companyId: string): Promise<ReportSchedule>
    save(s: ReportSchedule): Promise<ReportSchedule>
    send(companyId: string, period?: string): Promise<{ report: Report; errors: string[] }>
    preview(companyId: string, period: string): Promise<Report>
  }
  connectors: {
    list(companyId?: string): Promise<Connector[]>
    save(input: Partial<Omit<Connector, 'datasets' | 'hasSecret'>> & { companyId: string; name: string; type: ConnectorType; secret?: string }): Promise<Connector>
    remove(id: string): Promise<void>
    test(id: string): Promise<{ ok: boolean; message: string }>
    refresh(id: string): Promise<{ ok: boolean; message: string }>
    saveDataset(input: Partial<Dataset> & { connectorId: string; name: string; query: string }): Promise<Dataset>
    removeDataset(id: string): Promise<void>
    preview(id: string, query: string): Promise<{ columns: string[]; rows: unknown[][]; total: number }>
    pickFile(): Promise<string | null>
  }
  accounts: {
    list(): Promise<ServerUser[]>
    create(u: { name: string; role: ServerUser['role']; companies: string[] | null }): Promise<ServerUser>
    update(id: string, patch: Partial<Pick<ServerUser, 'name' | 'role' | 'companies' | 'disabled'>>): Promise<ServerUser>
    rotate(id: string): Promise<{ token: string }>
    remove(id: string): Promise<void>
  }
  lock: {
    status(): Promise<boolean>
    unlock(pin: string): Promise<{ ok: boolean; waitSeconds: number }>
    lockNow(): Promise<void>
    setPin(pin: string, current?: string): Promise<Settings>
    clearPin(current: string): Promise<Settings>
    onChange(cb: (locked: boolean) => void): () => void
  }
  backup: {
    pickFolder(): Promise<string | null>
    create(password: string): Promise<{ path: string; size: number } | null>
    runNow(): Promise<string | null>
    restore(password: string): Promise<boolean>
  }
  sync: {
    status(): Promise<SyncStatus>
    now(): Promise<SyncStatus>
    onStatus(cb: (s: SyncStatus) => void): () => void
  }
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    install(): Promise<void>
    onStatus(cb: (s: UpdateStatus) => void): () => void
  }
  app: {
    version(): Promise<string>
    onDataChanged(cb: (scopes: string[]) => void): () => void
    onAccountChanged(cb: () => void): () => void
    openExternal(url: string): Promise<void>
  }
}
