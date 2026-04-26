"""
Pronunciation scoring pipeline:

  Audio → [1] Whisper ASR (transcript + word timestamps)
        → [2] wav2vec2 phoneme recognition (what phonemes were spoken)
        → [3] espeak G2P (what phonemes were expected)
        → [4] Scoring engine (compare + score)
"""

import os

# Prevent OpenMP duplicate-library crash on macOS (torch + numpy both bundle libiomp5)
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import math
import re
import subprocess
import tempfile
from dataclasses import dataclass

import torch
import torchaudio
from faster_whisper import WhisperModel
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
from phonemizer import phonemize
from phonemizer.separator import Separator


# ══════════════════════════════════════════════════════════════════════════════
# Scoring Constants — all tunable thresholds in one place
# ══════════════════════════════════════════════════════════════════════════════

# ── Phoneme distance costs ────────────────────────────────────────────────
# Used by _phone_distance() when comparing two phonemes.
PHONE_COST_SAME_GROUP = 0.2     # same phonetic group (e.g. /s/↔/z/, /p/↔/b/)
PHONE_COST_NEAR_PAIR = 0.5     # known cross-group near-substitution (e.g. /θ/↔/t/)
PHONE_COST_DIFFERENT = 1.0     # completely different phonemes (e.g. /θ/↔/k/)

# ── Weighted Levenshtein costs ────────────────────────────────────────────
# Used by _weighted_levenshtein() for edit operations on phoneme sequences.
EDIT_COST_INSERT = 0.8          # cost of an extra spoken phoneme (less bad)
EDIT_COST_DELETE = 1.2          # cost of a missing expected phoneme (worse)

# ── Levenshtein normalization ────────────────────────────────────────────
LEVENSHTEIN_MIN_DENOM = 2       # floor for denominator — gives partial credit to short words

# ── Word alignment (Needleman-Wunsch) ─────────────────────────────────────
# Used by _align_words() to align reference words to ASR words.
ALIGN_SCORE_EXACT = 3           # reward for exact word match
ALIGN_SCORE_CLOSE = 2           # reward for fuzzy match (edit distance = 1)
ALIGN_SCORE_STEM = 1            # reward for stem match (edit distance = 2, same prefix)
ALIGN_SCORE_MISMATCH = -2       # penalty for unrelated words
ALIGN_GAP_REF = -1              # penalty for skipping a reference word (missed)
ALIGN_GAP_ASR = 0               # penalty for skipping an ASR word (extra spoken word)
ALIGN_FUZZY_MIN_LEN = 5         # minimum word length to allow fuzzy matching
ALIGN_STEM_PREFIX_LEN = 5       # prefix length that must match for stem-based fuzzy

# ── Phoneme time window ───────────────────────────────────────────────────
# Used when collecting wav2vec2 phonemes for a Whisper word's time range.
PHONE_WINDOW_LEFT_MARGIN = 0.05  # 50ms left margin — catches word-initial onsets (/h/, /s/, /f/)
PHONE_WINDOW_RIGHT_MARGIN = 0.08  # 80ms right margin — catches trailing clusters (/ŋk/, /st/)

# ── Phoneme recognition confidence ───────────────────────────────────────
PHONEME_MIN_CONFIDENCE = 0.3     # discard CTC phonemes below this softmax probability

# ── GOP (Goodness of Pronunciation) scoring ──────────────────────────────
GOP_FLOOR = -10.0                # floor for per-phoneme GOP (log scale)
# Sigmoid mapping parameters: score = 100 / (1 + exp(-k * (gop - midpoint)))
# Gives better mid-range discrimination than linear.
# Native speech GOP values cluster around -0.3 to 0; mispronounced around -3 to -5.
GOP_SIGMOID_MIDPOINT = -2.0      # GOP value → 50% score
GOP_SIGMOID_STEEPNESS = 1.5      # higher = sharper transition
# Alignment quality: minimum fraction of phonemes that must align for GOP to be primary
GOP_MIN_ALIGNED_RATIO = 0.6      # below this → Levenshtein fallback
# When GOP alignment succeeds, how much to weight it vs Levenshtein
GOP_WEIGHT_PRIMARY = 0.85        # GOP weight when alignment is good
GOP_WEIGHT_FALLBACK = 0.15       # Levenshtein weight when GOP is primary

# ── Word scoring thresholds ───────────────────────────────────────────────
# Applied to per-word phoneme scores to determine correct/mispronounced/missed.
WORD_SCORE_CORRECT = 80         # phoneme score ≥ this → "correct"
WORD_SCORE_PARTIAL = 50         # phoneme score ≥ this → "mispronounced" (partial credit)
WORD_MATCHED_CORRECT = 1.0     # accuracy credit for a correct word
WORD_MATCHED_PARTIAL = 0.5     # accuracy credit for a mispronounced word (score ≥ 50)
WORD_MATCHED_BAD = 0.2         # accuracy credit for a badly mispronounced word (score < 50)

# ── Prosody scoring ───────────────────────────────────────────────────────
# Prosody = stress + intonation + rhythm (each 0–100).
PROSODY_MIN_WORDS = 3            # need at least this many matched words for prosody
PROSODY_DEFAULT = 50             # default when too few words

# Stress: energy ratio of content words vs function words.
# Content words should be ~1.3–2x louder than function words in natural English.
STRESS_RATIO_SWEET_LOW = 1.2     # lower bound of ideal energy ratio
STRESS_RATIO_SWEET_HIGH = 2.5    # upper bound — beyond this is over-emphasis
STRESS_FLAT_PENALTY = 30         # score when ratio ≈ 1.0 (monotone stress)

# Intonation: F0 variation across the utterance.
# Native conversational English has ~40–80 Hz F0 standard deviation.
INTONATION_F0_STD_LOW = 15.0     # Hz — below this is too flat
INTONATION_F0_STD_SWEET = 40.0   # Hz — ideal lower bound
INTONATION_F0_STD_HIGH = 100.0   # Hz — above this is exaggerated
INTONATION_FLAT_FLOOR = 20       # minimum score for very flat speech

# Rhythm: regularity of vowel/consonant duration intervals (PVI-based).
# Lower nPVI = more regular (syllable-timed); English is stress-timed → higher nPVI.
# Native English nPVI typically 55–75.
RHYTHM_NPVI_SWEET_LOW = 40.0     # lower bound of natural English rhythm
RHYTHM_NPVI_SWEET_HIGH = 80.0    # upper bound
RHYTHM_TOO_REGULAR_FLOOR = 30    # score when too syllable-timed (robotic)
RHYTHM_TOO_IRREGULAR_FLOOR = 40  # score when too erratic

# F0 extraction parameters
F0_FRAME_LENGTH = 0.032          # 32ms frames for pitch analysis
F0_HOP_LENGTH = 0.010            # 10ms hop between frames
F0_FMIN = 75.0                   # Hz — minimum F0 (low male voice)
F0_FMAX = 500.0                  # Hz — maximum F0 (high female voice)

# ── Overall score formula ─────────────────────────────────────────────────
# overall = accuracy*W + pronunciation*W + fluency*W + prosody*W
OVERALL_W_ACCURACY = 0.25       # weight of accuracy in overall score
OVERALL_W_PRONUNCIATION = 0.40  # weight of pronunciation in overall score
OVERALL_W_FLUENCY = 0.15        # weight of fluency in overall score
OVERALL_W_PROSODY = 0.20        # weight of prosody in overall score

# ── Accuracy gate ─────────────────────────────────────────────────────────
# When accuracy is very low, pronunciation and fluency are meaningless
# (user said completely wrong words).  Below this threshold, scale them down.
ACCURACY_GATE_THRESHOLD = 30    # below this %, pronunciation/fluency are scaled down

# ── Fluency scoring ───────────────────────────────────────────────────────
# Thresholds based on native English conversational speech patterns.
FLUENCY_MIN_WORDS = 2           # minimum words needed to compute fluency
FLUENCY_DEFAULT = 50            # default fluency when too few words

# Speaking rate (words per second)
FLUENCY_RATE_VERY_SLOW = 1.0    # below this → heavily penalized
FLUENCY_RATE_SLOW = 2.0         # below this → moderate penalty
FLUENCY_RATE_FAST_MAX = 4.5     # above this → penalized for rushing
FLUENCY_RATE_SWEET_MAX = 3.5    # optimal range ceiling for rate bonus

# Average inter-word gap (seconds) — native speakers: ~0.08–0.15s
FLUENCY_GAP_PERFECT = 0.15      # ≤ this → gap_score = 100
FLUENCY_GAP_OKAY = 0.3          # ≤ this → moderate penalty
FLUENCY_GAP_SLOW = 0.6          # ≤ this → significant penalty

# Longest single gap (hesitation)
FLUENCY_PAUSE_FINE = 0.3        # ≤ this → no penalty
FLUENCY_PAUSE_NOTICE = 0.8      # ≤ this → moderate penalty
FLUENCY_PAUSE_LONG = 1.5        # ≤ this → significant penalty
FLUENCY_PAUSE_FLOOR = 15        # minimum pause score for very long hesitations

# Fluency component weights (must sum to 1.0)
FLUENCY_W_RATE = 0.35           # weight of speaking rate
FLUENCY_W_GAP = 0.35            # weight of average gap
FLUENCY_W_PAUSE = 0.30          # weight of longest pause

# ── Fluency sub-score floors & scaling ────────────────────────────────────
# Each fluency sub-score (rate, gap, pause) is clamped to a floor and scaled.
# Format: (floor, scale_factor) — score = max(floor, int(base ± delta * scale))

