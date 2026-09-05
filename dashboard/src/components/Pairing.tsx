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
import {
  ApiError,
  pairingApi,
  setDeviceToken,
  tunnelApi,
  type EndpointOption,
  type PairingOffer,
} from '@/lib/api'
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

/** Short transport name — the picker chip's primary text. */
function transportName(opt: EndpointOption): string {
  switch (opt.source) {
    case 'cloudflare':
      return 'Cloudflare'
    case 'tailnet':
    case 'tailnet_magic_dns':
    case 'tailnet_ipv4':
    case 'tailnet_ipv6':
      return 'Tailnet'
    case 'lan':
      return 'Home LAN'
    case 'localhost':
      return 'This machine'
    case 'explicit':
      return 'Custom'
    default:
      return opt.label ?? opt.source
  }
}

/** One-line hint explaining where this route works. Shown under the host
 *  pill so the choice is obvious before scanning. */
function transportHint(opt: EndpointOption): string {
  switch (opt.source) {
    case 'cloudflare':
      return 'Works anywhere — routed through your Cloudflare tunnel.'
    case 'tailnet':
    case 'tailnet_magic_dns':
    case 'tailnet_ipv4':
    case 'tailnet_ipv6':
      return 'Works anywhere — but the phone needs the Tailscale app ON and joined.'
    case 'lan':
      return 'Works at home — phone must be on the same Wi-Fi.'
    case 'localhost':
      return 'Works on this machine only.'
    case 'explicit':
      return 'Uses the address configured in settings.'
    default:
      return ''
  }
}

/** Signal-dot color per transport. Amber = the recommended private route,
 *  copper = close-range, ink = local-only. Matches the token system. */
function transportDot(opt: EndpointOption): string {
  switch (opt.source) {
    case 'cloudflare':
    case 'tailnet_magic_dns':
    case 'tailnet_ipv4':
    case 'tailnet_ipv6':
      return 'bg-accent'
    case 'lan':
      return 'bg-orange'
    default:
      return 'bg-ink-3'
  }
}

/**
 * Desktop side: one card that owns BOTH the route picker (Tailscale / LAN /
 * Cloudflare / …) AND the pairing QR. The QR is minted lazily against the
 * chosen transport, so picking a route re-encodes the QR — exactly what
 * the user means by "merge tunnels into the QR with the options before
 * generating the QRs".
 *
 * On first mount we auto-select the best reachable transport (Tailscale >
 * LAN > Cloudflare > Localhost) so the user lands on a usable QR without
 * any clicks, but the picker is visible right next to it so rerouting is
 * one tap.
 *
 * The offer expires in two minutes; the right column counts down and
 * mints a fresh offer when it hits zero.
 */
export function PairDeviceLayerContent() {
  return <ConnectPhoneCard />
}

/** Stable id for a transport row — used to compare picker state across
 *  the endpoint list (no qr_data) and the offer's qr_options (with
 *  qr_data). Composite of source, host, and port is enough because the
 *  daemon only ever emits one row per (source, host, port) tuple. */
function transportKey(opt: EndpointOption): string {
  return `${opt.source}:${opt.host}:${opt.port}`
}

/** Priority order for auto-select on first mount. Tailnet / Headscale
 *  first because they're the recommended private route; LAN second
 *  because it works at home; Cloudflare / Localhost last. */
function transportPriority(opt: EndpointOption): number {
  if (!opt.reachable) return 99
  switch (opt.source) {
    case 'tailnet':
    case 'tailnet_magic_dns':
    case 'tailnet_ipv4':
    case 'tailnet_ipv6':
      return 0
    case 'lan':
      return 1
    case 'cloudflare':
      return 2
    case 'localhost':
      return 3
    case 'explicit':
      return 0
    default:
      return 4
  }
}

