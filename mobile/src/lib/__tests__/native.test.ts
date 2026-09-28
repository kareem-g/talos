/**
 * Regression cover for the pairing bug: the daemon origin must be set before any
 * request, because React Native has no page origin to resolve a relative URL
 * against. These pin resolveApiUrl/socketOrigin/parsePairingLink — the contract
 * PairingScreen relies on when it calls setDeviceBaseUrl() before verify().
 */

import {
  deviceBaseUrl,
  deviceRoutes,
  parsePairingLink,
  resolveApiUrl,
  setDeviceBaseUrl,
  setDeviceRoutes,
  socketOrigin,
} from '../native'

beforeEach(() => {
  setDeviceBaseUrl(null)
  setDeviceRoutes(null)
})

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
      baseUrls: ['http://kareem.taile90653.ts.net:9120'],
      offerId: 'abc123',
      secret: 'xyz789',
    })
  })

  it('rejects URLs that are not a pairing target', () => {
    expect(parsePairingLink('http://example.com/')).toBeNull()
    expect(parsePairingLink('http://host:9120/mobile/pair?offer=only')).toBeNull()
    expect(parsePairingLink('not a url')).toBeNull()
  })

  /**
   * The regression this whole change is about: the daemon encodes the tailnet
   * MagicDNS name as the primary origin and lists the routes that actually
   * resolve on a phone with MagicDNS off. Parsing only the primary is what made
   * a tailnet QR fail while the Home LAN QR worked.
   */
  it('carries the advertised alternate routes, primary first', () => {
    const parsed = parsePairingLink(
      'http://kareem.taile90653.ts.net:9120/mobile/pair?offer=abc&secret=xyz' +
        '&alt=http://100.94.122.121:9120,http://192.168.1.8:9120',
    )
    expect(parsed?.baseUrls).toEqual([
      'http://kareem.taile90653.ts.net:9120',
      'http://100.94.122.121:9120',
      'http://192.168.1.8:9120',
    ])
  })

  it('decodes percent-encoded alternates and drops unusable ones', () => {
    const parsed = parsePairingLink(
      'http://lan:9120/mobile/pair?offer=abc&secret=xyz' +
        '&alt=http%3A%2F%2F100.94.122.121%3A9120,not-a-url,lan:9120,http://lan:9120',
    )
    expect(parsed?.baseUrls).toEqual(['http://lan:9120', 'http://100.94.122.121:9120'])
  })
})

describe('deviceRoutes', () => {
  it('lists the routes with the active origin first', () => {
    setDeviceBaseUrl('http://192.168.1.8:9120')
    setDeviceRoutes(['http://100.94.122.121:9120', 'http://192.168.1.8:9120'])
    expect(deviceRoutes()).toEqual([
      'http://192.168.1.8:9120',
      'http://100.94.122.121:9120',
    ])
  })

  it('falls back to the single active origin for a pre-route pairing', () => {
    setDeviceBaseUrl('http://192.168.1.8:9120')
    expect(deviceRoutes()).toEqual(['http://192.168.1.8:9120'])
  })

  it('is empty when unpaired', () => {
    expect(deviceRoutes()).toEqual([])
  })

  it('ignores entries that are not http origins', () => {
    setDeviceRoutes(['ftp://host:9120', 'http://ok:9120', ''])
    expect(deviceRoutes()).toEqual(['http://ok:9120'])
  })
})
