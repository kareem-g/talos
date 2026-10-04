/**
 * demo — one fabricated transcript that exercises every event the timeline can
 * draw.
 *
 * Reviewing the conversation surface used to mean waiting for a real session to
 * happen to publish a plan, or ask for approval, or spawn a subagent — you
 * could not look at the approval card on purpose. This builds a single
 * conversation containing one of each part, so every card can be inspected on
 * a device in seconds and compared against the mockups.
 *
 * It is development-only: `isDemoSession` returns false in a release build, and
 * the entry point that opens it is not rendered there either. A real session id
 * is never a demo id, so live data can never be shadowed by accident.
 */

import type { Conversation, Message, MessagePart } from '@/types/conversation'
import type { Session } from '@/types/session'

export const DEMO_SESSION_ID = '__demo-transcript__'
export const DEMO_SESSION_NAME = 'Demo transcript — every event'

/** True only in development, and only for the fixture's own id. */
export function isDemoSession(sessionId: string): boolean {
  return __DEV__ && sessionId === DEMO_SESSION_ID
}

const AT = '2026-10-03T09:41:00.000Z'

function message(sequence: number, role: Message['role'], parts: MessagePart[], streaming = false): Message {
  return {
    id: `demo-${sequence}`,
    role,
    parts,
    sequence,
    createdAt: new Date(Date.parse(AT) + sequence * 1000).toISOString(),
    streaming,
  }
}

const tool = (name: string, toolKind: string, status: 'ok' | 'failed', durationMs: number, id: string): MessagePart =>
  ({
    kind: 'tool',
    toolId: id,
    name,
    toolKind,
    status,
    durationMs,
  }) as unknown as MessagePart

/** The fixture session row, so the header has something real to render. */
export const DEMO_SESSION: Session = {
  id: DEMO_SESSION_ID,
  name: DEMO_SESSION_NAME,
  agent: 'claude',
  project: '/home/kareem/Documents/agentdeck-linux',
  branch: 'qai-mobile-redesign',
  status: 'running',
  worktree_path: null,
  created_at: AT,
  updated_at: AT,
  cost: 0.042,
  tokens_used: 15500,
  resume_command: null,
}

