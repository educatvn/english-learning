// Common English stop-words that are poor quiz targets
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'doing',
  'a', 'an', 'the',
  'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while',
  'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over',
  'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'when', 'where', 'why', 'how',
  'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'can', 'will', 'just', 'should', 'now', 'would', 'could', 'might',
  'must', 'shall', 'may', 'need',
  "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
  "won't", "wouldn't", "couldn't", "shouldn't", "haven't", "hasn't",
  "hadn't", "i'm", "i've", "i'll", "i'd", "let's", "that's", "there's",
  "here's", "it's", "he's", "she's", "they're", "we're", "you're",
  "they've", "we've", "you've",
])

export interface QuizWord {
  word: string     // the original word (preserves casing)
  startIdx: number // char index in the cue text
  endIdx: number
}

/**
 * Pick one "interesting" word to hide from a cue.
 * Deterministic — same cue always hides the same word.
 */
export function pickQuizWord(text: string): QuizWord | null {
  // Match word tokens: at least 3 alpha chars
  const matches = [...text.matchAll(/\b([a-zA-Z]{3,})\b/g)]
  const candidates = matches.filter((m) => !STOP_WORDS.has(m[1].toLowerCase()))

  if (candidates.length === 0) return null

  // Deterministic hash so same cue → same word
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0

  const picked = candidates[h % candidates.length]
  return {
    word: picked[1],
    startIdx: picked.index!,
    endIdx: picked.index! + picked[1].length,
  }
}

/** Replace the hidden word with a blank placeholder for the overlay */
export function maskText(text: string, q: QuizWord): string {
  return text.slice(0, q.startIdx) + '_____' + text.slice(q.endIdx)
}

/** Case-insensitive comparison (trims whitespace) */
export function checkAnswer(userAnswer: string, q: QuizWord): boolean {
  return userAnswer.trim().toLowerCase() === q.word.toLowerCase()
}
