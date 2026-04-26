"""
Goodness of Pronunciation (GOP) Module
=======================================
Computes calibrated GOP scores from aligned phoneme segments.

GOP formula:
    GOP(p) = (1/N) * sum_frames[ log P(p|frame) - max_{q!=p} log P(q|frame) ]

This is the log-likelihood ratio between the expected phoneme and the best
alternative. Values are negative (closer to 0 = better pronunciation).

v2 upgrades:
- Entropy-based uncertainty (not just LLR variance)
- Z-score normalization with per-phoneme class statistics
- Confusion matrix placeholder for L2 error softening
- Uncertainty propagation: high-entropy phonemes are downweighted in aggregation
- Confusion detection with margin analysis

Why log-likelihood ratio instead of raw posterior:
- Raw softmax probabilities are overconfident after CTC training
- LLR normalizes for acoustic context (some frames are inherently ambiguous)
- More stable across speakers and recording conditions
"""

import math
from dataclasses import dataclass

import torch

from .aligner import AlignedPhoneme, AlignedWord, resolve_phone_id


# ── Configuration ────────────────────────────────────────────────────────

# Calibration temperature: >1 softens overconfident outputs.
# wav2vec2-CTC outputs are typically overconfident (peaked softmax).
# T=2.0 is a reasonable default derived from native-speaker calibration.
CALIBRATION_TEMPERATURE = 2.0

# GOP value mapping
GOP_FLOOR = -10.0                   # Floor for raw GOP

# Z-score normalization parameters.
# These approximate the GOP distribution from native English speakers:
#   mean ~ -1.0 (native speech is slightly negative due to coarticulation)
#   std  ~ 1.5  (captures natural variation across phonemes and contexts)
# After z-scoring, values land in roughly [-3, +3].
GOP_ZSCORE_MEAN = -1.0
GOP_ZSCORE_STD = 1.5

# Sigmoid mapping on z-scored GOP
# midpoint=0 means z=0 → 50 score; steepness controls transition sharpness
GOP_SIGMOID_MIDPOINT = 0.0
GOP_SIGMOID_STEEPNESS = 1.8

# Confusion margin: if LLR margin < this, flag confusion_detected
CONFUSION_MARGIN_THRESHOLD = 1.0

# Minimum aligned ratio for reliable GOP
GOP_MIN_ALIGNED_RATIO = 0.5


# ── Phoneme confusion matrix (L2 error softening) ─────────────────────

# Confusion matrix: confusion_prob[p][q] = probability that a learner
# producing phoneme p is heard as q. Values > 0 soften the GOP penalty
# for that pair — the learner made a known, predictable error.
#
# These are populated from L2 speech corpora (e.g., L2-ARCTIC).
# Placeholder values reflect common confusions across L1 backgrounds.
# In production, load from a JSON file trained on your learner population.

_CONFUSION_PROBS: dict[str, dict[str, float]] = {}

# Common L2 confusions with approximate probabilities
_L2_CONFUSIONS: list[tuple[str, str, float]] = [
    # Dental fricatives (hardest for most L1s)
    ("θ", "t", 0.25), ("θ", "f", 0.15), ("θ", "s", 0.10),
    ("ð", "d", 0.25), ("ð", "v", 0.10), ("ð", "z", 0.08),
    # Liquids
    ("ɹ", "l", 0.20), ("l", "ɹ", 0.15), ("ɹ", "w", 0.10),
    # Vowel confusions
    ("æ", "ɛ", 0.15), ("ɛ", "æ", 0.12),
    ("ɪ", "i", 0.18), ("i", "ɪ", 0.15),
    ("ʊ", "u", 0.15), ("u", "ʊ", 0.12),
    ("ʌ", "ɑ", 0.12), ("ɑ", "ʌ", 0.10),
    ("ə", "ʌ", 0.10), ("ə", "ɪ", 0.08),
    # Voicing confusions
    ("b", "p", 0.10), ("d", "t", 0.10), ("ɡ", "k", 0.10),
    ("v", "f", 0.12), ("z", "s", 0.12),
    ("b", "v", 0.08),
    # Sibilants
    ("s", "ʃ", 0.08), ("ʃ", "s", 0.06),
    # Nasals
    ("n", "ŋ", 0.10), ("ŋ", "n", 0.08),
]

