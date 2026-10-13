import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ApiError, DEFAULT_SERVER } from '../api'
import { Button, errorMessage } from '../components/Layout'
import { Txt } from '../components/Txt'
import { useI18n } from '../i18n'
import { savedServerUrl, useSession } from '../session'
import { radius, space, useColors } from '../theme'

export default function Login() {
  const { signIn } = useSession()
  const { t, rtl, lang, setLang } = useI18n()
  const c = useColors()
  const [url, setUrl] = useState(DEFAULT_SERVER)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void savedServerUrl().then((u) => u && setUrl(u))
  }, [])

  const submit = async () => {
    if (!url.trim() || !token.trim()) return setError(t.errMissing)
    setBusy(true)
    setError(null)
    try {
      await signIn(url, token)
    } catch (e) {
      setError(e instanceof ApiError ? errorMessage(t, e) : t.errGeneric)
    } finally {
      setBusy(false)
    }
  }

  const input = [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }]

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, direction: rtl ? 'rtl' : 'ltr' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => setLang(lang === 'ar' ? 'en' : 'ar')} style={styles.lang} accessibilityRole="button">
            <Txt variant="label" color={c.primary}>
              {lang === 'ar' ? t.english : t.arabic}
            </Txt>
          </Pressable>

          <View style={{ gap: space.xs }}>
            <Txt variant="title" center>
              {t.appName}
            </Txt>
            <Txt variant="muted" center>
              {t.tagline}
            </Txt>
          </View>

          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Txt variant="heading">{t.signInTitle}</Txt>
            <Txt variant="muted">{t.signInHint}</Txt>

            <Txt variant="label">{t.serverUrl}</Txt>
            <TextInput
              style={[input, { textAlign: 'left', writingDirection: 'ltr' }]}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder={DEFAULT_SERVER}
              placeholderTextColor={c.muted}
            />

            <Txt variant="label">{t.accessToken}</Txt>
            <TextInput
              style={[input, { textAlign: 'left', writingDirection: 'ltr' }]}
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              onSubmitEditing={submit}
              returnKeyType="go"
            />

            {error ? (
              <Txt variant="small" color={c.bad} accessibilityLiveRegion="polite">
                {error}
              </Txt>
            ) : null}

            <Button title={busy ? t.connecting : t.connect} onPress={submit} disabled={busy} />
          </View>

          <Txt variant="small" center>
            {t.developedBy}
          </Txt>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  content: { padding: space.xl, gap: space.xl, flexGrow: 1, justifyContent: 'center' },
  lang: { alignSelf: 'flex-end', padding: space.sm },
  card: { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.sm },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 15 }
})
