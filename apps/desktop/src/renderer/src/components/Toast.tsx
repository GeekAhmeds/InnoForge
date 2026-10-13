import { useEffect, useState } from 'react'

let push: ((msg: string) => void) | null = null

export function toast(msg: string): void {
  push?.(msg)
}

export function ToastHost(): React.JSX.Element | null {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    push = (m) => {
      setMsg(m)
      clearTimeout(timer)
      timer = setTimeout(() => setMsg(null), 4500)
    }
    return () => {
      push = null
      clearTimeout(timer)
    }
  }, [])
  return msg ? <div className="toast">{msg}</div> : null
}
