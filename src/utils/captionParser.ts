interface JSON3Segment {
  utf8?: string
  tOffsetMs?: number
  acAsrConf?: number
}

interface JSON3Event {
  tStartMs: number
  dDurationMs?: number
  wWinId?: number
  aAppend?: number
  segs?: JSON3Segment[]
  id?: number
}

interface JSON3Data {
  events?: JSON3Event[]
}

export interface CaptionWord {
  text: string
  startMs: number
  endMs: number
}

export interface CaptionSentence {
  id: number
  text: string
  startMs: number
  endMs: number
  words: CaptionWord[]
}

export interface CaptionCue {
  text: string
  startMs: number
  endMs: number
}

// Join words into text, inserting a space before any word that lacks a leading space
// (first word of each event line has no leading space in YouTube JSON3 format)
function buildSentenceText(words: CaptionWord[]): string {
  if (words.length === 0) return ''
  let text = words[0].text
  for (let i = 1; i < words.length; i++) {
    const w = words[i].text
    if (!w.startsWith(' ')) {
      text += ' ' + w
    } else {
      text += w
    }
  }
  return text.trim()
}

export function parseJSON3(data: JSON3Data): {
  sentences: CaptionSentence[]
  cues: CaptionCue[]
} {
  const events = data.events ?? []

  // Extract all words with absolute timing (intra-event endMs only)
  const allWords: CaptionWord[] = []

  for (const event of events) {
    if (!event.segs) continue
    const segs = event.segs
    const eventEnd = event.tStartMs + (event.dDurationMs ?? 3000)

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]
      if (!seg.utf8 || seg.utf8 === '\n') continue

      const wordStart = event.tStartMs + (seg.tOffsetMs ?? 0)

      // End time = next non-newline segment's start within this event, or event end
      let wordEnd = eventEnd
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[j].utf8 && segs[j].utf8 !== '\n' && segs[j].tOffsetMs !== undefined) {
          wordEnd = event.tStartMs + segs[j].tOffsetMs!
          break
        }
      }

      allWords.push({ text: seg.utf8, startMs: wordStart, endMs: wordEnd })
    }
  }

  // Post-process: cap each word's endMs at the next word's startMs to fix
  // last-word-of-event endMs being incorrectly set to the event's total duration
  for (let i = 0; i < allWords.length - 1; i++) {
    allWords[i].endMs = Math.min(allWords[i].endMs, allWords[i + 1].startMs)
  }

  // Group words into sentences by sentence-ending punctuation
  const sentences: CaptionSentence[] = []
  let currentWords: CaptionWord[] = []

  for (const word of allWords) {
    currentWords.push(word)

    // Check if this word ends a sentence
    if (/[.?!]["']?\s*$/.test(word.text)) {
      const text = buildSentenceText(currentWords)
      if (text.length > 3) {
        sentences.push({
          id: sentences.length,
          text,
          startMs: currentWords[0].startMs,
          endMs: currentWords[currentWords.length - 1].endMs,
          words: [...currentWords],
        })
        currentWords = []
      }
    }
  }

  // Flush remaining words as last sentence
  if (currentWords.length > 0) {
    const text = buildSentenceText(currentWords)
    if (text) {
      sentences.push({
        id: sentences.length,
        text,
        startMs: currentWords[0].startMs,
        endMs: currentWords[currentWords.length - 1].endMs,
        words: [...currentWords],
      })
    }
  }

  // Build display cues: only content events (skip newline-only separators)
  // endMs = start of NEXT content event, not tStartMs + dDurationMs
  // dDurationMs is screen display duration (overlapping 2-line window), not spoken duration
  const contentEvents = events.filter((e) => {
    if (!e.segs) return false
    return e.segs.some((s) => s.utf8 && s.utf8 !== '\n')
  })

  const cues: CaptionCue[] = contentEvents.map((e, i) => {
    const text = (e.segs ?? [])
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\n/g, ' ')
      .trim()

    const startMs = e.tStartMs
    const nextEvent = contentEvents[i + 1]
    // Use next line's start as end — this is the actual spoken duration
    const endMs = nextEvent ? nextEvent.tStartMs : startMs + (e.dDurationMs ?? 3000)

    return { text, startMs, endMs }
  }).filter((c) => c.text)

  return { sentences, cues }
}

export function findActiveCue(cues: CaptionCue[], currentMs: number): CaptionCue | null {
  // Find last cue that has started and not expired
  let active: CaptionCue | null = null
  for (const cue of cues) {
    if (currentMs >= cue.startMs && currentMs < cue.endMs) {
      active = cue
    }
  }
  return active
}

export function findActiveSentence(
  sentences: CaptionSentence[],
  currentMs: number,
): CaptionSentence | null {
  for (const sentence of sentences) {
    if (currentMs >= sentence.startMs && currentMs <= sentence.endMs) {
      return sentence
    }
  }
  return null
}
