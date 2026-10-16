// Browser demo of Azim Command: the real UI running on an in-memory copy of
// the desktop API with sample companies. Used by docs/presentation so people
// can try the app without installing it. Nothing here ships in the desktop app.
import type { AzimApi } from '@shared/api'
import { toast } from '../src/components/Toast'
import { RISING_IS_BAD } from '@shared/forecast'
import type {
  ActivityItem,
  AgentTask,
  ChartSpec,
  Memory,
  Alert,
  Budget,
  ChatConversation,
  ChatEvent,
  ChatMessage,
  Company,
  CompanyDashboard,
  Connector,
  Decision,
  DocumentRecord,
  Metric,
  Reminder,
  Report,
  ReportSchedule,
  ServerUser,
  Settings,
  ToolStep
} from '@shared/types'

const params = new URLSearchParams(location.search)
const nowIso = (): string => new Date().toISOString()
let seq = 1000
const id = (p: string): string => `${p}-${++seq}`
const daysFromNow = (d: number): string => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const ago = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString()

function lastMonths(n: number): string[] {
  const out: string[] = []
  const d = new Date()
  d.setUTCDate(1)
  for (let i = n; i >= 1; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))
    out.push(`${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}
const MONTHS = lastMonths(12)
const LAST = MONTHS[MONTHS.length - 1]

// ---------------- sample data ----------------

const companies: Company[] = [
  { id: 'delta', name: 'مصنع الدلتا للصناعات الغذائية', industry: 'تصنيع أغذية', role: 'المدير المالي (CFO)', currency: 'EGP', color: '#2a78d6', watchFolder: 'D:\\Accounting\\Delta', notes: '', createdAt: ago(2000), updatedAt: ago(5) },
  { id: 'nile', name: 'النيل للمقاولات', industry: 'مقاولات وإنشاءات', role: 'مستشار مالي', currency: 'EGP', color: '#eb6834', watchFolder: null, notes: '', createdAt: ago(1800), updatedAt: ago(30) },
  { id: 'horizon', name: 'Horizon Trading LLC', industry: 'تجارة وتوزيع', role: 'مدير مالي', currency: 'USD', color: '#1baf7a', watchFolder: null, notes: '', createdAt: ago(1500), updatedAt: ago(60) }
]

const profiles: Record<string, { rev: number; g: number; exp: number; ge: number; cash: number; wobble: number }> = {
  delta: { rev: 4_200_000, g: 0.025, exp: 3_700_000, ge: 0.03, cash: 6_500_000, wobble: 0.06 },
  nile: { rev: 7_800_000, g: 0.004, exp: 7_350_000, ge: 0.008, cash: 2_400_000, wobble: 0.08 },
  horizon: { rev: 380_000, g: 0.04, exp: 310_000, ge: 0.02, cash: 520_000, wobble: 0.05 }
}

const metrics: Metric[] = []
for (const c of companies) {
  const p = profiles[c.id]
  let cash = p.cash
  MONTHS.forEach((period, i) => {
    const wob = 1 + Math.sin(i * 1.7 + c.id.length) * p.wobble
    const revenue = Math.round(p.rev * Math.pow(1 + p.g, i) * wob)
    const expenses = Math.round(p.exp * Math.pow(1 + p.ge, i) * (1 + Math.cos(i * 1.3) * p.wobble * 0.5))
    cash += revenue - expenses
    const rows: [string, number][] = [
      ['revenue', revenue],
      ['expenses', expenses],
      ['net_profit', revenue - expenses],
      ['cash', Math.round(cash)],
      ['receivables', Math.round(revenue * 1.4)],
      ['payables', Math.round(expenses * 0.8)]
    ]
    for (const [metric, value] of rows) {
      metrics.push({ id: id('m'), companyId: c.id, metric, period, value, currency: c.currency, sourceDocumentId: null, note: '', createdAt: ago(100) })
    }
  })
}

const budgets: Budget[] = []
for (const c of companies) {
  for (const period of MONTHS.slice(-6)) {
    const actual = (m: string): number => metrics.find((x) => x.companyId === c.id && x.metric === m && x.period === period)!.value
    budgets.push({ id: id('b'), companyId: c.id, metric: 'revenue', period, amount: Math.round(actual('revenue') * (c.id === 'nile' ? 1.12 : 0.97)), note: '' })
    budgets.push({ id: id('b'), companyId: c.id, metric: 'expenses', period, amount: Math.round(actual('expenses') * (c.id === 'nile' ? 0.95 : 1.03)), note: '' })
  }
}

const docNames: [string, string, string, DocumentRecord['kind'], string][] = [
  ['delta', `مبيعات_${LAST}.xlsx`, 'sales', 'excel', '3 جداول: المبيعات حسب المنتج والفرع والعميل'],
  ['delta', 'كشف حساب البنك الأهلي - سبتمبر.pdf', 'bank_statement', 'pdf', 'كشف حساب جاري؛ رصيد ختامي 8.9 مليون جنيه'],
  ['delta', 'رواتب الموظفين.xlsx', 'payroll', 'excel', '214 موظف؛ إجمالي الرواتب 1.1 مليون'],
  ['delta', 'عقد توريد خامات - شركة السكر.docx', 'contract', 'word', 'عقد توريد سنوي ينتهي في 31/12؛ تجديد تلقائي بإخطار 60 يوم'],
  ['delta', 'فاتورة كهرباء المصنع.jpg', 'invoice', 'image', 'فاتورة كهرباء 186,400 جنيه — مستحقة 25 من الشهر'],
  ['delta', '🔌 SQL Server — المبيعات الشهرية', 'report', 'database', '12 rows · مزامنة كل ساعة'],
  ['nile', 'مستخلصات المشروعات 2026.xlsx', 'sales', 'excel', 'مستخلصات 7 مشروعات؛ متأخرات تحصيل 4.2 مليون'],
  ['nile', 'جدول أقساط قرض المعدات.pdf', 'contract', 'pdf', 'قرض 12 مليون؛ قسط شهري 410 ألف حتى 2028'],
  ['nile', 'إقرار ضريبة القيمة المضافة.pdf', 'tax', 'pdf', `إقرار شهر ${LAST}`],
  ['horizon', 'Q3 P&L.xlsx', 'income_statement', 'excel', 'Quarterly P&L by product line'],
  ['horizon', 'Inventory count.csv', 'inventory', 'csv', '1 table: 1,240 SKUs'],
  ['horizon', 'Warehouse lease.docx', 'contract', 'word', 'Lease renews yearly — notice 90 days']
]
const documents: DocumentRecord[] = docNames.map(([companyId, name, category, kind, summary], i) => ({
  id: `doc-${i}`,
  companyId,
  name,
  kind,
  category,
  tags: [],
  period: category === 'contract' ? null : LAST,
  summary,
  size: 40_000 + i * 73_321,
  sha256: String(i),
  storedPath: '',
  originalPath: '',
  status: 'ready',
  error: null,
  createdAt: ago(i * 9 + 2),
  updatedAt: ago(i * 9 + 2)
}))

const reminders: Reminder[] = [
  { companyId: 'delta', title: 'إقرار ضريبة القيمة المضافة', type: 'tax', dueDate: daysFromNow(3), amount: 312_000, recurrence: 'monthly', remindDays: 7 },
  { companyId: 'nile', title: 'قسط قرض المعدات — البنك التجاري', type: 'installment', dueDate: daysFromNow(-2), amount: 410_000, recurrence: 'monthly', remindDays: 5 },
  { companyId: 'delta', title: 'تجديد عقد توريد الخامات', type: 'contract', dueDate: daysFromNow(24), amount: null, recurrence: 'yearly', remindDays: 60 },
  { companyId: 'horizon', title: 'Warehouse lease renewal', type: 'contract', dueDate: daysFromNow(41), amount: 96_000, recurrence: 'yearly', remindDays: 90 },
  { companyId: 'nile', title: 'التأمينات الاجتماعية', type: 'insurance', dueDate: daysFromNow(9), amount: 228_000, recurrence: 'monthly', remindDays: 5 },
  { companyId: 'delta', title: 'رواتب الشهر', type: 'salary', dueDate: daysFromNow(16), amount: 1_100_000, recurrence: 'monthly', remindDays: 3 }
].map((r, i) => ({ ...r, id: `rem-${i}`, currency: companies.find((c) => c.id === r.companyId)!.currency, status: 'open', notes: '', createdAt: ago(300), updatedAt: ago(300) }) as Reminder)

const alerts: Alert[] = [
  { companyId: 'nile', severity: 'critical', title: 'النيل للمقاولات: قسط قرض المعدات متأخر يومين', detail: '410,000 EGP' },
  { companyId: 'nile', severity: 'warning', title: `النيل للمقاولات: الإيرادات أقل من الموازنة بـ 11% (${LAST})`, detail: 'Budget vs actual' },
  { companyId: 'delta', severity: 'warning', title: 'مصنع الدلتا: المصروفات +18.4% عن الشهر السابق', detail: 'أغلب الزيادة من الكهرباء والخامات' },
  { companyId: 'horizon', severity: 'info', title: 'Horizon: 2 duplicate files skipped', detail: 'Inventory count.csv' }
].map((a, i) => ({ ...a, id: `al-${i}`, source: 'system', resolved: false, createdAt: ago(i * 5 + 1) }) as Alert)

const decisions: Decision[] = [
  { id: 'dec-1', companyId: 'delta', title: 'تركيب ألواح طاقة شمسية للمصنع', rationale: 'فاتورة الكهرباء زادت 40% في سنة', expectedOutcome: 'توفير 120 ألف شهرياً', actualOutcome: '', status: 'open', reviewDate: daysFromNow(20), createdAt: ago(400), updatedAt: ago(400) },
  { id: 'dec-2', companyId: 'nile', title: 'تشديد شروط التحصيل للمشروعات الجديدة', rationale: 'متأخرات 4.2 مليون', expectedOutcome: 'دورة تحصيل 60 يوم بدل 95', actualOutcome: '', status: 'open', reviewDate: daysFromNow(35), createdAt: ago(700), updatedAt: ago(700) }
]

const activity: ActivityItem[] = [
  ['delta', 'AI organized فاتورة كهرباء المصنع.jpg'],
  ['delta', 'SQL Server: refreshed 2 dataset(s), 24 rows'],
  ['nile', 'Monthly report sent (PDF) to 3 recipients'],
  ['delta', 'Reminder added: تجديد عقد توريد الخامات'],
  ['horizon', 'Imported 3 file(s)'],
  [null, 'Encrypted backup completed (184 MB)']
].map(([companyId, message], i) => ({ id: `act-${i}`, companyId, type: 'info', message: message!, createdAt: ago(i * 3 + 0.5) }))

const reports: Report[] = [
  { id: 'rep-1', companyId: 'delta', title: `التقرير الشهري — ${LAST}`, format: 'pdf', path: 'demo.pdf', createdAt: ago(20) },
  { id: 'rep-2', companyId: null, title: 'مقارنة الإيرادات والمصروفات — كل الشركات', format: 'xlsx', path: 'demo.xlsx', createdAt: ago(50) },
  { id: 'rep-3', companyId: 'nile', title: 'تحليل متأخرات التحصيل', format: 'docx', path: 'demo.docx', createdAt: ago(90) }
]

const connectors: Connector[] = [
  {
    id: 'con-1',
    companyId: 'delta',
    name: 'نظام المحاسبة (SQL Server)',
    type: 'mssql',
    config: { host: '10.0.0.5', port: 1433, database: 'DeltaERP', user: 'azim_readonly' },
    hasSecret: true,
    allowAi: true,
    refreshMinutes: 60,
    lastRunAt: ago(0.4),
    lastError: null,
    datasets: [
      { id: 'ds-1', connectorId: 'con-1', name: 'المبيعات الشهرية', query: "SELECT FORMAT(InvoiceDate,'yyyy-MM') AS period, SUM(Total) AS revenue FROM Invoices GROUP BY FORMAT(InvoiceDate,'yyyy-MM')", mode: 'metrics', documentId: 'doc-5', lastRows: 12, updatedAt: ago(0.4) },
      { id: 'ds-2', connectorId: 'con-1', name: 'أرصدة العملاء', query: 'SELECT CustomerName, Balance, DaysOverdue FROM vw_CustomerAging', mode: 'table', documentId: null, lastRows: 186, updatedAt: ago(0.4) }
    ]
  },
  {
    id: 'con-pos',
    companyId: 'delta',
    name: 'فروع البيع — InnoForge POS',
    type: 'innopos',
    config: { host: '192.168.1.20', port: 7790, username: 'azim', deviceId: 'azim-demo' },
    hasSecret: true,
    allowAi: true,
    refreshMinutes: 30,
    lastRunAt: ago(0.2),
    lastError: null,
    datasets: [
      { id: 'ds-p1', connectorId: 'con-pos', name: 'المؤشرات الشهرية (أرباح وخسائر)', query: '{"preset":"monthly_pl","months":12}', mode: 'metrics', documentId: null, lastRows: 63, updatedAt: ago(0.2) },
      { id: 'ds-p2', connectorId: 'con-pos', name: 'المبيعات اليومية', query: '{"report":"sales_by_day","range":"last_90_days"}', mode: 'table', documentId: null, lastRows: 90, updatedAt: ago(0.2) },
      { id: 'ds-p3', connectorId: 'con-pos', name: 'أعمار الديون', query: '{"report":"aging"}', mode: 'table', documentId: null, lastRows: 41, updatedAt: ago(0.2) }
    ]
  },
  {
    id: 'con-2',
    companyId: 'horizon',
    name: 'Odoo ERP',
    type: 'odoo',
    config: { url: 'https://horizon.odoo.com', database: 'horizon', user: 'cfo@horizon.com' },
    hasSecret: true,
    allowAi: false,
    refreshMinutes: 120,
    lastRunAt: ago(1.2),
    lastError: null,
    datasets: [{ id: 'ds-3', connectorId: 'con-2', name: 'Posted invoices', query: '{"model":"account.move","domain":[["state","=","posted"]],"fields":["name","amount_total"]}', mode: 'table', documentId: null, lastRows: 942, updatedAt: ago(1.2) }]
  }
]

const users: ServerUser[] = [
  { id: 'u1', name: 'منى — محاسبة مصنع الدلتا', role: 'accountant', companies: ['delta'], disabled: false, createdAt: ago(900), lastSeen: ago(2) },
  { id: 'u2', name: 'كريم — محاسب النيل', role: 'accountant', companies: ['nile'], disabled: false, createdAt: ago(800), lastSeen: ago(26) },
  { id: 'u3', name: 'مجلس الإدارة', role: 'viewer', companies: null, disabled: false, createdAt: ago(600), lastSeen: ago(100) }
]

const memories: Memory[] = [
  { id: 'mem-1', companyId: 'delta', content: 'السنة المالية لمصنع الدلتا بتبدأ في يوليو', createdAt: ago(300) },
  { id: 'mem-2', companyId: null, content: 'أحمد عاوز التقارير بالعربي، والملخص التنفيذي في الأول، والأرقام بالمليون', createdAt: ago(200) }
]

const tasks: AgentTask[] = [
  { id: 'task-1', name: 'مراجعة النقدية الأسبوعية', prompt: 'راجع النقدية والمستحقات لكل الشركات، وقارن بالأسبوع اللي فات، وطلّع أي خطر محتاج تدخل، وارسم رسم للنقدية.', companyId: null, schedule: 'weekly', time: '08:00', weekday: 0, dayOfMonth: 1, emails: ['ahmed@delta-foods.com'], whatsapp: ['+201001234567'], enabled: true, conversationId: null, lastRunAt: ago(30), lastStatus: 'ok' },
  { id: 'task-2', name: 'تقرير مبيعات الفروع اليومي', prompt: 'اسحب مبيعات امبارح من InnoForge POS لمصنع الدلتا، وقارنها بنفس اليوم الأسبوع اللي فات، وابعت ملخص قصير.', companyId: 'delta', schedule: 'daily', time: '09:30', weekday: 0, dayOfMonth: 1, emails: [], whatsapp: ['+201001234567'], enabled: true, conversationId: null, lastRunAt: ago(6), lastStatus: 'ok' }
]

const schedules = new Map<string, ReportSchedule>([
  ['delta', { companyId: 'delta', enabled: true, dayOfMonth: 3, emails: ['ahmed@delta-foods.com', 'board@delta-foods.com'], whatsapp: ['+201001234567'], language: 'ar', format: 'pdf', aiSummary: true, lastPeriodSent: LAST, lastError: null }]
])

let settings: Settings = {
  language: params.get('lang') === 'en' ? 'en' : 'ar',
  theme: (params.get('theme') as Settings['theme']) ?? 'system',
  activeProvider: 'anthropic',
  providers: {
    anthropic: { enabled: true, model: 'claude-opus-5-5', fastModel: 'claude-haiku-5-5', baseUrl: '', hasKey: true },
    openai: { enabled: false, model: 'gpt-5', fastModel: '', baseUrl: '', hasKey: false },
    gemini: { enabled: true, model: 'gemini-2.5-pro', fastModel: 'gemini-2.5-flash', baseUrl: '', hasKey: true },
    ollama: { enabled: true, model: 'qwen3:14b', fastModel: '', baseUrl: 'http://localhost:11434/v1', hasKey: false },
    compatible: { enabled: false, model: 'deepseek-chat', fastModel: '', baseUrl: 'https://api.deepseek.com/v1', hasKey: false }
  },
  agent: { fallback: true, effort: 'high', webSearch: true, maxSteps: 40 },
  autoOrganize: true,
  ocrLanguages: 'ara+eng',
  serverUrl: 'https://azim.0x01source.com:9990',
  syncEnabled: true,
  syncToken: 'demo',
  lastSyncAt: ago(0.05),
  anomalyThreshold: 25,
  account: { name: 'Ahmed Abdelazim', role: 'owner', companies: null },
  smtp: { host: 'smtp.gmail.com', port: 587, secure: false, user: 'reports@delta-foods.com', from: 'Azim Command <reports@delta-foods.com>', hasPassword: true },
  whatsapp: { phoneNumberId: '1234567890', apiVersion: 'v21.0', templateName: 'monthly_report', templateLanguage: 'ar', hasToken: true },
  reminderRecipients: { emails: ['ahmed@delta-foods.com'], whatsapp: ['+201001234567'] },
  lock: { enabled: true, idleMinutes: 10, hasPin: true },
  backup: { enabled: true, folder: 'E:\\Backups\\Azim', intervalHours: 24, keepLast: 14, lastAt: ago(3), hasPassword: true }
}

// ---------------- events ----------------

type Cb<T> = (v: T) => void
const listeners: Record<string, Set<Cb<any>>> = {}
const on = <T,>(ch: string, cb: Cb<T>): (() => void) => {
  ;(listeners[ch] ??= new Set()).add(cb)
  return () => listeners[ch].delete(cb)
}
const emit = (ch: string, v?: unknown): void => listeners[ch]?.forEach((cb) => cb(v))
const changed = (...scopes: string[]): void => emit('data:changed', scopes)
const ok = async <T,>(v: T): Promise<T> => structuredClone(v)

// ---------------- dashboards ----------------

const KPI_ORDER = ['revenue', 'expenses', 'net_profit', 'cash', 'receivables', 'payables']

function companyDashboard(cid: string): CompanyDashboard | null {
  const company = companies.find((c) => c.id === cid)
  if (!company) return null
  const ms = metrics.filter((m) => m.companyId === cid)
  const kpis = KPI_ORDER.filter((k) => ms.some((m) => m.metric === k)).map((metric) => {
    const series = ms.filter((m) => m.metric === metric)
    const last = series[series.length - 1]
    return { metric, value: last.value, previous: series[series.length - 2]?.value ?? null, period: last.period, currency: company.currency }
  })
  const trend = MONTHS.map((period) => {
    const p: { period: string; [k: string]: number | string } = { period }
    for (const m of ms) if (m.period === period) p[m.metric] = m.value
    return p
  })
  const cats = new Map<string, number>()
  for (const d of documents.filter((d) => d.companyId === cid)) cats.set(d.category, (cats.get(d.category) ?? 0) + 1)
  return {
    company,
    kpis,
    trend,
    categories: [...cats.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    documentCount: documents.filter((d) => d.companyId === cid).length,
    alerts: alerts.filter((a) => a.companyId === cid && !a.resolved),
    decisions: decisions.filter((d) => d.companyId === cid),
    activity: activity.filter((a) => a.companyId === cid)
  }
}

// ---------------- AI chat simulation ----------------

const conversations: ChatConversation[] = []
const messages: ChatMessage[] = []

function cannedAnswer(text: string, lang: 'ar' | 'en'): { steps: ToolStep[]; answer: string; report?: Report; charts?: ChartSpec[]; table?: { title: string; columns: string[]; rows: (string | number | null)[][] } } {
  const q = text.toLowerCase()
  const step = (name: string, summary: string): ToolStep => ({ name, input: {}, ok: true, summary })
  const delta = metrics.filter((m) => m.companyId === 'delta')
  const val = (m: string, p: string): number => delta.find((x) => x.metric === m && x.period === p)!.value
  const prev = MONTHS[MONTHS.length - 2]
  const fmt = (n: number): string => n.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')
  if (/pdf|تقرير|report|excel|اكسل|إكسل/.test(q)) {
    const format = /excel|اكسل|إكسل|xlsx/.test(q) ? 'xlsx' : 'pdf'
    const report: Report = { id: id('rep'), companyId: 'delta', title: lang === 'ar' ? `التقرير المالي — ${LAST}` : `Financial report — ${LAST}`, format, path: `demo.${format}`, createdAt: nowIso() }
    reports.unshift(report)
    return {
      steps: [step('list_documents', '6 documents'), step('get_metrics', '72 metric values'), step('budget_vs_actual', '12 budget lines'), step('forecast_cash', 'forecast: no shortfall'), step('generate_report', `${format.toUpperCase()} report: ${report.title}`)],
      answer:
        lang === 'ar'
          ? `جهّزت التقرير ✅\n\n**أهم النقاط:**\n- الإيرادات ${fmt(val('revenue', LAST))} جنيه مقابل ${fmt(val('revenue', prev))} الشهر اللي فات.\n- صافي الربح ${fmt(val('net_profit', LAST))} جنيه.\n- المصروفات أعلى من الموازنة في بند الكهرباء، وفيه قرار مفتوح (الطاقة الشمسية) محتاج مراجعة.\n- التوقع: النقدية مستقرة لمدة 12 شهر حتى لو التحصيل اتأخر شهر.\n\nالتقرير فيه ملخص تنفيذي، وجداول المؤشرات، والموازنة مقابل الفعلي، وتوقع النقدية، والمواعيد الجاية.`
          : `Your report is ready ✅\n\n- Revenue ${fmt(val('revenue', LAST))} vs ${fmt(val('revenue', prev))} last month.\n- Net profit ${fmt(val('net_profit', LAST))}.\n- Expenses above budget on electricity; the open solar-panel decision is due for review.\n- Cash stays positive for 12 months even with a one-month collection delay.`,
      report
    }
  }
  if (/حلل|تحليل|رسم|chart|analy|قارن|compare/.test(q)) {
    const series = (cid: string, m: string): number[] => MONTHS.map((p) => metrics.find((x) => x.companyId === cid && x.metric === m && x.period === p)!.value)
    const margin = companies.filter((c) => c.currency === 'EGP').map((c) => {
      const r = series(c.id, 'revenue').slice(-6).reduce((a, b) => a + b, 0)
      const e = series(c.id, 'expenses').slice(-6).reduce((a, b) => a + b, 0)
      return Math.round(((r - e) / r) * 1000) / 10
    })
    return {
      steps: [step('get_metrics', '216 metric values'), step('run_analysis', 'analysis done'), step('create_chart', 'chart: الإيرادات الشهرية'), step('create_chart', 'chart: هامش الربح'), step('show_table', 'table: ملخص 6 شهور (2 rows)')],
      answer:
        lang === 'ar'
          ? `حللت آخر 12 شهر لشركتين بالجنيه:\n\n- **مصنع الدلتا** بينمو بمعدل **${(profiles.delta.g * 100).toFixed(1)}% شهرياً** وهامشه مستقر.\n- **النيل للمقاولات** إيراداتها ثابتة تقريباً، بس المصروفات بتزيد أسرع، فالهامش بيقل كل شهر. لو الاتجاه ده كمل، هتوصل لنقطة التعادل خلال 5-6 شهور.\n\n**التوصية:** مراجعة عقود الموردين في النيل ووقف أي زيادة في التكاليف الثابتة.`
          : `12-month analysis (EGP companies): Delta grows ~${(profiles.delta.g * 100).toFixed(1)}%/month with a stable margin; Nile's costs grow faster than revenue, so its margin shrinks every month.`,
      charts: [
        { type: 'line', title: lang === 'ar' ? 'الإيرادات الشهرية' : 'Monthly revenue', labels: MONTHS, series: companies.filter((c) => c.currency === 'EGP').map((c) => ({ name: c.name, values: series(c.id, 'revenue') })), unit: 'EGP' },
        { type: 'bar', title: lang === 'ar' ? 'هامش الربح — آخر 6 شهور' : 'Profit margin — last 6 months', labels: companies.filter((c) => c.currency === 'EGP').map((c) => c.name), series: [{ name: lang === 'ar' ? 'الهامش' : 'Margin', values: margin }], unit: '%' }
      ],
      table: {
        title: lang === 'ar' ? 'ملخص آخر 6 شهور' : 'Last 6 months',
        columns: lang === 'ar' ? ['الشركة', 'الإيرادات', 'المصروفات', 'الهامش %'] : ['Company', 'Revenue', 'Expenses', 'Margin %'],
        rows: companies.filter((c) => c.currency === 'EGP').map((c, i) => [c.name, series(c.id, 'revenue').slice(-6).reduce((a, b) => a + b, 0), series(c.id, 'expenses').slice(-6).reduce((a, b) => a + b, 0), margin[i]])
      }
    }
  }
  if (/ماذا لو|لو |what if|تأخر|delay|سيناريو|scenario|نقدية|cash/.test(q)) {
    return {
      steps: [step('get_metrics', '36 metric values'), step('forecast_cash', 'forecast: cash negative in ' + MONTHS[2].slice(0, 4) + '-…'), step('forecast_cash', 'forecast: no shortfall')],
      answer:
        lang === 'ar'
          ? `حسبت سيناريو **تأخير التحصيل شهرين** لـ «النيل للمقاولات»:\n\n| | الوضع الحالي | مع التأخير |\n|---|---|---|\n| أقل رصيد نقدية | 2.1 مليون | **‑1.4 مليون** |\n| أول شهر بعجز | — | **بعد 3 شهور** |\n\n**التوصية:** تفعيل حد السحب على المكشوف (3 مليون) قبل الشهر التالت، أو تقسيط مستحقات المورد الرئيسي. تحب أسجل ده كقرار وأعمل تذكير بمراجعته؟`
          : `Scenario **collections delayed 2 months** for Nile Contracting:\n\n| | Baseline | Scenario |\n|---|---|---|\n| Lowest cash | 2.1M | **-1.4M** |\n| First shortfall | — | **in 3 months** |\n\n**Recommendation:** arrange a 3M overdraft line before month 3, or reschedule the main supplier. Shall I log this as a decision with a review reminder?`
    }
  }
  return {
    steps: [step('list_companies', '3 companies'), step('company_overview', 'overview'), step('budget_vs_actual', '18 budget lines'), step('list_reminders', '6 reminders')],
    answer:
      lang === 'ar'
        ? `**أكبر 3 مخاطر دلوقتي:**\n\n1. 🔴 **النيل للمقاولات**: قسط قرض المعدات (410 ألف) متأخر يومين، والإيرادات أقل من الموازنة بـ 11%، ومتأخرات تحصيل 4.2 مليون.\n2. 🟠 **مصنع الدلتا**: المصروفات زادت 18% عن الشهر اللي فات، وأغلبها كهرباء وخامات. عقد توريد الخامات بيتجدد بعد 24 يوم، ودي فرصة تفاوض.\n3. 🟡 **Horizon**: الأداء كويس، بس عقد المخزن بيتجدد بعد 41 يوم ومحتاج إخطار قبلها بـ 90 يوم، يعني **الإخطار متأخر**.\n\nتحب أعمل تقرير PDF بالكلام ده وأبعته لمجلس الإدارة؟`
        : `**Top 3 risks right now:**\n\n1. 🔴 **Nile Contracting** — equipment-loan installment (410K) is 2 days overdue, revenue 11% under budget, 4.2M receivables overdue.\n2. 🟠 **Delta Foods** — expenses +18% month over month (electricity and raw materials). The supply contract renews in 24 days — a chance to renegotiate.\n3. 🟡 **Horizon** — healthy, but the warehouse lease needs 90 days' notice and renews in 41 days: **notice is already late**.\n\nShall I turn this into a PDF for the board?`
  }
}

