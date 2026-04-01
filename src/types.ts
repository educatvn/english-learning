export interface VideoMeta {
  videoId: string
  title: string
  channelName: string
  thumbnailUrl: string
  addedAt: string
}

export interface Playlist {
  id: string
  name: string
  videoIds: string[]
  createdAt: string
  ownerId: string    // '' = system playlist (admin-created)
  isSystem: boolean  // visible to all users
  isPublic: boolean  // user-created but shared publicly
}

export interface QuizAttempt {
  userId: string
  videoId: string
  cueStartMs: number
  targetWord: string
  userAnswer: string
  correct: boolean
  answeredAt: string
}

export interface WatchSession {
  date: string     // YYYY-MM-DD
  seconds: number
}

export interface VideoNote {
  userId: string
  videoId: string
  positionMs: number
  text: string
  createdAt: string
}

export interface VideoProgress {
  userId: string
  videoId: string
  positionMs: number   // 0 = completed/reset; > 0 = in-progress position
  durationMs: number   // 0 = unknown
  updatedAt: string
}

/** True when a video has a saved position worth resuming */
export function isResumable(p: VideoProgress): boolean {
  if (p.positionMs <= 30_000) return false  // < 30 seconds — treat as not started
  if (p.durationMs > 0 && p.positionMs >= p.durationMs * 0.92) return false  // ≥ 92% — treat as done
  return true
}
