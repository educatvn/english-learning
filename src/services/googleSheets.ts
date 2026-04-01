import type { Playlist, VideoMeta, QuizAttempt, WatchSession, VideoProgress, VideoNote } from '@/types'

const SCRIPT_URL = (import.meta.env.VITE_GOOGLE_SCRIPT_URL as string | undefined)?.trim() ?? ''

export function isConfigured(): boolean {
  return SCRIPT_URL.length > 0
}

type GASResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string }

async function gas<T>(action: string, data?: unknown): Promise<T> {
  const res = await fetch(SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, data }),
  })
  const text = await res.text()
  const json = JSON.parse(text) as GASResponse<T>
  if (!json.ok) throw new Error((json as { ok: false; error: string }).error)
  return (json as { ok: true; data: T }).data
}

// ── Playlists ────────────────────────────────────────────────────────────────

/** Returns system playlists + playlists owned by userId + public playlists */
export async function getPlaylists(userId: string): Promise<Playlist[]> {
  return gas<Playlist[]>('getPlaylists', { userId })
}

export async function upsertPlaylist(playlist: Playlist): Promise<void> {
  await gas('upsertPlaylist', playlist)
}

export async function removePlaylist(id: string): Promise<void> {
  await gas('deletePlaylist', { id })
}

// ── Videos ───────────────────────────────────────────────────────────────────

export async function getVideos(): Promise<VideoMeta[]> {
  return gas<VideoMeta[]>('getVideos')
}

export async function getVideosPaged(offset: number, limit: number): Promise<{ videos: VideoMeta[]; total: number }> {
  return gas<{ videos: VideoMeta[]; total: number }>('getVideosPaged', { offset, limit })
}

export interface SearchResult {
  videos: VideoMeta[]
  playlists: Playlist[]
}

export async function searchContent(query: string, userId: string): Promise<SearchResult> {
  return gas<SearchResult>('searchContent', { query, userId })
}

export async function upsertVideo(video: VideoMeta): Promise<void> {
  await gas('upsertVideo', video)
}

// ── Quiz results ──────────────────────────────────────────────────────────────

export async function saveQuizAttempt(attempt: QuizAttempt): Promise<void> {
  await gas('saveQuizAttempt', attempt)
}

// ── Watch time ────────────────────────────────────────────────────────────────

export async function incrementWatchTime(data: {
  userId: string
  seconds: number
  date: string
}): Promise<void> {
  await gas('incrementWatchTime', data)
}

// ── Progress data ─────────────────────────────────────────────────────────────

export interface ProgressData {
  sessions: WatchSession[]
  quizzes: QuizAttempt[]
}

export async function getProgressData(userId: string): Promise<ProgressData> {
  return gas<ProgressData>('getProgressData', { userId })
}


// ── Video progress (resume) ───────────────────────────────────────────────────

export async function saveVideoProgress(progress: VideoProgress): Promise<void> {
  await gas('saveVideoProgress', progress)
}

export async function getVideoProgress(userId: string, videoId: string): Promise<VideoProgress | null> {
  return gas<VideoProgress | null>('getVideoProgress', { userId, videoId })
}

export async function getRecentProgress(userId: string, limit = 10): Promise<VideoProgress[]> {
  return gas<VideoProgress[]>('getRecentProgress', { userId, limit })
}

// ── Video notes ───────────────────────────────────────────────────────────────

export async function saveNote(note: VideoNote): Promise<void> {
  await gas('saveNote', note)
}

export async function getNotesForVideo(userId: string, videoId: string): Promise<VideoNote[]> {
  return gas<VideoNote[]>('getNotesForVideo', { userId, videoId })
}

export async function deleteNote(userId: string, createdAt: string): Promise<void> {
  await gas('deleteNote', { userId, createdAt })
}

export interface NoteWithMeta extends VideoNote {
  videoTitle: string
  videoThumbnailUrl: string
}

export interface NoteSearchResult {
  notes: NoteWithMeta[]
  total: number
}

export async function searchNotes(
  userId: string,
  query: string,
  offset: number,
  limit: number,
): Promise<NoteSearchResult> {
  return gas<NoteSearchResult>('searchNotes', { userId, query, offset, limit })
}
