import { useRef, useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, X, Plus, Film, ListMusic, ChevronRight } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { searchContent } from '@/services/googleSheets'
import type { SearchResult } from '@/services/googleSheets'
import { UserButton } from '@/components/UserButton'

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
  /** Extra controls rendered between the search box and the avatar (e.g. QuizToggle, nav arrows). */
  right?: React.ReactNode
  /** Breadcrumb label shown after the logo with a chevron separator. */
  breadcrumb?: React.ReactNode
  /** Hide the "Add Video" button even for admins (default: false). */
  hideAddVideo?: boolean
}

export function AppHeader({ right, breadcrumb, hideAddVideo = false }: AppHeaderProps) {
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null)
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTab, setSearchTab] = useState<'videos' | 'playlists'>('videos')
  const searchRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced search
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

  // Close dropdown on outside click
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

  return (
    <header className="border-b border-border bg-card shrink-0">
      <div className="px-6 py-3 flex items-center gap-4">
        <Link to="/" className="font-semibold text-sm shrink-0 hover:text-foreground transition-colors">
          English Learning
        </Link>

        {breadcrumb && (
          <>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
            <span className="text-sm text-muted-foreground truncate shrink-0 max-w-xs">{breadcrumb}</span>
          </>
        )}

        {/* Search box + dropdown */}
        <div ref={searchRef} className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none z-10" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => { if (searchQuery.trim()) setSearchOpen(true) }}
            placeholder="Search videos or playlists…"
            className="w-full h-9 rounded-lg border border-input bg-background pl-9 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors z-10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Dropdown */}
          {searchOpen && searchQuery.trim() && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border bg-card shadow-2xl z-50 overflow-hidden">
              {loadingSearch ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">Searching…</div>
              ) : !searchResults || (searchResults.videos.length === 0 && searchResults.playlists.length === 0) ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No results for "{searchQuery.trim()}"
                </div>
              ) : (
                <>
                  {/* Tabs */}
                  <div className="flex border-b border-border">
                    <button
                      onClick={() => setSearchTab('videos')}
                      className={[
                        'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px',
                        searchTab === 'videos'
                          ? 'border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      ].join(' ')}
                    >
                      <Film className="w-3 h-3" />
                      Videos
                      {searchResults.videos.length > 0 && (
                        <span className="ml-0.5 text-[10px] bg-muted px-1.5 py-0.5 rounded-full">
                          {searchResults.videos.length}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setSearchTab('playlists')}
                      className={[
                        'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px',
                        searchTab === 'playlists'
                          ? 'border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:text-foreground',
                      ].join(' ')}
                    >
                      <ListMusic className="w-3 h-3" />
                      Playlists
                      {searchResults.playlists.length > 0 && (
                        <span className="ml-0.5 text-[10px] bg-muted px-1.5 py-0.5 rounded-full">
                          {searchResults.playlists.length}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Results */}
                  <div className="max-h-80 overflow-y-auto">
                    {searchTab === 'videos' && (
                      searchResults.videos.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-muted-foreground">No videos found</div>
                      ) : (
                        searchResults.videos.map((video) => (
                          <Link
                            key={video.videoId}
                            to={`/play/${video.videoId}`}
                            onClick={clearSearch}
                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors"
                          >
                            <img src={video.thumbnailUrl} alt="" className="w-16 rounded aspect-video object-cover shrink-0" />
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
                      )
                    )}
                    {searchTab === 'playlists' && (
                      searchResults.playlists.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-muted-foreground">No playlists found</div>
                      ) : (
                        searchResults.playlists.map((pl) => (
                          <button
                            key={pl.id}
                            onClick={() => { navigate(`/playlist/${pl.id}`); clearSearch() }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors text-left"
                          >
                            <div className="w-16 aspect-video rounded bg-muted flex items-center justify-center shrink-0">
                              <ListMusic className="w-5 h-5 text-muted-foreground/50" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium line-clamp-1">
                                <Highlight text={pl.name} query={searchQuery.trim()} />
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {pl.videoIds.length} video{pl.videoIds.length !== 1 ? 's' : ''}
                              </p>
                            </div>
                          </button>
                        ))
                      )
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 shrink-0">
          {right}
          {!hideAddVideo && isAdmin && (
            <Link
              to="/admin/new-video"
              className="h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-accent flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Video
            </Link>
          )}
          <UserButton />
        </div>
      </div>
    </header>
  )
}
