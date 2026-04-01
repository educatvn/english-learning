import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import ReactPlayer from 'react-player'
import { ChevronLeft, ChevronRight, ChevronDown, Play, Brain, PlayCircle, X, StickyNote, Plus, Trash2 } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { parseJSON3, findActiveCue } from '@/utils/captionParser'
import type { CaptionCue } from '@/utils/captionParser'
import { pickQuizWord, maskText } from '@/utils/quizWord'
import type { VideoMeta, Playlist } from '@/types'
import { loadPlaylists } from '@/services/playlists'
import { loadVideos } from '@/services/videos'
import { useAuth } from '@/context/AuthContext'
import { useQuizMode } from '@/hooks/useQuizMode'
import { useWatchTime } from '@/hooks/useWatchTime'
import { useVideoProgress } from '@/hooks/useVideoProgress'
import { useVideoNotes } from '@/hooks/useVideoNotes'
import { QuizModal } from '@/components/QuizModal'
import type { QuizResult } from '@/components/QuizModal'
import { VideoProgressBar } from '@/components/VideoProgressBar'
import { saveQuizAttempt } from '@/services/quizResults'

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()

  const playerRef = useRef<HTMLVideoElement>(null)
  const activeCueRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const durationMsStateRef = useRef(0)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)

  const [loading, setLoading] = useState(true)
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [videos, setVideos] = useState<VideoMeta[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const [cues, setCues] = useState<CaptionCue[]>([])
  const [currentMs, setCurrentMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const stopAtMsRef = useRef<number | null>(null)
  const [pinnedCueIdx, setPinnedCueIdx] = useState<number | null>(null)

  const [resumeDismissed, setResumeDismissed] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'captions' | 'notes'>('captions')
  const [isAddingNote, setIsAddingNote] = useState(false)
  const [pendingNoteMs, setPendingNoteMs] = useState(0)
  const [noteText, setNoteText] = useState('')

  const quiz = useQuizMode()
  const currentVideo = videos[currentIdx] ?? null
  const watchTime = useWatchTime(user?.sub)
  const videoProgress = useVideoProgress(user?.sub, currentVideo?.videoId)
  const { notes, addNote, removeNote } = useVideoNotes(user?.sub, currentVideo?.videoId)

  const showResumeBanner = !resumeDismissed && videoProgress.resumePositionMs !== null

  // Load playlist + all videos
  useEffect(() => {
    if (!user) return
    Promise.all([loadPlaylists(user.sub), loadVideos()])
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
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset state on video change
  useEffect(() => {
    setResumeDismissed(false)
    setIsAddingNote(false)
    setNoteText('')
    setDurationMs(0)
    durationMsStateRef.current = 0
  }, [currentVideo?.videoId])

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
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [dropdownOpen])

  useEffect(() => {
    if (isAddingNote) noteInputRef.current?.focus()
  }, [isAddingNote])

  // Active cue
  const liveCue = findActiveCue(cues, currentMs)
  const liveCueIdx = liveCue ? cues.indexOf(liveCue) : -1
  const activeCueIdx = pinnedCueIdx !== null ? pinnedCueIdx : liveCueIdx
  const activeCue = cues[activeCueIdx] ?? null

  useEffect(() => {
    activeCueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [activeCueIdx])

  const handleTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const ms = e.currentTarget.currentTime * 1000
    const dur = e.currentTarget.duration * 1000
    if (isFinite(dur) && dur > 0 && dur !== durationMsStateRef.current) {
      durationMsStateRef.current = dur
      setDurationMs(dur)
    }
    videoProgress.onTimeUpdate(ms, dur)
    if (stopAtMsRef.current !== null && ms >= stopAtMsRef.current) {
      stopAtMsRef.current = null
      e.currentTarget.pause()
      setPlaying(false)
      setPinnedCueIdx(null)
      quiz.onCueEnded()
      return
    }
    setCurrentMs(ms)
  }, [quiz.onCueEnded]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSeek = useCallback((ms: number) => {
    const video = playerRef.current
    if (!video) return
    stopAtMsRef.current = null
    video.currentTime = ms / 1000
    setCurrentMs(ms)
    setPinnedCueIdx(null)
  }, [])

  const handleCueClick = useCallback((cue: CaptionCue, idx: number) => {
    const video = playerRef.current
    if (!video) return
    setPinnedCueIdx(idx)
    quiz.onCueStarted(cue)
    stopAtMsRef.current = cue.endMs
    video.currentTime = cue.startMs / 1000
    setPlaying(true)
    video.play().catch(console.error)
  }, [quiz.onCueStarted]) // eslint-disable-line react-hooks/exhaustive-deps

  function jumpTo(idx: number) {
    if (idx < 0 || idx >= videos.length) return
    setCurrentIdx(idx)
    setDropdownOpen(false)
    setPlaying(true)
  }

  function handleQuizClose(result: QuizResult | null) {
    const snapshotState = quiz.quizState
    quiz.closeQuiz()
    if (result && user && currentVideo) {
      void saveQuizAttempt({
        userId: user.sub,
        videoId: currentVideo.videoId,
        cueStartMs: snapshotState?.cue.startMs ?? 0,
        targetWord: snapshotState?.quizWord.word ?? '',
        userAnswer: result.userAnswer,
        correct: result.correct,
        answeredAt: new Date().toISOString(),
      })
    }
  }

  function handleStartAddNote() {
    setPendingNoteMs(currentMs)
    setNoteText('')
    setIsAddingNote(true)
    setPlaying(false)
    playerRef.current?.pause()
  }

  function handleSaveNote() {
    if (!noteText.trim()) return
    void addNote(pendingNoteMs, noteText)
    setIsAddingNote(false)
    setNoteText('')
  }

  function handleCancelNote() {
    setIsAddingNote(false)
    setNoteText('')
  }

  const overlayText = (() => {
    if (!activeCue) return null
    if (quiz.quizMode && quiz.quizWordRef.current) return maskText(activeCue.text, quiz.quizWordRef.current)
    return activeCue.text
  })()

  if (loading) return <LoadingScreen />

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <AppHeader
        hideAddVideo
        breadcrumb={
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-accent max-w-xs"
            >
              <span className="truncate">{playlist?.name ?? '…'}</span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
            </button>
            {dropdownOpen && videos.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-72 rounded-lg border border-border bg-card shadow-xl py-1 z-50 max-h-80 overflow-y-auto">
                {videos.map((video, idx) => (
                  <button
                    key={video.videoId}
                    onClick={() => jumpTo(idx)}
                    className={[
                      'w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent transition-colors',
                      idx === currentIdx ? 'bg-accent/60' : '',
                    ].join(' ')}
                  >
                    <span className="text-[10px] text-muted-foreground font-mono w-4 shrink-0">{idx + 1}</span>
                    <img src={video.thumbnailUrl} alt="" className="w-14 rounded shrink-0 aspect-video object-cover" />
                    <span className={['text-xs line-clamp-2 flex-1', idx === currentIdx ? 'text-foreground font-medium' : 'text-muted-foreground'].join(' ')}>
                      {video.title}
                    </span>
                    {idx === currentIdx && <Play className="w-3 h-3 shrink-0 text-primary fill-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        }
        right={
          <div className="flex items-center gap-1">
            <button
              onClick={quiz.toggleQuizMode}
              title={quiz.quizMode ? 'Quiz mode on — click to disable' : 'Enable quiz mode'}
              className={[
                'flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-semibold transition-colors mr-1',
                quiz.quizMode ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
              ].join(' ')}
            >
              <Brain className="w-3.5 h-3.5" />
              Quiz
            </button>
            <button onClick={() => jumpTo(currentIdx - 1)} disabled={currentIdx === 0}
              className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-muted-foreground font-mono w-12 text-center">{currentIdx + 1}/{videos.length}</span>
            <button onClick={() => jumpTo(currentIdx + 1)} disabled={currentIdx >= videos.length - 1}
              className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        }
      />

      {/* Main */}
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
                    if (stopAtMsRef.current === null) setPinnedCueIdx(null)
                    setPlaying(true)
                    watchTime.onPlay()
                    videoProgress.onPlay()
                  }}
                  onPause={() => {
                    setPlaying(false)
                    // Do NOT clear stopAtMsRef here — seek-induced pauses must not
                    // erase the stop point set synchronously in handleCueClick.
                    watchTime.onPause()
                    videoProgress.onPause()
                  }}
                  onEnded={() => {
                    watchTime.onPause()
                    videoProgress.onEnded()
                    if (currentIdx < videos.length - 1) jumpTo(currentIdx + 1)
                    else setPlaying(false)
                  }}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                  config={{
                    youtube: { cc_load_policy: 0, cc_lang_pref: 'none', iv_load_policy: 3, rel: 0 },
                  }}
                />

                {overlayText && (
                  <div className="absolute bottom-10 left-0 right-0 flex justify-center pointer-events-none px-4" style={{ zIndex: 10 }}>
                    <span className="bg-black/80 text-white text-xl font-medium px-4 py-2 rounded text-center leading-relaxed max-w-3xl">
                      {overlayText}
                    </span>
                  </div>
                )}

                {showResumeBanner && videoProgress.resumePositionMs !== null && (
                  <ResumeBanner
                    positionMs={videoProgress.resumePositionMs}
                    onResume={() => {
                      const video = playerRef.current
                      if (video && videoProgress.resumePositionMs !== null) {
                        video.currentTime = videoProgress.resumePositionMs / 1000
                        setCurrentMs(videoProgress.resumePositionMs)
                      }
                      setResumeDismissed(true)
                    }}
                    onDismiss={() => setResumeDismissed(true)}
                  />
                )}
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                No videos in playlist
              </div>
            )}
          </div>

          {/* Progress bar */}
          <VideoProgressBar
            currentMs={currentMs}
            durationMs={durationMs}
            notes={notes}
            onSeek={handleSeek}
          />
        </div>

        {/* Sidebar */}
        <div className="w-96 flex flex-col bg-card border-l border-border">
          {/* Tabs */}
          <div className="flex border-b border-border shrink-0">
            <SidebarTab active={sidebarTab === 'captions'} onClick={() => setSidebarTab('captions')}>
              Captions
            </SidebarTab>
            <SidebarTab active={sidebarTab === 'notes'} onClick={() => setSidebarTab('notes')}>
              Notes{notes.length > 0 && (
                <span className="ml-1.5 text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full font-semibold">
                  {notes.length}
                </span>
              )}
            </SidebarTab>
            {quiz.quizMode && (
              <span className="ml-auto self-center mr-3 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                Quiz mode
              </span>
            )}
          </div>

          {/* Captions panel */}
          {sidebarTab === 'captions' && (
            <div className="flex-1 overflow-y-auto">
              {currentVideo && (
                <p className="px-4 py-2 text-xs text-muted-foreground border-b border-border/60 truncate">{currentVideo.title}</p>
              )}
              {cues.length === 0 && (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  {currentVideo ? 'No captions available' : 'No video selected'}
                </div>
              )}
              {cues.map((cue, idx) => {
                const isActive = idx === activeCueIdx
                const qw = quiz.quizMode ? pickQuizWord(cue.text) : null
                const displayText = qw ? maskText(cue.text, qw) : cue.text
                return (
                  <button
                    key={cue.startMs}
                    ref={isActive ? activeCueRef : null}
                    onClick={() => handleCueClick(cue, idx)}
                    className={[
                      'w-full text-left px-4 py-3 border-b border-border/60',
                      'text-sm leading-relaxed transition-colors duration-100',
                      'hover:bg-accent focus:outline-none focus:bg-accent',
                      isActive
                        ? 'bg-primary/10 border-l-2 border-l-primary text-foreground'
                        : 'text-muted-foreground border-l-2 border-l-transparent',
                    ].join(' ')}
                  >
                    <span className="text-[10px] text-muted-foreground/50 font-mono block mb-0.5">
                      {formatTime(cue.startMs)}
                    </span>
                    {displayText}
                  </button>
                )
              })}
            </div>
          )}

          {/* Notes panel */}
          {sidebarTab === 'notes' && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="px-4 py-3 border-b border-border shrink-0">
                {isAddingNote ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono text-yellow-500">{formatTime(pendingNoteMs)}</span>
                      <span className="text-[10px] text-muted-foreground">— note at this position</span>
                    </div>
                    <textarea
                      ref={noteInputRef}
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveNote() }
                        if (e.key === 'Escape') handleCancelNote()
                      }}
                      placeholder="Type your note… (Enter to save, Esc to cancel)"
                      rows={3}
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                    <div className="flex gap-2">
                      <button onClick={handleSaveNote} disabled={!noteText.trim()}
                        className="flex-1 h-7 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground text-xs font-semibold transition-colors">
                        Save
                      </button>
                      <button onClick={handleCancelNote}
                        className="h-7 px-3 rounded-lg bg-muted hover:bg-accent text-muted-foreground text-xs transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={handleStartAddNote}
                    className="w-full flex items-center justify-center gap-2 h-8 rounded-lg border border-dashed border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground text-xs transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                    Add note at {formatTime(currentMs)}
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {notes.length === 0 && !isAddingNote && (
                  <div className="px-4 py-8 text-center">
                    <StickyNote className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground/60">No notes yet.<br />Add a note while watching.</p>
                  </div>
                )}
                {notes.map((note) => (
                  <div key={note.createdAt} className="group flex gap-3 px-4 py-3 border-b border-border/60 hover:bg-accent/50 transition-colors">
                    <button
                      onClick={() => handleSeek(note.positionMs)}
                      className="text-[10px] font-mono text-yellow-500 hover:text-yellow-400 shrink-0 mt-0.5 hover:underline transition-colors"
                    >
                      {formatTime(note.positionMs)}
                    </button>
                    <p className="flex-1 text-xs text-foreground leading-relaxed whitespace-pre-wrap">{note.text}</p>
                    <button onClick={() => removeNote(note.createdAt)}
                      className="opacity-0 group-hover:opacity-100 shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-destructive transition-all"
                      title="Delete note">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {quiz.quizState && (
        <QuizModal cue={quiz.quizState.cue} quizWord={quiz.quizState.quizWord} onClose={handleQuizClose} />
      )}
    </div>
  )
}

// ─── ResumeBanner ─────────────────────────────────────────────────────────────

function ResumeBanner({ positionMs, onResume, onDismiss }: {
  positionMs: number; onResume: () => void; onDismiss: () => void
}) {
  return (
    <>
      <div className="absolute inset-0 z-10" onClick={onDismiss} />
      <div className="absolute bottom-4 left-4 z-20 flex items-center gap-3 bg-gray-900/95 border border-gray-700 rounded-xl px-4 py-3 shadow-2xl backdrop-blur-sm" style={{ maxWidth: 340 }}>
        <PlayCircle className="w-5 h-5 text-blue-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-300 font-medium">Continue from where you left off?</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{formatTime(positionMs)}</p>
        </div>
        <button onClick={onResume} className="h-7 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors shrink-0">Resume</button>
        <button onClick={onDismiss} title="Dismiss" className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-700 transition-colors shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </>
  )
}

// ─── SidebarTab ───────────────────────────────────────────────────────────────

function SidebarTab({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors',
        active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </button>
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
        <div className="h-full w-1/3 bg-blue-500 rounded-full origin-left"
          style={{ animation: 'indeterminate 1.4s ease-in-out infinite' }} />
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
