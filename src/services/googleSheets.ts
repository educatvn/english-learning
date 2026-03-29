import type { Playlist, VideoMeta } from '@/types'

// Set VITE_GOOGLE_SCRIPT_URL in .env.local to enable Google Sheets sync
const SCRIPT_URL = (import.meta.env.VITE_GOOGLE_SCRIPT_URL as string | undefined)?.trim() ?? ''

export function isConfigured(): boolean {
  return SCRIPT_URL.length > 0
}

type GASResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string }

// All requests use POST with text/plain to avoid CORS preflight.
// GET requests drop query params after Google's 302 redirect, so we use POST for reads too.
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

export async function getPlaylists(): Promise<Playlist[]> {
  return gas<Playlist[]>('getPlaylists')
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

export async function upsertVideo(video: VideoMeta): Promise<void> {
  await gas('upsertVideo', video)
}
