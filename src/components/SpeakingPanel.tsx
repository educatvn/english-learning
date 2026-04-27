import { useEffect, useRef, useState } from 'react';
import { Mic, Square, RotateCcw, ChevronLeft, ChevronRight, Loader2, Play, Pause, Volume2, AlertCircle, ArrowLeft } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import type { SpeakingState } from '@/hooks/useSpeakingMode';
import type { SpeakingScore, WordDetail, WordScore } from '@/services/speechScoring';
import { fetchDictionaryEntry, type DictionaryEntry } from '@/services/vocabulary';
import { Button } from './ui/button';

// ── Dictionary cache — shared across all components in the session ────────

const _dictCache = new Map<string, DictionaryEntry | null>();

function useDictEntry(word: string): DictionaryEntry | null | undefined {
  const key = word.toLowerCase().replace(/[.,!?;:"']/g, '');
  const [entry, setEntry] = useState<DictionaryEntry | null | undefined>(
    _dictCache.has(key) ? _dictCache.get(key) : undefined,
  );

  useEffect(() => {
    if (_dictCache.has(key)) {
      setEntry(_dictCache.get(key)); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    let cancelled = false;
    fetchDictionaryEntry(key).then((e) => {
      _dictCache.set(key, e);
      if (!cancelled) setEntry(e);
    }).catch(() => {
      _dictCache.set(key, null);
      if (!cancelled) setEntry(null);
    });
    return () => { cancelled = true; };
  }, [key]);

  return entry;
}

function playDictAudio(audioUrl: string) {
  const a = new Audio(audioUrl);
  a.play().catch(() => {});
}

interface Props {
  state: SpeakingState | null;
  totalCues: number;
  activeCueIdx: number;
  onOpen: (idx: number) => void;
  onGoToCue: (idx: number) => void;
  onPlayCue: (idx: number) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onRetry: () => void;
  onWordClick: (word: string) => void;
  onExitWordMode: () => void;
}

export function SpeakingPanel({
  state,
  totalCues,
  activeCueIdx,
  onOpen,
  onGoToCue,
  onPlayCue,
  onStartRecording,
  onStopRecording,
  onRetry,
  onWordClick,
  onExitWordMode,
}: Props) {
  // Auto-sync with active cue (only locked during recording/scoring)
  useEffect(() => {
    if (activeCueIdx < 0) return;
    if (!state) {
      onOpen(activeCueIdx);
      return;
    }
    if (state.cueIdx !== activeCueIdx && state.phase !== 'recording' && state.phase !== 'scoring' && !state.wordMode) {
      onGoToCue(activeCueIdx);
    }
  }, [activeCueIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // No cue selected yet — show prompt
  if (!state) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 px-6 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
          <Mic className="w-7 h-7 text-red-400" />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">Speaking Practice</p>
        <p className="text-xs text-muted-foreground mb-5">Select a cue to start practicing pronunciation</p>
        {activeCueIdx >= 0 && (
          <Button
            onClick={() => onOpen(activeCueIdx)}
            className="rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/25"
            size="lg"
          >
            <Mic className="w-4 h-4" />
            Start practicing
          </Button>
        )}
      </div>
    );
  }

  const { cue, cueIdx, phase, result, recordingBlob, wordMode, targetWord, wordResult, error } = state;

  // ── Word practice mode ──
  if (wordMode && targetWord) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="px-4 pt-4 pb-3 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onExitWordMode}
            className="mb-3 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to sentence
          </Button>
          <div className="rounded-xl bg-muted/50 border border-border/50 px-4 py-4 mb-3 text-center">
            <p className="text-2xl font-bold text-foreground">{targetWord}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Word practice</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {phase === 'ready' && (
            <div className="flex flex-col items-center gap-4 pt-6">
              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-500 max-w-75">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              <Button
                onClick={onStartRecording}
                className="group relative w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 text-white shadow-lg shadow-red-500/30"
                size="icon-lg"
              >
                <span className="absolute inset-0 rounded-full bg-red-400/30 animate-ping group-hover:animate-none" />
                <Mic className="w-7 h-7 relative" />
              </Button>
              <p className="text-xs text-muted-foreground">Say "<span className="font-medium text-foreground">{targetWord}</span>"</p>
            </div>
          )}

          {phase === 'recording' && <RecordingView stream={state.micStream} onStop={onStopRecording} />}

          {phase === 'scoring' && (
            <div className="flex flex-col items-center gap-3 pt-8">
              <div className="relative w-14 h-14 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              </div>
              <p className="text-xs text-muted-foreground">Analyzing...</p>
            </div>
          )}

          {phase === 'result' && wordResult && (
            <WordResultView result={wordResult} recordingBlob={recordingBlob} onRetry={onRetry} />
          )}
        </div>
      </div>
    );
  }

  // ── Sentence practice mode ──
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-4 pt-4 pb-3 shrink-0">
        {/* Cue text card — icon play button left, text right */}
        <div className="flex items-start gap-3 rounded-xl bg-muted/50 border border-border/50 px-4 py-3 mb-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onPlayCue(cueIdx)}
            className="w-9 h-9 shrink-0 rounded-full bg-primary/10 hover:bg-primary/20 text-primary mt-0.5"
          >
            <Volume2 className="w-4 h-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <TooltipProvider delayDuration={300}>
              <p className="text-sm font-semibold text-foreground leading-relaxed">
                {cue.text.split(/\s+/).map((word, i) => {
                  const clean = word.replace(/[.,!?;:"']/g, '');
                  if (!clean) return <span key={i}>{i > 0 && ' '}{word}</span>;
                  return (
                    <span key={i}>
                      {i > 0 && ' '}
                      <CueWord word={word} clean={clean} onClick={() => onWordClick(clean)} />
                    </span>
                  );
                })}
              </p>
            </TooltipProvider>
            <p className="text-[10px] text-muted-foreground mt-1.5">Click any word to practice individually</p>
          </div>
        </div>

        {/* Navigation — centered, prominent */}
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onGoToCue(cueIdx - 1)}
            disabled={cueIdx <= 0}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums min-w-[4rem] text-center font-medium">
            {cueIdx + 1} / {totalCues}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onGoToCue(cueIdx + 1)}
            disabled={cueIdx >= totalCues - 1}
            className="text-muted-foreground hover:text-foreground"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {phase === 'ready' && (
          <div className="flex flex-col items-center gap-4 pt-6">
            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-500 max-w-75">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <Button
              onClick={onStartRecording}
              className="group relative w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 text-white shadow-lg shadow-red-500/30"
              size="icon-lg"
            >
              <span className="absolute inset-0 rounded-full bg-red-400/30 animate-ping group-hover:animate-none" />
              <Mic className="w-7 h-7 relative" />
            </Button>
            <p className="text-xs text-muted-foreground">Tap to start recording</p>
          </div>
        )}

        {phase === 'recording' && <RecordingView stream={state.micStream} onStop={onStopRecording} />}

        {phase === 'scoring' && (
          <div className="flex flex-col items-center gap-3 pt-8">
            <div className="relative w-14 h-14 flex items-center justify-center">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
            <p className="text-xs text-muted-foreground">Analyzing your pronunciation...</p>
          </div>
        )}

        {phase === 'result' && result && (
          <ResultView result={result} recordingBlob={recordingBlob} onRetry={onRetry} onWordClick={onWordClick} />
        )}
      </div>
    </div>
  );
}

