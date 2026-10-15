import { useState } from 'react'
import { Database, Play, Plus, RefreshCw, Trash2, Edit3 } from 'lucide-react'
import { useLive } from '../../hooks'
import { formatDate, useT } from '../../i18n'
import { toast } from '../../components/Toast'
import type { Company, Connector, ConnectorType, Dataset } from '@shared/types'

const TYPES: { type: ConnectorType; name: string; fields: string[]; example: string }[] = [
  { type: 'innoerp', name: 'Inno Source ERP', fields: ['url', 'companyId'], example: '{"dataset":"sales_invoices","range":"last_90_days"}' },
  { type: 'innopos', name: 'InnoForge POS (Inno Source)', fields: ['host', 'port', 'username'], example: '{"report":"sales_by_day","range":"last_30_days"}' },
  { type: 'mssql', name: 'SQL Server', fields: ['host', 'port', 'database', 'user'], example: 'SELECT FORMAT(InvoiceDate, \'yyyy-MM\') AS period, SUM(Total) AS revenue FROM Invoices GROUP BY FORMAT(InvoiceDate, \'yyyy-MM\')' },
  { type: 'postgres', name: 'PostgreSQL', fields: ['host', 'port', 'database', 'user'], example: "SELECT to_char(date, 'YYYY-MM') AS period, sum(amount) AS revenue FROM invoices GROUP BY 1" },
  { type: 'mysql', name: 'MySQL / MariaDB', fields: ['host', 'port', 'database', 'user'], example: "SELECT DATE_FORMAT(date, '%Y-%m') AS period, SUM(amount) AS revenue FROM invoices GROUP BY 1" },
  { type: 'sqlite', name: 'SQLite file', fields: ['file'], example: 'SELECT * FROM invoices LIMIT 1000' },
  { type: 'odoo', name: 'Odoo (accounting/ERP)', fields: ['url', 'database', 'user'], example: '{"model":"account.move","domain":[["move_type","=","out_invoice"],["state","=","posted"]],"fields":["name","invoice_date","amount_total","partner_id"],"limit":2000}' },
  { type: 'rest', name: 'REST API (JSON)', fields: ['url', 'headerName'], example: '/api/invoices?from=2026-01-01' }
]

const typeInfo = (type: ConnectorType): (typeof TYPES)[number] => TYPES.find((x) => x.type === type)!

