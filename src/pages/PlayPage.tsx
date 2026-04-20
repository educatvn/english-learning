import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import ReactPlayer from 'react-player';
import { Brain, StickyNote, Plus, Trash2, ChevronRight, Subtitles, SkipBack, SkipForward, Repeat, Mic } from 'lucide-react';
import { parseJSON3, findActiveCue, groupCuesIntoParagraphs, fetchCaptionData } from '@/utils/captionParser';
import type { CaptionCue } from '@/utils/captionParser';
import { maskText } from '@/utils/quizWord';
import { useAuth } from '@/context/AuthContext';
import { AppHeader } from '@/components/AppHeader';
import { CueText } from '@/components/CueText';
import { VocabDialog } from '@/components/VocabDialog';
import { TranscriptPanel } from '@/components/TranscriptPanel';
import { useQuizMode } from '@/hooks/useQuizMode';
import { useWatchTime } from '@/hooks/useWatchTime';
import { useVideoProgress } from '@/hooks/useVideoProgress';
import { useVideoNotes } from '@/hooks/useVideoNotes';
import { QuizModal } from '@/components/QuizModal';
import type { QuizResult } from '@/components/QuizModal';
import { SpeakingPanel } from '@/components/SpeakingPanel';
import { VideoProgressBar } from '@/components/VideoProgressBar';
import { useSpeakingMode } from '@/hooks/useSpeakingMode';
import { saveQuizAttempt } from '@/services/quizResults';
import { addVocabWord, getVocabWords } from '@/services/vocabulary';
import type { VocabEntry } from '@/types';

