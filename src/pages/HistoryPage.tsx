import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Clock, Play, Trash2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { getViewHistory } from '@/services/googleSheets'
import { loadVideos } from '@/services/videos'
import { UserButton } from '@/components/UserButton'
import type { ViewEntry, VideoMeta } from '@/types'

// ─── helpers ─────────────────────────────────────────────────────────────────

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const fmt = (date: Date) =>
    date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return fmt(d)
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// Group entries by calendar day (client timezone), preserving newest-first order within each day
function groupByDay(entries: ViewEntry[]): { label: string; items: ViewEntry[] }[] {
  const map = new Map<string, ViewEntry[]>()
  for (const e of entries) {
    const key = new Date(e.viewedAt).toDateString()
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(e)
  }
  return [...map.entries()].map(([key, items]) => ({
    label: dayLabel(items[0].viewedAt),
    items,
    _key: key,
  }))
}

// ─── HistoryPage ──────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { user } = useAuth()
  const [entries, setEntries] = useState<ViewEntry[]>([])
  const [videoMap, setVideoMap] = useState<Map<string, VideoMeta>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    Promise.all([getViewHistory(user.sub), loadVideos()])
      .then(([history, videos]) => {
        setEntries(history)
        setVideoMap(new Map(videos.map((v) => [v.videoId, v])))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [user])

  function removeEntry(viewedAt: string) {
    setEntries((prev) => prev.filter((e) => e.viewedAt !== viewedAt))
  }

  const groups = groupByDay(entries)

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors font-medium">
              English Learning
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-semibold">Watch History</span>
          </div>
          <UserButton />
        </div>
      </header>

      <main className="flex-1 px-6 py-6 max-w-3xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground text-sm gap-2">
            <Clock className="w-4 h-4 animate-pulse" />
            Loading history…
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <Clock className="w-10 h-10 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">No watch history yet.</p>
            <Link
              to="/"
              className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 flex items-center gap-1.5 transition-colors"
            >
              <Play className="w-3.5 h-3.5" /> Browse videos
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map((group) => (
              <section key={group._key}>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  {group.label}
                </h2>
                <div className="space-y-2">
                  {group.items.map((entry) => {
                    const video = videoMap.get(entry.videoId)
                    return (
                      <HistoryRow
                        key={entry.viewedAt}
                        entry={entry}
                        video={video}
                        onRemove={() => removeEntry(entry.viewedAt)}
                      />
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

// ─── HistoryRow ───────────────────────────────────────────────────────────────

function HistoryRow({
  entry,
  video,
  onRemove,
}: {
  entry: ViewEntry
  video: VideoMeta | undefined
  onRemove: () => void
}) {
  return (
    <div className="group flex items-center gap-4 p-3 rounded-xl border border-border bg-card hover:border-foreground/20 transition-colors">
      {/* Thumbnail */}
      <Link to={`/play/${entry.videoId}`} className="shrink-0">
        {video?.thumbnailUrl ? (
          <div className="relative w-24 rounded-lg overflow-hidden aspect-video bg-muted">
            <img
              src={video.thumbnailUrl}
              alt={video.title}
              className="w-full h-full object-cover"
            />
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

      {/* Info */}
      <div className="flex-1 min-w-0">
        <Link to={`/play/${entry.videoId}`} className="hover:underline">
          <p className="text-sm font-medium line-clamp-2 leading-snug">
            {video?.title ?? entry.videoId}
          </p>
        </Link>
        {video?.channelName && (
          <p className="text-xs text-muted-foreground mt-0.5">{video.channelName}</p>
        )}
        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {timeLabel(entry.viewedAt)}
        </p>
      </div>

      {/* Remove button (local only — doesn't delete from Sheets) */}
      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 text-muted-foreground transition-all shrink-0"
        title="Remove from view"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
