import {
  CONTEXT_PHRASES,
  GENERAL_PHRASES,
  type StreamingStatusMode,
} from './statusPhrases'

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(input: readonly T[]): T[] {
  const items = [...input]
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/**
 * Pick the next phrase for a given mode.
 *
 * - A fresh generation starts at a randomized position in the pool so two runs
 *   don't begin on the same word.
 * - It walks a shuffled copy of the pool, so the same phrases aren't repeated
 *   back-to-back and the order differs each run.
 * - The previous phrase is never repeated consecutively.
 */
export class PhraseCycler {
  private queue: string[] = []
  private readonly pool: string[]

  constructor(mode: StreamingStatusMode, previous: string | null = null) {
    this.pool = mode === 'general' ? GENERAL_PHRASES : CONTEXT_PHRASES[mode]
    this.refill(previous)
  }

  private refill(previous: string | null) {
    let next = shuffle(this.pool)
    // Avoid repeating the phrase that ended the previous mode/run.
    if (previous && next[0] === previous && next.length > 1) {
      next = [next[1], ...next.slice(2), next[0]]
    }
    this.queue = next
  }

  next(previous: string | null = null): string {
    if (this.queue.length === 0) this.refill(previous)
    const phrase = this.queue.shift()!
    if (phrase === previous && this.queue.length > 0) {
      // Extremely unlikely, but never repeat consecutively.
      const fallback = this.queue.shift()!
      this.queue.unshift(phrase)
      return fallback
    }
    return phrase
  }
}
