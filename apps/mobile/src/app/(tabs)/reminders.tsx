import { View } from 'react-native'
import { ReminderItem } from '../../components/Items'
import { Card, Empty, Screen, Section } from '../../components/Layout'
import { groupReminders } from '../../finance'
import { formatNumber } from '../../format'
import { useI18n } from '../../i18n'
import { space } from '../../theme'
import { useTables } from '../../useData'

export default function Reminders() {
  const state = useTables(['companies', 'reminders'] as const)
  const { t, lang } = useI18n()
  return (
    <Screen state={state}>
      {({ companies, reminders }) => {
        const byId = new Map(companies.map((co) => [co.id, co]))
        const groups = groupReminders(reminders)
        return groups.length ? (
          groups.map((g) => (
            <Section key={g.bucket} title={`${t[g.bucket]} (${formatNumber(g.items.length, lang)})`}>
              <View style={{ gap: space.sm }}>
                {g.items.map((r) => (
                  <ReminderItem key={r.id} reminder={r} company={r.company_id ? byId.get(r.company_id) : undefined} />
                ))}
              </View>
            </Section>
          ))
        ) : (
          <Card>
            <Empty text={t.noReminders} />
          </Card>
        )
      }}
    </Screen>
  )
}
