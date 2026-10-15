// One agent loop per provider. Each speaks its provider's native message
// format; the rest of the app only sees AgentRequest / AgentResult.
//
// How models are connected:
//  - anthropic   Claude through the official SDK (API key)
//  - openai      OpenAI through the official SDK (API key, optional base URL)
//  - gemini      Google Gemini through @google/genai (API key)
//  - ollama      a local model (Ollama / LM Studio) through its OpenAI-compatible API
//  - compatible  any OpenAI-compatible service: OpenRouter, DeepSeek, Groq, vLLM...
// If the active provider fails and fallback is on, the next enabled provider
// answers instead, so the agent keeps working when one service is down.
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenAI, type Content, type Part } from '@google/genai'
import { getApiKey, getSettings } from '../settings'
import type { ProviderId, ToolStep } from '@shared/types'

export interface ToolDef {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

export interface ToolOutcome {
  content: string
  ok: boolean
  summary: string
}

export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
  provider: ProviderId | null
  model: string | null
  native: unknown[] | null
}

export interface AgentRequest {
  system: string
  history: HistoryTurn[]
  user: string
  tools: ToolDef[]
  exec: (name: string, input: Record<string, unknown>) => Promise<ToolOutcome>
  onText?: (delta: string) => void
  onTool?: (step: ToolStep) => void
  signal?: AbortSignal
  maxSteps?: number
  /** Background work (filing, scheduled tasks) uses each provider's fast model. */
  fast?: boolean
  /** Allow Claude's server-side web search for this request. */
  webSearch?: boolean
}

export interface AgentResult {
  text: string
  provider: ProviderId
  model: string
  native: unknown[] | null // provider-native messages produced in this turn
}

export class AiNotConfiguredError extends Error {}

// Claude client. An organization-level key (not scoped to a workspace) must
// name the workspace to bill in the anthropic-workspace-id header.
function claudeClient(): Anthropic {
  const workspaceId = getSettings().providers.anthropic.workspaceId?.trim()
  return new Anthropic({ apiKey: getApiKey('anthropic'), defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined })
}

/** Turn known provider errors into a message that says how to fix them. */
export function explainAiError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e)
  if (/not scoped to a workspace|anthropic-workspace-id/i.test(msg)) {
    return 'مفتاح Claude ده متعمل على مستوى المنظمة مش جوه workspace. الحل: اعمل مفتاح جديد من جوه workspace في Console (Settings ← Workspaces ← اختار workspace ← API Keys)، أو حط الـ Workspace ID في الإعدادات ← Claude. | This Claude API key is not scoped to a workspace: create a key inside a workspace in the Console, or enter the Workspace ID in Settings → Claude.'
  }
  if (/credit balance is too low|insufficient.*credit/i.test(msg)) {
    return 'رصيد حساب Claude API خلص. اشحن من Console ← Billing، أو اربط رصيد اشتراك Max. | Your Claude API credit balance is too low: add credits in Console → Billing.'
  }
  if (/invalid x-api-key|authentication_error|invalid api key/i.test(msg)) {
    return 'مفتاح الـ API غلط أو اتلغى. اعمل مفتاح جديد وحطه في الإعدادات. | The API key is invalid or revoked: create a new key and save it in Settings.'
  }
  return msg
}

const ORDER: ProviderId[] = ['anthropic', 'openai', 'gemini', 'compatible', 'ollama']

function usable(id: ProviderId): boolean {
  const p = getSettings().providers[id]
  if (!p.enabled || !p.model) return false
  return id === 'ollama' || !!getApiKey(id)
}

export function activeProvider(): { id: ProviderId; model: string } {
  const s = getSettings()
  const p = s.providers[s.activeProvider]
  if (!p.enabled) throw new AiNotConfiguredError(`Provider ${s.activeProvider} is disabled. Enable it in Settings.`)
  if (!usable(s.activeProvider)) throw new AiNotConfiguredError(`No API key or model set for ${s.activeProvider}. Add it in Settings.`)
  return { id: s.activeProvider, model: p.model }
}

/** The active provider first, then (with fallback on) the other usable ones. */
function candidates(): ProviderId[] {
  const s = getSettings()
  activeProvider() // throws a clear message if the active one is not set up
  if (!s.agent.fallback) return [s.activeProvider]
  return [s.activeProvider, ...ORDER.filter((id) => id !== s.activeProvider && usable(id))]
}

