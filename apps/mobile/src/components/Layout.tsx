import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native'
import type { ApiError } from '../api'
import { useI18n, type Dict } from '../i18n'
import { radius, space, useColors } from '../theme'
import type { DataState } from '../useData'
import { Icon } from './Icons'
import { Txt } from './Txt'

/** Scrollable screen with pull-to-refresh and loading / error / content states. */
export function Screen<T>({ state, children }: { state: DataState<T>; children: (data: T) => ReactNode }) {
  const c = useColors()
  const { rtl } = useI18n()
  const { data, error, loading, refreshing, refresh } = state
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg, direction: rtl ? 'rtl' : 'ltr' }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={c.muted} colors={[c.primary]} />}
    >
      {data !== undefined ? (
        <>
          {error ? <ErrorBanner error={error} /> : null}
          {children(data)}
        </>
      ) : loading ? (
        <ActivityIndicator style={{ marginTop: 64 }} color={c.muted} />
      ) : error ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : null}
    </ScrollView>
  )
}

export function errorMessage(t: Dict, e: ApiError): string {
  if (e.status === 401) return t.errUnauthorized
  if (e.status === 0) return e.message === 'timeout' ? t.errTimeout : t.errNetwork
  return `${t.errGeneric} (${e.status})`
}

function ErrorState({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const { t } = useI18n()
  const c = useColors()
  return (
    <View style={styles.center}>
      <Icon name="warning" color={c.warning} size={36} />
      <Txt variant="heading" center>
        {t.loadFailed}
      </Txt>
      <Txt variant="muted" center>
        {errorMessage(t, error)}
      </Txt>
      <Button title={t.retry} onPress={onRetry} />
    </View>
  )
}

function ErrorBanner({ error }: { error: ApiError }) {
  const { t } = useI18n()
  const c = useColors()
  return (
    <View style={[styles.banner, { borderColor: c.warning }]}>
      <Icon name="warning" color={c.warning} size={18} />
      <Txt variant="small" color={c.text} style={{ flex: 1 }}>
        {errorMessage(t, error)}
      </Txt>
    </View>
  )
}

export function Empty({ text }: { text: string }) {
  return (
    <Txt variant="muted" center style={{ paddingVertical: space.lg }}>
      {text}
    </Txt>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors()
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.sectionHead}>
        <Txt variant="heading" style={{ flex: 1 }}>
          {title}
        </Txt>
        {action}
      </View>
      {children}
    </View>
  )
}

export function Divider() {
  const c = useColors()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
}

export function Button({ title, onPress, kind = 'primary', disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; disabled?: boolean }) {
  const c = useColors()
  const bg = kind === 'primary' ? c.primary : 'transparent'
  const fg = kind === 'primary' ? c.onPrimary : kind === 'danger' ? c.bad : c.primary
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'primary' ? bg : kind === 'danger' ? c.bad : c.border, opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }
      ]}
    >
      <Txt variant="label" color={fg} center>
        {title}
      </Txt>
    </Pressable>
  )
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
}

export const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.xl, paddingBottom: 48 },
  center: { alignItems: 'center', gap: space.md, paddingTop: 64, paddingHorizontal: space.xl },
  card: { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius, padding: space.md },
  button: { borderRadius: 10, borderWidth: 1, paddingVertical: 12, paddingHorizontal: space.lg, minWidth: 120 }
})