async function simulateChat(conversationId: string, text: string): Promise<ChatMessage> {
  const { steps, answer, report, charts, table } = cannedAnswer(text, settings.language)
  for (const s of steps) {
    await new Promise((r) => setTimeout(r, 450))
    emit('chat:event', { type: 'tool', conversationId, step: s } satisfies ChatEvent)
  }
  for (let i = 0; i < answer.length; i += 6) {
    await new Promise((r) => setTimeout(r, 14))
    emit('chat:event', { type: 'text', conversationId, delta: answer.slice(i, i + 6) } satisfies ChatEvent)
  }
  const msg: ChatMessage = {
    id: id('msg'),
    conversationId,
    role: 'assistant',
    content: answer,
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    toolSteps: steps,
    attachments: [
      ...(charts ?? []).map((chart) => ({ type: 'chart' as const, id: id('ch'), name: chart.title, chart })),
      ...(table ? [{ type: 'table' as const, id: id('tb'), name: table.title, table: { columns: table.columns, rows: table.rows } }] : []),
      ...(report ? [{ type: 'report' as const, id: report.id, name: report.title, path: report.path }] : [])
    ],
    createdAt: nowIso()
  }
  messages.push(msg)
  if (report) changed('reports')
  return msg
}

// ---------------- API ----------------

