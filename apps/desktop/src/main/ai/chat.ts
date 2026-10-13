import { getDb, now, uid } from '../db'
import * as repo from '../repo'
import { broadcast } from '../events'
import { runAgent, type HistoryTurn } from './providers'
import { executeTool, TOOLS, type ToolContext } from './tools'
import { getSettings } from '../settings'
import { listMemories, setTaskRunner } from './agent'
import type { AgentTask, ChatConversation, ChatMessage, ToolStep } from '@shared/types'

type Row = Record<string, any>

const toConversation = (r: Row): ChatConversation => ({
  id: r.id,
  companyId: r.company_id,
  title: r.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toMessage = (r: Row): ChatMessage => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content,
  provider: r.provider,
  model: r.model,
  toolSteps: JSON.parse(r.tool_steps),
  attachments: JSON.parse(r.attachments),
  createdAt: r.created_at
})

export function listConversations(): ChatConversation[] {
  return (getDb().prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all() as Row[]).map(toConversation)
}

export function createConversation(companyId: string | null): ChatConversation {
  const id = uid()
  const ts = now()
  getDb()
    .prepare('INSERT INTO conversations (id, company_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, companyId, 'New chat', ts, ts)
  return toConversation(getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Row)
}

export function deleteConversation(id: string): void {
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

export function listMessages(conversationId: string): ChatMessage[] {
  return (
    getDb().prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at').all(conversationId) as Row[]
  ).map(toMessage)
}

function insertMessage(m: Omit<ChatMessage, 'id' | 'createdAt'> & { native?: unknown[] | null }): ChatMessage {
  const id = uid()
  getDb()
    .prepare(
      `INSERT INTO messages (id, conversation_id, role, content, provider, model, native, tool_steps, attachments, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      m.conversationId,
      m.role,
      m.content,
      m.provider,
      m.model,
      m.native ? JSON.stringify(m.native) : null,
      JSON.stringify(m.toolSteps),
      JSON.stringify(m.attachments),
      now()
    )
  getDb().prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), m.conversationId)
  return toMessage(getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as Row)
}

function history(conversationId: string): HistoryTurn[] {
  return (
    getDb().prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at').all(conversationId) as Row[]
  ).map((r) => ({
    role: r.role,
    content: r.content,
    provider: r.provider,
    model: r.model,
    native: r.native ? JSON.parse(r.native) : null
  }))
}

function systemPrompt(companyId: string | null): string {
  const s = getSettings()
  const memories = listMemories(companyId)
  const companies = repo.listCompanies()
  const scope = companyId ? repo.getCompany(companyId) : null
  const lines = companies.map(
    (c) => `- ${c.name} (id: ${c.id}; industry: ${c.industry || 'n/a'}; Azim's role: ${c.role || 'n/a'}; currency: ${c.currency})`
  )
  return `You are the AI analyst inside "Azim Command", the private financial command center of Ahmed Abdelazim (Azim).
Azim oversees several companies — as CFO, financial manager or advisor depending on the company — and uses you to organize their messy data (Excel sheets, PDFs, Word files, scanned images, databases) and to analyze it.

Companies:
${lines.join('\n') || '(none yet — suggest adding companies and importing files)'}
${scope ? `\nThis conversation is focused on: ${scope.name} (id: ${scope.id}). Use it as the default company.` : '\nThis conversation covers all companies (consolidated view).'}

${memories.length ? `\nWhat you remember (from earlier conversations; ids for forget_memory):\n${memories.map((m) => `- [${m.id}] ${m.content}`).join('\n')}\n` : ''}
You are an autonomous agent: plan the steps, use as many tools as the task needs, check your own numbers, and finish the job instead of asking for permission at every step. Ask only when a decision is genuinely the user's.

How to work:
- Ground every number in the data: find documents (list_documents / search_documents), read them (read_document / query_table), and say which file a figure came from. If the data is missing, say so — never invent figures.
- When you extract reliable period totals, save them with record_metrics so the live dashboard updates.
- When asked for a report, build it with generate_report (PDF, Excel or Word) in the language requested (default: the user's language). Use clear sections, tables for numbers, and an executive summary first.
- Planning: use forecast_cash for cash-flow projections and what-if questions ("what if collections slip two months?"), budget_vs_actual / set_budget for budgets, and add_reminder for any deadline you find (tax filings, loan installments, contract renewals).
- Live systems: query_connector reads company databases/accounting systems the user connected (read-only).
- Analysis: for any real computation (totals over many rows, growth, pivots, correlations, outliers, regressions) use run_analysis instead of doing arithmetic in your head.
- Visuals: show trends and comparisons with create_chart, detailed figures with show_table; put charts in reports too (a section's "chart").
- Memory: save durable facts and preferences with remember. Recurring work ("every Monday…") → schedule_task.
- Web: when web search is available, use it for outside facts (exchange rates, tax rules, market prices) and cite the source.
- Proactively point out risks, anomalies and decisions worth considering; log agreed decisions with add_decision and raise alerts with create_alert.
- Reply in the user's language (Arabic or English). Use Markdown: short paragraphs, tables for figures.
- Today is ${new Date().toISOString().slice(0, 10)}. Default UI language: ${s.language === 'ar' ? 'Arabic' : 'English'}.`
}

const running = new Map<string, AbortController>()

export function cancel(conversationId: string): void {
  running.get(conversationId)?.abort()
}

export async function sendMessage(conversationId: string, text: string, opts: { fast?: boolean } = {}): Promise<ChatMessage> {
  const conv = getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as Row | undefined
  if (!conv) throw new Error('Conversation not found')
  const prior = history(conversationId)
  insertMessage({
    conversationId,
    role: 'user',
    content: text,
    provider: null,
    model: null,
    toolSteps: [],
    attachments: []
  })
  if (!prior.length) {
    getDb().prepare('UPDATE conversations SET title = ? WHERE id = ?').run(text.slice(0, 60), conversationId)
  }

  const controller = new AbortController()
  running.set(conversationId, controller)
  const steps: ToolStep[] = []
  const ctx: ToolContext = { companyId: conv.company_id, attachments: [] }
  try {
    const result = await runAgent({
      system: systemPrompt(conv.company_id),
      history: prior,
      user: text,
      tools: TOOLS,
      webSearch: true,
      fast: opts.fast,
      exec: (name, input) => executeTool(name, input, ctx),
      onText: (delta) => broadcast('chat:event', { type: 'text', conversationId, delta }),
      onTool: (step) => {
        steps.push(step)
        broadcast('chat:event', { type: 'tool', conversationId, step })
      },
      signal: controller.signal
    })
    const msg = insertMessage({
      conversationId,
      role: 'assistant',
      content: result.text,
      provider: result.provider,
      model: result.model,
      native: result.native,
      toolSteps: steps,
      attachments: ctx.attachments
    })
    broadcast('chat:event', { type: 'done', conversationId, message: msg })
    return msg
  } catch (e) {
    const error = controller.signal.aborted ? 'Stopped.' : (e as Error).message
    broadcast('chat:event', { type: 'error', conversationId, error })
    // Keep the transcript well-formed: every user turn gets an answer.
    const msg = insertMessage({
      conversationId,
      role: 'assistant',
      content: `⚠️ ${error}`,
      provider: null,
      model: null,
      toolSteps: steps,
      attachments: ctx.attachments
    })
    return msg
  } finally {
    running.delete(conversationId)
  }
}

// Scheduled agent tasks run as a normal conversation, so the user can read the
// work, ask follow-ups and see charts and reports it produced.
setTaskRunner(async (task: AgentTask) => {
  const existing = task.conversationId
    ? (getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(task.conversationId) as Row | undefined)
    : undefined
  const conv = existing ? toConversation(existing) : createConversation(task.companyId)
  getDb().prepare('UPDATE conversations SET title = ? WHERE id = ?').run(`⏱ ${task.name}`, conv.id)
  const msg = await sendMessage(conv.id, `${task.prompt}\n\n(Scheduled task "${task.name}", ${new Date().toISOString().slice(0, 16).replace('T', ' ')})`, { fast: false })
  if (msg.content.startsWith('⚠️')) throw new Error(msg.content.slice(2).trim())
  return { text: msg.content, conversationId: conv.id }
})
