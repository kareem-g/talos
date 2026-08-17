import { describe, expect, it } from 'vitest'
import { isValidTerminalDimensions, terminalDimensionsChanged } from './useTerminalResize'

describe('terminal resize measurements', () => {
  it('rejects zero and fractional dimensions', () => {
    expect(isValidTerminalDimensions({ cols: 0, rows: 24 })).toBe(false)
    expect(isValidTerminalDimensions({ cols: 80, rows: 0 })).toBe(false)
    expect(isValidTerminalDimensions({ cols: 80.5, rows: 24 })).toBe(false)
    expect(isValidTerminalDimensions({ cols: 80, rows: 24 })).toBe(true)
  })

  it('only reports valid dimension changes', () => {
    expect(terminalDimensionsChanged(null, { cols: 80, rows: 24 })).toBe(true)
    expect(terminalDimensionsChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false)
    expect(terminalDimensionsChanged({ cols: 80, rows: 24 }, { cols: 81, rows: 24 })).toBe(true)
    expect(terminalDimensionsChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 0 })).toBe(false)
  })
})
