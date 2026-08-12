import type {
  MobileAgentEvent,
  MobileAgentMessage,
  MobileApproval,
  MobileQuestion,
  MobileTaskTranscript,
} from '../types/mobile'
import { cleanTerminalText } from './terminalText'

/**
 * Shared semantic chat model.
 *
 * This is the single source of truth for turning persisted history
 * (messages / agent events / legacy transcripts) and realtime WebSocket
 * frames into chat items. The mobile app and the desktop ChatView both
 * render from these items, so the UI layer only ever sees generic
 * "thinking" / "tool call" / "approval" semantics — never CLI specifics.
 */
export interface ChatItem {
  id: string
  kind: 'user' | 'agent' | 'activity' | 'thinking' | 'plan' | 'diff' | 'approval' | 'question' | 'system'
  content: string
  timestamp?: string
  title?: string
  detail?: string
  approval?: MobileApproval
  question?: MobileQuestion
}

/** Realtime frame shape shared by the desktop `/ws` and mobile `/ws/mobile` sockets. */
export interface RealtimeEvent {
  type: string
  payload?: Record<string, unknown>
  event_id?: number
  timestamp?: string
}

export function formatDuration(durationMs: number) {
  const seconds = Math.round(durationMs / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function formatFileChange(payload: Record<string, unknown>) {
  const additions = typeof payload.additions === 'number' ? `+${payload.additions}` : ''
  const deletions = typeof payload.deletions === 'number' ? ` -${payload.deletions}` : ''
  return `${additions}${deletions}`.trim() || undefined
}

export function messageToChatItem(message: MobileAgentMessage): ChatItem | null {
  const content = message.content
  if (!content) return null
  return {
    id: `message-${message.id}`,
    kind: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'agent' : 'system',
    content,
    timestamp: message.timestamp,
  }
}

export function agentEventToChatItem(event: MobileAgentEvent, id: string): ChatItem | null {
  const payload = event.payload || {}
  const duration = typeof event.duration_ms === 'number' ? formatDuration(event.duration_ms) : ''
  switch (event.kind) {
    case 'assistant_text':
      return { id, kind: 'agent', content: String(payload.text || ''), timestamp: event.timestamp }
    case 'thinking_started':
      return { id, kind: 'thinking', content: '', title: 'Thinking', timestamp: event.timestamp }
    case 'thinking_finished':
      return { id, kind: 'thinking', content: '', title: duration ? `Thought for ${duration}` : 'Thought', timestamp: event.timestamp }
    case 'tool_started':
      return { id, kind: 'activity', content: '', title: String(payload.tool_name || 'Tool'), detail: payload.input ? JSON.stringify(payload.input) : undefined, timestamp: event.timestamp }
    case 'tool_activity':
      return { id, kind: 'activity', content: '', title: String(payload.tool_name || 'Tool'), detail: payload.input ? JSON.stringify(payload.input) : undefined, timestamp: event.timestamp }
    case 'plan':
      return { id, kind: 'plan', content: '', title: String(payload.title || 'Plan'), detail: Array.isArray(payload.steps) ? payload.steps.join('\n') : undefined, timestamp: event.timestamp }
    case 'tool_finished':
      return { id, kind: 'activity', content: '', title: `${payload.success === false ? 'Failed' : 'Completed'} · ${String(payload.tool_name || 'Tool')}${duration ? ` · ${duration}` : ''}`, timestamp: event.timestamp }
    case 'file_edited':
      return { id, kind: 'diff', content: '', title: `Edited ${String(payload.path || 'file')}`, detail: formatFileChange(payload), timestamp: event.timestamp }
    case 'search_started':
      return { id, kind: 'thinking', content: '', title: `Explore · ${String(payload.query || 'searching')}`, timestamp: event.timestamp }
    case 'search_finished':
      return { id, kind: 'thinking', content: '', title: `Explore · ${String(payload.result_count || 0)} results${duration ? ` · ${duration}` : ''}`, timestamp: event.timestamp }
    case 'command_started':
      return { id, kind: 'activity', content: '', title: `$ ${String(payload.command || 'command')}`, timestamp: event.timestamp }
    case 'command_finished':
      return { id, kind: 'activity', content: '', title: `${payload.exit_code === 0 ? 'Completed' : 'Failed'} · ${String(payload.command || 'command')}${duration ? ` · ${duration}` : ''}`, timestamp: event.timestamp }
    case 'permission_required':
      return { id, kind: 'approval', content: String(payload.prompt || 'Permission required'), timestamp: event.timestamp, approval: { id: String(payload.id || event.event_id), session_id: event.session_id, prompt: String(payload.prompt || 'Permission required'), options: Array.isArray(payload.options) ? payload.options.map(String) : ['allow', 'always', 'deny'], risk_level: 'medium' } }
    case 'question_started':
      return { id, kind: 'question', content: '', timestamp: event.timestamp, question: payload as unknown as MobileQuestion }
    case 'question_answered':
      return { id, kind: 'system', content: `Question answered: ${String(payload.question_id || '')}`, timestamp: event.timestamp }
    // Completion changes the assistant-ui message status. It is not a chat
    // message itself: rendering it as "Worked for …" hid the actual answer
    // behind an activity card.
    case 'agent_completed':
      return null
    case 'agent_error':
      return { id, kind: 'system', content: String(payload.message || 'Agent error'), timestamp: event.timestamp }
    default:
      return null
  }
}

/** Rebuilds the chat timeline from the persisted session payload. */
export function buildHistoryItems(messages: MobileAgentMessage[], events: MobileAgentEvent[], transcripts: MobileTaskTranscript[]): ChatItem[] {
  const messageItems = messages.map(messageToChatItem).filter((item): item is ChatItem => Boolean(item))
  const answers = new Map(events.filter((event) => event.kind === 'question_answered').map((event) => [String(event.payload.question_id || ''), event.payload]))
  const cancellations = new Set(events.filter((event) => event.kind === 'question_cancelled').map((event) => String(event.payload.question_id || '')))
  const hasQuestionEvent = events.some((event) => event.kind === 'question_started')
  const eventItems = events.map((event) => {
    if (event.kind === 'permission_required' && hasQuestionEvent && String(event.payload.prompt || '') === 'Claude requested permission') return null
    const item = agentEventToChatItem(event, `history-event-${event.event_id}`)
    if (item?.kind === 'question' && item.question) {
      const answer = answers.get(item.question.question_id)
      if (answer) item.question = { ...item.question, status: 'answered', selected_options: Array.isArray(answer.selected_options) ? answer.selected_options.map(String) : [], custom_text: typeof answer.custom_text === 'string' ? answer.custom_text : undefined }
      if (cancellations.has(item.question.question_id)) item.question = { ...item.question, status: 'cancelled' }
    }
    return item
  }).filter((item): item is ChatItem => Boolean(item))
  const legacyItems = transcripts.filter((item) => item.kind !== 'raw').map((item): ChatItem => {
    const content = cleanTerminalText(item.content)
    if (item.kind === 'user') return { id: `history-${item.id}`, kind: 'user', content, timestamp: item.timestamp }
    if (item.kind === 'approval') {
      try { const approval = JSON.parse(content) as MobileApproval; return { id: `approval-${approval.id}`, kind: 'approval', content: cleanTerminalText(approval.prompt), timestamp: item.timestamp, approval } }
      catch { return { id: `history-${item.id}`, kind: 'activity', content, timestamp: item.timestamp, title: 'Permission requested' } }
    }
    if (item.kind === 'activity' || item.kind === 'plan' || item.kind === 'diff') {
      try { const activity = JSON.parse(content) as { kind?: string; title?: string; detail?: string }; return { id: `history-${item.id}`, kind: activity.kind === 'plan' ? 'plan' : activity.kind === 'file_change' ? 'diff' : activity.kind === 'thinking' ? 'thinking' : 'activity', content, timestamp: item.timestamp, title: activity.title, detail: activity.detail ? cleanTerminalText(activity.detail) : undefined } }
      catch { return { id: `history-${item.id}`, kind: 'activity', content, timestamp: item.timestamp, title: 'Agent activity' } }
    }
    return { id: `history-${item.id}`, kind: item.kind === 'system' ? 'system' : 'agent', content, timestamp: item.timestamp }
  }).filter((item) => item.content.trim())
  return [...messageItems, ...eventItems, ...legacyItems].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
}

/** Folds realtime WebSocket frames for one session into chat items. */
export function buildLiveItems(events: RealtimeEvent[], sessionId: string): ChatItem[] {
  const items: ChatItem[] = []
  const seen = new Set<number>()
  for (const event of events) {
    if (typeof event.event_id === 'number') { if (seen.has(event.event_id)) continue; seen.add(event.event_id) }
    const payload = event.payload || {}
    const eventSessionId = String(
      payload.session_id
      || (payload.message as { session_id?: string } | undefined)?.session_id
      || (payload.event as { session_id?: string } | undefined)?.session_id
      || '',
    )
    if (eventSessionId !== sessionId) continue
    const id = `event-${event.event_id || `${event.type}-${event.timestamp}`}`
    if (event.type === 'Message') {
      const message = payload.message as MobileAgentMessage | undefined
      if (message) {
        const item = messageToChatItem(message)
        if (item) items.push({ ...item, id })
      }
    } else if (event.type === 'AgentEvent') {
      const semantic = payload.event as MobileAgentEvent | undefined
      if (semantic) {
        const item = agentEventToChatItem(semantic, id)
        if (item) items.push(item)
      }
    } else if (event.type === 'TranscriptChunk') {
      const kind = String(payload.kind || 'stdout')
      const content = cleanTerminalText(String(payload.chunk || ''))
      if (content) items.push({ id, kind: kind === 'user' ? 'user' : kind === 'system' ? 'system' : 'agent', content, timestamp: event.timestamp })
    } else if (event.type === 'Activity') {
      const activity = payload.activity as { kind?: string; title?: string; detail?: string } | undefined
      items.push({ id, kind: activity?.kind === 'plan' ? 'plan' : activity?.kind === 'file_change' ? 'diff' : activity?.kind === 'thinking' ? 'thinking' : 'activity', content: activity?.detail || '', title: activity?.title || 'Agent activity', detail: activity?.detail, timestamp: event.timestamp })
    } else if (event.type === 'ApprovalRequest') {
      const raw = payload.request as { id?: string; prompt?: string; options?: string[]; risk_level?: MobileApproval['risk_level'] } | undefined
      if (raw?.id) items.push({ id, kind: 'approval', content: raw.prompt || 'Permission required', timestamp: event.timestamp, approval: { id: raw.id, session_id: sessionId, prompt: raw.prompt || 'Permission required', options: raw.options || ['allow', 'always', 'deny'], risk_level: raw.risk_level || 'medium' } })
    } else if (event.type === 'ApprovalResolved') {
      items.push({ id, kind: 'system', content: `Permission ${String(payload.decision || 'resolved')}`, timestamp: event.timestamp })
    } else if (event.type === 'SessionError' && payload.message) {
      items.push({ id, kind: 'system', content: String(payload.message), timestamp: event.timestamp })
    }
  }
  return items
}

/** IDs of approvals already resolved, from history events and live frames. */
export function resolvedApprovalIds(historyEvents: MobileAgentEvent[], liveEvents: RealtimeEvent[]): Set<string> {
  return new Set<string>([
    ...historyEvents
      .filter((event) => event.kind === 'permission_resolved')
      .map((event) => String(event.payload.request_id || '')),
    ...liveEvents
      .filter((event) => event.type === 'AgentEvent')
      .map((event) => event.payload?.event as { kind?: string; payload?: Record<string, unknown> } | undefined)
      .filter((event): event is { kind: string; payload?: Record<string, unknown> } => event?.kind === 'permission_resolved')
      .map((event) => String(event.payload?.request_id || '')),
    ...liveEvents
      .filter((event) => event.type === 'ApprovalResolved')
      .map((event) => String(event.payload?.request_id || '')),
  ])
}

/** Question IDs that already have an answer, from history events and live frames. */
export function answeredQuestionIds(historyEvents: MobileAgentEvent[], liveEvents: RealtimeEvent[]): Set<string> {
  return new Set<string>([
    ...historyEvents.filter((event) => event.kind === 'question_answered').map((event) => String(event.payload.question_id || '')),
    ...liveEvents
      .filter((event) => event.type === 'AgentEvent')
      .map((event) => event.payload?.event as { kind?: string; payload?: Record<string, unknown> } | undefined)
      .filter((event): event is { kind: string; payload?: Record<string, unknown> } => event?.kind === 'question_answered')
      .map((event) => String(event.payload?.question_id || '')),
  ])
}
