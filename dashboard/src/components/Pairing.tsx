/**
 * Pairing — how a phone gets permission to control this machine.
 *
 * The desktop asks the daemon for an offer and shows a QR code. The phone scans
 * it, loads the app at `/mobile/pair?offer=…&secret=…`, and exchanges those
 * values for a bearer token. The token is minted once and only its hash is
 * stored server-side.
 *
 * The offer expires in two minutes, which is short enough to matter: the UI
 * counts down and offers a new code rather than letting someone scan a dead one.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Check, CopyButton, Dots, IconButton, Close } from './ui'
import { ApiError, pairingApi, setDeviceToken } from '@/lib/api'
import { cn } from '@/lib/format'
import { formatFingerprint } from '@/lib/pairing'

/* ── QR rendering ──────────────────────────────────────────────────────────
 * `qrcode.react` is already a dependency and renders to SVG, which stays crisp
 * at any size and needs no canvas sizing dance.
 */
import { QRCodeSVG } from 'qrcode.react'

/** Seconds until an ISO timestamp, floored at zero. */
function secondsUntil(iso: string): number {
  const remaining = Math.floor((new Date(iso).getTime() - Date.now()) / 1000)
  return Number.isNaN(remaining) ? 0 : Math.max(0, remaining)
}

/**
 * Desktop side: request an offer, show the QR, count down, refresh.
 */