function ConnectorForm({ companyId, initial, onClose }: { companyId: string; initial: Partial<Connector>; onClose: () => void }): React.JSX.Element {
  const { t } = useT()
  const [c, setC] = useState<Partial<Connector>>({ type: 'mssql', refreshMinutes: 60, allowAi: false, config: {}, ...initial })
  const [secret, setSecret] = useState('')
  const info = typeInfo(c.type!)
  const [posKey, setPosKey] = useState('')
  const [posPin, setPosPin] = useState('')
  const pos = c.type === 'innopos'
  const erp = c.type === 'innoerp'
  const labels: Record<string, string> = { companyId: t.erpCompanyId, host: pos ? t.posHost : t.host, port: t.port, username: t.posUser, database: t.database, user: t.user, file: t.file, url: t.url, headerName: t.headerName }
  return (
    <div className="modal-bg" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault()
          if (!c.name?.trim()) return
          await window.azim.connectors.save({
            id: c.id,
            companyId,
            name: c.name.trim(),
            type: c.type!,
            config: c.config ?? {},
            allowAi: !!c.allowAi,
            refreshMinutes: c.refreshMinutes ?? 60,
            ...(pos ? (posKey && posPin ? { secret: JSON.stringify({ key: posKey, pin: posPin }) } : {}) : secret ? { secret } : {})
          })
          onClose()
        }}
      >
        <h2>{c.id ? c.name : t.addConnector}</h2>
        <div className="row">
          <div className="field">
            <label>{t.name}</label>
            <input className="input" required autoFocus value={c.name ?? ''} onChange={(e) => setC({ ...c, name: e.target.value })} />
          </div>
          <div className="field">
            <label>{t.type}</label>
            <select className="input" value={c.type} disabled={!!c.id} onChange={(e) => setC({ ...c, type: e.target.value as ConnectorType, config: {} })}>
              {TYPES.map((x) => (
                <option key={x.type} value={x.type}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {info.fields.map((f) => (
          <div className="field" key={f}>
            <label>{labels[f]}</label>
            <div className="row">
              <input
                className="input"
                dir="ltr"
                placeholder={erp && f === 'url' ? 'https://erp.example.com/api/data/v1' : f === 'port' ? { mssql: '1433', postgres: '5432', mysql: '3306', innopos: '7790' }[c.type as string] : f === 'headerName' ? 'Authorization' : f === 'host' && pos ? '192.168.1.10' : ''}
                value={String(c.config?.[f] ?? '')}
                onChange={(e) => setC({ ...c, config: { ...c.config, [f]: e.target.value } })}
              />
              {f === 'file' && (
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const file = await window.azim.connectors.pickFile()
                    if (file) setC({ ...c, config: { ...c.config, file } })
                  }}
                >
                  {t.choose}
                </button>
              )}
            </div>
          </div>
        ))}
        {pos && (
          <>
            <div className="row">
              <div className="field">
                <label>{t.posKey}</label>
                <input className="input" type="password" dir="ltr" placeholder={c.hasSecret ? '••••••••' : ''} value={posKey} onChange={(e) => setPosKey(e.target.value)} />
              </div>
              <div className="field">
                <label>{t.posPin}</label>
                <input className="input" type="password" inputMode="numeric" dir="ltr" placeholder={c.hasSecret ? '••••' : ''} value={posPin} onChange={(e) => setPosPin(e.target.value)} />
              </div>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 10 }}>{t.posHint}</div>
          </>
        )}
        {c.type !== 'sqlite' && !pos && (
          <div className="field">
            <label>{c.type === 'rest' ? t.headerName + ' — value' : erp ? t.apiKey : t.password}</label>
            <input className="input" type="password" dir="ltr" placeholder={c.hasSecret ? '••••••••' : ''} value={secret} onChange={(e) => setSecret(e.target.value)} />
          </div>
        )}
        {erp && <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 10 }}>{t.innoErpHint}</div>}
        {(c.type === 'postgres' || c.type === 'mssql') && (
          <label className="check">
            <input
              type="checkbox"
              checked={!!(c.type === 'postgres' ? c.config?.ssl : c.config?.encrypt)}
              onChange={(e) => setC({ ...c, config: { ...c.config, [c.type === 'postgres' ? 'ssl' : 'encrypt']: e.target.checked } })}
            />
            {t.secure}
          </label>
        )}
        <div className="row">
          <div className="field">
            <label>{t.refreshEvery}</label>
            <input className="input" type="number" min={0} value={c.refreshMinutes ?? 60} onChange={(e) => setC({ ...c, refreshMinutes: Number(e.target.value) })} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={!!c.allowAi} onChange={(e) => setC({ ...c, allowAi: e.target.checked })} />
          {t.allowAi}
        </label>
        <div className="hint" style={{ color: 'var(--muted)', fontSize: 12 }}>{t.readOnlyHint}</div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="btn primary">
            {t.save}
          </button>
        </div>
      </form>
    </div>
  )
}

function DatasetForm({ connector, initial, onClose }: { connector: Connector; initial: Partial<Dataset>; onClose: () => void }): React.JSX.Element {
  const { t } = useT()
  const [d, setD] = useState<Partial<Dataset>>({ mode: 'table', query: typeInfo(connector.type).example, ...initial })
  const [preview, setPreview] = useState<{ columns: string[]; rows: unknown[][]; total: number } | null>(null)
  const [error, setError] = useState('')
  return (
    <div className="modal-bg" onClick={onClose}>
      <form
        className="modal wide"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault()
          if (!d.name?.trim() || !d.query?.trim()) return
          await window.azim.connectors.saveDataset({ ...d, connectorId: connector.id, name: d.name.trim(), query: d.query })
          onClose()
        }}
      >
        <h2>
          {connector.name} — {d.id ? d.name : t.addDataset}
        </h2>
        <div className="row">
          <div className="field">
            <label>{t.name}</label>
            <input className="input" required value={d.name ?? ''} onChange={(e) => setD({ ...d, name: e.target.value })} />
          </div>
          <div className="field">
            <label>{t.mode}</label>
            <select className="input" value={d.mode} onChange={(e) => setD({ ...d, mode: e.target.value as Dataset['mode'] })}>
              <option value="table">{t.modeTable}</option>
              <option value="metrics">{t.modeMetrics}</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label>{t.query}</label>
          <textarea className="input" dir="ltr" rows={6} style={{ fontFamily: 'Consolas, monospace', fontSize: 12.5 }} value={d.query ?? ''} onChange={(e) => setD({ ...d, query: e.target.value })} />
        </div>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            setError('')
            try {
              setPreview(await window.azim.connectors.preview(connector.id, d.query ?? ''))
            } catch (e) {
              setPreview(null)
              setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
            }
          }}
        >
          <Play size={14} /> {t.run}
        </button>
        {error && <div style={{ color: 'var(--bad)', marginTop: 8, whiteSpace: 'pre-wrap' }}>{error}</div>}
        {preview && (
          <div className="table-wrap" style={{ marginTop: 10, maxHeight: 280 }}>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>{preview.total} rows</div>
            <table className="data">
              <thead>
                <tr>
                  {preview.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j}>{String(v ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="modal-actions">
          {d.id && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                await window.azim.connectors.removeDataset(d.id!)
                onClose()
              }}
            >
              {t.delete}
            </button>
          )}
          <div className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="btn primary">
            {t.save}
          </button>
        </div>
      </form>
    </div>
  )
}

