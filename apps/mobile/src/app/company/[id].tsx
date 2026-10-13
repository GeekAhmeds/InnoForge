import { Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, Alert as NativeAlert, Pressable, StyleSheet, View } from 'react-native'
import { api, type Company, type Decision, type DocumentRow } from '../../api'
import { BudgetTable } from '../../components/BudgetTable'
import { Icon } from '../../components/Icons'
import { AlertItem, ReminderItem } from '../../components/Items'
import { Card, Divider, Dot, Empty, Screen, Section } from '../../components/Layout'
import { KpiGrid } from '../../components/KpiCard'
import { TrendChart } from '../../components/TrendChart'
import { Txt } from '../../components/Txt'
import { openDocument } from '../../files'
import { budgetVsActual, companyKpis, openAlerts, openReminders, parseTags, revenueExpenseTrend } from '../../finance'
import { formatDate, formatPeriod, formatSize } from '../../format'
import { categoryLabel, useI18n } from '../../i18n'
import { useConfig } from '../../session'
import { space, useColors } from '../../theme'
import { useData } from '../../useData'

export default function CompanyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { t, lang } = useI18n()
  const c = useColors()

  const state = useData(`company:${id}`, async (cfg) => {
    const opts = { companyId: id, limit: 500 }
    const [companies, metrics, budgets, alerts, reminders, decisions, documents, reports] = await Promise.all([
      api.table(cfg, 'companies'),
      api.table(cfg, 'metrics', { companyId: id, limit: 5000 }),
      api.table(cfg, 'budgets', opts),
      api.table(cfg, 'alerts', opts),
      api.table(cfg, 'reminders', opts),
      api.table(cfg, 'decisions', opts),
      api.table(cfg, 'documents', opts),
      api.table(cfg, 'reports', opts)
    ])
    const company = companies.find((co) => co.id === id) ?? null
    return { company, metrics, budgets, alerts, reminders, decisions, documents, reports }
  })

  return (
    <>
      <Stack.Screen options={{ title: state.data?.company?.name ?? '' }} />
      <Screen state={state}>
        {(d) => {
          const company = d.company
          const kpis = companyKpis(d.metrics, company ?? undefined)
          const trend = revenueExpenseTrend(d.metrics)
          const budget = budgetVsActual(d.budgets, d.metrics)
          const alerts = openAlerts(d.alerts)
          const reminders = openReminders(d.reminders)
          const documents = [...d.documents].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30)
          const reports = [...d.reports].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20)

          return (
            <>
              {company ? <CompanyHeader company={company} /> : null}

              <Section title={t.keyFigures}>
                {kpis.length ? (
                  <KpiGrid kpis={kpis} />
                ) : (
                  <Card>
                    <Empty text={t.noMetrics} />
                  </Card>
                )}
              </Section>

              {trend.length > 1 ? (
                <Section title={t.trend}>
                  <Card>
                    <TrendChart points={trend} />
                  </Card>
                </Section>
              ) : null}

              <Section title={budget.period ? `${t.budgetVsActual} · ${formatPeriod(budget.period, lang)}` : t.budgetVsActual}>
                {budget.lines.length ? (
                  <BudgetTable lines={budget.lines} currency={company?.currency ?? null} />
                ) : (
                  <Card>
                    <Empty text={t.noBudget} />
                  </Card>
                )}
              </Section>

              <Section title={t.alerts}>
                {alerts.length ? (
                  alerts.map((a) => <AlertItem key={a.id} alert={a} />)
                ) : (
                  <Card>
                    <Empty text={t.noAlerts} />
                  </Card>
                )}
              </Section>

              <Section title={t.reminders}>
                {reminders.length ? (
                  reminders.slice(0, 10).map((r) => <ReminderItem key={r.id} reminder={r} />)
                ) : (
                  <Card>
                    <Empty text={t.noReminders} />
                  </Card>
                )}
              </Section>

              <Section title={t.decisions}>
                <Card>{d.decisions.length ? d.decisions.slice(0, 10).map((dec, i) => <DecisionRow key={dec.id} decision={dec} first={i === 0} />) : <Empty text={t.noDecisions} />}</Card>
              </Section>

              <Section title={t.documents}>
                <Card>{documents.length ? documents.map((doc, i) => <DocumentRowView key={doc.id} doc={doc} first={i === 0} />) : <Empty text={t.noDocuments} />}</Card>
              </Section>

              <Section title={t.reports}>
                <Card>
                  {reports.length ? (
                    reports.map((r, i) => (
                      <View key={r.id}>
                        {i > 0 ? <Divider /> : null}
                        <View style={styles.listRow}>
                          <Icon name="report" color={c.muted} size={20} />
                          <View style={{ flex: 1 }}>
                            <Txt variant="label" color={c.text}>
                              {r.title}
                            </Txt>
                            <Txt variant="small">
                              {r.format.toUpperCase()} · {formatDate(r.created_at, lang)}
                            </Txt>
                          </View>
                        </View>
                      </View>
                    ))
                  ) : (
                    <Empty text={t.noReports} />
                  )}
                </Card>
              </Section>
            </>
          )
        }}
      </Screen>
    </>
  )
}

