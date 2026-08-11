import { useState } from 'react'
import { Check, Circle, Loader2, Send } from 'lucide-react'
import type { MobileQuestion } from '../types/mobile'

interface QuestionCardProps {
  question: MobileQuestion
  onAnswer: (answer: { question_id: string; session_id: string; selected_options: string[]; custom_text: string | null }) => Promise<void> | void
}

export function QuestionCard({ question, onAnswer }: QuestionCardProps) {
  const [selected, setSelected] = useState<string[]>(question.selected_options || [])
  const [customText, setCustomText] = useState(question.custom_text || '')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(question.status === 'answered')
  const [error, setError] = useState<string | null>(null)
  const isMultiple = question.selection_mode === 'multiple'
  const customSelected = question.options.some((option) => option.allows_custom_text && selected.includes(option.id))
  const selectedLabels = question.options.filter((option) => selected.includes(option.id)).map((option) => option.label)

  const toggle = (id: string) => {
    if (submitted || submitting) return
    setError(null)
    if (isMultiple) {
      setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
    } else {
      setSelected([id])
    }
  }

  const submit = async () => {
    if (!selected.length || (customSelected && !customText.trim()) || submitted || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onAnswer({ question_id: question.question_id, session_id: question.session_id, selected_options: selected, custom_text: customSelected ? customText.trim() : null })
      setSubmitted(true)
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to submit answer')
    } finally {
      setSubmitting(false)
    }
  }

  if (question.status === 'cancelled' || question.status === 'expired' || question.status === 'failed') {
    return <div className="rounded-2xl border border-border bg-surface px-4 py-3 text-xs text-text-muted"><p className="font-medium text-text">{question.title}</p><p className="mt-1">Question {question.status}.</p></div>
  }

  return <section className={`rounded-2xl border p-4 ${submitted ? 'border-success/20 bg-success/5' : 'border-accent/30 bg-surface'}`}>
    <div className="flex items-start gap-3">
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${submitted ? 'bg-success/10 text-success' : 'bg-accent/10 text-accent'}`}>
        {submitted ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{question.title}</h3>{!submitted && <span className="text-[10px] font-medium text-warning">Waiting for your answer</span>}</div>
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-text-muted">{question.question}</p>
      </div>
    </div>

    {submitted ? <div className="mt-4 rounded-xl border border-success/20 bg-success/5 px-3 py-2.5 text-xs text-success"><div className="flex items-center gap-2 font-medium"><Check className="h-3.5 w-3.5" />{selectedLabels.join(', ')}</div>{customText && <p className="mt-1 text-text-muted">{customText}</p>}<p className="mt-1 text-[10px] text-text-dim">Answered</p></div> : <>
      <div className="mt-4 space-y-1.5">
        {question.options.map((option) => {
          const active = selected.includes(option.id)
          return <button key={option.id} type="button" onClick={() => toggle(option.id)} className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? 'border-accent/50 bg-accent/10' : 'border-border bg-background/40 hover:bg-surface-hover'}`}>
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isMultiple ? 'rounded-md' : 'rounded-full'} ${active ? 'border-accent bg-accent text-white' : 'border-text-dim'}`}>{active && (isMultiple ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-white" />)}</span>
            <span className="min-w-0"><span className={`block text-xs font-medium ${active ? 'text-accent' : 'text-text'}`}>{option.label}</span>{option.description && <span className="mt-0.5 block text-[11px] leading-4 text-text-muted">{option.description}</span>}</span>
          </button>
        })}
      </div>
      {customSelected && <textarea value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder="Enter your answer..." rows={2} className="mt-3 w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text outline-none placeholder:text-text-dim focus:border-accent" />}
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
      <button type="button" onClick={() => void submit()} disabled={!selected.length || (customSelected && !customText.trim()) || submitting} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40">{submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Continue</button>
    </>}
  </section>
}
