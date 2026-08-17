import { describe, expect, it } from 'vitest'
import { assessResumable, detectResumeHint } from './resume'
import type { ChatItem } from './chatItems'

const history: ChatItem[] = [
  { id: 'e1', kind: 'agent', content: 'hello', timestamp: '2024-01-01T00:00:00Z' },
]

describe('detectResumeHint', () => {
  it('returns null when there is no resume hint', () => {
    expect(detectResumeHint('')).toBeNull()
    expect(detectResumeHint('Some normal output')).toBeNull()
  })

  it('parses the CLI resume hint block', () => {
    const raw = 'Some output\nResume this session with:\nclaude --resume abc-123\n'
    const hint = detectResumeHint(raw)
    expect(hint).not.toBeNull()
    expect(hint?.sessionId).toBe('abc-123')
    expect(hint?.command).toBe('claude --resume abc-123')
  })

  it('matches with leading whitespace and extra lines', () => {
    const raw = '  Resume this session with:  \n  claude --resume dbfb725f-c7cb-4c24-80b4-d1f04285bac1\n'
    const hint = detectResumeHint(raw)
    expect(hint?.sessionId).toBe('dbfb725f-c7cb-4c24-80b4-d1f04285bac1')
  })

  it('captures the full command even with flags', () => {
    const raw = 'Resume this session with:\nclaude --resume ses-99 --model opus\nmore text'
    const hint = detectResumeHint(raw)
    expect(hint?.sessionId).toBe('ses-99')
    expect(hint?.command).toContain('--model opus')
  })
})

describe('assessResumable', () => {
  it('shows resume for an explicit needs_resume status', () => {
    const result = assessResumable('needs_resume', 'claude', undefined, history)
    expect(result.showResume).toBe(true)
  })

  it('shows resume for an exited claude session with history', () => {
    const result = assessResumable('exited', 'claude', undefined, history)
    expect(result.showResume).toBe(true)
    expect(result.resumeCommand).toBe('claude --resume <session>')
  })

  it('shows resume for an idle claude session with history', () => {
    const result = assessResumable('idle', 'claude', undefined, history)
    expect(result.showResume).toBe(true)
  })

  it('uses the backend-provided resume command when present', () => {
    const result = assessResumable('exited', 'claude', 'claude --resume abc-123', history)
    expect(result.resumeCommand).toBe('claude --resume abc-123')
  })

  it('shows resume when the CLI hint is present in raw output regardless of status', () => {
    const raw = 'Resume this session with:\nclaude --resume dbfb725f-c7cb-4c24-80b4-d1f04285bac1\n'
    // Even with a generic status, the CLI hint drives the action.
    const result = assessResumable('exited', 'claude', undefined, [], raw)
    expect(result.showResume).toBe(true)
    expect(result.resumeCommand).toBe('claude --resume dbfb725f-c7cb-4c24-80b4-d1f04285bac1')
  })

  it('does not show resume for a running session', () => {
    const result = assessResumable('running', 'claude', undefined, history)
    expect(result.showResume).toBe(false)
  })

  it('does not show resume for a non-claude agent', () => {
    const result = assessResumable('exited', 'codex', undefined, history)
    expect(result.showResume).toBe(false)
  })

  it('does not show resume when there is no history', () => {
    const result = assessResumable('exited', 'claude', undefined, [])
    expect(result.showResume).toBe(false)
  })

  it('CLI hint takes precedence even without history', () => {
    const raw = 'Resume this session with:\nclaude --resume xyz\n'
    const result = assessResumable('exited', 'claude', undefined, [], raw)
    expect(result.showResume).toBe(true)
  })
})
