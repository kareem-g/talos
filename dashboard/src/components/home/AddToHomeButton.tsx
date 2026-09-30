/**
 * AddToHomeButton — the "put QAI on your phone's home screen" affordance
 * for the mobile home header.
 *
 * QAI is a PWA: installed it opens full-screen like an app. Browsers that
 * can install it fire `beforeinstallprompt`, so the button runs that real
 * prompt directly. iOS Safari (and browsers that never qualify — plain-LAN
 * HTTP has no secure context for a service worker) get a short bottom sheet
 * with the platform's manual steps instead.
 *
 * The deferred-prompt capture lives at module scope because the browser may
 * fire `beforeinstallprompt` before the home screen mounts (e.g. after the
 * pairing takeover) — a late subscriber must still see it.
 */

import { useEffect, useState } from 'react'
import { Download, Share } from 'lucide-react'
import { isStandalone } from '@/lib/pwa'
import { Layer } from '../ui'
import { cn } from '@/lib/format'

type InstallPrompt = {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPrompt | null = null
let installed = false
const subscribers = new Set<() => void>()

function publish() {
  for (const notify of subscribers) notify()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event: Event) => {
    // Don't let the browser show its own mini-infobar; we show the prompt on
    // tap instead.
    event.preventDefault()
    deferred = event as unknown as InstallPrompt
    publish()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    publish()
  })
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS Safari reports a Mac user agent; the touch screen is the tell.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** True when this page runs standalone — the app is already on the home screen. */
function useInstallState() {
  const [state, setState] = useState(() => ({ deferred, installed }))
  useEffect(() => {
    const update = () => setState({ deferred, installed })
    subscribers.add(update)
    update()
    return () => {
      subscribers.delete(update)
    }
  }, [])
  return state
}

export function AddToHomeButton() {
  const { deferred: prompt, installed: installedNow } = useInstallState()
  const [sheetOpen, setSheetOpen] = useState(false)
  const ios = isIOS()

  // Installed (either standalone right now, or just added in this tab) — the
  // button has nothing left to do.
  if (installedNow || isStandalone()) return null

  async function runPrompt() {
    if (!prompt) return
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      if (choice.outcome === 'accepted') installed = true
    } catch {
      /* dismissed or unsupported — stay put */
    }
    deferred = null
    publish()
  }

  return (
    <>
      <button
        type="button"
        aria-label="Add to Home Screen"
        title={prompt ? 'Install QAI as an app' : 'How to add QAI to your home screen'}
        onClick={() => {
          if (prompt) void runPrompt()
          else setSheetOpen(true)
        }}
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors',
          'hover:bg-hover-2 hover:text-ink active:scale-[0.97]',
        )}
      >
        <Download size={15} />
      </button>

      <Layer open={sheetOpen} onClose={() => setSheetOpen(false)} title="Add QAI to your home screen" size="md" side="bottom">
        <div className="flex flex-col gap-3 px-1 pb-2 pt-1">
          <p className="text-[12px] leading-[1.6] text-ink-3">
            QAI is a web app — installing it puts an icon on your home screen that opens
            this station full-screen, like an app.
          </p>

          {ios ? (
            <div className="flex flex-col gap-2 rounded-control border border-line/70 bg-inset px-3 py-3">
              <StepRow
                n={1}
                text={
                  <>
                    In <span className="font-medium text-ink">Safari</span>, tap the{' '}
                    <Share size={12} className="inline -translate-y-px text-accent-ink" /> Share
                    button in the toolbar.
                  </>
                }
              />
              <StepRow n={2} text="Scroll down and tap “Add to Home Screen”." />
              <StepRow n={3} text="Tap “Add” in the top-right corner." />
              <p className="mt-1 text-[10.5px] leading-[1.5] text-ink-3/80">
                Reading this in another browser? Open this same link in Safari first — only
                Safari can add to the iPhone home screen.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 rounded-control border border-line/70 bg-inset px-3 py-3">
              <StepRow
                n={1}
                text={
                  <>
                    Open your browser's menu (<span className="font-mono text-ink">⋮</span> or{' '}
                    <span className="font-mono text-ink">⋯</span>).
                  </>
                }
              />
              <StepRow n={2} text="Choose “Install app”, “Install QAI”, or “Add to Home screen”." />
              <StepRow n={3} text="Confirm — the icon lands on your home screen." />
              <p className="mt-1 text-[10.5px] leading-[1.5] text-ink-3/80">
                Over plain-LAN HTTP some browsers only save a shortcut that opens in the
                browser. The HTTPS links (Tailnet / Cloudflare) install as a true standalone app.
              </p>
            </div>
          )}

          <p className="text-[10.5px] leading-[1.5] text-ink-3">
            Tip: keep the station reachable (Tailnet, Cloudflare, or LAN) so the home-screen
            app always finds it.
          </p>
        </div>
      </Layer>
    </>
  )
}

function StepRow({ n, text }: { n: number; text: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] font-semibold text-accent-ink">
        {n}
      </span>
      <span className="min-w-0 flex-1 text-[12px] leading-[1.6] text-ink-2">{text}</span>
    </div>
  )
}
