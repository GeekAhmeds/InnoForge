import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { dbPath } from './paths'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(dbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export const uid = (): string => randomUUID()
export const now = (): string => new Date().toISOString()

// Tables that are replicated to the Inno server. Every row carries updated_at
// and a soft-delete flag so last-write-wins sync can propagate deletions.
export const SYNC_TABLES = ['companies', 'documents', 'metrics', 'alerts', 'decisions', 'reports', 'reminders', 'budgets'] as const

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      industry TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'EGP',
      color TEXT NOT NULL DEFAULT '#2a78d6',
      watch_folder TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'uncategorized',
      tags TEXT NOT NULL DEFAULT '[]',
      period TEXT,
      summary TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      original_path TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      uploaded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id);
    CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents(company_id, sha256);

    -- Extracted full text, searchable with FTS5.
    CREATE VIRTUAL TABLE IF NOT EXISTS document_text USING fts5(
      document_id UNINDEXED, company_id UNINDEXED, name, content, tokenize = 'unicode61'
    );

    -- Structured rows extracted from spreadsheets / CSV / database dumps.
    CREATE TABLE IF NOT EXISTS document_tables (
      document_id TEXT NOT NULL,
      sheet TEXT NOT NULL,
      columns TEXT NOT NULL,
      rows TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      PRIMARY KEY (document_id, sheet)
    );

    CREATE TABLE IF NOT EXISTS metrics (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      period TEXT NOT NULL,
      value REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT '',
      source_document_id TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_unique ON metrics(company_id, metric, period) WHERE deleted = 0;

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'system',
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      title TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      expected_outcome TEXT NOT NULL DEFAULT '',
      actual_outcome TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      review_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      title TEXT NOT NULL,
      format TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      native TEXT, -- provider-native transcript of this turn (replayed verbatim)
      tool_steps TEXT NOT NULL DEFAULT '[]',
      attachments TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

    -- Deadlines: taxes, loan installments, contract renewals, ...
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'other',
      due_date TEXT NOT NULL,
      amount REAL,
      currency TEXT NOT NULL DEFAULT '',
      recurrence TEXT NOT NULL DEFAULT 'none',
      remind_days INTEGER NOT NULL DEFAULT 7,
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT NOT NULL DEFAULT '',
      last_notified TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, due_date);

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      period TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_unique ON budgets(company_id, metric, period) WHERE deleted = 0;

    -- Local only (never synced): contain recipients and credentials.
    CREATE TABLE IF NOT EXISTS report_schedules (
      company_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      day_of_month INTEGER NOT NULL DEFAULT 1,
      emails TEXT NOT NULL DEFAULT '[]',
      whatsapp TEXT NOT NULL DEFAULT '[]',
      language TEXT NOT NULL DEFAULT 'ar',
      format TEXT NOT NULL DEFAULT 'pdf',
      ai_summary INTEGER NOT NULL DEFAULT 1,
      last_period_sent TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      secret TEXT,
      allow_ai INTEGER NOT NULL DEFAULT 0,
      refresh_minutes INTEGER NOT NULL DEFAULT 60,
      last_run_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'table',
      document_id TEXT,
      last_rows INTEGER,
      updated_at TEXT NOT NULL
    );
  `)
}

export function logActivity(companyId: string | null, type: string, message: string): void {
  getDb()
    .prepare('INSERT INTO activity (id, company_id, type, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uid(), companyId, type, message, now())
}
