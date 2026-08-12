import { FolderGit2, Loader2, Paperclip, Send, Square } from 'lucide-react'
import { AttachmentPrimitive, ComposerPrimitive, ThreadPrimitive } from '@assistant-ui/react'
import type { MobileAgentModel } from '../../types/mobile'

/**
 * Task composer powered by the assistant-ui composer runtime. The runtime
 * drives the textarea, the send/cancel lifecycle and the attachment pipeline;
 * the model / effort selectors send real CLI slash commands (`/model`,
 * `/effort`) so a change genuinely reaches the running agent instead of being
 * a cosmetic toggle. Context opens the existing files/diffs panel.
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
  const placeholder = disabled
    ? 'Task stopped — start a new task'
    : working
      ? 'Queue a follow-up…'
      : 'Message the agent…'

  return (
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

      <div className="rounded-pill border border-line bg-field px-2 py-1.5 shadow-hairline focus-within:border-accent/50">
        <ComposerPrimitive.Input
          autoFocus
          rows={1}
          placeholder={placeholder}
          className="max-h-36 w-full resize-none bg-transparent px-2 py-1 text-[13.5px] leading-6 text-ink placeholder:text-ink-3 outline-none"
        />
        <div className="mt-1 flex items-center gap-1">
          <ComposerPrimitive.AddAttachment
            aria-label="Attach a file"
            className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-3 transition-colors active:bg-hover disabled:opacity-30"
          >
            <Paperclip className="h-4 w-4" />
          </ComposerPrimitive.AddAttachment>
          <button
            type="button"
            onClick={onOpenContext}
            aria-label="Files and changes"
            className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-3 transition-colors active:bg-hover"
          >
            <FolderGit2 className="h-4 w-4" />
          </button>
          <div className="flex-1" />
          <ThreadPrimitive.If running>
            <ComposerPrimitive.Cancel
              aria-label="Stop generating"
              className="flex size-8 shrink-0 items-center justify-center rounded-control bg-red-tint text-red transition-colors active:bg-red active:text-white"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </ComposerPrimitive.Cancel>
          </ThreadPrimitive.If>
          <ComposerPrimitive.Send
            aria-label="Send message"
            className="flex size-8 shrink-0 items-center justify-center rounded-control bg-accent text-white transition-opacity active:opacity-80 disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </ComposerPrimitive.Send>
        </div>
      </div>

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
    </ComposerPrimitive.Root>
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
          event.target.value = ''
        }}
        className="max-w-28 appearance-none bg-transparent text-[10.5px] font-medium text-ink outline-none"
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
