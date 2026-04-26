"""
Duration Modeling Module
========================
Scores phoneme durations by comparing actual vs context-aware expected durations.

v2 upgrades over v1:
- Context-aware expected duration: adjusted by speech rate and stress
- Smooth log-ratio penalty (not linear) — symmetric in log-domain
- Extreme ratio detection: deletion (< 0.2) and hesitation (> 4.0)
- Probabilistic-like score output via exp(-|log(ratio)|) ∈ (0, 1]
- Stress and speech rate factors influence expected duration

Why duration matters:
- L2 learners systematically distort durations (e.g., Vietnamese speakers
  shorten final consonants, Japanese speakers insert epenthetic vowels)
- Duration encodes stress: stressed syllables are longer
- Very short phonemes may indicate deletion; very long may indicate hesitation

Penalty function (log-ratio):
    penalty = exp( -|log(actual / expected)| )

    This is smooth, symmetric in log-domain, and naturally:
    - Returns 1.0 when actual == expected
    - Falls off symmetrically for over/under-production
    - Never goes negative
"""

import math
from dataclasses import dataclass

from .aligner import AlignedPhoneme, AlignedWord


# ── Expected phoneme durations (seconds) ─────────────────────────────────
# Derived from TIMIT/CMU statistics for conversational English.
# These are MEDIAN durations at a reference speaking rate of ~3.0 wps.

_PHONEME_DURATIONS: dict[str, float] = {
    # Plosives (short by nature)
    "p": 0.060, "b": 0.055, "t": 0.055, "d": 0.050,
    "k": 0.065, "ɡ": 0.055,
    # Fricatives
    "f": 0.090, "v": 0.065, "θ": 0.080, "ð": 0.045,
    "s": 0.100, "z": 0.080, "ʃ": 0.100, "ʒ": 0.070,
    "h": 0.060,
    # Nasals
    "m": 0.070, "n": 0.060, "ŋ": 0.070,
    # Liquids & glides
    "l": 0.060, "ɹ": 0.060, "w": 0.055, "j": 0.055,
    # Front vowels (lax → tense)
    "ɪ": 0.065, "i": 0.085, "ɛ": 0.075, "e": 0.085, "æ": 0.095,
    # Central vowels
    "ə": 0.055, "ɚ": 0.075, "ʌ": 0.070,
    # Back vowels
    "ʊ": 0.065, "u": 0.085, "ɔ": 0.090, "o": 0.085,
    "ɑ": 0.095, "ɒ": 0.085, "a": 0.090,
}

_DEFAULT_DURATION = 0.070

# Reference speaking rate used when computing the base durations above
_REFERENCE_WPS = 3.0

# Stress multipliers on expected duration.
# Primary-stressed vowels are ~50% longer than unstressed in English.
# Secondary stress is intermediate.
_STRESS_FACTOR = {
    0: 0.85,   # unstressed vowel: slightly shorter than base
    1: 1.50,   # primary stress: significantly longer
    2: 1.15,   # secondary stress: moderately longer
}

# Extreme ratio thresholds
RATIO_DELETION = 0.2     # below → likely deletion/omission
RATIO_HESITATION = 4.0   # above → likely hesitation/insertion

# Vowels that carry stress (consonants are not stress-affected for duration)
_VOWELS = set("iyɨʉɯuɪʏʊeøɘɵɤoəɛœɜɞʌɔæɐaɶɑɒɚɝ")


def _is_vowel(phone: str) -> bool:
    return any(c in _VOWELS for c in phone)


# ── Data structures ──────────────────────────────────────────────────────

@dataclass
class PhonemeDuration:
    """Duration analysis for a single phoneme."""
    phoneme: str
    actual_duration: float          # seconds
    expected_duration: float        # seconds (context-aware)
    duration_ratio: float           # actual / expected
    duration_score: float           # 0-1, probabilistic-like
    penalty_reason: str             # "normal", "too_short", "too_long", "deletion", "hesitation", "unaligned"


@dataclass
class WordDuration:
    """Duration analysis for a word."""
    word: str
    phoneme_durations: list[PhonemeDuration]
    word_duration_score: float      # 0-1, average of phoneme scores
    total_duration: float           # seconds
    speaking_rate: float            # phonemes per second
    speech_rate_factor: float       # actual wps / reference wps


# ── Context-aware expected duration ─────────────────────────────────────

def _context_expected_duration(
    phoneme: str,
    stress: int,
    speech_rate_factor: float,
) -> float:
    """Compute context-aware expected duration.

    expected = base_duration * speech_rate_factor * stress_factor

    - speech_rate_factor: if the speaker is faster than reference, we expect
      all phonemes to be shorter (and vice versa). This prevents penalizing
      a consistently fast speaker on every phoneme.
    - stress_factor: stressed vowels are expected to be longer. Consonants
      are not significantly affected by stress.
    """
    base = _PHONEME_DURATIONS.get(phoneme, _DEFAULT_DURATION)

    # Speech rate adjustment: faster speaker → shorter expected durations
    # Invert because higher wps means each phoneme should be shorter
    rate_adj = 1.0 / max(0.3, speech_rate_factor) if speech_rate_factor > 0 else 1.0

    # Stress adjustment: only for vowels
    stress_adj = 1.0
    if _is_vowel(phoneme):
        stress_adj = _STRESS_FACTOR.get(stress, 1.0)

    return base * rate_adj * stress_adj


