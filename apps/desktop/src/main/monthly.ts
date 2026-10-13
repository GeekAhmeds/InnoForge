// Automatic monthly report per company: built from the data (no AI needed),
// optionally with an AI-written executive summary, then emailed and/or sent
// on WhatsApp on the configured day of the month.
import { getDb, logActivity, now } from './db'
import { dataChanged } from './events'
import * as repo from './repo'
import { budgetVsActual, companyForecast } from './planning'
import { listReminders } from './reminders'
import { generateReport, type ReportSection } from './reports'
import { complete } from './ai/providers'
import { deliver } from './messaging'
import { addMonths } from '@shared/forecast'
import type { Lang, Report, ReportSchedule } from '@shared/types'

type Row = Record<string, any>

const toSchedule = (r: Row): ReportSchedule => ({
  companyId: r.company_id,
  enabled: !!r.enabled,
  dayOfMonth: r.day_of_month,
  emails: JSON.parse(r.emails),
  whatsapp: JSON.parse(r.whatsapp),
  language: r.language,
  format: r.format,
  aiSummary: !!r.ai_summary,
  lastPeriodSent: r.last_period_sent,
  lastError: r.last_error
})

export function getSchedule(companyId: string): ReportSchedule {
  const r = getDb().prepare('SELECT * FROM report_schedules WHERE company_id = ?').get(companyId) as Row | undefined
  return r
    ? toSchedule(r)
    : { companyId, enabled: false, dayOfMonth: 1, emails: [], whatsapp: [], language: 'ar', format: 'pdf', aiSummary: true, lastPeriodSent: null, lastError: null }
}

export function saveSchedule(s: ReportSchedule): ReportSchedule {
  const day = Math.min(28, Math.max(1, Math.round(s.dayOfMonth || 1)))
  getDb()
    .prepare(
      `INSERT INTO report_schedules (company_id, enabled, day_of_month, emails, whatsapp, language, format, ai_summary, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(company_id) DO UPDATE SET enabled=excluded.enabled, day_of_month=excluded.day_of_month, emails=excluded.emails,
         whatsapp=excluded.whatsapp, language=excluded.language, format=excluded.format, ai_summary=excluded.ai_summary, updated_at=excluded.updated_at`
    )
    .run(
      s.companyId,
      s.enabled ? 1 : 0,
      day,
      JSON.stringify(s.emails.map((e) => e.trim()).filter(Boolean)),
      JSON.stringify(s.whatsapp.map((e) => e.trim()).filter(Boolean)),
      s.language,
      s.format,
      s.aiSummary ? 1 : 0,
      now()
    )
  return getSchedule(s.companyId)
}

const L = (lang: Lang, ar: string, en: string): string => (lang === 'ar' ? ar : en)

const METRIC_AR: Record<string, string> = {
  revenue: 'الإيرادات',
  expenses: 'المصروفات',
  net_profit: 'صافي الربح',
  cash: 'النقدية',
  receivables: 'المستحقات',
  payables: 'الالتزامات',
  gross_margin: 'مجمل الربح',
  payroll: 'الرواتب'
}
const metricName = (m: string, lang: Lang): string => (lang === 'ar' ? (METRIC_AR[m] ?? m) : m.replace(/_/g, ' '))
const pct = (v: number | null): string => (v === null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)

