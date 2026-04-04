// transcriptSegmenter.ts

/* =========================
   Types
========================= */

export interface Seg {
  utf8: string;
}

export interface Cue {
  tStartMs: number;
  dDurationMs: number;
  segs: Seg[];
}

export interface Paragraph {
  cues: Cue[];
}

export interface SegmentResult {
  paragraphs: Paragraph[];
}

/* =========================
   Config (tunable)
========================= */

export interface SegmentConfig {
  TIME_GAP_MS: number;
  HARD_TIME_GAP_MS: number;

  MAX_CUES_PER_PARAGRAPH: number;
  MIN_CUES_PER_PARAGRAPH: number;

  BREAK_THRESHOLD: number;

  WEIGHTS: {
    time: number;
    punctuation: number;
    semantic: number;
    length: number;
    discourse: number;
  };
}

const DEFAULT_CONFIG: SegmentConfig = {
  TIME_GAP_MS: 1200,
  HARD_TIME_GAP_MS: 3000,

  MAX_CUES_PER_PARAGRAPH: 8,
  MIN_CUES_PER_PARAGRAPH: 2,

  BREAK_THRESHOLD: 3,

  WEIGHTS: {
    time: 2,
    punctuation: 1,
    semantic: 2,
    length: 1,
    discourse: 2,
  },
};

/* =========================
   Keyword sets
========================= */

const DISCOURSE_MARKERS: string[] = [
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

const CONTINUATION_WORDS: string[] = ['and', 'or', 'because', 'so', 'but', 'to', 'of', 'in', 'for', 'with'];

const END_PUNCTUATION = /[.!?]$/;

/* =========================
   Utils
========================= */

function getCueText(cue: Cue): string {
  return cue.segs.map(s => s.utf8).join(' ');
}

function normalizeCue(cue: Cue): Cue {
  return {
    ...cue,
    segs: cue.segs.map(seg => ({
      ...seg,
      utf8: seg.utf8.replace(/\n/g, ' '),
    })),
  };
}

/* =========================
   Scoring functions
========================= */

function getTimeScore(prev: Cue, curr: Cue, config: SegmentConfig): number {
  const gap = curr.tStartMs - (prev.tStartMs + prev.dDurationMs);

  if (gap >= config.HARD_TIME_GAP_MS) return 3;
  if (gap >= config.TIME_GAP_MS) return 1;

  return 0;
}

function getPunctuationScore(prevText: string): number {
  return END_PUNCTUATION.test(prevText.trim()) ? 1 : 0;
}

function getSemanticScore(currText: string): number {
  const text = currText.toLowerCase();

  for (const marker of DISCOURSE_MARKERS) {
    if (text.startsWith(marker)) {
      return 2;
    }
  }

  return 0;
}

function getLengthScore(paragraph: Cue[], config: SegmentConfig): number {
  if (paragraph.length >= config.MAX_CUES_PER_PARAGRAPH) {
    return 2;
  }
  return 0;
}

function getContinuationPenalty(currText: string): number {
  const firstWord = currText.trim().split(/\s+/)[0]?.toLowerCase();

  if (firstWord && CONTINUATION_WORDS.includes(firstWord)) {
    return -2;
  }

  return 0;
}

/* =========================
   Core decision
========================= */

function shouldBreak(prevCue: Cue, currCue: Cue, currentParagraph: Cue[], config: SegmentConfig): boolean {
  const prevText = getCueText(prevCue);
  const currText = getCueText(currCue);

  let score = 0;

  score += config.WEIGHTS.time * getTimeScore(prevCue, currCue, config);
  score += config.WEIGHTS.punctuation * getPunctuationScore(prevText);
  score += config.WEIGHTS.semantic * getSemanticScore(currText);
  score += config.WEIGHTS.length * getLengthScore(currentParagraph, config);
  score += getContinuationPenalty(currText);

  return score >= config.BREAK_THRESHOLD;
}

/* =========================
   Main API
========================= */

export function segmentTranscript(events: Cue[], customConfig?: Partial<SegmentConfig>): SegmentResult {
  const config: SegmentConfig = {
    ...DEFAULT_CONFIG,
    ...customConfig,
    WEIGHTS: {
      ...DEFAULT_CONFIG.WEIGHTS,
      ...(customConfig?.WEIGHTS || {}),
    },
  };

  const paragraphs: Paragraph[] = [];
  let currentParagraph: Cue[] = [];

  const normalized = events.map(normalizeCue);

  for (let i = 0; i < normalized.length; i++) {
    const cue = normalized[i];

    if (i === 0) {
      currentParagraph.push(cue);
      continue;
    }

    const prevCue = normalized[i - 1];

    if (shouldBreak(prevCue, cue, currentParagraph, config)) {
      paragraphs.push({ cues: currentParagraph });
      currentParagraph = [];
    }

    currentParagraph.push(cue);
  }

  if (currentParagraph.length > 0) {
    paragraphs.push({ cues: currentParagraph });
  }

  return { paragraphs };
}

/* =========================
   Debug helper (optional)
========================= */

export function debugBreakDecision(prevCue: Cue, currCue: Cue, paragraph: Cue[], config: SegmentConfig = DEFAULT_CONFIG) {
  const prevText = getCueText(prevCue);
  const currText = getCueText(currCue);

  const scores = {
    time: getTimeScore(prevCue, currCue, config),
    punctuation: getPunctuationScore(prevText),
    semantic: getSemanticScore(currText),
    length: getLengthScore(paragraph, config),
    continuation: getContinuationPenalty(currText),
  };

  const total =
    scores.time * config.WEIGHTS.time +
    scores.punctuation * config.WEIGHTS.punctuation +
    scores.semantic * config.WEIGHTS.semantic +
    scores.length * config.WEIGHTS.length +
    scores.continuation;

  return {
    prevText,
    currText,
    scores,
    total,
    shouldBreak: total >= config.BREAK_THRESHOLD,
  };
}
