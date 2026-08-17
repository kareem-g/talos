import { createContext, useContext, type ComponentProps } from 'react'
import type {
  DataMessagePartProps,
  ReasoningMessagePartProps,
  TextMessagePartProps,
  ToolCallMessagePartProps,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import type { MobileApproval } from '../../types/mobile'
import ThinkingState from '../beautiful/ThinkingState'
import type { ApprovalOption } from '../beautiful/ApprovalCard'
import ToolChips from '../beautiful/ToolChips'
import ApprovalCard from '../beautiful/ApprovalCard'
import CodeBlock from '../beautiful/CodeBlock'
import DiffTable, { type DiffLine } from '../beautiful/DiffTable'

interface TaskInteractionHandlers {
  onQuestionAnswer: (answer: {
    question_id: string
    session_id: string
    selected_options: string[]
    custom_text: string | null
  }) => void
  onResolveApproval: (approval: MobileApproval, decision: string) => void
}

export const TaskInteractionContext = createContext<TaskInteractionHandlers | null>(null)

/**
 * assistant-ui part renderers for the task conversation. The event adapter
 * supplies normalized data, while these components render message parts
 * directly inside the assistant-ui thread. The text part lifts fenced code
 * blocks into the beautiful CodeBlock and lets the rest of the markdown flow
 * through with ChatGPT-style typography (see `.aui-markdown` in index.css).
 */

/** Inline ``code`` chips (non-fenced code is handled by react-markdown). */
function InlineCode(props: ComponentProps<'code'>) {
  return (
    <code
      {...props}
      className={`${props.className || ''} rounded-md border border-line bg-field px-1.5 py-0.5 font-mono text-[0.9em] text-ink`}
    />
  )
}

export function TaskTextPart({ status }: TextMessagePartProps) {
  const running = status?.type === 'running'
  return (
    <div className="min-w-0 text-[13.5px] leading-6 text-ink">
      <MarkdownTextPrimitive
        smooth
        defer
        remarkPlugins={[]}
        className="aui-markdown break-words"
        components={{
          code: InlineCode,
          CodeHeader: () => null,
          SyntaxHighlighter: ({ language, code }) => (
            <CodeBlock language={language === 'unknown' ? undefined : language} code={code} streaming={running} />
          ),
        }}
      />
      {running && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent align-text-bottom" aria-label="Generating" />}
    </div>
  )
}

export function TaskReasoningPart({ text, status }: ReasoningMessagePartProps) {
  const running = status?.type === 'running'
  const rows = (text || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph, index) => ({ primary: paragraph, mono: false, id: String(index) }))
  return (
    <ThinkingState
      variant="Reasoning"
      active="Thinking"
      done="Thought"
      working={running}
      rows={rows}
    />
  )
}

function resultDetail(part: ToolCallMessagePartProps) {
  const result = part.result as { success?: boolean; output?: unknown; exit_code?: number; duration?: string } | undefined
  if (result === undefined) return undefined
  const output = result.output
  let text: string
  if (typeof output === 'string') text = output
  else if (output === undefined) text = part.isError ? 'Tool failed' : 'Tool completed'
  else text = JSON.stringify(output)
  if (text.length > 200) text = `${text.slice(0, 200)}…`
  return result.duration ? `${text}\n${result.duration}` : text
}

export function TaskToolCallPart(props: ToolCallMessagePartProps) {
  const { toolName, args, status, isError } = props
  const isCommand = toolName === 'bash' || toolName === 'shell'
  const argsRecord = args as Record<string, unknown> | undefined
  const chip = isCommand
    ? String(argsRecord?.command || '')
    : Object.keys(argsRecord || {}).length > 0
      ? Object.entries(argsRecord || {})
          .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
          .join(', ')
      : undefined
  const running = status?.type === 'running'
  const detailText = resultDetail(props)
  const detail = detailText
    ? detailText.split('\n').map((line) => ({ text: line, tone: undefined }))
    : undefined
  const rows = [{
    id: props.toolCallId || toolName,
    icon: isCommand ? 'run' : 'tool',
    label: isCommand ? (running ? 'Running command' : isError ? 'Command failed' : toolName) : (running ? 'Running' : isError ? 'Failed' : toolName),
    chip,
    detail,
    detailMono: true,
    running,
    failed: isError,
  }]
  return <ToolChips rows={rows} defaultOpen={false} />
}

export function TaskEmptyPart() {
  return null
}

/* ── data parts ─────────────────────────────────────────── */

function approvalOption(value: string): ApprovalOption {
  const labels: Record<string, string> = { allow: 'Allow', always: 'Always allow', deny: 'Deny', yes: 'Yes', no: 'No' }
  return { id: value, label: labels[value.toLowerCase()] || value }
}

export function TaskApprovalDataPart({ data }: DataMessagePartProps) {
  const interactions = useContext(TaskInteractionContext)
  const payload = data as { approval?: MobileApproval; pending?: boolean; decision?: string | null }
  const approval = payload.approval
  if (!approval) return null
  const pending = Boolean(payload.pending) && Boolean(interactions)
  return (
    <ApprovalCard
      question={{ title: approval.prompt || 'Permission requested', type: 'radio', options: approval.options.map(approvalOption), submitLabel: 'Send decision' }}
      onSubmit={(selected) => {
        if (selected[0] && interactions) interactions.onResolveApproval(approval, selected[0])
      }}
      answered={!pending}
      answeredSelection={payload.decision ? [payload.decision] : []}
      disabled={!pending}
    />
  )
}

export function TaskQuestionDataPart({ data }: DataMessagePartProps) {
  const interactions = useContext(TaskInteractionContext)
  const payload = data as { question?: { question_id: string; session_id: string; title: string; question: string; options: Array<{ id: string; label: string; description?: string; allows_custom_text: boolean }>; selection_mode: string; selected_options: string[]; custom_text?: string }; pending?: boolean; answered?: boolean }
  const question = payload.question
  if (!question) return null
  const pending = Boolean(payload.pending) && Boolean(interactions)
  const answer = (selected_options: string[], custom_text: string | null = null) => {
    if (!interactions) return
    interactions.onQuestionAnswer({
      question_id: question.question_id,
      session_id: question.session_id,
      selected_options,
      custom_text,
    })
  }
  return (
    <ApprovalCard
      question={{
        title: question.title,
        type: question.selection_mode === 'multiple' ? 'check' : 'radio',
        options: question.options.map((option) => ({ id: option.id, label: option.label, description: option.description, allowsCustom: option.allows_custom_text })),
        allowsCustom: question.options.some((option) => option.allows_custom_text),
      }}
      onSubmit={(selected, customText) => answer(selected, customText)}
      answered={!pending}
      answeredSelection={question.selected_options}
      answeredCustom={question.custom_text}
      disabled={!pending}
    />
  )
}

function parseDiffLines(payload: { diff?: string }): DiffLine[] {
  const source = payload.diff
  if (!source) return []
  return source
    .split('\n')
    .filter((line) => /^[+-]/.test(line))
    .map((line) => ({ type: line.startsWith('+') ? 'add' : 'remove', text: line.slice(1) }))
}

export function TaskDiffDataPart({ data }: DataMessagePartProps) {
  const payload = data as { path: string; additions?: number; deletions?: number; success?: boolean; diff?: string }
  const title = payload.path || 'file'
  const lines = parseDiffLines(payload)
  return (
    <DiffTable
      title={title}
      lines={lines}
      additions={payload.additions}
      deletions={payload.deletions}
    />
  )
}

export function TaskPlanDataPart({ data }: DataMessagePartProps) {
  const payload = data as { title?: string; steps?: string[] }
  const steps = Array.isArray(payload.steps) ? payload.steps : []
  if (steps.length === 0) {
    return (
      <ThinkingState
        variant="Steps"
        active="Planning"
        done={payload.title || 'Plan'}
        working={false}
        rows={[]}
      />
    )
  }
  return (
    <ThinkingState
      variant="Steps"
      active="Planning"
      done={payload.title || 'Plan'}
      working={false}
      rows={steps.map((step, index) => ({ primary: step, mono: false, id: String(index) }))}
    />
  )
}

export function TaskSystemDataPart({ data }: DataMessagePartProps) {
  const payload = data as { content?: string; isError?: boolean }
  const content = payload.content || ''
  if (payload.isError) {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-chip bg-red-tint px-3 py-1.5 text-[11.5px] font-medium text-red">{content}</span>
      </div>
    )
  }
  return <div className="flex justify-center py-1"><span className="rounded-chip border border-line bg-surface px-3 py-1.5 text-[11px] text-ink-3">{content}</span></div>
}

export function TaskActivityDataPart({ data }: DataMessagePartProps) {
  const payload = data as { title?: string; detail?: string; running?: boolean }
  const running = Boolean(payload.running)
  const rows = [
    { primary: payload.title || 'Agent activity', secondary: payload.detail, mono: false, id: 'activity' },
  ]
  return (
    <ThinkingState
      variant="Steps"
      active="Working"
      done="Activity"
      working={running}
      rows={rows}
    />
  )
}

export function TaskDataFallback({ name }: DataMessagePartProps) {
  return (
    <div className="flex justify-center py-1">
      <span className="rounded-chip border border-line bg-surface px-3 py-1.5 text-[11px] text-ink-3">{name}</span>
    </div>
  )
}
