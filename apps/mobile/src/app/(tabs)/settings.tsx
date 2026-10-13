import * as Application from 'expo-application'
import Constants from 'expo-constants'
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { Button, Card, Divider, Section } from '../../components/Layout'
import { Txt } from '../../components/Txt'
import { roleLabel, useI18n, type Lang } from '../../i18n'
import { useSession } from '../../session'
import { radius, space, useColors } from '../../theme'

export default function Settings() {
  const { t, lang, rtl, setLang } = useI18n()
  const { config, me, push, signOut, enablePush } = useSession()
  const c = useColors()
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '—'
  const build = Application.nativeBuildVersion

  const pushText =
    push === 'enabled'
      ? t.pushEnabled
      : push === 'no-device'
        ? t.pushNeedsDevice
        : push === 'no-project'
          ? t.pushNeedsProject
          : push === 'denied'
            ? t.pushDenied
            : t.pushDisabled

  const confirmLogout = () =>
    Alert.alert(t.logout, t.logoutConfirm, [
      { text: t.cancel, style: 'cancel' },
      { text: t.logout, style: 'destructive', onPress: () => void signOut() }
    ])

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg, direction: rtl ? 'rtl' : 'ltr' }} contentContainerStyle={styles.content}>
      <Section title={t.language}>
        <View style={[styles.segment, { borderColor: c.border, backgroundColor: c.card }]}>
          {(['ar', 'en'] as Lang[]).map((l) => {
            const active = l === lang
            return (
              <Pressable
                key={l}
                onPress={() => setLang(l)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={[styles.segmentItem, active && { backgroundColor: c.primary }]}
              >
                <Txt variant="label" center color={active ? c.onPrimary : c.text}>
                  {l === 'ar' ? t.arabic : t.english}
                </Txt>
              </Pressable>
            )
          })}
        </View>
      </Section>

      <Section title={t.server}>
        <Card>
          <InfoRow label={t.serverUrl} value={config?.url ?? '—'} ltr />
          <Divider />
          <InfoRow label={t.signedInAs} value={me?.name ?? '—'} />
          <Divider />
          <InfoRow label={t.role} value={me ? roleLabel(me.role, lang) : '—'} />
          <Divider />
          <InfoRow label={t.companies} value={!me || me.companies === null ? t.allCompanies : t.companiesCount(me.companies.length)} />
        </Card>
      </Section>

      <Section title={t.notifications}>
        <Card>
          <Txt variant="muted">{pushText}</Txt>
          {push !== 'enabled' && push !== 'no-device' && push !== 'no-project' ? (
            <Button title={t.enablePush} kind="ghost" onPress={() => void enablePush()} />
          ) : null}
        </Card>
      </Section>

      <Button title={t.logout} kind="danger" onPress={confirmLogout} />

      <Section title={t.about}>
        <Card>
          <Txt variant="heading">{t.appName}</Txt>
          <Txt variant="muted">{t.builtFor}</Txt>
          <InfoRow label={t.version} value={build ? `${version} (${build})` : version} ltr />
          <Divider />
          <Txt variant="label" color={c.text}>
            {t.developedBy}
          </Txt>
        </Card>
      </Section>
    </ScrollView>
  )
}

function InfoRow({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  const c = useColors()
  return (
    <View style={styles.row}>
      <Txt variant="muted">{label}</Txt>
      <Txt variant="label" color={c.text} style={[{ flex: 1 }, ltr ? { writingDirection: 'ltr' } : null]} numberOfLines={1} selectable>
        {value}
      </Txt>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.xl, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 2 },
  segment: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius, padding: 4, gap: 4 },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: radius - 4 }
})
