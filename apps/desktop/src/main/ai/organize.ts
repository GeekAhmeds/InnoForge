// Background "AI clerk": after a file is imported it reads it, files it under
// the right category/period and pulls headline numbers into the dashboard.
import * as repo from '../repo'
import { logActivity } from '../db'
import { activeProvider, runAgent } from './providers'
import { executeTool, TOOLS } from './tools'

const ORGANIZE_TOOLS = ['read_document', 'query_table', 'organize_document', 'record_metrics', 'add_reminder', 'set_budget', 'create_alert']

export async function organizeDocument(documentId: string): Promise<void> {
  const doc = repo.getDocument(documentId)
  if (!doc) return
  activeProvider() // throws if no AI is configured
  const company = repo.getCompany(doc.companyId)
  const sheets = repo.listDocumentSheets(doc.id)
  const ctx = { companyId: doc.companyId, attachments: [] }
  await runAgent({
    system: `You are the filing clerk of Azim Command, a financial command center used by a CFO who manages several companies.
A new file was imported for the company "${company?.name}" (industry: ${company?.industry || 'n/a'}, currency: ${company?.currency}).
Your job, using the tools:
1. Read the document (read_document; for spreadsheets use query_table).
2. Call organize_document once with: category (one of invoice, bank_statement, payroll, contract, budget, balance_sheet, income_statement, cash_flow, tax, inventory, purchase, sales, expenses, report, correspondence, other), 2-6 short tags, the period it covers (YYYY-MM, YYYY-Qn or YYYY), and a 1-2 sentence summary in the same language as the document.
3. If the document clearly states period totals (revenue, expenses, net_profit, cash, receivables, payables, payroll, gross_margin ...), record them with record_metrics (period YYYY-MM, use the last month of the covered period). Never estimate or invent numbers.
4. If the document contains a dated obligation (contract end/renewal, loan installment schedule, tax filing or payment due), add it with add_reminder (contracts: remind 30 days before; recurring installments: set recurrence). If it is a budget, save it with set_budget.
5. If you notice a real problem (inconsistent totals, overdue amounts, unusual items), raise one create_alert.
Be efficient: do not read more than you need. Reply with one short line when done.`,
    history: [],
    user: `Document id: ${doc.id}\nFile name: ${doc.name}\nKind: ${doc.kind}\nCurrent guess: category=${doc.category}, period=${doc.period ?? 'unknown'}\nSheets: ${JSON.stringify(sheets)}\nPreview: ${doc.summary}`,
    tools: TOOLS.filter((t) => ORGANIZE_TOOLS.includes(t.name)),
    exec: (name, input) => executeTool(name, input, ctx),
    maxSteps: 8,
    fast: true
  })
  logActivity(doc.companyId, 'ai', `AI organized ${doc.name}`)
}