# Rate score: maps words-per-second to 0–100
RATE_FLOOR_VERY_SLOW = 20       # minimum rate score when speaking very slowly
RATE_SCALE_VERY_SLOW = 40       # multiplier for very slow range
RATE_FLOOR_SLOW = 40            # minimum rate score when speaking slowly
RATE_SCALE_SLOW = 40            # multiplier for slow range
RATE_BASE_SWEET = 80            # base score at start of sweet-spot range
RATE_SWEET_DIVISOR = 1.5        # divisor for sweet-spot bonus calculation
RATE_SWEET_SCALE = 20           # multiplier for sweet-spot bonus
RATE_FLOOR_FAST = 50            # minimum rate score when speaking too fast
RATE_SCALE_FAST = 20            # penalty multiplier for rushing

# Gap score: maps average inter-word gap to 0–100
GAP_FLOOR_OKAY = 70             # minimum gap score in "okay" range
GAP_SCALE_OKAY = 200            # penalty multiplier for okay range
GAP_FLOOR_SLOW = 40             # minimum gap score in "slow" range
GAP_SCALE_SLOW = 100            # penalty multiplier for slow range
GAP_FLOOR_VERY_SLOW = 15        # minimum gap score for very slow gaps
GAP_SCALE_VERY_SLOW = 50        # penalty multiplier for very slow gaps

# Pause score: maps longest single gap to 0–100
PAUSE_FLOOR_NOTICE = 50         # minimum pause score for noticeable hesitation
PAUSE_SCALE_NOTICE = 100        # penalty multiplier for noticeable pause
PAUSE_FLOOR_LONG = 25           # minimum pause score for long hesitation
PAUSE_SCALE_LONG = 35           # penalty multiplier for long pause

# ── Feedback thresholds ───────────────────────────────────────────────────
FEEDBACK_MAX_MISPRONOUNCED = 3  # max mispronounced words to show in tips
FEEDBACK_MAX_MISSED = 2         # max missed words to show in tips
FEEDBACK_FLUENCY_WARN = 50      # show fluency tip when below this
FEEDBACK_STRESS_WARN = 45       # show stress tip when below this
FEEDBACK_INTONATION_WARN = 45   # show intonation tip when below this
FEEDBACK_RHYTHM_WARN = 45       # show rhythm tip when below this

# Feedback summary thresholds (based on pronunciation score)
FEEDBACK_GREAT_THRESHOLD = 80   # ≥ this → "Great pronunciation!"
FEEDBACK_GOOD_THRESHOLD = 60    # ≥ this → "Good attempt!"
FEEDBACK_KEEP_THRESHOLD = 40    # ≥ this → "Keep practicing"
                                # below  → "Listen to the original again"


# ══════════════════════════════════════════════════════════════════════════════
# Models (loaded once on startup)
# ══════════════════════════════════════════════════════════════════════════════

whisper_model: WhisperModel | None = None
w2v_model: Wav2Vec2ForCTC | None = None
w2v_processor: Wav2Vec2Processor | None = None


def load_models():
    global whisper_model, w2v_model, w2v_processor

    whisper_size = os.getenv("WHISPER_MODEL", "small")
    device = os.getenv("WHISPER_DEVICE", "cpu")
    print(f"[1/2] Loading Whisper '{whisper_size}' on {device}...")
    whisper_model = WhisperModel(whisper_size, device=device, compute_type="int8")

    phoneme_model = os.getenv(
        "PHONEME_MODEL", "facebook/wav2vec2-lv-60-espeak-cv-ft"
    )
    print(f"[2/2] Loading phoneme model '{phoneme_model}'...")
    w2v_processor = Wav2Vec2Processor.from_pretrained(phoneme_model)
    w2v_model = Wav2Vec2ForCTC.from_pretrained(phoneme_model)
    w2v_model.eval()

    print("All models loaded.\n")


# ── [1] ASR — Whisper ───────────────────────────────────────────────────────

@dataclass
class AsrWord:
    word: str
    start: float
    end: float
    probability: float


@dataclass
class AsrResult:
    transcript: str
    words: list[AsrWord]


def asr_transcribe(wav_path: str) -> AsrResult:
    """Transcribe audio honestly — report what was actually spoken.

    Whisper must NOT know the reference text.  It must act as a neutral
    listener so that "You said" reflects reality, not what the user was
    supposed to say.  We use greedy decoding (beam_size=1) to minimise
    the language model's tendency to auto-correct grammar/morphology.
    """
    segments, _ = whisper_model.transcribe(
        wav_path,
        language="en",
        beam_size=1,
        word_timestamps=True,
    )
    words: list[AsrWord] = []
    for seg in segments:
        for w in seg.words or []:
            words.append(AsrWord(
                word=w.word.strip(), start=w.start, end=w.end, probability=w.probability,
            ))
    transcript = " ".join(w.word for w in words)
    return AsrResult(transcript=transcript, words=words)


# ── [2] Phoneme Recognition — wav2vec2 ──────────────────────────────────────

@dataclass
class RecognizedPhoneme:
    phoneme: str
    time: float
    confidence: float


@dataclass
class PhonemeSegment:
    """A single phoneme aligned to a time range in the audio."""
    phoneme: str
    start: float       # seconds
    end: float         # seconds
    score: float       # GOP score for this segment (0–100, higher = better)


@dataclass
class PhonemeRecognitionResult:
    """Full wav2vec2 output: greedy phonemes + log probability matrix for GOP."""
    phonemes: list[RecognizedPhoneme]
    log_probs: torch.Tensor        # (T, C) — log softmax over vocab
    frame_duration: float           # seconds per CTC frame
    vocab: dict[str, int]          # token → id mapping
    id_to_token: dict[int, str]    # id → token mapping


def recognize_phonemes_full(wav_path: str) -> PhonemeRecognitionResult:
    """Run wav2vec2 and return both greedy phonemes and full log probability matrix."""
    waveform, sr = torchaudio.load(wav_path)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sr != 16000:
        waveform = torchaudio.functional.resample(waveform, sr, 16000)

    inputs = w2v_processor(
        waveform.squeeze().numpy(),
        sampling_rate=16000,
        return_tensors="pt",
        padding=True,
    )

    with torch.no_grad():
        logits = w2v_model(**inputs).logits

    log_probs = torch.log_softmax(logits, dim=-1).squeeze(0)  # (T, C)
    predicted_ids = torch.argmax(log_probs, dim=-1)

    num_frames = logits.shape[1]
    audio_duration = waveform.shape[1] / 16000
    frame_dur = audio_duration / num_frames

    vocab = w2v_processor.tokenizer.get_vocab()
    id_to_token = {v: k for k, v in vocab.items()}
    pad_id = w2v_processor.tokenizer.pad_token_id
    skip_tokens = {"<pad>", "<s>", "</s>", "<unk>", "|"}

    phonemes: list[RecognizedPhoneme] = []
    prev_id = -1
    for i, tid in enumerate(predicted_ids.tolist()):
        if tid == pad_id or tid == prev_id:
            prev_id = tid
            continue
        token = id_to_token.get(tid, "")
        if token and token not in skip_tokens:
            conf = log_probs[i, tid].exp().item()
            if conf >= PHONEME_MIN_CONFIDENCE:
                phonemes.append(RecognizedPhoneme(
                    phoneme=token,
                    time=i * frame_dur,
                    confidence=conf,
                ))
        prev_id = tid

    return PhonemeRecognitionResult(
        phonemes=phonemes,
        log_probs=log_probs,
        frame_duration=frame_dur,
        vocab=vocab,
        id_to_token=id_to_token,
    )


def recognize_phonemes(wav_path: str) -> list[RecognizedPhoneme]:
    """Legacy wrapper — returns only the greedy phoneme list."""
    return recognize_phonemes_full(wav_path).phonemes


# ── [3] G2P — espeak-ng ────────────────────────────────────────────────────

