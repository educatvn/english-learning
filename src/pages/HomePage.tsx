import { useEffect, useRef, useState, useCallback } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Play, Plus, ListVideo, Trash2, X, Check,
  Pencil, ChevronUp, ChevronDown, GripVertical, Globe, Lock, RotateCcw,
  Search, ChevronLeft, ChevronRight, Film, ListMusic,
} from 'lucide-react'
import type { VideoMeta, Playlist, VideoProgress } from '@/types'
import { isResumable } from '@/types'
import { loadPlaylists, savePlaylist, deletePlaylist } from '@/services/playlists'
import { getVideosPaged, getRecentProgress, searchContent } from '@/services/googleSheets'
import type { SearchResult } from '@/services/googleSheets'
import { useAuth } from '@/context/AuthContext'
import { UserButton } from '@/components/UserButton'

// ─── HomePage ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const PAGE_SIZE = 24

  const { id: playlistIdFromUrl } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const selectedPlaylistId = playlistIdFromUrl ?? null

  // ── Playlists ────────────────────────────────────────────────────────────
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loadingPlaylists, setLoadingPlaylists] = useState(true)

  // ── Paged videos (grid) ──────────────────────────────────────────────────
  const [videos, setVideos] = useState<VideoMeta[]>([])
  const [totalVideos, setTotalVideos] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingVideos, setLoadingVideos] = useState(true)

  // ── Continue Learning ────────────────────────────────────────────────────
  const [continueItem, setContinueItem] = useState<{ progress: VideoProgress; video: VideoMeta } | null>(null)
  const [loadingContinue, setLoadingContinue] = useState(true)

  // ── Search ───────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null)
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTab, setSearchTab] = useState<'videos' | 'playlists'>('videos')
  const searchRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Playlist editing ─────────────────────────────────────────────────────
  const [creatingPlaylist, setCreatingPlaylist] = useState(false)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const newPlaylistInputRef = useRef<HTMLInputElement>(null)
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null)

  // ── Initial load: playlists + continue learning ──────────────────────────
  useEffect(() => {
    if (!user) return
    setLoadingPlaylists(true)
    setLoadingContinue(true)
    loadPlaylists(user.sub)
      .then((p) => setPlaylists(p))
      .catch(console.error)
      .finally(() => setLoadingPlaylists(false))
    getRecentProgress(user.sub, 1)
      .then(async (progressList) => {
        const latest = progressList.find(isResumable)
        if (!latest) { setContinueItem(null); return }
        const { videos: firstPage } = await getVideosPaged(0, 100)
        const video = new Map(firstPage.map((v) => [v.videoId, v])).get(latest.videoId)
        setContinueItem(video ? { progress: latest, video } : null)
      })
      .catch(console.error)
      .finally(() => setLoadingContinue(false))
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch page of videos (for grid) ─────────────────────────────────────
  const fetchPage = useCallback(async (p: number) => {
    setLoadingVideos(true)
    const offset = (p - 1) * PAGE_SIZE
    try {
      const { videos: v, total } = await getVideosPaged(offset, PAGE_SIZE)
      setVideos(v)
      setTotalVideos(total)
      setPage(p)
    } catch (e) { console.error(e) }
    finally { setLoadingVideos(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPage(1)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Debounced search ─────────────────────────────────────────────────────
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
  }, [searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close search dropdown on outside click
  useEffect(() => {
    if (!searchOpen) return
    function onDown(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [searchOpen])

  useEffect(() => {
    if (creatingPlaylist) newPlaylistInputRef.current?.focus()
  }, [creatingPlaylist])

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleCreatePlaylist() {
    if (!user) return
    const name = newPlaylistName.trim()
    if (!name) return
    const playlist: Playlist = {
      id: Date.now().toString(), name, videoIds: [],
      createdAt: new Date().toISOString(), ownerId: user.sub,
      isSystem: false, isPublic: false,
    }
    setPlaylists((prev) => [...prev, playlist])
    setNewPlaylistName('')
    setCreatingPlaylist(false)
    navigate(`/playlist/${playlist.id}`)
    void savePlaylist(playlist)
  }

  function handleDeletePlaylist(id: string) {
    setPlaylists((prev) => prev.filter((p) => p.id !== id))
    if (selectedPlaylistId === id) navigate('/')
    void deletePlaylist(id)
  }

  function handleSaveEditedPlaylist(updated: Playlist) {
    setPlaylists((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    setEditingPlaylist(null)
    void savePlaylist(updated)
  }

  function handleAddToPlaylist(videoId: string, playlistId: string) {
    const playlist = playlists.find((p) => p.id === playlistId)
    if (!playlist || playlist.videoIds.includes(videoId)) return
    if (!isAdmin && playlist.ownerId !== user?.sub) return
    const updated = { ...playlist, videoIds: [...playlist.videoIds, videoId] }
    setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? updated : p)))
    void savePlaylist(updated)
  }

  function handleRemoveFromPlaylist(videoId: string, playlistId: string) {
    const playlist = playlists.find((p) => p.id === playlistId)
    if (!playlist) return
    if (!isAdmin && playlist.ownerId !== user?.sub) return
    const updated = { ...playlist, videoIds: playlist.videoIds.filter((id) => id !== videoId) }
    setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? updated : p)))
    void savePlaylist(updated)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedPlaylist = playlists.find((p) => p.id === selectedPlaylistId) ?? null
  const systemPlaylists = playlists.filter((p) => p.isSystem)
  const userPlaylists = playlists.filter((p) => !p.isSystem && p.ownerId === user?.sub)

  // When a playlist is selected, show only its videos from the loaded page
  const visibleVideos = selectedPlaylist
    ? (selectedPlaylist.videoIds.map((id) => videos.find((v) => v.videoId === id)).filter(Boolean) as VideoMeta[])
    : videos
  const totalPages = Math.max(1, Math.ceil(totalVideos / PAGE_SIZE))

  function canEdit(p: Playlist) {
    if (isAdmin) return true
    return p.ownerId === user?.sub
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-3 flex items-center gap-4">
          <span className="font-semibold text-sm shrink-0">English Learning</span>

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
                onClick={() => { setSearchQuery(''); setSearchOpen(false) }}
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
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">No results for "{searchQuery.trim()}"</div>
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

                    {/* Tab content */}
                    <div className="max-h-80 overflow-y-auto">
                      {searchTab === 'videos' && (
                        searchResults.videos.length === 0 ? (
                          <div className="px-4 py-8 text-center text-sm text-muted-foreground">No videos found</div>
                        ) : (
                          searchResults.videos.map((video) => (
                            <Link
                              key={video.videoId}
                              to={`/play/${video.videoId}`}
                              onClick={() => { setSearchOpen(false); setSearchQuery('') }}
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
                              onClick={() => { navigate(`/playlist/${pl.id}`); setSearchOpen(false); setSearchQuery('') }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors text-left"
                            >
                              <div className="w-16 aspect-video rounded bg-muted flex items-center justify-center shrink-0">
                                <ListMusic className="w-5 h-5 text-muted-foreground/50" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium line-clamp-1">
                                  <Highlight text={pl.name} query={searchQuery.trim()} />
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">{pl.videoIds.length} video{pl.videoIds.length !== 1 ? 's' : ''}</p>
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

          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && (
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

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 border-r border-border bg-card flex flex-col py-3 gap-0.5 overflow-y-auto">
          {/* All Videos */}
          <SidebarItem
            label="All Videos"
            count={loadingPlaylists ? null : totalVideos}
            active={selectedPlaylistId === null}
            onClick={() => navigate('/')}
          />

          {/* ── System Playlists ── */}
          {loadingPlaylists ? (
            <SidebarSkeleton />
          ) : (
            <>
              {systemPlaylists.length > 0 && (
                <>
                  <SidebarSection label="Playlists" />
                  {systemPlaylists.map((playlist) => (
                    <SidebarItem
                      key={playlist.id}
                      label={playlist.name}
                      count={playlist.videoIds.length}
                      active={selectedPlaylistId === playlist.id}
                      onClick={() => navigate(`/playlist/${playlist.id}`)}
                      onEdit={canEdit(playlist) ? () => setEditingPlaylist(playlist) : undefined}
                      onDelete={isAdmin ? () => handleDeletePlaylist(playlist.id) : undefined}
                    />
                  ))}
                </>
              )}

              {/* ── Admin: create system playlist ── */}
              {isAdmin && (
                <div className="px-3 mt-1">
                  <CreateSystemPlaylistButton user={user} onCreated={(pl) => {
                    setPlaylists((prev) => [...prev, pl])
                    void savePlaylist(pl)
                  }} />
                </div>
              )}

              {/* ── User Playlists ── */}
              <div className="mt-2">
                <div className="px-3 mb-1 flex items-center justify-between">
                  <SidebarSection label="Your Playlists" inline />
                  <button
                    onClick={() => setCreatingPlaylist(true)}
                    className="w-5 h-5 rounded flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title="New playlist"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {creatingPlaylist && (
                  <div className="mx-2 mb-1 flex items-center gap-1">
                    <input
                      ref={newPlaylistInputRef}
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreatePlaylist()
                        if (e.key === 'Escape') { setCreatingPlaylist(false); setNewPlaylistName('') }
                      }}
                      placeholder="Playlist name…"
                      className="flex-1 h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      onClick={handleCreatePlaylist}
                      disabled={!newPlaylistName.trim()}
                      className="w-6 h-6 rounded flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => { setCreatingPlaylist(false); setNewPlaylistName('') }}
                      className="w-6 h-6 rounded flex items-center justify-center hover:bg-accent transition-colors text-muted-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {userPlaylists.length === 0 && !creatingPlaylist && (
                  <p className="px-3 text-xs text-muted-foreground">No playlists yet</p>
                )}

                {userPlaylists.map((playlist) => (
                  <SidebarItem
                    key={playlist.id}
                    label={playlist.name}
                    count={playlist.videoIds.length}
                    active={selectedPlaylistId === playlist.id}
                    onClick={() => navigate(`/playlist/${playlist.id}`)}
                    isPublic={playlist.isPublic}
                    onEdit={() => setEditingPlaylist(playlist)}
                    onDelete={() => handleDeletePlaylist(playlist.id)}
                  />
                ))}
              </div>
            </>
          )}
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto px-6 py-6">
          {/* ── Continue Learning — hide when viewing a playlist ── */}
          {selectedPlaylistId === null && (loadingContinue || continueItem) && (
            <section className="mb-7">
              {loadingContinue ? (
                <ContinueLearningBannerSkeleton />
              ) : continueItem ? (
                <ContinueLearningBanner progress={continueItem.progress} video={continueItem.video} />
              ) : null}
            </section>
          )}

          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="font-semibold text-base">
                {selectedPlaylist ? selectedPlaylist.name : 'All Videos'}
              </h1>
              {!loadingVideos && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedPlaylist ? `${visibleVideos.length}` : totalVideos} video{totalVideos !== 1 ? 's' : ''}
                  {!selectedPlaylist && totalPages > 1 && ` — page ${page} of ${totalPages}`}
                </p>
              )}
            </div>
            {selectedPlaylist && selectedPlaylist.videoIds.length > 0 && (
              <Link
                to={`/playlist/${selectedPlaylist.id}/play`}
                className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 flex items-center gap-1.5 transition-colors"
              >
                <Play className="w-3.5 h-3.5" /> Play All
              </Link>
            )}
          </div>

          {loadingVideos ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {Array.from({ length: PAGE_SIZE }).map((_, i) => <VideoCardSkeleton key={i} />)}
            </div>
          ) : visibleVideos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
              <ListVideo className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">
                {selectedPlaylist ? 'This playlist has no videos yet.' : 'No videos yet.'}
              </p>
              {!selectedPlaylist && isAdmin && (
                <Link
                  to="/admin/new-video"
                  className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add video
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {visibleVideos.map((video) => {
                  const editablePlaylists = playlists.filter((p) => canEdit(p))
                  return (
                    <VideoCard
                      key={video.videoId}
                      video={video}
                      playlists={editablePlaylists}
                      activePlaylistId={selectedPlaylistId}
                      onAddToPlaylist={handleAddToPlaylist}
                      onRemoveFromPlaylist={handleRemoveFromPlaylist}
                    />
                  )
                })}
              </div>

              {!selectedPlaylist && totalPages > 1 && (
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  onChange={(p) => { fetchPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                />
              )}
            </>
          )}
        </main>
      </div>

      {editingPlaylist && (
        <PlaylistEditModal
          playlist={editingPlaylist}
          videos={videos}
          isAdmin={isAdmin}
          onSave={handleSaveEditedPlaylist}
          onClose={() => setEditingPlaylist(null)}
        />
      )}
    </div>
  )
}

// ─── Highlight ────────────────────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-800/60 text-inherit rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, onChange }: {
  page: number
  totalPages: number
  onChange: (p: number) => void
}) {
  // Show at most 7 page buttons with ellipsis
  const pages: (number | '…')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('…')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i)
    if (page < totalPages - 2) pages.push('…')
    pages.push(totalPages)
  }

  return (
    <div className="flex items-center justify-center gap-1 mt-8">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="w-8 h-8 rounded-lg flex items-center justify-center border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {pages.map((p, i) =>
        p === '…' ? (
          <span key={`ellipsis-${i}`} className="w-8 h-8 flex items-center justify-center text-xs text-muted-foreground">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={[
              'w-8 h-8 rounded-lg text-xs font-medium transition-colors',
              p === page
                ? 'bg-primary text-primary-foreground'
                : 'border border-border hover:bg-accent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {p}
          </button>
        )
      )}

      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        className="w-8 h-8 rounded-lg flex items-center justify-center border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function Shimmer({ className }: { className: string }) {
  return (
    <div className={['rounded-md bg-muted animate-pulse', className].join(' ')} />
  )
}

function VideoCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <Shimmer className="aspect-video w-full rounded-none rounded-t-xl" />
      <div className="px-2 py-2 flex flex-col gap-1.5">
        <Shimmer className="h-3 w-full" />
        <Shimmer className="h-3 w-2/3" />
        <Shimmer className="h-2.5 w-1/2 mt-0.5" />
      </div>
    </div>
  )
}

// ─── ContinueLearningBanner ───────────────────────────────────────────────────

function ContinueLearningBannerSkeleton() {
  return (
    <div className="flex items-center gap-4 p-3 rounded-xl border border-border bg-card">
      <Shimmer className="shrink-0 w-32 rounded-lg aspect-video" />
      <div className="flex-1 flex flex-col gap-2">
        <Shimmer className="h-3 w-3/4" />
        <Shimmer className="h-3 w-1/2" />
        <Shimmer className="h-2.5 w-24 mt-0.5" />
      </div>
      <Shimmer className="shrink-0 h-8 w-24 rounded-lg" />
    </div>
  )
}

function ContinueLearningBanner({ progress, video }: { progress: VideoProgress; video: VideoMeta }) {
  const pct = progress.durationMs > 0
    ? Math.min(100, (progress.positionMs / progress.durationMs) * 100)
    : null

  return (
    <Link
      to={`/play/${video.videoId}?t=${progress.positionMs}`}
      className="group flex items-center gap-4 p-3 rounded-xl border border-border bg-card hover:border-foreground/20 hover:shadow-sm transition-all"
    >
      {/* Thumbnail */}
      <div className="relative shrink-0 w-32 rounded-lg aspect-video bg-muted overflow-hidden">
        <img
          src={video.thumbnailUrl}
          alt={video.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <div className="w-7 h-7 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">
            <Play className="w-3 h-3 text-gray-900 translate-x-0.5" />
          </div>
        </div>
        {pct !== null && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
            <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
          <RotateCcw className="w-3 h-3" /> Continue Learning
        </p>
        <p className="text-sm font-medium line-clamp-2 leading-snug">{video.title}</p>
        <p className="text-[11px] text-muted-foreground mt-1">
          Resume from {formatProgressTime(progress.positionMs)}
          {pct !== null && <span className="ml-1.5 text-muted-foreground/60">· {Math.round(pct)}% done</span>}
        </p>
      </div>

      {/* CTA */}
      <div className="shrink-0 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 group-hover:bg-primary/90 transition-colors">
        <Play className="w-3 h-3" /> Resume
      </div>
    </Link>
  )
}

function formatProgressTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

// ─── CreateSystemPlaylistButton ───────────────────────────────────────────────

function CreateSystemPlaylistButton({
  user,
  onCreated,
}: {
  user: { sub: string } | null
  onCreated: (pl: Playlist) => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (creating) inputRef.current?.focus() }, [creating])

  function submit() {
    const trimmed = name.trim()
    if (!trimmed || !user) return
    const pl: Playlist = {
      id: Date.now().toString(),
      name: trimmed,
      videoIds: [],
      createdAt: new Date().toISOString(),
      ownerId: user.sub,
      isSystem: true,
      isPublic: false,
    }
    onCreated(pl)
    setName('')
    setCreating(false)
  }

  if (!creating) {
    return (
      <button
        onClick={() => setCreating(true)}
        className="w-full text-left text-xs text-muted-foreground hover:text-foreground py-1 flex items-center gap-1 transition-colors"
      >
        <Plus className="w-3 h-3" /> New system playlist
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1 mb-1">
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') { setCreating(false); setName('') }
        }}
        placeholder="System playlist name…"
        className="flex-1 h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <button
        onClick={submit}
        disabled={!name.trim()}
        className="w-6 h-6 rounded flex items-center justify-center bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => { setCreating(false); setName('') }}
        className="w-6 h-6 rounded flex items-center justify-center hover:bg-accent transition-colors text-muted-foreground"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ─── SidebarSection ───────────────────────────────────────────────────────────

function SidebarSection({ label, inline }: { label: string; inline?: boolean }) {
  const cls = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'
  if (inline) return <span className={cls}>{label}</span>
  return (
    <div className="px-3 mt-2 mb-1">
      <span className={cls}>{label}</span>
    </div>
  )
}

// ─── SidebarSkeleton ─────────────────────────────────────────────────────────

function SidebarSkeleton() {
  return (
    <div className="mt-2 flex flex-col gap-0.5">
      <div className="px-3 mb-1">
        <Shimmer className="h-2.5 w-16" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="mx-2 px-2 py-1.5 flex items-center gap-2">
          <Shimmer className="flex-1 h-3" />
          <Shimmer className="w-4 h-2.5 shrink-0" />
        </div>
      ))}
      <div className="mt-3 px-3 mb-1">
        <Shimmer className="h-2.5 w-20" />
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="mx-2 px-2 py-1.5 flex items-center gap-2">
          <Shimmer className="flex-1 h-3" />
          <Shimmer className="w-4 h-2.5 shrink-0" />
        </div>
      ))}
    </div>
  )
}

