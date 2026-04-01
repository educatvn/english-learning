import { useEffect, useRef, useCallback } from 'react'
import { incrementWatchTime } from '@/services/googleSheets'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

/**
 * Tracks actual video playback time and batches updates to Google Sheets every 10 seconds.
 * Also flushes on video change, page unmount, and tab hide.
 *
 * Usage:
 *   const { onPlay, onPause } = useWatchTime(user?.sub, videoId)
 *   <ReactPlayer onPlay={onPlay} onPause={onPause} ... />
 */
export function useWatchTime(userId: string | undefined) {
  const playStartRef = useRef<number | null>(null)
  const pendingRef = useRef(0)

  function captureElapsed() {
    if (playStartRef.current !== null) {
      const now = Date.now()
      pendingRef.current += (now - playStartRef.current) / 1000
      playStartRef.current = now
    }
  }

  function flushPending(uid: string) {
    const secs = Math.floor(pendingRef.current)
    if (secs < 1) return
    pendingRef.current -= secs
    void incrementWatchTime({ userId: uid, seconds: secs, date: todayStr() })
  }

  const onPlay = useCallback(() => {
    playStartRef.current = Date.now()
  }, [])

  const onPause = useCallback(() => {
    if (playStartRef.current !== null) {
      pendingRef.current += (Date.now() - playStartRef.current) / 1000
      playStartRef.current = null
    }
  }, [])

  // Periodic flush every 10 seconds
  useEffect(() => {
    if (!userId) return
    const uid = userId
    const id = setInterval(() => {
      captureElapsed()
      flushPending(uid)
    }, 10_000)
    return () => clearInterval(id)
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush on unmount
  useEffect(() => {
    const uid = userId
    return () => {
      if (!uid) return
      if (playStartRef.current !== null) {
        pendingRef.current += (Date.now() - playStartRef.current) / 1000
        playStartRef.current = null
      }
      const secs = Math.floor(pendingRef.current)
      pendingRef.current = 0
      if (secs >= 1) {
        void incrementWatchTime({ userId: uid, seconds: secs, date: todayStr() })
      }
    }
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush when tab is hidden
  useEffect(() => {
    if (!userId) return
    const uid = userId
    function onVisibilityChange() {
      if (document.hidden) {
        captureElapsed()
        flushPending(uid)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  return { onPlay, onPause }
}
