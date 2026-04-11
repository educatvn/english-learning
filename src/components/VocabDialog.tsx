import { useEffect, useRef, useState } from 'react'
import { BookPlus, Check, Loader2, X, Volume2, Square } from 'lucide-react'
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

  // Group definitions by the headword's primary part of speech for a cleaner
  // Oxford-like layout. We display each POS section with its own headword
  // line (e.g. "resourceful adjective").
  const meaningSections = entry?.meanings ?? []

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 flex flex-col gap-4 font-serif"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button — positioned absolute in the corner */}
        <div className="flex items-start justify-end -mb-6">
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-foreground hover:bg-slate-100 dark:hover:bg-accent transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {entry === undefined ? (
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-muted-foreground min-h-24 font-sans">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking up…
          </div>
        ) : entry === null ? (
          <div className="min-h-24 font-sans">
            <h2 className="text-3xl font-bold text-[#0a1a44] dark:text-white wrap-break-word mb-2">{word}</h2>
            <p className="text-sm text-slate-500 dark:text-muted-foreground italic">No definition found</p>
          </div>
        ) : (
          <>
            {/* Headword + part of speech on first meaning */}
            <div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="text-3xl md:text-4xl font-bold text-[#0a1a44] dark:text-white wrap-break-word leading-tight">
                  {word}
                </h2>
                {meaningSections[0] && (
                  <span className="text-lg italic text-slate-600 dark:text-slate-300">
                    {meaningSections[0].partOfSpeech}
                  </span>
                )}
              </div>

              {/* Phonetic + audio */}
              {(entry.phonetic || entry.audioUrl) && (
                <div className="flex items-center gap-2 mt-2 font-sans">
                  {entry.audioUrl && (
                    <button
                      onClick={playAudio}
                      title="Play pronunciation"
                      className="w-5 h-5 rounded-full flex items-center justify-center text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors shrink-0"
                    >
                      <Volume2 className="w-4 h-4 fill-current" />
                    </button>
                  )}
                  {entry.phonetic && (
                    <span className="text-sm text-slate-700 dark:text-slate-300 font-mono">{entry.phonetic}</span>
                  )}
                </div>
              )}
            </div>

            {/* Meanings — Oxford style */}
            <div className="flex flex-col gap-5">
              {meaningSections.map((m, mi) => (
                <section key={mi} className="flex flex-col gap-2">
                  {/* Repeat headword + POS for subsequent meaning groups */}
                  {mi > 0 && (
                    <div className="flex items-baseline gap-2 flex-wrap pt-2 border-t border-slate-200 dark:border-border">
                      <h3 className="text-xl font-bold text-[#0a1a44] dark:text-white">
                        {word}
                      </h3>
                      <span className="text-base italic text-slate-600 dark:text-slate-300">
                        {m.partOfSpeech}
                      </span>
                    </div>
                  )}

                  {m.definitions.slice(0, 4).map((d, di) => (
                    <div key={di} className="flex gap-2 items-start">
                      {/* Hollow square marker */}
                      <Square className="w-3 h-3 mt-1.5 text-blue-700 dark:text-blue-400 shrink-0" strokeWidth={2} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] text-slate-900 dark:text-foreground leading-snug">
                          {d.definition}
                        </p>

                        {/* Example */}
                        {d.example && (
                          <ul className="mt-1.5 ml-0 list-none">
                            <li className="text-[14px] text-slate-700 dark:text-slate-300 italic leading-snug relative pl-4 before:content-['•'] before:absolute before:left-1 before:text-slate-400 before:not-italic">
                              {d.example}
                            </li>
                          </ul>
                        )}

                        {/* Synonyms — Oxford puts SYNONYM label then blue word */}
                        {d.synonyms && d.synonyms.length > 0 && (
                          <p className="text-[13px] mt-1.5 font-sans">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-muted-foreground mr-2">
                              Synonym
                            </span>
                            <span className="text-blue-700 dark:text-blue-400">
                              {d.synonyms.slice(0, 4).join(', ')}
                            </span>
                          </p>
                        )}

                        {/* Antonyms */}
                        {d.antonyms && d.antonyms.length > 0 && (
                          <p className="text-[13px] mt-1 font-sans">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-muted-foreground mr-2">
                              Opposite
                            </span>
                            <span className="text-blue-700 dark:text-blue-400">
                              {d.antonyms.slice(0, 4).join(', ')}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>

            {/* Origin */}
            {entry.origin && (
              <div className="pt-3 border-t border-slate-200 dark:border-border">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-muted-foreground mb-1 font-sans">Origin</p>
                <p className="text-[13px] text-slate-700 dark:text-slate-300 leading-relaxed">{entry.origin}</p>
              </div>
            )}
          </>
        )}

        {/* Source sentence */}
        <div className="bg-slate-50 dark:bg-muted/50 rounded-xl px-3 py-2.5 font-sans border border-slate-200/60 dark:border-transparent">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-muted-foreground mb-1">From the video</p>
          <p className="text-sm text-slate-800 dark:text-foreground leading-relaxed italic">
            "{highlightWord(sourceText, word)}"
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 font-sans">{error}</p>
        )}

        {/* CTA */}
        <button
          onClick={handleAdd}
          disabled={adding || added}
          className={[
            'w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-colors font-sans',
            added
              ? 'bg-green-500/15 text-green-600 cursor-default'
              : 'bg-[#0a1a44] text-white hover:bg-[#0a1a44]/90 disabled:opacity-60 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90',
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
