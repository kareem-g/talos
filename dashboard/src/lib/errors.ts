/**
 * Small helpers for making raw agent/transport errors readable.
 *
 * Agent subprocesses (and some CLIs) emit verbose structured errors — e.g.
 * Pydantic validation JSON such as
 *   `[{ "code": "unrecognized_keys", "keys": ["capabilities"], "message": "Unrecognized key: \"capabilities\"" }]`
 * which is opaque to a user. This strips the wrapper to the human message and,
 * where it is a config-rejection, adds a short hint.
 */

export function readableAgentError(message: string): string {
  const trimmed = (message ?? '').trim()
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      const first = Array.isArray(parsed) ? parsed[0] : parsed
      if (first && typeof (first as { message?: unknown }).message === 'string') {
        const msg = (first as { message: string }).message
        if (/unrecognized key|extra field|invalid|validation|forbid/i.test(msg)) {
          return `The agent rejected a configuration setting: ${msg}`
        }
        return msg
      }
    } catch {
      /* not JSON — fall through */
    }
  }
  return trimmed || 'The agent reported an error.'
}
