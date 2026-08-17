import { describe, expect, it } from 'vitest'
import { PRIMARY_KEYS, SECONDARY_KEYS } from './TerminalCommandBar'

describe('terminal command controls', () => {
  it('keeps primary controls mapped to terminal bytes', () => {
    expect(Object.fromEntries(PRIMARY_KEYS.map((key) => [key.label, key.send]))).toEqual({
      'Ctrl+C': '\x03',
      Enter: '\r',
      Tab: '\t',
      '↑': '\x1b[A',
      '↓': '\x1b[B',
      Esc: '\x1b',
    })
  })

  it('keeps secondary controls mapped to terminal bytes', () => {
    expect(Object.fromEntries(SECONDARY_KEYS.map((key) => [key.label, key.send]))).toEqual({
      'Ctrl+D': '\x04',
      'Ctrl+Z': '\x1a',
      'Ctrl+L': '\x0c',
      '←': '\x1b[D',
      '→': '\x1b[C',
      Home: '\x1b[H',
      End: '\x1b[F',
      PgUp: '\x1b[5~',
      PgDn: '\x1b[6~',
      Clear: '\x0c',
    })
  })
})
