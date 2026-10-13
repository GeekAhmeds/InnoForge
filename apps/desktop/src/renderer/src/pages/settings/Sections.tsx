import { useEffect, useState } from 'react'
import { Copy, KeyRound, Lock, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { formatDate, useT, type Dict } from '../../i18n'
import { toast } from '../../components/Toast'
import type { Company, ServerUser, Settings } from '@shared/types'

const errText = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const split = (v: string): string[] => v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)

type Props = { settings: Settings; onChange: (s: Settings) => void }

// ---------------- Email & WhatsApp ----------------

export function MessagingSection({ settings: s, onChange }: Props): React.JSX.Element {
  const { t } = useT()
  const [smtpPass, setSmtpPass] = useState('')
  const [waToken, setWaToken] = useState('')
  const [testTo, setTestTo] = useState('')
  const [emails, setEmails] = useState(s.reminderRecipients.emails.join(', '))
  const [phones, setPhones] = useState(s.reminderRecipients.whatsapp.join(', '))
  const patch = async (p: Parameters<typeof window.azim.settings.update>[0]): Promise<void> => onChange(await window.azim.settings.update(p))
  const test = async (channel: 'email' | 'whatsapp'): Promise<void> => {
    const r = await window.azim.settings.testMessaging(channel, testTo)
    toast(`${r.ok ? '✓' : '✗'} ${r.message}`)
  }
  return (
    <div className="card settings-section">
      <h3>{t.messaging}</h3>
      <div className="row">
        <div className="field">
          <label>{t.smtpHost}</label>
          <input className="input" dir="ltr" placeholder="smtp.gmail.com" value={s.smtp.host} onChange={(e) => patch({ smtp: { host: e.target.value } })} />
        </div>
        <div className="field" style={{ maxWidth: 110 }}>
          <label>{t.port}</label>
          <input className="input" type="number" value={s.smtp.port} onChange={(e) => patch({ smtp: { port: Number(e.target.value) } })} />
        </div>
        <label className="check" style={{ marginTop: 18 }}>
          <input type="checkbox" checked={s.smtp.secure} onChange={(e) => patch({ smtp: { secure: e.target.checked } })} />
          {t.secure}
        </label>
      </div>
      <div className="row">
        <div className="field">
          <label>{t.smtpUser}</label>
          <input className="input" dir="ltr" value={s.smtp.user} onChange={(e) => patch({ smtp: { user: e.target.value } })} />
        </div>
        <div className="field">
          <label>{t.password}</label>
          <div className="row">
            <input className="input" type="password" placeholder={s.smtp.hasPassword ? '••••••••' : ''} value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} />
            <button
              className="btn"
              onClick={async () => {
                onChange(await window.azim.settings.setSecret('smtp', smtpPass))
                setSmtpPass('')
              }}
            >
              {t.save}
            </button>
          </div>
        </div>
      </div>
      <div className="field">
        <label>{t.smtpFrom}</label>
        <input className="input" dir="ltr" placeholder="Azim Command <reports@example.com>" value={s.smtp.from} onChange={(e) => patch({ smtp: { from: e.target.value } })} />
      </div>
      <hr style={{ border: 0, borderTop: '1px solid var(--grid)', margin: '14px 0' }} />
      <div className="row">
        <div className="field">
          <label>{t.waPhoneId}</label>
          <input className="input" dir="ltr" value={s.whatsapp.phoneNumberId} onChange={(e) => patch({ whatsapp: { phoneNumberId: e.target.value } })} />
        </div>
        <div className="field">
          <label>{t.waToken}</label>
          <div className="row">
            <input className="input" type="password" placeholder={s.whatsapp.hasToken ? '••••••••' : ''} value={waToken} onChange={(e) => setWaToken(e.target.value)} />
            <button
              className="btn"
              onClick={async () => {
                onChange(await window.azim.settings.setSecret('whatsapp', waToken))
                setWaToken('')
              }}
            >
              {t.save}
            </button>
          </div>
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>{t.waTemplate}</label>
          <input className="input" dir="ltr" value={s.whatsapp.templateName} onChange={(e) => patch({ whatsapp: { templateName: e.target.value } })} />
        </div>
        <div className="field" style={{ maxWidth: 140 }}>
          <label>{t.waTemplateLang}</label>
          <input className="input" dir="ltr" value={s.whatsapp.templateLanguage} onChange={(e) => patch({ whatsapp: { templateLanguage: e.target.value } })} />
        </div>
      </div>
      <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 12 }}>{t.waHint}</div>
      <div className="row">
        <input className="input" dir="ltr" placeholder="email / +2010…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        <button className="btn" disabled={!testTo} onClick={() => test('email')}>
          {t.sendTest} (email)
        </button>
        <button className="btn" disabled={!testTo} onClick={() => test('whatsapp')}>
          {t.sendTest} (WhatsApp)
        </button>
      </div>
      <hr style={{ border: 0, borderTop: '1px solid var(--grid)', margin: '14px 0' }} />
      <h3>{t.reminderRecipients}</h3>
      <div className="row">
        <div className="field">
          <label>{t.emails}</label>
          <input className="input" dir="ltr" value={emails} onChange={(e) => setEmails(e.target.value)} onBlur={() => patch({ reminderRecipients: { emails: split(emails) } })} />
        </div>
        <div className="field">
          <label>{t.whatsappNumbers}</label>
          <input className="input" dir="ltr" value={phones} onChange={(e) => setPhones(e.target.value)} onBlur={() => patch({ reminderRecipients: { whatsapp: split(phones) } })} />
        </div>
      </div>
    </div>
  )
}