// ── Recording with real microphone waveform ───────────────────────────────

function RecordingView({ stream, onStop }: { stream: MediaStream | null; onStop: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    startRef.current = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 200);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!stream) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let dataArray: Uint8Array<ArrayBuffer> | null = null;

    try {
      // Match the stream's sample rate to avoid audio device errors on macOS
      const trackSettings = stream.getAudioTracks()[0]?.getSettings();
      const sampleRate = trackSettings?.sampleRate;
      audioCtx = new AudioContext(sampleRate ? { sampleRate } : undefined);
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.frequencyBinCount);
    } catch (err) {
      console.warn('AudioContext visualization failed, recording continues:', err);
    }

    function draw() {
      animRef.current = requestAnimationFrame(draw);

      const w = canvas!.width;
      const h = canvas!.height;
      canvasCtx!.clearRect(0, 0, w, h);

      const barCount = 40;
      const gap = 3;
      const barWidth = (w - gap * (barCount - 1)) / barCount;

      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        const step = Math.floor(dataArray.length / barCount);

        for (let i = 0; i < barCount; i++) {
          const value = dataArray[i * step];
          const norm = value / 255;
          const barHeight = Math.max(4, norm * h * 0.85);
          const x = i * (barWidth + gap);
          const y = (h - barHeight) / 2;

          canvasCtx!.fillStyle = `rgba(248, 113, 113, ${0.35 + norm * 0.65})`;
          canvasCtx!.beginPath();
          canvasCtx!.roundRect(x, y, barWidth, barHeight, barWidth / 2);
          canvasCtx!.fill();
        }
      } else {
        // Fallback: show a simple pulsing animation when AudioContext is unavailable
        const t = Date.now() / 300;
        for (let i = 0; i < barCount; i++) {
          const norm = 0.3 + 0.2 * Math.sin(t + i * 0.3);
          const barHeight = Math.max(4, norm * h * 0.5);
          const x = i * (barWidth + gap);
          const y = (h - barHeight) / 2;

          canvasCtx!.fillStyle = `rgba(248, 113, 113, ${0.3 + norm * 0.4})`;
          canvasCtx!.beginPath();
          canvasCtx!.roundRect(x, y, barWidth, barHeight, barWidth / 2);
          canvasCtx!.fill();
        }
      }
    }
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      audioCtx?.close().catch(() => {});
    };
  }, [stream]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <div className="flex flex-col items-center gap-4 pt-4">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm font-mono text-red-400 tabular-nums">
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </span>
      </div>

      <canvas ref={canvasRef} width={320} height={56} className="w-full max-w-[320px] h-14" />

      <Button
        onClick={onStop}
        className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 text-white shadow-lg shadow-red-500/30"
        size="icon-lg"
      >
        <Square className="w-5 h-5 fill-current" />
      </Button>
      <p className="text-[11px] text-muted-foreground">Tap to stop</p>
    </div>
  );
}

