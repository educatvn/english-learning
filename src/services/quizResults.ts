import type { QuizAttempt } from '@/types'
import * as gs from '@/services/googleSheets'

export type { QuizAttempt }

export async function saveQuizAttempt(attempt: QuizAttempt): Promise<void> {
  await gs.saveQuizAttempt(attempt)
}
