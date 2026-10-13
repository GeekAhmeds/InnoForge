import { useEffect, useState } from 'react'
import { useT, formatDate } from '../i18n'
import { toast } from '../components/Toast'
import { AccountsSection, MessagingSection, SecuritySection } from './settings/Sections'
import type { SettingsPatch } from '@shared/api'
import { APP_DEVELOPER, type Company, type ProviderId, type Settings, type SyncStatus, type UpdateStatus } from '@shared/types'

const PROVIDERS: { id: ProviderId; name: string; models: string[]; needsKey: boolean; hasBaseUrl: boolean }[] = [
  { id: 'anthropic', name: 'Claude (Anthropic)', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'], needsKey: true, hasBaseUrl: false },
  { id: 'openai', name: 'OpenAI', models: ['gpt-5', 'gpt-5-mini'], needsKey: true, hasBaseUrl: true },
  { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], needsKey: true, hasBaseUrl: false },
  { id: 'ollama', name: 'Local model (Ollama / LM Studio)', models: ['qwen3:14b', 'llama3.1:8b', 'gpt-oss:20b'], needsKey: false, hasBaseUrl: true }
]

export function SettingsPage(props: { settings: Settings; onChange: (s: Settings) => void; companies: Company[]; admin: boolean }): React.JSX.Element {
  const { lang, t } = useT()
  const s = props.settings
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    window.azim.app.version().then(setVersion)
    window.azim.updates.status().then(setUpdate)
    window.azim.sync.status().then(setSync)
    const offs = [window.azim.updates.onStatus(setUpdate), window.azim.sync.onStatus(setSync)]
    return () => offs.forEach((o) => o())
  }, [])

  const patch = async (p: SettingsPatch): Promise<void> => props.onChange(await window.azim.settings.update(p))
  const patchProvider = (id: ProviderId, p: Partial<Settings['providers'][ProviderId]>): Promise<void> =>
    patch({ providers: { [id]: p } })

  const updateText = (): string => {
    switch (update?.state) {
      case 'checking':
        return '…'
      case 'available':
        return `${t.updateAvailable} ${update.version ?? ''}`
      case 'downloading':
        return `${t.downloading} ${update.progress ?? 0}%`
      case 'ready':
        return `${t.updateReady} ${update.version ?? ''}`
      case 'none':
        return update.error ?? t.upToDate
      case 'error':
        return update.error ?? 'error'
      default:
        return ''
    }
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="page-head">
        <h1>{t.settings}</h1>
      </div>

      <div className="card settings-section">
        <h3>{t.general}</h3>
        <div className="row">
          <div className="field">
            <label>{t.language}</label>
            <select className="input" value={s.language} onChange={(e) => patch({ language: e.target.value as Settings['language'] })}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="field">
            <label>{t.theme}</label>
            <select className="input" value={s.theme} onChange={(e) => patch({ theme: e.target.value as Settings['theme'] })}>
              <option value="system">{t.system}</option>
              <option value="light">{t.light}</option>
              <option value="dark">{t.dark}</option>
            </select>
          </div>
        </div>
        {props.admin && (
        <>
        <label className="check">
          <input type="checkbox" checked={s.autoOrganize} onChange={(e) => patch({ autoOrganize: e.target.checked })} />
          {t.autoOrganize}
        </label>
        <div className="row">
          <div className="field">
            <label>{t.ocrLanguages}</label>
            <input className="input" value={s.ocrLanguages} onChange={(e) => patch({ ocrLanguages: e.target.value })} />
          </div>
          <div className="field">
            <label>{t.anomalyThreshold}</label>
            <input
              className="input"
              type="number"
              min={1}
              value={s.anomalyThreshold}
              onChange={(e) => patch({ anomalyThreshold: Number(e.target.value) || 25 })}
            />
          </div>
        </div>
        </>
        )}
      </div>

      {props.admin && (
      <>

      <div className="card settings-section">
        <h3>{t.aiProviders}</h3>
        {PROVIDERS.map((p) => {
          const ps = s.providers[p.id]
          return (
            <div key={p.id} className={`provider ${s.activeProvider === p.id ? 'active' : ''}`}>
              <div className="row" style={{ marginBottom: 8 }}>
                <label className="check" style={{ margin: 0 }}>
                  <input
                    type="radio"
                    name="active"
                    checked={s.activeProvider === p.id}
                    onChange={() => patch({ activeProvider: p.id, providers: { [p.id]: { enabled: true } } })}
                  />
                  <strong>{p.name}</strong>
                </label>
                <div className="spacer" />
                {s.activeProvider === p.id && <span className="pill ok">{t.active}</span>}
                <label className="check" style={{ margin: 0 }}>
                  <input type="checkbox" checked={ps.enabled} onChange={(e) => patchProvider(p.id, { enabled: e.target.checked })} />
                  {t.enabled}
                </label>
              </div>
              <div className="row">
                <div className="field">
                  <label>{t.model}</label>
                  <input className="input" list={`models-${p.id}`} value={ps.model} onChange={(e) => patchProvider(p.id, { model: e.target.value })} />
                  <datalist id={`models-${p.id}`}>
                    {p.models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
                {p.needsKey && (
                  <div className="field">
                    <label>{t.apiKey}</label>
                    <div className="row">
                      <input
                        className="input"
                        type="password"
                        placeholder={ps.hasKey ? `•••••••• ${t.keySaved}` : ''}
                        value={keys[p.id] ?? ''}
                        onChange={(e) => setKeys({ ...keys, [p.id]: e.target.value })}
                      />
                      <button
                        className="btn"
                        onClick={async () => {
                          props.onChange(await window.azim.settings.setApiKey(p.id, keys[p.id] ?? ''))
                          setKeys({ ...keys, [p.id]: '' })
                          toast(t.keySaved)
                        }}
                      >
                        {t.save}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {p.hasBaseUrl && (
                <div className="field">
                  <label>{t.baseUrl}</label>
                  <input
                    className="input"
                    dir="ltr"
                    placeholder={p.id === 'openai' ? 'https://api.openai.com/v1' : 'http://localhost:11434/v1'}
                    value={ps.baseUrl}
                    onChange={(e) => patchProvider(p.id, { baseUrl: e.target.value })}
                  />
                </div>
              )}
            </div>
          )
        })}
        <button
          className="btn"
          disabled={testing}
          onClick={async () => {
            setTesting(true)
            const r = await window.azim.settings.testProvider()
            setTesting(false)
            toast(`${r.ok ? '✓' : '✗'} ${r.message}`)
          }}
        >
          {testing ? '…' : t.test}
        </button>
      </div>

      <div className="card settings-section">
        <h3>{t.syncTitle}</h3>
        <div className="row">
          <div className="field">
            <label>{t.serverUrl}</label>
            <input className="input" dir="ltr" value={s.serverUrl} onChange={(e) => patch({ serverUrl: e.target.value })} />
          </div>
          <div className="field">
            <label>{t.syncToken}</label>
            <input className="input" dir="ltr" type="password" value={s.syncToken} onChange={(e) => patch({ syncToken: e.target.value })} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.syncEnabled} onChange={(e) => patch({ syncEnabled: e.target.checked })} />
          {t.syncEnabled}
        </label>
        <div className="row">
          <button className="btn" disabled={!s.syncEnabled} onClick={() => window.azim.sync.now()}>
            {t.syncNow}
          </button>
          <span style={{ color: sync?.state === 'error' ? 'var(--bad)' : 'var(--ink-2)', fontSize: 13 }}>
            {sync?.state === 'error' ? sync.error : sync?.lastSyncAt ? `${t.lastSync}: ${formatDate(sync.lastSyncAt, lang)}` : ''}
          </span>
        </div>
      </div>

      </>
      )}
      {props.admin && <MessagingSection settings={s} onChange={props.onChange} />}
      {props.admin && <AccountsSection settings={s} companies={props.companies} />}
      <SecuritySection settings={s} onChange={props.onChange} showBackup={props.admin} />

      <div className="card settings-section">
        <h3>{t.updates}</h3>
        <div className="row">
          <span>
            {t.version}: <strong>{version}</strong>
          </span>
          <div className="spacer" />
          <span style={{ color: 'var(--ink-2)', fontSize: 13 }}>{updateText()}</span>
          {update?.state === 'ready' ? (
            <button className="btn primary" onClick={() => window.azim.updates.install()}>
              {t.installRestart}
            </button>
          ) : (
            <button className="btn" onClick={() => window.azim.updates.check()}>
              {t.checkUpdates}
            </button>
          )}
        </div>
      </div>

      <div className="card settings-section about">
        <div className="brand-mark">A</div>
        <h2 style={{ margin: '0 0 4px' }}>Azim Command</h2>
        <div style={{ color: 'var(--ink-2)' }}>
          {t.version} {version}
        </div>
        <p style={{ margin: '14px 0 4px', fontSize: 15 }}>
          {t.developedBy} <strong>{APP_DEVELOPER}</strong>
        </p>
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>{t.builtFor}</p>
        <p style={{ marginTop: 14, color: 'var(--muted)', fontSize: 12 }}>{t.securityNote}</p>
        <p style={{ color: 'var(--muted)', fontSize: 12 }}>© {new Date().getFullYear()} {APP_DEVELOPER}</p>
      </div>
    </div>
  )
}
