import { AlertCircle, ShieldAlert } from 'lucide-react'
import type { ChatItem } from '../../lib/chatItems'
import type { MobileApproval, MobileQuestion } from '../../types/mobile'
import StreamingText from '../beautiful/StreamingText'
import ThinkingState from '../beautiful/ThinkingState'
import ToolChips, { type ToolChipRow } from '../beautiful/ToolChips'
import ApprovalCard from '../beautiful/ApprovalCard'
import DiffTable, { type DiffLine } from '../beautiful/DiffTable'
import CodeBlock from '../beautiful/CodeBlock'

/**
 * Shared semantic chat blocks (Beautiful UI collection).
 *
 * Both the desktop ChatView and the mobile task screen render their
 * timelines through these components, so a thinking event, tool run,
 * diff, approval or question looks and behaves identically on every
 * surface. Raw terminal output never passes through here — it stays
 * behind the opt-in debug views.
 */

export type ChatBlock = { kind: 'item'; item: ChatItem } | { kind: 'tools'; items: ChatItem[] }

/** Consecutive tool/file/plan activities collapse into one ToolChips run. */
export function groupBlocks(items: ChatItem[]): ChatBlock[] {
  const blocks: ChatBlock[] = []
  let run: ChatItem[] = []
  const flush = () => {
    if (run.length) {
      blocks.push({ kind: 'tools', items: run })
      run = []
    }
  }
  for (const item of items) {
    if (item.kind === 'activity' || item.kind === 'plan') {
      run.push(item)
      continue
    }
    if (item.kind === 'diff' && parseDiffLines(item).length === 0) {
      run.push(item)
      continue
    }
    flush()
    blocks.push({ kind: 'item', item })
  }
  flush()
  return blocks
}

export function ChatItemBlock({
  item,
  streaming,
  working,
  isLast,
  pendingApprovals,
  resolvedApprovals,
}: {
  item: ChatItem
  streaming: boolean
  working: boolean
  isLast: boolean
  pendingApprovals: MobileApproval[]
  resolvedApprovals: Map<string, string> | Set<string>
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-card rounded-br-[6px] bg-hover px-3.5 py-2.5 shadow-hairline">
            <p className="whitespace-pre-wrap break-words text-[13.5px] leading-6 text-ink">{item.content}</p>
            {item.timestamp && <p className="mt-1 text-right text-[10px] text-ink-3">{time(item.timestamp)}</p>}
          </div>
        </div>
      )
    case 'agent':
      return (
        <div className="min-w-0 max-w-full">
          <RichText content={item.content} streaming={streaming} />
        </div>
      )
    case 'thinking':
      return <ThinkingBlock item={item} working={working && isLast} />
    case 'diff': {
      const lines = parseDiffLines(item)
      const filename = item.title?.replace(/^Edited\s+/, '') || 'changes'
      const counts = parseDiffCounts(item.detail)
      return (
        <DiffTable
          title={filename}
          lines={lines}
          additions={counts.add}
          deletions={counts.del}
        />
      )
    }
    case 'approval': {
      const approval = item.approval
      if (!approval) return null
      const pending = pendingApprovals.some((candidate) => candidate.id === approval.id)
      if (pending) return null // rendered once in the action zone
      const decision = resolvedApprovals instanceof Map ? resolvedApprovals.get(approval.id) : undefined
      return (
        <ApprovalCard
          question={{ title: approval.prompt, type: 'radio', options: approval.options }}
          onSubmit={() => {}}
          answered
          answeredSelection={decision ? [decision] : []}
          disabled
        />
      )
    }
    case 'question': {
      const question = item.question
      if (!question) return null
      if (question.status === 'pending') return null // rendered in the action zone
      if (question.status === 'cancelled' || question.status === 'expired' || question.status === 'failed') {
        return <SystemPill text={`${question.title || 'Question'} ${question.status}.`} />
      }
      return <QuestionBlock question={question} onAnswer={() => {}} />
    }
    case 'system': {
      const isError = /error/i.test(item.content) || item.id.includes('error')
      return isError ? (
        <div className="flex justify-center py-1">
          <span className="flex items-center gap-2 rounded-chip bg-red-tint px-3 py-1.5 text-[11.5px] font-medium text-red">
            <AlertCircle className="h-3 w-3" /> {item.content}
          </span>
        </div>
      ) : (
        <SystemPill text={item.content} />
      )
    }
    default:
      return null
  }
}

export function SystemPill({ text }: { text: string }) {
  return (
    <div className="flex justify-center py-1">
      <span className="flex items-center gap-2 rounded-chip border border-line bg-surface px-3 py-1.5 text-[11.5px] text-ink-3 shadow-hairline">
        <ShieldAlert className="h-3 w-3 text-orange" /> {text}
      </span>
    </div>
  )
}