export default function PlayPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const playerRef = useRef<HTMLVideoElement>(null);
  const didSeekRef = useRef(false);
  const durationMsStateRef = useRef(0);

  const [cues, setCues] = useState<CaptionCue[]>([]);
  const cuesRef = useRef<CaptionCue[]>([]);
  useEffect(() => { cuesRef.current = cues; }, [cues]);
  const paragraphs = groupCuesIntoParagraphs(cues);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stopAtMsRef = useRef<number | null>(null);

  const [pinnedCueIdx, setPinnedCueIdx] = useState<number | null>(null);
  const pinnedCueIdxRef = useRef<number | null>(null);
  useEffect(() => { pinnedCueIdxRef.current = pinnedCueIdx; }, [pinnedCueIdx]);

  const [sidebarTab, setSidebarTab] = useState<'captions' | 'notes' | 'speak'>('captions');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [pendingNoteMs, setPendingNoteMs] = useState(0);
  const [noteText, setNoteText] = useState('');
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(384);
  const sidebarWidthRef = useRef(384);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidthRef.current;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const delta = startX - ev.clientX; // drag left = wider
      const newWidth = Math.min(800, Math.max(280, startWidth + delta));
      sidebarWidthRef.current = newWidth;
      setSidebarWidth(newWidth);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }, []);
  const [captionsVisible, setCaptionsVisible] = useState(false);
  const [vocabWords, setVocabWords] = useState<Set<string>>(new Set());
  const [vocabDialog, setVocabDialog] = useState<{ word: string; cue: CaptionCue } | null>(null);
  // Track whether video was playing before overlay hover paused it
  const wasPlayingRef = useRef(false);

  const quiz = useQuizMode();
  const speaking = useSpeakingMode(cues);
  const watchTime = useWatchTime(user?.sub);
  const videoProgress = useVideoProgress(user?.sub, videoId);
  const { notes, addNote, removeNote } = useVideoNotes(user?.sub, videoId);

  // Load saved vocab words for highlighting
  useEffect(() => {
    if (!user) return;
    getVocabWords(user.sub)
      .then(entries => setVocabWords(new Set(entries.map(e => e.word))))
      .catch(console.error);
  }, [user?.sub]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleOverlayMouseEnter() {
    if (playing) {
      wasPlayingRef.current = true;
      playerRef.current?.pause();
      setPlaying(false);
    }
  }

  function handleOverlayMouseLeave() {
    if (wasPlayingRef.current && !vocabDialog) {
      wasPlayingRef.current = false;
      playerRef.current?.play().catch(console.error);
      setPlaying(true);
    }
  }

  function handleWordClick(word: string) {
    if (!activeCue) return;
    setVocabDialog({ word, cue: activeCue });
  }

  async function handleAddToVocab(word: string, definition: string) {
    if (!user || !videoId || !vocabDialog) return;
    const entry: VocabEntry = {
      id: `${user.sub}_${word}_${Date.now()}`,
      word: word.toLowerCase(),
      definition,
      addedAt: new Date().toISOString(),
      sourceVideoId: videoId,
      sourceMs: vocabDialog.cue.startMs,
      sourceCueText: vocabDialog.cue.text,
    };
    await addVocabWord(entry, user.sub);
    setVocabWords(prev => new Set([...prev, entry.word]));
  }

  function handleDialogClose() {
    setVocabDialog(null);
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false;
      playerRef.current?.play().catch(console.error);
      setPlaying(true);
    }
  }

  const seekToMs = searchParams.get('t') ? Number(searchParams.get('t')) : null;


  useEffect(() => {
    async function loadCaptions() {
      if (!videoId) return;
      const data = await fetchCaptionData(videoId);
      if (!data) return;
      const result = parseJSON3(data);
      if (result.cues.length > 0) setCues(result.cues);
    }
    loadCaptions().catch(console.error);
  }, [videoId]);

  // Seek to ?t= timestamp once player is ready + cues loaded
  useEffect(() => {
    if (!seekToMs || didSeekRef.current || !playerRef.current || cues.length === 0) return;
    const video = playerRef.current;
    video.currentTime = seekToMs / 1000;
    const cue = findActiveCue(cues, seekToMs);
    if (cue) setPinnedCueIdx(cues.indexOf(cue));
    didSeekRef.current = true;
  }, [seekToMs, cues]);

  useEffect(() => {
    if (isAddingNote) noteInputRef.current?.focus();
  }, [isAddingNote]);

  // ── Active cue ───────────────────────────────────────────────────────────
  const liveCue = findActiveCue(cues, currentMs);
  const liveCueIdx = liveCue ? cues.indexOf(liveCue) : -1;
  const activeCueIdx = pinnedCueIdx !== null ? pinnedCueIdx : liveCueIdx;
  const activeCue = cues[activeCueIdx] ?? null;

  // ── Cue navigation ───────────────────────────────────────────────────────
  function playCueAt(idx: number) {
    const cue = cues[idx];
    if (!cue) return;
    const video = playerRef.current;
    if (!video) return;
    setPinnedCueIdx(idx);
    stopAtMsRef.current = cue.endMs;
    video.currentTime = cue.startMs / 1000;
    setPlaying(true);
    video.play().catch(console.error);
  }

  const [repeatMode, setRepeatMode] = useState(false);
  const repeatModeRef = useRef(false);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);

  // Disable YouTube's built-in captions via the IFrame API.
  // youtube-video-element hardcodes cc_load_policy=1, so we must clear the
  // active caption track programmatically after the player initializes.
  function disableYTCaptions() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ytEl = playerRef.current as any
    const api = ytEl?.api
    if (!api) return
    api.setOption?.('captions', 'track', {})
    api.unloadModule?.('cc')
    api.unloadModule?.('captions')
  }

  // ── Playback ─────────────────────────────────────────────────────────────
  const handleTimeUpdate = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const ms = e.currentTarget.currentTime * 1000;
      const dur = e.currentTarget.duration * 1000;
      // Only trigger re-render when duration first becomes known
      if (isFinite(dur) && dur > 0 && dur !== durationMsStateRef.current) {
        durationMsStateRef.current = dur;
        setDurationMs(dur);
      }
      videoProgress.onTimeUpdate(ms, dur);
      if (stopAtMsRef.current !== null && ms >= stopAtMsRef.current) {
        stopAtMsRef.current = null;
        const idx = pinnedCueIdxRef.current;
        const cue = idx !== null ? cuesRef.current[idx] : null;
        if (repeatModeRef.current && cue) {
          // Repeat: loop back to start of same cue
          stopAtMsRef.current = cue.endMs;
          e.currentTarget.currentTime = cue.startMs / 1000;
          return;
        }
        e.currentTarget.pause();
        setPlaying(false);
        quiz.onCueEnded();
        return;
      }
      setCurrentMs(ms);
    },
    [quiz.onCueEnded],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSeek = useCallback((ms: number) => {
    const video = playerRef.current;
    if (!video) return;
    stopAtMsRef.current = null;
    video.currentTime = ms / 1000;
    setCurrentMs(ms);
    setPinnedCueIdx(null);
  }, []);

  // Paragraph timestamp click: seek + always start playing
  const handleParagraphSeek = useCallback((ms: number) => {
    const video = playerRef.current;
    if (!video) return;
    stopAtMsRef.current = null;
    video.currentTime = ms / 1000;
    setCurrentMs(ms);
    setPinnedCueIdx(null);
    setPlaying(true);
    video.play().catch(console.error);
  }, []);

  const handleCueClick = useCallback(
    (cue: CaptionCue, idx: number) => {
      const video = playerRef.current;
      if (!video) return;
      setPinnedCueIdx(idx);
      quiz.onCueStarted(cue);
      stopAtMsRef.current = cue.endMs;
      video.currentTime = cue.startMs / 1000;
      setPlaying(true);
      video.play().catch(console.error);
    },
    [quiz.onCueStarted],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  function handleQuizClose(result: QuizResult | null) {
    const snapshotState = quiz.quizState;
    quiz.closeQuiz();
    if (result && user && videoId) {
      void saveQuizAttempt({
        userId: user.sub,
        videoId,
        cueStartMs: snapshotState?.cue.startMs ?? 0,
        targetWord: snapshotState?.quizWord.word ?? '',
        userAnswer: result.userAnswer,
        correct: result.correct,
        answeredAt: new Date().toISOString(),
      });
    }
  }

  function handleStartAddNote() {
    setPendingNoteMs(currentMs);
    setNoteText('');
    setIsAddingNote(true);
    setPlaying(false);
    playerRef.current?.pause();
  }

  function handleSaveNote() {
    if (!noteText.trim()) return;
    void addNote(pendingNoteMs, noteText);
    setIsAddingNote(false);
    setNoteText('');
  }

  function handleCancelNote() {
    setIsAddingNote(false);
    setNoteText('');
  }

  // Caption overlay — masked text in quiz mode, interactive CueText otherwise
  const overlayMasked = (() => {
    if (!activeCue) return null;
    if (quiz.quizMode && quiz.quizWordRef.current) return maskText(activeCue.text, quiz.quizWordRef.current);
    return null;
  })();

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <AppHeader />

      {/* Main — vertical stack on mobile, side-by-side on desktop */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Video column — fixed aspect-ratio on mobile, fills space on desktop */}
        <div className="shrink-0 md:flex-1 flex flex-col bg-black md:min-w-0 relative">
          <div className="relative w-full aspect-video md:aspect-auto md:flex-1 md:min-h-0">
            <ReactPlayer
              ref={playerRef}
              src={`https://www.youtube.com/watch?v=${videoId}`}
              playing={playing}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={() => disableYTCaptions()}
              onPlay={() => {
                disableYTCaptions();
                setPlaying(true);
                // If playback resumed without an active cue stop window, the
                // pin is stale (e.g. previous-cue finished, then user clicked
                // video to resume). Clear it so live cue tracking resumes.
                if (stopAtMsRef.current === null && pinnedCueIdxRef.current !== null) {
                  setPinnedCueIdx(null);
                  pinnedCueIdxRef.current = null;
                }
                watchTime.onPlay();
                videoProgress.onPlay();
              }}
              onPause={() => {
                setPlaying(false);
                watchTime.onPause();
                videoProgress.onPause();
              }}
              onEnded={() => {
                watchTime.onPause();
                videoProgress.onEnded();
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

            {/* Caption overlay — desktop only */}
            {activeCue && captionsVisible && (
              <div
                className="absolute bottom-10 left-0 right-0 hidden md:flex justify-center px-4 pointer-events-none"
                style={{ zIndex: 10 }}
              >
                <span
                  className="bg-black/80 text-white text-5xl font-semibold px-6 py-3 rounded text-center leading-snug max-w-4xl pointer-events-auto"
                  onMouseEnter={handleOverlayMouseEnter}
                  onMouseLeave={handleOverlayMouseLeave}
                >
                  {overlayMasked ?? <CueText text={activeCue.text} onWordClick={handleWordClick} savedWords={vocabWords} dark />}
                </span>
              </div>
            )}

            {/* CC toggle bubble — bottom-right of video, desktop only */}
            <button
              onClick={() => setCaptionsVisible(v => !v)}
              title={captionsVisible ? 'Hide captions' : 'Show captions'}
              className={[
                'absolute bottom-5 right-5 hidden md:flex items-center gap-2 px-5 py-2.5 rounded-full text-base font-bold transition-all duration-200 shadow-lg',
                captionsVisible
                  ? 'bg-white text-black hover:bg-white/90 scale-105 ring-2 ring-white/40'
                  : 'bg-black/75 text-white border-2 border-white/40 hover:bg-black/90 hover:border-white/70',
              ].join(' ')}
              style={{ zIndex: 15 }}
            >
              <Subtitles className="w-5 h-5" />
              CC
            </button>

            {vocabDialog && (
              <VocabDialog
                word={vocabDialog.word}
                sourceText={vocabDialog.cue.text}
                isSaved={vocabWords.has(vocabDialog.word)}
                onAdd={handleAddToVocab}
                onClose={handleDialogClose}
              />
            )}
          </div>

          {/* Caption strip — mobile only */}
          {activeCue && (
            <div className="md:hidden bg-black px-4 py-2.5 shrink-0 border-t border-white/10">
              <p className="text-white text-base font-medium text-center leading-relaxed">
                {overlayMasked ?? <CueText text={activeCue.text} onWordClick={handleWordClick} savedWords={vocabWords} dark />}
              </p>
            </div>
          )}

          {/* Progress bar */}
          <VideoProgressBar currentMs={currentMs} durationMs={durationMs} notes={notes} onSeek={handleSeek} />

          {/* Cue navigation bar */}
          <div className="shrink-0 flex items-center justify-center gap-3 bg-gray-900 border-t border-gray-800 py-2">
            <button
              onClick={() => playCueAt(activeCueIdx - 1)}
              disabled={activeCueIdx <= 0}
              title="Previous cue"
              className="w-9 h-9 flex items-center justify-center rounded-full text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <div className="flex flex-col items-center gap-0.5">
              <button
                onClick={() => { if (activeCueIdx >= 0) playCueAt(activeCueIdx); }}
                disabled={activeCueIdx < 0}
                title="Replay current cue"
                className="w-9 h-9 flex items-center justify-center rounded-full text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Repeat className="w-4 h-4" />
              </button>
              {/* Repeat toggle dot */}
              <button
                onClick={() => setRepeatMode(v => !v)}
                title={repeatMode ? 'Repeat on — click to turn off' : 'Turn on repeat'}
                className={[
                  'w-1.5 h-1.5 rounded-full transition-colors',
                  repeatMode ? 'bg-blue-400' : 'bg-gray-600 hover:bg-gray-400',
                ].join(' ')}
              />
            </div>
            <button
              onClick={() => playCueAt(activeCueIdx + 1)}
              disabled={activeCueIdx >= cues.length - 1}
              title="Next cue"
              className="w-9 h-9 flex items-center justify-center rounded-full text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <SkipForward className="w-4 h-4" />
            </button>

          </div>

          {/* Expand/collapse sidebar — right edge of video column, desktop only */}
          <button
            onClick={() => setSidebarOpen(v => !v)}
            title={sidebarOpen ? 'Expand video' : 'Show sidebar'}
            className={[
              'hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-30 w-7 h-14 items-center justify-center rounded-full bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-accent hover:scale-110 active:scale-95 transition-all duration-300 shadow-lg',
              sidebarOpen ? 'translate-x-1/2' : '-translate-x-2',
            ].join(' ')}
          >
            <ChevronRight className={['w-4 h-4 transition-transform duration-300', sidebarOpen ? 'rotate-0' : 'rotate-180'].join(' ')} />
          </button>
        </div>

        {/* Sidebar — always visible below video on mobile, on right on desktop */}
        <div
          className={[
            'flex-1 md:flex-none md:shrink-0 flex flex-col bg-card border-t md:border-t-0 md:border-l border-border overflow-hidden min-h-0 relative',
            sidebarOpen ? '' : 'md:w-0! md:border-l-0',
          ].join(' ')}
          style={sidebarOpen ? { width: sidebarWidth } : undefined}
        >
          {/* Drag handle — left edge of sidebar */}
          <div
            onPointerDown={handleResizeStart}
            className="hidden md:block absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-40 hover:bg-primary/20 active:bg-primary/30 transition-colors"
          />
          {/* Inner wrapper keeps content clipped */}
          <div className="flex flex-col flex-1 min-h-0" style={{ minWidth: sidebarWidth }}>
          {/* Sidebar tabs */}
          <div className="flex border-b border-border shrink-0">
            <SidebarTab active={sidebarTab === 'captions'} onClick={() => setSidebarTab('captions')}>
              Captions
            </SidebarTab>
            <SidebarTab active={sidebarTab === 'notes'} onClick={() => setSidebarTab('notes')}>
              Notes
              {notes.length > 0 && (
                <span className="ml-1.5 text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full font-semibold">
                  {notes.length}
                </span>
              )}
            </SidebarTab>
            <SidebarTab active={sidebarTab === 'speak'} onClick={() => {
              setSidebarTab('speak');
              playerRef.current?.pause();
              if (!speaking.speakingState && activeCueIdx >= 0) speaking.open(activeCueIdx);
            }}>
              <Mic className="w-3 h-3" />
              Speak
            </SidebarTab>
            <div className="ml-auto flex items-center pr-2">
              <QuizToggle active={quiz.quizMode} onToggle={quiz.toggleQuizMode} />
            </div>
          </div>

          {/* Captions panel */}
          {sidebarTab === 'captions' && (
            <TranscriptPanel
              paragraphs={paragraphs}
              currentMs={activeCue ? activeCue.startMs : currentMs}
              quizMode={quiz.quizMode}
              onCueClick={(cue) => handleCueClick(cue, cues.indexOf(cue))}
              onParagraphSeek={handleParagraphSeek}
            />
          )}

          {/* Notes panel */}
          {sidebarTab === 'notes' && (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Add note */}
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
                      onChange={e => setNoteText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSaveNote();
                        }
                        if (e.key === 'Escape') handleCancelNote();
                      }}
                      placeholder="Type your note… (Enter to save, Esc to cancel)"
                      rows={3}
                      className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveNote}
                        disabled={!noteText.trim()}
                        className="flex-1 h-7 rounded-lg bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground text-xs font-semibold transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelNote}
                        className="h-7 px-3 rounded-lg bg-muted hover:bg-accent text-muted-foreground text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleStartAddNote}
                    className="w-full flex items-center justify-center gap-2 h-8 rounded-lg border border-dashed border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground text-xs transition-colors"
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
                    <StickyNote className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground/60">
                      No notes yet.
                      <br />
                      Add a note while watching.
                    </p>
                  </div>
                )}
                {notes.map(note => (
                  <div
                    key={note.createdAt}
                    className="group flex gap-3 px-4 py-3 border-b border-border/60 hover:bg-accent/50 transition-colors"
                  >
                    <button
                      onClick={() => handleSeek(note.positionMs)}
                      className="text-[10px] font-mono text-yellow-500 hover:text-yellow-400 shrink-0 mt-0.5 hover:underline transition-colors"
                    >
                      {formatTime(note.positionMs)}
                    </button>
                    <p className="flex-1 text-xs text-foreground leading-relaxed whitespace-pre-wrap">{note.text}</p>
                    <button
                      onClick={() => removeNote(note.createdAt)}
                      className="opacity-0 group-hover:opacity-100 shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-destructive transition-all"
                      title="Delete note"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Speak panel */}
          {sidebarTab === 'speak' && (
            <SpeakingPanel
              state={speaking.speakingState}
              totalCues={cues.length}
              activeCueIdx={activeCueIdx}
              onOpen={speaking.open}
              onGoToCue={speaking.goToCue}
              onPlayCue={playCueAt}
              onStartRecording={() => { playerRef.current?.pause(); speaking.startRecording(); }}
              onStopRecording={speaking.stopRecording}
              onRetry={speaking.retry}
            />
          )}
          </div>{/* end inner wrapper */}
        </div>
      </div>

      {quiz.quizState && <QuizModal cue={quiz.quizState.cue} quizWord={quiz.quizState.quizWord} onClose={handleQuizClose} />}
    </div>
  );
}

// ─── SidebarTab ───────────────────────────────────────────────────────────────

function SidebarTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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
  );
}

// ─── QuizToggle ───────────────────────────────────────────────────────────────

function QuizToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={active ? 'Quiz mode on — click to disable' : 'Enable quiz mode'}
      className={[
        'flex items-center gap-1.5 h-7 px-3 rounded-lg text-xs font-semibold transition-colors',
        active
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
      ].join(' ')}
    >
      <Brain className="w-3.5 h-3.5" />
      Quiz
    </button>
  );
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
