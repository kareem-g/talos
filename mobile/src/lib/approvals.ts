/**
 * Approval humanizer.
 *
 * Permission prompts arrive in whatever shape the agent uses. Claude Code sends
 * its raw tool input — sometimes a plain string, often JSON like
 * `{"command":"git init"}` or an AskUserQuestion envelope with the real
 * question and answer choices buried inside. Rendering that JSON verbatim made
 * the most important card in the product unreadable.
 *
 * This module extracts what a human needs: the question, an optional mono
 * context line (the command or file), and labeled options. It never invents
 * choices — anything it cannot parse falls through to the raw text.
 */

import type { ApprovalOptionData } from '@/types/conversation'

/** One answer choice on an approval card. */
export interface ApprovalOption {
  /** Value sent back to the agent verbatim. */
  value: string
  label: string
  description?: string
  kind: 'allow' | 'deny' | 'other'
  /** `true` when this choice also permits free-text input. */
  allowsCustomText?: boolean
}

/** Structured metadata the agent supplied alongside the prompt. */
export interface ApprovalStructuredInput {
  optionData?: ApprovalOptionData[]
  multiSelect?: boolean
  allowsCustomText?: boolean
}

export interface ApprovalView {
  /** The question, in the agent's own words where parseable. */
  question: string
  /** Mono context line — the command, path, or URL the prompt is about. */
  context?: string
  /** Section header for questionnaire style (e.g., "File content") */
  header?: string
  /** Whether multiple options can be selected */
  multiSelect?: boolean
  options: ApprovalOption[]
  /** True when the agent invites free-form custom input for this prompt. */
  allowsCustomText?: boolean
  /** True when the input was too opaque to summarize; show raw text. */
  raw: boolean
}

const ALLOW_RE = /^(allow|approve|yes|ok|proceed|continue|accept|permit|grant)\b/i
const DENY_RE = /^(deny|reject|no\b|cancel|stop|block|refuse)\b/i

function kindFor(value: string): 'allow' | 'deny' | 'other' {
  if (ALLOW_RE.test(value.trim())) return 'allow'
  if (DENY_RE.test(value.trim())) return 'deny'
  return 'other'
}

/** Keys whose value makes a good mono context line, in priority order. */
const CONTEXT_KEYS = ['command', 'file_path', 'path', 'notebook_path', 'url', 'query', 'pattern', 'q']

/** Keys whose string value reads as the question itself. */
const QUESTION_KEYS = ['question', 'prompt', 'description', 'reason', 'message']

function contextFromRecord(record: Record<string, unknown>): string | undefined {
  for (const key of CONTEXT_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function questionFromRecord(record: Record<string, unknown>): string | undefined {
  for (const key of QUESTION_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

/** Parse an AskUserQuestion-style envelope: questions[].{question,header,multiSelect,options[]}. */
function fromAskUserQuestion(parsed: unknown): ApprovalView | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined
  const questions = (parsed as Record<string, unknown>)['questions']
  if (!Array.isArray(questions) || questions.length === 0) return undefined
  const first = questions[0]
  if (!first || typeof first !== 'object') return undefined
  const record = first as Record<string, unknown>
  const question = questionFromRecord(record) ?? (typeof record['header'] === 'string' ? record['header'] : undefined)
  if (!question) return undefined

  const header = typeof record['header'] === 'string' ? record['header'].trim() : undefined
  const multiSelect = typeof record['multiSelect'] === 'boolean' ? (record['multiSelect'] as boolean) : undefined

  const options: ApprovalOption[] = []
  const rawOptions = record['options']
  if (Array.isArray(rawOptions)) {
    for (const entry of rawOptions) {
      if (entry && typeof entry === 'object') {
        const label = (entry as Record<string, unknown>)['label']
        const description = (entry as Record<string, unknown>)['description']
        if (typeof label === 'string' && label.trim()) {
          options.push({
            value: label,
            label: label.trim(),
            description: typeof description === 'string' ? description.trim() : undefined,
            kind: kindFor(label),
          })
        }
      } else if (typeof entry === 'string' && entry.trim()) {
        options.push({ value: entry, label: entry.trim(), kind: kindFor(entry) })
      }
    }
  }
  const context = contextFromRecord(record) ?? undefined
  // If header exists and is different from question, keep it separate; otherwise use context
  const finalHeader = header && header !== question ? header : undefined
  return { question, context, header: finalHeader, multiSelect, options, raw: false }
}

/** Try JSON.parse; returns undefined on anything that is not an object/array. */
function tryParse(prompt: string): unknown {
  const trimmed = prompt.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // fall through to substring extraction
    }
  }
  // Claude Code prefixes the JSON with the tool name, e.g.
  // `AskUserQuestion {"questions":[...]}` — extract the first JSON object.
  const brace = trimmed.indexOf('{')
  const bracket = trimmed.indexOf('[')
  let start = -1
  if (brace !== -1 && bracket !== -1) start = Math.min(brace, bracket)
  else if (brace !== -1) start = brace
  else if (bracket !== -1) start = bracket
  else return undefined
  try {
    return JSON.parse(trimmed.slice(start))
  } catch {
    return undefined
  }
}

/** Regex fallback for prompts truncated at storage time — valid JSON never arrives. */
function fromTruncatedAskUserQuestion(prompt: string): ApprovalView | undefined {
  // Look for the envelope markers even in broken JSON.
  if (!/AskUserQuestion/i.test(prompt)) return undefined
  const headerMatch = prompt.match(/"header"\s*:\s*"([^"]+)"/)
  const questionMatch = prompt.match(/"question"\s*:\s*"([^"]+)"/)
  const question = questionMatch?.[1] ?? headerMatch?.[1]
  if (!question) return undefined
  const header = headerMatch?.[1] && headerMatch[1] !== question ? headerMatch[1] : undefined
  const multiSelect = /"multiSelect"\s*:\s*true/.test(prompt) ? true : /"multiSelect"\s*:\s*false/.test(prompt) ? false : undefined
  const options: ApprovalOption[] = []
  // Try to capture label + description pairs
  const optionRegex = /"label"\s*:\s*"([^"]+)"(?:\s*,\s*"description"\s*:\s*"([^"]+)")?/g
  let m: RegExpExecArray | null
  while ((m = optionRegex.exec(prompt)) !== null) {
    const label = m[1]
    const description = m[2]
    if (label) options.push({ value: label, label, description, kind: kindFor(label) })
  }
  // Fallback to just labels if the above didn't capture
  if (options.length === 0) {
    const labelRegex = /"label"\s*:\s*"([^"]+)"/g
    while ((m = labelRegex.exec(prompt)) !== null) {
      const label = m[1]
      if (label) options.push({ value: label, label, kind: kindFor(label) })
    }
  }
  return { question, header, multiSelect, options, raw: false }
}

