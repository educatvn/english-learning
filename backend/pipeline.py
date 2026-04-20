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


# ── Models (loaded once on startup) ─────────────────────────────────────────

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
    # Handle common cases without a heavy dependency
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
    # Match alphabetic words and numeric tokens
    raw_tokens = re.findall(r"[a-zA-Z']+|\d+", text)
    if not raw_tokens:
        return []

    # Expand numbers to words, then flatten into individual word tokens
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
# The distinction matters for advanced learners but not for basic scoring.
_LENGTH_STRIP = str.maketrans("", "", "ː")


def _normalize_phonemes(tokens: list[str]) -> list[str]:
    """Normalize a phoneme token list to atomic, length-stripped form."""
    out: list[str] = []
    for tok in tokens:
        if tok in _COMPOUND_SPLITS:
            out.extend(_COMPOUND_SPLITS[tok])
        else:
            # Strip length mark (ː) from any token
            stripped = tok.translate(_LENGTH_STRIP)
            if stripped:
                out.append(stripped)
    return out


# Phonetic feature groups — substitution within the same group costs less
# than across groups.  This prevents minor accent variations (e.g. /θ/ vs /ð/)
# from being penalized as heavily as completely wrong sounds (/θ/ vs /k/).
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
    """Substitution cost between two phonemes based on phonetic similarity.

    Returns 0.0 (identical), 0.2 (same group, e.g. /s/↔/z/),
    0.5 (near-pair across groups, e.g. /θ/↔/t/),
    or 1.0 (different groups, e.g. /θ/↔/k/).
    """
    if a == b:
        return 0.0
    ga = _PHONE_GROUPS.get(a)
    gb = _PHONE_GROUPS.get(b)
    if ga is not None and gb is not None and ga == gb:
        return 0.2
    if (a, b) in _NEAR_PAIRS:
        return 0.5
    return 1.0


def _weighted_levenshtein(a: list[str], b: list[str]) -> float:
    """Edit distance using phonetic substitution costs instead of flat 0/1."""
    if len(a) < len(b):
        return _weighted_levenshtein(b, a)
    if not b:
        return float(len(a))
    prev = [float(i) for i in range(len(b) + 1)]
    for ca in a:
        curr = [prev[0] + 1.0]
        for j, cb in enumerate(b):
            sub_cost = _phone_distance(ca, cb)
            curr.append(min(
                curr[j] + 1.0,       # insert
                prev[j + 1] + 1.0,   # delete
                prev[j] + sub_cost,   # substitute
            ))
        prev = curr
    return prev[-1]


# ── [4] Scoring Engine ──────────────────────────────────────────────────────

def _align_words(ref_words: list[str], asr_words: list[str]) -> list[int | None]:
    """Align reference words to ASR words using DP (Needleman-Wunsch style).

    Returns a list of length len(ref_words) where each entry is either the
    index of the matched ASR word or None (missed).  Matches are order-
    preserving and at most 1-to-1.
    """
    n = len(ref_words)
    m = len(asr_words)

    def sim(r: str, a: str) -> int:
        if r == a:
            return 3
        dist = _levenshtein(r, a)
        threshold = 1 if len(r) <= 4 else 2
        if dist <= threshold:
            return 1
        return -2

    # dp[i][j] = best score aligning ref[:i] with asr[:j]
    NEG_INF = -999999
    dp = [[NEG_INF] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0
    # Allow skipping ASR words at the start (no penalty)
    for j in range(1, m + 1):
        dp[0][j] = 0

    GAP_REF = -1  # penalty for skipping a reference word (missed)
    GAP_ASR = 0   # no penalty for skipping an ASR word (extra word in transcript)

    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] + GAP_REF
        for j in range(1, m + 1):
            # Option 1: match ref[i-1] with asr[j-1]
            score_match = dp[i - 1][j - 1] + sim(ref_words[i - 1], asr_words[j - 1])
            # Option 2: skip ref word (mark as missed)
            score_skip_ref = dp[i - 1][j] + GAP_REF
            # Option 3: skip ASR word (extra word spoken)
            score_skip_asr = dp[i][j - 1] + GAP_ASR
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
        elif dp[i][j] == dp[i - 1][j] + GAP_REF:
            alignment[i - 1] = None
            i -= 1
        else:
            j -= 1

    return alignment