export function SourcesTab({ company }: { company: Company }): React.JSX.Element {
  const { lang, t } = useT()
  const [list] = useLive(() => window.azim.connectors.list(company.id), [company.id], ['connectors'])
  const [editing, setEditing] = useState<Partial<Connector> | null>(null)
  const [dataset, setDataset] = useState<{ connector: Connector; initial: Partial<Dataset> } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (id: string, fn: () => Promise<{ ok: boolean; message: string }>): Promise<void> => {
    setBusy(id)
    const r = await fn().catch((e: Error) => ({ ok: false, message: e.message }))
    setBusy(null)
    toast(`${r.ok ? '✓' : '✗'} ${r.message}`)
  }
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn primary" onClick={() => setEditing({})}>
          <Plus size={15} /> {t.addConnector}
        </button>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t.readOnlyHint}</span>
      </div>
      {!list?.some((c) => c.type === 'innoerp') && (
        <div className="card inno-soon" style={{ marginBottom: 14 }}>
          <div className="row">
            <Database size={18} color="var(--accent)" />
            <strong>Inno Source ERP</strong>
            <span className="chip" dir="ltr">innovationsrc.com</span>
            <div className="spacer" />
            <button className="btn sm primary" onClick={() => setEditing({ type: 'innoerp', name: 'Inno Source ERP', allowAi: true })}>
              <Plus size={13} /> {t.connect}
            </button>
          </div>
          <div style={{ color: 'var(--ink-2)', fontSize: 13, marginTop: 6 }}>{t.innoErpHint}</div>
        </div>
      )}
      {!list?.length && <div className="card empty">{t.noData}</div>}
      <div className="grid" style={{ gap: 14 }}>
        {(list ?? []).map((c) => (
          <div className="card" key={c.id}>
            <div className="row">
              <Database size={18} color="var(--accent)" />
              <strong>{c.name}</strong>
              <span className="chip">{typeInfo(c.type).name}</span>
              {c.allowAi && <span className="chip">AI</span>}
              <div className="spacer" />
              <button className="btn sm" disabled={busy === c.id} onClick={() => act(c.id, () => window.azim.connectors.test(c.id))}>
                {t.testConn}
              </button>
              <button className="btn sm" disabled={busy === c.id || !c.datasets.length} onClick={() => act(c.id, () => window.azim.connectors.refresh(c.id))}>
                <RefreshCw size={13} /> {t.refreshNow}
              </button>
              <button className="btn ghost sm" onClick={() => setEditing(c)}>
                <Edit3 size={13} />
              </button>
              <button className="btn ghost sm danger" onClick={() => confirm(`${t.confirmDelete}\n${c.name}`) && window.azim.connectors.remove(c.id)}>
                <Trash2 size={13} />
              </button>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 10px' }}>
              {c.lastRunAt ? formatDate(c.lastRunAt, lang) : '—'}
              {c.lastError && <span style={{ color: 'var(--bad)', whiteSpace: 'pre-wrap' }}> · {c.lastError}</span>}
            </div>
            <div className="list">
              {c.datasets.map((d) => (
                <div className="list-item" key={d.id} style={{ cursor: 'pointer' }} onClick={() => setDataset({ connector: c, initial: d })}>
                  <div style={{ flex: 1 }}>
                    <div>
                      {d.name} <span className="chip">{d.mode === 'metrics' ? t.metrics : t.documents}</span>
                    </div>
                    <div className="meta" dir="ltr" style={{ fontFamily: 'Consolas, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 700 }}>
                      {d.query}
                    </div>
                  </div>
                  <span className="meta">{d.lastRows ?? '—'} rows</span>
                </div>
              ))}
            </div>
            <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setDataset({ connector: c, initial: {} })}>
              <Plus size={13} /> {t.addDataset}
            </button>
          </div>
        ))}
      </div>
      {editing && <ConnectorForm companyId={company.id} initial={editing} onClose={() => setEditing(null)} />}
      {dataset && <DatasetForm connector={dataset.connector} initial={dataset.initial} onClose={() => setDataset(null)} />}
    </>
  )
}
