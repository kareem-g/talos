/**
 * icons — the lucide glyphs the interface uses, drawn at their native
 * stroke so every screen shares one drawing.
 */

import Svg, { G, Path } from 'react-native-svg'
import { color } from './tokens'

export type GlyphProps = {
  size?: number
  color?: string
  stroke?: number
  fill?: boolean
}

function draw(paths: string[], fallback = 14) {
  return function Glyph({ size = fallback, color: ink = color.ink3, stroke = 2, fill }: GlyphProps) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
        <G strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" stroke={ink} fill={fill ? ink : 'none'}>
          {paths.map((d, i) => (
            <Path key={i} d={d} />
          ))}
        </G>
      </Svg>
    )
  }
}

export const ChevronLeft = draw(['m15 18-6-6 6-6'], 16)
export const ChevronRight = draw(['m9 18 6-6-6-6'], 14)
export const ChevronDown = draw(['m6 9 6 6 6-6'], 14)
export const Close = draw(['M18 6 6 18', 'm6 6 12 12'], 16)
export const Check = draw(['M20 6 9 17l-5-5'], 14)
export const Plus = draw(['M5 12h14', 'M12 5v14'], 16)
export const Search = draw(['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm21 21-4.34-4.34'], 16)
export const Alert = draw(['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'], 14)
export const ArrowUp = draw(['m5 12 7-7 7 7', 'M12 19V5'], 16)
// Rounded like every other control; a hard square read as a different set.
export const Stop = draw(
  ['M8.5 6h7A2.5 2.5 0 0 1 18 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 15.5v-7A2.5 2.5 0 0 1 8.5 6z'],
  12,
)
export const Clip = draw(['m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48'], 16)
export const Pencil = draw(['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'], 13)
export const Trash = draw(['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'], 13)
export const Play = draw(['M6 4.5v15l13-7.5z'], 14)
export const Star = draw(['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'], 15)
export const Folder = draw(['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'], 16)
export const Bot = draw(['M12 8V4H8', 'M4 8h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z', 'M9 17v-3', 'M15 17v-3'], 16)
export const Home = draw(['m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'], 25)
export const Clock = draw(['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2'], 25)
export const Chart = draw(['M3 3v16a2 2 0 0 0 2 2h16', 'M18 17V9', 'M13 17V5', 'M8 17v-3'], 25)
// Nine strokes in one glyph — it is drawn one weight lighter than the
// two-stroke icons so the header set reads as one thickness.
export const Sliders = draw(['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'], 25)
// The mockup's `.panel`: a 2.5-radius window with the rail divider at 9.5.
export const Panel = draw(
  ['M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4z', 'M9.5 4v16'],
  19,
)
export const List = draw(['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'], 20)
export const Gear = draw(['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'], 20)
export const Refresh = draw(['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'], 16)
export const Copy = draw(['M9 9h12v12H9z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'], 13)
export const External = draw(['M7 17 17 7', 'M9 7h8v8'], 13)
export const Monitor = draw(['M2 3h20v14H2z', 'M8 21h8', 'M12 17v4'], 17)

/**
 * The four session dimensions, drawn with lucide's own geometry (the set the
 * desktop imports) so the two surfaces label a control the same way.
 * Rects are written as rounded paths to keep the set on one drawing helper.
 */
export const Cpu = draw(
  [
    'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    'M10 9h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z',
    'M15 2v2',
    'M15 20v2',
    'M2 15h2',
    'M2 9h2',
    'M20 15h2',
    'M20 9h2',
    'M9 2v2',
    'M9 20v2',
  ],
  17,
)

export const ShieldCheck = draw(
  [
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    'm9 12 2 2 4-4',
  ],
  17,
)

export const Sparkles = draw(
  [
    'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
    'M20 3v4',
    'M22 5h-4',
    'M4 17v2',
    'M5 18H3',
  ],
  17,
)

export const Gauge = draw(['m12 14 4-4', 'M3.34 19a10 10 0 1 1 17.32 0'], 17)