function modelFor(id: ProviderId, fast: boolean): string {
  const p = getSettings().providers[id]
  return (fast && p.fastModel) || p.model
}

// Errors worth retrying on another provider: network, rate limits, outages, auth.
function retryable(e: unknown): boolean {
  if ((e as Error)?.name === 'AbortError') return false
  const status = (e as { status?: number }).status
  return status === undefined || status === 401 || status === 403 || status === 408 || status === 429 || status >= 500
}

export async function runAgent(req: AgentRequest): Promise<AgentResult> {
  const list = candidates()
  let lastError: unknown
  for (const id of list) {
    try {
      return await runWith(id, modelFor(id, !!req.fast), req)
    } catch (e) {
      lastError = e
      if (!retryable(e) || req.signal?.aborted) throw e
    }
  }
  throw lastError
}

function runWith(id: ProviderId, model: string, req: AgentRequest): Promise<AgentResult> {
  const s = getSettings()
  switch (id) {
    case 'anthropic':
      return runAnthropic(req, model)
    case 'gemini':
      return runGemini(req, model)
    case 'openai':
      return runOpenAICompatible(req, 'openai', model, getApiKey('openai'), s.providers.openai.baseUrl || undefined)
    case 'compatible':
      return runOpenAICompatible(req, 'compatible', model, getApiKey('compatible'), s.providers.compatible.baseUrl)
    case 'ollama':
      return runOpenAICompatible(req, 'ollama', model, getApiKey('ollama') || 'ollama', s.providers.ollama.baseUrl || 'http://localhost:11434/v1')
  }
}

/** Single-shot completion without tools (summaries, classification). */
export async function complete(system: string, user: string, fast = true): Promise<string> {
  const res = await runAgent({ system, history: [], user, tools: [], fast, exec: async () => ({ content: '', ok: false, summary: '' }) })
  return res.text
}

/** Models the provider offers, for the model picker in Settings. */
export async function listModels(id: ProviderId): Promise<string[]> {
  const s = getSettings().providers[id]
  switch (id) {
    case 'anthropic': {
      const client = claudeClient()
      const out: string[] = []
      for await (const m of client.models.list()) out.push(m.id)
      return out
    }
    case 'gemini': {
      const ai = new GoogleGenAI({ apiKey: getApiKey('gemini') })
      const out: string[] = []
      for await (const m of await ai.models.list()) if (m.name) out.push(m.name.replace(/^models\//, ''))
      return out
    }
    default: {
      const baseURL = s.baseUrl || (id === 'ollama' ? 'http://localhost:11434/v1' : undefined)
      const client = new OpenAI({ apiKey: getApiKey(id) || 'none', baseURL })
      const out: string[] = []
      for await (const m of client.models.list()) out.push(m.id)
      return out.sort()
    }
  }
}

const MAX_STEPS = 40

function step(name: string, input: unknown, out: ToolOutcome): ToolStep {
  return { name, input, ok: out.ok, summary: out.summary }
}

async function runTool(req: AgentRequest, name: string, input: unknown): Promise<ToolOutcome> {
  let out: ToolOutcome
  try {
    out = await req.exec(name, (input ?? {}) as Record<string, unknown>)
  } catch (e) {
    out = { content: `Error: ${(e as Error).message}`, ok: false, summary: (e as Error).message }
  }
  req.onTool?.(step(name, input, out))
  return out
}

const maxSteps = (req: AgentRequest): number => req.maxSteps ?? getSettings().agent.maxSteps ?? MAX_STEPS

// ---------------- Claude (Anthropic) ----------------

async function runAnthropic(req: AgentRequest, model: string): Promise<AgentResult> {
  const client = claudeClient()
  const messages: Anthropic.Beta.BetaMessageParam[] = []
  for (const turn of req.history) {
    // Replay Claude's own turns verbatim (thinking + tool blocks) when they were
    // produced by the same model; otherwise fall back to plain text.
    if (turn.role === 'assistant' && turn.provider === 'anthropic' && turn.model === model && turn.native?.length) {
      messages.push(...(turn.native as Anthropic.Beta.BetaMessageParam[]))
    } else {
      messages.push({ role: turn.role, content: turn.content || '…' })
    }
  }
  messages.push({ role: 'user', content: req.user })
  const turnStart = messages.length
  const tools: Anthropic.Beta.BetaToolUnion[] = req.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema
  }))
  if (req.webSearch && getSettings().agent.webSearch) {
    tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 5 })
  }

  let text = ''
  for (let i = 0; i < maxSteps(req); i++) {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 64000,
        system: req.system,
        thinking: { type: 'adaptive' },
        output_config: { effort: req.fast ? 'low' : getSettings().agent.effort },
        // Route around refusals server-side instead of failing the turn.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        tools: tools.length ? tools : undefined,
        messages
      },
      { signal: req.signal }
    )
    stream.on('text', (delta) => {
      text += delta
      req.onText?.(delta)
    })
    const message = await stream.finalMessage()
    messages.push({ role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] })
    for (const block of message.content) {
      if (block.type === 'server_tool_use' && block.name === 'web_search') {
        req.onTool?.({ name: 'web_search', input: block.input, ok: true, summary: String((block.input as { query?: string }).query ?? '') })
      }
    }

    if (message.stop_reason === 'refusal') {
      text += '\n\n(The model declined this request.)'
      break
    }
    if (message.stop_reason === 'pause_turn') continue
    if (message.stop_reason !== 'tool_use') break

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const block of message.content) {
      if (block.type !== 'tool_use') continue
      const out = await runTool(req, block.name, block.input)
      results.push({ type: 'tool_result', tool_use_id: block.id, content: out.content, is_error: !out.ok })
    }
    messages.push({ role: 'user', content: results })
    text += '\n\n'
  }
  return { text: text.trim(), provider: 'anthropic', model, native: messages.slice(turnStart) }
}

