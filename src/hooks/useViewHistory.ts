import { useRef } from 'react'
import { recordView } from '@/services/googleSheets'

/**
 * Records one view entry the first time playback actually starts.
 * Safe to call on every render — the ref ensures only one entry per mount.
 */
export function useViewHistory(userId: string | undefined, videoId: string | undefined) {
  const recordedRef = useRef(false)

  function onFirstPlay() {
    if (recordedRef.current || !userId || !videoId) return
    recordedRef.current = true
    void recordView({ userId, videoId, viewedAt: new Date().toISOString() })
  }

  return { onFirstPlay }
}