function ConnectPhoneCard() {
  // Transport list — fetched once on mount, refreshed when tunnels change.
  const [endpoints, setEndpoints] = useState<EndpointOption[]>([])
  const [endpointsError, setEndpointsError] = useState<string>()
  const [endpointsLoading, setEndpointsLoading] = useState(true)

  // Which row the user has picked. Stored as the transport's stable key
  // so a fresh endpoint list (which has no qr_data) doesn't reset it.
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // Pairing offer for the currently selected transport. Re-minted when
  // the user picks a different transport, or when the offer expires.
  const [offer, setOffer] = useState<PairingOffer | null>(null)
  const [offerError, setOfferError] = useState<string>()
  const [offerLoading, setOfferLoading] = useState(false)
  const [remaining, setRemaining] = useState(0)
  // Bumped by "Try again" / "New code" to re-run the mint effect even when
  // the transport selection itself hasn't changed (setState with the same
  // value would no-op and never re-trigger it).
  const [mintNonce, setMintNonce] = useState(0)

  // Fetch the transport list on mount.
  const refreshEndpoints = useCallback(async () => {
    setEndpointsLoading(true)
    try {
      const list = await tunnelApi.endpoints()
      setEndpoints(list.endpoints)
      setEndpointsError(undefined)
    } catch (cause) {
      setEndpointsError(cause instanceof Error ? cause.message : 'Could not list tunnels')
    } finally {
      setEndpointsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshEndpoints()
  }, [refreshEndpoints])

  // Auto-select on first load: best reachable transport, or the first
  // row if nothing is reachable (Localhost is always there).
  useEffect(() => {
    if (selectedKey !== null) return
    if (endpoints.length === 0) return
    const sorted = [...endpoints].sort(
      (a, b) => transportPriority(a) - transportPriority(b),
    )
    setSelectedKey(transportKey(sorted[0]))
  }, [endpoints, selectedKey])

  // Bring a tunnel up from right here — the picker only lists live routes,
  // so without this a down tunnel has no on-ramp. Success refreshes the
  // list and re-runs auto-pick so the new route's QR is one tap away.
  const [bringBusy, setBringBusy] = useState<string | null>(null)
  const [bringError, setBringError] = useState<string>()
  const [cfToken, setCfToken] = useState('')
  const [cfHostname, setCfHostname] = useState('')

  async function bringUp(kind: 'tailscale' | 'cloudflare') {
    setBringBusy(kind)
    setBringError(undefined)
    try {
      if (kind === 'cloudflare') {
        if (!cfToken.trim() && !cfHostname.trim()) {
          setBringError(
            'Paste your Cloudflare tunnel token (named tunnel) OR a hostname for a quick trycloudflare tunnel.',
          )
          return
        }
        await tunnelApi.start('cloudflare', {
          ...(cfToken.trim() ? { token: cfToken.trim() } : {}),
          ...(cfHostname.trim() ? { hostname: cfHostname.trim() } : {}),
        })
      } else {
        await tunnelApi.start(kind)
      }
      await refreshEndpoints()
      // Let auto-pick choose the new best route (null re-arms the effect).
      setSelectedKey(null)
    } catch (cause) {
      setBringError(cause instanceof Error ? cause.message : `Could not bring ${kind} up`)
    } finally {
      setBringBusy(null)
    }
  }

  // Mint an offer whenever the selection changes (and on first auto-pick).
  useEffect(() => {
    if (!selectedKey) return
    let cancelled = false
    setOfferLoading(true)
    setOfferError(undefined)
    pairingApi
      .offer()
      .then((next) => {
        if (cancelled) return
        setOffer(next)
        setRemaining(secondsUntil(next.expires_at))
      })
      .catch((cause) => {
        if (cancelled) return
        setOfferError(
          cause instanceof Error ? cause.message : 'Could not create a pairing code',
        )
      })
      .finally(() => {
        if (!cancelled) setOfferLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedKey, mintNonce])

  // Countdown ticker.
  useEffect(() => {
    if (!offer) return
    const timer = setInterval(
      () => setRemaining(secondsUntil(offer.expires_at)),
      1000,
    )
    return () => clearInterval(timer)
  }, [offer])

  // Auto-refresh when the offer hits zero — keep the QR alive.
  useEffect(() => {
    if (!offer) return
    if (remaining > 0) return
    let cancelled = false
    pairingApi
      .offer()
      .then((next) => {
        if (cancelled) return
        setOffer(next)
        setRemaining(secondsUntil(next.expires_at))
      })
      .catch(() => {
        /* leave expired state visible — the user can hit "New code" */
      })
    return () => {
      cancelled = true
    }
  }, [remaining, offer])

  // The currently selected transport row. We need both the picker info
  // (host, source, reachable) AND a QR payload — the offer's qr_options
  // carries qr_data per row; fall back to rebuilding from base_url.
  const selected = useMemo(
    () => endpoints.find((e) => transportKey(e) === selectedKey) ?? null,
    [endpoints, selectedKey],
  )

  // Build the QR data: prefer the server-baked per-option URL, else
  // recompose from base_url + the offer's id/secret.
  const qrPayload = useMemo(() => {
    if (!offer || !selected) return ''
    const matchFromList = offer.qr_options?.find(
      (o) => transportKey(o) === selectedKey,
    )
    if (matchFromList?.qr_data) return matchFromList.qr_data
    const secret = offerSecret(offer)
    return `${selected.base_url}/mobile/pair?offer=${encodeURIComponent(offer.offer_id)}&secret=${encodeURIComponent(secret)}`
  }, [offer, selected, selectedKey])

  const expired = offer !== null && remaining === 0

  return (
    <div className="flex flex-col gap-4 px-3 py-3 lg:grid lg:grid-cols-[minmax(180px,240px)_1fr] lg:items-start lg:gap-5">
      {/* ── Transport list (left) ────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <p className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-ink-3">
          Route to phone
        </p>
        {endpointsLoading ? (
          <div className="py-2">
            <Dots label="Listing tunnels…" />
          </div>
        ) : endpointsError ? (
          <div className="flex flex-col gap-1.5 rounded-control border border-red/20 bg-red-tint px-2.5 py-2">
            <p className="text-[11px] leading-[1.5] text-ink">{endpointsError}</p>
            <Button variant="ghost" onClick={() => void refreshEndpoints()} className="min-h-6 px-2 text-[10.5px]">
              Retry
            </Button>
          </div>
        ) : endpoints.length === 0 ? (
          <p className="text-[11px] leading-[1.5] text-ink-3">No tunnels configured.</p>
        ) : (
          <ul className="flex flex-col gap-1" role="radiogroup" aria-label="Transport">
            {endpoints.map((opt) => {
              const key = transportKey(opt)
              const active = key === selectedKey
              return (
                <li key={key}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelectedKey(key)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-control border px-2.5 py-2 text-left transition-colors duration-150',
                      active
                        ? 'border-accent/40 bg-accent-tint'
                        : 'border-line/40 bg-inset hover:border-line-strong',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block size-1.5 shrink-0 rounded-full',
                        active ? 'bg-accent' : transportDot(opt),
                      )}
                      aria-hidden
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        className={cn(
                          'text-[12px] font-medium',
                          active ? 'text-accent-ink' : 'text-ink',
                        )}
                      >
                        {transportName(opt)}
                      </span>
                      <span className="truncate font-mono text-[10px] text-ink-3">{opt.host}</span>
                    </span>
                    {!opt.reachable ? (
                      <span className="shrink-0 text-[9px] font-medium uppercase tracking-wider text-orange">
                        down
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="mt-1 flex flex-col gap-1">
          <p className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-ink-3">
            Bring up
          </p>
          {(['tailscale', 'cloudflare'] as const).map((kind) => (
            <div key={kind} className="flex items-center gap-1.5">
              <span className="w-[68px] shrink-0 text-[11px] font-medium capitalize text-ink-2">
                {kind}
              </span>
              {kind === 'cloudflare' ? (
                <input
                  value={cfHostname}
                  onChange={(e) => setCfHostname(e.target.value)}
                  placeholder="agentdeck.example.com (optional)"
                  aria-label="Cloudflare tunnel hostname"
                  spellCheck={false}
                  inputMode="url"
                  className="h-7 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 font-mono text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/25"
                />
              ) : (
                <span className="min-w-0 flex-1" />
              )}
              <Button
                variant="ghost"
                disabled={bringBusy !== null}
                onClick={() => void bringUp(kind)}
                className="min-h-7 shrink-0 px-2 text-[10.5px]"
              >
                {bringBusy === kind ? '…' : 'Up'}
              </Button>
            </div>
          ))}
          <input
            value={cfToken}
            onChange={(e) => setCfToken(e.target.value)}
            placeholder="Cloudflare tunnel token (optional if hostname set, stored on success)"
            aria-label="Cloudflare tunnel token"
            type="password"
            autoComplete="off"
            className="h-7 w-full rounded-lg border border-white/10 bg-black/30 px-2 font-mono text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/25"
          />
          {bringError ? <p className="text-[10.5px] leading-snug text-red">{bringError}</p> : null}
        </div>
        <TunnelHealthHint />
      </div>

      {/* ── QR card (right on desktop, FIRST on phones so the code is
          visible without scrolling past the route list) ─────────────── */}
      <div className="flex flex-col items-center gap-3 max-lg:-order-1 max-lg:pb-16">
        {offerError ? (
          <div className="flex w-full flex-col items-center gap-2 py-6">
            <p className="text-center text-[12px] leading-[1.6] text-red">{offerError}</p>
            <Button onClick={() => setMintNonce((n) => n + 1)}>Try again</Button>
          </div>
        ) : (
          <>
            <div
              className={cn(
                'rounded-card bg-white p-3 shadow-card ring-1 ring-accent/25 transition-opacity duration-200',
                expired && 'opacity-30',
              )}
              style={{ minWidth: 204, minHeight: 204 }}
            >
              {offerLoading || !qrPayload ? (
                <div
                  className="flex flex-col items-center justify-center gap-1.5 text-ink-3"
                  style={{ width: 188, height: 188 }}
                >
                  <Dots label="Preparing…" />
                </div>
              ) : (
                <QRCodeSVG
                  key={qrPayload}
                  value={qrPayload}
                  size={188}
                  level="M"
                  marginSize={0}
                />
              )}
            </div>

            {selected ? (
              <div className="flex flex-col items-center gap-1" aria-live="polite">
                <span className="flex max-w-full items-center gap-2 rounded-control bg-inset px-3 py-1.5">
                  <span
                    className={cn(
                      'inline-block size-1.5 shrink-0 rounded-full',
                      transportDot(selected),
                    )}
                    aria-hidden
                  />
                  <span className="truncate font-mono text-[12px] text-ink">
                    {selected.host}
                  </span>
                  {selected.secure ? (
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-ink-3">
                      https
                    </span>
                  ) : null}
                </span>
                <p className="text-[10.5px] leading-[1.5] text-ink-3">
                  {transportHint(selected)}
                </p>
              </div>
            ) : null}

            {qrPayload ? (
              <div className="flex w-full max-w-96 items-center gap-2 rounded-control bg-inset px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">
                  {qrPayload}
                </span>
                <CopyButton value={qrPayload} label="Copy" />
              </div>
            ) : null}

            {offer ? (
              <div className="flex items-center gap-2 text-[11px] text-ink-3">
                <span className="tabular-nums">
                  Expires in {Math.floor(remaining / 60)}:
                  {String(remaining % 60).padStart(2, '0')}
                </span>
                <span aria-hidden>·</span>
                <span className="font-mono">{formatFingerprint(offer.fingerprint)}</span>
              </div>
            ) : null}

            {expired && offer ? (
              <Button
                variant="primary"
                onClick={() => setMintNonce((n) => n + 1)}
                className="min-h-8 px-3 text-[11px]"
              >
                New code
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The offer's secret is only present in the QR URL — the API deliberately
 * keeps it out of the typed response so a stray `JSON.stringify(offer)` in
 * the console doesn't leak it. Recover it from the default `qr_data` when
 * the picker needs to rebuild a URL for a different transport.
 */
function offerSecret(offer: PairingOffer): string {
  const match = offer.qr_data.match(/[?&]secret=([^&]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

/** Short paragraph below the transport list that explains how to add a
 *  route that's missing — keeps the user oriented when the picker is
 *  empty or only shows Localhost. */
function TunnelHealthHint() {
  const [tailscaleConnected, setTailscaleConnected] = useState<boolean | null>(null)
  const [cloudflareEnabled, setCloudflareEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    tunnelApi
      .status()
      .then((s) => {
        if (cancelled) return
        // /api/tunnel/status returns loose objects — typed as `unknown` in
        // the client. Read the few fields we care about with minimal shape.
        const ts = (s as { tailscale?: { connected?: boolean } }).tailscale
        const cf = (s as { cloudflare?: { enabled?: boolean } }).cloudflare
        setTailscaleConnected(Boolean(ts?.connected))
        setCloudflareEnabled(Boolean(cf?.enabled))
      })
      .catch(() => {
        /* non-fatal — the picker already shows the truth */
      })
    return () => {
      cancelled = true
    }
  }, [])
  if (tailscaleConnected === null || cloudflareEnabled === null) return null
  if (tailscaleConnected || cloudflareEnabled) return null
  return (
    <p className="mt-1 text-[10.5px] leading-[1.55] text-ink-3">
      No public route — connect Tailscale or Cloudflare below so the
      phone can reach this machine from anywhere.
    </p>
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
