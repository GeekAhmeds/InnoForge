// The tools the assistant can use. They operate on the local database only,
// and are the same for every provider.
import * as repo from '../repo'
import { search } from '../insights'
import { runChecks } from '../insights'
import { generateReport, type ReportSpec } from '../reports'
import { logActivity } from '../db'
import { budgetVsActual, companyForecast, setBudget } from '../planning'
import { listReminders, saveReminder } from '../reminders'
import { getConnector, listConnectors, runQuery } from '../connectors'
import { getSchedule, sendMonthlyReport } from '../monthly'
import { BASE_SCENARIO, type Scenario } from '@shared/forecast'
import type { ChatAttachment, Reminder, Severity } from '@shared/types'
import type { ToolDef, ToolOutcome } from './providers'

export interface ToolContext {
  companyId: string | null // conversation scope; null = all companies
  attachments: ChatAttachment[]
}

const str = { type: 'string' }
const companyIdProp = { type: 'string', description: 'Company id (from list_companies).' }

export const TOOLS: ToolDef[] = [
  {
    name: 'list_companies',
    description: 'List every company Azim manages, with id, industry, his role there and currency.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'list_documents',
    description:
      'List imported files for a company with their category, period, status and short summary. Use to see what data exists.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        category: { type: 'string', description: 'Optional category filter, e.g. invoice, bank_statement, payroll.' },
        query: { type: 'string', description: 'Optional text filter on name/summary/tags.' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'search_documents',
    description:
      'Full-text search (Arabic and English) across the extracted contents of all files. Returns matching documents with snippets.',
    input_schema: {
      type: 'object',
      properties: { query: str, company_id: companyIdProp, limit: { type: 'number' } },
      required: ['query']
    }
  },
  {
    name: 'read_document',
    description:
      'Read the extracted text of one document. Long documents are paged: pass offset to continue. Spreadsheets also expose sheets via query_table.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: str,
        offset: { type: 'number', description: 'Character offset, default 0.' },
        max_chars: { type: 'number', description: 'Default 20000.' }
      },
      required: ['document_id']
    }
  },
  {
    name: 'query_table',
    description:
      'Read structured rows from a spreadsheet/CSV/database document. Optionally filter rows containing text, and aggregate (sum/avg/min/max/count) a numeric column, optionally grouped by another column.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: str,
        sheet: { type: 'string', description: 'Sheet/table name; defaults to the first.' },
        contains: { type: 'string', description: 'Keep only rows where any cell contains this text.' },
        aggregate: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['sum', 'avg', 'min', 'max', 'count'] },
            column: str,
            group_by: str
          },
          required: ['op']
        },
        offset: { type: 'number' },
        limit: { type: 'number', description: 'Rows to return, default 100, max 500.' }
      },
      required: ['document_id']
    }
  },
  {
    name: 'get_metrics',
    description:
      'Get the financial metrics recorded for a company (what the dashboard shows): revenue, expenses, net_profit, cash, receivables, payables, etc. by period (YYYY-MM).',
    input_schema: {
      type: 'object',
      properties: { company_id: companyIdProp, metric: str, from: str, to: str },
      required: ['company_id']
    }
  },
  {
    name: 'record_metrics',
    description:
      'Save financial metrics extracted from documents so they appear on the live dashboard. Use snake_case English metric names (revenue, expenses, net_profit, cash, receivables, payables, gross_margin, payroll, ...). Period must be YYYY-MM. Only record numbers you actually found in the data.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              metric: str,
              period: str,
              value: { type: 'number' },
              currency: str,
              source_document_id: str,
              note: str
            },
            required: ['metric', 'period', 'value']
          }
        }
      },
      required: ['company_id', 'entries']
    }
  },
  {
    name: 'organize_document',
    description: 'Set the category, tags, period and summary of a document to keep the archive organized.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: str,
        category: str,
        tags: { type: 'array', items: str },
        period: str,
        summary: str,
        name: { type: 'string', description: 'Optional clearer display name.' }
      },
      required: ['document_id']
    }
  },
  {
    name: 'company_overview',
    description: 'Open alerts, recent decisions and recent activity for a company.',
    input_schema: { type: 'object', properties: { company_id: companyIdProp }, required: ['company_id'] }
  },
  {
    name: 'add_decision',
    description: 'Log a management/financial decision in the decision journal so its outcome can be reviewed later.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        title: str,
        rationale: str,
        expected_outcome: str,
        review_date: { type: 'string', description: 'YYYY-MM-DD' }
      },
      required: ['company_id', 'title']
    }
  },
  {
    name: 'create_alert',
    description: 'Raise an alert on the dashboard for something that needs attention (risk, anomaly, deadline, data issue).',
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
        title: str,
        detail: str
      },
      required: ['severity', 'title']
    }
  },
  {
    name: 'forecast_cash',
    description:
      'Cash-flow forecast for a company from its recorded revenue, expenses and cash, with optional what-if scenario: revenue_change_pct, expense_change_pct, collection_delay_months, growth_override_pct, and one_offs (period YYYY-MM, amount +inflow/-outflow, label). Returns monthly projected cash, the lowest point and runway.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        months: { type: 'number', description: 'Horizon, default 12, max 36.' },
        revenue_change_pct: { type: 'number' },
        expense_change_pct: { type: 'number' },
        collection_delay_months: { type: 'number' },
        growth_override_pct: { type: 'number' },
        one_offs: {
          type: 'array',
          items: { type: 'object', properties: { period: str, amount: { type: 'number' }, label: str }, required: ['period', 'amount'] }
        }
      },
      required: ['company_id']
    }
  },
  {
    name: 'budget_vs_actual',
    description: 'Compare budgets with actual metrics for a company over a period range (YYYY-MM). Returns variance and whether it is favorable.',
    input_schema: { type: 'object', properties: { company_id: companyIdProp, from: str, to: str }, required: ['company_id'] }
  },
  {
    name: 'set_budget',
    description: 'Save budget amounts (e.g. from a budget spreadsheet the user imported). Metric names like record_metrics; period YYYY-MM.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        entries: {
          type: 'array',
          items: { type: 'object', properties: { metric: str, period: str, amount: { type: 'number' }, note: str }, required: ['metric', 'period', 'amount'] }
        }
      },
      required: ['company_id', 'entries']
    }
  },
  {
    name: 'list_reminders',
    description: 'List open deadlines (tax, installments, contract renewals, salaries, insurance...) for a company or all companies, optionally up to a date.',
    input_schema: { type: 'object', properties: { company_id: companyIdProp, until: { type: 'string', description: 'YYYY-MM-DD' } } }
  },
  {
    name: 'add_reminder',
    description:
      'Add a deadline reminder, e.g. a VAT filing, a loan installment or a contract renewal found in a document. Recurring reminders roll forward when marked done.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: companyIdProp,
        title: str,
        type: { type: 'string', enum: ['tax', 'installment', 'contract', 'salary', 'insurance', 'other'] },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
        amount: { type: 'number' },
        recurrence: { type: 'string', enum: ['none', 'monthly', 'quarterly', 'yearly'] },
        remind_days: { type: 'number', description: 'Days before the due date to start reminding (default 7).' },
        notes: str
      },
      required: ['company_id', 'title', 'due_date']
    }
  },
  {
    name: 'query_connector',
    description:
      'Run a read-only query on a live company data source (database or accounting system) that the user allowed for AI. SQL connectors take a single SELECT; Odoo takes JSON {"model","domain","fields","limit"}; REST takes a path. Call with no query to list the available connectors.',
    input_schema: { type: 'object', properties: { connector_id: str, query: str, company_id: companyIdProp } }
  },
  {
    name: 'send_monthly_report',
    description:
      "Build the company's monthly report for a period and send it to the recipients configured in its report schedule (email/WhatsApp). Only use when the user explicitly asks to send it.",
    input_schema: { type: 'object', properties: { company_id: companyIdProp, period: { type: 'string', description: 'YYYY-MM, default last month' } }, required: ['company_id'] }
  },
  {
    name: 'generate_report',
    description:
      'Generate a professional report file (PDF, Excel or Word) in Arabic or English. Provide the full content: sections with paragraphs, bullet lists and tables. Numbers must come from the data you read. Returns the saved file path; the user gets a button to open it.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'Company id, or omit for a consolidated report.' },
        title: str,
        subtitle: str,
        format: { type: 'string', enum: ['pdf', 'xlsx', 'docx'] },
        language: { type: 'string', enum: ['ar', 'en'] },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              heading: str,
              paragraphs: { type: 'array', items: str },
              bullets: { type: 'array', items: str },
              table: {
                type: 'object',
                properties: {
                  columns: { type: 'array', items: str },
                  rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } } }
                },
                required: ['columns', 'rows']
              }
            },
            required: ['heading']
          }
        }
      },
      required: ['title', 'format', 'language', 'sections']
    }
  }
]

