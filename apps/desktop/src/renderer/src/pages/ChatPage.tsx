import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CheckCircle2, File as FileIcon, FileSpreadsheet, FileText, FileType, Paperclip, Plus, Send, Square, Trash2, Wrench, X, XCircle } from 'lucide-react'
import { useLive } from '../hooks'
import { useT } from '../i18n'
import { ChatChart, ChatTable } from '../components/ChatVisuals'
import type { ChatConversation, ChatMessage, Company, ToolStep } from '@shared/types'

const ICONS = { pdf: FileText, xlsx: FileSpreadsheet, docx: FileType } as const

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p
// The user turn stores a note for the agent about attached files; hide it in the bubble.
const visibleText = (content: string): string => content.split('\n\n[The user attached ')[0]

const STEP_LABELS: Record<string, string> = { run_analysis: '🧮', create_chart: '📊', show_table: '📋', web_search: '🌐', generate_report: '📄', remember: '🧠', schedule_task: '⏱' }

export function ChatPage(props: { companies: Company[]; initialCompanyId: string | null; initialPrompt?: string }): React.JSX.Element {
  const { t } = useT()
  const [conversations, reloadConversations] = useLive(() => window.azim.chat.conversations(), [])
  const [active, setActive] = useState<ChatConversation | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState(props.initialPrompt ?? '')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [steps, setSteps] = useState<ToolStep[]>([])
  const [newScope, setNewScope] = useState<string | null>(props.initialCompanyId)
  const [files, setFiles] = useState<string[]>([])
  const [fileCompany, setFileCompany] = useState<string>('')
  const [dragging, setDragging] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const activeId = useRef<string | null>(null)
  activeId.current = active?.id ?? null

  // Open the latest conversation for the requested scope, or start fresh.
  useEffect(() => {
    if (!conversations || active) return
    const match = conversations.find((c) => c.companyId === props.initialCompanyId)
    if (match && !props.initialPrompt) setActive(match)
  }, [conversations, active, props.initialCompanyId, props.initialPrompt])

  useEffect(() => {
    if (active) window.azim.chat.messages(active.id).then(setMessages)
    else setMessages([])
  }, [active])

  useEffect(() => {
    return window.azim.chat.onEvent((e) => {
      if (e.conversationId !== activeId.current) return
      if (e.type === 'text') setStreaming((s) => s + e.delta)
      if (e.type === 'tool') setSteps((s) => [...s, e.step])
    })
  }, [])

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, streaming, steps])

  const scopeId = active ? active.companyId : newScope
  const addFiles = (paths: string[]): void => setFiles((f) => [...new Set([...f, ...paths.filter(Boolean)])])

  const send = async (text: string): Promise<void> => {
    if ((!text.trim() && !files.length) || busy) return
    const attached = files
    const target = scopeId ?? (fileCompany || props.companies[0]?.id || null)
    if (attached.length && !target) {
      alert(t.chatNeedsCompany)
      return
    }
    let conv = active
    if (!conv) {
      conv = await window.azim.chat.create(newScope)
      setActive(conv)
      activeId.current = conv.id
    }
    setInput('')
    setFiles([])
    setBusy(true)
    setStreaming('')
    setSteps([])
    setMessages((m) => [
      ...m,
      {
        id: 'pending',
        conversationId: conv!.id,
        role: 'user',
        content: text,
        provider: null,
        model: null,
        toolSteps: [],
        attachments: attached.map((p) => ({ type: 'document' as const, id: p, name: baseName(p) })),
        createdAt: new Date().toISOString()
      }
    ])
    try {
      await window.azim.chat.send(conv.id, text, attached, target)
    } finally {
      setMessages(await window.azim.chat.messages(conv.id))
      setStreaming('')
      setSteps([])
      setBusy(false)
      reloadConversations()
    }
  }

  const scopeName = (id: string | null): string => (id ? props.companies.find((c) => c.id === id)?.name ?? '?' : t.allCompanies)

  return (
    <div className="chat">
      <div className="chat-list">
        <div className="field">
          <label>{t.scope}</label>
          <select className="input" value={newScope ?? ''} onChange={(e) => setNewScope(e.target.value || null)}>
            <option value="">{t.allCompanies}</option>
            {props.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn primary" style={{ width: '100%', marginBottom: 12 }} onClick={() => setActive(null)}>
          <Plus size={15} /> {t.newChat}
        </button>
        {(conversations ?? []).map((c) => (
          <div key={c.id} className={`chat-item ${active?.id === c.id ? 'active' : ''}`} onClick={() => setActive(c)}>
            <span title={c.title}>{c.title}</span>
            <button
              className="btn ghost sm"
              onClick={async (e) => {
                e.stopPropagation()
                await window.azim.chat.remove(c.id)
                if (active?.id === c.id) setActive(null)
                reloadConversations()
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
      <div
        className={`chat-main ${dragging ? 'dropping' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          addFiles([...e.dataTransfer.files].map((f) => window.azim.documents.pathForFile(f)))
        }}
      >
        <div className="chat-head">
          <strong>{active?.title ?? t.newChat}</strong>
          <span className="pill">{scopeName(active ? active.companyId : newScope)}</span>
        </div>
        <div className="messages">
          {messages.map((m) => (
            <Message key={m.id} m={m} />
          ))}
          {busy && (
            <div className="msg assistant">
              <div className="avatar">A</div>
              <div className="bubble">
                <Steps steps={steps} />
                {streaming ? (
                  <div className="markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="typing">{t.thinking}</div>
                )}
              </div>
            </div>
          )}
          {!messages.length && !busy && (
            <div className="empty" style={{ marginTop: '10vh' }}>
              <div className="brand-mark" style={{ margin: '0 auto 12px', width: 48, height: 48 }}>
                A
              </div>
              {t.chat}
            </div>
          )}
          <div ref={bottom} />
        </div>
        <div className="composer">
          {!messages.length && (
            <div className="suggestions">
              {[t.sug1, t.sug2, t.sug3, t.sug4].map((s) => (
                <span key={s} className="suggestion" onClick={() => send(s)}>
                  {s}
                </span>
              ))}
            </div>
          )}
          {files.length > 0 && (
            <div className="composer-files">
              {files.map((f) => (
                <span key={f} className="file-chip" title={f}>
                  <FileIcon size={12} /> {baseName(f)}
                  <button className="btn ghost sm" onClick={() => setFiles(files.filter((x) => x !== f))}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              {!scopeId && props.companies.length > 0 && (
                <select className="input sm" value={fileCompany || props.companies[0].id} onChange={(e) => setFileCompany(e.target.value)} title={t.chatFilesCompany}>
                  {props.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t.chatFilesCompany}: {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          <div className="composer-box">
            <button className="btn ghost" title={t.attachFiles} disabled={busy} onClick={async () => addFiles(await window.azim.chat.pickFiles())}>
              <Paperclip size={15} />
            </button>
            <textarea
              onPaste={(e) => {
                const pasted = [...e.clipboardData.files].map((f) => window.azim.documents.pathForFile(f)).filter(Boolean)
                if (pasted.length) {
                  e.preventDefault()
                  addFiles(pasted)
                }
              }}
              rows={Math.min(8, Math.max(1, input.split('\n').length))}
              placeholder={t.askPlaceholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(input)
                }
              }}
            />
            {busy ? (
              <button className="btn" onClick={() => active && window.azim.chat.cancel(active.id)} title={t.stop}>
                <Square size={15} />
              </button>
            ) : (
              <button className="btn primary" onClick={() => send(input)} disabled={!input.trim() && !files.length} title={t.send}>
                <Send size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Steps({ steps }: { steps: ToolStep[] }): React.JSX.Element | null {
  if (!steps.length) return null
  return (
    <div className="tool-steps">
      {steps.map((s, i) => (
        <div key={i} className={`tool-step ${s.ok ? '' : 'fail'}`}>
          {s.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          {STEP_LABELS[s.name] ?? <Wrench size={12} />} <code>{s.name}</code> — {s.summary}
        </div>
      ))}
    </div>
  )
}

function Message({ m }: { m: ChatMessage }): React.JSX.Element {
  return (
    <div className={`msg ${m.role}`}>
      <div className="avatar">{m.role === 'user' ? 'أ' : 'A'}</div>
      <div className="bubble">
        {m.role === 'assistant' && <Steps steps={m.toolSteps} />}
        {m.role === 'assistant' ? (
          <div className="markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
          </div>
        ) : (
          visibleText(m.content)
        )}
        {m.role === 'user' && m.attachments.some((a) => a.type === 'document') && (
          <div className="msg-files">
            {m.attachments
              .filter((a) => a.type === 'document')
              .map((a) => (
                <span key={a.id} className="file-chip" onClick={() => m.id !== 'pending' && window.azim.documents.open(a.id)}>
                  <FileIcon size={12} /> {a.name}
                </span>
              ))}
          </div>
        )}
        {m.attachments
          .filter((a) => a.type === 'chart' || a.type === 'table')
          .map((a) =>
            a.type === 'chart' && a.chart ? (
              <ChatChart key={a.id} spec={a.chart} />
            ) : a.table ? (
              <ChatTable key={a.id} title={a.name} columns={a.table.columns} rows={a.table.rows} />
            ) : null
          )}
        {m.attachments.some((a) => a.type === 'report') && (
          <div className="attachments">
            {m.attachments.filter((a) => a.type === 'report').map((a) => {
              const ext = (a.path?.split('.').pop() ?? 'pdf') as keyof typeof ICONS
              const Icon = ICONS[ext] ?? FileText
              return (
                <div key={a.id} className="attachment" onClick={() => a.path && window.azim.reports.open(a.path)}>
                  <Icon size={18} color="var(--accent)" />
                  <div>
                    <div>{a.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{ext.toUpperCase()}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {m.model && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{m.model}</div>}
      </div>
    </div>
  )
}