// ── Word Result ───────────────────────────────────────────────────────────

function WordResultView({
  result,
  recordingBlob,
  onRetry,
}: {
  result: WordScore;
  recordingBlob: Blob | null;
  onRetry: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrl = useAudioUrl(recordingBlob);
  const [isPlaying, setIsPlaying] = useState(false);
  const entry = useDictEntry(result.word);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(console.error);
    }
  }

  const score = result.pronunciation_score;
  const color = score >= 80 ? '#4ade80' : score >= 50 ? '#facc15' : '#f87171';
  const trackColor = score >= 80 ? 'rgba(74,222,128,0.15)' : score >= 50 ? 'rgba(250,204,21,0.15)' : 'rgba(248,113,113,0.15)';
  const textColor = score >= 80 ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400';
  const statusColor = result.status === 'correct'
    ? 'text-green-500'
    : result.status === 'mispronounced'
      ? 'text-yellow-500'
      : 'text-red-500';
  const statusLabel = result.status === 'correct' ? 'Correct!' : result.status === 'mispronounced' ? 'Needs work' : 'Not detected';

  return (
    <div className="flex flex-col gap-4">
      {/* Score ring + status */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative shrink-0" style={{ width: 88, height: 88 }}>
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke={trackColor} strokeWidth="2.5" />
            <circle
              cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="2.5"
              strokeDasharray={`${score} ${100 - score}`} strokeLinecap="round"
              className="transition-all duration-700 ease-out"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-xl font-bold ${textColor}`}>{score}</span>
          </div>
        </div>
        <p className={`text-sm font-semibold ${statusColor}`}>{statusLabel}</p>
      </div>

      {/* Expected pronunciation — listen to native audio */}
      {entry?.audioUrl && (
        <Button
          variant="ghost"
          type="button"
          onClick={() => playDictAudio(entry.audioUrl)}
          className="flex items-center gap-2.5 w-full text-left group rounded-xl border border-border bg-card p-3 h-auto"
        >
          <span className="w-8 h-8 shrink-0 rounded-full bg-blue-500/10 group-hover:bg-blue-500/20 flex items-center justify-center text-blue-500 transition-colors">
            <Volume2 className="w-3.5 h-3.5" />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-foreground font-medium">Listen to expected pronunciation</span>
            {entry.phonetic && <span className="text-[10px] text-muted-foreground font-ipa">{entry.phonetic}</span>}
          </div>
        </Button>
      )}

      {/* Details card */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2.5">
        {result.expected_phonemes && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Expected</span>
            <span className="font-ipa">/{result.expected_phonemes}/</span>
          </div>
        )}
        {result.recognized_phonemes && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Heard</span>
            <span className="font-ipa">/{result.recognized_phonemes}/</span>
          </div>
        )}
        {result.heard_as && (
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">You said</span>
            <span className="font-medium">"{result.heard_as}"</span>
          </div>
        )}
      </div>

      {/* Dictionary definition */}
      {entry?.meanings?.[0] && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-sm font-semibold text-foreground">{result.word}</span>
            <span className="text-xs text-muted-foreground italic">{entry.meanings[0].partOfSpeech}</span>
          </div>
          {entry.meanings[0].definitions.slice(0, 2).map((d, i) => (
            <p key={i} className="text-xs text-muted-foreground leading-relaxed">
              {entry.meanings[0].definitions.length > 1 && <span className="text-muted-foreground/60">{i + 1}. </span>}
              {d.definition}
            </p>
          ))}
        </div>
      )}

      {/* Playback of user's recording */}
      {audioUrl && (
        <Button
          variant="ghost"
          type="button"
          onClick={togglePlayback}
          className="flex items-center gap-2.5 w-full text-left group rounded-xl border border-border bg-card p-3 h-auto"
        >
          <span className="w-8 h-8 shrink-0 rounded-full bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center text-primary transition-colors">
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </span>
          <span className="text-xs text-muted-foreground">Listen to your recording</span>
        </Button>
      )}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {/* Retry */}
      <Button size="lg" onClick={onRetry}>
        <RotateCcw className="w-3.5 h-3.5" />
        Try again
      </Button>
    </div>
  );
}

// ── Sentence Result ───────────────────────────────────────────────────────

function ResultView({
  result,
  recordingBlob,
  onRetry,
  onWordClick,
}: {
  result: SpeakingScore;
  recordingBlob: Blob | null;
  onRetry: () => void;
  onWordClick: (word: string) => void;
}) {
  const { overall, accuracy, pronunciation, fluency, prosody, word_details } = result.score;

  const mispronounced = word_details.filter(w => w.status === 'mispronounced');
  const missed = word_details.filter(w => w.status === 'missed');
  const correct = word_details.filter(w => w.status === 'correct');

  return (
    <div className="flex flex-col gap-4">
      {/* Score card + Try again */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div className="flex items-center gap-5">
          <ScoreRing value={overall} size={72} />
          <div className="flex-1 space-y-2">
            <ScoreBar label="Accuracy" value={accuracy} />
            <ScoreBar label="Pronunciation" value={pronunciation} />
            <ScoreBar label="Fluency" value={fluency} />
          </div>
        </div>
        <Button size="lg" onClick={onRetry} className="w-full">
          <RotateCcw className="w-3.5 h-3.5" />
          Try again
        </Button>
      </div>

      {/* Prosody breakdown */}
      {prosody && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Prosody</p>
          <div className="space-y-2">
            <ScoreBar label="Stress" value={prosody.stress} />
            <ScoreBar label="Intonation" value={prosody.intonation} />
            <ScoreBar label="Rhythm" value={prosody.rhythm} />
            <ScoreBar label="Rate" value={prosody.rate} />
          </div>
        </div>
      )}

      {/* Transcript comparison */}
      <TranscriptComparison wordDetails={word_details} transcript={result.transcript} reference={result.reference} recordingBlob={recordingBlob} />

      {/* Word-by-word breakdown — clickable */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Word Analysis</p>
          <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              {correct.length}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-yellow-400" />
              {mispronounced.length}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              {missed.length}
            </span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mb-2">Click a word to practice it individually</p>
        <TooltipProvider delayDuration={200}>
          <div className="flex flex-wrap gap-1.5">
            {word_details.map((w, i) => (
              <WordBadge key={i} word={w} onClick={() => onWordClick(w.word)} />
            ))}
          </div>
        </TooltipProvider>
      </div>

      {/* Feedback */}
      {result.feedback.summary && <FeedbackCard feedback={result.feedback} overall={overall} />}
    </div>
  );
}

// ── Transcript comparison ─────────────────────────────────────────────────

function TranscriptComparison({
  wordDetails,
  transcript,
  reference,
  recordingBlob,
}: {
  wordDetails: WordDetail[];
  transcript: string;
  reference: string;
  recordingBlob: Blob | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrl = useAudioUrl(recordingBlob);
  const [isPlaying, setIsPlaying] = useState(false);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(console.error);
    }
  }

  if (wordDetails.length === 0 && !transcript) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground italic">Nothing detected</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Reference</p>
        <p className="text-sm text-foreground/60 leading-relaxed mb-1.5">{reference}</p>
        <TooltipProvider delayDuration={300}>
          <p className="text-sm leading-relaxed">
            {wordDetails.map((w, i) => {
              const colorClass =
                w.status === 'correct'
                  ? 'text-green-600 dark:text-green-400'
                  : w.status === 'mispronounced'
                    ? 'text-yellow-600 dark:text-yellow-400 underline decoration-yellow-400/40 decoration-wavy underline-offset-4'
                    : 'text-red-500 dark:text-red-400 line-through decoration-red-400/60';
              return (
                <span key={i}>
                  {i > 0 && ' '}
                  <ReferenceWord word={w.word} colorClass={colorClass} />
                </span>
              );
            })}
          </p>
        </TooltipProvider>
      </div>

      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">You said</p>
        <div className="flex items-start gap-2.5">
          {audioUrl && (
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={togglePlayback}
              className="w-8 h-8 shrink-0 rounded-full bg-primary/10 hover:bg-primary/20 text-primary"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
            </Button>
          )}
          <p className="text-sm text-foreground/80 leading-relaxed min-w-0 pt-1">
            {transcript || <span className="italic text-muted-foreground">(nothing detected)</span>}
          </p>
        </div>
        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
          />
        )}
      </div>
    </div>
  );
}

// ── Word badge with tooltip ────────────────────────────────────────────────

function WordBadge({ word, onClick }: { word: WordDetail; onClick: () => void }) {
  const entry = useDictEntry(word.word);
  const colorClasses =
    word.status === 'correct'
      ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20'
      : word.status === 'mispronounced'
        ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20'
        : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20';

  const badge = (
    <span
      onClick={onClick}
      className={`inline-block px-2 py-1 rounded-md text-xs font-medium border cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all ${colorClasses}`}
    >
      {word.word}
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top" className="w-56 space-y-1.5 text-[11px]">
        {/* Dictionary header */}
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-foreground text-xs">{word.word}</span>
          {entry?.phonetic && <span className="font-ipa text-muted-foreground">{entry.phonetic}</span>}
          {entry?.audioUrl && (
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={(e) => { e.stopPropagation(); playDictAudio(entry.audioUrl); }}
              className="w-4 h-4 text-primary hover:text-primary/80"
            >
              <Volume2 className="w-3 h-3" />
            </Button>
          )}
        </div>

        {/* Dictionary definition */}
        {entry?.meanings?.[0] && (
          <div className="pb-1 border-b border-border/50">
            <span className="text-muted-foreground italic">{entry.meanings[0].partOfSpeech}</span>
            {entry.meanings[0].definitions[0] && (
              <p className="text-foreground leading-snug mt-0.5">{entry.meanings[0].definitions[0].definition}</p>
            )}
          </div>
        )}

        {/* Scoring info */}
        {word.status === 'missed' ? (
          <p className="text-red-500">Word not detected — click to practice</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Score</span>
              <span className="font-semibold">{word.pronunciation_score}%</span>
            </div>
            {word.expected_phonemes && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expected</span>
                <span className="font-ipa">/{word.expected_phonemes}/</span>
              </div>
            )}
            {word.recognized_phonemes && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Heard</span>
                <span className="font-ipa">/{word.recognized_phonemes}/</span>
              </div>
            )}
            {word.heard_as && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Heard as</span>
                <span className="font-medium">"{word.heard_as}"</span>
              </div>
            )}
            {word.prosody_score != null && (
              <div className="pt-1 border-t border-border/50 space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stress</span>
                  <span className="font-semibold">{word.prosody_score}%</span>
                </div>
                {word.prosody_details && (
                  <>
                    <StressFeatureBar label="Volume" value={word.prosody_details.energy} />
                    <StressFeatureBar label="Pitch" value={word.prosody_details.pitch} unit="Hz" />
                    <StressFeatureBar label="Vowel len." value={Math.round(word.prosody_details.vowel_duration * 100)} unit="%" />
                    <p className="text-[9px] text-muted-foreground/70 pt-0.5">
                      {word.prosody_details.is_content_word
                        ? 'Content word — should be stressed (louder, longer, higher pitch)'
                        : 'Function word — typically unstressed'}
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        )}
        <p className="text-primary text-center pt-0.5">Click to practice</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Cue word with dictionary tooltip (sentence header) ──────────────────

function CueWord({ word, clean, onClick }: { word: string; clean: string; onClick: () => void }) {
  const entry = useDictEntry(clean);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          onClick={onClick}
          className="cursor-pointer hover:bg-primary/10 hover:text-primary rounded px-0.5 -mx-0.5 transition-colors"
        >
          {word}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="w-56 space-y-1.5 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-foreground text-xs">{clean}</span>
          {entry?.phonetic && <span className="font-ipa text-muted-foreground">{entry.phonetic}</span>}
          {entry?.audioUrl && (
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={(e) => { e.stopPropagation(); playDictAudio(entry.audioUrl); }}
              className="w-4 h-4 text-primary hover:text-primary/80"
            >
              <Volume2 className="w-3 h-3" />
            </Button>
          )}
        </div>
        {entry === undefined && (
          <p className="text-muted-foreground italic">Loading...</p>
        )}
        {entry === null && (
          <p className="text-muted-foreground italic">No definition found</p>
        )}
        {entry?.meanings?.[0] && (
          <div>
            <span className="text-muted-foreground italic">{entry.meanings[0].partOfSpeech}</span>
            {entry.meanings[0].definitions[0] && (
              <p className="text-foreground leading-snug mt-0.5">{entry.meanings[0].definitions[0].definition}</p>
            )}
          </div>
        )}
        <p className="text-primary text-center pt-0.5">Click to practice</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Reference word with audio + dictionary tooltip ───────────────────────

function ReferenceWord({ word, colorClass }: { word: string; colorClass: string }) {
  const entry = useDictEntry(word);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`font-medium cursor-default ${colorClass}`}>
          {word}
          {entry?.audioUrl && (
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={(e) => { e.stopPropagation(); playDictAudio(entry.audioUrl); }}
              className="inline-flex w-4 h-4 ml-0.5 align-middle text-muted-foreground hover:text-primary"
              title="Listen to pronunciation"
            >
              <Volume2 className="w-3 h-3" />
            </Button>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="w-56 space-y-1.5 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-foreground text-xs">{word}</span>
          {entry?.phonetic && <span className="font-ipa text-muted-foreground">{entry.phonetic}</span>}
          {entry?.audioUrl && (
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              onClick={() => playDictAudio(entry.audioUrl)}
              className="w-4 h-4 text-primary hover:text-primary/80"
            >
              <Volume2 className="w-3 h-3" />
            </Button>
          )}
        </div>
        {entry === undefined && (
          <p className="text-muted-foreground italic">Loading...</p>
        )}
        {entry === null && (
          <p className="text-muted-foreground italic">No definition found</p>
        )}
        {entry?.meanings?.[0] && (
          <div>
            <span className="text-muted-foreground italic">{entry.meanings[0].partOfSpeech}</span>
            {entry.meanings[0].definitions[0] && (
              <p className="text-foreground leading-snug mt-0.5">{entry.meanings[0].definitions[0].definition}</p>
            )}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Feedback card ─────────────────────────────────────────────────────────

function FeedbackCard({ feedback, overall }: { feedback: SpeakingScore['feedback']; overall: number }) {
  const borderColor = overall >= 80 ? 'border-l-green-500' : overall >= 50 ? 'border-l-yellow-500' : 'border-l-red-500';
  const hasContent = feedback.phoneme_errors?.length > 0
    || feedback.missed_words?.length > 0
    || feedback.prosody_tips?.length > 0
    || feedback.tips?.length > 0;

  if (!hasContent && !feedback.summary) return null;

  return (
    <div className={`rounded-xl border border-border bg-card p-4 border-l-4 ${borderColor} space-y-3`}>
      <p className="text-xs font-medium text-foreground">{feedback.summary}</p>

      {/* Phoneme errors — visual bars */}
      {feedback.phoneme_errors?.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Sounds to practice</p>
          {feedback.phoneme_errors.map((err, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-ipa text-xs font-semibold text-foreground min-w-[2rem]">/{err.phoneme}/</span>
                {err.confused_with && (
                  <span className="text-[10px] text-muted-foreground">
                    sounds like <span className="font-ipa font-semibold text-yellow-500">/{err.confused_with}/</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-red-400/15 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-red-400 transition-all duration-500"
                    style={{ width: `${err.score}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold tabular-nums text-red-500 w-6 text-right">{err.score}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                in {err.words.map((w, j) => (
                  <span key={j}>
                    {j > 0 && ', '}
                    <span className="font-medium text-foreground/80">{w}</span>
                  </span>
                ))}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Missed words */}
      {feedback.missed_words?.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Not detected</p>
          <div className="flex flex-wrap gap-1">
            {feedback.missed_words.map((w, i) => (
              <span key={i} className="inline-block px-2 py-0.5 rounded-md text-[10px] font-medium bg-red-500/10 text-red-500 border border-red-500/20">
                {w}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Prosody tips — with score bars */}
      {feedback.prosody_tips?.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Prosody tips</p>
          {feedback.prosody_tips.map((tip, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-16 shrink-0">{tip.label}</span>
                <div className="flex-1 h-1.5 rounded-full bg-yellow-400/15 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-yellow-400 transition-all duration-500"
                    style={{ width: `${tip.score}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold tabular-nums text-yellow-500 w-6 text-right">{tip.score}</span>
              </div>
              <p className="text-[10px] text-muted-foreground pl-16">{tip.detail}</p>
            </div>
          ))}
        </div>
      )}

      {/* Legacy text tips */}
      {feedback.tips?.length > 0 && (
        <ul className="space-y-1.5">
          {feedback.tips.map((tip, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground leading-relaxed">
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground/60" />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Score components ───────────────────────────────────────────────────────

function ScoreRing({ value, size = 72 }: { value: number; size?: number }) {
  const color = value >= 80 ? '#4ade80' : value >= 50 ? '#facc15' : '#f87171';
  const trackColor = value >= 80 ? 'rgba(74,222,128,0.15)' : value >= 50 ? 'rgba(250,204,21,0.15)' : 'rgba(248,113,113,0.15)';
  const textColor = value >= 80 ? 'text-green-400' : value >= 50 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke={trackColor} strokeWidth="2.5" />
        <circle
          cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="2.5"
          strokeDasharray={`${value} ${100 - value}`} strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-lg font-bold ${textColor}`}>{value}</span>
        <span className="text-[8px] text-muted-foreground -mt-0.5">overall</span>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? 'bg-green-400' : value >= 50 ? 'bg-yellow-400' : 'bg-red-400';
  const trackColor = value >= 80 ? 'bg-green-400/15' : value >= 50 ? 'bg-yellow-400/15' : 'bg-red-400/15';
  const textColor = value >= 80 ? 'text-green-500' : value >= 50 ? 'text-yellow-500' : 'text-red-500';

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-[4.5rem] shrink-0">{label}</span>
      <div className={`flex-1 h-1.5 rounded-full ${trackColor} overflow-hidden`}>
        <div className={`h-full rounded-full ${color} transition-all duration-700 ease-out`} style={{ width: `${value}%` }} />
      </div>
      <span className={`text-[11px] font-bold tabular-nums w-7 text-right ${textColor}`}>{value}</span>
    </div>
  );
}

function StressFeatureBar({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="flex justify-between text-[10px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}{unit ? ` ${unit}` : ''}</span>
    </div>
  );
}

// ── Shared hook: blob → stable data URL (no revocation needed) ──────────

function useAudioUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const [prevBlob, setPrevBlob] = useState<Blob | null>(null);

  // Reset when blob changes — "adjusting state during render" pattern
  // (officially supported: https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  if (blob !== prevBlob) {
    setPrevBlob(blob);
    if (!blob) setUrl(null);
  }

  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (!cancelled) setUrl(reader.result as string);
    };
    reader.readAsDataURL(blob);
    return () => { cancelled = true; };
  }, [blob]);

  return url;
}
