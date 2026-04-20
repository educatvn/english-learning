import { useEffect, useRef, useState } from 'react';
import { Mic, Square, RotateCcw, ChevronLeft, ChevronRight, Loader2, Play, Pause, Volume2, AlertCircle } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import type { SpeakingState } from '@/hooks/useSpeakingMode';
import type { SpeakingScore, WordDetail } from '@/services/speechScoring';

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
}: Props) {
  // Auto-sync with active cue (only locked during recording/scoring)
  useEffect(() => {
    if (activeCueIdx < 0) return;
    if (!state) {
      onOpen(activeCueIdx);
      return;
    }
    if (state.cueIdx !== activeCueIdx && state.phase !== 'recording' && state.phase !== 'scoring') {
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
        <p className="text-xs text-muted-foreground mb-5">
          Select a cue to start practicing pronunciation
        </p>
        {activeCueIdx >= 0 && (
          <button
            onClick={() => onOpen(activeCueIdx)}
            className="flex items-center gap-2 h-10 px-5 rounded-full bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors shadow-lg shadow-red-500/25"
          >
            <Mic className="w-4 h-4" />
            Start practicing
          </button>
        )}
      </div>
    );
  }

  const { cue, cueIdx, phase, result, recordingBlob } = state;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header: cue text + controls */}
      <div className="px-4 pt-4 pb-3 shrink-0">
        {/* Cue text card */}
        <div className="rounded-xl bg-muted/50 border border-border/50 px-4 py-3 mb-3">
          <p className="text-sm font-semibold text-foreground leading-relaxed">
            {cue.text}
          </p>
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => onPlayCue(cueIdx)}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg hover:bg-accent text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Volume2 className="w-3.5 h-3.5" />
            Listen
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onGoToCue(cueIdx - 1)}
              disabled={cueIdx <= 0}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[10px] text-muted-foreground tabular-nums min-w-[3rem] text-center">
              {cueIdx + 1} / {totalCues}
            </span>
            <button
              onClick={() => onGoToCue(cueIdx + 1)}
              disabled={cueIdx >= totalCues - 1}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {phase === 'ready' && (
          <div className="flex flex-col items-center gap-4 pt-6">
            <button
              onClick={onStartRecording}
              className="group relative w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 flex items-center justify-center text-white transition-all shadow-lg shadow-red-500/30"
            >
              <span className="absolute inset-0 rounded-full bg-red-400/30 animate-ping group-hover:animate-none" />
              <Mic className="w-7 h-7 relative" />
            </button>
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
          <ResultView result={result} recordingBlob={recordingBlob} onRetry={onRetry} />
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
  const startRef = useRef(Date.now());

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

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      animRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      const w = canvas!.width;
      const h = canvas!.height;
      canvasCtx!.clearRect(0, 0, w, h);

      const barCount = 40;
      const gap = 3;
      const barWidth = (w - gap * (barCount - 1)) / barCount;
      const step = Math.floor(bufferLength / barCount);

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step];
        const norm = value / 255;
        const barHeight = Math.max(4, norm * h * 0.85);
        const x = i * (barWidth + gap);
        const y = (h - barHeight) / 2;

        // Gradient from red-400 to red-500
        canvasCtx!.fillStyle = `rgba(248, 113, 113, ${0.35 + norm * 0.65})`;
        canvasCtx!.beginPath();
        canvasCtx!.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        canvasCtx!.fill();
      }
    }
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      audioCtx.close();
    };
  }, [stream]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <div className="flex flex-col items-center gap-4 pt-4">
      {/* Timer */}
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm font-mono text-red-400 tabular-nums">
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </span>
      </div>

      {/* Waveform */}
      <canvas
        ref={canvasRef}
        width={320}
        height={56}
        className="w-full max-w-[320px] h-14"
      />

      {/* Stop button */}
      <button
        onClick={onStop}
        className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 active:scale-95 flex items-center justify-center text-white transition-all shadow-lg shadow-red-500/30"
      >
        <Square className="w-5 h-5 fill-current" />
      </button>
      <p className="text-[11px] text-muted-foreground">Tap to stop</p>
    </div>
  );
}

// ── Result ─────────────────────────────────────────────────────────────────