/** Build the report for `period` (YYYY-MM, normally last month). */
export async function buildMonthlyReport(companyId: string, period: string, lang: Lang, format: ReportSchedule['format'], aiSummary: boolean): Promise<Report> {
  const company = repo.getCompany(companyId)
  if (!company) throw new Error('company not found')
  const prev = addMonths(period, -1)
  const metrics = repo.listMetrics({ companyId, from: addMonths(period, -5), to: period })
  const value = (m: string, p: string): number | null => metrics.find((x) => x.metric === m && x.period === p)?.value ?? null
  const names = [...new Set(metrics.filter((m) => m.period === period).map((m) => m.metric))]
  const sections: ReportSection[] = []

  const kpiRows = names.map((m) => {
    const cur = value(m, period)!
    const before = value(m, prev)
    return [metricName(m, lang), cur, before, before ? pct(((cur - before) / Math.abs(before)) * 100) : '—']
  })

  const budget = budgetVsActual(companyId, period, period)
  const forecast = companyForecast(companyId, undefined, 6)
  const alerts = repo.listAlerts({ companyId, limit: 15 })
  const until = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10)
  const reminders = listReminders({ companyId, status: 'open', until })
  const decisions = repo.listDecisions(companyId).filter((d) => d.status === 'open' && d.reviewDate && d.reviewDate <= until)

  let summary: string[] = []
  if (aiSummary) {
    try {
      const facts = JSON.stringify({ company: company.name, period, kpis: kpiRows, budget, forecast: forecast.points.slice(0, 3), runway: forecast.runwayMonths, alerts: alerts.map((a) => a.title), reminders: reminders.map((r) => `${r.title} ${r.dueDate}`) })
      const text = await complete(
        `You write the executive summary of a monthly financial report for a CFO. Write 4-6 short bullet points in ${lang === 'ar' ? 'Arabic' : 'English'}: what changed, why it matters, and what to do next. Use only the facts given. Output plain lines starting with "- ", nothing else.`,
        facts
      )
      summary = text
        .split('\n')
        .map((l) => l.replace(/^[-•*]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 6)
    } catch {
      // AI not configured or failed: the report is still complete without it.
    }
  }
  sections.push({
    heading: L(lang, 'الملخص التنفيذي', 'Executive summary'),
    paragraphs: [
      L(
        lang,
        `تقرير شهر ${period} لشركة ${company.name}. العملة: ${company.currency}.`,
        `Report for ${period} — ${company.name}. Currency: ${company.currency}.`
      )
    ],
    bullets: summary.length ? summary : undefined
  })
  if (kpiRows.length) {
    sections.push({
      heading: L(lang, 'المؤشرات الرئيسية', 'Key metrics'),
      table: { columns: [L(lang, 'المؤشر', 'Metric'), period, prev, L(lang, 'التغير', 'Change')], rows: kpiRows }
    })
  }
  if (budget.length) {
    sections.push({
      heading: L(lang, 'الموازنة مقابل الفعلي', 'Budget vs actual'),
      table: {
        columns: [L(lang, 'المؤشر', 'Metric'), L(lang, 'الموازنة', 'Budget'), L(lang, 'الفعلي', 'Actual'), L(lang, 'الانحراف', 'Variance'), '%', L(lang, 'التقييم', 'Status')],
        rows: budget.map((b) => [
          metricName(b.metric, lang),
          b.budget,
          b.actual,
          b.variance,
          pct(b.variancePct),
          b.favorable === null ? '—' : b.favorable ? L(lang, 'إيجابي', 'Favorable') : L(lang, 'سلبي', 'Unfavorable')
        ])
      }
    })
  }
  const periods = [...new Set(metrics.map((m) => m.period))].sort()
  const trendMetrics = ['revenue', 'expenses', 'net_profit', 'cash'].filter((m) => metrics.some((x) => x.metric === m))
  if (periods.length > 1 && trendMetrics.length) {
    sections.push({
      heading: L(lang, 'اتجاه آخر 6 شهور', 'Six-month trend'),
      table: {
        columns: [L(lang, 'الشهر', 'Month'), ...trendMetrics.map((m) => metricName(m, lang))],
        rows: periods.map((p) => [p, ...trendMetrics.map((m) => value(m, p))])
      }
    })
  }
  if (forecast.points.length && !forecast.warnings.includes('less_than_3_months_revenue')) {
    sections.push({
      heading: L(lang, 'توقعات التدفق النقدي (6 شهور)', 'Cash-flow forecast (6 months)'),
      paragraphs: [
        forecast.firstNegativePeriod
          ? L(lang, `⚠️ النقدية متوقع تبقى بالسالب في ${forecast.firstNegativePeriod}.`, `⚠️ Cash is projected to go negative in ${forecast.firstNegativePeriod}.`)
          : L(lang, 'لا يُتوقع عجز نقدي خلال الفترة.', 'No cash shortfall is projected in this horizon.'),
        ...(forecast.startCashKnown ? [] : [L(lang, 'ملاحظة: رصيد النقدية الحالي غير مسجل، الحساب بدأ من صفر.', 'Note: no cash balance recorded; the forecast starts from zero.')])
      ],
      table: {
        columns: [L(lang, 'الشهر', 'Month'), L(lang, 'التحصيلات', 'Inflows'), L(lang, 'المصروفات', 'Outflows'), L(lang, 'الصافي', 'Net'), L(lang, 'رصيد النقدية', 'Cash')],
        rows: forecast.points.map((p) => [p.period, Math.round(p.inflow), Math.round(p.expenses), Math.round(p.net), Math.round(p.cash)])
      }
    })
  }
  if (reminders.length) {
    sections.push({
      heading: L(lang, 'مواعيد قادمة (45 يوم)', 'Upcoming deadlines (45 days)'),
      table: {
        columns: [L(lang, 'الموعد', 'Due'), L(lang, 'البند', 'Item'), L(lang, 'المبلغ', 'Amount')],
        rows: reminders.map((r) => [r.dueDate, r.title, r.amount])
      }
    })
  }
  if (alerts.length) {
    sections.push({ heading: L(lang, 'تنبيهات مفتوحة', 'Open alerts'), bullets: alerts.map((a) => a.title) })
  }
  if (decisions.length) {
    sections.push({
      heading: L(lang, 'قرارات تحتاج مراجعة', 'Decisions due for review'),
      bullets: decisions.map((d) => `${d.title} — ${d.reviewDate}`)
    })
  }
  return generateReport({
    companyId,
    title: L(lang, `التقرير الشهري — ${period}`, `Monthly report — ${period}`),
    subtitle: company.name,
    format,
    language: lang,
    sections
  })
}

