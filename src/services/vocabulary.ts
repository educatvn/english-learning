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