for _p, _q, _prob in _L2_CONFUSIONS:
    _CONFUSION_PROBS.setdefault(_p, {})[_q] = _prob


def get_confusion_prob(expected: str, actual: str) -> float:
    """Return P(actual | expected) from the confusion matrix. 0 if unknown."""
    return _CONFUSION_PROBS.get(expected, {}).get(actual, 0.0)


# ── Phoneme similarity for grouping ──────────────────────────────────────

_PHONE_GROUPS: dict[str, int] = {}
_GROUPS = [
    (["p", "b"], 0), (["t", "d"], 1), (["k", "ɡ", "g"], 2),
    (["f", "v"], 3), (["θ", "ð"], 4), (["s", "z"], 5),
    (["ʃ", "ʒ"], 6), (["h"], 7),
    (["m", "n", "ŋ"], 8),
    (["l", "ɫ"], 9), (["ɹ", "r", "ɾ"], 10), (["w"], 11), (["j"], 12),
    (["i", "ɪ", "e", "ɛ", "æ"], 13),
    (["ə", "ɚ", "ʌ", "ɜ", "ɐ"], 14),
    (["u", "ʊ", "o", "ɔ", "ɑ", "ɒ", "a"], 15),
]
for phones, gid in _GROUPS:
    for ph in phones:
        _PHONE_GROUPS[ph] = gid


def is_same_group(a: str, b: str) -> bool:
    """Check if two phonemes belong to the same phonetic feature group."""
    ga = _PHONE_GROUPS.get(a)
    gb = _PHONE_GROUPS.get(b)
    return ga is not None and gb is not None and ga == gb


# ── GOP data structures ─────────────────────────────────────────────────

@dataclass
class PhonemeGOP:
    """GOP result for a single phoneme."""
    phoneme: str
    raw_gop: float              # Raw log-likelihood ratio
    calibrated_gop: float       # After z-score normalization, in [-3, +3]
    score: float                # 0-100 mapped score
    uncertainty: float          # 0-1, entropy-based (higher = less confident)
    best_alternative: str       # What the model thinks was actually said
    confusion_detected: bool    # True if margin is small (ambiguous)
    confusion_prob: float       # P(alt|expected) from confusion matrix


@dataclass
class WordGOP:
    """GOP result for a word."""
    word: str
    phoneme_gops: list[PhonemeGOP]
    word_score: float           # 0-100, uncertainty-weighted average
    word_uncertainty: float     # 0-1, mean phoneme uncertainty
    n_aligned: int
    n_total: int
    reliable: bool


# ── Core GOP computation ────────────────────────────────────────────────

def _calibrate_log_probs(log_probs: torch.Tensor, temperature: float) -> torch.Tensor:
    """Apply temperature scaling to log-probabilities.

    Temperature > 1 softens the distribution (reduces overconfidence).
    Applied BEFORE computing GOP so the LLR uses calibrated probabilities.
    """
    if temperature == 1.0:
        return log_probs
    scaled = log_probs / temperature
    return torch.log_softmax(scaled, dim=-1)


def _frame_entropy(log_probs_segment: torch.Tensor) -> float:
    """Compute mean normalized entropy across frames.

    Returns value in [0, 1] where 0 = perfectly peaked, 1 = uniform.
    This is a principled uncertainty measure: it captures how spread
    the model's belief is, not just the variance of the LLR.
    """
    n_classes = log_probs_segment.shape[1]
    if n_classes <= 1:
        return 0.0
    probs = log_probs_segment.exp()
    # H = -sum(p * log(p)), but we already have log(p)
    frame_h = -(probs * log_probs_segment).sum(dim=-1)  # (N,)
    mean_h = frame_h.mean().item()
    max_h = math.log(n_classes)
    return min(1.0, mean_h / max_h)


