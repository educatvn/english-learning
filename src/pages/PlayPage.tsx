import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactPlayer from 'react-player'
import { parseJSON3, findActiveCue } from '@/utils/captionParser'
import type { CaptionCue } from '@/utils/captionParser'
import { loadVideos } from '@/services/videos'
import { UserButton } from '@/components/UserButton'

export default function PlayPage() {
  const { videoId } = useParams<{ videoId: string }>()

  const playerRef = useRef<HTMLVideoElement>(null)
  const activeCueRef = useRef<HTMLButtonElement>(null)

  const [cues, setCues] = useState<CaptionCue[]>([])
  const [currentMs, setCurrentMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const stopAtMsRef = useRef<number | null>(null)
  const [videoTitle, setVideoTitle] = useState<string | null>(null)

  // When user clicks a cue, pin the selection to that cue index.
  // Cleared when the user starts free-play (play button, not a cue click).
  const [pinnedCueIdx, setPinnedCueIdx] = useState<number | null>(null)
  // Distinguish a cue-triggered play() from a manual play button press.
  const cuePlayRef = useRef(false)

  useEffect(() => {
    loadVideos().then((videos) => {
      const match = videos.find((v) => v.videoId === videoId)
      if (match) setVideoTitle(match.title)
    }).catch(console.error)
  }, [videoId])

  useEffect(() => {
    async function loadCaptions() {
      const paths = [
        `/videos/${videoId}/captions.json`,
        `/captions/${videoId}.json`,
      ]
      for (const path of paths) {
        try {
          const r = await fetch(path)
          if (!r.ok) continue
          const data = await r.json()
          const result = parseJSON3(data)
          if (result.cues.length > 0) {
            setCues(result.cues)
            return
          }
        } catch {
          continue
        }
      }
    }
    loadCaptions().catch(console.error)
  }, [videoId])

  // Live cue from video position (used only when not pinned)
  const liveCue = findActiveCue(cues, currentMs)
  const liveCueIdx = liveCue ? cues.indexOf(liveCue) : -1
  const activeCueIdx = pinnedCueIdx !== null ? pinnedCueIdx : liveCueIdx

  // Derive caption overlay text from active index so it respects the pin too
  const activeCue = cues[activeCueIdx] ?? null

  // Auto-scroll sidebar whenever active cue changes
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

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden">
      {/* Header */}
      <header className="h-12 flex items-center px-4 gap-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="w-2 h-2 rounded-full bg-red-500" />
        <Link to="/" className="font-semibold text-sm tracking-wide hover:text-gray-300 transition-colors">
          English Learning
        </Link>
        {videoTitle && (
          <span className="text-sm text-gray-300 ml-2 truncate max-w-xl">{videoTitle}</span>
        )}
        <div className="ml-auto"><UserButton /></div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Video panel */}
        <div className="flex-1 flex flex-col min-w-0 bg-black">
          <div className="relative flex-1 min-h-0">
            <ReactPlayer
              ref={playerRef}
              src={`https://www.youtube.com/watch?v=${videoId}`}
              playing={playing}
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => {
                if (!cuePlayRef.current) {
                  // User pressed play manually — switch to live tracking
                  setPinnedCueIdx(null)
                }
                cuePlayRef.current = false
                setPlaying(true)
              }}
              onPause={() => {
                setPlaying(false)
                stopAtMsRef.current = null
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

            {/* Caption overlay */}
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
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-96 flex flex-col bg-gray-900 border-l border-gray-800">
          <div className="px-4 py-3 border-b border-gray-800 shrink-0">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">
              Captions — click to practice
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {cues.length === 0 && (
              <div className="p-6 text-center text-gray-500 text-sm">Loading captions…</div>
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

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
