import { useState } from 'react'
import { useT } from '../i18n'
import type { Company } from '@shared/types'

const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const CURRENCIES = ['EGP', 'USD', 'EUR', 'SAR', 'AED', 'KWD', 'QAR', 'GBP']

export function CompanyForm(props: {
  initial: Partial<Company>
  onClose: () => void
  onSaved: (c: Company) => void
}): React.JSX.Element {
  const { t } = useT()
  const [c, setC] = useState<Partial<Company>>({ currency: 'EGP', color: COLORS[0], ...props.initial })
  const set = <K extends keyof Company>(k: K, v: Company[K] | null): void => setC((p) => ({ ...p, [k]: v }))

  return (
    <div className="modal-bg" onClick={props.onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault()
          if (!c.name?.trim()) return
          props.onSaved(await window.azim.companies.save({ ...c, name: c.name.trim() }))
        }}
      >
        <h2>{c.id ? t.editCompany : t.addCompany}</h2>
        <div className="field">
          <label>{t.name}</label>
          <input className="input" autoFocus required value={c.name ?? ''} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="row">
          <div className="field">
            <label>{t.industry}</label>
            <input className="input" value={c.industry ?? ''} onChange={(e) => set('industry', e.target.value)} />
          </div>
          <div className="field">
            <label>{t.role}</label>
            <input className="input" placeholder={t.rolePlaceholder} value={c.role ?? ''} onChange={(e) => set('role', e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label>{t.currency}</label>
            <select className="input" value={c.currency} onChange={(e) => set('currency', e.target.value)}>
              {CURRENCIES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t.color}</label>
            <div className="row">
              {COLORS.map((col) => (
                <button
                  type="button"
                  key={col}
                  onClick={() => set('color', col)}
                  aria-label={col}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: col,
                    border: c.color === col ? '3px solid var(--ink)' : '1px solid var(--border)',
                    cursor: 'pointer'
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="field">
          <label>{t.watchFolder}</label>
          <div className="row">
            <input className="input" readOnly value={c.watchFolder ?? ''} />
            <button type="button" className="btn" onClick={async () => set('watchFolder', await window.azim.companies.pickFolder())}>
              {t.choose}
            </button>
            {c.watchFolder && (
              <button type="button" className="btn ghost" onClick={() => set('watchFolder', null)}>
                {t.clear}
              </button>
            )}
          </div>
          <span className="hint">{t.watchFolderHint}</span>
        </div>
        <div className="field">
          <label>{t.notes}</label>
          <textarea className="input" rows={3} value={c.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={props.onClose}>
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
