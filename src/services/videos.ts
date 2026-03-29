import type { VideoMeta } from '@/types'
import * as gs from '@/services/googleSheets'

export async function loadVideos(): Promise<VideoMeta[]> {
  const data = await gs.getVideos()
  return [...data].reverse() // Sheets appends oldest-first, show newest first
}

export async function saveVideo(video: VideoMeta): Promise<void> {
  await gs.upsertVideo(video)
}

export async function saveCaptions(
  videoId: string,
  captions: Record<string, unknown>,
): Promise<void> {
  const res = await fetch('/api/save-captions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId, captions }),
  })
  if (!res.ok) throw new Error('Failed to save captions file')
}
