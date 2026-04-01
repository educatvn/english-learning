import { useEffect, useState } from 'react'
import { BookPlus, Check, Loader2, X } from 'lucide-react'
import { fetchDefinition } from '@/services/vocabulary'

interface Props {
  word: string
  sourceText: string
  isSaved: boolean
  onAdd: (word: string, definition: string) => Promise<void>
  onClose: () => void
}

function highlightWord(text: string, word: string) {
  const re = new RegExp(`(\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b)`, 'gi')
  const parts = text.split(re)
  return (
    <>
      {parts.map((p, i) =>
        re.test(p)
          ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded-sm px-0.5 not-italic">{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </>
  )
}

export function VocabDialog({ word, sourceText, isSaved, onAdd, onClose }: Props) {
  const [definition, setDefinition] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(isSaved)

  useEffect(() => {
    fetchDefinition(word).then(setDefinition).catch(() => setDefinition(''))
  }, [word])

  // Close on backdrop click or Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleAdd() {
    setAdding(true)
    await onAdd(word, definition ?? '')
    setAdded(true)
    setAdding(false)
    setTimeout(onClose, 800)
  }

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Word</p>
            <h2 className="text-2xl font-bold text-foreground">{word}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 mt-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Definition */}
        <div className="min-h-12">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Definition</p>
          {definition === null ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Looking up…
            </div>
          ) : definition ? (
            <p className="text-sm text-foreground leading-relaxed">{definition}</p>
          ) : (
            <p className="text-xs text-muted-foreground italic">No definition found</p>
          )}
        </div>

        {/* Source sentence */}
        <div className="bg-muted/50 rounded-xl px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">From the video</p>
          <p className="text-sm text-foreground leading-relaxed italic">
            "{highlightWord(sourceText, word)}"
          </p>
        </div>

        {/* CTA */}
        <button
          onClick={handleAdd}
          disabled={adding || added}
          className={[
            'w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-colors',
            added
              ? 'bg-green-500/15 text-green-600 cursor-default'
              : 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60',
          ].join(' ')}
        >
          {added ? (
            <><Check className="w-4 h-4" /> Added to My Vocabulary</>
          ) : adding ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Adding…</>
          ) : (
            <><BookPlus className="w-4 h-4" /> Add to My Vocabulary</>
          )}
        </button>
      </div>
    </div>
  )
}
