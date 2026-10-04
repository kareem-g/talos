/**
 * The remote wire contract's pure helpers. These are the strings the daemon and
 * the phone must agree on exactly: a target key that round-trips wrong opens
 * the wrong window, and a state label that is missing leaves the viewer blank.
 */

import {
  REMOTE_STATE_LABEL,
  isRemoteFrame,
  parseTargetKey,
  targetKey,
  targetLabel,
  type RemoteState,
} from '../remoteView'

describe('targetKey / parseTargetKey', () => {
  it('round-trips every target shape', () => {
    const targets = [
      { kind: 'desktop' } as const,
      { kind: 'display', id: 2 } as const,
      { kind: 'window', id: 83886092 } as const,
    ]
    for (const target of targets) {
      expect(parseTargetKey(targetKey(target))).toEqual(target)
    }
  })

  it('defaults unknown keys to the desktop rather than throwing', () => {
    expect(parseTargetKey('')).toEqual({ kind: 'desktop' })
    expect(parseTargetKey('nonsense')).toEqual({ kind: 'desktop' })
  })
})

describe('targetLabel', () => {
  it('prefers the real window title', () => {
    const windows = [
      {
        id: 7,
        display_id: 0,
        title: 'main.rs',
        app_name: 'VS Code',
        app_id: 'code',
        pid: 1,
        process: 'code',
        project: 'demo',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        minimized: false,
        focused: true,
      },
    ]
    expect(targetLabel({ kind: 'window', id: 7 }, windows)).toBe('VS Code')
    expect(targetLabel({ kind: 'display', id: 0 }, windows)).toBe('Display 1')
    expect(targetLabel({ kind: 'desktop' }, windows)).toBe('Desktop')
  })
})

describe('REMOTE_STATE_LABEL', () => {
  it('covers every state so the UI never shows an empty label', () => {
    const states: RemoteState[] = [
      'idle',
      'connecting',
      'connected',
      'reconnecting',
      'disconnected',
      'permission_required',
      'unauthorized',
      'unsupported',
      'error',
    ]
    for (const state of states) {
      expect(REMOTE_STATE_LABEL[state]).toBeTruthy()
    }
  })
})

describe('isRemoteFrame', () => {
  it('accepts well-formed frames and rejects junk', () => {
    expect(isRemoteFrame({ type: 'Pong' })).toBe(true)
    expect(isRemoteFrame(null)).toBe(false)
    expect(isRemoteFrame({ payload: {} })).toBe(false)
  })
})