// ---------------- OpenAI and OpenAI-compatible (Ollama, OpenRouter, ...) ----------------

async function runOpenAICompatible(
  req: AgentRequest,
  provider: ProviderId,
  model: string,
  apiKey: string,
  baseURL?: string
): Promise<AgentResult> {
  const client = new OpenAI({ apiKey, baseURL })
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: req.system }]
  for (const turn of req.history) messages.push({ role: turn.role, content: turn.content || '…' })
  messages.push({ role: 'user', content: req.user })
  const tools: OpenAI.Chat.ChatCompletionTool[] = req.tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema }
  }))

  let text = ''
  for (let i = 0; i < maxSteps(req); i++) {
    const res = await client.chat.completions.create({ model, messages, tools: tools.length ? tools : undefined }, { signal: req.signal })
    const msg = res.choices[0]?.message
    if (!msg) break
    if (msg.content) {
      text += msg.content
      req.onText?.(msg.content)
    }
    messages.push(msg as OpenAI.Chat.ChatCompletionMessageParam)
    const calls = (msg.tool_calls ?? []).filter((c) => c.type === 'function')
    if (!calls.length) break
    for (const call of calls) {
      let input: unknown = {}
      try {
        input = JSON.parse(call.function.arguments || '{}')
      } catch {
        input = {}
      }
      const out = await runTool(req, call.function.name, input)
      messages.push({ role: 'tool', tool_call_id: call.id, content: out.content })
    }
    text += '\n\n'
  }
  return { text: text.trim(), provider, model, native: null }
}

// ---------------- Google Gemini ----------------

async function runGemini(req: AgentRequest, model: string): Promise<AgentResult> {
  const ai = new GoogleGenAI({ apiKey: getApiKey('gemini') })
  const contents: Content[] = req.history.map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.content || '…' }]
  }))
  contents.push({ role: 'user', parts: [{ text: req.user }] })
  const functionDeclarations = req.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.input_schema
  }))

  let text = ''
  for (let i = 0; i < maxSteps(req); i++) {
    const res = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: req.system,
        tools: functionDeclarations.length ? [{ functionDeclarations }] : undefined,
        abortSignal: req.signal
      }
    })
    const content = res.candidates?.[0]?.content
    if (content) contents.push(content)
    const chunk = res.text ?? ''
    if (chunk) {
      text += chunk
      req.onText?.(chunk)
    }
    const calls = res.functionCalls ?? []
    if (!calls.length) break
    const parts: Part[] = []
    for (const call of calls) {
      const out = await runTool(req, call.name ?? '', call.args ?? {})
      parts.push({ functionResponse: { id: call.id, name: call.name, response: { result: out.content } } })
    }
    contents.push({ role: 'user', parts })
    text += '\n\n'
  }
  return { text: text.trim(), provider: 'gemini', model, native: null }
}