export function PairDeviceLayerContent() {
  const [offer, setOffer] = useState<Awaited<ReturnType<typeof pairingApi.offer>>>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [remaining, setRemaining] = useState(0)

  const request = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const next = await pairingApi.offer()
      setOffer(next)
      setRemaining(secondsUntil(next.expires_at))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a pairing code')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void request()
  }, [request])

  // Tick the countdown. Derived from the expiry timestamp rather than a
  // decrementing counter, so a backgrounded tab shows the truth on return.
  useEffect(() => {
    if (!offer) return
    const timer = setInterval(() => setRemaining(secondsUntil(offer.expires_at)), 1000)
    return () => clearInterval(timer)
  }, [offer])

  const expired = offer !== undefined && remaining === 0

  return (
    <div className="flex flex-col items-center gap-3 px-2.5 py-2">
      {loading && !offer ? (
        <div className="py-10">
          <Dots label="Creating a pairing code…" />
        </div>
      ) : null}

      {error ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <p className="text-center text-[12px] leading-[1.6] text-red">{error}</p>
          <Button onClick={() => void request()}>Try again</Button>
        </div>
      ) : null}

      {offer && !error ? (
        <>
          <div
            className={cn(
              'rounded-card bg-white p-3 shadow-card transition-opacity duration-200',
              expired && 'opacity-25',
            )}
          >
            <QRCodeSVG value={offer.qr_data} size={188} level="M" marginSize={0} />
          </div>

          {expired ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-[12px] text-orange">This code has expired.</p>
              <Button variant="primary" onClick={() => void request()}>
                New code
              </Button>
            </div>
          ) : (
            <>
              <p className="max-w-80 text-center text-[12px] leading-[1.6] text-ink-2">
                Scan with your phone's camera to control this machine remotely.
              </p>
              <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
                <span className="tabular-nums">
                  Expires in {Math.floor(remaining / 60)}:
                  {String(remaining % 60).padStart(2, '0')}
                </span>
                <span aria-hidden>·</span>
                {/* Shown so the phone's displayed fingerprint can be compared
                    out of band, confirming nothing intercepted the exchange. */}
                <span className="font-mono">{formatFingerprint(offer.fingerprint)}</span>
              </div>
              {offer.endpoint ? (
                <div className="flex max-w-80 flex-col items-center gap-1.5 rounded-control border border-line bg-inset px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px]">
                    <span
                      className={cn(
                        'rounded-chip px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                        offer.endpoint.source === 'cloudflare'
                          ? 'bg-accent-tint text-accent-ink'
                          : offer.endpoint.source === 'tailnet_magic_dns' || offer.endpoint.source === 'tailnet_ipv4' || offer.endpoint.source === 'tailnet_ipv6'
                            ? 'bg-green-tint text-green'
                            : offer.endpoint.source === 'lan'
                              ? 'bg-orange-tint text-orange'
                              : 'bg-field text-ink-3',
                      )}
                    >
                      {offer.endpoint.source === 'cloudflare'
                        ? 'Cloudflare'
                        : offer.endpoint.source === 'tailnet_magic_dns'
                          ? 'Tailnet'
                          : offer.endpoint.source === 'tailnet_ipv4'
                            ? 'Tailnet IPv4'
                            : offer.endpoint.source === 'tailnet_ipv6'
                              ? 'Tailnet IPv6'
                              : offer.endpoint.source === 'lan'
                                ? 'LAN'
                                : offer.endpoint.source}
                    </span>
                    <span className="font-mono text-ink-3">{offer.endpoint.host}</span>
                    {offer.endpoint.secure ? <span className="text-green">· secure</span> : null}
                    {!offer.endpoint.reachable ? <span className="text-orange">· unreachable</span> : null}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="max-w-48 truncate font-mono text-[11px] text-ink-3">{offer.qr_data}</span>
                    <CopyButton value={offer.qr_data} label="Copy" />
                  </span>
                </div>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  )
}

/**
 * Phone side: exchange the scanned offer for a token.
 *
 * Rendered when the URL carries `offer` and `secret`. On success the token is
 * stored and the app reloads into its normal state.
 */
export function PairingScreen({
  offerId,
  secret,
  onPaired,
}: {
  offerId: string
  secret: string
  onPaired: () => void
}) {
  const [state, setState] = useState<'idle' | 'pairing' | 'paired'>('idle')
  const [error, setError] = useState<string>()

  const deviceName = useMemo(() => {
    // A human-recognizable default so the desktop's device list is meaningful.
    const agent = navigator.userAgent
    if (/iPhone/.test(agent)) return 'iPhone'
    if (/iPad/.test(agent)) return 'iPad'
    if (/Android/.test(agent)) return 'Android phone'
    return 'Browser'
  }, [])

  /**
   * An opaque per-device value. The backend stores it alongside the device
   * record; it is not used to sign anything, so random bytes are sufficient and
   * generating a keypair would imply a guarantee that does not exist.
   */
  const deviceKey = useMemo(() => {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return btoa(String.fromCharCode(...bytes))
  }, [])

  async function pair() {
    setState('pairing')
    setError(undefined)
    try {
      const result = await pairingApi.verify({ offerId, secret, deviceKey, deviceName })
      setDeviceToken(result.token)
      setState('paired')
      // Brief pause so the confirmation is actually seen before the app swaps in.
      setTimeout(onPaired, 700)
    } catch (cause) {
      setState('idle')
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Pairing failed. The code may have expired — generate a new one.',
      )
    }
  }

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-11 items-center justify-center rounded-card bg-surface shadow-card">
          {state === 'paired' ? (
            <Check size={20} className="text-green" />
          ) : (
            <span className="font-mono text-[15px] font-medium text-accent-ink">AD</span>
          )}
        </span>
        <h1 className="text-[15px] font-medium text-ink">
          {state === 'paired' ? 'Paired' : 'Pair this device'}
        </h1>
        <p className="max-w-80 text-[12.5px] leading-[1.6] text-ink-2">
          {state === 'paired'
            ? 'Opening your sessions…'
            : 'This device will be able to start, watch, and stop agents on your machine.'}
        </p>
      </div>

      {error ? (
        <p className="max-w-80 rounded-control bg-red-tint px-3 py-2 text-center text-[12px] leading-[1.6] text-ink">
          {error}
        </p>
      ) : null}

      {state !== 'paired' ? (
        <Button
          variant="primary"
          onClick={() => void pair()}
          disabled={state === 'pairing'}
          className="min-h-11 w-full max-w-80"
        >
          {state === 'pairing' ? 'Pairing…' : 'Pair device'}
        </Button>
      ) : null}
    </div>
  )
}

/** Small header affordance that opens the pairing QR. */
export function PairButton({ onOpen }: { onOpen: () => void }) {
  return (
    <IconButton label="Pair a phone" onClick={onOpen}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M14 14h3v3h-3zM20 14v.01M20 20v.01M17 20v.01" />
      </svg>
    </IconButton>
  )
}

export { Close }
