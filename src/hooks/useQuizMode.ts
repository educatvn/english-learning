import { useState, useRef, useCallback } from 'react'
import { pickQuizWord } from '@/utils/quizWord'
import type { QuizWord } from '@/utils/quizWord'
import type { CaptionCue } from '@/utils/captionParser'

export interface QuizState {
  cue: CaptionCue
  quizWord: QuizWord
}

/**
 * Encapsulates quiz-mode state and logic.
 * Uses refs internally so it integrates cleanly with useCallback handlers
 * that have empty deps arrays.
 */
export function useQuizMode() {
  const [quizMode, setQuizMode] = useState(false)
  const [quizState, setQuizState] = useState<QuizState | null>(null)

  // Refs — written before state updates so callbacks always see current values
  const quizModeRef = useRef(false)
  const quizWordRef = useRef<QuizWord | null>(null)
  const pinnedCueRef = useRef<CaptionCue | null>(null)

  function toggleQuizMode() {
    const next = !quizModeRef.current
    quizModeRef.current = next
    setQuizMode(next)
    if (!next) {
      quizWordRef.current = null
      setQuizState(null)
    }
  }

  /**
   * Call when user clicks a cue to play it.
   * Stable reference — safe to add to useCallback deps or omit (only uses refs).
   */
  const onCueStarted = useCallback((cue: CaptionCue) => {
    pinnedCueRef.current = cue
    quizWordRef.current = quizModeRef.current ? (pickQuizWord(cue.text) ?? null) : null
  }, [])

  /**
   * Call from handleTimeUpdate when cue playback ends.
   * Triggers the quiz modal if quiz mode is active.
   */
  const onCueEnded = useCallback(() => {
    if (quizModeRef.current && quizWordRef.current && pinnedCueRef.current) {
      setQuizState({ cue: pinnedCueRef.current, quizWord: quizWordRef.current })
    }
  }, [])

  function closeQuiz() {
    quizWordRef.current = null
    setQuizState(null)
  }

  return {
    quizMode,
    quizState,
    quizWordRef, // for reading in render (masked overlay)
    toggleQuizMode,
    onCueStarted,
    onCueEnded,
    closeQuiz,
  }
}
