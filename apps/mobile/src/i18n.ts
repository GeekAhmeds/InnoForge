import { createContext, useContext } from 'react'
import type { ReminderType, Role, Severity } from './api'

export type Lang = 'ar' | 'en'

const en = {
  appName: 'Azim Command',
  tagline: 'Financial command center',
  // tabs
  overview: 'Overview',
  alerts: 'Alerts',
  reminders: 'Reminders',
  settings: 'Settings',
  // login
  signInTitle: 'Connect to Inno Server',
  signInHint: 'Enter the server address and the access token issued from Azim Command on the desktop.',
  serverUrl: 'Server URL',
  accessToken: 'Access token',
  connect: 'Connect',
  connecting: 'Connecting…',
  errUnauthorized: 'The access token was rejected.',
  errNetwork: 'Could not reach the server. Check the address and your connection.',
  errTimeout: 'The server took too long to respond.',
  errGeneric: 'Something went wrong.',
  errMissing: 'Enter both the server URL and the access token.',
  // common
  retry: 'Retry',
  loadFailed: 'Could not load data',
  nothingHere: 'Nothing here yet',
  companies: 'Companies',
  noCompanies: 'No companies are available to your account.',
  keyFigures: 'Key figures',
  latestPeriodPerCompany: 'Latest period of each company',
  openAlerts: 'Open alerts',
  criticalCount: 'Critical',
  warningCount: 'Warning',
  upcoming: 'Upcoming reminders',
  noUpcoming: 'No upcoming reminders.',
  seeAll: 'See all',
  noAlerts: 'No open alerts. All clear.',
  noReminders: 'No open reminders.',
  noMetrics: 'No figures recorded yet.',
  vsPrevious: 'vs previous',
  period: 'Period',
  // company
  trend: 'Revenue & expenses',
  budgetVsActual: 'Budget vs actual',
  budget: 'Budget',
  actual: 'Actual',
  variance: 'Variance',
  favorable: 'Favorable',
  unfavorable: 'Unfavorable',
  noBudget: 'No budget for the latest period.',
  decisions: 'Decisions',
  noDecisions: 'No decisions recorded.',
  documents: 'Documents',
  noDocuments: 'No documents.',
  reports: 'Reports',
  noReports: 'No reports.',
  reviewOn: 'Review on',
  open: 'Open',
  done: 'Done',
  cancelled: 'Cancelled',
  share: 'Share',
  downloading: 'Downloading…',
  fileUnavailable: 'The original file is not available on the server.',
  // reminders
  overdue: 'Overdue',
  thisWeek: 'This week',
  thisMonth: 'This month',
  later: 'Later',
  dueToday: 'Due today',
  dueInDays: (n: number) => (n === 1 ? 'In 1 day' : `In ${n} days`),
  overdueByDays: (n: number) => (n === 1 ? '1 day overdue' : `${n} days overdue`),
  recurring: 'Recurring',
  // settings
  language: 'Language',
  arabic: 'العربية',
  english: 'English',
  server: 'Server',
  signedInAs: 'Signed in as',
  role: 'Role',
  allCompanies: 'All companies',
  companiesCount: (n: number) => `${n} companies`,
  notifications: 'Notifications',
  pushEnabled: 'Push notifications are enabled on this device.',
  pushDisabled: 'Push notifications are not enabled.',
  pushNeedsDevice: 'Push notifications need a physical device.',
  pushNeedsProject: 'Push notifications need an EAS project ID in app.json.',
  pushDenied: 'Notification permission was denied. Enable it in system settings.',
  enablePush: 'Enable notifications',
  logout: 'Sign out',
  logoutConfirm: 'Sign out of this device?',
  cancel: 'Cancel',
  version: 'Version',
  about: 'About',
  developedBy: 'Developed by Inno Source For Software Solutions',
  builtFor: 'Built for Ahmed Abdelazim'
}

export type Dict = typeof en