def _forced_align_phonemes(
    expected: list[dict],
    recognized: list[RecognizedPhoneme],
) -> list[tuple[list[RecognizedPhoneme], float]]:
    """Align reference words to recognized phonemes via phoneme-level DP.

    Instead of relying on Whisper word boundaries (which are affected by
    auto-correction), we align the full stream of recognized phonemes
    directly against the concatenated expected-phoneme sequence, then
    split the result back into per-word segments.

    Returns a list (one per reference word) of (matched_phonemes, score).
    """
    # Build flat expected sequence with word boundaries
    flat_exp: list[str] = []
    word_boundaries: list[tuple[int, int]] = []  # (start_idx, end_idx) in flat_exp
    for exp in expected:
        norm = _normalize_phonemes(exp["phonemes"])
        start = len(flat_exp)
        flat_exp.extend(norm)
        word_boundaries.append((start, len(flat_exp)))

    rec_norm = _normalize_phonemes([p.phoneme for p in recognized])

    if not flat_exp or not rec_norm:
        return [([], 0.0)] * len(expected)

    n = len(flat_exp)
    m = len(rec_norm)

    # DP: align flat_exp (reference) to rec_norm (what was spoken)
    # dp[i][j] = min weighted distance aligning flat_exp[:i] to rec_norm[:j]
    INF = float("inf")
    dp = [[INF] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0
    # Allow skipping leading recognized phonemes (user noise/breathing)
    for j in range(1, m + 1):
        dp[0][j] = 0.0

    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] + 1.0  # missing expected phoneme
        for j in range(1, m + 1):
            sub = dp[i - 1][j - 1] + _phone_distance(flat_exp[i - 1], rec_norm[j - 1])
            delete = dp[i - 1][j] + 1.0      # expected phoneme not spoken
            insert = dp[i][j - 1] + 0.5       # extra spoken phoneme (lower cost)
            dp[i][j] = min(sub, delete, insert)

    # Traceback to find which rec phonemes matched which expected phonemes
    matches: list[int | None] = [None] * n  # matches[exp_idx] = rec_idx or None
    i, j = n, m
    while i > 0 and j > 0:
        sub = dp[i - 1][j - 1] + _phone_distance(flat_exp[i - 1], rec_norm[j - 1])
        if abs(dp[i][j] - sub) < 1e-9:
            matches[i - 1] = j - 1
            i -= 1
            j -= 1
        elif abs(dp[i][j] - (dp[i - 1][j] + 1.0)) < 1e-9:
            matches[i - 1] = None  # expected but not spoken
            i -= 1
        else:
            j -= 1  # extra spoken phoneme
    while i > 0:
        matches[i - 1] = None
        i -= 1

    # Split results back into per-word segments
    results: list[tuple[list[RecognizedPhoneme], float]] = []
    for exp_i, (start, end) in enumerate(word_boundaries):
        word_exp = flat_exp[start:end]
        word_len = len(word_exp)

        if word_len == 0:
            results.append(([], 100.0))
            continue

        # Collect matched recognized phonemes for this word
        word_rec_indices = [matches[k] for k in range(start, end) if matches[k] is not None]
        word_rec_phones: list[RecognizedPhoneme] = []
        if word_rec_indices:
            min_idx = min(word_rec_indices)
            max_idx = max(word_rec_indices)
            # Map normalized indices back to original recognized phonemes
            # (approximate — use time-based approach for original phoneme objects)
            word_rec_phones = []

        # Compute per-word score from the DP path.
        # Each phoneme contributes equally: perfect match = 0, same-group
        # substitution = 0.3, cross-group substitution = 1.0, missing = 1.0.
        # We also penalise coverage: if fewer than all expected phonemes
        # were matched, scale the score down proportionally.
        word_dist = 0.0
        word_matched = 0
        for k in range(start, end):
            if matches[k] is not None:
                word_dist += _phone_distance(flat_exp[k], rec_norm[matches[k]])
                word_matched += 1
            else:
                word_dist += 1.0  # missing phoneme

        # Base quality score from distance
        quality = max(0.0, 1.0 - word_dist / word_len) if word_len else 1.0
        # Coverage ratio — what fraction of expected phonemes were found
        coverage = word_matched / word_len if word_len else 1.0
        # Final score = quality * coverage — both must be high
        word_score = quality * coverage * 100

        results.append((word_rec_phones, word_score))

    return results