// ---------------- PIN lock & encrypted backups ----------------

export function SecuritySection({ settings: s, onChange, showBackup }: Props & { showBackup: boolean }): React.JSX.Element {
  const { lang, t } = useT()
  const [pin, setPin] = useState('')
  const [current, setCurrent] = useState('')
  const [backupPass, setBackupPass] = useState('')
  const [manualPass, setManualPass] = useState('')
  const [busy, setBusy] = useState(false)
  const patch = async (p: Parameters<typeof window.azim.settings.update>[0]): Promise<void> => onChange(await window.azim.settings.update(p))
  const run = async (fn: () => Promise<unknown>, done?: string): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      if (done) toast(`✓ ${done}`)
    } catch (e) {
      toast(`✗ ${errText(e)}`)
    }
    setBusy(false)
  }
  return (
    <div className="card settings-section">
      <h3>{t.security}</h3>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        {s.lock.hasPin && (
          <div className="field">
            <label>{t.currentPin}</label>
            <input className="input" type="password" inputMode="numeric" maxLength={8} value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))} />
          </div>
        )}
        <div className="field">
          <label>{t.newPin}</label>
          <input className="input" type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </div>
        <button
          className="btn primary"
          style={{ marginBottom: 12 }}
          disabled={pin.length < 4}
          onClick={() =>
            run(async () => {
              await window.azim.lock.setPin(pin, current)
              onChange(await window.azim.settings.update({ lock: { enabled: true } }))
              setPin('')
              setCurrent('')
            }, t.setPin)
          }
        >
          <KeyRound size={14} /> {t.setPin}
        </button>
        {s.lock.hasPin && (
          <button
            className="btn danger"
            style={{ marginBottom: 12 }}
            onClick={() =>
              run(async () => {
                onChange(await window.azim.lock.clearPin(current))
                setCurrent('')
              }, t.removePin)
            }
          >
            {t.removePin}
          </button>
        )}
      </div>
      {s.lock.hasPin && (
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={s.lock.enabled} onChange={(e) => patch({ lock: { enabled: e.target.checked } })} />
            {t.pinLock}
          </label>
          <div className="field" style={{ maxWidth: 260 }}>
            <label>{t.autoLock}</label>
            <input className="input" type="number" min={0} value={s.lock.idleMinutes} onChange={(e) => patch({ lock: { idleMinutes: Number(e.target.value) } })} />
          </div>
          <button className="btn" onClick={() => window.azim.lock.lockNow()}>
            <Lock size={14} /> {t.lockNow}
          </button>
        </div>
      )}

      {showBackup && (
      <>
      <hr style={{ border: 0, borderTop: '1px solid var(--grid)', margin: '14px 0' }} />
      <h3>{t.backupTitle}</h3>
      <p style={{ color: 'var(--ink-2)', marginTop: 0, fontSize: 13 }}>{t.backupHint}</p>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field">
          <label>{t.backupPassword}</label>
          <input className="input" type="password" value={manualPass} onChange={(e) => setManualPass(e.target.value)} />
        </div>
        <button className="btn" style={{ marginBottom: 12 }} disabled={busy || manualPass.length < 8} onClick={() => run(() => window.azim.backup.create(manualPass), t.backupNow)}>
          {t.backupNow}
        </button>
        <button
          className="btn danger"
          style={{ marginBottom: 12 }}
          disabled={busy || manualPass.length < 8}
          onClick={() => confirm(t.restoreConfirm) && run(() => window.azim.backup.restore(manualPass))}
        >
          <RotateCcw size={14} /> {t.restore}
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={s.backup.enabled} onChange={(e) => patch({ backup: { enabled: e.target.checked } })} />
        <strong>{t.autoBackup}</strong>
      </label>
      {s.backup.enabled && (
        <>
          <div className="field">
            <label>{t.backupFolder}</label>
            <div className="row">
              <input className="input" readOnly value={s.backup.folder} />
              <button
                className="btn"
                onClick={async () => {
                  const folder = await window.azim.backup.pickFolder()
                  if (folder) await patch({ backup: { folder } })
                }}
              >
                {t.choose}
              </button>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>{t.backupEvery}</label>
              <input className="input" type="number" min={1} value={s.backup.intervalHours} onChange={(e) => patch({ backup: { intervalHours: Number(e.target.value) || 24 } })} />
            </div>
            <div className="field">
              <label>{t.keepLast}</label>
              <input className="input" type="number" min={1} value={s.backup.keepLast} onChange={(e) => patch({ backup: { keepLast: Number(e.target.value) || 14 } })} />
            </div>
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field">
              <label>{t.backupPassword}</label>
              <input className="input" type="password" placeholder={s.backup.hasPassword ? '••••••••' : ''} value={backupPass} onChange={(e) => setBackupPass(e.target.value)} />
            </div>
            <button
              className="btn"
              style={{ marginBottom: 12 }}
              disabled={backupPass.length < 8}
              onClick={async () => {
                onChange(await window.azim.settings.setSecret('backup', backupPass))
                setBackupPass('')
              }}
            >
              {t.save}
            </button>
            <button
              className="btn primary"
              style={{ marginBottom: 12 }}
              disabled={busy || !s.backup.folder || !s.backup.hasPassword}
              onClick={() => run(() => window.azim.backup.runNow(), t.backupNow)}
            >
              {t.backupNow}
            </button>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>
            {t.lastBackup}: {s.backup.lastAt ? formatDate(s.backup.lastAt, lang) : '—'}
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}

// ---------------- Accounts & permissions (Inno server) ----------------

const roleLabel = (t: Dict, role: string): string => t[`r_${role}` as keyof Dict] ?? role

export function AccountsSection({ settings: s, companies }: { settings: Settings; companies: Company[] }): React.JSX.Element {
  const { lang, t } = useT()
  const [users, setUsers] = useState<ServerUser[] | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<{ name: string; role: ServerUser['role']; companies: string[] }>({ name: '', role: 'accountant', companies: [] })
  const [token, setToken] = useState<string | null>(null)
  const load = (): void => {
    window.azim.accounts
      .list()
      .then((u) => {
        setUsers(u)
        setError('')
      })
      .catch((e) => setError(errText(e)))
  }
  useEffect(() => {
    if (s.syncEnabled && s.syncToken) load()
  }, [s.syncEnabled, s.syncToken])

  const companyNames = (ids: string[] | null): string => (ids ? ids.map((id) => companies.find((c) => c.id === id)?.name ?? '?').join('، ') : t.allCompanies)

  return (
    <div className="card settings-section">
      <h3>{t.accounts}</h3>
      <p style={{ color: 'var(--ink-2)', marginTop: 0, fontSize: 13 }}>{t.accountsHint}</p>
      {s.account && (
        <p style={{ fontSize: 13 }}>
          {t.signedInAs}: <strong>{s.account.name}</strong> · {roleLabel(t, s.account.role)}
        </p>
      )}
      {!s.syncEnabled || !s.syncToken ? (
        <div className="empty">{t.needsSync}</div>
      ) : error ? (
        <div style={{ color: 'var(--bad)' }}>{error}</div>
      ) : (
        <>
          {token && (
            <div className="card" style={{ borderColor: 'var(--accent)', marginBottom: 12 }}>
              <div>{t.tokenOnce}</div>
              <div className="row" style={{ marginTop: 6 }}>
                <code dir="ltr" style={{ flex: 1, wordBreak: 'break-all' }}>
                  {token}
                </code>
                <button
                  className="btn sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(token)
                    toast(t.copied)
                  }}
                >
                  <Copy size={13} />
                </button>
                <button className="btn sm ghost" onClick={() => setToken(null)}>
                  ✕
                </button>
              </div>
            </div>
          )}
          <div className="list">
            {(users ?? []).map((u) => (
              <div className="list-item" key={u.id} style={{ opacity: u.disabled ? 0.5 : 1 }}>
                <div style={{ flex: 1 }}>
                  <strong>{u.name}</strong> <span className="chip">{roleLabel(t, u.role)}</span>
                  <div className="meta">
                    {companyNames(u.companies)} · {u.lastSeen ? formatDate(u.lastSeen, lang) : '—'}
                  </div>
                </div>
                <button
                  className="btn sm"
                  onClick={async () => {
                    setToken((await window.azim.accounts.rotate(u.id)).token)
                  }}
                >
                  {t.rotate}
                </button>
                <button
                  className="btn sm"
                  onClick={async () => {
                    await window.azim.accounts.update(u.id, { disabled: !u.disabled })
                    load()
                  }}
                >
                  {u.disabled ? t.enable : t.disable}
                </button>
                <button
                  className="btn ghost sm danger"
                  onClick={async () => {
                    if (!confirm(`${t.confirmDelete}\n${u.name}`)) return
                    await window.azim.accounts.remove(u.id)
                    load()
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <form
            style={{ marginTop: 14 }}
            onSubmit={async (e) => {
              e.preventDefault()
              if (!form.name.trim()) return
              try {
                const u = await window.azim.accounts.create({
                  name: form.name.trim(),
                  role: form.role,
                  companies: form.role === 'admin' || !form.companies.length ? null : form.companies
                })
                setToken(u.token ?? null)
                setForm({ name: '', role: 'accountant', companies: [] })
                load()
              } catch (err) {
                toast(`✗ ${errText(err)}`)
              }
            }}
          >
            <div className="row">
              <div className="field">
                <label>{t.name}</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="field">
                <label>{t.type}</label>
                <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as ServerUser['role'] })}>
                  {(['accountant', 'viewer', 'admin'] as const).map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(t, r)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {form.role !== 'admin' && (
              <div className="field">
                <label>{t.companiesAllowed}</label>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {companies.map((c) => (
                    <label className="check" key={c.id} style={{ margin: '2px 8px' }}>
                      <input
                        type="checkbox"
                        checked={form.companies.includes(c.id)}
                        onChange={(e) =>
                          setForm({ ...form, companies: e.target.checked ? [...form.companies, c.id] : form.companies.filter((x) => x !== c.id) })
                        }
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <button className="btn primary" type="submit">
              <Plus size={14} /> {t.addAccount}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
