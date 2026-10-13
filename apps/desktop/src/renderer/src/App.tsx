import { useEffect, useState } from 'react'
import { Bot, Building2, CalendarClock, FileText, LayoutDashboard, Lock, MessageSquare, Plus, Search, Settings as SettingsIcon, RefreshCw, Download } from 'lucide-react'
import { dictionaries, LangContext } from './i18n'
import { useLive } from './hooks'
import { Overview } from './pages/Overview'
import { CompanyPage } from './pages/CompanyPage'
import { ChatPage } from './pages/ChatPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { CompanyForm } from './components/CompanyForm'
import { Palette } from './components/Palette'
import { ToastHost } from './components/Toast'
import { LockScreen } from './components/LockScreen'
import { RemindersPage } from './pages/RemindersPage'
import { TasksPage } from './pages/TasksPage'
import { APP_DEVELOPER, type Company, type Role, type Settings, type SyncStatus, type UpdateStatus } from '@shared/types'

export type Route =
  | { page: 'overview' }
  | { page: 'company'; companyId: string; tab?: string }
  | { page: 'chat'; companyId?: string | null; prompt?: string }
  | { page: 'reports' }
  | { page: 'reminders' }
  | { page: 'tasks' }
  | { page: 'settings' }

// Deep links like #company/<id>/<tab>, #chat, #reminders (used by the docs demo).
function routeFromHash(): Route {
  const [page, id, tab] = location.hash.replace(/^#/, '').split('/')
  if (page === 'company' && id) return { page: 'company', companyId: id, tab }
  if (page === 'chat' || page === 'reports' || page === 'reminders' || page === 'tasks' || page === 'settings') return { page }
  return { page: 'overview' }
}

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [route, setRoute] = useState<Route>(routeFromHash)
  const [editing, setEditing] = useState<Partial<Company> | null>(null)
  const [palette, setPalette] = useState(false)
  const [sync, setSync] = useState<SyncStatus | null>(null)
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [locked, setLocked] = useState(false)
  const [companies] = useLive(() => window.azim.companies.list(), [], ['companies'])
  const [alerts] = useLive(() => window.azim.alerts.list(), [], ['alerts'])

  useEffect(() => {
    window.azim.settings.get().then(setSettings)
    window.azim.sync.status().then(setSync)
    window.azim.updates.status().then(setUpdate)
    window.azim.lock.status().then(setLocked)
    const offs = [
      window.azim.sync.onStatus(setSync),
      window.azim.updates.onStatus(setUpdate),
      window.azim.lock.onChange(setLocked),
      window.azim.app.onAccountChanged(() => window.azim.settings.get().then(setSettings))
    ]
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offs.forEach((off) => off())
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const lang = settings?.language ?? 'ar'
  const t = dictionaries[lang]

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    if (settings?.theme && settings.theme !== 'system') document.documentElement.dataset.theme = settings.theme
    else delete document.documentElement.dataset.theme
  }, [lang, settings?.theme])

  if (!settings) return <div className="empty">…</div>
  if (locked) {
    return (
      <LangContext.Provider value={{ lang, t }}>
        <LockScreen />
      </LangContext.Provider>
    )
  }

  // Accountant / viewer accounts come from the Inno server; offline = owner.
  const role: Role = settings.syncEnabled && settings.account ? settings.account.role : 'owner'
  const admin = role === 'owner' || role === 'admin'

  const alertCount = (companyId: string): number => (alerts ?? []).filter((a) => a.companyId === companyId).length
  const nav = (r: Route): void => setRoute(r)
  const isActive = (page: Route['page'], companyId?: string): boolean =>
    route.page === page && (!companyId || (route.page === 'company' && route.companyId === companyId))

  return (
    <LangContext.Provider value={{ lang, t }}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">A</div>
            <div>
              <div className="brand-name">{t.appName}</div>
              <div className="brand-sub">{t.tagline}</div>
            </div>
          </div>
          <button className={`nav-item ${isActive('overview') ? 'active' : ''}`} onClick={() => nav({ page: 'overview' })}>
            <LayoutDashboard size={17} /> {t.overview}
          </button>
          {admin && (
            <button className={`nav-item ${isActive('chat') ? 'active' : ''}`} onClick={() => nav({ page: 'chat' })}>
              <MessageSquare size={17} /> {t.chat}
            </button>
          )}
          {admin && (
            <button className={`nav-item ${isActive('tasks') ? 'active' : ''}`} onClick={() => nav({ page: 'tasks' })}>
              <Bot size={17} /> {t.agentTasks}
            </button>
          )}
          <button className={`nav-item ${isActive('reminders') ? 'active' : ''}`} onClick={() => nav({ page: 'reminders' })}>
            <CalendarClock size={17} /> {t.calendar}
          </button>
          <button className={`nav-item ${isActive('reports') ? 'active' : ''}`} onClick={() => nav({ page: 'reports' })}>
            <FileText size={17} /> {t.reports}
          </button>
          <div className="nav-section">
            {t.companies}
            {admin && (
              <button className="btn ghost sm" style={{ color: 'inherit' }} title={t.addCompany} onClick={() => setEditing({})}>
                <Plus size={14} />
              </button>
            )}
          </div>
          {(companies ?? []).map((c) => (
            <button
              key={c.id}
              className={`nav-item ${isActive('company', c.id) ? 'active' : ''}`}
              onClick={() => nav({ page: 'company', companyId: c.id })}
            >
              <span className="dot" style={{ background: c.color }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              {alertCount(c.id) > 0 && <span className="nav-badge">{alertCount(c.id)}</span>}
            </button>
          ))}
          {!companies?.length && admin && (
            <button className="nav-item" onClick={() => setEditing({})}>
              <Building2 size={17} /> {t.addCompany}
            </button>
          )}
          <button
            className={`nav-item ${isActive('settings') ? 'active' : ''}`}
            style={{ marginTop: 16 }}
            onClick={() => nav({ page: 'settings' })}
          >
            <SettingsIcon size={17} /> {t.settings}
          </button>
          <div className="sidebar-footer">
            {!admin && settings.account && (
              <span style={{ color: '#c9d1dc' }}>
                {t.signedInAs}: {settings.account.name} · {t[`r_${role}` as keyof typeof t]}
              </span>
            )}
            <span>
              {t.developedBy} {APP_DEVELOPER}
            </span>
          </div>
        </aside>

        <main className="main">
          <div className="topbar">
            <button className="search-trigger" onClick={() => setPalette(true)}>
              <Search size={15} /> {t.search}
              <span className="kbd">Ctrl K</span>
            </button>
            <div className="topbar-right">
              {settings.lock.enabled && settings.lock.hasPin && (
                <button className="btn sm ghost" title={t.lockNow} onClick={() => window.azim.lock.lockNow()}>
                  <Lock size={14} />
                </button>
              )}
              {update?.state === 'ready' && (
                <span className="pill accent" onClick={() => window.azim.updates.install()}>
                  <Download size={13} /> {t.installRestart} {update.version}
                </span>
              )}
              {update?.state === 'downloading' && (
                <span className="pill">
                  <Download size={13} /> {t.downloading} {update.progress ?? 0}%
                </span>
              )}
              {settings.syncEnabled && sync && (
                <span
                  className={`pill ${sync.state === 'ok' ? 'ok' : sync.state === 'error' ? 'err' : ''}`}
                  title={sync.error ?? ''}
                  style={{ cursor: 'pointer' }}
                  onClick={() => window.azim.sync.now()}
                >
                  <RefreshCw size={13} /> {sync.state === 'syncing' ? '…' : sync.state === 'error' ? '!' : '✓'}
                </span>
              )}
              <button
                className="btn sm"
                onClick={async () => setSettings(await window.azim.settings.update({ language: lang === 'ar' ? 'en' : 'ar' }))}
              >
                {lang === 'ar' ? 'English' : 'عربي'}
              </button>
            </div>
          </div>
          <div className="content">
            {route.page === 'overview' && (
              <Overview onOpen={(id) => nav({ page: 'company', companyId: id })} onAdd={admin ? () => setEditing({}) : undefined} onReminders={() => nav({ page: 'reminders' })} />
            )}
            {route.page === 'company' && (
              <CompanyPage
                key={route.companyId + (route.tab ?? '')}
                companyId={route.companyId}
                initialTab={route.tab}
                role={role}
                onEdit={(c) => setEditing(c)}
                onAsk={(prompt) => nav({ page: 'chat', companyId: route.companyId, prompt })}
                onDeleted={() => nav({ page: 'overview' })}
              />
            )}
            {route.page === 'chat' && <ChatPage companies={companies ?? []} initialCompanyId={route.companyId ?? null} initialPrompt={route.prompt} />}
            {route.page === 'reports' && <ReportsPage companies={companies ?? []} />}
            {route.page === 'tasks' && <TasksPage companies={companies ?? []} onOpenChat={(companyId) => nav({ page: 'chat', companyId })} />}
            {route.page === 'reminders' && <RemindersPage companies={companies ?? []} canEdit={role !== 'viewer'} />}
            {route.page === 'settings' && <SettingsPage settings={settings} onChange={setSettings} companies={companies ?? []} admin={admin} />}
          </div>
        </main>
      </div>
      {editing && (
        <CompanyForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setEditing(null)
            nav({ page: 'company', companyId: c.id })
          }}
        />
      )}
      {palette && (
        <Palette
          companies={companies ?? []}
          onClose={() => setPalette(false)}
          onNavigate={(r) => {
            setPalette(false)
            nav(r)
          }}
        />
      )}
      <ToastHost />
    </LangContext.Provider>
  )
}
