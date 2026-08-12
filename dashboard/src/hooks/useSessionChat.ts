import { useEffect, useMemo, useState } from 'react'
import { useWebSocket } from './useWebSocket'
import {
  answeredQuestionIds,
  buildHistoryItems,
  buildLiveItems,
  resolvedApprovalIds,
  type ChatItem,
  type RealtimeEvent,
} from '../lib/chatItems'
import { normalizedText } from '../lib/terminalText'
import type { MobileAgentEvent, MobileAgentMessage, MobileApproval, MobileQuestion, MobileTaskTranscript } from '../types/mobile'

interface SessionMeta {
  id: string
  name?: string
  agent?: string
  status: string
  project?: string
  branch?: string
}

interface HistoryPayload {
  transcripts: MobileTaskTranscript[]
  messages: MobileAgentMessage[]
  events: MobileAgentEvent[]
  terminal_output?: { sequence: number; data: string }[]
}

export interface QuestionAnswer {
  question_id: string
  session_id: string
  selected_options: string[]
  custom_text: string | null
}

/**
 * Shared chat state for one session: persisted history + live WebSocket
 * frames folded into semantic ChatItems, plus pending approvals/questions
 * and send helpers. Used by the desktop ChatView (the mobile app keeps its
 * own snapshot-based equivalent on the mobile API).
 */
