import { useState } from 'react'
import { Edit3, FolderOpen, MessageSquare, RefreshCw, Trash2, Upload, Eye, ExternalLink } from 'lucide-react'
import { useLive } from '../hooks'
import { CATEGORIES, categoryLabel, formatDate, formatNumber, formatSize, metricLabel, useT } from '../i18n'
import { HBarChart, TrendChart } from '../components/Charts'
import { ActivityList, AlertList, KpiCard } from '../components/Widgets'
import { toast } from '../components/Toast'
import type { ImportSummary } from '@shared/api'
import type { Company, Decision, DocumentRecord } from '@shared/types'

export function CompanyPage(props: {
  companyId: string
  initialTab?: string
  onEdit: (c: Company) => void
  onAsk: (prompt?: string) => void
  onDeleted: () => void
}): React.JSX.Element {
  const { t } = useT()
  const [tab, setTab] = useState(props.initialTab ?? 'dashboard')
  const [dash] = useLive(() => window.azim.dashboard.company(props.companyId), [props.companyId])
  if (!dash) return <div className="empty">…</div>
  const c = dash.company

  return (
    <>
      <div className="page-head">
        <span className="dot" style={{ background: c.color, width: 14, height: 14 }} />
        <div>
          <h1>{c.name}</h1>
          <div className="sub">
            {[c.industry, c.role, c.currency].filter(Boolean).join(' · ')}
            {c.watchFolder && ` · 📁 ${c.watchFolder}`}
          </div>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => props.onAsk()}>
          <MessageSquare size={15} /> {t.askAi}
        </button>
        <button className="btn" onClick={() => props.onEdit(c)}>
          <Edit3 size={15} />
        </button>
        <button
          className="btn danger"
          onClick={async () => {
            if (confirm(`${t.confirmDelete}\n${c.name}`)) {
              await window.azim.companies.remove(c.id)
              props.onDeleted()
            }
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="tabs">
        {(['dashboard', 'files', 'metrics', 'decisions'] as const).map((k) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {t[k]}
            {k === 'files' ? ` (${dash.documentCount})` : ''}
          </button>
        ))}
      </div>
      {tab === 'dashboard' && <DashboardTab dash={dash} onAsk={props.onAsk} />}
      {tab === 'files' && <FilesTab companyId={c.id} />}
      {tab === 'metrics' && <MetricsTab company={c} />}
      {tab === 'decisions' && <DecisionsTab companyId={c.id} />}
    </>
  )
}

function DashboardTab({ dash, onAsk }: { dash: NonNullable<Awaited<ReturnType<typeof window.azim.dashboard.company>>>; onAsk: (p?: string) => void }): React.JSX.Element {
  const { lang, t } = useT()
  const trendMetrics = ['revenue', 'expenses', 'net_profit', 'cash'].filter((m) => dash.trend.some((p) => m in p))
  return (
    <div className="grid" style={{ gap: 20 }}>
      {dash.kpis.length ? (
        <div className="grid kpis">
          {dash.kpis.slice(0, 8).map((k) => (
            <KpiCard key={k.metric} kpi={k} />
          ))}
        </div>
      ) : (
        <div className="card empty">
          {t.noData} —{' '}
          <button className="btn sm" onClick={() => onAsk(t.sug1)}>
            {t.sug1}
          </button>
        </div>
      )}
      <div className="grid two">
        <div className="card">
          <h3>{t.trend}</h3>
          {dash.trend.length > 1 && trendMetrics.length ? <TrendChart data={dash.trend} metrics={trendMetrics} /> : <div className="empty">{t.noData}</div>}
        </div>
        <div className="card">
          <h3>{t.byCategory}</h3>
          {dash.categories.length ? (
            <HBarChart data={dash.categories.map((x) => ({ label: categoryLabel(x.category, lang), value: x.count }))} />
          ) : (
            <div className="empty">{t.noData}</div>
          )}
        </div>
      </div>
      <div className="grid half">
        <div className="card">
          <h3>{t.alerts}</h3>
          <AlertList alerts={dash.alerts} />
        </div>
        <div className="card">
          <h3>{t.activity}</h3>
          <ActivityList items={dash.activity} />
        </div>
      </div>
    </div>
  )
}

function report(r: ImportSummary, t: ReturnType<typeof useT>['t']): void {
  const parts = [`${t.imported} ${r.imported}`]
  if (r.duplicates.length) parts.push(`${r.duplicates.length} ${t.duplicates}`)
  if (r.failed.length) parts.push(`${r.failed.length} ${t.failed}`)
  toast(parts.join(' · '))
}

