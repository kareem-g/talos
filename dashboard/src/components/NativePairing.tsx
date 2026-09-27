/**
 * Native pairing gate.
 *
 * The PWA is served *by* the daemon, so pairing there works by opening
 * `<base>/mobile/pair?offer=…&secret=…` directly — the app is already on the
 * right origin. The native shell is bundled, so it has no such URL: it needs
 * the daemon's address before it can call anything.
 *
 * This screen takes the pairing link (from the desktop's QR page — the same
 * string the QR encodes), records that daemon origin, and then hands off to the
 * shared `PairingScreen`, which performs the offer exchange. Only rendered when
 * `isNativeApp()`, so the browser path is untouched.
 */

import { useState } from 'react'
import { PairingScreen } from './Pairing'
import { parsePairingLink, setDeviceBaseUrl } from '@/lib/native'

export function NativePairingGate({ onPaired }: { onPaired: () => void }) {
  const [link, setLink] = useState('')
  const [offer, setOffer] = useState<{ offerId: string; secret: string } | null>(null)
  const [error, setError] = useState<string>()

  function submit() {
    const parsed = parsePairingLink(link)
    if (!parsed) {
      setError(
        'That does not look like a pairing link. It should look like http://<your-computer>:9120/mobile/pair?offer=…&secret=…',
      )
      return
    }
    setError(undefined)
    // Store the daemon origin first: every subsequent request is absolute
    // against it, including this offer exchange.
    setDeviceBaseUrl(parsed.baseUrl)
    setOffer({ offerId: parsed.offerId, secret: parsed.secret })
  }

  if (offer) {
    return (
      <PairingScreen
        offerId={offer.offerId}
        secret={offer.secret}
        onPaired={onPaired}
      />
    )
  }

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-11 items-center justify-center rounded-card bg-surface shadow-card font-mono text-[13px] font-semibold text-accent">
          AD
        </span>
        <h1 className="text-[17px] font-semibold text-ink">Connect to your desktop</h1>
        <p className="max-w-[34ch] text-[12.5px] leading-[1.6] text-ink-3">
          On your computer, open AgentDeck → the pairing page, and copy the link under the code.
          Paste it here (the QR is for the installed web app).
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-2">
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
          onClick={submit}
          disabled={link.trim().length === 0}
          className="rounded-control bg-accent px-3 py-2.5 text-[13px] font-semibold text-accent-ink disabled:opacity-40"
        >
          Pair this device
        </button>
        {error ? <p className="text-[12px] leading-[1.5] text-red">{error}</p> : null}
      </div>
    </div>
  )
}
