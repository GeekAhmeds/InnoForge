import { Tabs } from 'expo-router'
import { Icon, type IconName } from '../../components/Icons'
import { useI18n } from '../../i18n'
import { useColors } from '../../theme'

export default function TabsLayout() {
  const { t } = useI18n()
  const c = useColors()
  const icon =
    (name: IconName) =>
    ({ color }: { color: unknown }) => <Icon name={name} color={String(color)} size={24} />

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
        headerStyle: { backgroundColor: c.card },
        headerTintColor: c.text,
        sceneStyle: { backgroundColor: c.bg }
      }}
    >
      <Tabs.Screen name="index" options={{ title: t.overview, headerTitle: t.appName, tabBarIcon: icon('home') }} />
      <Tabs.Screen name="alerts" options={{ title: t.alerts, tabBarIcon: icon('bell') }} />
      <Tabs.Screen name="reminders" options={{ title: t.reminders, tabBarIcon: icon('calendar') }} />
      <Tabs.Screen name="settings" options={{ title: t.settings, tabBarIcon: icon('gear') }} />
    </Tabs>
  )
}
