import { DarkTheme, DefaultTheme, LocaleProvider, SplashScreen, Stack, ThemeProvider } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { I18nManager, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useI18n } from '../i18n'
import { useNotificationNavigation } from '../push'
import { AppProviders, useSession } from '../session'
import { useColors } from '../theme'

// RTL is applied per language with `direction` styles so switching language
// takes effect immediately; keep the native layout direction neutral.
I18nManager.allowRTL(false)
I18nManager.forceRTL(false)

void SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProviders>
        <RootStack />
      </AppProviders>
    </SafeAreaProvider>
  )
}

function RootStack() {
  const { ready, config } = useSession()
  const { rtl, t } = useI18n()
  const c = useColors()
  useNotificationNavigation(ready && !!config)

  useEffect(() => {
    if (ready) SplashScreen.hide()
  }, [ready])

  const base = c.scheme === 'dark' ? DarkTheme : DefaultTheme
  const theme = {
    ...base,
    colors: { ...base.colors, primary: c.primary, background: c.bg, card: c.card, text: c.text, border: c.border }
  }

  if (!ready) return null

  return (
    <LocaleProvider direction={rtl ? 'rtl' : 'ltr'}>
      <ThemeProvider value={theme}>
        <View style={{ flex: 1, direction: rtl ? 'rtl' : 'ltr', backgroundColor: c.bg }}>
          <StatusBar style={c.scheme === 'dark' ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerTintColor: c.primary, headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: c.bg } }}>
            <Stack.Protected guard={!!config}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t.overview }} />
              <Stack.Screen name="company/[id]" options={{ title: '' }} />
            </Stack.Protected>
            <Stack.Protected guard={!config}>
              <Stack.Screen name="login" options={{ headerShown: false }} />
            </Stack.Protected>
          </Stack>
        </View>
      </ThemeProvider>
    </LocaleProvider>
  )
}
