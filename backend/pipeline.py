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
EDIT_COST_INSERT = 1.0          # cost of an extra spoken phoneme
EDIT_COST_DELETE = 1.0          # cost of a missing expected phoneme

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
PHONE_WINDOW_LEFT_MARGIN = 0.0  # no left margin — prevents bleeding from previous word
PHONE_WINDOW_RIGHT_MARGIN = 0.03  # 30ms right margin to catch trailing consonants

# ── Word scoring thresholds ───────────────────────────────────────────────
# Applied to per-word phoneme scores to determine correct/mispronounced/missed.
WORD_SCORE_CORRECT = 80         # phoneme score ≥ this → "correct"
WORD_SCORE_PARTIAL = 50         # phoneme score ≥ this → "mispronounced" (partial credit)
WORD_MATCHED_CORRECT = 1.0     # accuracy credit for a correct word
WORD_MATCHED_PARTIAL = 0.5     # accuracy credit for a mispronounced word (score ≥ 50)
WORD_MATCHED_BAD = 0.2         # accuracy credit for a badly mispronounced word (score < 50)

# ── Overall score formula ─────────────────────────────────────────────────
# overall = accuracy * W_ACCURACY + pronunciation * W_PRONUNCIATION + fluency * W_FLUENCY
OVERALL_W_ACCURACY = 0.3        # weight of accuracy in overall score
OVERALL_W_PRONUNCIATION = 0.5   # weight of pronunciation in overall score
OVERALL_W_FLUENCY = 0.2         # weight of fluency in overall score

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


def recognize_phonemes(wav_path: str) -> list[RecognizedPhoneme]:
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
            phonemes.append(RecognizedPhoneme(
                phoneme=token,
                time=i * frame_dur,
                confidence=log_probs[i, tid].exp().item(),
            ))
        prev_id = tid

    return phonemes


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
    return s  # fallback: return as-is for very large numbers


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
    # Syllabics
    "əl": ["ə", "l"],
}

# Strip length mark — treat long/short as same base phoneme during comparison.
_LENGTH_STRIP = str.maketrans("", "", "ː")


def _normalize_phonemes(tokens: list[str]) -> list[str]:
    """Normalize a phoneme token list to atomic, length-stripped form."""
    out: list[str] = []
    for tok in tokens:
        if tok in _COMPOUND_SPLITS:
            out.extend(_COMPOUND_SPLITS[tok])
        else:
            stripped = tok.translate(_LENGTH_STRIP)
            if stripped:
                out.append(stripped)
    return out


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


