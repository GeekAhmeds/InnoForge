import { Link, router } from 'expo-router'
import { Pressable, StyleSheet, View } from 'react-native'
import { Icon } from '../../components/Icons'
import { ReminderItem } from '../../components/Items'
import { Card, Divider, Dot, Empty, Screen, Section } from '../../components/Layout'
import { Txt } from '../../components/Txt'
import { consolidatedKpis, openAlerts, openReminders } from '../../finance'
import { formatMoney } from '../../format'
import { metricLabel, useI18n } from '../../i18n'
import { radius, space, useColors } from '../../theme'
import { useTables } from '../../useData'

export default function Overview() {
  const state = useTables(['companies', 'metrics', 'alerts', 'reminders'] as const)
  const { t, lang, rtl } = useI18n()
  const c = useColors()

  return (
    <Screen state={state}>
      {({ companies, metrics, alerts, reminders }) => {
        const byId = new Map(companies.map((co) => [co.id, co]))
        const kpis = consolidatedKpis(metrics, companies)
        const open = openAlerts(alerts)
        const critical = open.filter((a) => a.severity === 'critical').length
        const warning = open.filter((a) => a.severity === 'warning').length
        const upcoming = openReminders(reminders).slice(0, 5)

        return (
          <>
            <Section title={t.keyFigures}>
              {kpis.length ? (
                <>
                  <View style={styles.grid}>
                    {kpis.map((k) => (
                      <View key={k.metric} style={[styles.tile, { backgroundColor: c.card, borderColor: c.border }]}>
                        <Txt variant="label">{metricLabel(k.metric, lang)}</Txt>
                        {k.totals.map((tot) => (
                          <Txt key={tot.currency} variant="figure" numberOfLines={1} adjustsFontSizeToFit>
                            {formatMoney(tot.value, tot.currency, lang)}
                          </Txt>
                        ))}
                      </View>
                    ))}
                  </View>
                  <Txt variant="small">{t.latestPeriodPerCompany}</Txt>
                </>
              ) : (
                <Card>
                  <Empty text={t.noMetrics} />
                </Card>
              )}
            </Section>

            <Pressable onPress={() => router.navigate('/alerts')} accessibilityRole="button">
              <Card style={styles.alertsCard}>
                <Txt variant="heading" style={{ flex: 1 }}>
                  {t.openAlerts}
                </Txt>
                <Counter icon="critical" color={c.critical} label={t.criticalCount} value={critical} />
                <Counter icon="warning" color={c.warning} label={t.warningCount} value={warning} />
                <Icon name="chevron" color={c.muted} size={18} flip={rtl} />
              </Card>
            </Pressable>

            <Section title={t.companies}>
              <Card style={{ paddingVertical: space.xs }}>
                {companies.length ? (
                  companies.map((co, i) => (
                    <View key={co.id}>
                      {i > 0 ? <Divider /> : null}
                      <Link href={{ pathname: '/company/[id]', params: { id: co.id } }} asChild>
                        <Pressable style={styles.companyRow} accessibilityRole="button">
                          <Dot color={co.color || c.muted} size={12} />
                          <View style={{ flex: 1 }}>
                            <Txt variant="label" color={c.text} style={{ fontSize: 15 }}>
                              {co.name}
                            </Txt>
                            {co.industry ? <Txt variant="small">{co.industry}</Txt> : null}
                          </View>
                          <Icon name="chevron" color={c.muted} size={18} flip={rtl} />
                        </Pressable>
                      </Link>
                    </View>
                  ))
                ) : (
                  <Empty text={t.noCompanies} />
                )}
              </Card>
            </Section>

            <Section
              title={t.upcoming}
              action={
                upcoming.length ? (
                  <Pressable onPress={() => router.navigate('/reminders')} hitSlop={8}>
                    <Txt variant="label" color={c.primary}>
                      {t.seeAll}
                    </Txt>
                  </Pressable>
                ) : undefined
              }
            >
              {upcoming.length ? (
                upcoming.map((r) => <ReminderItem key={r.id} reminder={r} company={r.company_id ? byId.get(r.company_id) : undefined} />)
              ) : (
                <Card>
                  <Empty text={t.noUpcoming} />
                </Card>
              )}
            </Section>
          </>
        )
      }}
    </Screen>
  )
}

function Counter({ icon, color, label, value }: { icon: 'critical' | 'warning'; color: string; label: string; value: number }) {
  const c = useColors()
  return (
    <View style={styles.counter} accessible accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} color={value ? color : c.muted} size={16} />
      <Txt variant="label" color={value ? color : c.muted}>
        {value}
      </Txt>
      <Txt variant="small">{label}</Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { flexBasis: '48%', flexGrow: 1, borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, padding: space.md, gap: 2 },
  alertsCard: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md }
})
