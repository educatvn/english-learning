import { useEffect, useRef, useState } from 'react'
import { BookPlus, Check, Loader2, X, Volume2 } from 'lucide-react'
import { fetchDictionaryEntry, type DictionaryEntry } from '@/services/vocabulary'

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
  const [entry, setEntry] = useState<DictionaryEntry | null | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(isSaved)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    setEntry(undefined)
    fetchDictionaryEntry(word).then(setEntry).catch(() => setEntry(null))
  }, [word])

  function playAudio() {
    if (!entry?.audioUrl) return
    if (!audioRef.current) {
      audioRef.current = new Audio(entry.audioUrl)
    } else {
      audioRef.current.src = entry.audioUrl
    }
    audioRef.current.currentTime = 0
    audioRef.current.play().catch(() => {})
  }

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      audioRef.current = null
    }
  }, [])

  const primaryDefinition =
    entry?.meanings?.[0]?.definitions?.[0]?.definition ?? ''

  // Close on backdrop click or Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleAdd() {
    setAdding(true)
    setError(null)
    try {
      await onAdd(word, primaryDefinition)
      setAdded(true)
      setTimeout(onClose, 800)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save. Please try again.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Word</p>
            <h2 className="text-2xl font-bold text-foreground wrap-break-word">{word}</h2>
            {/* Phonetic + audio */}
            {(entry?.phonetic || entry?.audioUrl) && (
              <div className="flex items-center gap-2 mt-1">
                {entry.phonetic && (
                  <span className="text-sm text-muted-foreground font-mono">{entry.phonetic}</span>
                )}
                {entry.audioUrl && (
                  <button
                    onClick={playAudio}
                    title="Play pronunciation"
                    className="w-7 h-7 rounded-full flex items-center justify-center text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 mt-0.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Loading / not found */}
        {entry === undefined ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-h-12">
            <Loader2 className="w-3 h-3 animate-spin" /> Looking up…
          </div>
        ) : entry === null ? (
          <p className="text-xs text-muted-foreground italic min-h-12">No definition found</p>
        ) : (
          <>
            {/* Meanings grouped by part of speech */}
            <div className="flex flex-col gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Meanings</p>
              {entry.meanings.map((m, mi) => (
                <div key={mi} className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-semibold italic text-primary">{m.partOfSpeech}</p>
                  <ol className="list-decimal list-inside space-y-1.5 marker:text-muted-foreground marker:text-[11px]">
                    {m.definitions.slice(0, 4).map((d, di) => (
                      <li key={di} className="text-sm text-foreground leading-relaxed">
                        <span>{d.definition}</span>
                        {d.example && (
                          <p className="text-xs text-muted-foreground italic mt-0.5 ml-4">
                            "{d.example}"
                          </p>
                        )}
                        {d.synonyms && d.synonyms.length > 0 && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 ml-4">
                            <span className="font-semibold">Synonyms:</span> {d.synonyms.slice(0, 6).join(', ')}
                          </p>
                        )}
                        {d.antonyms && d.antonyms.length > 0 && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 ml-4">
                            <span className="font-semibold">Antonyms:</span> {d.antonyms.slice(0, 6).join(', ')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>

            {/* Origin */}
            {entry.origin && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Origin</p>
                <p className="text-xs text-foreground leading-relaxed">{entry.origin}</p>
              </div>
            )}
          </>
        )}

        {/* Source sentence */}
        <div className="bg-muted/50 rounded-xl px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">From the video</p>
          <p className="text-sm text-foreground leading-relaxed italic">
            "{highlightWord(sourceText, word)}"
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
        )}

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
