import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Trash2, Search, ChevronDown, ChevronUp, ExternalLink, Loader2, BookPlus } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { AppHeader } from '@/components/AppHeader'
import { getVocabWords, deleteVocabWord, searchCaptionIndex } from '@/services/vocabulary'
import { loadVideos } from '@/services/videos'
import { parseJSON3, fetchCaptionData } from '@/utils/captionParser'
import type { VocabEntry, VideoMeta } from '@/types'

// ─── Caption search ───────────────────────────────────────────────────────────

interface CaptionHit {
  video: VideoMeta
  startMs: number
  text: string
}

/**
 * 2-step search:
 * 1. Ask GAS which videoIds contain the word (O(1) API call, no caption fetches)
 * 2. Fetch captions only for matching videos to get exact cue text + timestamp
 */
async function searchCaptions(word: string, videoMap: Map<string, VideoMeta>): Promise<CaptionHit[]> {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')

  // Step 1 — get matching videoIds from the index
  const matchingIds = await searchCaptionIndex(word)
  if (matchingIds.length === 0) return []

  // Step 2 — fetch captions only for matching videos
  const matchingVideos = matchingIds
    .map((id) => videoMap.get(id))
    .filter((v): v is VideoMeta => v !== undefined)

  const results = await Promise.allSettled(
    matchingVideos.map(async (video): Promise<CaptionHit[]> => {
      const data = await fetchCaptionData(video.videoId)
      if (!data) return []
      const { cues } = parseJSON3(data)
      return cues
        .filter((c) => re.test(c.text))
        .map((c) => ({ video, startMs: c.startMs, text: c.text }))
    }),
  )

  return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function highlightWord(text: string, word: string): React.ReactNode {
  const re = new RegExp(`(\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b)`, 'gi')
  const parts = text.split(re)
  return (
    <>
      {parts.map((p, i) =>
        re.test(p)
          ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-800/60 text-inherit rounded-sm px-0.5">{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </>
  )
}

// ─── WordCard ─────────────────────────────────────────────────────────────────

function WordCard({
  entry,
  videoMap,
  onDelete,
}: {
  entry: VocabEntry
  videoMap: Map<string, VideoMeta>
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [hits, setHits] = useState<CaptionHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const didSearch = useRef(false)

  async function handleExpand() {
    setExpanded((v) => !v)
    if (!didSearch.current && !expanded) {
      didSearch.current = true
      setSearching(true)
      const results = await searchCaptions(entry.word, videoMap)
      setHits(results)
      setSearching(false)
    }
  }

  const sourceVideo = videoMap.get(entry.sourceVideoId)

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Word header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={handleExpand} className="flex-1 flex items-start gap-3 text-left min-w-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-semibold text-foreground">{entry.word}</span>
              {entry.definition && (
                <span className="text-xs text-muted-foreground line-clamp-1 flex-1 min-w-0">
                  {entry.definition}
                </span>
              )}
            </div>
            {/* Source sentence */}
            <p className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-1 italic">
              "{entry.sourceCueText}"
            </p>
          </div>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          }
        </button>
        <button
          onClick={onDelete}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
          title="Remove from vocabulary"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="border-t border-border bg-muted/30">
          {/* Definition */}
          {entry.definition && (
            <div className="px-4 py-3 border-b border-border/60">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Definition</p>
              <p className="text-sm text-foreground">{entry.definition}</p>
            </div>
          )}

          {/* Where you found it */}
          {sourceVideo && (
            <div className="px-4 py-3 border-b border-border/60">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Where you found it</p>
              <Link
                to={`/play/${sourceVideo.videoId}?t=${entry.sourceMs}`}
                className="flex items-center gap-2.5 hover:bg-accent rounded-lg p-1.5 -m-1.5 transition-colors group"
              >
                <img src={sourceVideo.thumbnailUrl} alt="" className="w-14 aspect-video rounded object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium line-clamp-1 group-hover:text-primary transition-colors">{sourceVideo.title}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 italic line-clamp-1">
                    "{entry.sourceCueText}"
                  </p>
                </div>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">{formatMs(entry.sourceMs)}</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />
              </Link>
            </div>
          )}

          {/* Caption search results */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Search className="w-3 h-3 text-muted-foreground" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">In other videos</p>
              {searching && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
              {hits && !searching && (
                <span className="text-[10px] text-muted-foreground ml-auto">{hits.length} result{hits.length !== 1 ? 's' : ''}</span>
              )}
            </div>

            {hits && hits.length === 0 && !searching && (
              <p className="text-xs text-muted-foreground py-2">No captions found for "{entry.word}"</p>
            )}

            {hits && hits.length > 0 && (
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {hits.map((hit, i) => (
                  <Link
                    key={i}
                    to={`/play/${hit.video.videoId}?t=${hit.startMs}`}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent transition-colors group"
                  >
                    <img src={hit.video.thumbnailUrl} alt="" className="w-10 aspect-video rounded object-cover shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-muted-foreground truncate group-hover:text-foreground transition-colors">{hit.video.title}</p>
                      <p className="text-xs text-foreground/80 line-clamp-1 mt-0.5">{highlightWord(hit.text, entry.word)}</p>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">{formatMs(hit.startMs)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── VocabularyPage ───────────────────────────────────────────────────────────

export default function VocabularyPage() {
  const { user } = useAuth()
  const [entries, setEntries] = useState<VocabEntry[]>([])
  const [videoMap, setVideoMap] = useState<Map<string, VideoMeta>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    Promise.all([
      getVocabWords(user.sub),
      loadVideos(),
    ])
      .then(([words, videos]) => {
        setEntries(words)
        setVideoMap(new Map(videos.map((v) => [v.videoId, v])))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user])

  async function handleDelete(entry: VocabEntry) {
    if (!user) return
    setEntries((prev) => prev.filter((e) => e.id !== entry.id))
    await deleteVocabWord(user.sub, entry.id).catch(console.error)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader breadcrumb="My Vocabulary" hideAddVideo />

      <main className="flex-1 px-4 py-4 md:px-6 md:py-6 max-w-3xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading vocabulary…
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <BookOpen className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">No words saved yet.</p>
            <p className="text-xs text-muted-foreground/60 max-w-xs">
              While watching a video, click on any word in the captions to add it to your vocabulary.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-muted-foreground">
                {entries.length} word{entries.length !== 1 ? 's' : ''}
              </p>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                <BookPlus className="w-3 h-3" />
                Click a word in captions to add
              </div>
            </div>
            <div className="space-y-2">
              {entries.map((entry) => (
                <WordCard
                  key={entry.id}
                  entry={entry}
                  videoMap={videoMap}
                  onDelete={() => handleDelete(entry)}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