def compute_phoneme_gop(
    log_probs: torch.Tensor,
    aligned_phoneme: AlignedPhoneme,
    vocab: dict[str, int],
    id_to_token: dict[int, str],
    temperature: float = CALIBRATION_TEMPERATURE,
) -> PhonemeGOP:
    """Compute GOP for a single aligned phoneme.

    GOP(p) = (1/N) * sum_frames[ log P(p|frame) - max_{q!=p} log P(q|frame) ]

    Then:
    1. Z-score normalize using native speaker statistics
    2. Clamp to [-3, +3] (interpretable range)
    3. Sigmoid map to [0, 100]
    4. Compute entropy-based uncertainty
    5. Check confusion matrix for L2 error softening
    """
    if not aligned_phoneme.aligned or aligned_phoneme.frame_start < 0:
        return PhonemeGOP(
            phoneme=aligned_phoneme.phoneme,
            raw_gop=GOP_FLOOR, calibrated_gop=-3.0,
            score=0.0, uncertainty=1.0,
            best_alternative="?", confusion_detected=False,
            confusion_prob=0.0,
        )

    phone_id = resolve_phone_id(aligned_phoneme.phoneme, vocab)
    if phone_id is None:
        return PhonemeGOP(
            phoneme=aligned_phoneme.phoneme,
            raw_gop=GOP_FLOOR, calibrated_gop=-3.0,
            score=0.0, uncertainty=1.0,
            best_alternative="?", confusion_detected=False,
            confusion_prob=0.0,
        )

    fs, fe = aligned_phoneme.frame_start, aligned_phoneme.frame_end
    if fe <= fs:
        return PhonemeGOP(
            phoneme=aligned_phoneme.phoneme,
            raw_gop=GOP_FLOOR, calibrated_gop=-3.0,
            score=0.0, uncertainty=1.0,
            best_alternative="?", confusion_detected=False,
            confusion_prob=0.0,
        )

    # Calibrate log-probs for this segment
    segment_lp = log_probs[fs:fe]  # (N, C)
    calibrated_lp = _calibrate_log_probs(segment_lp, temperature)

    # Expected phoneme log-prob per frame
    log_p_expected = calibrated_lp[:, phone_id]  # (N,)

    # Best alternative (excluding expected phoneme)
    mask = calibrated_lp.clone()
    mask[:, phone_id] = -1e9
    best_other_vals, best_other_ids = mask.max(dim=-1)

    # Raw GOP: mean frame-level log-likelihood ratio
    frame_llrs = log_p_expected - best_other_vals
    raw_gop = frame_llrs.mean().item()
    raw_gop = max(GOP_FLOOR, raw_gop)

    # Z-score normalization: center on native speaker distribution
    z_gop = (raw_gop - GOP_ZSCORE_MEAN) / GOP_ZSCORE_STD
    calibrated_gop = max(-3.0, min(3.0, z_gop))

    # Find dominant alternative phoneme (mode across frames)
    mode_id = best_other_ids.mode().values.item()
    best_alt = id_to_token.get(mode_id, "?")

    # Confusion detection: small margin means the model is unsure which phoneme
    margin = abs(raw_gop)
    confusion_detected = margin < CONFUSION_MARGIN_THRESHOLD

    # Confusion matrix lookup: how likely is this specific substitution?
    conf_prob = get_confusion_prob(aligned_phoneme.phoneme, best_alt)

    # If this is a known L2 confusion, soften the GOP penalty.
    # Rationale: penalizing θ→t the same as θ→k is unfair — the former
    # is a systematic L1 transfer, the latter is a genuine error.
    if conf_prob > 0 and calibrated_gop < 0:
        # Reduce penalty proportional to confusion probability
        # At conf_prob=0.25, reduce penalty by ~25%
        calibrated_gop = calibrated_gop * (1.0 - conf_prob)

    # Uncertainty: entropy of the frame posteriors (not LLR variance)
    uncertainty = _frame_entropy(calibrated_lp)

    # Map to 0-100 score via sigmoid
    score = _gop_to_score(calibrated_gop)

    return PhonemeGOP(
        phoneme=aligned_phoneme.phoneme,
        raw_gop=round(raw_gop, 3),
        calibrated_gop=round(calibrated_gop, 3),
        score=round(score, 1),
        uncertainty=round(uncertainty, 3),
        best_alternative=best_alt,
        confusion_detected=confusion_detected,
        confusion_prob=round(conf_prob, 3),
    )


