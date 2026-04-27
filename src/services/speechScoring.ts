const API_URL = 'http://localhost:8003';

export interface WordProsodyDetail {
  stress_score: number;
  energy: number;
  pitch: number;
  pitch_range: number;
  vowel_duration: number;
  is_content_word: boolean;
}

export interface WordDetail {
  word: string;
  status: 'correct' | 'mispronounced' | 'missed';
  heard_as?: string | null;
  pronunciation_score: number;
  prosody_score?: number;
  prosody_details?: WordProsodyDetail | null;
  expected_phonemes: string;
  recognized_phonemes: string;
  confidence: number;
}

export interface ProsodyScore {
  stress: number;
  intonation: number;
  rhythm: number;
  rate: number;
  overall: number;
}

export interface SpeakingScore {
  transcript: string;
  reference: string;
  score: {
    accuracy: number;
    pronunciation: number;
    fluency: number;
    prosody: ProsodyScore;
    overall: number;
    word_details: WordDetail[];
    matched: number;
    total: number;
  };
  feedback: {
    summary: string;
    phoneme_errors: { phoneme: string; confused_with: string | null; score: number; words: string[] }[];
    missed_words: string[];
    prosody_tips: { label: string; score: number; detail: string }[];
    tips: string[];
  };
}

export interface WordScore {
  word: string;
  transcript: string;
  status: 'correct' | 'mispronounced' | 'missed';
  pronunciation_score: number;
  expected_phonemes: string;
  recognized_phonemes: string;
  heard_as: string | null;
}

export async function transcribeAndScoreWord(audioBlob: Blob, word: string): Promise<WordScore> {
  const ext = audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
  const form = new FormData();
  form.append('audio', audioBlob, `recording.${ext}`);
  form.append('word', word);

  const res = await fetch(`${API_URL}/transcribe-word`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Word scoring failed: ${res.status}`);
  }

  return res.json();
}

export async function transcribeAndScore(audioBlob: Blob, referenceText: string): Promise<SpeakingScore> {
  const ext = audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
  const form = new FormData();
  form.append('audio', audioBlob, `recording.${ext}`);
  form.append('reference_text', referenceText);

  const res = await fetch(`${API_URL}/transcribe`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Scoring failed: ${res.status}`);
  }

  return res.json();
}