def _weighted_levenshtein(a: list[str], b: list[str]) -> float:
    """Edit distance using phonetic substitution costs instead of flat 0/1."""
    if len(a) < len(b):
        return _weighted_levenshtein(b, a)
    if not b:
        return float(len(a))
    prev = [float(i) for i in range(len(b) + 1)]
    for ca in a:
        curr = [prev[0] + EDIT_COST_DELETE]
        for j, cb in enumerate(b):
            sub_cost = _phone_distance(ca, cb)
            curr.append(min(
                curr[j] + EDIT_COST_INSERT,
                prev[j + 1] + EDIT_COST_DELETE,
                prev[j] + sub_cost,
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
) -> tuple[dict, dict]:
    # ── Expand contractions in both reference and ASR ──
    raw_ref = [exp["word"].lower() for exp in expected_phonemes]
    raw_asr = [w.word.lower().strip(".,!?;:\"'") for w in asr.words]

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
        low = w.lower().strip(".,!?;:\"'")
        count = len(_CONTRACTIONS[low]) if low in _CONTRACTIONS else 1
        for _ in range(count):
            exp_asr_to_orig.append(j)

    # Detect which original ASR words are spoken reductions (e.g. "gonna")
    asr_is_reduction: set[int] = set()
    for j, w in enumerate(raw_asr):
        low = w.lower().strip(".,!?;:\"'")
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
                low = w.lower().strip(".,!?;:\"'")
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

                # Check if ASR text differs from reference (compare expanded forms)
                asr_text_parts = []
                for j in orig_asr_indices:
                    low = asr.words[j].word.lower().strip(".,!?;:\"'")
                    if low in _CONTRACTIONS:
                        asr_text_parts.extend(_CONTRACTIONS[low])
                    else:
                        asr_text_parts.append(low)
                ref_text_parts = _CONTRACTIONS.get(raw_ref[i], [raw_ref[i]])
                if asr_text_parts != ref_text_parts:
                    heard_as = " ".join(asr.words[j].word for j in orig_asr_indices)

                # Collect phonemes within the word's time window
                word_phones = [
                    p for p in recognized_phonemes
                    if (first_asr.start + PHONE_WINDOW_LEFT_MARGIN) <= p.time <= (last_asr.end + PHONE_WINDOW_RIGHT_MARGIN)
                ]
            else:
                word_phones = []

            # Spoken reduction → accept as correct
            if align_info["is_reduction"]:
                phone_score = 100.0
                status = "correct"
                matched += WORD_MATCHED_CORRECT
                heard_as = None
            else:
                # Phoneme scoring
                recognized_str = [p.phoneme for p in word_phones]
                exp_norm = _normalize_phonemes(exp_phones)
                rec_norm = _normalize_phonemes(recognized_str)

                if exp_norm and rec_norm:
                    dist = _weighted_levenshtein(exp_norm, rec_norm)
                    phone_score = max(0, (1 - dist / max(len(exp_norm), len(rec_norm)))) * 100
                elif not exp_norm:
                    phone_score = 100.0
                else:
                    phone_score = 0.0

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

        word_details.append({
            "word": exp["word"],
            "status": status,
            "heard_as": heard_as,
            "pronunciation_score": round(phone_score),
            "expected_phonemes": " ".join(exp_phones),
            "recognized_phonemes": " ".join(p.phoneme for p in word_phones) if align_info["status"] != "missed" else "",
            "confidence": round(avg_conf * 100),
            "whisper_confidence": round(whisper_prob * 100),
        })

    total = len(expected_phonemes) or 1
    accuracy = min(100, round((matched / total) * 100))

    phone_scores = [w["pronunciation_score"] for w in word_details if w["status"] != "missed"]
    pronunciation = round(sum(phone_scores) / len(phone_scores)) if phone_scores else 0

    fluency = _compute_fluency(asr)

    # Accuracy gates pronunciation/fluency
    accuracy_factor = min(1.0, accuracy / ACCURACY_GATE_THRESHOLD)
    effective_pronunciation = round(pronunciation * accuracy_factor)
    effective_fluency = round(fluency * accuracy_factor)

    overall = round(
        accuracy * OVERALL_W_ACCURACY
        + effective_pronunciation * OVERALL_W_PRONUNCIATION
        + effective_fluency * OVERALL_W_FLUENCY
    )

    score = {
        "accuracy": accuracy,
        "pronunciation": effective_pronunciation,
        "fluency": effective_fluency,
        "overall": overall,
        "word_details": word_details,
        "matched": matched,
        "total": len(expected_phonemes),
    }

    feedback = _generate_feedback(word_details, pronunciation, fluency)

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


def _generate_feedback(word_details: list[dict], pronunciation: int, fluency: int) -> dict:
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
        recognized = recognize_phonemes(wav_path)
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
        rec_phones = [p.phoneme for p in recognized]
        exp_norm = _normalize_phonemes(exp_phones)
        rec_norm = _normalize_phonemes(rec_phones)

        if exp_norm and rec_norm:
            dist = _weighted_levenshtein(exp_norm, rec_norm)
            phone_score = max(0, (1 - dist / max(len(exp_norm), len(rec_norm)))) * 100
        elif not exp_norm:
            phone_score = 100.0
        else:
            phone_score = 0.0

        # Determine status
        if phone_score >= WORD_SCORE_CORRECT:
            status = "correct"
        elif phone_score >= WORD_SCORE_PARTIAL:
            status = "mispronounced"
        else:
            status = "mispronounced"

        # Check if ASR heard a different word
        asr_text = asr.transcript.strip().lower()
        ref_lower = word.strip().lower()
        heard_as = asr.transcript if asr_text != ref_lower else None

        return {
            "word": word,
            "transcript": asr.transcript,
            "status": status,
            "pronunciation_score": round(phone_score),
            "expected_phonemes": " ".join(exp_phones),
            "recognized_phonemes": " ".join(p.phoneme for p in recognized),
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

        # [2] Phoneme recognition
        recognized = recognize_phonemes(wav_path)

        # [3] G2P
        expected = text_to_phonemes(reference_text)

        # [4] Scoring
        score, feedback = score_pronunciation(reference_text, asr, recognized, expected)

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