def score_pronunciation(
    reference: str,
    asr: AsrResult,
    recognized_phonemes: list[RecognizedPhoneme],
    expected_phonemes: list[dict],
) -> tuple[dict, dict]:
    asr_lower = [w.word.lower().strip(".,!?;:\"'") for w in asr.words]
    ref_lower = [exp["word"].lower() for exp in expected_phonemes]

    # ── Two-track scoring ──
    # Track A: Whisper word alignment (what Whisper thinks was said)
    # Track B: Forced phoneme alignment (what wav2vec2 actually heard)
    # The final score uses the LOWER of the two — catching cases where
    # Whisper auto-corrects (Track A says OK but Track B catches the error)
    # or where phoneme recognition is noisy (Track B noisy but Track A clear).

    # Track A: Whisper-based word alignment
    alignment = _align_words(ref_lower, asr_lower)

    # Track B: Direct phoneme forced alignment (Whisper-independent)
    forced_results = _forced_align_phonemes(expected_phonemes, recognized_phonemes)

    word_details = []
    matched = 0.0

    for i, exp in enumerate(expected_phonemes):
        exp_phones = exp["phonemes"]
        asr_idx = alignment[i]

        asr_word: AsrWord | None = None
        heard_as: str | None = None

        if asr_idx is not None:
            asr_word = asr.words[asr_idx]
            if asr_lower[asr_idx] != ref_lower[i]:
                heard_as = asr_word.word

        # ── Track A: Whisper-window phoneme score ──
        if asr_word:
            margin = 0.05
            word_phones = [
                p for p in recognized_phonemes
                if (asr_word.start - margin) <= p.time <= (asr_word.end + margin)
            ]
        else:
            word_phones = []

        recognized_str = [p.phoneme for p in word_phones]
        exp_norm = _normalize_phonemes(exp_phones)
        rec_norm = _normalize_phonemes(recognized_str)

        if exp_norm and rec_norm:
            dist_a = _weighted_levenshtein(exp_norm, rec_norm)
            score_a = max(0, (1 - dist_a / max(len(exp_norm), len(rec_norm)))) * 100
        elif not exp_norm:
            score_a = 100.0
        else:
            score_a = 0.0

        # ── Track B: Forced phoneme alignment score ──
        _, score_b = forced_results[i]

        # ── Combined score ──
        # Track B (forced phoneme alignment) is the primary signal — it's
        # Whisper-independent and catches auto-corrections.
        # Track A (Whisper-window) is secondary — useful when Track B is
        # noisy but Whisper got a clean match.
        # Weighting: 60% Track B, 40% Track A.  Both must agree for high score.
        phone_score = score_b * 0.6 + score_a * 0.4

        # Average confidence from Whisper-window phonemes
        avg_conf = (
            sum(p.confidence for p in word_phones) / len(word_phones)
            if word_phones else 0
        )

        # Whisper probability — secondary signal
        whisper_prob = asr_word.probability if asr_word else 0

        # Determine status — thresholds tuned for two-track scoring:
        # 80+ = correct (both tracks must agree closely)
        # 50-80 = mispronounced (noticeable deviation)
        # <50 = bad mispronunciation or missed
        if asr_word or score_b >= 40:
            if phone_score >= 80:
                status = "correct"
                matched += 1
            elif phone_score >= 50:
                status = "mispronounced"
                matched += 0.5
                if not heard_as:
                    heard_as = asr_word.word if asr_word else None
            else:
                status = "mispronounced"
                matched += 0.2
                if not heard_as:
                    heard_as = asr_word.word if asr_word else None
        else:
            status = "missed"

        word_details.append({
            "word": exp["word"],
            "status": status,
            "heard_as": heard_as,
            "pronunciation_score": round(phone_score),
            "expected_phonemes": " ".join(exp_phones),
            "recognized_phonemes": " ".join(recognized_str),
            "confidence": round(avg_conf * 100),
            "whisper_confidence": round(whisper_prob * 100),
            "score_whisper_track": round(score_a),
            "score_phoneme_track": round(score_b),
        })

    total = len(expected_phonemes) or 1
    accuracy = min(100, round((matched / total) * 100))

    phone_scores = [w["pronunciation_score"] for w in word_details if w["status"] != "missed"]
    pronunciation = round(sum(phone_scores) / len(phone_scores)) if phone_scores else 0

    fluency = _compute_fluency(asr)

    # Accuracy gates everything: if you said the wrong words entirely,
    # pronunciation and fluency are meaningless.  Below 30% accuracy,
    # scale down proportionally.  Above 30%, no penalty (enough words
    # matched for pron/fluency to be meaningful).
    accuracy_factor = min(1.0, accuracy / 30)
    effective_pronunciation = round(pronunciation * accuracy_factor)
    effective_fluency = round(fluency * accuracy_factor)

    overall = round(accuracy * 0.3 + effective_pronunciation * 0.5 + effective_fluency * 0.2)

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
    """Score fluency based on speaking rate, pauses, and rhythm.

    Native conversational English is roughly 2.5–4 words/sec with short
    inter-word gaps (~0.05-0.15s).  Learners tend to have longer/more
    frequent pauses and slower or uneven pace.
    """
    if len(asr.words) < 2:
        return 50

    gaps = [
        asr.words[i].start - asr.words[i - 1].end
        for i in range(1, len(asr.words))
    ]
    avg_gap = sum(gaps) / len(gaps)
    max_gap = max(gaps)

    total_time = asr.words[-1].end - asr.words[0].start
    if total_time <= 0:
        return 50
    wps = len(asr.words) / total_time

    # ── Speaking rate score ──
    # Sweet spot: 2.5–4.0 wps (natural English pace)
    if wps < 1.0:
        rate_score = max(20, int(wps / 1.0 * 40))
    elif wps < 2.0:
        rate_score = max(40, int(40 + (wps - 1.0) * 40))
    elif wps <= 4.5:
        rate_score = min(100, int(80 + (min(wps, 3.5) - 2.0) / 1.5 * 20))
    else:
        rate_score = max(50, int(100 - (wps - 4.5) * 20))

    # ── Gap score (average inter-word gap) ──
    # Native: ~0.08-0.15s.  Learners: 0.2-0.5s+
    if avg_gap <= 0.15:
        gap_score = 100
    elif avg_gap <= 0.3:
        gap_score = max(70, int(100 - (avg_gap - 0.15) * 200))
    elif avg_gap <= 0.6:
        gap_score = max(40, int(70 - (avg_gap - 0.3) * 100))
    else:
        gap_score = max(15, int(40 - (avg_gap - 0.6) * 50))

    # ── Pause penalty (longest gap) ──
    # Any single gap > 0.5s indicates a hesitation
    if max_gap <= 0.3:
        pause_score = 100
    elif max_gap <= 0.8:
        pause_score = max(50, int(100 - (max_gap - 0.3) * 100))
    elif max_gap <= 1.5:
        pause_score = max(25, int(50 - (max_gap - 0.8) * 35))
    else:
        pause_score = 15

    return min(100, round(rate_score * 0.35 + gap_score * 0.35 + pause_score * 0.3))


def _generate_feedback(word_details: list[dict], pronunciation: int, fluency: int) -> dict:
    tips: list[str] = []

    mispronounced = [w for w in word_details if w["status"] == "mispronounced"]
    missed = [w for w in word_details if w["status"] == "missed"]

    for w in mispronounced[:3]:
        if w["expected_phonemes"] and w["recognized_phonemes"]:
            tips.append(
                f"'{w['word']}': expected /{w['expected_phonemes']}/, "
                f"heard /{w['recognized_phonemes']}/"
            )
        elif w.get("heard_as"):
            tips.append(f"'{w['word']}': heard as '{w['heard_as']}'")

    for w in missed[:2]:
        tips.append(f"'{w['word']}' was not detected — try pronouncing it more clearly")

    if fluency < 50:
        tips.append("Try to speak more fluently with fewer pauses between words")

    if pronunciation >= 80:
        summary = "Great pronunciation! Keep it up."
    elif pronunciation >= 60:
        summary = "Good attempt! A few words need work."
    elif pronunciation >= 40:
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

def process(audio_path: str, reference_text: str) -> dict:
    """Run the full pronunciation scoring pipeline."""
    # Convert to WAV (ensures compatibility with all models)
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