const ar: Dict = {
  appName: 'Azim Command',
  tagline: 'مركز القيادة المالية',
  overview: 'نظرة عامة',
  alerts: 'التنبيهات',
  reminders: 'التذكيرات',
  settings: 'الإعدادات',
  signInTitle: 'الاتصال بـ Inno Server',
  signInHint: 'أدخل عنوان السيرفر ورمز الدخول الصادر من برنامج Azim Command على الكمبيوتر.',
  serverUrl: 'عنوان السيرفر',
  accessToken: 'رمز الدخول',
  connect: 'اتصال',
  connecting: 'جاري الاتصال…',
  errUnauthorized: 'رمز الدخول مرفوض.',
  errNetwork: 'تعذّر الوصول للسيرفر. راجع العنوان والاتصال بالإنترنت.',
  errTimeout: 'السيرفر تأخر في الرد.',
  errGeneric: 'حدث خطأ غير متوقع.',
  errMissing: 'أدخل عنوان السيرفر ورمز الدخول.',
  retry: 'إعادة المحاولة',
  loadFailed: 'تعذّر تحميل البيانات',
  nothingHere: 'لا يوجد شيء بعد',
  companies: 'الشركات',
  noCompanies: 'لا توجد شركات متاحة لحسابك.',
  keyFigures: 'المؤشرات الرئيسية',
  latestPeriodPerCompany: 'آخر فترة لكل شركة',
  openAlerts: 'التنبيهات المفتوحة',
  criticalCount: 'حرجة',
  warningCount: 'تحذير',
  upcoming: 'التذكيرات القادمة',
  noUpcoming: 'لا توجد تذكيرات قادمة.',
  seeAll: 'عرض الكل',
  noAlerts: 'لا توجد تنبيهات مفتوحة. كل شيء تمام.',
  noReminders: 'لا توجد تذكيرات مفتوحة.',
  noMetrics: 'لا توجد أرقام مسجّلة بعد.',
  vsPrevious: 'عن الفترة السابقة',
  period: 'الفترة',
  trend: 'الإيرادات والمصروفات',
  budgetVsActual: 'الموازنة مقابل الفعلي',
  budget: 'الموازنة',
  actual: 'الفعلي',
  variance: 'الانحراف',
  favorable: 'إيجابي',
  unfavorable: 'سلبي',
  noBudget: 'لا توجد موازنة لآخر فترة.',
  decisions: 'القرارات',
  noDecisions: 'لا توجد قرارات مسجّلة.',
  documents: 'المستندات',
  noDocuments: 'لا توجد مستندات.',
  reports: 'التقارير',
  noReports: 'لا توجد تقارير.',
  reviewOn: 'المراجعة في',
  open: 'مفتوح',
  done: 'تم',
  cancelled: 'ملغي',
  share: 'مشاركة',
  downloading: 'جاري التنزيل…',
  fileUnavailable: 'الملف الأصلي غير متاح على السيرفر.',
  overdue: 'متأخرة',
  thisWeek: 'هذا الأسبوع',
  thisMonth: 'هذا الشهر',
  later: 'لاحقاً',
  dueToday: 'مستحق اليوم',
  dueInDays: (n: number) => (n === 1 ? 'بعد يوم' : n === 2 ? 'بعد يومين' : `بعد ${n} أيام`),
  overdueByDays: (n: number) => (n === 1 ? 'متأخر يوم' : n === 2 ? 'متأخر يومين' : `متأخر ${n} أيام`),
  recurring: 'متكرر',
  language: 'اللغة',
  arabic: 'العربية',
  english: 'English',
  server: 'السيرفر',
  signedInAs: 'مسجّل الدخول باسم',
  role: 'الصلاحية',
  allCompanies: 'كل الشركات',
  companiesCount: (n: number) => `${n} شركات`,
  notifications: 'الإشعارات',
  pushEnabled: 'الإشعارات مفعّلة على هذا الجهاز.',
  pushDisabled: 'الإشعارات غير مفعّلة.',
  pushNeedsDevice: 'الإشعارات تحتاج جهاز حقيقي.',
  pushNeedsProject: 'الإشعارات تحتاج EAS projectId في app.json.',
  pushDenied: 'تم رفض إذن الإشعارات. فعّله من إعدادات النظام.',
  enablePush: 'تفعيل الإشعارات',
  logout: 'تسجيل الخروج',
  logoutConfirm: 'تسجيل الخروج من هذا الجهاز؟',
  cancel: 'إلغاء',
  version: 'الإصدار',
  about: 'عن التطبيق',
  developedBy: 'من تطوير شركة Inno Source For Software Solutions',
  builtFor: 'صُمّم خصيصاً للأستاذ أحمد عبدالعظيم'
}

