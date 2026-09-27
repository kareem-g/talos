/**
 * QR scanner — camera viewfinder that decodes the desktop's pairing code.
 *
 * Decoding happens in JS against `getUserMedia` frames rather than through a
 * native plugin, so the exact same component serves the web front end and the
 * native shell, with no platform dependency to keep in sync. The pairing link
 * is a plain URL, so the decoded text goes straight into the same parser the
 * paste field uses.
 *
 * `playsInline` + `muted` keep iOS from taking the video full-screen, and the
 * frame loop stops as soon as something decodes so the light never stays on
 * longer than it has to.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

type Status = 'starting' | 'scanning' | 'denied' | 'unsupported'

export function QrScanner({
  onDetect,
  onCancel,
}: {
  onDetect: (text: string) => void
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)
  const doneRef = useRef(false)
  const [status, setStatus] = useState<Status>('starting')
  const [error, setError] = useState<string>()

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const tick = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || doneRef.current) return

    // Skip frames until the camera actually has a picture; decoding a 0x0
    // canvas throws.
    if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      const width = video.videoWidth
      const height = video.videoHeight
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context) {
        context.drawImage(video, 0, 0, width, height)
        const image = context.getImageData(0, 0, width, height)
        const found = jsQR(image.data, image.width, image.height, {
          inversionAttempts: 'dontInvert',
        })
        if (found?.data) {
          doneRef.current = true
          stop()
          onDetect(found.data)
          return
        }
      }
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [onDetect, stop])

  useEffect(() => {
    let cancelled = false

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unsupported')
        setError('This device does not expose a camera to the app.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {
            // Autoplay refusals are recoverable: the first tap starts playback.
          })
        }
        setStatus('scanning')
        frameRef.current = requestAnimationFrame(tick)
      } catch (cause) {
        if (cancelled) return
        const name = cause instanceof Error ? cause.name : ''
        setStatus(name === 'NotAllowedError' ? 'denied' : 'unsupported')
        setError(
          name === 'NotAllowedError'
            ? 'Camera access is off for AgentDeck. Enable it in iOS Settings → AgentDeck → Camera.'
            : 'Could not start the camera on this device.',
        )
      }
    }

    void start()
    return () => {
      cancelled = true
      stop()
    }
  }, [stop, tick])

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-between gap-4 bg-canvas px-6"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
    >
      <header className="flex w-full items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          Scan pairing code
        </span>
        <button
          type="button"
          onClick={() => {
            stop()
            onCancel()
          }}
          className="rounded-control px-3 py-1.5 text-[12px] font-medium text-ink-2"
        >
          Cancel
        </button>
      </header>

      <div className="relative w-full max-w-sm overflow-hidden rounded-card border border-line bg-black shadow-overlay">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="aspect-square h-auto w-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Viewfinder: corner marks only, so the frame never hides the code. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative aspect-square w-3/4">
            {(
              [
                'left-0 top-0 border-l-2 border-t-2 rounded-tl-lg',
                'right-0 top-0 border-r-2 border-t-2 rounded-tr-lg',
                'left-0 bottom-0 border-b-2 border-l-2 rounded-bl-lg',
                'right-0 bottom-0 border-b-2 border-r-2 rounded-br-lg',
              ] as const
            ).map((position) => (
              <span key={position} className={`absolute size-8 border-accent ${position}`} />
            ))}
          </div>
        </div>

        {status === 'starting' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[12px] text-ink-2">
            Starting camera…
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/75 px-6 text-center text-[12.5px] leading-[1.6] text-ink-2">
            {error}
          </div>
        ) : null}
      </div>

      <p className="max-w-[34ch] text-center text-[12px] leading-[1.6] text-ink-3">
        Point the camera at the code on your desktop&apos;s pairing page. The link is
        exchanged straight away and the code cannot be reused.
      </p>
    </div>
  )
}
