// The contract between the renderer and the main process (exposed by preload
// as window.azim). Every method maps 1:1 to an ipcMain.handle channel.
import type {
  Alert,
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
    update(patch: Partial<Settings>): Promise<Settings>
    setApiKey(provider: ProviderId, key: string): Promise<Settings>
    testProvider(): Promise<{ ok: boolean; message: string }>
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
    openExternal(url: string): Promise<void>
  }
}
