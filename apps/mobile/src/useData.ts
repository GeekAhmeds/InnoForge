import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api, type ServerConfig, type Tables } from './api'
import { dataCache as cache } from './cache'
import { useConfig } from './session'

export interface DataState<T> {
  data: T | undefined
  error: ApiError | null
  loading: boolean
  refreshing: boolean
  refresh: () => void
}

export function useData<T>(key: string, fetcher: (cfg: ServerConfig) => Promise<T>): DataState<T> {
  const cfg = useConfig()
  const fullKey = `${cfg.url}|${key}`
  const [data, setData] = useState<T | undefined>(() => cache.get(fullKey) as T | undefined)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(!cache.has(fullKey))
  const [refreshing, setRefreshing] = useState(false)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const seq = useRef(0)

  const load = useCallback(
    async (pull: boolean) => {
      if (!cfg.token) return // signed out
      const id = ++seq.current
      if (pull) setRefreshing(true)
      try {
        const result = await fetcherRef.current(cfg)
        if (id !== seq.current) return
        cache.set(fullKey, result)
        setData(result)
        setError(null)
      } catch (e) {
        if (id !== seq.current) return
        setError(e instanceof ApiError ? e : new ApiError(0, String(e)))
      } finally {
        if (id === seq.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [cfg, fullKey]
  )

  useEffect(() => {
    void load(false)
  }, [load])

  const refresh = useCallback(() => void load(true), [load])
  return { data, error, loading, refreshing, refresh }
}

/** Fetches several tables at once (optionally for one company). */
export function useTables<K extends keyof Tables>(tables: readonly K[], companyId?: string): DataState<{ [P in K]: Tables[P][] }> {
  const key = `${tables.join(',')}@${companyId ?? '*'}`
  return useData(key, async (cfg) => {
    const rows = await Promise.all(tables.map((t) => api.table(cfg, t, { companyId, limit: t === 'metrics' ? 5000 : 2000 })))
    return Object.fromEntries(tables.map((t, i) => [t, rows[i]])) as { [P in K]: Tables[P][] }
  })
}
