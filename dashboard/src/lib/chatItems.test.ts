import { describe, expect, it } from 'vitest'
import { formatDuration } from './chatItems'

describe('formatDuration', () => {
  it('formats sub-minute durations as Ns', () => {
    expect(formatDuration(0)).toBe('1s')
    expect(formatDuration(500)).toBe('1s')
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(18000)).toBe('18s')
    expect(formatDuration(59000)).toBe('59s')
  })

  it('formats minute-plus durations with zero-padded seconds', () => {
    expect(formatDuration(60000)).toBe('1m 00s')
    expect(formatDuration(72000)).toBe('1m 12s')
    expect(formatDuration(120000)).toBe('2m 00s')
    expect(formatDuration(124000)).toBe('2m 04s')
  })

  it('rounds to the nearest second without decimals', () => {
    expect(formatDuration(1500)).toBe('2s')
    expect(formatDuration(450)).toBe('1s')
  })
})