export const dictionaries: Record<Lang, Dict> = { en, ar }

type Pair = [en: string, ar: string]
const pick = (map: Record<string, Pair>, key: string, lang: Lang): string => {
  const l = map[key]
  return l ? l[lang === 'ar' ? 1 : 0] : key.replace(/_/g, ' ')
}

const METRICS: Record<string, Pair> = {
  revenue: ['Revenue', 'الإيرادات'],
  expenses: ['Expenses', 'المصروفات'],
  net_profit: ['Net profit', 'صافي الربح'],
  cash: ['Cash', 'النقدية'],
  receivables: ['Receivables', 'المستحقات (مدينون)'],
  payables: ['Payables', 'الالتزامات (دائنون)'],
  gross_margin: ['Gross margin', 'مجمل الربح'],
  payroll: ['Payroll', 'الرواتب'],
  debt: ['Debt', 'الديون'],
  cost_of_sales: ['Cost of sales', 'تكلفة المبيعات']
}

const REMINDER_TYPES: Record<ReminderType, Pair> = {
  tax: ['Tax', 'ضرائب'],
  installment: ['Installment', 'قسط'],
  contract: ['Contract renewal', 'تجديد عقد'],
  salary: ['Salaries', 'رواتب'],
  insurance: ['Insurance', 'تأمينات'],
  other: ['Other', 'أخرى']
}

const SEVERITIES: Record<Severity, Pair> = {
  critical: ['Critical', 'حرج'],
  warning: ['Warning', 'تحذير'],
  info: ['Info', 'معلومة']
}

const ROLES: Record<Role, Pair> = {
  owner: ['Owner', 'المالك'],
  admin: ['Administrator', 'مدير'],
  accountant: ['Accountant', 'محاسب'],
  viewer: ['Viewer', 'مشاهد']
}

const RECURRENCE: Record<string, Pair> = {
  monthly: ['Monthly', 'شهري'],
  quarterly: ['Quarterly', 'ربع سنوي'],
  yearly: ['Yearly', 'سنوي']
}

const CATEGORIES: Record<string, Pair> = {
  invoice: ['Invoices', 'فواتير'],
  bank_statement: ['Bank statements', 'كشوف حساب'],
  payroll: ['Payroll', 'رواتب'],
  contract: ['Contracts', 'عقود'],
  budget: ['Budgets', 'موازنات'],
  balance_sheet: ['Balance sheets', 'ميزانيات'],
  income_statement: ['Income statements', 'قوائم دخل'],
  cash_flow: ['Cash flow', 'تدفقات نقدية'],
  tax: ['Tax', 'ضرائب'],
  inventory: ['Inventory', 'مخزون'],
  purchase: ['Purchases', 'مشتريات'],
  sales: ['Sales', 'مبيعات'],
  expenses: ['Expenses', 'مصروفات'],
  report: ['Reports', 'تقارير'],
  correspondence: ['Correspondence', 'مراسلات'],
  other: ['Other', 'أخرى'],
  uncategorized: ['Uncategorized', 'غير مصنّف']
}

export const metricLabel = (m: string, lang: Lang) => pick(METRICS, m, lang)
export const reminderTypeLabel = (t: string, lang: Lang) => pick(REMINDER_TYPES, t, lang)
export const severityLabel = (s: string, lang: Lang) => pick(SEVERITIES, s, lang)
export const roleLabel = (r: string, lang: Lang) => pick(ROLES, r, lang)
export const recurrenceLabel = (r: string, lang: Lang) => pick(RECURRENCE, r, lang)
export const categoryLabel = (c: string, lang: Lang) => pick(CATEGORIES, c, lang)

export interface I18n {
  lang: Lang
  t: Dict
  rtl: boolean
  setLang: (lang: Lang) => void
}

export const I18nContext = createContext<I18n>({ lang: 'ar', t: ar, rtl: true, setLang: () => {} })
export const useI18n = (): I18n => useContext(I18nContext)
