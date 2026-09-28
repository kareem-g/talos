/**
 * Route fallback cover. The daemon advertises several ways to reach it (tailnet
 * MagicDNS, tailnet IP, home LAN) and no single one works from everywhere: a
 * phone with MagicDNS off cannot resolve the `.ts.net` name, and a phone away
 * from home cannot use the LAN address. These pin the two behaviours that keep
 * a paired device reachable — remembering every route, and rotating to the next
 * one when the active route stops answering.
 */

import { deviceBaseUrl, deviceRoutes, setDeviceBaseUrl } from '../native'
import { advanceRoute, savePairing } from '../pairing'
import { clearCredentials } from '../secureStore'

const TAILNET_NAME = 'http://kareem.taile90653.ts.net:9120'
const TAILNET_IP = 'http://100.94.122.121:9120'
const LAN = 'http://192.168.1.8:9120'

beforeEach(async () => {
  await clearCredentials()
})

describe('savePairing', () => {
  it('stores the winning origin as active and keeps the rest for failover', async () => {
    await savePairing(TAILNET_IP, 'token-abcdefghijklmnopqrstuvwxyz012345', [TAILNET_NAME, LAN])
    expect(deviceBaseUrl()).toBe(TAILNET_IP)
    // Winner first: it is the route this phone just proved it can reach.
    expect(deviceRoutes()).toEqual([TAILNET_IP, TAILNET_NAME, LAN])
  })

  it('degrades to a single route when the QR carried no alternates', async () => {
    await savePairing(LAN, 'token-abcdefghijklmnopqrstuvwxyz012345')
    expect(deviceRoutes()).toEqual([LAN])
  })
})

describe('advanceRoute', () => {
  it('walks the advertised routes in order without revisiting a failed one', async () => {
    await savePairing(TAILNET_NAME, 'token-abcdefghijklmnopqrstuvwxyz012345', [TAILNET_IP, LAN])
    const attempted: string[] = []

    expect(advanceRoute(TAILNET_NAME, attempted)).toBe(TAILNET_IP)
    expect(deviceBaseUrl()).toBe(TAILNET_IP)
    attempted.push(TAILNET_NAME)

    expect(advanceRoute(TAILNET_IP, attempted)).toBe(LAN)
    expect(deviceBaseUrl()).toBe(LAN)
    attempted.push(TAILNET_IP)

    // Every route ruled out: report nothing left rather than bouncing back to
    // the tailnet name we already know does not resolve here.
    expect(advanceRoute(LAN, attempted)).toBeNull()
  })

  it('reaches the third route even though rotating moves the active origin', async () => {
    await savePairing(TAILNET_NAME, 'token-abcdefghijklmnopqrstuvwxyz012345', [TAILNET_IP, LAN])
    // The socket dialled the name, failed, rotated onto the IP and failed
    // again — the active origin is now the IP, but the third route must still
    // be reachable rather than wrapping to the name.
    setDeviceBaseUrl(TAILNET_IP)
    expect(advanceRoute(TAILNET_NAME, [TAILNET_NAME, TAILNET_IP])).toBe(LAN)
  })

  it('wraps around for the next outage once it reconnects elsewhere', async () => {
    await savePairing(TAILNET_NAME, 'token-abcdefghijklmnopqrstuvwxyz012345', [LAN])
    // Paired over the tailnet, now at home on the LAN with a fresh outage.
    setDeviceBaseUrl(LAN)
    expect(advanceRoute(LAN, [])).toBe(TAILNET_NAME)
  })

  it('reports nothing to try when there is only one route', async () => {
    await savePairing(LAN, 'token-abcdefghijklmnopqrstuvwxyz012345')
    expect(advanceRoute(LAN, [])).toBeNull()
    expect(deviceBaseUrl()).toBe(LAN)
  })
})
