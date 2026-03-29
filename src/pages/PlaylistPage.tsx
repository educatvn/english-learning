import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactPlayer from 'react-player'
import { ChevronLeft, ChevronRight, ChevronDown, Play } from 'lucide-react'
import { UserButton } from '@/components/UserButton'
import { parseJSON3, findActiveCue } from '@/utils/captionParser'
import type { CaptionCue } from '@/utils/captionParser'
import type { VideoMeta, Playlist } from '@/types'
import { loadPlaylists } from '@/services/playlists'
import { loadVideos } from '@/services/videos'

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>()

  const playerRef = useRef<HTMLVideoElement>(null)
  const activeCueRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(true)
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [videos, setVideos] = useState<VideoMeta[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Caption / playback state (mirrors PlayPage)
  const [cues, setCues] = useState<CaptionCue[]>([])
  const [currentMs, setCurrentMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const stopAtMsRef = useRef<number | null>(null)
  const [pinnedCueIdx, setPinnedCueIdx] = useState<number | null>(null)
  const cuePlayRef = useRef(false)

  // Load playlist + all videos
  useEffect(() => {
    Promise.all([loadPlaylists(), loadVideos()])
      .then(([playlists, allVideos]) => {
        const pl = playlists.find((p) => p.id === id) ?? null
        setPlaylist(pl)
        if (pl) {
          const map = new Map(allVideos.map((v) => [v.videoId, v]))
          setVideos(pl.videoIds.map((vid) => map.get(vid)).filter(Boolean) as VideoMeta[])
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  const currentVideo = videos[currentIdx] ?? null

  // Load captions whenever the current video changes
  useEffect(() => {
    setCues([])
    setCurrentMs(0)
    setPinnedCueIdx(null)
    stopAtMsRef.current = null
    if (!currentVideo) return

    const videoId = currentVideo.videoId
    const paths = [`/videos/${videoId}/captions.json`, `/captions/${videoId}.json`]

    async function load() {
      for (const path of paths) {
        try {
          const r = await fetch(path)
          if (!r.ok) continue
          const data = await r.json()
          const result = parseJSON3(data)
          if (result.cues.length > 0) { setCues(result.cues); return }
        } catch { continue }
      }
    }
    load().catch(console.error)
  }, [currentVideo?.videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    function onDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [dropdownOpen])

  // Active cue logic (same as PlayPage)
  const liveCue = findActiveCue(cues, currentMs)
  const liveCueIdx = liveCue ? cues.indexOf(liveCue) : -1
  const activeCueIdx = pinnedCueIdx !== null ? pinnedCueIdx : liveCueIdx
  const activeCue = cues[activeCueIdx] ?? null

  useEffect(() => {
    activeCueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [activeCueIdx])

  const handleTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const ms = e.currentTarget.currentTime * 1000
    if (stopAtMsRef.current !== null && ms >= stopAtMsRef.current) {
      e.currentTarget.pause()
      stopAtMsRef.current = null
      setPlaying(false)
      return
    }
    setCurrentMs(ms)
  }, [])

  const handleCueClick = useCallback((cue: CaptionCue, idx: number) => {
    const video = playerRef.current
    if (!video) return
    cuePlayRef.current = true
    setPinnedCueIdx(idx)
    video.currentTime = cue.startMs / 1000
    stopAtMsRef.current = cue.endMs
    setPlaying(true)
    video.play().catch(console.error)
  }, [])

  function jumpTo(idx: number) {
    if (idx < 0 || idx >= videos.length) return
    setCurrentIdx(idx)
    setDropdownOpen(false)
    setPlaying(true)
  }

  if (loading) return <LoadingScreen />

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <header className="h-12 flex items-center px-4 gap-2 bg-gray-900 border-b border-gray-800 shrink-0">
        <Link
          to="/"
          className="font-semibold text-sm tracking-wide hover:text-gray-300 transition-colors shrink-0"
        >
          English Learning
        </Link>

        {/* Playlist dropdown trigger */}
        <span className="text-gray-700 shrink-0">/</span>
        <div ref={dropdownRef} className="relative min-w-0">
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition-colors px-2 py-1 rounded hover:bg-gray-800 max-w-xs"
          >
            <span className="truncate">{playlist?.name ?? '…'}</span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          </button>

          {dropdownOpen && videos.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-72 rounded-lg border border-gray-700 bg-gray-900 shadow-xl py-1 z-50 max-h-80 overflow-y-auto">
              {videos.map((video, idx) => (
                <button
                  key={video.videoId}
                  onClick={() => jumpTo(idx)}
                  className={[
                    'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-800 transition-colors',
                    idx === currentIdx ? 'bg-gray-800/60' : '',
                  ].join(' ')}
                >
                  <span className="text-[10px] text-gray-500 font-mono w-4 shrink-0">{idx + 1}</span>
                  <img
                    src={video.thumbnailUrl}
                    alt=""
                    className="w-14 rounded shrink-0 aspect-video object-cover"
                  />
                  <span className={['text-xs line-clamp-2 flex-1', idx === currentIdx ? 'text-white' : 'text-gray-300'].join(' ')}>
                    {video.title}
                  </span>
                  {idx === currentIdx && (
                    <Play className="w-3 h-3 shrink-0 text-blue-400 fill-blue-400" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Prev / counter / Next + user */}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button
            onClick={() => jumpTo(currentIdx - 1)}
            disabled={currentIdx === 0}
            className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-500 font-mono w-12 text-center">
            {currentIdx + 1}/{videos.length}
          </span>
          <button
            onClick={() => jumpTo(currentIdx + 1)}
            disabled={currentIdx >= videos.length - 1}
            className="w-7 h-7 rounded flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <div className="ml-2"><UserButton /></div>
        </div>
      </header>

      {/* Main: video + caption sidebar (same layout as PlayPage) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Video panel */}
        <div className="flex-1 flex flex-col min-w-0 bg-black">
          <div className="relative flex-1 min-h-0">
            {currentVideo ? (
              <>
                <ReactPlayer
                  key={currentVideo.videoId}
                  ref={playerRef}
                  src={`https://www.youtube.com/watch?v=${currentVideo.videoId}`}
                  playing={playing}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => {
                    if (!cuePlayRef.current) setPinnedCueIdx(null)
                    cuePlayRef.current = false
                    setPlaying(true)
                  }}
                  onPause={() => {
                    setPlaying(false)
                    stopAtMsRef.current = null
                  }}
                  onEnded={() => {
                    if (currentIdx < videos.length - 1) jumpTo(currentIdx + 1)
                    else setPlaying(false)
                  }}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  config={{
                    youtube: {
                      cc_load_policy: 0,
                      cc_lang_pref: 'none',
                      iv_load_policy: 3,
                      rel: 0,
                    },
                  }}
                />

                {activeCue && (
                  <div
                    className="absolute bottom-10 left-0 right-0 flex justify-center pointer-events-none px-4"
                    style={{ zIndex: 10 }}
                  >
                    <span className="bg-black/80 text-white text-xl font-medium px-4 py-2 rounded text-center leading-relaxed max-w-3xl">
                      {activeCue.text}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                No videos in playlist
              </div>
            )}
          </div>
        </div>

        {/* Caption sidebar */}
        <div className="w-96 flex flex-col bg-gray-900 border-l border-gray-800">
          <div className="px-4 py-3 border-b border-gray-800 shrink-0">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">
              Captions — click to practice
            </p>
            {currentVideo && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{currentVideo.title}</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {cues.length === 0 && (
              <div className="p-6 text-center text-gray-500 text-sm">
                {currentVideo ? 'No captions available' : 'No video selected'}
              </div>
            )}

            {cues.map((cue, idx) => {
              const isActive = idx === activeCueIdx
              return (
                <button
                  key={cue.startMs}
                  ref={isActive ? activeCueRef : null}
                  onClick={() => handleCueClick(cue, idx)}
                  className={[
                    'w-full text-left px-4 py-3 border-b border-gray-800/60',
                    'text-sm leading-relaxed transition-colors duration-100',
                    'hover:bg-gray-800 focus:outline-none focus:bg-gray-800',
                    isActive
                      ? 'bg-blue-950 border-l-2 border-l-blue-500 text-white'
                      : 'text-gray-300 border-l-2 border-l-transparent',
                  ].join(' ')}
                >
                  <span className="text-[10px] text-gray-600 font-mono block mb-0.5">
                    {formatTime(cue.startMs)}
                  </span>
                  {cue.text}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── LoadingScreen ────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center gap-5">
      <div className="flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg">
          <Play className="w-7 h-7 text-white translate-x-0.5" />
        </div>
        <span className="font-semibold text-sm tracking-wide text-white">Loading playlist…</span>
      </div>
      <div className="w-40 h-0.5 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full w-1/3 bg-blue-500 rounded-full origin-left"
          style={{ animation: 'indeterminate 1.4s ease-in-out infinite' }}
        />
      </div>
      <style>{`
        @keyframes indeterminate {
          0%   { transform: translateX(-100%) scaleX(1) }
          50%  { transform: translateX(100%) scaleX(1.5) }
          100% { transform: translateX(300%) scaleX(1) }
        }
      `}</style>
    </div>
  )
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
