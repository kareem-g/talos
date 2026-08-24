/**
 * Tool-call humanizer.
 *
 * Tool inputs arrive as provider-native JSON — `{"file_path":"/tmp/x/notes.txt",
 * "content":"hello\n"}` — which reads like a debug dump in the transcript.
 * This module reduces a tool part to what an operator scans for: a verb, the
 * one argument that matters (a file, a command, a query), and the raw payload
 * kept for the expandable detail.
 *
 * It reads only from the part's own fields; it never parses output text.
 */

import { basename } from './format'
import type { CommandPart, ToolPart } from '@/types/conversation'

export interface ToolSummary {
  /** Short verb: "Edit", "Read", "Run", "Search", or the humanized tool name. */
  label: string
  /**
   * The argument that matters, already shortened (basename of a path, the
   * command line, the query). Undefined when the input had nothing readable.
   */
  arg?: string
  /** Coarse glyph family for the row icon. */
  glyph: 'edit' | 'read' | 'run' | 'search' | 'file' | 'generic'
}

/** Pull the first matching string field out of a JSON object. */
function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

/** Shorten an argument for the inline chip: paths become basenames, long values truncate. */
function shortenArg(value: string, max = 72): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1)}…`
}

function summarizeInput(toolKind: string | undefined, name: string, input: string | undefined): ToolSummary {
  const hint = `${toolKind ?? ''} ${name}`.toLowerCase()

  // AskUserQuestion is the interactive permission prompt — render it as a
  // question, not a JSON blob. It is also shown as an Approval card, but
  // the transcript keeps the tool row for the audit trail.
  if (/askuserquestion/.test(hint)) {
    if (input) {
      // Input may be prefixed with the tool name; extract the JSON payload.
      let json: string = input
      const brace = input.indexOf('{')
      if (brace > 0) json = input.slice(brace)
      try {
        const parsed = JSON.parse(json)
        const questions = (parsed as Record<string, unknown>)['questions']
        if (Array.isArray(questions) && questions[0] && typeof questions[0] === 'object') {
          const first = questions[0] as Record<string, unknown>
          const q =
            (typeof first['question'] === 'string' && first['question']) ||
            (typeof first['header'] === 'string' && first['header']) ||
            undefined
          if (q) return { label: 'Ask', arg: shortenArg(q, 56), glyph: 'generic' }
        }
      } catch {
        /* JSON truncated — try regex fallback for the question/header */
        const header = input.match(/"header"\s*:\s*"([^"]+)"/)?.[1]
        const question = input.match(/"question"\s*:\s*"([^"]+)"/)?.[1]
        const q = question ?? header
        if (q) return { label: 'Ask', arg: shortenArg(q, 56), glyph: 'generic' }
      }
    }
    return { label: 'Ask', arg: undefined, glyph: 'generic' }
  }

  // Parse the input once; every branch below can use it.
  let record: Record<string, unknown> | undefined
  if (input) {
    // Handle prefixed JSON like `Write {"file_path":...}` or bare JSON.
    let json = input.trim()
    const brace = json.indexOf('{')
    const bracket = json.indexOf('[')
    let start = -1
    if (brace !== -1 && bracket !== -1) start = Math.min(brace, bracket)
    else if (brace !== -1) start = brace
    else if (bracket !== -1) start = bracket
    if (start > 0) json = json.slice(start)
    try {
      const parsed = JSON.parse(json)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>
      }
    } catch {
      // Not JSON — plain string inputs are common (a path, a query).
    }
  }

  const pathArg = () => {
    const raw = record
      ? firstString(record, ['file_path', 'path', 'notebook_path', 'filename'])
      : undefined
    return raw ? basename(raw) : undefined
  }
  const commandArg = () => (record ? firstString(record, ['command', 'cmd', 'script']) : undefined)
  const queryArg = () => (record ? firstString(record, ['query', 'pattern', 'q', 'regex', 'search']) : undefined)
  const urlArg = () => (record ? firstString(record, ['url', 'link']) : undefined)

  if (/\b(edit|write|patch|create|str_replace|multiedit|notebookedit)\b/.test(hint)) {
    return { label: 'Edit', arg: pathArg(), glyph: 'edit' }
  }
  if (/\b(read|open|view|cat|fetch_file)\b/.test(hint)) {
    return { label: 'Read', arg: pathArg(), glyph: 'read' }
  }
  if (/\b(bash|exec|shell|terminal|run)\b/.test(hint)) {
    return { label: 'Run', arg: commandArg(), glyph: 'run' }
  }
  if (/\b(search|grep|glob|find|explore)\b/.test(hint)) {
    return { label: 'Search', arg: queryArg(), glyph: 'search' }
  }
  if (/\b(web|fetch|http|download)\b/.test(hint)) {
    const url = urlArg()
    return { label: 'Fetch', arg: url ? shortenArg(url.replace(/^https?:\/\//, ''), 48) : undefined, glyph: 'generic' }
  }

  // Unknown tool: humanize the name and show whatever readable argument exists.
  const humanized =
    name
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || 'Tool'
  const arg = pathArg() ?? commandArg() ?? queryArg() ?? urlArg()
  return { label: humanized, arg, glyph: 'generic' }
}

/** Summarize a tool or command part for the transcript row. */
export function describeTool(part: ToolPart | CommandPart): ToolSummary {
  if (part.kind === 'command') {
    return { label: 'Run', arg: part.command ? shortenArg(part.command) : undefined, glyph: 'run' }
  }
  const summary = summarizeInput(part.toolKind, part.name, part.input)
  if (!summary.arg && part.input) {
    summary.arg = shortenArg(part.input, 48)
  }
  return summary
}
