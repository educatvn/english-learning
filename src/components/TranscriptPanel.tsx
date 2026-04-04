import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import type { CaptionCue, CaptionParagraph } from '@/utils/captionParser'
import { pickQuizWord, maskText } from '@/utils/quizWord'

interface Props {
  paragraphs: CaptionParagraph[]
  currentMs: number
  onCueClick: (cue: CaptionCue) => void
  onParagraphSeek: (ms: number) => void
  quizMode?: boolean
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function TranscriptPanel({ paragraphs, currentMs, onCueClick, onParagraphSeek, quizMode }: Props) {
  const [hoveredMs, setHoveredMs] = useState<number | null>(null)
  const activeParagraphRef = useRef<HTMLDivElement>(null)

  // Find active cue by time
  const activeCue = paragraphs
    .flatMap((p) => p.cues)
    .find((c) => currentMs >= c.startMs && currentMs < c.endMs) ?? null

  const activeParagraphIdx = paragraphs.findIndex((p) =>
    p.cues.some((c) => currentMs >= c.startMs && currentMs < c.endMs),
  )

  // Auto-scroll active paragraph into view
  useEffect(() => {
    activeParagraphRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [activeParagraphIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  if (paragraphs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading captions…</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-7">
      {paragraphs.map((para, pi) => {
        const isActiveParagraph = pi === activeParagraphIdx

        return (
          <div key={para.startMs} ref={isActiveParagraph ? activeParagraphRef : null}>
            {/* Timestamp — click to seek to paragraph start */}
            <button
              onClick={() => onParagraphSeek(para.startMs)}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded border border-border text-[11px] font-mono text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 mb-2.5 transition-colors"
            >
              <Play className="w-3 h-3" />
              {formatTime(para.startMs)}
            </button>

            {/* Paragraph — inline cue spans */}
            <p className="text-sm leading-loose text-foreground/75 select-text">
              {para.cues.map((cue) => {
                const isActive = activeCue?.startMs === cue.startMs
                const isHovered = hoveredMs === cue.startMs && !isActive
                const qw = quizMode ? pickQuizWord(cue.text) : null
                const display = qw ? maskText(cue.text, qw) : cue.text

                return (
                  <span
                    key={cue.startMs}
                    onMouseEnter={() => setHoveredMs(cue.startMs)}
                    onMouseLeave={() => setHoveredMs(null)}
                    onClick={() => onCueClick(cue)}
                    className={[
                      'cursor-pointer rounded px-0.5 -mx-0.5 transition-colors duration-100',
                      isActive
                        ? 'bg-amber-400/35 text-foreground font-medium'
                        : isHovered
                        ? 'bg-accent text-foreground'
                        : '',
                    ].join(' ')}
                  >
                    {display}{' '}
                  </span>
                )
              })}
            </p>
          </div>
        )
      })}
    </div>
  )
}
