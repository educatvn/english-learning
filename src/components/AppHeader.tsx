import { useRef, useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, X, Plus, Film, ListMusic, ChevronRight, Menu } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { searchContent } from '@/services/googleSheets'
import type { SearchResult } from '@/services/googleSheets'
import { UserButton } from '@/components/UserButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// ─── Highlight ────────────────────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-800/60 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

// ─── AppHeader ────────────────────────────────────────────────────────────────

interface AppHeaderProps {
  right?: React.ReactNode
  breadcrumb?: React.ReactNode
  hideAddVideo?: boolean
  /** Shows a hamburger button on mobile that calls this handler */
  onMenuClick?: () => void
}

export function AppHeader({ right, breadcrumb, hideAddVideo = false, onMenuClick }: AppHeaderProps) {
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null)
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTab, setSearchTab] = useState<'videos' | 'playlists'>('videos')
  const searchRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const q = searchQuery.trim()
    if (!q) { setSearchResults(null); setSearchOpen(false); return }
    setLoadingSearch(true)
    setSearchOpen(true)
    setSearchTab('videos')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      searchContent(q, user?.sub ?? '')
        .then((res) => { setSearchResults(res); setLoadingSearch(false) })
        .catch(() => setLoadingSearch(false))
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery, user?.sub])

  useEffect(() => {
    if (!searchOpen) return
    function onDown(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [searchOpen])

  function clearSearch() {
    setSearchQuery('')
    setSearchOpen(false)
  }

  const searchDropdown = searchOpen && searchQuery.trim() && (
    <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border bg-card shadow-2xl z-50 overflow-hidden">
      {loadingSearch ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">Searching…</div>
      ) : !searchResults || (searchResults.videos.length === 0 && searchResults.playlists.length === 0) ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No results for "{searchQuery.trim()}"
        </div>
      ) : (
        <>
          <div className="flex border-b border-border">
            {(['videos', 'playlists'] as const).map((tab) => (
              <Button
                key={tab}
                variant="ghost"
                onClick={() => setSearchTab(tab)}
                className={[
                  'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 rounded-none transition-colors -mb-px',
                  searchTab === tab
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {tab === 'videos' ? <Film className="w-3 h-3" /> : <ListMusic className="w-3 h-3" />}
                {tab === 'videos' ? 'Videos' : 'Playlists'}
                {tab === 'videos' && searchResults.videos.length > 0 && (
                  <span className="ml-0.5 text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{searchResults.videos.length}</span>
                )}
                {tab === 'playlists' && searchResults.playlists.length > 0 && (
                  <span className="ml-0.5 text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{searchResults.playlists.length}</span>
                )}
              </Button>
            ))}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {searchTab === 'videos' && (
              searchResults.videos.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No videos found</div>
              ) : searchResults.videos.map((video) => (
                <Link
                  key={video.videoId}
                  to={`/play/${video.videoId}`}
                  onClick={clearSearch}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors"
                >
                  <img src={video.thumbnailUrl} alt="" className="w-14 rounded aspect-video object-cover shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-1">
                      <Highlight text={video.title} query={searchQuery.trim()} />
                    </p>
                    {video.channelName && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <Highlight text={video.channelName} query={searchQuery.trim()} />
                      </p>
                    )}
                  </div>
                </Link>
              ))
            )}
            {searchTab === 'playlists' && (
              searchResults.playlists.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No playlists found</div>
              ) : searchResults.playlists.map((pl) => (
                <Button
                  key={pl.id}
                  variant="ghost"
                  onClick={() => { navigate(`/playlist/${pl.id}`); clearSearch() }}
                  className="w-full h-auto flex items-center gap-3 px-4 py-2.5 rounded-none justify-start text-left"
                >
                  <div className="w-14 aspect-video rounded bg-muted flex items-center justify-center shrink-0">
                    <ListMusic className="w-4 h-4 text-muted-foreground/50" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-1">
                      <Highlight text={pl.name} query={searchQuery.trim()} />
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {pl.videoIds.length} video{pl.videoIds.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </Button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )

  return (
    <header className="border-b border-border bg-card shrink-0">
      {/*
        Layout strategy:
        – Mobile:  Row 1 = [hamburger] [logo] [breadcrumb hidden-sm] [ml-auto: right + avatar]
                   Row 2 = [search box full-width]
        – Desktop: Single row = [logo] [breadcrumb] [search flex-1] [right + Add Video + avatar]
        flex-wrap + CSS order achieves this without duplicate markup.
      */}
      <div className="px-4 md:px-6 flex flex-wrap items-center gap-x-3 gap-y-2 py-2 md:py-0 md:h-12">

        {/* ── Logo + hamburger (order 1 on both) ── */}
        <div className="flex items-center gap-2 shrink-0 order-1">
          {onMenuClick && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onMenuClick}
              className="md:hidden text-muted-foreground"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </Button>
          )}
          <Link to="/" className="flex items-center gap-2 shrink-0 hover:opacity-90 transition-opacity">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="E" className="w-6 h-6 rounded" />
            <span className="font-semibold text-sm">English Learning</span>
          </Link>
          {breadcrumb && (
            <div className="hidden sm:flex items-center gap-1.5 min-w-0">
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
              <span className="text-sm text-muted-foreground truncate max-w-[180px] md:max-w-xs">{breadcrumb}</span>
            </div>
          )}
        </div>

        {/* ── Right controls (order 2 on mobile → right of logo; order 3 on desktop) ── */}
        <div className="ml-auto flex items-center gap-1.5 shrink-0 order-2 md:order-3">
          {right}
          {!hideAddVideo && isAdmin && (
            <Link
              to="/admin/new-video"
              className="hidden sm:flex h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-accent items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Video
            </Link>
          )}
          <UserButton />
        </div>

        {/* ── Search (order 3 on mobile → wraps to row 2; order 2 on desktop → middle) ── */}
        <div ref={searchRef} className="w-full order-3 md:order-2 md:flex-1 md:w-auto relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none z-10" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => { if (searchQuery.trim()) setSearchOpen(true) }}
            placeholder="Search videos or playlists…"
            className="h-9 pl-9 pr-9"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground z-10"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
          {searchDropdown}
        </div>

      </div>
    </header>
  )
}
