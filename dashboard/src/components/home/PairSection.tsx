/**
 * RemoteScreen — everything about "leave it running at home, control from
 * anywhere", in one place, entirely in the browser.
 *
 * Three questions answered here:
 *   1. Where is this machine reachable?      (endpoint card)
 *   2. How does a new device get access?     (QR pairing)
 *   3. Which devices already have access?    (device list + revoke)
 *
 * No companion app: scanning the QR opens this same SPA on the phone, which
 * pairs, stores its token, and installs to the home screen as a PWA.
 */

import { useCallback, useEffect, useState } from 'react'
import { PairDeviceLayerContent } from '../Pairing'
import { Button, Chip, CopyButton, Dots, EmptyState, SectionLabel } from '../ui'
import { devicesApi, pairingApi, type PairedDeviceInfo } from '@/lib/api'
import {
  notificationState,
  requestNotificationPermission,
  type NotificationSupport,
} from '@/lib/notify'
import { formatFingerprint } from '@/lib/pairing'
import { cn, relativeTime } from '@/lib/format'

function EndpointSourceChip({ source }: { source: string }) {
  const label =
    source === 'cloudflare'
      ? 'Cloudflare'
      : source === 'tailnet_magic_dns'
        ? 'Tailnet'
        : source.startsWith('tailnet')
          ? 'Tailnet'
          : source === 'lan'
            ? 'LAN'
            : source === 'localhost'
              ? 'Local only'
              : source
  const tone =
    source === 'cloudflare' || source === 'explicit'
      ? 'accent'
      : source.startsWith('tailnet')
        ? 'green'
        : source === 'lan'
          ? 'orange'
          : 'default'
  return <Chip tone={tone}>{label}</Chip>
}

/** Card 1: where the station is reachable and how healthy that path is. */
function EndpointCard() {
  const [endpoint, setEndpoint] = useState<Awaited<ReturnType<typeof pairingApi.endpoint>>['endpoint']>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setEndpoint((await pairingApi.endpoint()).endpoint)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not look up connectivity')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <header className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <h3 className="text-[12.5px] font-medium text-ink">Connectivity</h3>
        <Button onClick={() => void refresh()} disabled={loading} className="min-h-7 px-2 text-[11px]">
          Refresh
        </Button>
      </header>
      <div className="flex flex-col gap-2 p-3.5">
        {loading && !endpoint ? <Dots label="Resolving endpoints…" /> : null}
        {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
        {endpoint ? (
          <>
            <div className="flex items-center gap-2">
              <EndpointSourceChip source={endpoint.source} />
              <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-2">{endpoint.host}</span>
              {endpoint.via ? (
                <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-px font-mono text-[9.5px] text-ink-3">
                  via {endpoint.via}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className={cn(endpoint.reachable ? 'text-green' : 'text-orange')}>
                {endpoint.reachable ? 'Reachable' : 'Unreachable from here'}
              </span>
              <span className={endpoint.secure ? 'text-green' : 'text-ink-3'}>
                {endpoint.secure ? 'HTTPS' : 'HTTP'}
              </span>
              <span className="font-mono text-ink-3">:{endpoint.port}</span>
            </div>
            <div className="flex items-center gap-1 rounded-control bg-inset px-2 py-1.5">
              <code className="scroll-thin min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-ink-3">
                {endpoint.base_url}
              </code>
              <CopyButton value={endpoint.base_url} />
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}

/** Card 3: every remote control allowed to touch this machine. */
function DevicesCard() {
  const [devices, setDevices] = useState<PairedDeviceInfo[]>()
  const [error, setError] = useState<string>()
  const [revoking, setRevoking] = useState<string>()

  const refresh = useCallback(() => {
    devicesApi
      .list()
      .then((result) => {
        setDevices(result.devices ?? [])
        setError(undefined)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load devices'))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function revoke(id: string) {
    setRevoking(id)
    try {
      await devicesApi.revoke(id)
      // The revoked device's socket dies server-side; drop the row immediately.
      setDevices((current) => current?.filter((device) => device.id !== id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not revoke')
    } finally {
      setRevoking(undefined)
    }
  }

  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <header className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <h3 className="text-[12.5px] font-medium text-ink">Paired devices</h3>
        <Chip>{devices?.length ?? '…'}</Chip>
      </header>
      <div className="flex flex-col p-1.5">
        {error ? <p className="px-2 py-2 text-[11.5px] text-red">{error}</p> : null}
        {devices === undefined ? (
          <div className="p-3">
            <Dots label="Loading devices…" />
          </div>
        ) : devices.length === 0 ? (
          <EmptyState title="No paired devices" description="Generate a QR below to add one." />
        ) : (
          devices.map((device) => (
            <div key={device.id} className="flex min-h-11 items-center gap-2.5 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] text-ink">{device.name}</p>
                <p className="truncate text-[11px] text-ink-3">
                  <span className="font-mono">{formatFingerprint(device.fingerprint)}</span>
                  {device.last_seen ? ` · seen ${relativeTime(device.last_seen)}` : ''}
                </p>
              </div>
              <Button
                variant="danger"
                disabled={revoking === device.id}
                onClick={() => void revoke(device.id)}
                className="min-h-7 shrink-0 px-2 text-[11px]"
              >
                {revoking === device.id ? 'Revoking…' : 'Revoke'}
              </Button>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

/** Card 4: system-level nudges when an agent needs attention off-screen. */
function NotificationsCard() {
  const [state, setState] = useState<NotificationSupport>(() => notificationState())

  async function enable() {
    setState(await requestNotificationPermission())
  }

  const labels: Record<NotificationSupport, string> = {
    granted: 'On',
    denied: 'Blocked by browser',
    default: 'Off',
    unsupported: 'Not supported here',
  }

  return (
    <section className="rounded-card border border-line bg-surface shadow-card">
      <header className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <h3 className="text-[12.5px] font-medium text-ink">Attention alerts</h3>
        <Chip tone={state === 'granted' ? 'green' : state === 'denied' ? 'red' : 'default'}>
          {labels[state]}
        </Chip>
      </header>
      <div className="flex flex-col gap-2 p-3.5">
        <p className="text-[11.5px] leading-[1.6] text-ink-2">
          Get a system alert when an agent needs approval or finishes while Plumb is in the
          background. Alerts are local to this browser — nothing leaves your machine.
        </p>
        {state !== 'granted' && state !== 'unsupported' ? (
          <Button variant="primary" onClick={() => void enable()} className="self-start">
            Enable alerts
          </Button>
        ) : null}
      </div>
    </section>
  )
}
// declared after EndpointCard so the refresh hook above stays hoisted

export function PairSection() {
  return (
    <div className="flex flex-col gap-4">
      {/* QR pairing, inline — the phone-side flow lives at /?offer=…&secret=… */}
      <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        <header className="border-b border-line px-3.5 py-2.5">
          <h3 className="text-[12.5px] font-medium text-ink">Pair a new device</h3>
        </header>
        <PairDeviceLayerContent />
      </section>

      <SectionLabel>Access</SectionLabel>
      <DevicesCard />

      <SectionLabel>Machine</SectionLabel>
      <EndpointCard />
      <NotificationsCard />
    </div>
  )
}
