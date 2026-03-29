export interface SubtitleCue {
  start: number;     // seconds
  duration: number;  // seconds
  text: string;
}

export interface VideoInfo {
  videoId: string;
  title: string;
}

export interface SavedSubtitle {
  videoId: string;
  title: string;
  languageCode: string;
  languageName: string;
  kind: string;
  fetchedAt: string;
  cues: SubtitleCue[];
}

export const COMMON_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ru', name: 'Russian' },
  { code: 'hi', name: 'Hindi' },
]

export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ]
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  return null
}

// Lấy title từ YouTube oEmbed — API public, không cần auth
export async function fetchVideoInfo(url: string): Promise<VideoInfo> {
  const videoId = extractVideoId(url)
  if (!videoId) throw new Error('URL YouTube không hợp lệ')

  let title = videoId
  try {
    const res = await fetch(
      `/youtube-proxy/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
    )
    if (res.ok) {
      const data = await res.json()
      title = (data.title as string | undefined) ?? videoId
    }
  } catch {
    // title không quan trọng, fallback về videoId
  }

  return { videoId, title }
}

// Thử 2 kiểu subtitle: auto-generated (asr) và manual, lấy cái nào có data
export async function fetchSubtitleContent(
  videoInfo: VideoInfo,
  languageCode: string,
  languageName: string,
): Promise<SavedSubtitle> {
  const kinds = [
    { kind: 'asr', label: 'asr' },
    { kind: '',    label: 'manual' },
  ]

  for (const { kind, label } of kinds) {
    const params = new URLSearchParams({
      v: videoInfo.videoId,
      lang: languageCode,
      fmt: 'json3',
    })
    if (kind) params.set('kind', kind)

    let res: Response
    try {
      res = await fetch(`/youtube-proxy/api/timedtext?${params.toString()}`)
    } catch {
      continue
    }

    if (!res.ok) continue

    let data: Record<string, unknown>
    try {
      data = await res.json()
    } catch {
      continue
    }

    const events = (data.events as Array<Record<string, unknown>> | undefined) ?? []
    const cues: SubtitleCue[] = events
      .filter((e) => Array.isArray(e.segs))
      .map((e) => ({
        start: (e.tStartMs as number) / 1000,
        duration: ((e.dDurationMs as number | undefined) ?? 0) / 1000,
        text: (e.segs as Array<{ utf8?: string }>)
          .map((s) => s.utf8 ?? '')
          .join('')
          .replace(/\n/g, ' ')
          .trim(),
      }))
      .filter((c) => c.text)

    if (cues.length === 0) continue

    return {
      videoId: videoInfo.videoId,
      title: videoInfo.title,
      languageCode,
      languageName,
      kind: label,
      fetchedAt: new Date().toISOString(),
      cues,
    }
  }

  throw new Error(
    `Không tìm thấy subtitle "${languageName}" cho video này. Video có thể không có subtitle ngôn ngữ này.`,
  )
}

// Fetch raw JSON3 caption data (word-level timing preserved)
export async function fetchRawJSON3(
  videoId: string,
  languageCode: string,
): Promise<Record<string, unknown>> {
  const kinds = [{ kind: 'asr' }, { kind: '' }]

  for (const { kind } of kinds) {
    const params = new URLSearchParams({ v: videoId, lang: languageCode, fmt: 'json3' })
    if (kind) params.set('kind', kind)

    let res: Response
    try {
      res = await fetch(`/youtube-proxy/api/timedtext?${params.toString()}`)
    } catch {
      continue
    }
    if (!res.ok) continue

    let data: Record<string, unknown>
    try {
      data = await res.json()
    } catch {
      continue
    }

    const events = data.events as Array<Record<string, unknown>> | undefined
    if (events?.some((e) => Array.isArray(e['segs']))) return data
  }

  throw new Error(`Không tìm thấy caption JSON3 cho "${languageCode}"`)
}

// --- localStorage helpers ---

const STORAGE_KEY = 'el_saved_subtitles'

export function loadSavedSubtitles(): SavedSubtitle[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as SavedSubtitle[]
  } catch {
    return []
  }
}

export function saveSubtitle(subtitle: SavedSubtitle): void {
  const existing = loadSavedSubtitles()
  const idx = existing.findIndex(
    (s) => s.videoId === subtitle.videoId && s.languageCode === subtitle.languageCode,
  )
  if (idx >= 0) existing[idx] = subtitle
  else existing.unshift(subtitle)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
}
