/**
 * Native pairing gate.
 *
 * The PWA is served *by* the daemon, so pairing there works by opening
 * `<base>/mobile/pair?offer=…&secret=…` directly — the app is already on the
 * right origin. The native shell is bundled, so it has no such URL: it needs
 * the daemon's address before it can call anything.
 *
 * Two ways in, both landing on the same offer exchange:
 *   - scan the code on the desktop's pairing page with the camera;
 *   - paste the link, for simulators and for when the camera is unavailable.
 *
 * Only rendered when `isNativeApp()`, so the browser path is untouched.
 */

import { useState } from 'react'
import { PairingScreen } from './Pairing'
import { QrScanner } from './QrScanner'
import { haptic } from '@/lib/nativeUX'
import { parsePairingLink, setDeviceBaseUrl } from '@/lib/native'

export function NativePairingGate({ onPaired }: { onPaired: () => void }) {
  const [link, setLink] = useState('')
  const [mode, setMode] = useState<'idle' | 'scanning'>('idle')
  const [showPaste, setShowPaste] = useState(false)
  const [offer, setOffer] = useState<{ offerId: string; secret: string } | null>(null)
  const [error, setError] = useState<string>()

  function accept(text: string) {
    const parsed = parsePairingLink(text)
    if (!parsed) {
      haptic('error')
      setError(
        'That code is not an AgentDeck pairing link. It should look like http://<your-computer>:9120/mobile/pair?offer=…&secret=…',
      )
      return
    }
    setError(undefined)
    haptic('success')
    // Store the daemon origin first: every subsequent request is absolute
    // against it, including this offer exchange.
    setDeviceBaseUrl(parsed.baseUrl)
    setOffer({ offerId: parsed.offerId, secret: parsed.secret })
  }

  if (offer) {
    return <PairingScreen offerId={offer.offerId} secret={offer.secret} onPaired={onPaired} />
  }

  if (mode === 'scanning') {
    return <QrScanner onDetect={accept} onCancel={() => setMode('idle')} />
  }

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-6"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-11 items-center justify-center rounded-card bg-surface font-mono text-[13px] font-semibold text-accent shadow-card">
          AD
        </span>
        <h1 className="text-[17px] font-semibold text-ink">Pair with your desktop</h1>
        <p className="max-w-[34ch] text-[12.5px] leading-[1.6] text-ink-3">
          Open AgentDeck on your computer, go to the pairing page, and scan the code with
          this device.
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            haptic('tap')
            setMode('scanning')
          }}
          className="flex items-center justify-center gap-2 rounded-control bg-accent px-4 py-3 text-[13px] font-semibold text-accent-ink"
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
            <path d="M3 12h18" />
          </svg>
          Scan pairing code
        </button>

        <button
          type="button"
          onClick={() => setShowPaste((open) => !open)}
          className="text-[12px] font-medium text-ink-3"
        >
          {showPaste ? 'Hide manual entry' : 'Enter the link manually'}
        </button>

        {showPaste ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="http://192.168.1.8:9120/mobile/pair?offer=…&secret=…"
              rows={3}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="w-full resize-none rounded-lg border border-line bg-field px-3 py-2 font-mono text-[16px] text-ink outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={() => accept(link)}
              disabled={link.trim().length === 0}
              className="rounded-control border border-line bg-surface px-3 py-2.5 text-[12.5px] font-medium text-ink disabled:opacity-40"
            >
              Pair this device
            </button>
          </div>
        ) : null}

        {error ? <p className="text-[12px] leading-[1.5] text-red">{error}</p> : null}
      </div>
    </div>
  )
}
