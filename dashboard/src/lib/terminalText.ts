const OSC_SEQUENCE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g
const CSI_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]/g
const CHARSET_SEQUENCE = /\u001b[()][0-2A-Z]/g
const ESCAPE_SEQUENCE = /\u001b./g
const C1_CSI_SEQUENCE = /\u009b[0-?]*[ -/]*[@-~]/g

const chromeMarkers = [
  'welcome back!',
  'tips for getting started',
  "what's new",
  'anthropic_auth_token',
  'anthropic_api_key',
  'manual mode',
  '/release-notes',
  'expectedvariable',
  'claudelogout',
  'apikeyapproval',
  'beforelogin',
  'manualmode',
  'booping',
  'doing',
  'cogitatedfor',
  'thoughtfor',
  'thinkingwith',
  'ctrlo',
  'cogitating',
  'germinating',
  'inferring',
  'brewedfor',
  'crunchedfor',
  'pondering',
  'vibing',
  'zizagg',
]

export function cleanTerminalText(input: string): string {
  const withoutSequences = input
    .replace(/␛/g, '')
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(CHARSET_SEQUENCE, '')
    .replace(C1_CSI_SEQUENCE, '')
    .replace(ESCAPE_SEQUENCE, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')

  return withoutSequences
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .filter((line) => !isTerminalChrome(line))
    .map((line) => line.startsWith('●') || line.startsWith('•') ? line.slice(1).trimStart() : line)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isTerminalChrome(line: string) {
  const trimmed = line.trim()
  const lower = trimmed.toLowerCase()
  const compact = lower.replace(/[^a-z0-9]/g, '')
  if (!trimmed || trimmed.startsWith('❯') || trimmed.startsWith('⎿')) return true
  if (chromeMarkers.some((marker) => lower.includes(marker))) return true
  if (chromeMarkers.some((marker) => compact.includes(marker.replace(/[^a-z0-9]/g, '')))) return true
  if (compact === 'expected' || compact === 'login' || compact === 'variable' || compact === '1agent' || /^\d+$/.test(compact)) return true
  if (trimmed.endsWith('…') && trimmed.length < 64) return true
  if (compact.length <= 3 && !compact.includes('_') && !/^[A-Z]+$/.test(compact) && !/\s/.test(trimmed)) return true
  if (trimmed[0] && '✶✻✽✢·*'.includes(trimmed[0]) && trimmed.length <= 12) return true
  return trimmed.split('').some((character) => '╭╮╰╯│─┌┐└┘▐▛▜▝▘'.includes(character))
}

export function normalizedText(input: string) {
  return cleanTerminalText(input).replace(/\s+/g, ' ').trim()
}
