import { useEffect, useMemo, useState } from 'react'

export type ApprovalOption = {
  id: string
  label: string
  description?: string
  allowsCustom?: boolean
}

export type ApprovalQuestion = {
  title: string
  type: 'radio' | 'check'
  options: ApprovalOption[]
  allowsCustom?: boolean
  submitLabel?: string
}

export default function ApprovalCard({
  question,
  onSubmit,
  answered,
  answeredSelection = [],
  answeredCustom,
  disabled = false,
}: {
  question: ApprovalQuestion
  onSubmit: (selected: string[], customText: string | null) => void | Promise<void>
  answered?: boolean
  answeredSelection?: string[]
  answeredCustom?: string
  disabled?: boolean
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(Boolean(answered))
  const selectedOptions = useMemo(() => question.options.filter((option) => selected.includes(option.id)), [question.options, selected])
  const customAllowed = question.allowsCustom === true && selectedOptions.some((option) => option.allowsCustom)
  const hasAnswer = selected.length > 0 || (customAllowed && Boolean(custom.trim()))

  useEffect(() => {
    setSent(Boolean(answered))
  }, [answered])

  const submit = async () => {
    if (sending || sent || disabled || !hasAnswer) return
    setSending(true)
    try {
      await onSubmit(selected, customAllowed ? custom.trim() || null : null)
      setSent(true)
    } finally {
      setSending(false)
    }
  }

  const toggle = (id: string) => {
    if (sent || sending || disabled) return
    if (question.type === 'radio') {
      setSelected([id])
      setCustom('')
    } else {
      setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
    }
  }

  const sentLabels = sent
    ? question.options.filter((option) => answeredSelection.includes(option.id)).map((option) => option.label)
    : []

  return (
    <div className="flex w-full max-w-95 flex-col items-stretch">
      <div className="w-full overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {sent ? (
          <div className="flex min-h-37 flex-col items-center justify-center gap-2 px-4 py-6 text-center">
            <span className="flex size-7 items-center justify-center rounded-full bg-green text-white" style={{ animation: 'pop-in 300ms cubic-bezier(0.23,1,0.32,1) both' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
            </span>
            <span className="text-[13px] font-medium text-ink">{question.type === 'radio' ? 'Decision sent' : 'Answer sent'}</span>
            {(sentLabels.length > 0 || answeredCustom) && <span className="max-w-full text-[12px] text-ink-2">{sentLabels.join(', ')}{answeredCustom ? `${sentLabels.length ? ' · ' : ''}${answeredCustom}` : ''}</span>}
          </div>
        ) : (
          <div className="primitive-card-pad" style={{ animation: 'fade-up 350ms cubic-bezier(0.23,1,0.32,1) both' }}>
            <span className="block text-[13px] font-medium text-ink">{question.title}</span>
            <div className="mt-2 flex flex-col gap-1">
              {question.options.map((option) => {
                const selectedOption = selected.includes(option.id)
                return (
                  <button key={option.id} type="button" aria-pressed={selectedOption} disabled={disabled || sending} onClick={() => toggle(option.id)} className="flex min-h-11 items-center gap-2 rounded-control px-2 text-left transition-colors hover:bg-hover disabled:opacity-50">
                    <span className={`flex size-5 shrink-0 items-center justify-center ${question.type === 'radio' ? 'rounded-full' : 'rounded-[5px]'} ${selectedOption ? 'bg-ink text-canvas' : 'shadow-[inset_0_0_0_1.5px_var(--line-strong)] text-transparent'}`}>
                      {question.type === 'radio' ? <span className="size-2 rounded-full bg-canvas" style={{ transform: selectedOption ? 'scale(1)' : 'scale(0)' }} /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[13px] ${selectedOption ? 'text-ink' : 'text-ink-2'}`}>{option.label}</span>
                      {option.description && <span className="mt-0.5 block text-[11px] leading-4 text-ink-3">{option.description}</span>}
                    </span>
                  </button>
                )
              })}
              {customAllowed && (
                <label className="mt-1 flex min-h-11 items-center gap-2 rounded-control border border-line bg-field px-2 focus-within:border-line-strong">
                  <input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Add details" aria-label="Custom answer" disabled={disabled || sending} className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3 sm:text-[13px]" />
                </label>
              )}
            </div>
          </div>
        )}
        {!sent && (
          <div className="primitive-card-footer flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-ink-3">{sending ? 'Sending…' : question.type === 'check' ? 'Select one or more' : 'Select an option'}</span>
            <button type="button" aria-label={question.submitLabel || 'Send answer'} disabled={!hasAnswer || disabled || sending} onClick={() => void submit()} className="min-h-11 rounded-control bg-ink px-3 text-[11.5px] font-medium text-canvas transition-opacity disabled:opacity-40">
              {sending ? 'Sending…' : question.submitLabel || 'Answer'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
