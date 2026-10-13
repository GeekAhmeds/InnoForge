import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useT } from '../i18n'
import { APP_DEVELOPER } from '@shared/types'

export function LockScreen(): React.JSX.Element {
  const { t } = useT()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  return (
    <div className="modal-bg" style={{ background: 'var(--sidebar)', zIndex: 100 }}>
      <form
        className="modal"
        style={{ width: 340, textAlign: 'center' }}
        onSubmit={async (e) => {
          e.preventDefault()
          const r = await window.azim.lock.unlock(pin)
          setPin('')
          if (!r.ok) setError(r.waitSeconds ? `${t.tryAgainIn} ${r.waitSeconds}${t.seconds}` : t.wrongPin)
        }}
      >
        <div className="brand-mark" style={{ margin: '0 auto 12px', width: 52, height: 52 }}>
          <Lock size={22} />
        </div>
        <h2 style={{ marginBottom: 4 }}>Azim Command</h2>
        <p style={{ color: 'var(--ink-2)', marginTop: 0 }}>{t.enterPin}</p>
        <input
          className="input"
          type="password"
          inputMode="numeric"
          autoFocus
          maxLength={8}
          dir="ltr"
          style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8 }}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        {error && <div style={{ color: 'var(--bad)', marginTop: 8 }}>{error}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 14, justifyContent: 'center' }} disabled={pin.length < 4}>
          {t.unlock}
        </button>
        <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 16 }}>{APP_DEVELOPER}</div>
      </form>
    </div>
  )
}
