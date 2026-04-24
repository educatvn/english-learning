import { useEffect, useRef, useState } from 'react'
import { Play, ArrowDownToLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  const containerRef = useRef<HTMLDivElement>(null)
  const activeParagraphRef = useRef<HTMLDivElement>(null)
  const [isOutOfSync, setIsOutOfSync] = useState(false)
  const suppressScrollEventRef = useRef(false)
  const suppressTimerRef = useRef<number | null>(null)

  // Find active cue by time
  const activeCue = paragraphs
    .flatMap((p) => p.cues)
    .find((c) => currentMs >= c.startMs && currentMs < c.endMs) ?? null

  const activeParagraphIdx = paragraphs.findIndex((p) =>
    p.cues.some((c) => currentMs >= c.startMs && currentMs < c.endMs),
  )

  function scrollToActive() {
    const container = containerRef.current
    const target = activeParagraphRef.current
    if (!container || !target) return
    // Suppress scroll-event handling while the smooth scroll is in progress
    suppressScrollEventRef.current = true
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current)
    suppressTimerRef.current = window.setTimeout(() => {
      suppressScrollEventRef.current = false
    }, 700)
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setIsOutOfSync(false)
  }

  // Auto-scroll active paragraph to top — but only while user hasn't scrolled away
  useEffect(() => {
    if (!isOutOfSync) scrollToActive()
  }, [activeParagraphIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // Detect manual user scrolling that takes the active paragraph out of view.
  // Re-run when paragraphs first arrive so the listener attaches to the real container.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => {
      if (suppressScrollEventRef.current) return
      const target = activeParagraphRef.current
      if (!target) {
        setIsOutOfSync(false)
        return
      }
      const cRect = el.getBoundingClientRect()
      const tRect = target.getBoundingClientRect()
      const inView = tRect.bottom > cRect.top + 4 && tRect.top < cRect.bottom - 4
      setIsOutOfSync(!inView)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [paragraphs.length])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current)
    }
  }, [])

  if (paragraphs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading captions…</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col relative min-h-0">
      {/* Floating "jump to current" button — visible when user scrolls away from active */}
      {isOutOfSync && (
        <Button
          variant="default"
          size="sm"
          onClick={scrollToActive}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-10 gap-1.5 rounded-full shadow-lg"
        >
          <ArrowDownToLine className="w-3 h-3" />
          Jump to current
        </Button>
      )}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-7">
      {paragraphs.map((para, pi) => {
        const isActiveParagraph = pi === activeParagraphIdx

        return (
          <div key={para.startMs} ref={isActiveParagraph ? activeParagraphRef : null}>
            {/* Timestamp — click to seek to paragraph start */}
            <Button
              variant="outline"
              size="xs"
              onClick={() => onParagraphSeek(para.startMs)}
              className="gap-1.5 px-2 py-0.5 text-[11px] font-mono text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 mb-2.5"
            >
              <Play className="w-3 h-3" />
              {formatTime(para.startMs)}
            </Button>

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
    </div>
  )
}
