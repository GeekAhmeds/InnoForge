import { View } from 'react-native'
import { AlertItem } from '../../components/Items'
import { Card, Empty, Screen } from '../../components/Layout'
import { openAlerts } from '../../finance'
import { useI18n } from '../../i18n'
import { space } from '../../theme'
import { useTables } from '../../useData'

export default function Alerts() {
  const state = useTables(['companies', 'alerts'] as const)
  const { t } = useI18n()
  return (
    <Screen state={state}>
      {({ companies, alerts }) => {
        const byId = new Map(companies.map((co) => [co.id, co]))
        const open = openAlerts(alerts)
        return open.length ? (
          <View style={{ gap: space.sm }}>
            {open.map((a) => (
              <AlertItem key={a.id} alert={a} company={a.company_id ? byId.get(a.company_id) : undefined} />
            ))}
          </View>
        ) : (
          <Card>
            <Empty text={t.noAlerts} />
          </Card>
        )
      }}
    </Screen>
  )
}