// ─── SidebarItem ─────────────────────────────────────────────────────────────

function SidebarItem({
  label, count, active, onClick, onEdit, onDelete, isPublic,
}: {
  label: string
  count: number | null
  active: boolean
  onClick: () => void
  onEdit?: () => void
  onDelete?: () => void
  isPublic?: boolean
}) {
  return (
    <div
      className={[
        'group mx-2 px-2 py-1.5 rounded-md flex items-center gap-2 cursor-pointer transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      ].join(' ')}
      onClick={onClick}
    >
      {isPublic !== undefined && (
        isPublic
          ? <Globe className="w-3 h-3 shrink-0 text-muted-foreground/50" />
          : <Lock className="w-3 h-3 shrink-0 text-muted-foreground/30" />
      )}
      <span className="flex-1 text-xs truncate">{label}</span>
      {count !== null && <span className="text-[10px] text-muted-foreground shrink-0">{count}</span>}
      {onEdit && (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:text-foreground transition-all shrink-0"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:text-destructive transition-all shrink-0"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

// ─── VideoCard ────────────────────────────────────────────────────────────────

function VideoCard({
  video, playlists, activePlaylistId, onAddToPlaylist, onRemoveFromPlaylist,
}: {
  video: VideoMeta
  playlists: Playlist[]
  activePlaylistId: string | null
  onAddToPlaylist: (videoId: string, playlistId: string) => void
  onRemoveFromPlaylist: (videoId: string, playlistId: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const inActivePlaylist = activePlaylistId
    ? playlists.find((p) => p.id === activePlaylistId)?.videoIds.includes(video.videoId)
    : false

  return (
    <div className="group relative flex flex-col gap-2 rounded-xl border border-border hover:border-foreground/20 bg-card transition-all hover:shadow-md">
      <div className="relative overflow-hidden bg-muted aspect-video rounded-t-xl">
        <Link to={`/play/${video.videoId}`}>
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <div className="w-9 h-9 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow">
              <Play className="w-4 h-4 text-gray-900 translate-x-0.5" />
            </div>
          </div>
        </Link>

        {activePlaylistId && inActivePlaylist && (
          <button
            onClick={() => onRemoveFromPlaylist(video.videoId, activePlaylistId)}
            className="absolute top-1.5 left-1.5 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
            title="Remove from playlist"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {playlists.length > 0 && (
        <div ref={menuRef} className="absolute top-1.5 right-1.5 z-10">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
            title="Add to playlist"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {menuOpen && (
            <div className="absolute top-8 right-0 w-44 rounded-lg border border-border bg-card shadow-lg py-1 text-xs">
              {playlists.map((playlist) => {
                const inThis = playlist.videoIds.includes(video.videoId)
                return (
                  <button
                    key={playlist.id}
                    onClick={() => {
                      if (inThis) onRemoveFromPlaylist(video.videoId, playlist.id)
                      else onAddToPlaylist(video.videoId, playlist.id)
                      setMenuOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2 transition-colors"
                  >
                    <Check className={['w-3 h-3 shrink-0 text-primary', inThis ? 'opacity-100' : 'opacity-0'].join(' ')} />
                    <span className="truncate">{playlist.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="px-2 pb-2 flex flex-col gap-0.5">
        <Link to={`/play/${video.videoId}`} className="hover:underline">
          <p className="text-xs font-medium leading-snug line-clamp-2">{video.title}</p>
        </Link>
        {video.channelName && (
          <p className="text-[10px] text-muted-foreground">{video.channelName}</p>
        )}
      </div>
    </div>
  )
}

// ─── PlaylistEditModal ────────────────────────────────────────────────────────

function PlaylistEditModal({
  playlist,
  videos,
  isAdmin,
  onSave,
  onClose,
}: {
  playlist: Playlist
  videos: VideoMeta[]
  isAdmin: boolean
  onSave: (updated: Playlist) => void
  onClose: () => void
}) {
  const [name, setName] = useState(playlist.name)
  const [videoIds, setVideoIds] = useState(playlist.videoIds)
  const [isPublic, setIsPublic] = useState(playlist.isPublic)

  const videoMap = new Map(videos.map((v) => [v.videoId, v]))
  const playlistVideos = videoIds.map((id) => videoMap.get(id)).filter(Boolean) as VideoMeta[]

  function move(idx: number, dir: -1 | 1) {
    const next = [...videoIds]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setVideoIds(next)
  }

  function remove(videoId: string) {
    setVideoIds((prev) => prev.filter((id) => id !== videoId))
  }

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave({ ...playlist, name: trimmed, videoIds, isPublic })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <span className="font-semibold text-sm">Edit Playlist</span>
          <button onClick={onClose} className="w-7 h-7 rounded flex items-center justify-center hover:bg-accent transition-colors text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 border-b border-border shrink-0 flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
              className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
            />
          </div>

          {/* Public toggle — only for user playlists (not system) */}
          {!playlist.isSystem && (
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                onClick={() => setIsPublic((v) => !v)}
                className={[
                  'w-8 h-4.5 rounded-full relative transition-colors',
                  isPublic ? 'bg-primary' : 'bg-muted-foreground/30',
                ].join(' ')}
                style={{ height: '18px' }}
              >
                <div className={[
                  'absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform',
                  isPublic ? 'translate-x-4' : 'translate-x-0.5',
                ].join(' ')} />
              </div>
              <span className="text-xs text-muted-foreground">
                {isPublic ? <><Globe className="inline w-3 h-3 mr-0.5" />Public — visible to all users</> : <><Lock className="inline w-3 h-3 mr-0.5" />Private — only you</>}
              </span>
            </label>
          )}

          {isAdmin && playlist.isSystem && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              System playlist — visible to all users
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {playlistVideos.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">No videos in this playlist</p>
          )}
          {playlistVideos.map((video, idx) => (
            <div key={video.videoId} className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-accent/50 group">
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
              <img src={video.thumbnailUrl} alt="" className="w-14 rounded shrink-0 aspect-video object-cover" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium line-clamp-2 leading-snug">{video.title}</p>
                {video.channelName && <p className="text-[10px] text-muted-foreground mt-0.5">{video.channelName}</p>}
              </div>
              <div className="flex flex-col shrink-0">
                <button onClick={() => move(idx, -1)} disabled={idx === 0} className="w-5 h-5 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button onClick={() => move(idx, 1)} disabled={idx === playlistVideos.length - 1} className="w-5 h-5 flex items-center justify-center rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
              <button onClick={() => remove(video.videoId)} className="w-6 h-6 flex items-center justify-center rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="h-8 px-4 rounded-lg border border-border text-xs font-medium hover:bg-accent transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim()} className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">Save</button>
        </div>
      </div>
    </div>
  )
}
