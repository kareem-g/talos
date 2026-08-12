import { useRef, useState } from 'react'
import { Loader2, Paperclip } from 'lucide-react'
import { api } from '../lib/api'
import PromptBar from './beautiful/PromptBar'

/**
 * Mobile composer: the Beautiful UI Prompt Bar with a real attachment
 * action wired to its + button. Tapping + opens a file picker; the file
 * is uploaded to /api/attachments/upload and the returned refs show as
 * chips above the input. On send, the message text + attachment refs go
 * to the agent.
 */

export interface ComposerAttachment {
  ref: string
  name: string
  fileName: string
  size: number
}

export function MobileComposer({
  sessionId,
  disabled,
  ended,
  working,
  onSend,
}: {
  sessionId: string
  disabled: boolean
  ended: boolean
  working: boolean
  onSend: (text: string, attachments: ComposerAttachment[]) => void
}) {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const pickFile = () => inputRef.current?.click()

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const result = await api.attachments.upload(sessionId, file)
      if (result.attachments?.length) {
        setAttachments((current) => [...current, ...result.attachments])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const removeAttachment = (ref: string) => {
    setAttachments((current) => current.filter((item) => item.ref !== ref))
  }

  const send = (text: string) => {
    onSend(text, attachments)
    setAttachments([])
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      {error && <p className="text-[11px] text-red">{error}</p>}
      {(attachments.length > 0 || uploading) && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((att) => (
            <span key={att.ref} className="flex h-6 items-center gap-1 rounded-chip bg-field px-1.5 pl-2 text-[11px] text-ink-2 shadow-hairline">
              <Paperclip className="h-3 w-3" />
              <span className="max-w-24 truncate">{att.fileName}</span>
              <button type="button" onClick={() => removeAttachment(att.ref)} className="flex size-4 items-center justify-center text-ink-3 hover:text-ink" aria-label={`Remove ${att.fileName}`}>×</button>
            </span>
          ))}
          {uploading && <span className="flex h-6 items-center gap-1 rounded-chip bg-field px-2 text-[11px] text-ink-2"><Loader2 className="h-3 w-3 animate-spin" />Uploading…</span>}
        </div>
      )}
      <PromptBar
        variant="Pill"
        placeholder={ended ? 'Task stopped — start a new task' : working ? 'Queue a follow-up…' : 'Message the agent…'}
        disabled={disabled}
        onSend={send}
        onPlus={pickFile}
      />
      <input ref={inputRef} type="file" className="hidden" onChange={onFile} />
    </div>
  )
}
