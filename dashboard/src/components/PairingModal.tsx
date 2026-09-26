/**
 * PairingModal — the "connect a device" dialog, opened from the device card
 * in the nav rail.
 *
 * The phone side needs no app: scanning the QR opens this same app on the
 * phone, which pairs, stores its token, and can install to the home screen
 * as a PWA. The modal carries the whole flow — pick a route, scan, and the
 * paired-device list with revoke — so pairing never depends on reaching the
 * home page's Pair section.
 */

import { Smartphone } from 'lucide-react'
import { DevicesCard } from './home/PairSection'
import { PairDeviceLayerContent } from './Pairing'
import { SectionLabel } from './ui'

export function PairingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Pair a device"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="animate-up relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-overlay">
        <header className="flex shrink-0 items-center gap-2 border-b border-line/50 px-4 py-3">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent-tint">
            <Smartphone size={14} className="text-accent" />
          </span>
          <h2 className="min-w-0 flex-1 text-[14px] font-semibold text-ink">Pair a device</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
          >
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {/* QR + route picker — the phone scans, this side shows live expiry.
              Stacked: the modal is narrower than the wide home card the
              two-column layout was designed for. */}
          <PairDeviceLayerContent stacked />

          <div className="border-t border-line/50 px-3 py-3">
            <SectionLabel>Paired devices</SectionLabel>
            <DevicesCard />
          </div>
        </div>
      </div>
    </div>
  )
}