def compute_word_gop(
    log_probs: torch.Tensor,
    aligned_word: AlignedWord,
    vocab: dict[str, int],
    id_to_token: dict[int, str],
    temperature: float = CALIBRATION_TEMPERATURE,
) -> WordGOP:
    """Compute GOP for all phonemes in a word.

    Word score is an uncertainty-weighted average: phonemes with high
    entropy (uncertain alignment or ambiguous acoustics) contribute less.
    This prevents a single noisy phoneme from tanking the word score.
    """
    phoneme_gops: list[PhonemeGOP] = []

    for ap in aligned_word.phonemes:
        pg = compute_phoneme_gop(log_probs, ap, vocab, id_to_token, temperature)
        phoneme_gops.append(pg)

    n_total = len(aligned_word.phonemes)
    n_aligned = sum(1 for pg in phoneme_gops if pg.raw_gop > GOP_FLOOR)
    reliable = n_aligned >= n_total * GOP_MIN_ALIGNED_RATIO if n_total > 0 else False

    if n_aligned > 0:
        # Uncertainty-weighted average with outlier trimming:
        # 1. Remove outlier phoneme scores (>1.5 IQR below Q1)
        # 2. Weight by (1 - uncertainty) so uncertain phonemes count less
        aligned_gops = [(pg.score, pg.uncertainty) for pg in phoneme_gops if pg.raw_gop > GOP_FLOOR]
        scores_only = [s for s, _ in aligned_gops]
        trimmed_indices = _median_trim(scores_only)
        trimmed_gops = [aligned_gops[i] for i in trimmed_indices]

        weights = [max(0.05, 1.0 - u) for _, u in trimmed_gops]
        total_w = sum(weights)
        word_score = sum(s * w for (s, _), w in zip(trimmed_gops, weights)) / total_w

        uncertainties = [u for _, u in aligned_gops]  # uncertainty from ALL phonemes
        word_uncertainty = sum(uncertainties) / len(uncertainties)
    else:
        word_score = 0.0
        word_uncertainty = 1.0

    return WordGOP(
        word=aligned_word.word,
        phoneme_gops=phoneme_gops,
        word_score=round(word_score, 1),
        word_uncertainty=round(word_uncertainty, 3),
        n_aligned=n_aligned,
        n_total=n_total,
        reliable=reliable,
    )


# ── Score mapping ────────────────────────────────────────────────────────

def _median_trim(scores: list[float]) -> list[int]:
    """Return indices of scores after removing outliers below Q1 - 1.5*IQR.

    Keeps at least half the scores (never trims too aggressively).
    For ≤2 scores, returns all indices (trimming is meaningless).
    """
    n = len(scores)
    if n <= 2:
        return list(range(n))

    sorted_scores = sorted(scores)
    q1 = sorted_scores[n // 4]
    q3 = sorted_scores[(3 * n) // 4]
    iqr = q3 - q1
    lower_bound = q1 - 1.5 * iqr

    kept = [i for i, s in enumerate(scores) if s >= lower_bound]
    # Safety: keep at least half
    if len(kept) < n // 2:
        # Keep all but the single worst
        worst_idx = scores.index(min(scores))
        kept = [i for i in range(n) if i != worst_idx]

    return kept


def _gop_to_score(calibrated_gop: float) -> float:
    """Map z-scored GOP to [0, 100] via sigmoid.

    After z-scoring:
      z = +2  (much better than native mean) → ~97
      z =  0  (native mean)                  → ~50
      z = -2  (well below native)            → ~3
    """
    exponent = -GOP_SIGMOID_STEEPNESS * (calibrated_gop - GOP_SIGMOID_MIDPOINT)
    exponent = max(-500.0, min(500.0, exponent))
    return 100.0 / (1.0 + math.exp(exponent))