export const DEMO_CONVERSATION: Conversation = {
  sessionId: DEMO_SESSION_ID,
  terminal: 'npm test -- chat\n42 passed (42)',
  commands: [],
  lastEventId: 5,
  seenEvents: new Set<string>(),
  activity: { label: 'Working', detail: 'Editing ui.tsx', since: AT },
  messages: [
    message(1, 'user', [
      { kind: 'text', text: 'Port the desktop composer, then run the chat tests before you commit.' } as MessagePart,
    ]),

    message(2, 'assistant', [
      {
        kind: 'reasoning',
        text: 'The composer already queues when busy, so the change is in the send control, not the submit path. Checking the timeline for a duplicate queue render before I touch StateZone.',
        durationMs: 4200,
      } as MessagePart,
      {
        kind: 'text',
        text: 'Done — the composer is ported and the suite is green. What changed:\n\n- Queue-when-busy: the send button becomes **Queue** without moving\n- Slash commands filter from the caret token\n- Attachments upload through `/api/mobile/attachments`',
      } as MessagePart,
      tool('read_file', 'read', 'ok', 34, 't1'),
      tool('grep', 'search', 'ok', 210, 't2'),
      tool('edit_file', 'edit', 'ok', 96, 't3'),
      tool('bash', 'execute', 'ok', 4200, 't4'),
      tool('edit_file', 'edit', 'ok', 88, 't5'),
      tool('read_file', 'read', 'ok', 29, 't6'),
      {
        kind: 'plan',
        title: 'Pairing keep-alive fix',
        steps: [
          'Read the pairing lib and the token refresh path',
          'Add retry with exponential backoff on 401',
          'Add a test for the expired-offer path',
        ],
        status: 'proposed',
        entries: [
          { content: 'Read the pairing lib and the token refresh path', status: 'completed' },
          { content: 'Add retry with exponential backoff on 401', status: 'in_progress' },
          { content: 'Add a test for the expired-offer path', status: 'pending' },
        ],
      } as MessagePart,
      { kind: 'file', path: 'src/chat/Composer.tsx', ok: true } as MessagePart,
      { kind: 'file', path: 'src/chat/Timeline.tsx', ok: true } as MessagePart,
    ]),

    message(3, 'assistant', [
      {
        kind: 'approval',
        requestId: 'appr-1',
        prompt: 'rm -rf node_modules && npm install',
        header: 'Run a command',
        options: ['Allow once', 'Always allow rm here', 'Deny'],
        optionData: [
          { value: 'allow_once', label: 'Allow once', description: 'Runs this command only' },
          {
            value: 'always',
            label: 'Always allow rm here',
            description: 'Skips this prompt for similar commands in this project',
          },
          { value: 'deny', label: 'Deny' },
        ],
        allowsCustomText: true,
        riskLevel: 'high',
      } as MessagePart,
    ]),

    message(4, 'assistant', [
      {
        kind: 'approval',
        requestId: 'plan:demo-1',
        prompt: 'Plan — Port the timeline',
        header: 'Plan — Port the timeline',
        options: ['approve', 'decline'],
        optionData: [
          { value: 'approve', label: 'Approve plan' },
          { value: 'decline', label: 'Decline' },
        ],
        isPlan: true,
      } as MessagePart,
      {
        kind: 'approval',
        requestId: 'q-1',
        prompt: 'Which fixture runner should the tests use?',
        header: 'Which fixture runner should the tests use?',
        options: ['vitest', 'node', 'jest'],
        optionData: [
          { value: 'vitest', label: 'Vitest', description: "Already in the repo's devDependencies" },
          { value: 'node', label: "Node's built-in runner", description: 'Zero extra deps, fewer matchers' },
          { value: 'jest', label: 'Jest' },
        ],
        isQuestion: true,
      } as MessagePart,
      { kind: 'command', toolId: 'c1', command: 'npm test -- chat', output: '42 passed (42)', exitCode: 0, status: 'ok' } as unknown as MessagePart,
      { kind: 'subagent', id: 's1', name: 'reviewer — scanning diffs', kindType: 'review', status: 'running', startedAt: AT } as MessagePart,
      { kind: 'search', query: '"queueMessage" · 12 files', results: [] } as MessagePart,
      { kind: 'progress', percent: 62, message: 'Porting the timeline', step: '2 of 6' } as MessagePart,
      { kind: 'browser', id: 'b1', action: 'goto', target: 'http://127.0.0.1:9120/mobile/pair', status: 'ok', detail: 'Pairing gate' } as MessagePart,
      { kind: 'git_commit', sha: 'a1b2c3d4e5f6', message: 'Port the composer to the shared kit', files: ['src/chat/Composer.tsx', 'src/ui.tsx'] } as MessagePart,
      { kind: 'verification', status: 'passed', command: 'npm run verify', output: 'typecheck, tests, guards: ok' } as MessagePart,
      { kind: 'context', environment: true, skills: ['code-review'], trajectories: [], memories: [] } as MessagePart,
      { kind: 'image', ref: 'demo-image', fileName: 'stack-trace.png', contentType: 'image/png', size: 40921 } as MessagePart,
      { kind: 'usage', inputTokens: 12400, outputTokens: 3100, cacheReadTokens: 8800, costUsd: 0.042 } as MessagePart,
      { kind: 'turn_summary', stopReason: 'end_turn', inputTokens: 12400, outputTokens: 3100, costUsd: 0.042, durationMs: 38000 } as MessagePart,
    ]),

    message(5, 'assistant', [
      { kind: 'error', message: 'gemini CLI not found on PATH (exit 1)' } as MessagePart,
    ]),
  ],
}