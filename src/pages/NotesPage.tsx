import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { StickyNote, Search, Play, Trash2, Clock, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { searchNotes, deleteNote } from '@/services/googleSheets'
import { AppHeader } from '@/components/AppHeader'
import type { NoteWithMeta } from '@/services/googleSheets'

const PAGE_SIZE = 15

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function buildPages(total: number, current: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | '…')[] = [1]
  if (current > 3) pages.push('…')
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push('…')
  pages.push(total)
  return pages
}

// ─── NotesPage ────────────────────────────────────────────────────────────────

export default function NotesPage() {
  const { user } = useAuth()

  const [notes, setNotes] = useState<NoteWithMeta[]>([])
  const [total, setTotal] = useState(0)
  const [initialLoading, setInitialLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Core fetch — always goes to GAS
  async function doFetch(query: string, p: number) {
    if (!user) return
    setFetching(true)
    try {
      const res = await searchNotes(user.sub, query, (p - 1) * PAGE_SIZE, PAGE_SIZE)
      setNotes(res.notes)
      setTotal(res.total)
    } catch (e) {
      console.error(e)
    } finally {
      setFetching(false)
    }
  }

  // Initial load
  useEffect(() => {
    if (!user) return
    setInitialLoading(true)
    searchNotes(user.sub, '', 0, PAGE_SIZE)
      .then((res) => { setNotes(res.notes); setTotal(res.total) })
      .catch(console.error)
      .finally(() => setInitialLoading(false))
  }, [user])

  function handleSearchChange(q: string) {
    setSearch(q)
    setPage(1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doFetch(q, 1), 350)
  }

  function handlePageChange(p: number) {
    setPage(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    doFetch(search, p)
  }

  function handleDelete(createdAt: string) {
    if (!user) return
    setNotes((prev) => prev.filter((n) => n.createdAt !== createdAt))
    setTotal((t) => Math.max(0, t - 1))
    deleteNote(user.sub, createdAt).catch(console.error)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Determine which view to show
  const isFirstLoad = initialLoading
  const isEmptyLibrary = !initialLoading && total === 0 && search === '' && !fetching
  const isNoResults = !initialLoading && total === 0 && search !== ''

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader breadcrumb="My Notes" hideAddVideo />

      <main className="flex-1 px-6 py-6 max-w-3xl mx-auto w-full">
        {/* ── First load spinner ── */}
        {isFirstLoad ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground text-sm gap-2">
            <StickyNote className="w-4 h-4 animate-pulse" />
            Loading notes…
          </div>

        ) : isEmptyLibrary ? (
          /* ── No notes at all ── */
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <StickyNote className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">No notes yet.<br />Add notes while watching a video.</p>
            <Link
              to="/"
              className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 flex items-center gap-1.5 transition-colors"
            >
              <Play className="w-3.5 h-3.5" /> Browse videos
            </Link>
          </div>

        ) : (
          /* ── Search + results ── */
          <>
            {/* Search bar */}
            <div className="flex items-center gap-3 mb-5">
              <div className="relative flex-1">
                {fetching ? (
                  <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
                ) : (
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                )}
                <input
                  type="text"
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search in note text or video title…"
                  className="w-full h-9 pl-9 pr-4 rounded-lg border border-border bg-card text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition"
                />
              </div>
              <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                {total} note{total !== 1 ? 's' : ''}
              </span>
            </div>

            {/* No search results */}
            {isNoResults ? (
              <div className="py-16 text-center text-muted-foreground text-sm">
                No notes match <span className="font-medium">"{search}"</span>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {notes.map((note) => (
                    <NoteRow
                      key={note.createdAt}
                      note={note}
                      search={search}
                      onDelete={() => handleDelete(note.createdAt)}
                    />
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-1 mt-6 flex-wrap">
                    <button
                      onClick={() => handlePageChange(Math.max(1, page - 1))}
                      disabled={page === 1}
                      className="h-8 px-3 rounded-lg text-xs border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Prev
                    </button>
                    {buildPages(totalPages, page).map((p, i) =>
                      p === '…' ? (
                        <span key={`ell-${i}`} className="h-8 w-8 flex items-center justify-center text-xs text-muted-foreground">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => handlePageChange(p)}
                          className={[
                            'h-8 w-8 rounded-lg text-xs border transition-colors',
                            p === page
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border hover:bg-accent',
                          ].join(' ')}
                        >
                          {p}
                        </button>
                      )
                    )}
                    <button
                      onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                      disabled={page === totalPages}
                      className="h-8 px-3 rounded-lg text-xs border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

// ─── NoteRow ──────────────────────────────────────────────────────────────────

function NoteRow({
  note,
  search,
  onDelete,
}: {
  note: NoteWithMeta
  search: string
  onDelete: () => void
}) {
  const videoUrl = `/play/${note.videoId}?t=${note.positionMs}`

  return (
    <div className="group flex items-start gap-4 p-3 rounded-xl border border-border bg-card hover:border-foreground/20 transition-colors">
      {/* Thumbnail */}
      <Link to={videoUrl} className="shrink-0 mt-0.5">
        {note.videoThumbnailUrl ? (
          <div className="relative w-24 rounded-lg overflow-hidden aspect-video bg-muted">
            <img src={note.videoThumbnailUrl} alt={note.videoTitle} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 flex items-center justify-center transition-colors">
              <Play className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity fill-white" />
            </div>
          </div>
        ) : (
          <div className="w-24 rounded-lg aspect-video bg-muted flex items-center justify-center">
            <Play className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
      </Link>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Video title row + timestamp chip */}
        <div className="flex items-start gap-2 mb-1.5">
          <Link to={videoUrl} className="hover:underline flex-1 min-w-0">
            <p className="text-xs text-muted-foreground line-clamp-1">
              <Highlight text={note.videoTitle || note.videoId} query={search} />
            </p>
          </Link>
          <Link
            to={videoUrl}
            className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono text-yellow-500 hover:text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20 px-1.5 py-0.5 rounded transition-colors"
            title="Jump to this timestamp"
          >
            {formatTime(note.positionMs)}
          </Link>
        </div>

        {/* Note text */}
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap line-clamp-4">
          <Highlight text={note.text} query={search} />
        </p>

        {/* Date */}
        <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDate(note.createdAt)}
        </p>
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 text-muted-foreground transition-all shrink-0 mt-0.5"
        title="Delete note"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ─── Highlight ────────────────────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-400/30 text-inherit rounded-sm px-0.5">{part}</mark>
        ) : part
      )}
    </>
  )
}
