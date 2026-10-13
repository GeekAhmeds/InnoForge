// Row components shared by the overview, company and tab screens.
import { StyleSheet, View } from 'react-native'
import type { Alert, Company, Reminder, Severity } from '../api'
import { daysUntil, formatDate, formatMoney } from '../format'
import { recurrenceLabel, reminderTypeLabel, severityLabel, useI18n } from '../i18n'
import { radius, space, useColors, type Palette } from '../theme'
import { Icon } from './Icons'
import { Dot } from './Layout'
import { Txt } from './Txt'

const severityColor = (s: Severity, c: Palette) => (s === 'critical' ? c.critical : s === 'warning' ? c.warning : c.info)

/** Severity is always shown as icon + text, never by color alone. */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const { lang } = useI18n()
  const c = useColors()
  const color = severityColor(severity, c)
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Icon name={severity} color={color} size={14} />
      <Txt variant="small" color={color} style={{ fontWeight: '700' }}>
        {severityLabel(severity, lang)}
      </Txt>
    </View>
  )
}

export function AlertItem({ alert, company }: { alert: Alert; company?: Company }) {
  const { lang } = useI18n()
  const c = useColors()
  return (
    <View style={[styles.item, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.row}>
        <SeverityBadge severity={alert.severity} />
        <Txt variant="small" style={{ flex: 1 }} numberOfLines={1}>
          {formatDate(alert.created_at, lang)}
        </Txt>
      </View>
      <Txt variant="label" color={c.text} style={{ fontSize: 15 }}>
        {alert.title}
      </Txt>
      {alert.detail ? <Txt variant="muted">{alert.detail}</Txt> : null}
      {company ? <CompanyTag company={company} /> : null}
    </View>
  )
}

export function ReminderItem({ reminder, company }: { reminder: Reminder; company?: Company }) {
  const { lang, t } = useI18n()
  const c = useColors()
  const days = daysUntil(reminder.due_date)
  const overdue = days < 0
  const soon = !overdue && days <= (reminder.remind_days ?? 7)
  const when = days === 0 ? t.dueToday : overdue ? t.overdueByDays(-days) : t.dueInDays(days)
  return (
    <View style={[styles.item, { backgroundColor: c.card, borderColor: overdue ? c.bad : c.border }]}>
      <View style={styles.row}>
        <View style={[styles.chip, { backgroundColor: c.bg }]}>
          <Txt variant="small" color={c.text} style={{ fontWeight: '600' }}>
            {reminderTypeLabel(reminder.type, lang)}
          </Txt>
        </View>
        {reminder.recurrence && reminder.recurrence !== 'none' ? <Txt variant="small">{recurrenceLabel(reminder.recurrence, lang)}</Txt> : null}
        <View style={{ flex: 1 }} />
        {overdue ? <Icon name="warning" color={c.bad} size={14} /> : null}
        <Txt variant="small" color={overdue ? c.bad : soon ? c.warning : c.muted} style={{ fontWeight: '600' }}>
          {when}
        </Txt>
      </View>
      <Txt variant="label" color={c.text} style={{ fontSize: 15 }}>
        {reminder.title}
      </Txt>
      <View style={styles.row}>
        <Txt variant="small" style={{ flex: 1 }}>
          {formatDate(reminder.due_date, lang)}
        </Txt>
        {reminder.amount !== null && reminder.amount !== undefined ? (
          <Txt variant="label" color={c.text}>
            {formatMoney(reminder.amount, reminder.currency, lang, false)}
          </Txt>
        ) : null}
      </View>
      {company ? <CompanyTag company={company} /> : null}
    </View>
  )
}

export function CompanyTag({ company }: { company: Company }) {
  const c = useColors()
  return (
    <View style={styles.row}>
      <Dot color={company.color || c.muted} size={8} />
      <Txt variant="small">{company.name}</Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  item: { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }
})
