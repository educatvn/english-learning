interface JSON3Segment {
  utf8?: string;
  tOffsetMs?: number;
  acAsrConf?: number;
}

interface JSON3Event {
  tStartMs: number;
  dDurationMs?: number;
  wWinId?: number;
  aAppend?: number;
  segs?: JSON3Segment[];
  id?: number;
}

interface JSON3Data {
  events?: JSON3Event[];
}

export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface CaptionSentence {
  id: number;
  text: string;
  startMs: number;
  endMs: number;
  words: CaptionWord[];
}

export interface CaptionCue {
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number; // original dDurationMs from event — used for real gap detection
}

// Join words into text, inserting a space before any word that lacks a leading space
// (first word of each event line has no leading space in YouTube JSON3 format)
function buildSentenceText(words: CaptionWord[]): string {
  if (words.length === 0) return '';
  let text = words[0].text;
  for (let i = 1; i < words.length; i++) {
    const w = words[i].text;
    if (!w.startsWith(' ')) {
      text += ' ' + w;
    } else {
      text += w;
    }
  }
  return text.trim();
}

export function parseJSON3(data: JSON3Data): {
  sentences: CaptionSentence[];
  cues: CaptionCue[];
} {
  const events = data.events ?? [];

  // Extract all words with absolute timing (intra-event endMs only)
  const allWords: CaptionWord[] = [];

  for (const event of events) {
    if (!event.segs) continue;
    const segs = event.segs;
    const eventEnd = event.tStartMs + (event.dDurationMs ?? 3000);

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!seg.utf8 || seg.utf8 === '\n') continue;

      const wordStart = event.tStartMs + (seg.tOffsetMs ?? 0);

      // End time = next non-newline segment's start within this event, or event end
      let wordEnd = eventEnd;
      for (let j = i + 1; j < segs.length; j++) {
        if (segs[j].utf8 && segs[j].utf8 !== '\n' && segs[j].tOffsetMs !== undefined) {
          wordEnd = event.tStartMs + segs[j].tOffsetMs!;
          break;
        }
      }

      allWords.push({ text: seg.utf8, startMs: wordStart, endMs: wordEnd });
    }
  }

  // Post-process: cap each word's endMs at the next word's startMs to fix
  // last-word-of-event endMs being incorrectly set to the event's total duration
  for (let i = 0; i < allWords.length - 1; i++) {
    allWords[i].endMs = Math.min(allWords[i].endMs, allWords[i + 1].startMs);
  }

  // Group words into sentences by sentence-ending punctuation
  const sentences: CaptionSentence[] = [];
  let currentWords: CaptionWord[] = [];

  for (const word of allWords) {
    currentWords.push(word);

    // Check if this word ends a sentence
    if (/[.?!]["']?\s*$/.test(word.text)) {
      const text = buildSentenceText(currentWords);
      if (text.length > 3) {
        sentences.push({
          id: sentences.length,
          text,
          startMs: currentWords[0].startMs,
          endMs: currentWords[currentWords.length - 1].endMs,
          words: [...currentWords],
        });
        currentWords = [];
      }
    }
  }

  // Flush remaining words as last sentence
  if (currentWords.length > 0) {
    const text = buildSentenceText(currentWords);
    if (text) {
      sentences.push({
        id: sentences.length,
        text,
        startMs: currentWords[0].startMs,
        endMs: currentWords[currentWords.length - 1].endMs,
        words: [...currentWords],
      });
    }
  }

  // Build display cues: only content events (skip newline-only separators)
  // endMs = start of NEXT content event, not tStartMs + dDurationMs
  // dDurationMs is screen display duration (overlapping 2-line window), not spoken duration
  const contentEvents = events.filter(e => {
    if (!e.segs) return false;
    return e.segs.some(s => s.utf8 && s.utf8 !== '\n');
  });

  const cues: CaptionCue[] = contentEvents
    .map((e, i) => {
      const text = (e.segs ?? [])
        .map(s => s.utf8 ?? '')
        .join('')
        .replace(/\n/g, ' ')
        .trim();

      const startMs = e.tStartMs;
      const durationMs = e.dDurationMs ?? 3000;
      const nextEvent = contentEvents[i + 1];
      const endMs = nextEvent ? nextEvent.tStartMs : startMs + durationMs;

      return { text, startMs, endMs, durationMs };
    })
    .filter(c => c.text);

  return { sentences, cues };
}

export function findActiveCue(cues: CaptionCue[], currentMs: number): CaptionCue | null {
  // Find last cue that has started and not expired
  let active: CaptionCue | null = null;
  for (const cue of cues) {
    if (currentMs >= cue.startMs && currentMs < cue.endMs) {
      active = cue;
    }
  }
  return active;
}

// ── Paragraph grouping ───────────────────────────────────────────────────────

export interface CaptionParagraph {
  cues: CaptionCue[];
  startMs: number;
  endMs: number;
}