function CompanyHeader({ company }: { company: Company }) {
  const c = useColors()
  return (
    <View style={styles.header}>
      <Dot color={company.color || c.muted} size={16} />
      <View style={{ flex: 1 }}>
        <Txt variant="title">{company.name}</Txt>
        {[company.industry, company.role, company.currency].filter(Boolean).length ? (
          <Txt variant="muted">{[company.industry, company.role, company.currency].filter(Boolean).join(' · ')}</Txt>
        ) : null}
      </View>
    </View>
  )
}

function DecisionRow({ decision, first }: { decision: Decision; first: boolean }) {
  const { t, lang } = useI18n()
  const c = useColors()
  const statusText = decision.status === 'done' ? t.done : decision.status === 'cancelled' ? t.cancelled : t.open
  return (
    <View>
      {!first ? <Divider /> : null}
      <View style={styles.listRow}>
        <Icon name="decision" color={c.muted} size={20} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="label" color={c.text}>
            {decision.title}
          </Txt>
          {decision.expected_outcome ? <Txt variant="small">{decision.expected_outcome}</Txt> : null}
          <Txt variant="small">
            {statusText}
            {decision.review_date ? ` · ${t.reviewOn} ${formatDate(decision.review_date, lang)}` : ''}
          </Txt>
        </View>
      </View>
    </View>
  )
}

function DocumentRowView({ doc, first }: { doc: DocumentRow; first: boolean }) {
  const { t, lang, rtl } = useI18n()
  const cfg = useConfig()
  const c = useColors()
  const [busy, setBusy] = useState(false)
  const meta = [doc.category ? categoryLabel(doc.category, lang) : null, doc.period, formatSize(doc.size, lang)].filter(Boolean).join(' · ')
  const tags = parseTags(doc.tags)

  const open = async () => {
    setBusy(true)
    try {
      await openDocument(cfg, doc)
    } catch {
      NativeAlert.alert(doc.name, t.fileUnavailable)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      {!first ? <Divider /> : null}
      <Pressable style={styles.listRow} onPress={open} disabled={busy} accessibilityRole="button" accessibilityHint={t.share}>
        <Icon name="doc" color={c.muted} size={20} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="label" color={c.text} numberOfLines={2}>
            {doc.name}
          </Txt>
          {meta ? <Txt variant="small">{meta}</Txt> : null}
          {doc.summary ? (
            <Txt variant="small" numberOfLines={2}>
              {doc.summary}
            </Txt>
          ) : null}
          {tags.length ? <Txt variant="small">{tags.map((tag) => `#${tag}`).join(' ')}</Txt> : null}
        </View>
        {busy ? <ActivityIndicator color={c.muted} /> : <Icon name="chevron" color={c.muted} size={18} flip={rtl} />}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm }
})