/**
 * Build the render model for an approval card.
 *
 * `fallbackOptions` are the choices the transport reported (often
 * `["allow","deny"]`); parsed envelopes may contribute richer labels, in which
 * case the fallback is only used when the envelope has none.
 *
 * `structured` carries metadata the agent supplied directly on the prompt
 * event (`option_data`, `multi_select`, `allows_custom_text`). It takes
 * precedence over the parsed envelope and the transport fallback, because it is
 * the agent's own description of the choices — but it is optional, and when
 * absent the existing parsing paths still run.
 */
export function describeApproval(
  prompt: string,
  fallbackOptions: string[] = [],
  structured?: ApprovalStructuredInput,
): ApprovalView {
  const parsed = tryParse(prompt)

  const fromEnvelope = fromAskUserQuestion(parsed)
  if (fromEnvelope) {
    if (fromEnvelope.options.length === 0 && fallbackOptions.length > 0) {
      fromEnvelope.options = fallbackOptions.map((value) => ({ value, label: value, kind: kindFor(value) }))
    }
    return mergeStructured(fromEnvelope, structured)
  }

  const truncated = fromTruncatedAskUserQuestion(prompt)
  if (truncated) {
    if (truncated.options.length === 0 && fallbackOptions.length > 0) {
      truncated.options = fallbackOptions.map((value) => ({ value, label: value, kind: kindFor(value) }))
    } else if (truncated.options.length > 0 && fallbackOptions.length > 0) {
      // A truncated payload may have lost the final option's closing quote — add
      // the transport fallback for any missing kind (e.g. a missing "No"), but
      // don't duplicate an allow/deny that already has a richer label.
      const haveKind = new Set(truncated.options.map((o) => o.kind))
      for (const value of fallbackOptions) {
        const kind = kindFor(value)
        if (kind !== 'other' && haveKind.has(kind)) continue
        const haveLabel = truncated.options.some((o) => o.label.toLowerCase() === value.toLowerCase())
        if (!haveLabel) truncated.options.push({ value, label: value, kind })
      }
    }
    return mergeStructured(truncated, structured)
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>
    const context = contextFromRecord(record)
    const question = questionFromRecord(record)
    if (context || question) {
      // Preserve the tool prefix for prompts like `Write {"file_path":...}`.
      let prettyQuestion = question
      if (!prettyQuestion) {
        const m = prompt.trim().match(/^([A-Za-z][A-Za-z0-9_-]*)\s*[{[]/)
        const tool = m?.[1]
        if (tool && context) {
          const base = context.split('/').pop() ?? context
          prettyQuestion = `${tool} ${base}`
        } else {
          prettyQuestion = 'The agent needs permission to continue.'
        }
      }
      return mergeStructured(
        {
          question: prettyQuestion,
          context,
          options: fallbackOptions.map((value) => ({ value, label: value, kind: kindFor(value) })),
          raw: false,
        },
        structured,
      )
    }
  }

  return mergeStructured(
    {
      question: prompt,
      options: fallbackOptions.map((value) => ({ value, label: value, kind: kindFor(value) })),
      raw: true,
    },
    structured,
  )
}

/**
 * Merge agent-supplied structured metadata onto a parsed view. Structured
 * `option_data` replaces the option list wholesale (it is the agent's own
 * authoritative description); selection mode and custom-input flags are lifted
 * to the view when present. Anything missing in `structured` leaves the parsed
 * view untouched.
 */
function mergeStructured(view: ApprovalView, structured?: ApprovalStructuredInput): ApprovalView {
  const optionData = structured?.optionData
  const options =
    optionData && optionData.length > 0
      ? optionData.map((option) => ({
          value: option.value,
          label: option.label ?? option.value,
          description: option.description,
          kind: kindFor(option.value),
          allowsCustomText: option.allowsCustomText,
        }))
      : view.options
  // Coerce to booleans so callers always get true/false, never undefined.
  const multiSelect = structured?.multiSelect === true
  const allowsCustomText = structured?.allowsCustomText === true
  return {
    ...view,
    options,
    multiSelect,
    allowsCustomText,
  }
}

/**
 * Human summary of a resolved decision, for the collapsed card.
 * `allow`/`deny`-shaped decisions get verbs; anything else shows verbatim.
 */
export function decisionLabel(decision: string): string {
  const kind = kindFor(decision)
  if (kind === 'allow') return 'Allowed'
  if (kind === 'deny') return 'Denied'
  return `Responded ${decision}`
}
