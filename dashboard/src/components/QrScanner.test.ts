/**
 * Round-trip test for the pairing scanner's decode path.
 *
 * The scanner cannot be exercised on a device from CI, and the QR payload is
 * a URL that must survive the camera → canvas → decoder trip exactly (an
 * offer id or secret with a dropped character is an unrecoverable pairing
 * failure). So the encoder builds a real QR image, laid out as RGBA the same
 * way the canvas hands it to jsQR, and the decoder reads it back.
 */

import { describe, expect, it } from 'vitest'
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { parsePairingLink } from '@/lib/native'

/** Render a QR matrix into the RGBA buffer `getImageData` would produce. */
function rasterize(text: string, scale = 4, quiet = 4): { data: Uint8ClampedArray; size: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const modules = qr.modules.size
  const size = (modules + quiet * 2) * scale
  const data = new Uint8ClampedArray(size * size * 4).fill(255)
  for (let y = 0; y < modules; y += 1) {
    for (let x = 0; x < modules; x += 1) {
      if (!qr.modules.get(x, y)) continue
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const px = ((y + quiet) * scale + dy) * size + ((x + quiet) * scale + dx)
          data[px * 4] = 0
          data[px * 4 + 1] = 0
          data[px * 4 + 2] = 0
          data[px * 4 + 3] = 255
        }
      }
    }
  }
  return { data, size }
}

describe('QrScanner decode path', () => {
  it('decodes a tailnet pairing link exactly', () => {
    const link =
      'http://100.94.122.121:9120/mobile/pair?offer=6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8&secret=Zk9xT2hCdlpzNlF3'
    const { data, size } = rasterize(link)
    const decoded = jsQR(data, size, size, { inversionAttempts: 'dontInvert' })
    expect(decoded?.data).toBe(link)
  })

  it('decodes a MagicDNS hostname link and parses it into daemon origin + offer', () => {
    const link =
      'http://kareem.taile90653.ts.net:9120/mobile/pair?offer=abc-123&secret=s3cr3t-value'
    const { data, size } = rasterize(link)
    const decoded = jsQR(data, size, size, { inversionAttempts: 'dontInvert' })
    expect(decoded?.data).toBe(link)

    const parsed = parsePairingLink(decoded!.data)
    expect(parsed).toEqual({
      baseUrl: 'http://kareem.taile90653.ts.net:9120',
      offerId: 'abc-123',
      secret: 's3cr3t-value',
    })
  })

  it('rejects a QR that is not a pairing link', () => {
    const { data, size } = rasterize('https://example.com/not-a-pairing-code')
    const decoded = jsQR(data, size, size, { inversionAttempts: 'dontInvert' })
    expect(decoded?.data).toBe('https://example.com/not-a-pairing-code')
    expect(parsePairingLink(decoded!.data)).toBeNull()
  })
})