function ResultView({
  result,
  recordingBlob,
  onRetry,
}: {
  result: SpeakingScore;
  recordingBlob: Blob | null;
  onRetry: () => void;
}) {
  const { overall, accuracy, pronunciation, fluency, word_details } = result.score;

  const mispronounced = word_details.filter(w => w.status === 'mispronounced');
  const missed = word_details.filter(w => w.status === 'missed');
  const correct = word_details.filter(w => w.status === 'correct');

  return (
    <div className="flex flex-col gap-4">
      {/* Score card */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-5">
          <ScoreRing value={overall} size={72} />
          <div className="flex-1 space-y-2">
            <ScoreBar label="Accuracy" value={accuracy} />
            <ScoreBar label="Pronunciation" value={pronunciation} />
            <ScoreBar label="Fluency" value={fluency} />
          </div>
        </div>
      </div>

      {/* Transcript comparison */}
      <TranscriptComparison wordDetails={word_details} transcript={result.transcript} recordingBlob={recordingBlob} />

      {/* Word-by-word breakdown */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Word Analysis</p>
          <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" />{correct.length}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" />{mispronounced.length}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />{missed.length}</span>
          </div>
        </div>
        <TooltipProvider delayDuration={200}>
          <div className="flex flex-wrap gap-1.5">
            {word_details.map((w, i) => (
              <WordBadge key={i} word={w} />
            ))}
          </div>
        </TooltipProvider>
      </div>

      {/* Feedback */}
      {result.feedback.summary && (
        <FeedbackCard feedback={result.feedback} overall={overall} />
      )}

      {/* Retry */}
      <button
        onClick={onRetry}
        className="flex items-center justify-center gap-2 h-10 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Try again
      </button>
    </div>
  );
}

// ── Transcript comparison ─────────────────────────────────────────────────

function TranscriptComparison({ wordDetails, transcript, recordingBlob }: { wordDetails: WordDetail[]; transcript: string; recordingBlob: Blob | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!recordingBlob) return;
    const url = URL.createObjectURL(recordingBlob);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recordingBlob]);

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
      {/* Reference with colored words */}
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Reference</p>
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
                <span className={`font-medium ${colorClass}`}>{w.word}</span>
              </span>
            );
          })}
        </p>
      </div>

      {/* You said — with inline playback */}
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">You said</p>
        <button
          type="button"
          onClick={togglePlayback}
          disabled={!audioUrl}
          className="flex items-center gap-2.5 w-full text-left group disabled:opacity-50 disabled:cursor-default"
        >
          <span className="w-8 h-8 shrink-0 rounded-full bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center text-primary transition-colors">
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </span>
          <span className="text-sm text-foreground/80 leading-relaxed min-w-0">
            {transcript || <span className="italic text-muted-foreground">(nothing detected)</span>}
          </span>
        </button>
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

function WordBadge({ word }: { word: WordDetail }) {
  const colorClasses =
    word.status === 'correct'
      ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20'
      : word.status === 'mispronounced'
        ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20'
        : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20';

  const hasTooltip = word.status !== 'correct';

  const badge = (
    <span
      className={`inline-block px-2 py-1 rounded-md text-xs font-medium border ${colorClasses} ${hasTooltip ? 'cursor-help' : 'cursor-default'}`}
    >
      {word.word}
    </span>
  );

  if (!hasTooltip) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="top" className="w-48 space-y-1 text-[11px]">
        {word.status === 'missed' ? (
          <p className="text-red-500">Word not detected</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Score</span>
              <span className="font-semibold">{word.pronunciation_score}%</span>
            </div>
            {word.expected_phonemes && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expected</span>
                <span className="font-mono">/{word.expected_phonemes}/</span>
              </div>
            )}
            {word.recognized_phonemes && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Heard</span>
                <span className="font-mono">/{word.recognized_phonemes}/</span>
              </div>
            )}
            {word.heard_as && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Heard as</span>
                <span className="font-medium">"{word.heard_as}"</span>
              </div>
            )}
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Feedback card ─────────────────────────────────────────────────────────

function FeedbackCard({ feedback, overall }: { feedback: SpeakingScore['feedback']; overall: number }) {
  const borderColor =
    overall >= 80 ? 'border-l-green-500' : overall >= 50 ? 'border-l-yellow-500' : 'border-l-red-500';

  return (
    <div className={`rounded-xl border border-border bg-card p-4 border-l-4 ${borderColor}`}>
      <p className="text-xs font-medium text-foreground">{feedback.summary}</p>
      {feedback.tips.length > 0 && (
        <ul className="mt-2 space-y-1.5">
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
        <div
          className={`h-full rounded-full ${color} transition-all duration-700 ease-out`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className={`text-[11px] font-bold tabular-nums w-7 text-right ${textColor}`}>{value}</span>
    </div>
  );
}
