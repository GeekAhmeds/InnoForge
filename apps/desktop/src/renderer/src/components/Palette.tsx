import { useEffect, useState } from 'react'
import { FileText, Building2, MessageSquare } from 'lucide-react'
import { useT } from '../i18n'
import type { Route } from '../App'
import type { Company, SearchHit } from '@shared/types'

// Ctrl+K: jump to a company or search inside every file.
export function Palette(props: { companies: Company[]; onClose: () => void; onNavigate: (r: Route) => void }): React.JSX.Element {
  const { t } = useT()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [sel, setSel] = useState(0)

  useEffect(() => {
    const id = setTimeout(() => {
      if (q.trim().length >= 2) window.azim.search(q).then(setHits)
      else setHits([])
    }, 180)
    return () => clearTimeout(id)
  }, [q])

  const companyMatches = props.companies.filter((c) => q && c.name.toLowerCase().includes(q.toLowerCase()))
  const items: { key: string; icon: React.ReactNode; title: string; sub?: string; go: () => void }[] = [
    ...companyMatches.map((c) => ({
      key: c.id,
      icon: <Building2 size={15} />,
      title: c.name,
      sub: c.industry,
      go: () => props.onNavigate({ page: 'company', companyId: c.id })
    })),
    ...hits.map((h) => ({
      key: h.documentId,
      icon: <FileText size={15} />,
      title: `${h.name} — ${props.companies.find((c) => c.id === h.companyId)?.name ?? ''}`,
      sub: h.snippet,
      go: () => props.onNavigate({ page: 'company', companyId: h.companyId, tab: 'files' })
    })),
    ...(q.trim()
      ? [
          {
            key: 'ask',
            icon: <MessageSquare size={15} />,
            title: `${t.askAi}: “${q}”`,
            go: () => props.onNavigate({ page: 'chat', companyId: null, prompt: q })
          }
        ]
      : [])
  ]

  return (
    <div className="palette" onClick={props.onClose}>
      <div className="palette-box" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder={t.searchHint}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setSel(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') props.onClose()
            if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, items.length - 1))
            if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0))
            if (e.key === 'Enter') items[sel]?.go()
          }}
        />
        <div className="palette-results">
          {items.map((it, i) => (
            <div key={it.key} className={`palette-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={it.go}>
              <div className="row">
                {it.icon} <strong>{it.title}</strong>
              </div>
              {it.sub && <div className="snippet">{it.sub}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