export function useSessionChat(sessionId: string) {
  const { connected, messages, sendMessage } = useWebSocket()
  const [session, setSession] = useState<SessionMeta | null>(null)
  const [history, setHistory] = useState<HistoryPayload | null>(null)
  const [loading, setLoading] = useState(true)
  // approval id -> decision taken in this UI session (optimistic, pre-event)
  const [resolvedApprovals, setResolvedApprovals] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    setSession(null)
    setHistory(null)
    setLoading(true)
    setResolvedApprovals(new Map())
    let cancelled = false
    Promise.all([
      fetch(`/api/sessions/${sessionId}`).then((res) => res.json()),
      fetch(`/api/sessions/${sessionId}/transcripts`).then((res) => res.json()),
    ])
      .then(([sessionData, transcriptData]) => {
        if (cancelled) return
        if (!sessionData?.error) {
          setSession({
            id: sessionId,
            name: sessionData.name || undefined,
            agent: sessionData.agent || undefined,
            status: sessionData.status || 'idle',
            project: sessionData.project || undefined,
            branch: sessionData.branch || undefined,
          })
        }
        setHistory({
          transcripts: transcriptData?.transcripts || [],
          messages: transcriptData?.messages || [],
          events: transcriptData?.events || [],
          terminal_output: transcriptData?.terminal_output || [],
        })
      })
      .catch((error) => console.error('[AgentDeck][Chat] Failed to load session:', error))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sessionId])

  const liveEvents = messages as RealtimeEvent[]

  const { items, pendingApprovals, pendingQuestions, status, rawOutput, resolvedDecisionById } = useMemo(() => {
    const historyEvents = history?.events || []
    const historyItems = buildHistoryItems(history?.messages || [], historyEvents, history?.transcripts || [])
    const liveItems = buildLiveItems(liveEvents, sessionId)
    const historyUserContent = new Set(
      historyItems.filter((item) => item.kind === 'user').map((item) => normalizedText(item.content)),
    )

    // Answers arrive as separate events — merge them back onto question items.
    const questionAnswers = new Map<string, { selected_options?: unknown; custom_text?: unknown }>([
      ...historyEvents
        .filter((event) => event.kind === 'question_answered')
        .map((event) => [String(event.payload.question_id || ''), event.payload] as const),
      ...liveEvents
        .filter((event) => event.type === 'AgentEvent')
        .map((event) => event.payload?.event as MobileAgentEvent | undefined)
        .filter((event): event is MobileAgentEvent => Boolean(event && event.kind === 'question_answered'))
        .map((event) => [String(event.payload.question_id || ''), event.payload] as const),
    ])

    const merged = [...historyItems, ...liveItems.filter((item) => item.kind !== 'user' || !historyUserContent.has(normalizedText(item.content)))].map((item) => {
      if (item.kind === 'question' && item.question) {
        const answer = questionAnswers.get(item.question.question_id)
        if (answer) return { ...item, question: { ...item.question, status: 'answered' as const, selected_options: Array.isArray(answer.selected_options) ? answer.selected_options.map(String) : [], custom_text: typeof answer.custom_text === 'string' ? answer.custom_text : undefined } }
      }
      return item
    }).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
      .filter((item) => item.kind === 'question' || item.content.trim() || item.kind === 'approval' || item.kind === 'thinking' || item.kind === 'activity' || item.kind === 'diff' || item.kind === 'plan')

    const resolvedIds = resolvedApprovalIds(historyEvents, liveEvents)
    // The desktop approval_response path broadcasts permission_resolved without
    // persisting it, so reloads lose resolutions. Derive them instead: if the
    // agent produced activity after the request, it was resolved.
    const activityTimes = merged
      .filter((item) => item.timestamp && (item.kind === 'agent' || item.kind === 'activity' || item.kind === 'thinking' || item.kind === 'diff'))
      .map((item) => new Date(item.timestamp as string).getTime())
    const supersededIds = new Set(
      merged
        .filter((item) => item.kind === 'approval' && item.approval && item.timestamp && activityTimes.some((later) => later > new Date(item.timestamp as string).getTime()))
        .map((item) => (item.approval as MobileApproval).id),
    )
    const approvals = merged
      .filter((item) => item.kind === 'approval')
      .map((item) => item.approval)
      .filter((approval): approval is MobileApproval => Boolean(approval))
    const pending = approvals.filter((approval, index, all) =>
      !resolvedApprovals.has(approval.id)
      && !resolvedIds.has(approval.id)
      && !supersededIds.has(approval.id)
      && all.findIndex((candidate) => candidate.id === approval.id) === index)

    // resolved approval decisions: local optimistic map + events broadcast
    // over the wire (permission_resolved), so in-thread pasted approvals keep
    // their chosen decision across reloads and live updates.
    const resolvedDecisionById = new Map<string, string>()
    for (const [id, decision] of resolvedApprovals) resolvedDecisionById.set(id, decision)
    const indexResolved = (payload?: Record<string, unknown>) => {
      if (payload && payload.request_id != null) {
        resolvedDecisionById.set(String(payload.request_id), String(payload.decision || 'resolved'))
      }
    }
    historyEvents.forEach((event) => { if (event.kind === 'permission_resolved') indexResolved(event.payload) })
    for (const frame of liveEvents) {
      if (frame.type !== 'AgentEvent') continue
      const payload = frame.payload as Record<string, unknown> | undefined
      const nested = payload?.event as MobileAgentEvent | undefined
      if (nested?.kind === 'permission_resolved') indexResolved(nested.payload)
      indexResolved(payload)
    }

    const answeredIds = answeredQuestionIds(historyEvents, liveEvents)
    const questions = merged
      .filter((item): item is ChatItem & { question: MobileQuestion } => item.kind === 'question' && Boolean(item.question))
      .map((item) => item.question)
    const pendingQs = questions.filter((question, index, all) =>
      question.status === 'pending'
      && !answeredIds.has(question.question_id)
      && all.findIndex((candidate) => candidate.question_id === question.question_id) === index)

    // Live status wins over the fetched snapshot.
    const liveSession = [...liveEvents].reverse().find((event) => {
      if (event.type === 'SessionUpdate') {
        const updated = event.payload?.session as Record<string, unknown> | undefined
        return updated?.id === sessionId
      }
      return event.type === 'StateChange' && String(event.payload?.session_id || '') === sessionId
    })
    const liveStatus = liveSession?.type === 'SessionUpdate'
      ? String((liveSession.payload?.session as Record<string, unknown> | undefined)?.status || '')
      : liveSession?.type === 'StateChange'
        ? String(liveSession.payload?.state || '').split(':')[0]
        : ''
    const effectiveStatus = pending.length > 0 ? 'waiting_for_approval' : liveStatus || session?.status || 'idle'

    // Raw PTY feed for the opt-in terminal debug view only.
    const rawHistory = (history?.terminal_output || [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((entry) => entry.data)
      .join('')
    const rawLive = liveEvents
      .filter((event) => event.type === 'TranscriptChunk' && String(event.payload?.session_id || '') === sessionId)
      .map((event) => String(event.payload?.chunk || event.payload?.data || ''))
      .join('')

    return {
      items: merged,
      pendingApprovals: pending,
      pendingQuestions: pendingQs,
      status: effectiveStatus,
      rawOutput: rawHistory + rawLive,
      resolvedDecisionById,
    }
  }, [history, liveEvents, resolvedApprovals, session, sessionId])

  const working = status === 'running' || status === 'starting'
  const ended = status === 'exited' || status === 'archived'

  const sendText = (text: string): boolean => {
    const value = text.trim()
    if (!value) return false
    return sendMessage({ type: 'Input', payload: { session_id: sessionId, data: `${value}\n` } })
  }

  const answerQuestion = (answer: QuestionAnswer): boolean =>
    sendMessage({ type: 'QuestionAnswer', payload: { answer } })

  const resolveApproval = (approval: MobileApproval, decision: string): boolean => {
    const sent = sendMessage({
      type: 'Command',
      payload: { action: 'approval_response', params: { session_id: sessionId, request_id: approval.id, decision } },
    })
    if (sent) setResolvedApprovals((current) => new Map(current).set(approval.id, decision))
    return sent
  }

  return {
    loading,
    connected,
    session,
    items,
    historyEvents: history?.events || [],
    liveEvents,
    resolvedDecisionById,
    pendingApprovals,
    pendingQuestions,
    resolvedApprovals,
    status,
    working,
    ended,
    rawOutput,
    sendText,
    answerQuestion,
    resolveApproval,
  }
}
