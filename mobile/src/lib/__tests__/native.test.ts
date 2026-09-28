/**
 * Regression cover for the pairing bug: the daemon origin must be set before any
 * request, because React Native has no page origin to resolve a relative URL
 * against. These pin resolveApiUrl/socketOrigin/parsePairingLink — the contract
 * PairingScreen relies on when it calls setDeviceBaseUrl() before verify().
 */

import {
  deviceBaseUrl,
  parsePairingLink,
  resolveApiUrl,
  setDeviceBaseUrl,
  socketOrigin,
} from '../native'

beforeEach(() => setDeviceBaseUrl(null))

describe('resolveApiUrl', () => {
  it('is relative with no origin set — the state that broke pairing', () => {
    expect(deviceBaseUrl()).toBe('')
    expect(resolveApiUrl('/api/pair/verify')).toBe('/api/pair/verify')
  })

  it('becomes absolute once the origin is set (what the fix ensures before verify)', () => {
    setDeviceBaseUrl('http://kareem.taile90653.ts.net:9120')
    expect(resolveApiUrl('/api/pair/verify')).toBe(
      'http://kareem.taile90653.ts.net:9120/api/pair/verify',
    )
  })

  it('trims a trailing slash on the stored origin', () => {
    setDeviceBaseUrl('http://host:9120/')
    expect(resolveApiUrl('/api/x')).toBe('http://host:9120/api/x')
  })

  it('leaves an already-absolute URL untouched', () => {
    setDeviceBaseUrl('http://host:9120')
    expect(resolveApiUrl('https://other/api')).toBe('https://other/api')
  })
})

describe('socketOrigin', () => {
  it('rewrites the stored http origin to ws', () => {
    setDeviceBaseUrl('http://kareem.taile90653.ts.net:9120')
    expect(socketOrigin()).toBe('ws://kareem.taile90653.ts.net:9120')
  })

  it('is empty when unpaired, so connect() stays idle rather than dialing a bad URL', () => {
    expect(socketOrigin()).toBe('')
  })
})

describe('parsePairingLink', () => {
  it('extracts origin, offer, and secret from a daemon QR payload', () => {
    expect(
      parsePairingLink('http://kareem.taile90653.ts.net:9120/mobile/pair?offer=abc123&secret=xyz789'),
    ).toEqual({
      baseUrl: 'http://kareem.taile90653.ts.net:9120',
      offerId: 'abc123',
      secret: 'xyz789',
    })
  })

  it('rejects URLs that are not a pairing target', () => {
    expect(parsePairingLink('http://example.com/')).toBeNull()
    expect(parsePairingLink('http://host:9120/mobile/pair?offer=only')).toBeNull()
    expect(parsePairingLink('not a url')).toBeNull()
  })
})