const lastMonth = (): string => addMonths(new Date().toISOString().slice(0, 7), -1)

export async function sendMonthlyReport(companyId: string, period = lastMonth()): Promise<{ report: Report; errors: string[] }> {
  const s = getSchedule(companyId)
  const company = repo.getCompany(companyId)!
  const report = await buildMonthlyReport(companyId, period, s.language, s.format, s.aiSummary)
  const subject = L(s.language, `التقرير الشهري — ${company.name} — ${period}`, `Monthly report — ${company.name} — ${period}`)
  const body = L(
    s.language,
    `مرفق التقرير المالي الشهري لشركة ${company.name} عن شهر ${period}.\n\nAzim Command — من تطوير شركة Inno Source For Software Solutions`,
    `Attached is the monthly financial report of ${company.name} for ${period}.\n\nAzim Command — developed by Inno Source For Software Solutions`
  )
  const errors = await deliver({ emails: s.emails, whatsapp: s.whatsapp }, subject, body, { path: report.path })
  const channels = [s.emails, s.whatsapp].filter((x) => x.length).length
  const allFailed = channels > 0 && errors.length >= channels
  getDb()
    .prepare('UPDATE report_schedules SET last_period_sent = ?, last_error = ? WHERE company_id = ?')
    .run(allFailed ? s.lastPeriodSent : period, errors.join('\n') || null, companyId)
  logActivity(companyId, 'report', `Monthly report ${period} ${errors.length ? 'sent with errors' : 'sent'}`)
  if (errors.length) {
    repo.createAlert({ companyId, severity: 'warning', title: `${company.name}: monthly report delivery failed`, detail: errors.join('\n') })
  }
  dataChanged('reports')
  return { report, errors }
}

// One automatic attempt per company per day, so a broken SMTP setting does
// not produce a new report file every scheduler tick.
const attempted = new Map<string, string>()

/** Called by the scheduler: send every report that is due and not sent yet. */
export async function runDueMonthlyReports(): Promise<void> {
  const today = new Date()
  const day = today.toISOString().slice(0, 10)
  const period = lastMonth()
  const rows = getDb().prepare('SELECT * FROM report_schedules WHERE enabled = 1').all() as Row[]
  for (const s of rows.map(toSchedule)) {
    if (today.getDate() < s.dayOfMonth || s.lastPeriodSent === period || !repo.getCompany(s.companyId)) continue
    if ((!s.emails.length && !s.whatsapp.length) || attempted.get(s.companyId) === day) continue
    attempted.set(s.companyId, day)
    try {
      await sendMonthlyReport(s.companyId, period)
    } catch (e) {
      getDb().prepare('UPDATE report_schedules SET last_error = ? WHERE company_id = ?').run((e as Error).message, s.companyId)
    }
  }
}