# ── Smooth log-ratio penalty ────────────────────────────────────────────

def _log_ratio_penalty(actual: float, expected: float) -> tuple[float, str]:
    """Compute smooth duration penalty using log-ratio.

    penalty = exp( -|log(actual / expected)| )

    Properties:
    - Returns 1.0 when actual == expected (perfect)
    - Symmetric in log-domain (2x too long penalized same as 0.5x too short)
    - Smooth and differentiable everywhere
    - Output ∈ (0, 1], naturally probabilistic-like

    Extreme cases are clamped to detect deletion/hesitation.
    """
    if expected <= 0:
        expected = _DEFAULT_DURATION

    ratio = actual / expected

    # Detect extremes before computing penalty
    if ratio < RATIO_DELETION:
        return 0.0, "deletion"
    if ratio > RATIO_HESITATION:
        return 0.0, "hesitation"

    # Log-ratio penalty: symmetric, smooth
    log_ratio = abs(math.log(ratio))
    penalty = math.exp(-log_ratio)

    # Classify for feedback
    if ratio < 0.5:
        reason = "too_short"
    elif ratio > 2.0:
        reason = "too_long"
    else:
        reason = "normal"

    return penalty, reason


# ── Duration scoring ─────────────────────────────────────────────────────

def score_phoneme_duration(
    aligned_phoneme: AlignedPhoneme,
    stress: int,
    speech_rate_factor: float,
) -> PhonemeDuration:
    """Score a single phoneme's duration with context-aware expectation.

    Args:
        aligned_phoneme: The aligned phoneme with timing info
        stress: 0=none, 1=primary, 2=secondary (from G2P)
        speech_rate_factor: utterance_wps / reference_wps
    """
    if not aligned_phoneme.aligned or aligned_phoneme.time_start < 0:
        return PhonemeDuration(
            phoneme=aligned_phoneme.phoneme,
            actual_duration=0.0,
            expected_duration=_context_expected_duration(
                aligned_phoneme.phoneme, stress, speech_rate_factor,
            ),
            duration_ratio=0.0,
            duration_score=0.0,
            penalty_reason="unaligned",
        )

    actual = aligned_phoneme.time_end - aligned_phoneme.time_start
    expected = _context_expected_duration(
        aligned_phoneme.phoneme, stress, speech_rate_factor,
    )

    ratio = actual / expected if expected > 0 else 0.0
    penalty, reason = _log_ratio_penalty(actual, expected)

    return PhonemeDuration(
        phoneme=aligned_phoneme.phoneme,
        actual_duration=round(actual, 4),
        expected_duration=round(expected, 4),
        duration_ratio=round(ratio, 3),
        duration_score=round(penalty, 4),
        penalty_reason=reason,
    )


def score_word_duration(
    aligned_word: AlignedWord,
    word_phonemes=None,
    utterance_wps: float = 0.0,
) -> WordDuration:
    """Score duration for all phonemes in a word.

    Args:
        aligned_word: Word with aligned phoneme timings
        word_phonemes: WordPhonemes from text_processor (carries stress info).
                       If None, stress=0 is assumed for all phonemes.
        utterance_wps: Speaking rate of the full utterance in words/sec.
                       Used to compute speech_rate_factor for context-aware
                       expected durations.
    """
    # Compute speech rate factor
    speech_rate_factor = utterance_wps / _REFERENCE_WPS if utterance_wps > 0 else 1.0

    phoneme_durations: list[PhonemeDuration] = []

    for idx, ap in enumerate(aligned_word.phonemes):
        # Extract stress from G2P if available
        stress = 0
        if word_phonemes is not None and idx < len(word_phonemes.phonemes):
            stress = word_phonemes.phonemes[idx].stress

        pd = score_phoneme_duration(ap, stress, speech_rate_factor)
        phoneme_durations.append(pd)

    # Average score over aligned phonemes only
    aligned_scores = [pd.duration_score for pd in phoneme_durations if pd.penalty_reason != "unaligned"]
    word_score = sum(aligned_scores) / len(aligned_scores) if aligned_scores else 0.0

    total_dur = aligned_word.time_end - aligned_word.time_start if aligned_word.time_start >= 0 else 0.0
    n_phones = len(aligned_scores)
    rate = n_phones / total_dur if total_dur > 0 else 0.0

    return WordDuration(
        word=aligned_word.word,
        phoneme_durations=phoneme_durations,
        word_duration_score=round(word_score, 4),
        total_duration=round(total_dur, 4),
        speaking_rate=round(rate, 1),
        speech_rate_factor=round(speech_rate_factor, 3),
    )