const ok = (content: unknown, summary: string): ToolOutcome => ({
  content: typeof content === 'string' ? content : JSON.stringify(content),
  ok: true,
  summary
})
const fail = (message: string): ToolOutcome => ({ content: `Error: ${message}`, ok: false, summary: message })

const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const n = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

function companyArg(input: Record<string, unknown>, ctx: ToolContext): string | undefined {
  return s(input.company_id) ?? ctx.companyId ?? undefined
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const x = Number(v.replace(/[,\s]/g, '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))))
    return Number.isFinite(x) ? x : null
  }
  return null
}

export async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  switch (name) {
    case 'list_companies': {
      const list = repo.listCompanies().map((c) => ({
        id: c.id,
        name: c.name,
        industry: c.industry,
        role: c.role,
        currency: c.currency,
        notes: c.notes
      }))
      return ok(list, `${list.length} companies`)
    }
    case 'list_documents': {
      const docs = repo
        .listDocuments({ companyId: companyArg(input, ctx), category: s(input.category), query: s(input.query), limit: n(input.limit, 100) })
        .map((d) => ({
          id: d.id,
          company_id: d.companyId,
          name: d.name,
          kind: d.kind,
          category: d.category,
          tags: d.tags,
          period: d.period,
          status: d.status,
          summary: d.summary,
          sheets: repo.listDocumentSheets(d.id)
        }))
      return ok(docs, `${docs.length} documents`)
    }
    case 'search_documents': {
      const query = s(input.query)
      if (!query) return fail('query is required')
      const hits = search(query, companyArg(input, ctx), n(input.limit, 20))
      return ok(hits, `${hits.length} matches for “${query}”`)
    }
    case 'read_document': {
      const doc = repo.getDocument(String(input.document_id ?? ''))
      if (!doc) return fail('document not found')
      const text = repo.getDocumentText(doc.id)
      const offset = n(input.offset, 0)
      const max = Math.min(n(input.max_chars, 20000), 60000)
      const page = text.slice(offset, offset + max)
      const more = offset + max < text.length ? `\n\n[truncated — ${text.length - offset - max} more chars; call again with offset=${offset + max}]` : ''
      return ok(`# ${doc.name} (${doc.category}, ${doc.period ?? 'no period'})\n\n${page || '(no text extracted)'}${more}`, doc.name)
    }
    case 'query_table': {
      const doc = repo.getDocument(String(input.document_id ?? ''))
      if (!doc) return fail('document not found')
      const table = repo.getDocumentTable(doc.id, s(input.sheet))
      if (!table) return fail(`no table data in ${doc.name}. Sheets: ${JSON.stringify(repo.listDocumentSheets(doc.id))}`)
      let rows = table.rows
      const contains = s(input.contains)?.toLowerCase()
      if (contains) rows = rows.filter((r) => r.some((c) => c !== null && String(c).toLowerCase().includes(contains)))
      const agg = input.aggregate as { op?: string; column?: string; group_by?: string } | undefined
      if (agg?.op) {
        const col = agg.column ? table.columns.indexOf(agg.column) : -1
        if (agg.op !== 'count' && col < 0) return fail(`unknown column ${agg.column}. Columns: ${table.columns.join(', ')}`)
        const gcol = agg.group_by ? table.columns.indexOf(agg.group_by) : -1
        const groups = new Map<string, number[]>()
        for (const r of rows) {
          const key = gcol >= 0 ? String(r[gcol] ?? '') : 'all'
          const v = col >= 0 ? toNumber(r[col]) : 1
          if (v === null) continue
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key)!.push(v)
        }
        const result = [...groups.entries()].map(([key, vals]) => {
          const sum = vals.reduce((a, b) => a + b, 0)
          const value =
            agg.op === 'sum' ? sum : agg.op === 'avg' ? sum / vals.length : agg.op === 'min' ? Math.min(...vals) : agg.op === 'max' ? Math.max(...vals) : vals.length
          return { group: key, value, rows: vals.length }
        })
        return ok({ sheet: table.sheet, op: agg.op, column: agg.column, group_by: agg.group_by, result }, `${agg.op}(${agg.column ?? '*'}) on ${doc.name}`)
      }
      const offset = n(input.offset, 0)
      const limit = Math.min(n(input.limit, 100), 500)
      return ok(
        { sheet: table.sheet, columns: table.columns, total_rows: rows.length, offset, rows: rows.slice(offset, offset + limit) },
        `${Math.min(limit, rows.length)} rows from ${doc.name}`
      )
    }
    case 'get_metrics': {
      const companyId = companyArg(input, ctx)
      if (!companyId) return fail('company_id is required')
      const list = repo.listMetrics({ companyId, metric: s(input.metric), from: s(input.from), to: s(input.to) })
      return ok(
        list.map((m) => ({ metric: m.metric, period: m.period, value: m.value, currency: m.currency, note: m.note })),
        `${list.length} metric values`
      )
    }
    case 'record_metrics': {
      const companyId = companyArg(input, ctx)
      if (!companyId || !repo.getCompany(companyId)) return fail('valid company_id is required')
      const entries = Array.isArray(input.entries) ? (input.entries as Record<string, unknown>[]) : []
      let saved = 0
      for (const e of entries) {
        const value = toNumber(e.value)
        const period = s(e.period)
        const metric = s(e.metric)
        if (value === null || !period || !metric || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) continue
        repo.upsertMetric({
          companyId,
          metric,
          period,
          value,
          currency: s(e.currency),
          sourceDocumentId: s(e.source_document_id) ?? null,
          note: s(e.note)
        })
        saved++
      }
      if (saved) {
        logActivity(companyId, 'metrics', `AI recorded ${saved} metric value(s)`)
        runChecks(companyId)
      }
      return ok(`Saved ${saved} of ${entries.length} entries.`, `${saved} metrics saved`)
    }
    case 'organize_document': {
      const id = String(input.document_id ?? '')
      const tags = Array.isArray(input.tags) ? (input.tags as unknown[]).map(String) : undefined
      const doc = repo.updateDocument(id, {
        category: s(input.category),
        tags,
        period: s(input.period),
        summary: s(input.summary),
        name: s(input.name)
      })
      if (!doc) return fail('document not found')
      return ok(`Updated ${doc.name}`, `organized ${doc.name}`)
    }
    case 'company_overview': {
      const companyId = companyArg(input, ctx)
      if (!companyId) return fail('company_id is required')
      return ok(
        {
          alerts: repo.listAlerts({ companyId, limit: 30 }),
          decisions: repo.listDecisions(companyId).slice(0, 20),
          activity: repo.listActivity(companyId, 20)
        },
        'overview'
      )
    }
    case 'add_decision': {
      const companyId = companyArg(input, ctx)
      const title = s(input.title)
      if (!companyId || !title) return fail('company_id and title are required')
      const d = repo.saveDecision({
        companyId,
        title,
        rationale: s(input.rationale) ?? '',
        expectedOutcome: s(input.expected_outcome) ?? '',
        reviewDate: s(input.review_date) ?? null
      })
      return ok({ id: d.id }, `decision logged: ${title}`)
    }
    case 'create_alert': {
      const title = s(input.title)
      if (!title) return fail('title is required')
      const severity = (['info', 'warning', 'critical'].includes(String(input.severity)) ? input.severity : 'info') as Severity
      const a = repo.createAlert({ companyId: companyArg(input, ctx) ?? null, severity, title, detail: s(input.detail), source: 'ai' })
      return ok({ id: a.id }, `alert: ${title}`)
    }
    case 'forecast_cash': {
      const companyId = companyArg(input, ctx)
      if (!companyId) return fail('company_id is required')
      const scenario: Scenario = {
        ...BASE_SCENARIO,
        revenueChangePct: n(input.revenue_change_pct, 0),
        expenseChangePct: n(input.expense_change_pct, 0),
        collectionDelayMonths: n(input.collection_delay_months, 0),
        growthOverridePct: typeof input.growth_override_pct === 'number' ? input.growth_override_pct : null,
        oneOffs: Array.isArray(input.one_offs)
          ? (input.one_offs as Record<string, unknown>[]).map((o) => ({ period: String(o.period), amount: toNumber(o.amount) ?? 0, label: String(o.label ?? '') }))
          : []
      }
      const f = companyForecast(companyId, scenario, Math.min(n(input.months, 12), 36))
      const round = (v: number): number => Math.round(v)
      return ok(
        {
          ...f,
          points: f.points.map((p) => ({ period: p.period, inflow: round(p.inflow), expenses: round(p.expenses), net: round(p.net), cash: round(p.cash) }))
        },
        `forecast: ${f.firstNegativePeriod ? `cash negative in ${f.firstNegativePeriod}` : 'no shortfall'}`
      )
    }
    case 'budget_vs_actual': {
      const companyId = companyArg(input, ctx)
      if (!companyId) return fail('company_id is required')
      const lines = budgetVsActual(companyId, s(input.from), s(input.to))
      return ok(lines, `${lines.length} budget lines`)
    }
    case 'set_budget': {
      const companyId = companyArg(input, ctx)
      if (!companyId || !repo.getCompany(companyId)) return fail('valid company_id is required')
      const entries = Array.isArray(input.entries) ? (input.entries as Record<string, unknown>[]) : []
      let saved = 0
      for (const e of entries) {
        const amount = toNumber(e.amount)
        const period = s(e.period)
        const metric = s(e.metric)
        if (amount === null || !metric || !period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) continue
        setBudget({ companyId, metric, period, amount, note: s(e.note) })
        saved++
      }
      if (saved) runChecks(companyId)
      return ok(`Saved ${saved} of ${entries.length} budget entries.`, `${saved} budget lines saved`)
    }
    case 'list_reminders': {
      const list = listReminders({ companyId: companyArg(input, ctx), status: 'open', until: s(input.until) })
      return ok(list, `${list.length} reminders`)
    }
    case 'add_reminder': {
      const companyId = companyArg(input, ctx)
      const title = s(input.title)
      const dueDate = s(input.due_date)
      if (!companyId || !title || !dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return fail('company_id, title and due_date (YYYY-MM-DD) are required')
      const r = saveReminder({
        companyId,
        title,
        dueDate,
        type: (s(input.type) ?? 'other') as Reminder['type'],
        amount: toNumber(input.amount),
        currency: repo.getCompany(companyId)?.currency ?? '',
        recurrence: (s(input.recurrence) ?? 'none') as Reminder['recurrence'],
        remindDays: n(input.remind_days, 7),
        notes: s(input.notes) ?? ''
      })
      return ok({ id: r.id }, `reminder: ${title} (${dueDate})`)
    }
    case 'query_connector': {
      const allowed = listConnectors(companyArg(input, ctx)).filter((c) => c.allowAi)
      const id = s(input.connector_id)
      if (!id || !s(input.query)) {
        return ok(
          allowed.map((c) => ({ id: c.id, company_id: c.companyId, name: c.name, type: c.type, datasets: c.datasets.map((d) => ({ name: d.name, query: d.query })) })),
          `${allowed.length} connectors`
        )
      }
      const c = getConnector(id)
      if (!c || !c.allowAi) return fail('connector not found or not allowed for AI')
      const res = await runQuery(c, s(input.query)!)
      return ok({ columns: res.columns, total_rows: res.rows.length, rows: res.rows.slice(0, 300) }, `${res.rows.length} rows from ${c.name}`)
    }
    case 'send_monthly_report': {
      const companyId = companyArg(input, ctx)
      if (!companyId) return fail('company_id is required')
      const sched = getSchedule(companyId)
      if (!sched.emails.length && !sched.whatsapp.length) return fail('no recipients configured for this company (Company → Automation)')
      const { report, errors } = await sendMonthlyReport(companyId, s(input.period))
      ctx.attachments.push({ type: 'report', id: report.id, name: report.title, path: report.path })
      return errors.length ? fail(errors.join('; ')) : ok(`Sent to ${[...sched.emails, ...sched.whatsapp].join(', ')}`, 'monthly report sent')
    }
    case 'generate_report': {
      const spec = input as unknown as ReportSpec
      if (!spec.title || !Array.isArray(spec.sections)) return fail('title and sections are required')
      spec.companyId = companyArg(input, ctx) ?? null
      const report = await generateReport(spec)
      ctx.attachments.push({ type: 'report', id: report.id, name: report.title, path: report.path })
      return ok({ path: report.path, format: report.format }, `${report.format.toUpperCase()} report: ${report.title}`)
    }
    default:
      return fail(`unknown tool ${name}`)
  }
}