const notInDemo = async (): Promise<never> => {
  throw new Error(settings.language === 'ar' ? 'غير متاح في النسخة التجريبية' : 'Not available in the demo')
}

const api: AzimApi = {
  companies: {
    list: () => ok(companies),
    save: async (input) => {
      const existing = companies.find((c) => c.id === input.id)
      if (existing) Object.assign(existing, input)
      else companies.push({ id: id('co'), industry: '', role: '', currency: 'EGP', color: '#6250d6', watchFolder: null, notes: '', createdAt: nowIso(), updatedAt: nowIso(), ...input } as Company)
      changed('companies')
      return structuredClone(existing ?? companies[companies.length - 1])
    },
    remove: async (cid) => {
      companies.splice(companies.findIndex((c) => c.id === cid), 1)
      changed('companies')
    },
    pickFolder: async () => 'D:\\Shared\\Accounting'
  },
  documents: {
    list: (f) => ok(documents.filter((d) => (!f.companyId || d.companyId === f.companyId) && (!f.category || d.category === f.category) && (!f.query || d.name.includes(f.query)))),
    pickAndImport: notInDemo,
    importPaths: notInDemo,
    update: async () => null,
    remove: async (did) => {
      documents.splice(documents.findIndex((d) => d.id === did), 1)
      changed('documents')
    },
    reprocess: async () => undefined,
    open: async () => undefined,
    reveal: async () => undefined,
    sheets: async (did) => (documents.find((d) => d.id === did)?.kind === 'excel' ? [{ name: 'المبيعات', columns: ['المنتج', 'الفرع', 'الكمية', 'القيمة'], rowCount: 4 }] : []),
    table: async (did) =>
      documents.find((d) => d.id === did)?.kind === 'excel'
        ? { sheet: 'المبيعات', columns: ['المنتج', 'الفرع', 'الكمية', 'القيمة'], rows: [['عصير مانجو 1 لتر', 'القاهرة', 18200, 546000], ['عصير جوافة 1 لتر', 'الإسكندرية', 9400, 263200], ['مربى فراولة', 'القاهرة', 6100, 305000], ['صلصة طماطم', 'طنطا', 22000, 418000]] }
        : null,
    text: async (did) => documents.find((d) => d.id === did)?.summary ?? '',
    pathForFile: () => ''
  },
  search: async (q) =>
    documents
      .filter((d) => d.name.includes(q) || d.summary.includes(q))
      .map((d) => ({ documentId: d.id, companyId: d.companyId, name: d.name, snippet: d.summary.replace(q, `[${q}]`) })),
  dashboard: {
    overview: async () => {
      const list = companies.map((company) => {
        const latest: Record<string, number> = {}
        for (const m of metrics) if (m.companyId === company.id && m.period === LAST) latest[m.metric] = m.value
        return { company, documentCount: documents.filter((d) => d.companyId === company.id).length, openAlerts: alerts.filter((a) => a.companyId === company.id && !a.resolved).length, latest, latestPeriod: LAST }
      })
      const totals = KPI_ORDER.slice(0, 4).map((metric) => ({ metric, value: list.filter((c) => c.company.currency === 'EGP').reduce((s, c) => s + (c.latest[metric] ?? 0), 0) }))
      return structuredClone({ companies: list, totals, alerts: alerts.filter((a) => !a.resolved), activity })
    },
    company: async (cid) => structuredClone(companyDashboard(cid))
  },
  metrics: {
    list: (cid) => ok(metrics.filter((m) => m.companyId === cid)),
    save: async (m) => {
      const x: Metric = { id: id('m'), currency: '', sourceDocumentId: null, note: '', createdAt: nowIso(), ...m }
      metrics.push(x)
      changed('metrics')
      return x
    },
    remove: async (mid) => {
      metrics.splice(metrics.findIndex((m) => m.id === mid), 1)
      changed('metrics')
    }
  },
  alerts: {
    list: (cid) => ok(alerts.filter((a) => !a.resolved && (!cid || a.companyId === cid))),
    resolve: async (aid) => {
      alerts.find((a) => a.id === aid)!.resolved = true
      changed('alerts')
    }
  },
  decisions: {
    list: (cid) => ok(decisions.filter((d) => !cid || d.companyId === cid)),
    save: async (input) => {
      const d = decisions.find((x) => x.id === input.id)
      if (d) Object.assign(d, input)
      else decisions.unshift({ id: id('dec'), rationale: '', expectedOutcome: '', actualOutcome: '', status: 'open', reviewDate: null, createdAt: nowIso(), updatedAt: nowIso(), ...input } as Decision)
      changed('decisions')
      return structuredClone(d ?? decisions[0])
    },
    remove: async (did) => {
      decisions.splice(decisions.findIndex((d) => d.id === did), 1)
      changed('decisions')
    }
  },
  reports: {
    list: (cid) => ok(reports.filter((r) => !cid || r.companyId === cid)),
    open: async () => toast(settings.language === 'ar' ? 'في البرنامج الحقيقي التقرير بيتفتح هنا (PDF / Excel / Word).' : 'In the real app the report opens here.'),
    reveal: async () => undefined
  },
  chat: {
    conversations: () => ok(conversations),
    create: async (companyId) => {
      const c: ChatConversation = { id: id('conv'), companyId, title: 'New chat', createdAt: nowIso(), updatedAt: nowIso() }
      conversations.unshift(c)
      return c
    },
    remove: async (cid) => {
      conversations.splice(conversations.findIndex((c) => c.id === cid), 1)
    },
    messages: (cid) => ok(messages.filter((m) => m.conversationId === cid)),
    send: async (cid, text) => {
      messages.push({ id: id('msg'), conversationId: cid, role: 'user', content: text, provider: null, model: null, toolSteps: [], attachments: [], createdAt: nowIso() })
      const conv = conversations.find((c) => c.id === cid)!
      if (conv.title === 'New chat') conv.title = text.slice(0, 60)
      return simulateChat(cid, text)
    },
    cancel: async () => undefined,
    pickFiles: async () => [],
    onEvent: (cb) => on('chat:event', cb)
  },
  settings: {
    get: () => ok(settings),
    update: async (patch) => {
      settings = {
        ...settings,
        ...(patch as Partial<Settings>),
        providers: { ...settings.providers, ...Object.fromEntries(Object.entries(patch.providers ?? {}).map(([k, v]) => [k, { ...settings.providers[k as keyof Settings['providers']], ...v }])) },
        smtp: { ...settings.smtp, ...patch.smtp },
        whatsapp: { ...settings.whatsapp, ...patch.whatsapp },
        lock: { ...settings.lock, ...patch.lock },
        backup: { ...settings.backup, ...patch.backup },
        reminderRecipients: { ...settings.reminderRecipients, ...patch.reminderRecipients },
        agent: { ...settings.agent, ...patch.agent }
      }
      return structuredClone(settings)
    },
    setApiKey: () => ok(settings),
    setSecret: () => ok(settings),
    testProvider: async () => ({ ok: true, message: 'OK (demo)' }),
    testMessaging: async () => ({ ok: true, message: 'sent (demo)' })
  },
  reminders: {
    list: (f = {}) => ok(reminders.filter((r) => (!f.companyId || r.companyId === f.companyId) && (!f.status || r.status === f.status) && (!f.until || r.dueDate <= f.until)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))),
    save: async (input) => {
      const r = reminders.find((x) => x.id === input.id)
      if (r) Object.assign(r, input)
      else reminders.push({ id: id('rem'), type: 'other', amount: null, currency: '', recurrence: 'none', remindDays: 7, status: 'open', notes: '', createdAt: nowIso(), updatedAt: nowIso(), ...input } as Reminder)
      changed('reminders')
      return structuredClone(r ?? reminders[reminders.length - 1])
    },
    complete: async (rid) => {
      const r = reminders.find((x) => x.id === rid)!
      if (r.recurrence === 'none') r.status = 'done'
      else {
        const d = new Date(r.dueDate)
        d.setMonth(d.getMonth() + { monthly: 1, quarterly: 3, yearly: 12 }[r.recurrence])
        r.dueDate = d.toISOString().slice(0, 10)
      }
      changed('reminders')
      return structuredClone(r)
    },
    remove: async (rid) => {
      reminders.splice(reminders.findIndex((r) => r.id === rid), 1)
      changed('reminders')
    }
  },
  planning: {
    budgets: (cid) => ok(budgets.filter((b) => b.companyId === cid)),
    saveBudget: async (b) => {
      const x = { id: id('b'), note: '', ...b }
      budgets.push(x)
      changed('budgets')
      return x
    },
    removeBudget: async (bid) => {
      budgets.splice(budgets.findIndex((b) => b.id === bid), 1)
      changed('budgets')
    },
    budgetVsActual: async (cid, from, to) =>
      budgets
        .filter((b) => b.companyId === cid && (!from || b.period >= from) && (!to || b.period <= to))
        .map((b) => {
          const actual = metrics.find((m) => m.companyId === cid && m.metric === b.metric && m.period === b.period)?.value ?? null
          const variance = actual === null ? null : actual - b.amount
          return {
            metric: b.metric,
            period: b.period,
            budget: b.amount,
            actual,
            variance,
            variancePct: variance === null ? null : (variance / b.amount) * 100,
            favorable: variance === null ? null : RISING_IS_BAD.has(b.metric) ? variance <= 0 : variance >= 0
          }
        })
        .sort((a, b) => a.period.localeCompare(b.period)),
    forecastHistory: async (cid) =>
      MONTHS.map((period) => {
        const v = (m: string): number | undefined => metrics.find((x) => x.companyId === cid && x.metric === m && x.period === period)?.value
        return { period, revenue: v('revenue'), expenses: v('expenses'), cash: v('cash') }
      })
  },
  schedule: {
    get: async (cid) => structuredClone(schedules.get(cid) ?? { companyId: cid, enabled: false, dayOfMonth: 1, emails: [], whatsapp: [], language: 'ar', format: 'pdf', aiSummary: true, lastPeriodSent: null, lastError: null }),
    save: async (s) => {
      schedules.set(s.companyId, s)
      return structuredClone(s)
    },
    send: async () => ({ report: reports[0], errors: [] }),
    preview: async () => reports[0]
  },
  connectors: {
    list: (cid) => ok(connectors.filter((c) => !cid || c.companyId === cid)),
    save: async (input) => {
      const c = connectors.find((x) => x.id === input.id)
      if (c) Object.assign(c, input)
      else connectors.push({ id: id('con'), hasSecret: !!input.secret, allowAi: false, refreshMinutes: 60, lastRunAt: null, lastError: null, datasets: [], config: {}, ...input } as Connector)
      changed('connectors')
      return structuredClone(c ?? connectors[connectors.length - 1])
    },
    remove: async (cid) => {
      connectors.splice(connectors.findIndex((c) => c.id === cid), 1)
      changed('connectors')
    },
    test: async () => ({ ok: true, message: 'OK (demo)' }),
    refresh: async () => ({ ok: true, message: '24 rows (demo)' }),
    saveDataset: async (input) => {
      const c = connectors.find((x) => x.id === input.connectorId)!
      const ds = { id: id('ds'), mode: 'table' as const, documentId: null, lastRows: null, updatedAt: nowIso(), ...input }
      c.datasets.push(ds)
      changed('connectors')
      return ds
    },
    removeDataset: async () => changed('connectors'),
    preview: async () => ({ columns: ['period', 'revenue'], rows: MONTHS.slice(-6).map((p) => [p, metrics.find((m) => m.companyId === 'delta' && m.metric === 'revenue' && m.period === p)!.value]), total: 12 }),
    pickFile: async () => 'C:\\Data\\erp.sqlite'
  },
  accounts: {
    list: () => ok(users),
    create: async (u) => {
      const x: ServerUser = { id: id('u'), disabled: false, createdAt: nowIso(), lastSeen: null, ...u, token: 'inno_demo_' + Math.random().toString(16).slice(2, 18) }
      users.push(x)
      return x
    },
    update: async (uid, patch) => Object.assign(users.find((u) => u.id === uid)!, patch),
    rotate: async () => ({ token: 'inno_demo_' + Math.random().toString(16).slice(2, 18) }),
    remove: async (uid) => {
      users.splice(users.findIndex((u) => u.id === uid), 1)
    }
  },
  lock: {
    status: async () => params.get('locked') === '1',
    unlock: async (pin) => {
      const okPin = pin === '1234'
      if (okPin) emit('lock:changed', false)
      return { ok: okPin, waitSeconds: 0 }
    },
    lockNow: async () => emit('lock:changed', true),
    setPin: () => ok(settings),
    clearPin: () => ok(settings),
    onChange: (cb) => on('lock:changed', cb)
  },
  backup: {
    pickFolder: async () => 'E:\\Backups\\Azim',
    create: async () => ({ path: 'AzimCommand-Backup.azimbak', size: 184_000_000 }),
    runNow: async () => 'AzimCommand-Backup.azimbak',
    restore: async () => false
  },
  agent: {
    listModels: async (p) => (p === 'anthropic' ? ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'] : ['model-a', 'model-b']),
    memories: () => ok(memories),
    forget: async (mid) => {
      memories.splice(memories.findIndex((m) => m.id === mid), 1)
      changed('memories')
    },
    tasks: () => ok(tasks),
    saveTask: async (t) => {
      const x = tasks.find((y) => y.id === t.id)
      if (x) Object.assign(x, t)
      else tasks.push({ id: id('task'), companyId: null, schedule: 'weekly', time: '08:00', weekday: 0, dayOfMonth: 1, emails: [], whatsapp: [], enabled: true, conversationId: null, lastRunAt: null, lastStatus: null, ...t } as AgentTask)
      changed('tasks')
      return structuredClone(x ?? tasks[tasks.length - 1])
    },
    removeTask: async (tid) => {
      tasks.splice(tasks.findIndex((t) => t.id === tid), 1)
      changed('tasks')
    },
    runTask: async (tid) => {
      const x = tasks.find((t) => t.id === tid)!
      await new Promise((r) => setTimeout(r, 1200))
      x.lastRunAt = nowIso()
      x.lastStatus = 'ok'
      changed('tasks')
      return 'ok'
    }
  },
  sync: {
    status: async () => ({ state: 'ok', lastSyncAt: settings.lastSyncAt }),
    now: async () => ({ state: 'ok', lastSyncAt: nowIso() }),
    onStatus: (cb) => on('sync:status', cb)
  },
  updates: {
    status: async () => (params.get('update') === '1' ? { state: 'ready', version: '0.3.0' } : { state: 'none' }),
    check: async () => ({ state: 'none' }),
    install: async () => undefined,
    onStatus: (cb) => on('update:status', cb)
  },
  app: {
    version: async () => '0.2.0',
    onDataChanged: (cb) => on('data:changed', cb),
    onAccountChanged: (cb) => on('account:changed', cb),
    openExternal: async (url) => void window.open(url, '_blank')
  }
}

window.azim = api
