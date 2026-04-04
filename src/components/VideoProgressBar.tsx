import { useRef, useState, useEffect } from 'react'
import type { VideoNote } from '@/types'

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

interface Props {
  currentMs: number
  durationMs: number
  notes: VideoNote[]
  onSeek: (ms: number) => void
}

export function VideoProgressBar({ currentMs, durationMs, notes, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const [hoverMs, setHoverMs] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const pct = durationMs > 0 ? Math.min((currentMs / durationMs) * 100, 100) : 0

  function msFromClientX(clientX: number): number {
    if (!trackRef.current || durationMs <= 0) return 0
    const rect = trackRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    return Math.round((x / rect.width) * durationMs)
  }

  function startDrag(clientX: number) {
    isDraggingRef.current = true
    setIsDragging(true)
    onSeek(msFromClientX(clientX))
  }

  function endDrag() {
    isDraggingRef.current = false
    setIsDragging(false)
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (durationMs <= 0) return
    e.preventDefault()
    startDrag(e.clientX)

    function onMouseMove(ev: MouseEvent) {
      if (!isDraggingRef.current) return
      onSeek(msFromClientX(ev.clientX))
    }
    function onMouseUp() {
      endDrag()
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (durationMs <= 0) return
    e.preventDefault()
    startDrag(e.touches[0].clientX)
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!isDraggingRef.current) return
    e.preventDefault()
    onSeek(msFromClientX(e.touches[0].clientX))
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!isDraggingRef.current) return
    onSeek(msFromClientX(e.changedTouches[0].clientX))
    endDrag()
  }

  // Clean up on unmount
  useEffect(() => () => { isDraggingRef.current = false }, [])

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 bg-gray-900 border-t border-gray-800"
      style={{ height: 44 }}>

      {/* Elapsed */}
      <span className="text-[11px] font-mono text-gray-400 tabular-nums w-9 shrink-0 text-right">
        {fmtMs(currentMs)}
      </span>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative flex-1 group/track cursor-pointer select-none touch-none"
        style={{ height: 20 }}
        onMouseDown={handleMouseDown}
        onMouseMove={(e) => setHoverMs(msFromClientX(e.clientX))}
        onMouseLeave={() => !isDragging && setHoverMs(null)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Background rail */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-gray-700 transition-all duration-100"
          style={{ height: isDragging ? 6 : 4 }}>

          {/* Played fill */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-blue-500"
            style={{ width: `${pct}%` }}
          />

          {/* Note markers */}
          {durationMs > 0 && notes.map((note) => {
            const markerPct = Math.min((note.positionMs / durationMs) * 100, 100)
            return (
              <NoteMarker
                key={note.createdAt}
                pct={markerPct}
                text={note.text}
                positionMs={note.positionMs}
                onSeek={onSeek}
              />
            )
          })}

          {/* Playhead thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow-md transition-opacity"
            style={{
              left: `${pct}%`,
              opacity: isDragging || hoverMs !== null ? 1 : 0,
              transition: 'opacity 0.1s',
            }}
          />
        </div>

        {/* Hover / drag time tooltip */}
        {(hoverMs !== null || isDragging) && durationMs > 0 && (
          <div
            className="absolute bottom-full mb-2 -translate-x-1/2 bg-gray-900 border border-gray-700 text-white text-[10px] font-mono px-2 py-1 rounded pointer-events-none shadow-lg"
            style={{ left: `${((hoverMs ?? currentMs) / durationMs) * 100}%` }}
          >
            {fmtMs(hoverMs ?? currentMs)}
          </div>
        )}
      </div>

      {/* Duration */}
      <span className="text-[11px] font-mono text-gray-500 tabular-nums w-9 shrink-0">
        {durationMs > 0 ? fmtMs(durationMs) : '--:--'}
      </span>
    </div>
  )
}

// ─── NoteMarker ───────────────────────────────────────────────────────────────

function NoteMarker({ pct, text, positionMs, onSeek }: {
  pct: number
  text: string
  positionMs: number
  onSeek: (ms: number) => void
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
      style={{ left: `${pct}%` }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={(e) => { e.stopPropagation(); onSeek(positionMs) }}
    >
      {/* Dot */}
      <div className="w-2.5 h-2.5 rounded-full bg-yellow-400 border-2 border-yellow-300 cursor-pointer hover:scale-125 transition-transform shadow-sm" />

      {/* Tooltip */}
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-xl pointer-events-none">
          <p className="text-[10px] text-yellow-400 font-mono mb-1">{fmtMs(positionMs)}</p>
          <p className="text-xs text-gray-200 leading-relaxed line-clamp-3">{text}</p>
        </div>
      )}
    </div>
  )
}
