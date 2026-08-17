import { Loader2, Paperclip, Send, Square } from 'lucide-react'
import {
  AttachmentPrimitive,
  ComposerPrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react'
import type { MobileAgentModel } from '../../types/mobile'

/**
 * Task composer built entirely on assistant-ui's base primitives.
 *
 * Runtime lifecycle
 * ────────────────
 * `ComposerPrimitive.Root`  – <form> wrapper; intercepts Enter-to-send,
 *                             auto-focuses the input, and wires the
 *                             send/cancel lifecycle.
 * `ComposerPrimitive.Input` – runtime-controlled <textarea>. No manual
 *                             value sync; the runtime holds the text.
 * `ComposerPrimitive.Send`  – emits the composer payload; auto-disabled when
 *                             the input is empty or the thread is running.
 * `ComposerPrimitive.Cancel` – stops the current agent run.
 * `ComposerPrimitive.Attachments` – renders file-chips for in-flight
 *                                    uploads; each chip has a remove button.
 * `ComposerPrimitive.AddAttachment` – triggers the native file picker;
 *                                     pipes the chosen file through the
 *                                     AttachmentAdapter (which uploads it
 *                                     via the backend API before send).
 *
 * The model/effort selectors and context button live outside the composer
 * form so they remain interactive regardless of composer state.
 */

interface TaskComposerProps {
  disabled: boolean
  working: boolean
  offline: boolean
  agentLabel: string
  models: MobileAgentModel[]
  reasoningLevels: string[]
  supportsModelSwitch: boolean
  supportsEffort: boolean
  onModelCommand: (command: string) => void
  onOpenContext: () => void
}

export function TaskComposer({
  disabled,
  working,
  offline,
  agentLabel,
  models,
  reasoningLevels,
  supportsModelSwitch,
  supportsEffort,
  onModelCommand,
  onOpenContext,
}: TaskComposerProps) {
  return (
    <div className="flex w-full flex-col gap-2">
      <ComposerPrimitive.Root className="flex w-full flex-col gap-1.5">
        <ComposerPrimitive.Attachments>
          {({ attachment }) => (
            <AttachmentPrimitive.Root
              key={attachment.id}
              className="flex h-6 max-w-48 items-center gap-1 rounded-chip bg-field px-1.5 pl-2 text-[11px] text-ink-2 shadow-hairline"
            >
              <Paperclip className="h-3 w-3 shrink-0" />
              <AttachmentPrimitive.Name />
              <AttachmentPrimitive.Remove
                aria-label={`Remove ${attachment.name}`}
                className="flex size-4 shrink-0 items-center justify-center text-ink-3 hover:text-ink"
              >
                ×
              </AttachmentPrimitive.Remove>
            </AttachmentPrimitive.Root>
          )}
        </ComposerPrimitive.Attachments>

        {/* ChatGPT-style rounded composer well */}
        <div
          role="presentation"
          className="flex cursor-text flex-col gap-1.5 rounded-[26px] border border-line bg-field p-3 shadow-hairline transition-[border-color,box-shadow] duration-150 focus-within:border-line-strong focus-within:shadow-[0_0_0_4px_hsl(var(--accent)/0.12)]"
        >
          <ComposerPrimitive.Input
            autoFocus
            rows={1}
            disabled={disabled}
            placeholder={disabled ? 'Task stopped — start a new task' : `Ask ${agentLabel === 'agent' ? 'the agent' : agentLabel} anything...`}
            className="max-h-40 w-full resize-none bg-transparent px-1 py-1.5 text-[14px] leading-[1.5] text-ink outline-none placeholder:text-ink-3"
          />
          <div className="flex items-center gap-1.5">
            <ComposerPrimitive.AddAttachment
              aria-label="Attach a file"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink-2 active:bg-hover disabled:opacity-30"
            >
              <Paperclip className="h-[18px] w-[18px]" />
            </ComposerPrimitive.AddAttachment>
            <button
              type="button"
              onClick={onOpenContext}
              aria-label="Files and changes"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink-2 active:bg-hover"
            >
              <Loader2 className="h-[18px] w-[18px]" />
            </button>
            <div className="flex-1" />
            {/* Stop replaces Send while the thread is running. */}
            <ThreadPrimitive.If running>
              <ComposerPrimitive.Cancel
                aria-label="Stop generating"
                className="flex size-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-red-tint px-2.5 text-[12px] font-medium text-red transition-colors hover:bg-red hover:text-white"
              >
                <Square className="h-4 w-4 fill-current" />
                Stop
              </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running={false}>
              <ComposerPrimitive.Send
                aria-label="Send message"
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-white transition-[background-color,transform] duration-200 enabled:active:scale-[0.96] disabled:opacity-30 enabled:hover:brightness-110"
                style={{ background: 'var(--ink)' }}
              >
                <Send className="h-4 w-4" />
              </ComposerPrimitive.Send>
            </ThreadPrimitive.If>
          </div>
        </div>
      </ComposerPrimitive.Root>

      <div className="flex flex-wrap items-center gap-1.5 px-1">
        {supportsModelSwitch && models.length > 0 && (
          <ModelSelect
            label="Model"
            options={models.map((model) => ({ value: model.id, label: model.name || model.id }))}
            onSelect={(value) => onModelCommand(`/model ${value}`)}
          />
        )}
        {supportsEffort && reasoningLevels.length > 0 && (
          <ModelSelect
            label="Effort"
            options={reasoningLevels.map((level) => ({ value: level, label: level }))}
            onSelect={(value) => onModelCommand(`/effort ${value}`)}
          />
        )}
        <span className="ml-auto flex items-center gap-1 text-[10px] text-ink-3">
          {working && <Loader2 className="h-3 w-3 animate-spin" />}
          {working ? 'Working' : disabled ? 'Read-only history' : offline ? 'Offline' : 'Ready'} · {agentLabel}
        </span>
      </div>
    </div>
  )
}

function ModelSelect({
  label,
  options,
  onSelect,
}: {
  label: string
  options: Array<{ value: string; label: string }>
  onSelect: (value: string) => void
}) {
  return (
    <label className="flex h-6 items-center gap-1 rounded-chip bg-hover px-2 text-[10.5px] font-medium text-ink-2">
      {label}
      <select
        defaultValue=""
        onChange={(event) => {
          if (event.target.value) onSelect(event.target.value)
        }}
        className="bg-transparent outline-none"
      >
        <option value="" disabled>
          —
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
