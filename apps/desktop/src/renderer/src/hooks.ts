import { useCallback, useEffect, useRef, useState } from 'react'

// Load data and reload it whenever the main process reports a change in one
// of the given scopes — this is what keeps every screen live.
export function useLive<T>(load: () => Promise<T>, deps: unknown[], scopes: string[] = []): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load
  const reload = useCallback(() => {
    loadRef.current().then(setData).catch(() => undefined)
  }, [])
  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    return window.azim.app.onDataChanged((changed) => {
      if (!scopes.length || changed.some((s) => scopes.includes(s))) reload()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, scopes.join(',')])
  return [data, reload]
}
