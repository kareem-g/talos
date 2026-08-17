import { useSearchParams } from 'react-router-dom'
import { getDeviceCredential } from '../../lib/auth'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { MobileApp } from '../MobileApp'
import { MobilePairingPage } from '../MobilePairingPage'

/**
 * Mobile shell of the root application (rendered below the `lg` breakpoint).
 *
 * The pairing component lives inside the same tree as the desktop app: on
 * mobile viewports an unpaired device sees the pairing experience inline at
 * `/`; once paired (or when the device has a credential) the same URL renders
 * the remote-control workspace/task app. Desktop viewports never mount this
 * shell, so no duplicate WebSocket connections are opened on desktop.
 */
export function MobileRoot() {
  const isMobile = useMediaQuery('(max-width: 1023px)')
  const [searchParams] = useSearchParams()
  const credential = getDeviceCredential()
  const hasPairingParams = Boolean(searchParams.get('offer') && searchParams.get('secret'))

  if (!isMobile) return null

  // Keying the pairing screen on the offer/secret params lets the pairing
  // effect re-run when the user pastes a new pairing URL — no page reload.
  const pairingKey = `${searchParams.get('offer') || ''}:${searchParams.get('secret') || ''}`

  if (!credential || hasPairingParams) {
    return <MobilePairingPage key={pairingKey} />
  }

  return <MobileApp />
}
