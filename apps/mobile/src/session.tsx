import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, normalizeUrl, type Me, type ServerConfig } from './api'
import { dictionaries, I18nContext, type I18n, type Lang } from './i18n'
import { registerForPush, type PushStatus } from './push'
import { clearDataCache } from './cache'

const KEYS = { url: 'inno.url', token: 'inno.token', me: 'inno.me', lang: 'app.lang' }

interface Session {
  ready: boolean
  config: ServerConfig | null
  me: Me | null
  push: PushStatus | null
  signIn: (url: string, token: string) => Promise<void>
  signOut: () => Promise<void>
  enablePush: () => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession outside SessionProvider')
  return s
}

const SIGNED_OUT: ServerConfig = { url: '', token: '' }

/**
 * Config for screens under the protected stack. During the sign-out transition
 * those screens may render once more, so this returns an empty config instead of throwing.
 */
export function useConfig(): ServerConfig {
  return useSession().config ?? SIGNED_OUT
}

async function read(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key)
  } catch {
    return null
  }
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [push, setPush] = useState<PushStatus | null>(null)
  const [lang, setLangState] = useState<Lang>('ar')

  const clear = useCallback(async () => {
    await Promise.all([KEYS.token, KEYS.me].map((k) => SecureStore.deleteItemAsync(k).catch(() => {})))
    clearDataCache()
    setConfig(null)
    setMe(null)
    setPush(null)
  }, [])

  // Restore the saved session, then revalidate it in the background.
  useEffect(() => {
    void (async () => {
      const [url, token, meJson, savedLang] = await Promise.all([read(KEYS.url), read(KEYS.token), read(KEYS.me), read(KEYS.lang)])
      if (savedLang === 'ar' || savedLang === 'en') setLangState(savedLang)
      if (url && token) {
        const cfg = { url, token }
        setConfig(cfg)
        if (meJson) setMe(JSON.parse(meJson) as Me)
        api
          .me(cfg)
          .then((fresh) => {
            setMe(fresh)
            void SecureStore.setItemAsync(KEYS.me, JSON.stringify(fresh))
            void registerForPush(cfg, false).then(setPush)
          })
          .catch((e) => {
            if (e instanceof ApiError && e.status === 401) void clear()
          })
      }
      setReady(true)
    })()
  }, [clear])

  const signIn = useCallback(async (rawUrl: string, token: string) => {
    const cfg = { url: normalizeUrl(rawUrl), token: token.trim() }
    const who = await api.me(cfg) // throws ApiError on failure
    await SecureStore.setItemAsync(KEYS.url, cfg.url)
    await SecureStore.setItemAsync(KEYS.token, cfg.token)
    await SecureStore.setItemAsync(KEYS.me, JSON.stringify(who))
    setConfig(cfg)
    setMe(who)
    void registerForPush(cfg, true).then(setPush)
  }, [])

  const enablePush = useCallback(async () => {
    if (config) setPush(await registerForPush(config, true))
  }, [config])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    void SecureStore.setItemAsync(KEYS.lang, l).catch(() => {})
  }, [])

  const session = useMemo<Session>(
    () => ({ ready, config, me, push, signIn, signOut: clear, enablePush }),
    [ready, config, me, push, signIn, clear, enablePush]
  )
  const i18n = useMemo<I18n>(() => ({ lang, t: dictionaries[lang], rtl: lang === 'ar', setLang }), [lang, setLang])

  return (
    <I18nContext.Provider value={i18n}>
      <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
    </I18nContext.Provider>
  )
}

/** Saved server URL (kept after sign-out to prefill the login form). */
export const savedServerUrl = () => read(KEYS.url)
