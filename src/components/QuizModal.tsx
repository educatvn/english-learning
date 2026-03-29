import { useState, useEffect, useRef } from 'react'
import { Check, X } from 'lucide-react'
import type { CaptionCue } from '@/utils/captionParser'
import type { QuizWord } from '@/utils/quizWord'
import { checkAnswer } from '@/utils/quizWord'

export interface QuizResult {
  correct: boolean
  userAnswer: string
}

interface Props {
  cue: CaptionCue
  quizWord: QuizWord
  /** Called with result when submitted, or null when skipped (Esc / outside click) */
  onClose: (result: QuizResult | null) => void
}

export function QuizModal({ cue, quizWord, onClose }: Props) {
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState<QuizResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Auto-close after showing "Correct!" result
  useEffect(() => {
    if (!result?.correct) return
    const t = setTimeout(() => onClose(result), 1400)
    return () => clearTimeout(t)
  }, [result, onClose])

  // Dismiss on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !result) onClose(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [result, onClose])

  function handleSubmit() {
    if (!answer.trim()) return
    setResult({ correct: checkAnswer(answer, quizWord), userAnswer: answer.trim() })
  }

  const before = cue.text.slice(0, quizWord.startIdx)
  const after = cue.text.slice(quizWord.endIdx)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !result) onClose(null) }}
    >
      <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Sentence with blank */}
        <div className="px-6 pt-6 pb-5">
          <p className="text-[11px] text-gray-500 font-semibold uppercase tracking-widest mb-3">
            Fill in the blank
          </p>
          <p className="text-lg text-gray-100 leading-relaxed">
            {before}
            {result ? (
              <span className={[
                'inline font-semibold px-1 rounded',
                result.correct
                  ? 'text-green-300'
                  : 'text-red-300',
              ].join(' ')}>
                {quizWord.word}
              </span>
            ) : (
              <span className="inline-block border-b-2 border-blue-400 min-w-[4ch] text-center text-blue-400 font-semibold mx-0.5">
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
              </span>
            )}
            {after}
          </p>
        </div>

        {/* Result banner */}
        {result && (
          <div className={[
            'mx-5 mb-5 rounded-xl px-4 py-3 flex items-start gap-3',
            result.correct
              ? 'bg-green-500/10 border border-green-500/25'
              : 'bg-red-500/10 border border-red-500/25',
          ].join(' ')}>
            {result.correct ? (
              <>
                <Check className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                <p className="text-sm font-semibold text-green-400">Correct!</p>
              </>
            ) : (
              <>
                <X className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-400">Incorrect</p>
                  <p className="text-xs text-gray-400 mt-1">
                    You answered: <span className="text-white font-medium">{result.userAnswer}</span>
                    <span className="mx-1.5 text-gray-600">·</span>
                    Correct word: <span className="text-white font-medium">{quizWord.word}</span>
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Input row (hidden after result) */}
        {!result && (
          <div className="px-5 pb-5 flex gap-2">
            <input
              ref={inputRef}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
              placeholder="Type the missing word…"
              className="flex-1 h-10 rounded-xl bg-gray-800 border border-gray-700 px-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              onClick={handleSubmit}
              disabled={!answer.trim()}
              className="h-10 px-5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-40 transition-colors shrink-0"
            >
              Check
            </button>
          </div>
        )}

        {/* "Got it" button for incorrect result */}
        {result && !result.correct && (
          <div className="px-5 pb-5">
            <button
              onClick={() => onClose(result)}
              className="w-full h-9 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 font-medium transition-colors"
            >
              Got it
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
