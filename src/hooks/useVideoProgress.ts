import { useEffect, useRef, useState, useCallback } from 'react'
import { getVideoProgress, saveVideoProgress } from '@/services/googleSheets'
import { isResumable } from '@/types'
import type { VideoProgress } from '@/types'

/**
 * Tracks video playback position and persists it to Google Sheets for resume.
 *
 * - Loads saved position on mount; returns it via `resumePositionMs` if resumable.
 * - Saves position every 15 s during playback, on pause, on tab hide, and on unmount.
 * - On `onEnded`, writes positionMs = 0 to mark the video completed (no future resume).
 *
 * Usage:
 *   const vp = useVideoProgress(user?.sub, videoId)
 *   <ReactPlayer
 *     onTimeUpdate={(e) => vp.onTimeUpdate(e.currentTarget.currentTime * 1000, e.currentTarget.duration * 1000)}
 *     onPlay={vp.onPlay}
 *     onPause={vp.onPause}
 *     onEnded={vp.onEnded}
 *   />
 *   {vp.resumePositionMs && <ResumeBanner positionMs={vp.resumePositionMs} onResume={...} onDismiss={...} />}
 */
export function useVideoProgress(
  userId: string | undefined,
  videoId: string | undefined,
) {
  const [resumePositionMs, setResumePositionMs] = useState<number | null>(null)
  const [isLoadingResume, setIsLoadingResume] = useState(false)

  const currentMsRef = useRef(0)
  const durationMsRef = useRef(0)
  const isPlayingRef = useRef(false)
  const lastSavedMsRef = useRef(-1)

  // ── Load saved position on video change ────────────────────────────────────
  useEffect(() => {
    setResumePositionMs(null)
    currentMsRef.current = 0
    durationMsRef.current = 0
    lastSavedMsRef.current = -1

    if (!userId || !videoId) return
    setIsLoadingResume(true)
    getVideoProgress(userId, videoId)
      .then((p) => { if (p && isResumable(p)) setResumePositionMs(p.positionMs) })
      .catch(console.error)
      .finally(() => setIsLoadingResume(false))
  }, [userId, videoId])

  // ── Helpers (inline per-effect, matching useWatchTime pattern) ─────────────
  function buildProgress(uid: string, vid: string): VideoProgress | null {
    const posMs = currentMsRef.current
    if (posMs < 5_000) return null  // ignore if barely started
    if (posMs === lastSavedMsRef.current) return null  // no change
    lastSavedMsRef.current = posMs
    return { userId: uid, videoId: vid, positionMs: posMs, durationMs: durationMsRef.current, updatedAt: new Date().toISOString() }
  }

  // ── Callbacks ──────────────────────────────────────────────────────────────
  const onTimeUpdate = useCallback((posMs: number, durMs: number) => {
    currentMsRef.current = posMs
    if (durMs > 0) durationMsRef.current = durMs
  }, [])

  const onPlay = useCallback(() => {
    isPlayingRef.current = true
  }, [])

  const onPause = useCallback(() => {
    isPlayingRef.current = false
    if (!userId || !videoId) return
    const p = buildProgress(userId, videoId)
    if (p) void saveVideoProgress(p)
  }, [userId, videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  const onEnded = useCallback(() => {
    isPlayingRef.current = false
    if (!userId || !videoId) return
    // positionMs = 0 signals "completed" — no resume will be offered
    void saveVideoProgress({
      userId,
      videoId,
      positionMs: 0,
      durationMs: durationMsRef.current,
      updatedAt: new Date().toISOString(),
    })
  }, [userId, videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Periodic save every 15 s while playing ─────────────────────────────────
  useEffect(() => {
    if (!userId || !videoId) return
    const uid = userId, vid = videoId
    const id = setInterval(() => {
      if (!isPlayingRef.current) return
      const p = buildProgress(uid, vid)
      if (p) void saveVideoProgress(p)
    }, 15_000)
    return () => clearInterval(id)
  }, [userId, videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save on tab hide ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId || !videoId) return
    const uid = userId, vid = videoId
    function onHide() {
      if (!document.hidden) return
      const p = buildProgress(uid, vid)
      if (p) void saveVideoProgress(p)
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [userId, videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save on video change / unmount ─────────────────────────────────────────
  useEffect(() => {
    const uid = userId, vid = videoId
    return () => {
      if (!uid || !vid) return
      const p = buildProgress(uid, vid)
      if (p) void saveVideoProgress(p)
    }
  }, [userId, videoId]) // eslint-disable-line react-hooks/exhaustive-deps

  return { resumePositionMs, isLoadingResume, onTimeUpdate, onPlay, onPause, onEnded }
}
