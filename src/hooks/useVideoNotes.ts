import { useEffect, useState, useCallback } from 'react'
import { getNotesForVideo, saveNote, deleteNote } from '@/services/googleSheets'
import type { VideoNote } from '@/types'

export function useVideoNotes(userId: string | undefined, videoId: string | undefined) {
  const [notes, setNotes] = useState<VideoNote[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setNotes([])
    if (!userId || !videoId) return
    setLoading(true)
    getNotesForVideo(userId, videoId)
      .then(setNotes)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [userId, videoId])

  const addNote = useCallback(async (positionMs: number, text: string) => {
    if (!userId || !videoId || !text.trim()) return
    const note: VideoNote = {
      userId,
      videoId,
      positionMs,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    }
    // Optimistic update — insert sorted by positionMs
    setNotes((prev) =>
      [...prev, note].sort((a, b) => a.positionMs - b.positionMs),
    )
    await saveNote(note)
  }, [userId, videoId])

  const removeNote = useCallback(async (createdAt: string) => {
    if (!userId) return
    setNotes((prev) => prev.filter((n) => n.createdAt !== createdAt))
    await deleteNote(userId, createdAt)
  }, [userId])

  return { notes, loading, addNote, removeNote }
}