/** Assistant text with fenced code blocks lifted into CodeBlocks. */
export function RichText({ content, streaming }: { content: string; streaming: boolean }) {
  const parts = content.split(/```/)
  const lastTextIndex = parts.reduce((last, part, index) => (index % 2 === 0 && part.trim() ? index : last), -1)
  return (
    <div className="flex flex-col gap-2.5">
      {parts.map((part, index) => {
        if (index % 2 === 1) {
          const lines = part.split('\n')
          const head = lines[0]?.trim() || ''
          const looksLikePath = head.includes('.') && !head.includes(' ')
          const code = lines.slice(1).join('\n')
          return (
            <CodeBlock
              key={index}
              filename={looksLikePath ? head : undefined}
              language={looksLikePath ? undefined : head || undefined}
              code={code}
              streaming={streaming && index === parts.length - 1}
            />
          )
        }
        if (!part.trim()) return null
        return (
          <StreamingText
            key={index}
            text={part.trim()}
            streaming={streaming && index === lastTextIndex}
          />
        )
      })}
    </div>
  )
}

export function ThinkingBlock({ item, working }: { item: ChatItem; working: boolean }) {
  const title = item.title || 'Thinking'
  const rows = item.detail ? [{ primary: item.detail }] : []
  if (title.startsWith('Explore')) {
    const query = title.split('·').slice(1).join('·').trim() || undefined
    return (
      <ThinkingState
        variant="Search"
        query={query}
        active="Exploring"
        done={title}
        working={working}
        rows={rows}
      />
    )
  }
  const isThinking = title === 'Thinking'
  return (
    <ThinkingState
      variant="Steps"
      active={isThinking ? 'Thinking' : title}
      done={isThinking ? undefined : title}
      working={isThinking ? working : false}
      rows={rows}
    />
  )
}

/** Collapsed run of tool/file activities rendered as ToolChips. */
export function ToolRun({ items, working, lastItemId }: { items: ChatItem[]; working: boolean; lastItemId?: string }) {
  const rows: ToolChipRow[] = items.map((item) => toChipRow(item, working && item.id === lastItemId))
  const diffs = items
    .filter((item) => item.kind === 'diff')
    .map((item) => {
      const counts = parseDiffCounts(item.detail)
      return { file: item.title?.replace(/^Edited\s+/, '') || 'file', add: counts.add, del: counts.del }
    })
  return <ToolChips rows={rows} diffs={diffs} defaultOpen={items.some((item) => item.id === lastItemId && working)} />
}

export function toChipRow(item: ChatItem, running: boolean): ToolChipRow {
  const title = item.title || 'Agent activity'
  const parts = title.split(' · ').map((part) => part.trim()).filter(Boolean)
  const failed = /^Failed/.test(title)
  const head = parts[0] || title
  const rest = parts.slice(1).join(' · ')
  const icon = head.startsWith('$') ? 'run' : /^Edited/.test(head) ? 'write' : /Search|Explore/.test(head) ? 'search' : 'tool'
  const label = head.startsWith('$') ? 'Command' : head
  const chip = head.startsWith('$') ? head.slice(1).trim() : rest || undefined
  const detail = item.detail
    ? [{ text: item.detail.length > 160 ? `${item.detail.slice(0, 160)}…` : item.detail }]
    : undefined
  return {
    id: item.id,
    icon,
    label,
    chip,
    mono: Boolean(head.startsWith('$') || /^Edited/.test(head)),
    detail,
    detailMono: true,
    running: running && !/Completed|Failed/.test(head),
    failed,
  }
}

export function ApprovalBlock({ approval, onResolve }: { approval: MobileApproval; onResolve: (decision: string) => void }) {
  return (
    <div style={{ animation: 'fade-up 320ms cubic-bezier(0.23,1,0.32,1) both' }}>
      <ApprovalCard
        question={{ title: approval.prompt, type: 'radio', options: approval.options }}
        onSubmit={(selected) => {
          if (selected[0]) onResolve(selected[0])
        }}
      />
    </div>
  )
}

export function QuestionBlock({ question, onAnswer }: { question: MobileQuestion; onAnswer: (answer: { question_id: string; session_id: string; selected_options: string[]; custom_text: string | null }) => boolean | void }) {
  const answered = question.status === 'answered'
  const labelToId = new Map(question.options.map((option) => [option.label, option.id]))
  const customOption = question.options.find((option) => option.allows_custom_text)
  if (question.options.length === 0) {
    // Free-text question: the composer below is the answer path.
    return (
      <div className="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <p className="text-[13px] font-medium text-ink">{question.title || 'Question'}</p>
        {question.question && <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-5 text-ink-2">{question.question}</p>}
        {!answered && <p className="mt-2 text-[11px] text-ink-3">Answer in the message box below.</p>}
      </div>
    )
  }
  return (
    <div style={{ animation: 'fade-up 320ms cubic-bezier(0.23,1,0.32,1) both' }}>
      <ApprovalCard
        question={{
          title: question.question || question.title,
          type: question.selection_mode === 'multiple' ? 'check' : 'radio',
          options: question.options.map((option) => option.label),
          allowsCustom: Boolean(customOption),
        }}
        onSubmit={(selected, customText) => {
          const ids = selected.map((label) => labelToId.get(label)).filter((id): id is string => Boolean(id))
          if (customText && customOption && !ids.includes(customOption.id)) ids.push(customOption.id)
          onAnswer({
            question_id: question.question_id,
            session_id: question.session_id,
            selected_options: ids,
            custom_text: customText,
          })
        }}
        answered={answered}
        answeredSelection={(question.selected_options || [])
          .map((id) => question.options.find((option) => option.id === id)?.label || id)}
        answeredCustom={question.custom_text}
        disabled={answered}
      />
    </div>
  )
}

/* ── helpers ─────────────────────────────────────────────── */

/** Best-effort diff parse from a diff item's title + detail (mirrors the mobile app). */
export function parseDiffLines(item: ChatItem): DiffLine[] {
  const source = item.detail && item.detail.length > (item.title?.length ?? 0) ? item.detail : item.title
  if (!source) return []
  return source
    .split('\n')
    .filter((line) => /^[+-]/.test(line))
    .map((line) => ({ type: line.startsWith('+') ? 'add' : 'remove', text: line.slice(1) }))
}

export function parseDiffCounts(detail?: string): { add: number; del: number } {
  const add = detail?.match(/\+(\d+)/)
  const del = detail?.match(/-(\d+)/)
  return { add: add ? Number(add[1]) : 0, del: del ? Number(del[1]) : 0 }
}

export function time(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
