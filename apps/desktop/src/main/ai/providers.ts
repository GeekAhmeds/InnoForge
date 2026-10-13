// One agent loop per provider. Each speaks its provider's native message
// format; the rest of the app only sees AgentRequest / AgentResult.
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
}

export interface AgentResult {
  text: string
  provider: ProviderId
  model: string
  native: unknown[] | null // provider-native messages produced in this turn
}

export class AiNotConfiguredError extends Error {}

export function activeProvider(): { id: ProviderId; model: string } {
  const s = getSettings()
  const p = s.providers[s.activeProvider]
  if (!p.enabled) throw new AiNotConfiguredError(`Provider ${s.activeProvider} is disabled. Enable it in Settings.`)
  if (s.activeProvider !== 'ollama' && !getApiKey(s.activeProvider)) {
    throw new AiNotConfiguredError(`No API key set for ${s.activeProvider}. Add it in Settings.`)
  }
  return { id: s.activeProvider, model: p.model }
}

export async function runAgent(req: AgentRequest): Promise<AgentResult> {
  const { id, model } = activeProvider()
  switch (id) {
    case 'anthropic':
      return runAnthropic(req, model)
    case 'gemini':
      return runGemini(req, model)
    case 'openai':
      return runOpenAICompatible(req, 'openai', model, getApiKey('openai'), getSettings().providers.openai.baseUrl || undefined)
    case 'ollama':
      return runOpenAICompatible(
        req,
        'ollama',
        model,
        getApiKey('ollama') || 'ollama',
        getSettings().providers.ollama.baseUrl || 'http://localhost:11434/v1'
      )
  }
}

/** Single-shot completion without tools (used for organizing files). */
export async function complete(system: string, user: string): Promise<string> {
  const res = await runAgent({ system, history: [], user, tools: [], exec: async () => ({ content: '', ok: false, summary: '' }) })
  return res.text
}

const MAX_STEPS = 24

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

// ---------------- Claude (Anthropic) ----------------

async function runAnthropic(req: AgentRequest, model: string): Promise<AgentResult> {
  const client = new Anthropic({ apiKey: getApiKey('anthropic') })
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
  const tools: Anthropic.Beta.BetaTool[] = req.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema
  }))

  let text = ''
  for (let i = 0; i < (req.maxSteps ?? MAX_STEPS); i++) {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 64000,
        system: req.system,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
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

// ---------------- OpenAI and OpenAI-compatible (Ollama, LM Studio) ----------------

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
  for (let i = 0; i < (req.maxSteps ?? MAX_STEPS); i++) {
    const res = await client.chat.completions.create(
      { model, messages, tools: tools.length ? tools : undefined },
      { signal: req.signal }
    )
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
  for (let i = 0; i < (req.maxSteps ?? MAX_STEPS); i++) {
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