const DISCOURSE_MARKERS = [
  'but',
  'however',
  'so',
  'now',
  'then',
  'and now',
  "let's",
  'moving on',
  'on the other hand',
  'meanwhile',
  'in contrast',
  'instead',
  'what if',
  'so what',
  "here's",
  'the problem is',
  'the point is',
  'according to',
  'for example',
];
const SENTENCE_END_RE = /[.!?]["']?\s*$/;
const CONTINUATION_WORDS = new Set(['and', 'or', 'because', 'so', 'but', 'to', 'of', 'in', 'for', 'with']);

// dDurationMs = subtitle display window (≈ interval to next cue), NOT actual pause duration.
// Real silence = interval - estimated spoken duration (word count × ms/word).
const MS_PER_WORD = 400; // ~150 wpm — slightly fast to avoid false breaks
const SILENCE_BREAK_MS = 1500; // real silence threshold to consider a paragraph break
const MAX_SENTENCES = 3; // hard cap for punctuated captions
const MAX_WORDS = 30; // hard word-count cap (safety net, any caption type)

// Auto-generated captions (e.g. YouTube ASR) have no punctuation.
// Detect by checking whether fewer than 10% of cues end with sentence punctuation.
function isAutogenCaptions(cues: CaptionCue[]): boolean {
  if (cues.length < 5) return false;
  const withPunct = cues.filter(c => SENTENCE_END_RE.test(c.text.trim())).length;
  return withPunct / cues.length < 0.1;
}

function wordCount(cues: CaptionCue[]): number {
  return cues.reduce((sum, c) => sum + c.text.trim().split(/\s+/).length, 0);
}

function estimatedSilenceMs(cue: CaptionCue, nextStartMs: number): number {
  const wc = cue.text.trim().split(/\s+/).length;
  return nextStartMs - cue.startMs - wc * MS_PER_WORD;
}

export function groupCuesIntoParagraphs(cues: CaptionCue[]): CaptionParagraph[] {
  if (cues.length === 0) return [];

  const autogen = isAutogenCaptions(cues);

  const paragraphs: CaptionParagraph[] = [];
  let current: CaptionCue[] = [];
  let completeSentences = 0;
  let pendingBreak = false; // set when word cap exceeded; break at next sentence end

  function flush() {
    if (current.length === 0) return;
    paragraphs.push({ cues: current, startMs: current[0].startMs, endMs: current[current.length - 1].endMs });
    current = [];
    completeSentences = 0;
    pendingBreak = false;
  }

  function push(cue: CaptionCue) {
    current.push(cue);
    if (SENTENCE_END_RE.test(cue.text.trim())) completeSentences++;
  }

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (current.length === 0) {
      push(cue);
      continue;
    }

    const prev = current[current.length - 1];
    const silence = estimatedSilenceMs(prev, cue.startMs);
    const wc = wordCount(current);

    // ── Auto-generated captions (no punctuation) ──────────────────────────
    if (autogen) {
      // Long enough paragraph + any real pause → break
      if (wc >= 25 && silence >= SILENCE_BREAK_MS) {
        flush();
        push(cue);
        continue;
      }
      // Large silence regardless of length
      if (silence >= 2500) {
        flush();
        push(cue);
        continue;
      }
      // Hard word cap
      if (wc >= MAX_WORDS) {
        flush();
        push(cue);
        continue;
      }
      push(cue);
      continue;
    }

    // ── Punctuated captions ───────────────────────────────────────────────
    const prevEndsSentence = SENTENCE_END_RE.test(prev.text.trim());
    const currLower = cue.text.toLowerCase().trimStart();
    const currStartsDiscourse = DISCOURSE_MARKERS.some(m => currLower.startsWith(m + ' ') || currLower.startsWith(m + ','));
    const currStartsContinuation = CONTINUATION_WORDS.has(currLower.split(/\s+/)[0] ?? '');

    // Never break on continuation word unless truly huge silence (> 5s)
    if (currStartsContinuation && silence < 5000) {
      push(cue);
      continue;
    }

    // Only break at sentence boundaries
    if (prevEndsSentence) {
      // Real pause → break
      if (silence >= SILENCE_BREAK_MS) {
        flush();
        push(cue);
        continue;
      }
      // Discourse marker with noticeable silence
      if (currStartsDiscourse && silence >= 500 && completeSentences >= 1) {
        flush();
        push(cue);
        continue;
      }
      // Hard sentence cap
      if (completeSentences >= MAX_SENTENCES) {
        flush();
        push(cue);
        continue;
      }
    }

    // Word cap: flag intent to break, then wait for next sentence boundary
    if (wc >= MAX_WORDS) pendingBreak = true;
    // Absolute safety net: break mid-sentence only if truly runaway (2× cap)
    if (wc >= MAX_WORDS * 2) {
      flush();
      push(cue);
      continue;
    }

    // Flush on sentence boundary if pending break
    if (pendingBreak && prevEndsSentence) {
      flush();
      push(cue);
      continue;
    }

    push(cue);
  }
  flush();
  return paragraphs;
}

export function findActiveSentence(sentences: CaptionSentence[], currentMs: number): CaptionSentence | null {
  for (const sentence of sentences) {
    if (currentMs >= sentence.startMs && currentMs <= sentence.endMs) {
      return sentence;
    }
  }
  return null;
}