function FilesTab({ companyId }: { companyId: string }): React.JSX.Element {
  const { lang, t } = useT()
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [over, setOver] = useState(false)
  const [preview, setPreview] = useState<DocumentRecord | null>(null)
  const [docs] = useLive(() => window.azim.documents.list({ companyId, category: category || undefined, query: query || undefined }), [companyId, category, query], ['documents'])

  return (
    <>
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault()
          setOver(false)
          const paths = [...e.dataTransfer.files].map((f) => window.azim.documents.pathForFile(f)).filter(Boolean)
          if (paths.length) report(await window.azim.documents.importPaths(companyId, paths), t)
        }}
      >
        <Upload size={20} style={{ verticalAlign: 'middle' }} /> {t.dropHere}
        <div style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={async () => report(await window.azim.documents.pickAndImport(companyId), t)}>
            {t.importFiles}
          </button>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder={t.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input" style={{ maxWidth: 220 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t.all}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c, lang)}
            </option>
          ))}
        </select>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap" style={{ maxHeight: 'none' }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t.name}</th>
                <th>{t.category}</th>
                <th>{t.period}</th>
                <th>{t.summary}</th>
                <th>{t.status}</th>
                <th style={{ textAlign: 'end' }}>{t.size}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(docs ?? []).map((d) => (
                <tr key={d.id}>
                  <td style={{ maxWidth: 260 }}>
                    <strong style={{ overflowWrap: 'anywhere' }}>{d.name}</strong>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>{formatDate(d.createdAt, lang)}</div>
                  </td>
                  <td>
                    {categoryLabel(d.category, lang)}
                    <div>
                      {d.tags.map((tag) => (
                        <span className="chip" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{d.period ?? '—'}</td>
                  <td style={{ maxWidth: 360, color: 'var(--ink-2)', fontSize: 12 }}>{d.error ?? d.summary}</td>
                  <td>
                    <span className={`status ${d.status}`}>{d.status}</span>
                  </td>
                  <td className="num">{formatSize(d.size)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" title={t.preview} onClick={() => setPreview(d)}>
                      <Eye size={14} />
                    </button>
                    <button className="btn ghost sm" title={t.open} onClick={() => window.azim.documents.open(d.id)}>
                      <ExternalLink size={14} />
                    </button>
                    <button className="btn ghost sm" title={t.showInFolder} onClick={() => window.azim.documents.reveal(d.id)}>
                      <FolderOpen size={14} />
                    </button>
                    <button className="btn ghost sm" title={t.reprocess} onClick={() => window.azim.documents.reprocess(d.id)}>
                      <RefreshCw size={14} />
                    </button>
                    <button
                      className="btn ghost sm danger"
                      title={t.delete}
                      onClick={() => confirm(`${t.confirmDelete}\n${d.name}`) && window.azim.documents.remove(d.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!docs?.length && <div className="empty">{t.noData}</div>}
        </div>
      </div>
      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}
    </>
  )
}

function PreviewModal({ doc, onClose }: { doc: DocumentRecord; onClose: () => void }): React.JSX.Element {
  const { lang, t } = useT()
  const [sheet, setSheet] = useState<string | undefined>()
  const [sheets] = useLive(() => window.azim.documents.sheets(doc.id), [doc.id])
  const [table] = useLive(() => window.azim.documents.table(doc.id, sheet), [doc.id, sheet])
  const [text] = useLive(() => window.azim.documents.text(doc.id), [doc.id])
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>{doc.name}</h2>
        <div style={{ color: 'var(--ink-2)', marginBottom: 12 }}>
          {categoryLabel(doc.category, lang)} · {doc.period ?? '—'} · {doc.summary}
        </div>
        {sheets && sheets.length > 0 && table ? (
          <>
            {sheets.length > 1 && (
              <div className="tabs">
                {sheets.map((s) => (
                  <button key={s.name} className={`tab ${table.sheet === s.name ? 'active' : ''}`} onClick={() => setSheet(s.name)}>
                    {s.name} ({s.rowCount})
                  </button>
                ))}
              </div>
            )}
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    {table.columns.map((c, i) => (
                      <th key={i}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.slice(0, 300).map((r, i) => (
                    <tr key={i}>
                      {table.columns.map((_, j) => (
                        <td key={j} className={typeof r[j] === 'number' ? 'num' : ''}>
                          {typeof r[j] === 'number' ? formatNumber(r[j] as number, lang) : String(r[j] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto', background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}>
            {(text ?? '').slice(0, 30000) || t.noData}
          </pre>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}

function MetricsTab({ company }: { company: Company }): React.JSX.Element {
  const { lang, t } = useT()
  const [metrics] = useLive(() => window.azim.metrics.list(company.id), [company.id], ['metrics'])
  const [form, setForm] = useState({ metric: 'revenue', period: new Date().toISOString().slice(0, 7), value: '' })
  return (
    <div className="card">
      <form
        className="row"
        style={{ marginBottom: 14, alignItems: 'flex-end' }}
        onSubmit={async (e) => {
          e.preventDefault()
          const value = Number(form.value)
          if (!Number.isFinite(value) || !/^\d{4}-\d{2}$/.test(form.period)) return
          await window.azim.metrics.save({ companyId: company.id, metric: form.metric, period: form.period, value, currency: company.currency, note: 'manual' })
          setForm({ ...form, value: '' })
        }}
      >
        <div className="field">
          <label>{t.metric}</label>
          <input className="input" list="metric-names" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} />
          <datalist id="metric-names">
            {['revenue', 'expenses', 'net_profit', 'cash', 'receivables', 'payables', 'gross_margin', 'payroll'].map((m) => (
              <option key={m} value={m}>
                {metricLabel(m, lang)}
              </option>
            ))}
          </datalist>
        </div>
        <div className="field">
          <label>{t.period}</label>
          <input className="input" type="month" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} />
        </div>
        <div className="field">
          <label>{t.value}</label>
          <input className="input" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
        </div>
        <button className="btn primary" type="submit" style={{ marginBottom: 12 }}>
          {t.addMetric}
        </button>
      </form>
      <div className="table-wrap" style={{ maxHeight: 'none' }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t.period}</th>
              <th>{t.metric}</th>
              <th style={{ textAlign: 'end' }}>{t.value}</th>
              <th>{t.notes}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...(metrics ?? [])].reverse().map((m) => (
              <tr key={m.id}>
                <td>{m.period}</td>
                <td>{metricLabel(m.metric, lang)}</td>
                <td className="num">
                  {formatNumber(m.value, lang)} {m.currency}
                </td>
                <td style={{ color: 'var(--ink-2)', fontSize: 12 }}>{m.note}</td>
                <td>
                  <button className="btn ghost sm danger" onClick={() => window.azim.metrics.remove(m.id)}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!metrics?.length && <div className="empty">{t.noData}</div>}
      </div>
    </div>
  )
}

function DecisionsTab({ companyId }: { companyId: string }): React.JSX.Element {
  const { lang, t } = useT()
  const [decisions] = useLive(() => window.azim.decisions.list(companyId), [companyId], ['decisions'])
  const [editing, setEditing] = useState<Partial<Decision> | null>(null)
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn primary" onClick={() => setEditing({ status: 'open' })}>
          {t.newDecision}
        </button>
      </div>
      <div className="card">
        {!decisions?.length && <div className="empty">{t.noData}</div>}
        <div className="list">
          {(decisions ?? []).map((d) => (
            <div className="list-item" key={d.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(d)}>
              <div style={{ flex: 1 }}>
                <strong>{d.title}</strong>
                {d.rationale && <div style={{ color: 'var(--ink-2)', fontSize: 13 }}>{d.rationale}</div>}
                <div className="meta">
                  {formatDate(d.createdAt, lang)}
                  {d.reviewDate && ` · ${t.reviewDate}: ${d.reviewDate}`}
                </div>
              </div>
              <span className="status">{d.status === 'open' ? t.open_ : d.status === 'done' ? t.done : t.cancelled}</span>
            </div>
          ))}
        </div>
      </div>
      {editing && (
        <div className="modal-bg" onClick={() => setEditing(null)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault()
              if (!editing.title?.trim()) return
              await window.azim.decisions.save({ ...editing, companyId, title: editing.title.trim() })
              setEditing(null)
            }}
          >
            <h2>{editing.id ? editing.title : t.newDecision}</h2>
            {(
              [
                ['title', t.title, 1],
                ['rationale', t.rationale, 3],
                ['expectedOutcome', t.expectedOutcome, 2],
                ['actualOutcome', t.actualOutcome, 2]
              ] as const
            ).map(([k, label, rows]) => (
              <div className="field" key={k}>
                <label>{label}</label>
                {rows === 1 ? (
                  <input className="input" required value={editing[k] ?? ''} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} />
                ) : (
                  <textarea className="input" rows={rows} value={editing[k] ?? ''} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} />
                )}
              </div>
            ))}
            <div className="row">
              <div className="field">
                <label>{t.reviewDate}</label>
                <input className="input" type="date" value={editing.reviewDate ?? ''} onChange={(e) => setEditing({ ...editing, reviewDate: e.target.value || null })} />
              </div>
              <div className="field">
                <label>{t.status}</label>
                <select className="input" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as Decision['status'] })}>
                  <option value="open">{t.open_}</option>
                  <option value="done">{t.done}</option>
                  <option value="cancelled">{t.cancelled}</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              {editing.id && (
                <button
                  type="button"
                  className="btn danger"
                  onClick={async () => {
                    await window.azim.decisions.remove(editing.id!)
                    setEditing(null)
                  }}
                >
                  {t.delete}
                </button>
              )}
              <div className="spacer" />
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                {t.cancel}
              </button>
              <button type="submit" className="btn primary">
                {t.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
