import * as Notifications from 'expo-notifications'
import type { IncomingFrame } from '@/types/protocol'
import {
  alreadyNotified,
  notificationForFrame,
  notificationForPending,
  present,
  resetDedup,
} from '../notify'

const schedule = Notifications.scheduleNotificationAsync as jest.Mock
const getPerms = Notifications.getPermissionsAsync as jest.Mock

function agentFrame(
  kind: string,
  payload: Record<string, unknown>,
  sessionId = 's1',
  eventId = 1,
): IncomingFrame {
  return {
    type: 'AgentEvent',
    event_id: eventId,
    payload: {
      event: {
        event_id: `e${eventId}`,
        session_id: sessionId,
        sequence: eventId,
        timestamp: '2026-01-01T00:00:00Z',
        kind,
        payload,
        duration_ms: null,
      },
    },
  } as unknown as IncomingFrame
}

beforeEach(() => {
  jest.clearAllMocks()
  resetDedup()
  getPerms.mockResolvedValue({ status: 'granted' })
})

describe('notificationForFrame — the extensible attention mapper', () => {
  it('maps an approval, preferring the concrete tool over a generic line', () => {
    const n = notificationForFrame(
      agentFrame('permission_required', { id: 'r1', tool_name: 'git push', prompt: 'Allow?' }),
      () => 'Deploy',
    )
    expect(n).toMatchObject({
      id: 'r1',
      title: 'Approval needed',
      data: { sessionId: 's1', approvalId: 'r1', kind: 'approval' },
    })
    expect(n!.body).toContain('git push')
    expect(n!.body).toContain('Deploy')
  })

  it('falls back to the prompt when there is no tool name', () => {
    const n = notificationForFrame(
      agentFrame('permission_required', { id: 'r2', prompt: 'Allow this edit?' }),
      () => 'S',
    )
    expect(n!.body).toContain('Allow this edit?')
  })

  it('maps a question to an action notification', () => {
    const n = notificationForFrame(
      agentFrame('question_started', { question_id: 'q1', question: 'Which environment?' }),
      () => 'S',
    )
    expect(n).toMatchObject({ id: 'q1', data: { kind: 'question', approvalId: 'q1' } })
    expect(n!.body).toContain('Which environment?')
  })

  it('maps completion and error events', () => {
    expect(notificationForFrame(agentFrame('agent_completed', {}, 's1', 7), () => 'Fix')!.title).toBe(
      'Task finished',
    )
    expect(notificationForFrame(agentFrame('agent_error', {}, 's1', 8), () => 'Fix')!.title).toBe(
      'Agent stopped',
    )
  })

  it('maps an error StateChange (backends that emit state without an event)', () => {
    const frame = {
      type: 'StateChange',
      event_id: 9,
      payload: { session_id: 's1', state: 'error' },
    } as unknown as IncomingFrame
    expect(notificationForFrame(frame, () => 'Fix')!.data.kind).toBe('error')
  })

  it('ignores frames that are not worth interrupting for', () => {
    expect(notificationForFrame(agentFrame('tool_started', { tool_name: 'Read' }), () => 'S')).toBeNull()
    expect(notificationForFrame(agentFrame('assistant_text', { text: 'hi' }), () => 'S')).toBeNull()
  })

  it('truncates a long prompt without runaway bodies', () => {
    const n = notificationForFrame(
      agentFrame('permission_required', { id: 'r3', prompt: 'x'.repeat(300) }),
      () => 'S',
    )
    expect(n!.body.length).toBeLessThan(160)
  })
})

describe('notificationForPending — reconnect-sync mapping', () => {
  it('carries the session and approval id from the backend row', () => {
    const n = notificationForPending({
      session_id: 'sess-9',
      session_name: 'Refactor',
      kind: 'approval',
      id: 'r7',
      title: 'Approval needed',
      prompt: 'Run the migration?',
      tool_name: null,
    })
    expect(n.id).toBe('r7')
    expect(n.data).toMatchObject({ sessionId: 'sess-9', approvalId: 'r7', kind: 'approval' })
    expect(n.body).toContain('Run the migration?')
  })
})

describe('present — dedup, permission, and tap data', () => {
  it('schedules once and dedupes a repeated event (scenario 3)', async () => {
    const n = notificationForFrame(
      agentFrame('permission_required', { id: 'dup', prompt: 'Allow?' }),
      () => 'S',
    )!
    expect(await present(n)).toBe(true)
    expect(await present(n)).toBe(false)
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(alreadyNotified('dup')).toBe(true)
  })

  it('does not schedule when permission is denied (scenario 9)', async () => {
    getPerms.mockResolvedValue({ status: 'denied' })
    const n = notificationForFrame(
      agentFrame('permission_required', { id: 'x', prompt: 'Allow?' }),
      () => 'S',
    )!
    expect(await present(n)).toBe(false)
    expect(schedule).not.toHaveBeenCalled()
  })

  it('pages distinct approvals across sessions separately (scenarios 10, 11)', async () => {
    const a = notificationForFrame(
      agentFrame('permission_required', { id: 'a', prompt: 'A?' }, 's1', 1),
      () => 'One',
    )!
    const b = notificationForFrame(
      agentFrame('permission_required', { id: 'b', prompt: 'B?' }, 's2', 2),
      () => 'Two',
    )!
    expect(await present(a)).toBe(true)
    expect(await present(b)).toBe(true)
    expect(schedule).toHaveBeenCalledTimes(2)
    expect(a.data.sessionId).toBe('s1')
    expect(b.data.sessionId).toBe('s2')
  })

  it('force bypasses dedup (the explicit test button)', async () => {
    const n = notificationForPending({
      session_id: 's',
      session_name: 'S',
      kind: 'approval',
      id: 't',
      title: 'Test',
      prompt: null,
      tool_name: null,
    })
    await present(n)
    await present(n, true)
    expect(schedule).toHaveBeenCalledTimes(2)
  })

  it('attaches sessionId + approvalId so a tap can route (scenarios 6, 7)', async () => {
    const n = notificationForFrame(
      agentFrame('permission_required', { id: 'r9', prompt: 'Allow?' }, 'sess-42'),
      () => 'S',
    )!
    await present(n)
    const arg = schedule.mock.calls[0][0]
    expect(arg.content.data).toMatchObject({ sessionId: 'sess-42', approvalId: 'r9', kind: 'approval' })
  })
})