def _number_to_words(s: str) -> str:
    """Convert a numeric string to English words (simple cases)."""
    ones = ["", "one", "two", "three", "four", "five", "six", "seven",
            "eight", "nine", "ten", "eleven", "twelve", "thirteen",
            "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
    tens = ["", "", "twenty", "thirty", "forty", "fifty",
            "sixty", "seventy", "eighty", "ninety"]
    try:
        n = int(s)
    except ValueError:
        return s
    if n < 0:
        return "minus " + _number_to_words(str(-n))
    if n < 20:
        return ones[n]
    if n < 100:
        return tens[n // 10] + ("" if n % 10 == 0 else " " + ones[n % 10])
    if n < 1000:
        rest = _number_to_words(str(n % 100))
        return ones[n // 100] + " hundred" + ("" if not rest else " " + rest)
    if n < 1000000:
        rest = _number_to_words(str(n % 1000))
        return _number_to_words(str(n // 1000)) + " thousand" + ("" if not rest else " " + rest)
    # Very large numbers: spell out "million", "billion" etc. to stay phonemizable
    if n < 1000000000:
        rest = _number_to_words(str(n % 1000000))
        return _number_to_words(str(n // 1000000)) + " million" + ("" if not rest else " " + rest)
    return s  # fallback: return as-is for extremely large numbers


def text_to_phonemes(text: str) -> list[dict]:
    """Convert reference text → expected phonemes per word."""
    raw_tokens = re.findall(r"[a-zA-Z']+|\d+", text)
    if not raw_tokens:
        return []

    words: list[str] = []
    for token in raw_tokens:
        if re.fullmatch(r"\d+", token):
            expanded = _number_to_words(token).split()
            words.extend(expanded)
        else:
            words.append(token)

    if not words:
        return []

    phone_strs = phonemize(
        words,
        language="en-us",
        backend="espeak",
        separator=Separator(phone=" ", word="", syllable=""),
        strip=True,
    )

    result = []
    for word, phones in zip(words, phone_strs):
        result.append({
            "word": word,
            "phonemes": phones.strip().split() if phones.strip() else [],
        })
    return result


# ── Phoneme Normalization & Distance ──────────────────────────────────────

# Split compound IPA tokens into atomic units so that espeak "tʃ" (1 token)
# and wav2vec2 "t"+"ʃ" (2 tokens) are compared on equal footing.
_COMPOUND_SPLITS: dict[str, list[str]] = {
    # Affricates
    "tʃ": ["t", "ʃ"], "dʒ": ["d", "ʒ"],
    # Diphthongs
    "aɪ": ["a", "ɪ"], "aʊ": ["a", "ʊ"], "eɪ": ["e", "ɪ"],
    "oɪ": ["o", "ɪ"], "oʊ": ["o", "ʊ"], "əʊ": ["ə", "ʊ"],
    "aɪə": ["a", "ɪ", "ə"], "aɪɚ": ["a", "ɪ", "ɚ"],
    "ɪə": ["ɪ", "ə"], "ʊə": ["ʊ", "ə"], "eə": ["e", "ə"],
    # R-colored
    "ɑːɹ": ["ɑ", "ɹ"], "ɔːɹ": ["ɔ", "ɹ"], "oːɹ": ["o", "ɹ"],
    "ɪɹ": ["ɪ", "ɹ"], "ɛɹ": ["ɛ", "ɹ"], "ʊɹ": ["ʊ", "ɹ"],
    # R-colored (additional)
    "æɹ": ["æ", "ɹ"], "ʌɹ": ["ʌ", "ɹ"], "ɒɹ": ["ɒ", "ɹ"],
    "ɜːɹ": ["ɜ", "ɹ"], "əɹ": ["ə", "ɹ"],
    # Near diphthong variant
    "iə": ["i", "ə"],
    # Syllabics
    "əl": ["ə", "l"],
}

# Strip length mark — treat long/short as same base phoneme during comparison.
_LENGTH_STRIP = str.maketrans("", "", "ː")

# Merge variant IPA symbols that espeak and wav2vec2 use for the same sound.
_PHONE_ALIASES: dict[str, str] = {
    "r": "ɹ",      # wav2vec2 may output /r/, espeak uses /ɹ/
    "ɝ": "ɚ",      # rhotic schwa variants
    "ɜ": "ə",      # NURSE vowel → schwa (when non-rhotic)
    "ɐ": "ə",      # near-open central → schwa
    "ᵻ": "ɪ",      # barred-i → near-close front
    "g": "ɡ",      # ASCII g → IPA ɡ (U+0261)
    "ɫ": "l",      # dark L → plain L
    "ɾ": "ɹ",      # tap → approximant (American English)
    "ɻ": "ɹ",      # retroflex → approximant
    "ɽ": "ɹ",      # retroflex flap → approximant
    "ʋ": "v",      # labiodental approx → fricative
}


def _normalize_phonemes(tokens: list[str]) -> list[str]:
    """Normalize a phoneme token list to atomic, length-stripped, aliased form."""
    out: list[str] = []
    for tok in tokens:
        if tok in _COMPOUND_SPLITS:
            out.extend(_COMPOUND_SPLITS[tok])
        else:
            stripped = tok.translate(_LENGTH_STRIP)
            if stripped:
                out.append(stripped)
    # Apply aliases to merge variant representations
    return [_PHONE_ALIASES.get(p, p) for p in out]


# ── CTC Forced Alignment & GOP Scoring ───────────────────────────────────

# Build reverse alias lookup once at import time (normalized → raw wav2vec2 token).
# _PHONE_ALIASES maps raw→normalized; we need normalized→raw for vocab resolution.
_REVERSE_ALIASES: dict[str, list[str]] = {}
for _raw_ph, _norm_ph in _PHONE_ALIASES.items():
    _REVERSE_ALIASES.setdefault(_norm_ph, []).append(_raw_ph)


def _resolve_phone_id(phone: str, vocab: dict[str, int]) -> int | None:
    """Find the wav2vec2 vocab id for a normalized phoneme.

    Checks direct match first, then reverse aliases. O(1) average case
    via pre-built _REVERSE_ALIASES dict (was O(n) scan before).
    """
    if phone in vocab:
        return vocab[phone]
    for raw in _REVERSE_ALIASES.get(phone, ()):
        if raw in vocab:
            return vocab[raw]
    return None


def _resolve_phone_ids(
    phones: list[str], vocab: dict[str, int],
) -> tuple[list[int], list[str], list[int]]:
    """Resolve a list of normalized phonemes to vocab ids.

    Returns (ids, resolved_phones, resolved_indices) — only phonemes that
    could be mapped to the wav2vec2 vocabulary are included.
    """
    ids: list[int] = []
    resolved: list[str] = []
    indices: list[int] = []
    for idx, p in enumerate(phones):
        pid = _resolve_phone_id(p, vocab)
        if pid is not None:
            ids.append(pid)
            resolved.append(p)
            indices.append(idx)
    return ids, resolved, indices


def _ctc_force_align(
    log_probs: torch.Tensor,
    phone_ids: list[int],
    frame_start: int,
    frame_end: int,
) -> list[tuple[int, int]]:
    """CTC forced alignment via Viterbi on a frame range.

    Uses torch tensors for the DP table — ~10x faster than pure-Python lists
    for typical utterances (T=200–500 frames, S=5–15 phonemes).

    CTC topology: blank, phone[0], blank, phone[1], ..., blank
    Each phoneme can self-loop (repeat) and transition through optional blanks.

    Returns list of (start_frame, end_frame) per phoneme in phone_ids.
    Frame indices are absolute (not relative to frame_start).
    """
    if not phone_ids or frame_start >= frame_end:
        return []

    T = frame_end - frame_start
    S = len(phone_ids)
    num_states = 2 * S + 1
    NEG_INF = float("-inf")

    pad_id = w2v_processor.tokenizer.pad_token_id
    blank_id = pad_id

    # State token mapping: 0=blank, 1=phone[0], 2=blank, 3=phone[1], ...
    state_tokens = torch.zeros(num_states, dtype=torch.long)
    for i in range(S):
        state_tokens[2 * i] = blank_id
        state_tokens[2 * i + 1] = phone_ids[i]
    state_tokens[-1] = blank_id

    # Precompute emission log probs for the frame slice: (T, num_states)
    frame_slice = log_probs[frame_start:frame_end]        # (T, C)
    emissions = frame_slice[:, state_tokens]               # (T, num_states)

    # DP tables on CPU tensors
    dp = torch.full((T, num_states), NEG_INF)
    bp = torch.zeros((T, num_states), dtype=torch.long)

    # Initialize t=0: can start at state 0 (blank) or state 1 (first phone)
    dp[0, 0] = emissions[0, 0]
    if num_states > 1:
        dp[0, 1] = emissions[0, 1]

    # Which states allow skip-blank transition (s can come from s-2)?
    # Only when state_tokens[s] != state_tokens[s-2] (different phoneme)
    can_skip = torch.zeros(num_states, dtype=torch.bool)
    for s in range(2, num_states):
        can_skip[s] = state_tokens[s] != state_tokens[s - 2]

    # Forward pass
    for t in range(1, T):
        emit = emissions[t]  # (num_states,)

        # Option 1: self-loop — stay in same state
        score_self = dp[t - 1].clone()
        source = torch.arange(num_states, dtype=torch.long)

        # Option 2: from previous state (s-1)
        score_prev = torch.full((num_states,), NEG_INF)
        score_prev[1:] = dp[t - 1, :-1]
        better_prev = score_prev > score_self
        score_self = torch.where(better_prev, score_prev, score_self)
        source = torch.where(better_prev, source - 1, source)

        # Option 3: skip blank — from s-2 (only where can_skip is True)
        score_skip = torch.full((num_states,), NEG_INF)
        score_skip[2:] = dp[t - 1, :-2]
        better_skip = can_skip & (score_skip > score_self)
        score_self = torch.where(better_skip, score_skip, score_self)
        source = torch.where(better_skip, source - 2, source)

        dp[t] = score_self + emit
        bp[t] = source

    # Find best final state (last phone state or trailing blank)
    final_states = [num_states - 1, num_states - 2] if num_states >= 2 else [0]
    best_state = max(final_states, key=lambda s: dp[T - 1, s].item())

    # Traceback — collect state sequence
    state_seq = torch.zeros(T, dtype=torch.long)
    state_seq[T - 1] = best_state
    for t in range(T - 2, -1, -1):
        state_seq[t] = bp[t + 1, state_seq[t + 1]]

    # Extract per-phoneme segments from state sequence
    # Phoneme i → state 2*i + 1
    segments: list[tuple[int, int]] = []
    state_seq_list = state_seq.tolist()
    for i in range(S):
        phone_state = 2 * i + 1
        first = -1
        last = -1
        for t in range(T):
            if state_seq_list[t] == phone_state:
                if first == -1:
                    first = t
                last = t
        if first >= 0:
            segments.append((frame_start + first, frame_start + last + 1))
        else:
            segments.append((-1, -1))

    return segments


def _compute_gop_scores(
    log_probs: torch.Tensor,
    phone_ids: list[int],
    segments: list[tuple[int, int]],
) -> list[float]:
    """Compute per-phoneme GOP scores from aligned segments.

    GOP(p) = (1/N) * sum_frames[ log P(p | frame) - max_{q != p} log P(q | frame) ]

    Args:
        log_probs: (T, C) log-softmax output from wav2vec2.
        phone_ids: resolved vocab ids corresponding to expected phonemes.
        segments: (start_frame, end_frame) per phoneme from forced alignment.

    Returns list of raw GOP values (negative; closer to 0 = better).
    """
    gop_scores: list[float] = []

    for pid, (f_start, f_end) in zip(phone_ids, segments):
        if f_start < 0 or f_end <= f_start:
            gop_scores.append(GOP_FLOOR)
            continue

        # Slice frames for this phoneme segment
        frame_lp = log_probs[f_start:f_end]             # (N, C)
        log_p_expected = frame_lp[:, pid]                 # (N,)

        # Efficiently compute max over all tokens *except* pid.
        # Scatter -inf into the expected column, take max, restore.
        # This avoids cloning the full (N, C) tensor.
        saved = frame_lp[:, pid].clone()
        frame_lp[:, pid] = -1e9
        log_p_best_other = frame_lp.max(dim=-1).values   # (N,)
        frame_lp[:, pid] = saved  # restore — log_probs is shared across calls

        gop = (log_p_expected - log_p_best_other).mean().item()
        gop_scores.append(max(GOP_FLOOR, gop))

    return gop_scores


def _gop_to_score(gop: float) -> float:
    """Map a single raw GOP value to 0–100 using a sigmoid.

    Sigmoid gives better mid-range discrimination than linear clamp:
    native speech (GOP ~ -0.3) → ~95, moderate errors (GOP ~ -2) → ~50,
    severe errors (GOP ~ -5) → ~5.
    """
    exponent = -GOP_SIGMOID_STEEPNESS * (gop - GOP_SIGMOID_MIDPOINT)
    # Clamp exponent to prevent overflow (exp(700) ≈ 1e304, near float64 max)
    exponent = max(-500.0, min(500.0, exponent))
    return 100.0 / (1.0 + math.exp(exponent))


def _gop_scores_to_word_score(gop_values: list[float]) -> float:
    """Convert per-phoneme GOP values to a single 0–100 word score."""
    if not gop_values:
        return 0.0
    return sum(_gop_to_score(g) for g in gop_values) / len(gop_values)


def align_phonemes(
    rec_result: PhonemeRecognitionResult,
    phonemes: list[str],
    frame_start: int = 0,
    frame_end: int = -1,
) -> list[PhonemeSegment]:
    """Align expected phonemes to audio using CTC forced alignment.

    This is the main public alignment API.

    Args:
        rec_result: Full wav2vec2 recognition output (log probs + vocab).
        phonemes: List of expected phoneme tokens (raw espeak output, will be normalized).
        frame_start: First CTC frame to consider (default 0).
        frame_end: Last CTC frame (exclusive). -1 = end of audio.

    Returns:
        List of PhonemeSegment with time ranges and per-phoneme GOP scores.
        One entry per normalized phoneme. Unaligned phonemes have start=end=-1.
    """
    if frame_end < 0:
        frame_end = rec_result.log_probs.shape[0]

    norm_phones = _normalize_phonemes(phonemes)
    if not norm_phones or frame_start >= frame_end:
        return []

    phone_ids, _, resolved_indices = _resolve_phone_ids(
        norm_phones, rec_result.vocab,
    )

    if not phone_ids:
        return [PhonemeSegment(phoneme=p, start=-1, end=-1, score=0) for p in norm_phones]

    # Run CTC forced alignment
    raw_segments = _ctc_force_align(
        rec_result.log_probs, phone_ids, frame_start, frame_end,
    )

    # Compute per-phoneme GOP scores
    gop_values = _compute_gop_scores(
        rec_result.log_probs, phone_ids, raw_segments,
    )

    # Build output — map resolved segments back to full phoneme list
    fd = rec_result.frame_duration
    result: list[PhonemeSegment] = []
    resolved_pos = 0
    for idx, p in enumerate(norm_phones):
        if resolved_pos < len(resolved_indices) and resolved_indices[resolved_pos] == idx:
            f_start, f_end = raw_segments[resolved_pos]
            gop = gop_values[resolved_pos]
            seg_score = _gop_to_score(gop) if f_start >= 0 else 0.0
            result.append(PhonemeSegment(
                phoneme=p,
                start=round(f_start * fd, 4) if f_start >= 0 else -1,
                end=round(f_end * fd, 4) if f_end >= 0 else -1,
                score=round(seg_score, 1),
            ))
            resolved_pos += 1
        else:
            result.append(PhonemeSegment(phoneme=p, start=-1, end=-1, score=0))

    return result


def _score_with_gop(
    exp_phones: list[str],
    rec_phones: list[str],
    log_probs: torch.Tensor,
    frame_start: int,
    frame_end: int,
    vocab: dict[str, int],
) -> tuple[float, str, list[PhonemeSegment]]:
    """Score a word using GOP (primary) with Levenshtein fallback.

    Decision logic:
    1. If alignment prerequisites fail → pure Levenshtein.
    2. If < GOP_MIN_ALIGNED_RATIO phonemes resolve or align → pure Levenshtein.
    3. Otherwise → GOP is primary (GOP_WEIGHT_PRIMARY), Levenshtein is secondary.

    Returns (score 0–100, method name, aligned PhonemeSegment list).
    """
    exp_norm = _normalize_phonemes(exp_phones)
    rec_norm = _normalize_phonemes(rec_phones)

    # ── Levenshtein score (always available) ──
    if exp_norm and rec_norm:
        dist = _weighted_levenshtein(exp_norm, rec_norm)
        lev_score = max(0.0, (1 - dist / max(len(exp_norm), len(rec_norm), LEVENSHTEIN_MIN_DENOM))) * 100
    elif not exp_norm:
        lev_score = 100.0
    else:
        lev_score = 0.0

    # ── GOP prerequisites ──
    if not exp_norm or frame_start >= frame_end or frame_end - frame_start < 2:
        return lev_score, "levenshtein", []

    phone_ids, resolvable_phones, _ = _resolve_phone_ids(exp_norm, vocab)

    # Gate: too few phonemes resolved → Levenshtein only
    if len(phone_ids) < len(exp_norm) * GOP_MIN_ALIGNED_RATIO:
        return lev_score, "levenshtein", []

    # ── CTC forced alignment ──
    segments = _ctc_force_align(log_probs, phone_ids, frame_start, frame_end)

    # Gate: too few phonemes actually aligned → Levenshtein only
    n_aligned = sum(1 for s, _ in segments if s >= 0)
    if n_aligned < len(phone_ids) * GOP_MIN_ALIGNED_RATIO:
        return lev_score, "levenshtein", []

    # ── Compute per-phoneme GOP ──
    gop_values = _compute_gop_scores(log_probs, phone_ids, segments)
    gop_score = _gop_scores_to_word_score(gop_values)

    # ── Build PhonemeSegment list (frame indices — caller converts to seconds) ──
    aligned_segments: list[PhonemeSegment] = []
    for phone, (fs, fe), gop in zip(resolvable_phones, segments, gop_values):
        seg_score = _gop_to_score(gop) if fs >= 0 else 0.0
        aligned_segments.append(PhonemeSegment(
            phoneme=phone,
            start=fs if fs >= 0 else -1,
            end=fe if fe >= 0 else -1,
            score=round(seg_score, 1),
        ))

    # ── Combine: GOP primary, Levenshtein stabilizer ──
    combined = gop_score * GOP_WEIGHT_PRIMARY + lev_score * GOP_WEIGHT_FALLBACK
    return combined, "gop", aligned_segments


# Phonetic feature groups — substitution within the same group costs less
# than across groups.
_PHONE_GROUPS: dict[str, int] = {}
_GROUPS = [
    # Plosives (voiceless / voiced pairs)
    (["p", "b"], 0),
    (["t", "d"], 1),
    (["k", "ɡ", "g"], 2),
    # Fricatives
    (["f", "v"], 3),
    (["θ", "ð"], 4),
    (["s", "z"], 5),
    (["ʃ", "ʒ"], 6),
    (["h"], 7),
    # Nasals
    (["m", "n", "ŋ"], 8),
    # Liquids / Glides
    (["l", "ɫ", "ɭ", "l̩"], 9),
    (["ɹ", "r", "ɾ", "ɽ", "ɻ"], 10),
    (["w", "ʋ"], 11),
    (["j"], 12),
    # Front vowels
    (["i", "ɪ", "e", "ɛ", "æ"], 13),
    # Central vowels
    (["ə", "ɚ", "ʌ", "ɜ", "ɐ", "ᵻ"], 14),
    # Back vowels
    (["u", "ʊ", "o", "ɔ", "ɑ", "ɒ", "a"], 15),
]
for phones, gid in _GROUPS:
    for ph in phones:
        _PHONE_GROUPS[ph] = gid

# Common cross-group near-substitutions — these occur in normal accents
# and should be penalized less than truly wrong sounds.
_NEAR_PAIRS: set[tuple[str, str]] = set()
for _a, _b in [
    ("θ", "t"), ("θ", "f"), ("ð", "d"), ("ð", "v"),  # TH-fronting/stopping
    ("ɹ", "l"), ("ɹ", "w"),  # R/L confusion, R→W (common in learners)
    ("n", "ŋ"),  # velar nasal confusion
    ("ɪ", "ə"), ("ʌ", "ɑ"),  # reduced vowel confusion
    ("b", "v"),  # Spanish/Arabic L1 transfer
    ("p", "f"),  # Korean/Japanese L1 transfer
    ("s", "ʃ"),  # sibilant confusion
    ("z", "dʒ"),  # Chinese L1 transfer
    ("i", "ɪ"),  # tense/lax front vowel (very common)
    ("u", "ʊ"),  # tense/lax back vowel
    ("æ", "ɛ"),  # TRAP/DRESS confusion
]:
    _NEAR_PAIRS.add((_a, _b))
    _NEAR_PAIRS.add((_b, _a))


def _phone_distance(a: str, b: str) -> float:
    """Substitution cost between two phonemes based on phonetic similarity."""
    if a == b:
        return 0.0
    ga = _PHONE_GROUPS.get(a)
    gb = _PHONE_GROUPS.get(b)
    if ga is not None and gb is not None and ga == gb:
        return PHONE_COST_SAME_GROUP
    if (a, b) in _NEAR_PAIRS:
        return PHONE_COST_NEAR_PAIR
    return PHONE_COST_DIFFERENT


def _weighted_levenshtein(expected: list[str], recognized: list[str]) -> float:
    """Edit distance using phonetic substitution costs instead of flat 0/1.

    expected → recognized:
      DELETE = expected phoneme missing from recognized (cost 1.2)
      INSERT = recognized has extra phoneme not in expected (cost 0.8)

    Note: no swap optimization — asymmetric costs require consistent argument order.
    """
    n, m = len(expected), len(recognized)
    if m == 0:
        return float(n) * EDIT_COST_DELETE
    if n == 0:
        return float(m) * EDIT_COST_INSERT
    # prev[j] = cost of aligning expected[:0] with recognized[:j]
    prev = [float(j) * EDIT_COST_INSERT for j in range(m + 1)]
    for i in range(n):
        curr = [prev[0] + EDIT_COST_DELETE]
        for j in range(m):
            sub_cost = _phone_distance(expected[i], recognized[j])
            curr.append(min(
                curr[j] + EDIT_COST_INSERT,       # extra recognized phoneme
                prev[j + 1] + EDIT_COST_DELETE,    # missing expected phoneme
                prev[j] + sub_cost,                # substitution
            ))
        prev = curr
    return prev[-1]


# ── [4] Scoring Engine ──────────────────────────────────────────────────────

# Expand contractions so "you're" matches ASR "you are", etc.
_CONTRACTIONS: dict[str, list[str]] = {
    "i'm": ["i", "am"], "i'll": ["i", "will"], "i'd": ["i", "would"],
    "i've": ["i", "have"],
    "you're": ["you", "are"], "you'll": ["you", "will"], "you'd": ["you", "would"],
    "you've": ["you", "have"],
    "he's": ["he", "is"], "he'll": ["he", "will"], "he'd": ["he", "would"],
    "she's": ["she", "is"], "she'll": ["she", "will"], "she'd": ["she", "would"],
    "it's": ["it", "is"], "it'll": ["it", "will"], "it'd": ["it", "would"],
    "we're": ["we", "are"], "we'll": ["we", "will"], "we'd": ["we", "would"],
    "we've": ["we", "have"],
    "they're": ["they", "are"], "they'll": ["they", "will"], "they'd": ["they", "would"],
    "they've": ["they", "have"],
    "that's": ["that", "is"], "that'll": ["that", "will"], "that'd": ["that", "would"],
    "there's": ["there", "is"], "there'll": ["there", "will"],
    "here's": ["here", "is"],
    "what's": ["what", "is"], "what'll": ["what", "will"], "what'd": ["what", "did"],
    "who's": ["who", "is"], "who'll": ["who", "will"], "who'd": ["who", "would"],
    "where's": ["where", "is"],
    "when's": ["when", "is"],
    "how's": ["how", "is"],
    "don't": ["do", "not"], "doesn't": ["does", "not"], "didn't": ["did", "not"],
    "isn't": ["is", "not"], "aren't": ["are", "not"], "wasn't": ["was", "not"],
    "weren't": ["were", "not"],
    "won't": ["will", "not"], "wouldn't": ["would", "not"],
    "can't": ["can", "not"], "couldn't": ["could", "not"],
    "shouldn't": ["should", "not"],
    "hasn't": ["has", "not"], "haven't": ["have", "not"], "hadn't": ["had", "not"],
    "let's": ["let", "us"],
    # Spoken reductions — natural informal pronunciations
    "gonna": ["going", "to"],
    "gotta": ["got", "to"],
    "wanna": ["want", "to"],
    "hafta": ["have", "to"],
    "oughta": ["ought", "to"],
    "kinda": ["kind", "of"],
    "sorta": ["sort", "of"],
    "lotta": ["lot", "of"],
    "outta": ["out", "of"],
    "coulda": ["could", "have"],
    "shoulda": ["should", "have"],
    "woulda": ["would", "have"],
    "musta": ["must", "have"],
    "dunno": ["do", "not", "know"],
    "lemme": ["let", "me"],
    "gimme": ["give", "me"],
}

# Reverse lookup: which multi-word sequences are valid spoken reductions?
_REDUCTION_TARGETS: dict[tuple[str, ...], str] = {}
for _red, _parts in _CONTRACTIONS.items():
    if len(_parts) >= 2:
        _REDUCTION_TARGETS[tuple(_parts)] = _red


def _expand_contractions(words: list[str]) -> list[str]:
    """Expand contractions and spoken reductions for alignment."""
    result: list[str] = []
    for w in words:
        low = w.lower()
        if low in _CONTRACTIONS:
            result.extend(_CONTRACTIONS[low])
        else:
            result.append(low)
    return result


def _align_words(ref_words: list[str], asr_words: list[str]) -> list[int | None]:
    """Align reference words to ASR words using Needleman-Wunsch DP.

    Both inputs should already be expanded (contractions split) and lowered.
    Returns a list of length len(ref_words) where each entry is either the
    index of the matched ASR word or None (missed).
    """
    n = len(ref_words)
    m = len(asr_words)

    def sim(r: str, a: str) -> int:
        """Strict similarity: exact match or very close (edit distance ≤ 1
        for words > ALIGN_FUZZY_MIN_LEN chars).  Short words must match
        exactly — "a" must not match "I", "the" must not match "they"."""
        if r == a:
            return ALIGN_SCORE_EXACT
        if len(r) > ALIGN_FUZZY_MIN_LEN and len(a) > ALIGN_FUZZY_MIN_LEN:
            dist = _levenshtein(r, a)
            if dist == 1:
                return ALIGN_SCORE_CLOSE
            if dist == 2 and r[:ALIGN_STEM_PREFIX_LEN] == a[:ALIGN_STEM_PREFIX_LEN]:
                return ALIGN_SCORE_STEM
        return ALIGN_SCORE_MISMATCH

    NEG_INF = -999999
    dp = [[NEG_INF] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0
    for j in range(1, m + 1):
        dp[0][j] = 0  # skip leading ASR words freely

    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] + ALIGN_GAP_REF
        for j in range(1, m + 1):
            score_match = dp[i - 1][j - 1] + sim(ref_words[i - 1], asr_words[j - 1])
            score_skip_ref = dp[i - 1][j] + ALIGN_GAP_REF
            score_skip_asr = dp[i][j - 1] + ALIGN_GAP_ASR
            dp[i][j] = max(score_match, score_skip_ref, score_skip_asr)

    # Traceback
    alignment: list[int | None] = [None] * n
    i, j = n, m
    while i > 0:
        if j > 0 and dp[i][j] == dp[i - 1][j - 1] + sim(ref_words[i - 1], asr_words[j - 1]):
            s = sim(ref_words[i - 1], asr_words[j - 1])
            alignment[i - 1] = j - 1 if s > 0 else None
            i -= 1
            j -= 1
        elif dp[i][j] == dp[i - 1][j] + ALIGN_GAP_REF:
            alignment[i - 1] = None
            i -= 1
        else:
            j -= 1

    return alignment


def score_pronunciation(
    reference: str,
    asr: AsrResult,
    recognized_phonemes: list[RecognizedPhoneme],
    expected_phonemes: list[dict],
    recognition_result: PhonemeRecognitionResult | None = None,
    wav_path: str | None = None,
) -> tuple[dict, dict]:
    # ── Expand contractions in both reference and ASR ──
    raw_ref = [exp["word"].lower() for exp in expected_phonemes]
    raw_asr = [w.word.lower().strip(".,!?;:\"") for w in asr.words]

    # Build expanded reference with origin tracking
    exp_ref: list[str] = []
    exp_ref_origin: list[int] = []
    for i, w in enumerate(raw_ref):
        if w in _CONTRACTIONS:
            for part in _CONTRACTIONS[w]:
                exp_ref.append(part)
                exp_ref_origin.append(i)
        else:
            exp_ref.append(w)
            exp_ref_origin.append(i)

    exp_asr = _expand_contractions(raw_asr)

    # ── Word-level alignment (strict) ──
    expanded_alignment = _align_words(exp_ref, exp_asr)

    # Build mapping: expanded ASR index → original ASR word index
    exp_asr_to_orig: list[int] = []
    for j, w in enumerate(raw_asr):
        low = w.lower().strip(".,!?;:\"")
        count = len(_CONTRACTIONS[low]) if low in _CONTRACTIONS else 1
        for _ in range(count):
            exp_asr_to_orig.append(j)

    # Detect which original ASR words are spoken reductions (e.g. "gonna")
    asr_is_reduction: set[int] = set()
    for j, w in enumerate(raw_asr):
        low = w.lower().strip(".,!?;:\"")
        if low in _CONTRACTIONS and "'" not in low:
            asr_is_reduction.add(j)

    # Collapse expanded alignment back to original word indices
    orig_alignment: list[dict] = []
    for i in range(len(expected_phonemes)):
        exp_indices = [k for k, orig in enumerate(exp_ref_origin) if orig == i]
        matched_asr_indices = [expanded_alignment[k] for k in exp_indices if expanded_alignment[k] is not None]
        total_parts = len(exp_indices)
        matched_parts = len(matched_asr_indices)

        # Check if matched via a spoken reduction
        is_reduction = False
        if matched_asr_indices:
            orig_asr_set = {exp_asr_to_orig[idx] for idx in matched_asr_indices}
            if any(j in asr_is_reduction for j in orig_asr_set):
                is_reduction = True

        if matched_parts == total_parts:
            orig_alignment.append({
                "status": "matched", "asr_indices": matched_asr_indices,
                "is_reduction": is_reduction,
            })
        elif matched_parts > 0:
            orig_alignment.append({
                "status": "partial", "asr_indices": matched_asr_indices,
                "is_reduction": is_reduction,
            })
        else:
            orig_alignment.append({"status": "missed", "asr_indices": [], "is_reduction": False})

    # ── Per-word scoring ──
    word_details = []
    matched = 0.0

    for i, exp in enumerate(expected_phonemes):
        exp_phones = exp["phonemes"]
        align_info = orig_alignment[i]

        asr_word: AsrWord | None = None
        heard_as: str | None = None
        word_start: float = -1.0
        word_end: float = -1.0

        if align_info["status"] == "missed":
            status = "missed"
            word_phones: list[RecognizedPhoneme] = []
            phone_score = 0.0
        else:
            asr_indices_expanded = align_info["asr_indices"]

            # Map expanded ASR index → original ASR word index
            orig_asr_indices: list[int] = []
            exp_asr_cursor = 0
            orig_to_exp_ranges: list[tuple[int, int]] = []
            for j, w in enumerate(raw_asr):
                low = w.lower().strip(".,!?;:\"")
                start = exp_asr_cursor
                if low in _CONTRACTIONS:
                    exp_asr_cursor += len(_CONTRACTIONS[low])
                else:
                    exp_asr_cursor += 1
                orig_to_exp_ranges.append((start, exp_asr_cursor))

            for exp_idx in asr_indices_expanded:
                for j, (s, e) in enumerate(orig_to_exp_ranges):
                    if s <= exp_idx < e:
                        if j not in orig_asr_indices:
                            orig_asr_indices.append(j)
                        break

            if orig_asr_indices:
                first_asr = asr.words[orig_asr_indices[0]]
                last_asr = asr.words[orig_asr_indices[-1]]
                asr_word = first_asr
                word_start = first_asr.start
                word_end = last_asr.end

                # Check if ASR text differs from reference (compare expanded forms)
                asr_text_parts = []
                for j in orig_asr_indices:
                    low = asr.words[j].word.lower().strip(".,!?;:\"")
                    if low in _CONTRACTIONS:
                        asr_text_parts.extend(_CONTRACTIONS[low])
                    else:
                        asr_text_parts.append(low)
                ref_text_parts = _CONTRACTIONS.get(raw_ref[i], [raw_ref[i]])
                if asr_text_parts != ref_text_parts:
                    heard_as = " ".join(asr.words[j].word for j in orig_asr_indices)

                # Compute frame range for this word from Whisper timestamps
                frame_start = max(0, int((first_asr.start - PHONE_WINDOW_LEFT_MARGIN) / recognition_result.frame_duration)) if recognition_result else 0
                frame_end = min(
                    recognition_result.log_probs.shape[0],
                    int((last_asr.end + PHONE_WINDOW_RIGHT_MARGIN) / recognition_result.frame_duration)
                ) if recognition_result else 0

                # Collect greedy phonemes within time window (for recognized_phonemes display)
                word_phones = [
                    p for p in recognized_phonemes
                    if (first_asr.start - PHONE_WINDOW_LEFT_MARGIN) <= p.time <= (last_asr.end + PHONE_WINDOW_RIGHT_MARGIN)
                ]
            else:
                word_phones = []
                frame_start = 0
                frame_end = 0

            # Spoken reduction → accept as correct
            if align_info["is_reduction"]:
                phone_score = 100.0
                status = "correct"
                matched += WORD_MATCHED_CORRECT
                heard_as = None
                word_aligned_segments = []
            else:
                recognized_str = [p.phoneme for p in word_phones]

                if recognition_result and orig_asr_indices and frame_end > frame_start:
                    # Primary: CTC alignment + GOP scoring
                    phone_score, _method, word_aligned_segments = _score_with_gop(
                        exp_phones, recognized_str,
                        recognition_result.log_probs, frame_start, frame_end,
                        recognition_result.vocab,
                    )
                else:
                    # Fallback: pure Levenshtein (no log probs available)
                    exp_norm = _normalize_phonemes(exp_phones)
                    rec_norm = _normalize_phonemes(recognized_str)
                    if exp_norm and rec_norm:
                        dist = _weighted_levenshtein(exp_norm, rec_norm)
                        phone_score = max(0, (1 - dist / max(len(exp_norm), len(rec_norm), LEVENSHTEIN_MIN_DENOM))) * 100
                    elif not exp_norm:
                        phone_score = 100.0
                    else:
                        phone_score = 0.0
                    word_aligned_segments = []

                # Partial match → scale score by match ratio
                if align_info["status"] == "partial":
                    total_parts = len([k for k, o in enumerate(exp_ref_origin) if o == i])
                    matched_parts = len(align_info["asr_indices"])
                    partial_ratio = matched_parts / total_parts
                    phone_score = phone_score * partial_ratio

                # Determine status from phoneme score
                if phone_score >= WORD_SCORE_CORRECT:
                    status = "correct"
                    matched += WORD_MATCHED_CORRECT
                elif phone_score >= WORD_SCORE_PARTIAL:
                    status = "mispronounced"
                    matched += WORD_MATCHED_PARTIAL
                else:
                    status = "mispronounced"
                    matched += WORD_MATCHED_BAD

        avg_conf = (
            sum(p.confidence for p in word_phones) / len(word_phones)
            if word_phones else 0
        )
        whisper_prob = asr_word.probability if asr_word else 0

        # Build per-phoneme alignment data for the response
        fd = recognition_result.frame_duration if recognition_result else 0
        phoneme_alignment = [
            {
                "phoneme": seg.phoneme,
                "start": round(seg.start * fd, 4) if seg.start >= 0 else None,
                "end": round(seg.end * fd, 4) if seg.end >= 0 else None,
                "score": seg.score,
            }
            for seg in word_aligned_segments
        ] if word_aligned_segments else []

        word_details.append({
            "word": exp["word"],
            "status": status,
            "heard_as": heard_as,
            "pronunciation_score": round(phone_score),
            "expected_phonemes": " ".join(exp_phones),
            "recognized_phonemes": " ".join(p.phoneme for p in word_phones) if align_info["status"] != "missed" else "",
            "phoneme_alignment": phoneme_alignment,
            "confidence": round(avg_conf * 100),
            "whisper_confidence": round(whisper_prob * 100),
            "word_start": word_start,
            "word_end": word_end,
        })

    total = len(expected_phonemes) or 1
    accuracy = min(100, round((matched / total) * 100))

    phone_scores = [w["pronunciation_score"] for w in word_details if w["status"] != "missed"]
    pronunciation = round(sum(phone_scores) / len(phone_scores)) if phone_scores else 0

    fluency = _compute_fluency(asr)

    # Prosody scoring (stress, intonation, rhythm)
    if wav_path:
        prosody = _compute_prosody(wav_path, asr, word_details)
    else:
        prosody = {"stress": PROSODY_DEFAULT, "intonation": PROSODY_DEFAULT, "rhythm": PROSODY_DEFAULT}
    prosody_avg = round((prosody["stress"] + prosody["intonation"] + prosody["rhythm"]) / 3)

    # Accuracy gates pronunciation/fluency/prosody
    accuracy_factor = min(1.0, accuracy / ACCURACY_GATE_THRESHOLD)
    effective_pronunciation = round(pronunciation * accuracy_factor)
    effective_fluency = round(fluency * accuracy_factor)
    effective_prosody = round(prosody_avg * accuracy_factor)

    overall = round(
        accuracy * OVERALL_W_ACCURACY
        + effective_pronunciation * OVERALL_W_PRONUNCIATION
        + effective_fluency * OVERALL_W_FLUENCY
        + effective_prosody * OVERALL_W_PROSODY
    )

    score = {
        "accuracy": accuracy,
        "pronunciation": effective_pronunciation,
        "fluency": effective_fluency,
        "prosody": {
            "stress": prosody["stress"],
            "intonation": prosody["intonation"],
            "rhythm": prosody["rhythm"],
            "overall": effective_prosody,
        },
        "overall": overall,
        "word_details": word_details,
        "matched": matched,
        "total": len(expected_phonemes),
    }

    feedback = _generate_feedback(word_details, pronunciation, fluency, prosody)

    return score, feedback


def _compute_fluency(asr: AsrResult) -> int:
    """Score fluency based on speaking rate, pauses, and rhythm."""
    if len(asr.words) < FLUENCY_MIN_WORDS:
        return FLUENCY_DEFAULT

    gaps = [
        asr.words[i].start - asr.words[i - 1].end
        for i in range(1, len(asr.words))
    ]
    avg_gap = sum(gaps) / len(gaps)
    max_gap = max(gaps)

    total_time = asr.words[-1].end - asr.words[0].start
    if total_time <= 0:
        return FLUENCY_DEFAULT
    wps = len(asr.words) / total_time

    # ── Speaking rate score ──
    if wps < FLUENCY_RATE_VERY_SLOW:
        rate_score = max(RATE_FLOOR_VERY_SLOW, int(wps / FLUENCY_RATE_VERY_SLOW * RATE_SCALE_VERY_SLOW))
    elif wps < FLUENCY_RATE_SLOW:
        rate_score = max(RATE_FLOOR_SLOW, int(RATE_FLOOR_SLOW + (wps - FLUENCY_RATE_VERY_SLOW) * RATE_SCALE_SLOW))
    elif wps <= FLUENCY_RATE_FAST_MAX:
        rate_score = min(100, int(RATE_BASE_SWEET + (min(wps, FLUENCY_RATE_SWEET_MAX) - FLUENCY_RATE_SLOW) / RATE_SWEET_DIVISOR * RATE_SWEET_SCALE))
    else:
        rate_score = max(RATE_FLOOR_FAST, int(100 - (wps - FLUENCY_RATE_FAST_MAX) * RATE_SCALE_FAST))

    # ── Gap score (average inter-word gap) ──
    if avg_gap <= FLUENCY_GAP_PERFECT:
        gap_score = 100
    elif avg_gap <= FLUENCY_GAP_OKAY:
        gap_score = max(GAP_FLOOR_OKAY, int(100 - (avg_gap - FLUENCY_GAP_PERFECT) * GAP_SCALE_OKAY))
    elif avg_gap <= FLUENCY_GAP_SLOW:
        gap_score = max(GAP_FLOOR_SLOW, int(GAP_FLOOR_OKAY - (avg_gap - FLUENCY_GAP_OKAY) * GAP_SCALE_SLOW))
    else:
        gap_score = max(GAP_FLOOR_VERY_SLOW, int(GAP_FLOOR_SLOW - (avg_gap - FLUENCY_GAP_SLOW) * GAP_SCALE_VERY_SLOW))

    # ── Pause penalty (longest gap) ──
    if max_gap <= FLUENCY_PAUSE_FINE:
        pause_score = 100
    elif max_gap <= FLUENCY_PAUSE_NOTICE:
        pause_score = max(PAUSE_FLOOR_NOTICE, int(100 - (max_gap - FLUENCY_PAUSE_FINE) * PAUSE_SCALE_NOTICE))
    elif max_gap <= FLUENCY_PAUSE_LONG:
        pause_score = max(PAUSE_FLOOR_LONG, int(PAUSE_FLOOR_NOTICE - (max_gap - FLUENCY_PAUSE_NOTICE) * PAUSE_SCALE_LONG))
    else:
        pause_score = FLUENCY_PAUSE_FLOOR

    return min(100, round(
        rate_score * FLUENCY_W_RATE
        + gap_score * FLUENCY_W_GAP
        + pause_score * FLUENCY_W_PAUSE
    ))


# ── Prosody scoring ────────────────────────────────────────────────────────

# English function words — these are normally unstressed in natural speech.
# Content words (nouns, verbs, adjectives, adverbs) carry stress.
_FUNCTION_WORDS: set[str] = {
    "a", "an", "the", "is", "am", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall", "should",
    "may", "might", "can", "could", "must",
    "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his",
    "she", "her", "hers", "it", "its", "we", "us", "our", "ours",
    "they", "them", "their", "theirs",
    "this", "that", "these", "those",
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "up", "about",
    "into", "through", "during", "before", "after", "above", "below", "between",
    "and", "but", "or", "nor", "so", "yet", "if", "when", "while", "as",
    "not", "no", "than", "then", "just", "also", "very", "too",
}


def _extract_f0(waveform: torch.Tensor, sr: int) -> torch.Tensor:
    """Extract fundamental frequency (F0) using torchaudio's pitch detection.

    Returns a 1-D tensor of F0 values in Hz (0 = unvoiced frames).
    frame_time = hop between frames (F0_HOP_LENGTH = 10ms).
    win_length = analysis window in ms (F0_FRAME_LENGTH * 1000 = 32ms).
    """
    f0 = torchaudio.functional.detect_pitch_frequency(
        waveform, sr,
        frame_time=F0_HOP_LENGTH,
        win_length=int(F0_FRAME_LENGTH * 1000),
        freq_low=int(F0_FMIN),
        freq_high=int(F0_FMAX),
    )
    return f0.squeeze()  # (num_frames,)


def _word_rms_energy(
    waveform: torch.Tensor, sr: int, start: float, end: float,
) -> float:
    """Compute RMS energy of waveform between start and end (seconds)."""
    s = max(0, int(start * sr))
    e = min(waveform.shape[-1], int(end * sr))
    if e <= s:
        return 0.0
    segment = waveform[..., s:e].float()
    return segment.pow(2).mean().sqrt().item()


def _compute_stress(
    waveform: torch.Tensor, sr: int, word_details: list[dict],
) -> int:
    """Score stress placement (0–100).

    Compares average RMS energy of content words vs function words.
    Natural English has content words ~1.3–2.5x louder than function words.
    Uses word_start/word_end from alignment (not positional ASR index).
    """
    content_energies: list[float] = []
    function_energies: list[float] = []

    for wd in word_details:
        if wd["status"] == "missed":
            continue
        ws = wd.get("word_start", -1.0)
        we = wd.get("word_end", -1.0)
        if ws < 0 or we <= ws:
            continue
        rms = _word_rms_energy(waveform, sr, ws, we)
        if rms <= 0:
            continue
        if wd["word"].lower() in _FUNCTION_WORDS:
            function_energies.append(rms)
        else:
            content_energies.append(rms)

    if not content_energies or not function_energies:
        return PROSODY_DEFAULT

    avg_content = sum(content_energies) / len(content_energies)
    avg_function = sum(function_energies) / len(function_energies)

    if avg_function <= 0:
        return PROSODY_DEFAULT

    ratio = avg_content / avg_function

    # Score mapping
    if STRESS_RATIO_SWEET_LOW <= ratio <= STRESS_RATIO_SWEET_HIGH:
        # Sweet spot — scale 80–100 based on position within range
        mid = (STRESS_RATIO_SWEET_LOW + STRESS_RATIO_SWEET_HIGH) / 2
        dist = abs(ratio - mid) / (STRESS_RATIO_SWEET_HIGH - STRESS_RATIO_SWEET_LOW) * 2
        return min(100, max(80, int(100 - dist * 20)))
    elif ratio < STRESS_RATIO_SWEET_LOW:
        # Too flat — linearly scale from STRESS_FLAT_PENALTY to 80
        t = max(0, (ratio - 1.0) / (STRESS_RATIO_SWEET_LOW - 1.0))
        return min(100, max(STRESS_FLAT_PENALTY, int(STRESS_FLAT_PENALTY + t * (80 - STRESS_FLAT_PENALTY))))
    else:
        # Over-emphasized — penalize but less harshly
        overshoot = ratio - STRESS_RATIO_SWEET_HIGH
        return min(100, max(0, int(80 - overshoot * 15)))


def _compute_intonation(
    waveform: torch.Tensor, sr: int, asr: AsrResult,
) -> int:
    """Score intonation (0–100) based on F0 variation.

    Measures the standard deviation of voiced F0 across the utterance.
    Too flat → monotone. Too much variation → exaggerated or unstable.
    """
    if len(asr.words) < PROSODY_MIN_WORDS:
        return PROSODY_DEFAULT

    f0 = _extract_f0(waveform, sr)
    if f0.numel() == 0:
        return PROSODY_DEFAULT

    # Keep only voiced frames (F0 > 0) within speech region
    speech_start = asr.words[0].start
    speech_end = asr.words[-1].end
    hop_dur = F0_HOP_LENGTH
    frame_start = max(0, int(speech_start / hop_dur))
    frame_end = min(f0.numel(), int(speech_end / hop_dur))

    if frame_end <= frame_start:
        return PROSODY_DEFAULT

    f0_speech = f0[frame_start:frame_end]
    voiced = f0_speech[f0_speech > F0_FMIN]

    if voiced.numel() < 10:
        return PROSODY_DEFAULT

    f0_std = voiced.std().item()

    # Score mapping
    if f0_std < INTONATION_F0_STD_LOW:
        # Very flat — monotone
        return min(100, max(INTONATION_FLAT_FLOOR, int(INTONATION_FLAT_FLOOR + (f0_std / INTONATION_F0_STD_LOW) * (50 - INTONATION_FLAT_FLOOR))))
    elif f0_std < INTONATION_F0_STD_SWEET:
        # Below ideal but acceptable — 50–80
        t = (f0_std - INTONATION_F0_STD_LOW) / (INTONATION_F0_STD_SWEET - INTONATION_F0_STD_LOW)
        return min(100, max(0, int(50 + t * 30)))
    elif f0_std <= INTONATION_F0_STD_HIGH:
        # Sweet spot — 80–100
        t = (f0_std - INTONATION_F0_STD_SWEET) / (INTONATION_F0_STD_HIGH - INTONATION_F0_STD_SWEET)
        return min(100, int(80 + t * 20))
    else:
        # Exaggerated — penalize
        overshoot = f0_std - INTONATION_F0_STD_HIGH
        return min(100, max(0, int(80 - overshoot * 0.5)))


def _compute_rhythm(
    word_details: list[dict],
) -> int:
    """Score rhythm (0–100) using normalized Pairwise Variability Index (nPVI).

    nPVI measures durational variability between successive vowel intervals.
    English (stress-timed) has higher nPVI (~55–75) than syllable-timed languages.
    Too regular (low nPVI) = robotic; too irregular (high nPVI) = choppy.
    """
    # Collect word durations for matched words as a proxy for syllable intervals
    # Uses word_start/word_end from alignment (not positional ASR index).
    durations: list[float] = []
    for wd in word_details:
        if wd["status"] == "missed":
            continue
        ws = wd.get("word_start", -1.0)
        we = wd.get("word_end", -1.0)
        if ws < 0 or we <= ws:
            continue
        dur = we - ws
        if dur > 0.01:  # skip near-zero durations
            durations.append(dur)

    if len(durations) < PROSODY_MIN_WORDS:
        return PROSODY_DEFAULT

    # Compute nPVI: 100 * mean(|d_k - d_{k+1}| / ((d_k + d_{k+1})/2))
    pvi_sum = 0.0
    n_pairs = 0
    for k in range(len(durations) - 1):
        d1 = durations[k]
        d2 = durations[k + 1]
        avg = (d1 + d2) / 2
        if avg > 0:
            pvi_sum += abs(d1 - d2) / avg
            n_pairs += 1

    if n_pairs == 0:
        return PROSODY_DEFAULT

    npvi = 100.0 * pvi_sum / n_pairs

    # Score mapping
    if RHYTHM_NPVI_SWEET_LOW <= npvi <= RHYTHM_NPVI_SWEET_HIGH:
        # Sweet spot — 80–100
        mid = (RHYTHM_NPVI_SWEET_LOW + RHYTHM_NPVI_SWEET_HIGH) / 2
        dist = abs(npvi - mid) / ((RHYTHM_NPVI_SWEET_HIGH - RHYTHM_NPVI_SWEET_LOW) / 2)
        return min(100, max(80, int(100 - dist * 20)))
    elif npvi < RHYTHM_NPVI_SWEET_LOW:
        # Too regular (syllable-timed / robotic)
        t = npvi / RHYTHM_NPVI_SWEET_LOW
        return min(100, max(RHYTHM_TOO_REGULAR_FLOOR, int(RHYTHM_TOO_REGULAR_FLOOR + t * (80 - RHYTHM_TOO_REGULAR_FLOOR))))
    else:
        # Too irregular (choppy)
        overshoot = npvi - RHYTHM_NPVI_SWEET_HIGH
        return min(100, max(0, int(80 - overshoot * 0.5)))


def _compute_prosody(
    wav_path: str, asr: AsrResult, word_details: list[dict],
) -> dict[str, int]:
    """Compute prosody scores: stress, intonation, rhythm.

    Loads the waveform once and passes it to each sub-scorer.
    Returns {"stress": int, "intonation": int, "rhythm": int}.
    """
    matched_count = sum(1 for w in word_details if w["status"] != "missed")
    if matched_count < PROSODY_MIN_WORDS:
        return {
            "stress": PROSODY_DEFAULT,
            "intonation": PROSODY_DEFAULT,
            "rhythm": PROSODY_DEFAULT,
        }

    waveform, sr = torchaudio.load(wav_path)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)

    stress = _compute_stress(waveform, sr, word_details)
    intonation = _compute_intonation(waveform, sr, asr)
    rhythm = _compute_rhythm(word_details)

    return {
        "stress": stress,
        "intonation": intonation,
        "rhythm": rhythm,
    }


def _generate_feedback(
    word_details: list[dict], pronunciation: int, fluency: int,
    prosody: dict[str, int] | None = None,
) -> dict:
    tips: list[str] = []

    mispronounced = [w for w in word_details if w["status"] == "mispronounced"]
    missed = [w for w in word_details if w["status"] == "missed"]

    for w in mispronounced[:FEEDBACK_MAX_MISPRONOUNCED]:
        if w["expected_phonemes"] and w["recognized_phonemes"]:
            tips.append(
                f"'{w['word']}': expected /{w['expected_phonemes']}/, "
                f"heard /{w['recognized_phonemes']}/"
            )
        elif w.get("heard_as"):
            tips.append(f"'{w['word']}': heard as '{w['heard_as']}'")

    for w in missed[:FEEDBACK_MAX_MISSED]:
        tips.append(f"'{w['word']}' was not detected — try pronouncing it more clearly")

    if fluency < FEEDBACK_FLUENCY_WARN:
        tips.append("Try to speak more fluently with fewer pauses between words")

    # Prosody feedback
    if prosody:
        if prosody["stress"] < FEEDBACK_STRESS_WARN:
            tips.append("Try stressing key words more — emphasize nouns and verbs")
        if prosody["intonation"] < FEEDBACK_INTONATION_WARN:
            tips.append("Vary your pitch more — avoid speaking in a flat tone")
        if prosody["rhythm"] < FEEDBACK_RHYTHM_WARN:
            tips.append("Work on your speech rhythm — vary the length of syllables naturally")

    if pronunciation >= FEEDBACK_GREAT_THRESHOLD:
        summary = "Great pronunciation! Keep it up."
    elif pronunciation >= FEEDBACK_GOOD_THRESHOLD:
        summary = "Good attempt! A few words need work."
    elif pronunciation >= FEEDBACK_KEEP_THRESHOLD:
        summary = "Keep practicing — focus on the highlighted words."
    else:
        summary = "Listen to the original again and try speaking slowly."

    return {"summary": summary, "tips": tips}


# ── Helpers ─────────────────────────────────────────────────────────────────

def _levenshtein(a: str, b: str) -> int:
    if len(a) < len(b):
        return _levenshtein(b, a)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for ca in a:
        curr = [prev[0] + 1]
        for j, cb in enumerate(b):
            curr.append(min(curr[j] + 1, prev[j + 1] + 1, prev[j] + (0 if ca == cb else 1)))
        prev = curr
    return prev[-1]


def _levenshtein_list(a: list, b: list) -> int:
    if len(a) < len(b):
        return _levenshtein_list(b, a)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for ca in a:
        curr = [prev[0] + 1]
        for j, cb in enumerate(b):
            curr.append(min(curr[j] + 1, prev[j + 1] + 1, prev[j] + (0 if ca == cb else 1)))
        prev = curr
    return prev[-1]


# ── Audio conversion ────────────────────────────────────────────────────────

def to_wav(input_path: str) -> str:
    """Convert any audio format to 16kHz mono WAV using ffmpeg."""
    wav_path = input_path.rsplit(".", 1)[0] + ".wav"
    subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-ar", "16000", "-ac", "1", "-f", "wav", wav_path],
        capture_output=True,
    )
    return wav_path


# ── Main entry point ───────────────────────────────────────────────────────

def process_word(audio_path: str, word: str) -> dict:
    """Run pronunciation scoring for a single word."""
    wav_path = to_wav(audio_path)

    try:
        asr = asr_transcribe(wav_path)
        rec_result = recognize_phonemes_full(wav_path)
        expected = text_to_phonemes(word)

        if not expected:
            return {
                "word": word,
                "transcript": asr.transcript,
                "status": "missed",
                "pronunciation_score": 0,
                "expected_phonemes": "",
                "recognized_phonemes": "",
                "heard_as": asr.transcript or None,
            }

        exp = expected[0]
        exp_phones = exp["phonemes"]

        # Use all recognized phonemes for the single word
        rec_phones = [p.phoneme for p in rec_result.phonemes]
        rec_norm = _normalize_phonemes(rec_phones)

        if not rec_norm:
            # No phonemes recognized — treat as missed
            return {
                "word": word,
                "transcript": asr.transcript,
                "status": "missed",
                "pronunciation_score": 0,
                "expected_phonemes": " ".join(exp_phones),
                "recognized_phonemes": "",
                "heard_as": asr.transcript or None,
            }

        # GOP scoring — use full audio range for single word
        frame_end = rec_result.log_probs.shape[0]
        phone_score, _method, aligned_segs = _score_with_gop(
            exp_phones, rec_phones,
            rec_result.log_probs, 0, frame_end,
            rec_result.vocab,
        )

        # Determine status
        if phone_score >= WORD_SCORE_CORRECT:
            status = "correct"
        elif phone_score >= WORD_SCORE_PARTIAL:
            status = "mispronounced"
        else:
            status = "mispronounced"

        # Check if ASR heard a different word (strip outer punctuation, keep apostrophes)
        asr_text = asr.transcript.strip().lower().strip(".,!?;:\"")
        ref_lower = word.strip().lower().strip(".,!?;:\"")
        heard_as = asr.transcript if asr_text != ref_lower else None

        # Build per-phoneme alignment data
        fd = rec_result.frame_duration
        phoneme_alignment = [
            {
                "phoneme": seg.phoneme,
                "start": round(seg.start * fd, 4) if seg.start >= 0 else None,
                "end": round(seg.end * fd, 4) if seg.end >= 0 else None,
                "score": seg.score,
            }
            for seg in aligned_segs
        ]

        return {
            "word": word,
            "transcript": asr.transcript,
            "status": status,
            "pronunciation_score": round(phone_score),
            "expected_phonemes": " ".join(exp_phones),
            "recognized_phonemes": " ".join(p.phoneme for p in rec_result.phonemes),
            "phoneme_alignment": phoneme_alignment,
            "heard_as": heard_as,
        }
    finally:
        if wav_path != audio_path:
            try:
                os.unlink(wav_path)
            except OSError:
                pass


def process(audio_path: str, reference_text: str) -> dict:
    """Run the full pronunciation scoring pipeline."""
    wav_path = to_wav(audio_path)

    try:
        # [1] ASR — honest transcription, no reference bias
        asr = asr_transcribe(wav_path)

        # [2] Phoneme recognition (full — includes log probs for GOP)
        rec_result = recognize_phonemes_full(wav_path)

        # [3] G2P
        expected = text_to_phonemes(reference_text)

        # [4] Scoring — pass full recognition result for GOP + wav for prosody
        score, feedback = score_pronunciation(
            reference_text, asr, rec_result.phonemes, expected,
            recognition_result=rec_result,
            wav_path=wav_path,
        )

        return {
            "transcript": asr.transcript,
            "reference": reference_text,
            "score": score,
            "feedback": feedback,
        }
    finally:
        if wav_path != audio_path:
            try:
                os.unlink(wav_path)
            except OSError:
                pass
