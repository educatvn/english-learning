import type { VocabEntry } from '@/types'
import { gas } from './googleSheets'

export interface DictionaryDefinition {
  definition: string
  example?: string
  synonyms?: string[]
  antonyms?: string[]
}

export interface DictionaryMeaning {
  partOfSpeech: string
  definitions: DictionaryDefinition[]
}

export interface DictionaryEntry {
  word: string
  phonetic: string
  audioUrl: string
  origin: string
  meanings: DictionaryMeaning[]
}

interface RawDictApiResponse {
  word: string
  phonetic?: string
  phonetics?: Array<{ text?: string; audio?: string }>
  origin?: string
  meanings: Array<{
    partOfSpeech: string
    definitions: Array<{
      definition: string
      example?: string
      synonyms?: string[]
      antonyms?: string[]
    }>
  }>
}

/** Fetch a rich dictionary entry. Returns null if not found / API error. */
export async function fetchDictionaryEntry(word: string): Promise<DictionaryEntry | null> {
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
    )
    if (!res.ok) return null
    const data = (await res.json()) as RawDictApiResponse[]
    if (!Array.isArray(data) || data.length === 0) return null

    // Merge entries: dictionaryapi sometimes returns multiple objects for the
    // same word (different etymologies). Take the first for headword/origin
    // and merge phonetics/meanings across all of them so the user sees more.
    const first = data[0]
    const allPhonetics = data.flatMap((d) => d.phonetics ?? [])
    const phoneticText =
      first.phonetic ??
      allPhonetics.find((p) => p.text)?.text ??
      ''
    const audioUrl = allPhonetics.find((p) => p.audio && p.audio.length > 0)?.audio ?? ''

    const meanings: DictionaryMeaning[] = data.flatMap((d) =>
      (d.meanings ?? []).map((m) => ({
        partOfSpeech: m.partOfSpeech,
        definitions: (m.definitions ?? []).map((def) => ({
          definition: def.definition,
          example: def.example,
          synonyms: def.synonyms,
          antonyms: def.antonyms,
        })),
      })),
    )

    return {
      word: first.word ?? word,
      phonetic: phoneticText,
      audioUrl,
      origin: first.origin ?? '',
      meanings,
    }
  } catch {
    return null
  }
}

/** Backwards-compatible helper: fetch a single short definition string. */
export async function fetchDefinition(word: string): Promise<string> {
  const entry = await fetchDictionaryEntry(word)
  return entry?.meanings[0]?.definitions[0]?.definition ?? ''
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
