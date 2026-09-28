/**
 * Controller tests: the wiring decisions that are easy to get wrong — suppress
 * while the user is looking, page when they are not, reconcile on reconnect, and
 * route a tap to the right session/approval. The native notification call itself
 * is mocked; here we assert *when* and *with what* it is invoked.
 */

import { AppState } from 'react-native'
import * as Notifications from 'expo-notifications'
import type { IncomingFrame } from '@/types/protocol'

jest.mock('../socket', () => ({
  socket: {
    onFrame: jest.fn(() => () => {}),
    onState: jest.fn(() => () => {}),
    connect: jest.fn(),
  },
}))
jest.mock('../api', () => ({ mobileApi: { pending: jest.fn() } }))
jest.mock('../../store', () => ({
  useStore: {
    getState: () => ({
      sessions: [
        { id: 's1', name: 'Deploy' },
        { id: 's2', name: 'Refactor' },
      ],
    }),
  },
}))

import { startNotifications } from '../notifications'
import { socket } from '../socket'
import { mobileApi } from '../api'
import { resetDedup } from '../notify'

const schedule = Notifications.scheduleNotificationAsync as jest.Mock
const getPerms = Notifications.getPermissionsAsync as jest.Mock
const tapListen = Notifications.addNotificationResponseReceivedListener as jest.Mock
const onFrame = socket.onFrame as jest.Mock
const onState = socket.onState as jest.Mock
const pending = mobileApi.pending as jest.Mock

let onOpenAction: jest.Mock
let teardown: () => void
let frameListener: (frame: IncomingFrame) => void
let stateListener: (state: string) => void
let appChange: (status: string) => void
let tapListener: (response: unknown) => void

function approvalFrame(id: string, sessionId = 's1', eventId = 1): IncomingFrame {
  return {
    type: 'AgentEvent',
    event_id: eventId,
    payload: {
      event: {
        event_id: `e${eventId}`,
        session_id: sessionId,
        sequence: eventId,
        timestamp: '2026-01-01T00:00:00Z',
        kind: 'permission_required',
        payload: { id, prompt: 'Allow?' },
        duration_ms: null,
      },
    },
  } as unknown as IncomingFrame
}

function setForeground(active: boolean) {
  appChange(active ? 'active' : 'background')
}

beforeEach(() => {
  jest.clearAllMocks()
  resetDedup()
  getPerms.mockResolvedValue({ status: 'granted' })
  pending.mockResolvedValue({ pending: [] })
  onOpenAction = jest.fn()
  // Capture the AppState listener so a test can drive foreground/background.
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((_event: string, cb: (status: string) => void) => {
      appChange = cb
      return { remove: jest.fn() }
    }) as never)
  teardown = startNotifications(onOpenAction)
  frameListener = onFrame.mock.calls[0][0]
  stateListener = onState.mock.calls[0][0]
  tapListener = tapListen.mock.calls[0][0]
  setForeground(true) // start each test in the foreground
})

afterEach(() => {
  teardown()
  jest.restoreAllMocks()
})

it('suppresses the notification while the app is in the foreground (scenario 1)', async () => {
  setForeground(true)
  frameListener(approvalFrame('r1'))
  await Promise.resolve()
  expect(schedule).not.toHaveBeenCalled()
})

it('pages when the app is backgrounded and the socket is alive (scenario 2)', async () => {
  setForeground(false)
  frameListener(approvalFrame('r1'))
  await new Promise((r) => setTimeout(r, 0))
  expect(schedule).toHaveBeenCalledTimes(1)
  expect(schedule.mock.calls[0][0].content.data).toMatchObject({ sessionId: 's1', approvalId: 'r1' })
})

it('does not double-page the same approval across frames (scenario 3)', async () => {
  setForeground(false)
  frameListener(approvalFrame('dup', 's1', 1))
  frameListener(approvalFrame('dup', 's1', 2)) // replayed/duplicate
  await new Promise((r) => setTimeout(r, 0))
  expect(schedule).toHaveBeenCalledTimes(1)
})

it('reconciles pending approvals discovered on reconnect (scenarios 4, 5, 12)', async () => {
  setForeground(false)
  pending.mockResolvedValue({
    pending: [
      {
        session_id: 's2',
        session_name: 'Refactor',
        kind: 'approval',
        id: 'missed-1',
        title: 'Approval needed',
        prompt: 'Force push?',
        tool_name: null,
        risk_level: null,
        created_at: '2026-01-01T00:00:00Z',
        payload: {},
      },
    ],
  })
  // Simulate a reconnect: offline → connected triggers the sync.
  stateListener('disconnected')
  stateListener('connected')
  await new Promise((r) => setTimeout(r, 0))
  expect(pending).toHaveBeenCalled()
  expect(schedule).toHaveBeenCalledTimes(1)
  expect(schedule.mock.calls[0][0].content.data).toMatchObject({ sessionId: 's2', approvalId: 'missed-1' })
})

it('routes a tap to the session and approval, never resolving it (scenarios 6, 7)', () => {
  tapListener({
    notification: {
      request: {
        content: { data: { sessionId: 's2', approvalId: 'r5', kind: 'approval' } },
      },
    },
  })
  expect(onOpenAction).toHaveBeenCalledWith({ sessionId: 's2', approvalId: 'r5', kind: 'approval' })
})

it('pages distinct sessions separately (scenario 11)', async () => {
  setForeground(false)
  frameListener(approvalFrame('a', 's1', 1))
  frameListener(approvalFrame('b', 's2', 2))
  await new Promise((r) => setTimeout(r, 0))
  expect(schedule).toHaveBeenCalledTimes(2)
  const bodies = schedule.mock.calls.map((c) => c[0].content.body)
  expect(bodies.some((b: string) => b.includes('Deploy'))).toBe(true)
  expect(bodies.some((b: string) => b.includes('Refactor'))).toBe(true)
})

it('stays silent when permission is denied but keeps working (scenario 9)', async () => {
  getPerms.mockResolvedValue({ status: 'denied' })
  setForeground(false)
  frameListener(approvalFrame('r1'))
  await new Promise((r) => setTimeout(r, 0))
  expect(schedule).not.toHaveBeenCalled()
})
