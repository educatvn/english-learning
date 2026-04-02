import type { VocabEntry } from '@/types'
import { gas } from './googleSheets'

export async function fetchDefinition(word: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
    )
    if (!res.ok) return ''
    const data = (await res.json()) as Array<{
      meanings: Array<{ partOfSpeech: string; definitions: Array<{ definition: string }> }>
    }>
    const def = data[0]?.meanings[0]?.definitions[0]?.definition ?? ''
    return def
  } catch {
    return ''
  }
}

export async function addVocabWord(entry: VocabEntry, userId: string): Promise<void> {
  await gas('addVocabWord', { userId, ...entry })
}

export async function getVocabWords(userId: string): Promise<VocabEntry[]> {
  return gas<VocabEntry[]>('getVocabWords', { userId })
}

export async function deleteVocabWord(userId: string, id: string): Promise<void> {
  await gas('deleteVocabWord', { userId, id })
}

// ── Caption search index ──────────────────────────────────────────────────────

/** Return all videoIds that have an entry in the caption index. */
export async function getIndexedVideoIds(): Promise<string[]> {
  return gas<string[]>('getIndexedVideoIds')
}

/** Store the unique word list for a video (called when a video is added). */
export async function indexVideoWords(videoId: string, words: string[]): Promise<void> {
  await gas('indexVideoWords', { videoId, words })
}

/** Return videoIds whose indexed word list contains the given word. */
export async function searchCaptionIndex(word: string): Promise<string[]> {
  return gas<string[]>('searchCaptionIndex', { word })
}
