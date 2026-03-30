import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import ReactPlayer from 'react-player'
import { Brain, RotateCcw, PlayCircle, StickyNote, Plus, Trash2 } from 'lucide-react'
import { parseJSON3, findActiveCue } from '@/utils/captionParser'
import type { CaptionCue } from '@/utils/captionParser'
import { pickQuizWord, maskText } from '@/utils/quizWord'
import { loadVideos } from '@/services/videos'
import { useAuth } from '@/context/AuthContext'
import { useQuizMode } from '@/hooks/useQuizMode'
import { useWatchTime } from '@/hooks/useWatchTime'
import { useViewHistory } from '@/hooks/useViewHistory'
import { useVideoProgress } from '@/hooks/useVideoProgress'
import { useVideoNotes } from '@/hooks/useVideoNotes'
import { QuizModal } from '@/components/QuizModal'
import type { QuizResult } from '@/components/QuizModal'
import { VideoProgressBar } from '@/components/VideoProgressBar'
import { saveQuizAttempt } from '@/services/quizResults'
import { UserButton } from '@/components/UserButton'

export default function PlayPage() {
  const { videoId } = useParams<{ videoId: string }>()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  const playerRef = useRef<HTMLVideoElement>(null)
  const activeCueRef = useRef<HTMLButtonElement>(null)
  const didSeekRef = useRef(false)
  const durationMsStateRef = useRef(0)

  const [cues, setCues] = useState<CaptionCue[]>([])
  const [currentMs, setCurrentMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const stopAtMsRef = useRef<number | null>(null)
  const [videoTitle, setVideoTitle] = useState<string | null>(null)

  const [pinnedCueIdx, setPinnedCueIdx] = useState<number | null>(null)
  const cuePlayRef = useRef(false)

  const [resumeDismissed, setResumeDismissed] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'captions' | 'notes'>('captions')
  const [isAddingNote, setIsAddingNote] = useState(false)
  const [pendingNoteMs, setPendingNoteMs] = useState(0)
  const [noteText, setNoteText] = useState('')
  const noteInputRef = useRef<HTMLTextAreaElement>(null)

  const quiz = useQuizMode()
  const watchTime = useWatchTime(user?.sub, videoId)
  const viewHistory = useViewHistory(user?.sub, videoId)
  const videoProgress = useVideoProgress(user?.sub, videoId)
  const { notes, addNote, removeNote } = useVideoNotes(user?.sub, videoId)

  // Don't offer resume when the URL already has a ?t= deep-link
  const seekToMs = searchParams.get('t') ? Number(searchParams.get('t')) : null
  const showResumeBanner = !resumeDismissed && !seekToMs && videoProgress.resumePositionMs !== null

  useEffect(() => {
    loadVideos().then((vs) => {
      const match = vs.find((v) => v.videoId === videoId)
      if (match) setVideoTitle(match.title)
    }).catch(console.error)
  }, [videoId])

  useEffect(() => {
    async function loadCaptions() {
      const paths = [`/videos/${videoId}/captions.json`, `/captions/${videoId}.json`]
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
    loadCaptions().catch(console.error)
  }, [videoId])

  // Seek to ?t= timestamp once player is ready + cues loaded
  useEffect(() => {
    if (!seekToMs || didSeekRef.current || !playerRef.current || cues.length === 0) return
    const video = playerRef.current
    video.currentTime = seekToMs / 1000
    const cue = findActiveCue(cues, seekToMs)
    if (cue) setPinnedCueIdx(cues.indexOf(cue))
    didSeekRef.current = true
  }, [seekToMs, cues])

  useEffect(() => {
    if (isAddingNote) noteInputRef.current?.focus()
  }, [isAddingNote])

  // ── Active cue ───────────────────────────────────────────────────────────
  const liveCue = findActiveCue(cues, currentMs)
  const liveCueIdx = liveCue ? cues.indexOf(liveCue) : -1
  const activeCueIdx = pinnedCueIdx !== null ? pinnedCueIdx : liveCueIdx
  const activeCue = cues[activeCueIdx] ?? null

  useEffect(() => {
    activeCueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [activeCueIdx])

  // ── Playback ─────────────────────────────────────────────────────────────
  const handleTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const ms = e.currentTarget.currentTime * 1000
    const dur = e.currentTarget.duration * 1000
    // Only trigger re-render when duration first becomes known
    if (isFinite(dur) && dur > 0 && dur !== durationMsStateRef.current) {
      durationMsStateRef.current = dur
      setDurationMs(dur)
    }
    videoProgress.onTimeUpdate(ms, dur)
    if (stopAtMsRef.current !== null && ms >= stopAtMsRef.current) {
      e.currentTarget.pause()
      stopAtMsRef.current = null
      setPlaying(false)
      quiz.onCueEnded()
      return
    }
    setCurrentMs(ms)
  }, [quiz.onCueEnded]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSeek = useCallback((ms: number) => {
    const video = playerRef.current
    if (!video) return
    video.currentTime = ms / 1000
    setCurrentMs(ms)
    setPinnedCueIdx(null)
  }, [])

  const handleCueClick = useCallback((cue: CaptionCue, idx: number) => {
    const video = playerRef.current
    if (!video) return
    cuePlayRef.current = true
    setPinnedCueIdx(idx)
    quiz.onCueStarted(cue)
    video.currentTime = cue.startMs / 1000
    stopAtMsRef.current = cue.endMs
    setPlaying(true)
    video.play().catch(console.error)
  }, [quiz.onCueStarted]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleQuizClose(result: QuizResult | null) {
    const snapshotState = quiz.quizState
    quiz.closeQuiz()
    if (result && user && videoId) {
      void saveQuizAttempt({
        userId: user.sub,
        videoId,
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

  // Caption overlay
  const overlayText = (() => {
    if (!activeCue) return null
    if (quiz.quizMode && quiz.quizWordRef.current) return maskText(activeCue.text, quiz.quizWordRef.current)
    return activeCue.text
  })()

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
        <div className="ml-auto flex items-center gap-2">
          <QuizToggle active={quiz.quizMode} onToggle={quiz.toggleQuizMode} />
          <UserButton />
        </div>
      </header>

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Video panel */}
        <div className="flex-1 flex flex-col min-w-0 bg-black">
          {/* Video */}
          <div className="relative flex-1 min-h-0">
            <ReactPlayer
              ref={playerRef}
              src={`https://www.youtube.com/watch?v=${videoId}`}
              playing={playing}
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => {
                if (!cuePlayRef.current) setPinnedCueIdx(null)
                cuePlayRef.current = false
                setPlaying(true)
                watchTime.onPlay()
                videoProgress.onPlay()
                viewHistory.onFirstPlay()
              }}
              onPause={() => {
                setPlaying(false)
                stopAtMsRef.current = null
                watchTime.onPause()
                videoProgress.onPause()
              }}
              onEnded={() => {
                watchTime.onPause()
                videoProgress.onEnded()
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
          </div>

          {/* Custom progress bar */}
          <VideoProgressBar
            currentMs={currentMs}
            durationMs={durationMs}
            notes={notes}
            onSeek={handleSeek}
          />
        </div>

        {/* Sidebar */}
        <div className="w-96 flex flex-col bg-gray-900 border-l border-gray-800">
          {/* Sidebar tabs */}
          <div className="flex border-b border-gray-800 shrink-0">
            <SidebarTab active={sidebarTab === 'captions'} onClick={() => setSidebarTab('captions')}>
              Captions
            </SidebarTab>
            <SidebarTab active={sidebarTab === 'notes'} onClick={() => setSidebarTab('notes')}>
              Notes{notes.length > 0 && <span className="ml-1.5 text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full font-semibold">{notes.length}</span>}
            </SidebarTab>
            {quiz.quizMode && (
              <span className="ml-auto self-center mr-3 text-[10px] bg-blue-900/60 text-blue-300 px-2 py-0.5 rounded-full font-medium">
                Quiz mode
              </span>
            )}
          </div>

          {/* Captions panel */}
          {sidebarTab === 'captions' && (
            <div className="flex-1 overflow-y-auto">
              {cues.length === 0 && (
                <div className="p-6 text-center text-gray-500 text-sm">Loading captions…</div>
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
                    {displayText}
                  </button>
                )
              })}
            </div>
          )}

          {/* Notes panel */}
          {sidebarTab === 'notes' && (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Add note */}
              <div className="px-4 py-3 border-b border-gray-800 shrink-0">
                {isAddingNote ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono text-yellow-400">{formatTime(pendingNoteMs)}</span>
                      <span className="text-[10px] text-gray-500">— note at this position</span>
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
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveNote}
                        disabled={!noteText.trim()}
                        className="flex-1 h-7 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelNote}
                        className="h-7 px-3 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleStartAddNote}
                    className="w-full flex items-center justify-center gap-2 h-8 rounded-lg border border-dashed border-gray-700 hover:border-gray-500 text-gray-500 hover:text-gray-300 text-xs transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add note at {formatTime(currentMs)}
                  </button>
                )}
              </div>

              {/* Notes list */}
              <div className="flex-1 overflow-y-auto">
                {notes.length === 0 && !isAddingNote && (
                  <div className="px-4 py-8 text-center">
                    <StickyNote className="w-8 h-8 text-gray-700 mx-auto mb-2" />
                    <p className="text-xs text-gray-600">No notes yet.<br />Add a note while watching.</p>
                  </div>
                )}
                {notes.map((note) => (
                  <div
                    key={note.createdAt}
                    className="group flex gap-3 px-4 py-3 border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors"
                  >
                    <button
                      onClick={() => handleSeek(note.positionMs)}
                      className="text-[10px] font-mono text-yellow-400 hover:text-yellow-300 shrink-0 mt-0.5 hover:underline transition-colors"
                    >
                      {formatTime(note.positionMs)}
                    </button>
                    <p className="flex-1 text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">{note.text}</p>
                    <button
                      onClick={() => removeNote(note.createdAt)}
                      className="opacity-0 group-hover:opacity-100 shrink-0 w-5 h-5 flex items-center justify-center text-gray-600 hover:text-red-400 transition-all"
                      title="Delete note"
                    >
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
        <QuizModal
          cue={quiz.quizState.cue}
          quizWord={quiz.quizState.quizWord}
          onClose={handleQuizClose}
        />
      )}
    </div>
  )
}

// ─── ResumeBanner ─────────────────────────────────────────────────────────────

function ResumeBanner({ positionMs, onResume, onDismiss }: {
  positionMs: number
  onResume: () => void
  onDismiss: () => void
}) {
  return (
    <div className="absolute bottom-4 left-4 z-20 flex items-center gap-3 bg-gray-900/95 border border-gray-700 rounded-xl px-4 py-3 shadow-2xl backdrop-blur-sm" style={{ maxWidth: 340 }}>
      <PlayCircle className="w-5 h-5 text-blue-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-300 font-medium">Continue from where you left off?</p>
        <p className="text-[11px] text-gray-500 mt-0.5">{formatTime(positionMs)}</p>
      </div>
      <button onClick={onResume} className="h-7 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors shrink-0">
        Resume
      </button>
      <button onClick={onDismiss} title="Start from beginning" className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-700 transition-colors shrink-0">
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ─── SidebarTab ───────────────────────────────────────────────────────────────

function SidebarTab({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors',
        active
          ? 'border-blue-500 text-white'
          : 'border-transparent text-gray-500 hover:text-gray-300',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ─── QuizToggle ───────────────────────────────────────────────────────────────

function QuizToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={active ? 'Quiz mode on — click to disable' : 'Enable quiz mode'}
      className={[
        'flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-semibold transition-colors',
        active ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white',
      ].join(' ')}
    >
      <Brain className="w-3.5 h-3.5" />
      Quiz
    </button>
  )
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
