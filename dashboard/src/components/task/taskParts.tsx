import { createContext, useContext } from 'react'
import type {
  DataMessagePartProps,
  ReasoningMessagePartProps,
  TextMessagePartProps,
  ToolCallMessagePartProps,
} from '@assistant-ui/react'
import type { MobileApproval } from '../../types/mobile'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'

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
 * directly inside the assistant-ui thread.
 */

export function TaskTextPart({ status }: TextMessagePartProps) {
  return (
    <div className="min-w-0 text-[13.5px] leading-6 text-ink">
      <MarkdownTextPrimitive className="aui-markdown break-words" smooth={status?.type === 'running'} defer remarkPlugins={[]} />
      {status?.type === 'running' && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent align-text-bottom" aria-label="Generating" />}
    </div>
  )
}

export function TaskReasoningPart({ text, status }: ReasoningMessagePartProps) {
  const running = status?.type === 'running'
  const label = text || 'Thinking'
  return (
    <div className="flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2 text-[11.5px] text-ink-2">
      {running && <span className="size-2 animate-pulse rounded-full bg-accent" />}
      <span>{running ? 'Thinking…' : label}</span>
    </div>
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
  return (
    <div className={`rounded-card border px-3 py-2 text-[11.5px] ${isError ? 'border-red/25 bg-red-tint text-red' : 'border-line bg-surface text-ink-2'}`}>
      <div className="flex items-center gap-2">
        {running && <span className="size-2 animate-pulse rounded-full bg-accent" />}
        <span className="font-medium text-ink">{running ? 'Running' : isError ? 'Failed' : 'Completed'} {isCommand ? 'command' : toolName}</span>
      </div>
      {chip && <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-5">{chip}</pre>}
      {resultDetail(props) && <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[10.5px] leading-5 opacity-80">{resultDetail(props)}</pre>}
    </div>
  )
}

export function TaskEmptyPart() {
  return (
    <div className="flex items-center gap-2 py-1 text-[11.5px] text-ink-3">
      <span className="size-2 animate-pulse rounded-full bg-accent" /> Generating…
    </div>
  )
}

/* ── data parts ─────────────────────────────────────────── */

export function TaskApprovalDataPart({ data }: DataMessagePartProps) {
  const interactions = useContext(TaskInteractionContext)
  const payload = data as { approval?: MobileApproval; pending?: boolean; decision?: string | null }
  const approval = payload.approval
  if (!approval) return null
  if (payload.pending && interactions) {
    return (
      <div className="rounded-card border border-orange/25 bg-orange-tint p-3">
        <p className="text-[12.5px] font-medium text-ink">Permission requested</p>
        <p className="mt-1 text-[11.5px] leading-5 text-ink-2">{approval.prompt}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {approval.options.map((option) => (
            <button key={option} type="button" onClick={() => interactions.onResolveApproval(approval, option)} className="rounded-control border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:bg-hover">
              {option}
            </button>
          ))}
        </div>
      </div>
    )
  }
  const decision = payload.decision || null
  return (
    <div className="rounded-card border border-line bg-surface px-3 py-2 text-[11.5px] text-ink-2">
      Permission {decision || 'resolved'}: {approval.prompt || 'Permission requested'}
    </div>
  )
}

export function TaskQuestionDataPart({ data }: DataMessagePartProps) {
  const interactions = useContext(TaskInteractionContext)
  const payload = data as { question?: { question_id: string; session_id: string; title: string; question: string; options: Array<{ id: string; label: string; description?: string; allows_custom_text: boolean }>; selection_mode: string; selected_options: string[]; custom_text?: string }; pending?: boolean; answered?: boolean }
  const question = payload.question
  if (!question) return null
  const answer = (selected_options: string[], custom_text: string | null = null) => interactions?.onQuestionAnswer({
    question_id: question.question_id,
    session_id: question.session_id,
    selected_options,
    custom_text,
  })
  return (
    <div className="rounded-card border border-line bg-surface p-3">
      <p className="text-[12.5px] font-medium text-ink">{question.title}</p>
      <p className="mt-1 text-[11.5px] leading-5 text-ink-2">{question.question}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {question.options.map((option) => (
          <button key={option.id} type="button" disabled={!payload.pending || !interactions} onClick={() => answer([option.id])} className="rounded-control border border-line px-3 py-1.5 text-[11px] text-ink transition-colors hover:bg-hover disabled:opacity-60">
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function TaskDiffDataPart({ data }: DataMessagePartProps) {
  const payload = data as { path: string; additions?: number; deletions?: number; success?: boolean }
  return <div className="rounded-card border border-line bg-surface px-3 py-2 text-[11.5px] text-ink-2">Edited <span className="font-mono text-ink">{payload.path || 'file'}</span>{typeof payload.additions === 'number' && ` · +${payload.additions}`}{typeof payload.deletions === 'number' && ` −${payload.deletions}`}</div>
}

export function TaskPlanDataPart({ data }: DataMessagePartProps) {
  const payload = data as { title?: string; steps?: string[] }
  const steps = Array.isArray(payload.steps) ? payload.steps : []
  return <div className="rounded-card border border-line bg-surface px-3 py-2 text-[11.5px] text-ink-2"><p className="font-medium text-ink">{payload.title || 'Plan'}</p>{steps.length > 0 && <ol className="mt-2 list-decimal space-y-1 pl-4">{steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}</div>
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
  const title = payload.title || 'Agent activity'
  return <div className="rounded-card border border-line bg-surface px-3 py-2 text-[11.5px] text-ink-2"><span className="font-medium text-ink">{payload.running ? 'Working' : 'Activity'}: </span>{title}{payload.detail && <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10.5px]">{payload.detail}</pre>}</div>
}

export function TaskDataFallback({ name }: DataMessagePartProps) {
  return (
    <div className="flex justify-center py-1">
      <span className="rounded-chip border border-line bg-surface px-3 py-1.5 text-[11px] text-ink-3">{name}</span>
    </div>
  )
}
