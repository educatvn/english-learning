import { useEffect, useState } from 'react'
import { X, Trash2, StickyNote, Loader2 } from 'lucide-react'
import type { PlanNote } from '@/types'
import { addPlanNote, deletePlanNote, getPlanNotes } from '@/services/plans'

interface Props {
  planId: string
  userId: string
  date: string // YYYY-MM-DD
  onClose: () => void
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function DayNotesDialog({ planId, userId, date, onClose }: Props) {
  const [notes, setNotes] = useState<PlanNote[] | null>(null)
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load all notes for the plan and filter to this day
  useEffect(() => {
    let cancelled = false
    getPlanNotes(userId, planId)
      .then((all) => {
        if (cancelled) return
        setNotes(all.filter((n) => n.date === date).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
      })
      .catch(() => {
        if (!cancelled) setNotes([])
      })
    return () => {
      cancelled = true
    }
  }, [planId, userId, date])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleAdd() {
    const trimmed = text.trim()
    if (!trimmed) return
    setAdding(true)
    setError(null)
    try {
      const saved = await addPlanNote({ planId, userId, date, text: trimmed })
      setNotes((prev) => [...(prev ?? []), saved])
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save note')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(note: PlanNote) {
    const prev = notes
    setNotes((prev) => prev?.filter((n) => n.id !== note.id) ?? null)
    try {
      await deletePlanNote(userId, note.id)
    } catch (e) {
      console.error(e)
      setNotes(prev)
    }
  }

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5 flex items-center gap-1">
              <StickyNote className="w-3 h-3" /> Notes
            </p>
            <h2 className="text-lg font-bold text-foreground wrap-break-word">{formatDateLabel(date)}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Notes list */}
        <div className="flex-1 overflow-y-auto -mx-1 px-1 min-h-20">
          {notes === null ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
            </div>
          ) : notes.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">No notes for this day yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.map((n) => (
                <li
                  key={n.id}
                  className="group rounded-lg border border-border bg-muted/40 px-3 py-2 flex items-start justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground whitespace-pre-wrap wrap-break-word leading-relaxed">
                      {n.text}
                    </p>
                    {n.createdAt && (
                      <p className="text-[10px] text-muted-foreground mt-1">{formatTime(n.createdAt)}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(n)}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                    title="Delete note"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add new note */}
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Add note</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder="Write a note for this day…"
            rows={3}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">⌘/Ctrl + Enter to save</span>
            <button
              onClick={handleAdd}
              disabled={adding || !text.trim()}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Save note
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
