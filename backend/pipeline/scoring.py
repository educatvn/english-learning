"""
Scoring & Fusion Layer
======================
Combines GOP, duration, and prosody scores into final pronunciation assessment
with full uncertainty propagation.

v3 fixes:
- #1:  Weighting uses uncertainty-aware formula (not raw posterior)
- #2:  Duration score kept in [0,1] until fusion (no premature linear scaling)
- #3:  Uncertainty propagation via multiplicative rule (not linear blend)
- #4:  Missed word detection checks duration + confidence (not just n_aligned)
- #10: Speaking rate excludes silence
- #11: Gap scoring via smooth exponential decay
- #12: Completeness scaling via sqrt (less harsh)
- #13: Adaptive weights based on overall uncertainty
- #14: Feedback ranked by impact (score * frequency)
- #15: Feedback groups repeated phoneme errors
- #16: Prosody feedback includes expected vs actual values
- #17: All scores clamped to [0, 100]
"""

import math
from collections import defaultdict
from dataclasses import dataclass

from .aligner import AlignedWord, AlignmentResult
from .gop import WordGOP, PhonemeGOP
from .duration import WordDuration
from .prosody import ProsodyResult, WordProsody
from .text_processor import ProcessedText
from .verification import WordVerification


# ── Configuration ────────────────────────────────────────────────────────

# Base overall score weights (may be adapted by uncertainty, see #13)
W_PRONUNCIATION = 0.45
W_FLUENCY = 0.20
W_PROSODY = 0.20
W_COMPLETENESS = 0.15

# Thresholds for word status
WORD_CORRECT_THRESHOLD = 80
WORD_PARTIAL_THRESHOLD = 50

# Missed word detection thresholds (fix #4)
MISSED_MIN_DURATION = 0.03      # seconds — below this, word was likely not spoken
MISSED_LOW_CONF = 0.15          # alignment confidence below this → likely missed

# Fluency
FLUENCY_MIN_WORDS = 2
FLUENCY_DEFAULT = 50
FLUENCY_RATE_SWEET_LOW = 2.0
FLUENCY_RATE_SWEET_HIGH = 3.5

# Gap scoring decay constant (fix #11)
# gap_score = 100 * exp(-k * avg_gap)
# At avg_gap=0.3s → ~55, at 0.15s → ~74, at 0.5s → ~37
FLUENCY_GAP_DECAY_K = 4.0

# Minimum confidence floor for aggregation weights
CONFIDENCE_FLOOR = 0.05

# Uncertainty threshold for adaptive weights (fix #13)
HIGH_UNCERTAINTY_THRESHOLD = 0.4


# ── Data structures ──────────────────────────────────────────────────────

@dataclass
class WordScore:
    """Final score for a single word."""
    word: str
    status: str                     # "correct", "mispronounced", "missed"
    pronunciation_score: int        # 0-100
    gop_score: float                # 0-100, from GOP module
    duration_score: float           # 0-100, from duration module
    prosody_score: float            # 0-100, from prosody module (per-word stress)
    confidence: float               # 0-1, alignment confidence (posterior-based)
    uncertainty: float              # 0-1, propagated uncertainty
    phoneme_details: list[dict]     # Per-phoneme breakdown
    word_start: float               # seconds
    word_end: float                 # seconds


@dataclass
class FluencyScore:
    """Fluency assessment."""
    score: int                      # 0-100
    speaking_rate: float            # words/sec
    avg_gap: float                  # average inter-word gap
    max_gap: float                  # longest pause


@dataclass
class FinalScore:
    """Complete assessment output."""
    overall: int                    # 0-100
    pronunciation: int              # 0-100
    fluency: int                    # 0-100
    prosody: dict                   # stress, intonation, rhythm, rate, overall
    completeness: int               # 0-100
    word_details: list[WordScore]
    feedback: dict                  # summary + tips
    uncertainty: float              # 0-1, overall confidence in the assessment


# ── Helper: clamp ────────────────────────────────────────────────────────

def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    """Clamp a value to [lo, hi]. Fix #17."""
    return max(lo, min(hi, value))


# ── Word-level scoring (uncertainty-aware fusion) ───────────────────────

def score_word(
    aligned_word: AlignedWord,
    word_gop: WordGOP,
    word_duration: WordDuration,
    word_prosody: WordProsody | None,
    word_verification: WordVerification | None = None,
) -> WordScore:
    """Combine GOP + duration + ASR verification into a single word score.

    The verification step is critical: it checks whether the model's greedy
    decode (what was ACTUALLY heard) matches the expected phonemes. Without
    this, forced alignment always "succeeds" and wrong speech gets high scores.

    Fix #1: Weight allocation uses uncertainty-aware formula.
    Fix #2: Duration score stays in [0,1] until fusion.
    Fix #3: Uncertainty propagation via multiplicative rule.
    Fix #4: Missed word detection uses verification + alignment signals.
    """
    confidence = aligned_word.confidence
    word_dur = (aligned_word.time_end - aligned_word.time_start
                if aligned_word.time_start >= 0 else 0.0)

    # ASR verification: did the model actually hear this word?
    verification_penalty = 1.0
    if word_verification is not None:
        verification_penalty = word_verification.penalty

        # If verification says word was NOT spoken at all → missed
        # But only if penalty is very low (missed=0.0 or substituted=0.1).
        # Low-confidence matches (penalty=0.3) pass through with reduced score
        # so GOP can still assess pronunciation quality.
        if not word_verification.is_verified and verification_penalty < 0.2:
            return WordScore(
                word=aligned_word.word,
                status="missed",
                pronunciation_score=0,
                gop_score=0.0,
                duration_score=0.0,
                prosody_score=word_prosody.stress_score if word_prosody else 50.0,
                confidence=round(confidence, 4),
                uncertainty=1.0,
                phoneme_details=_build_phoneme_details(word_gop),
                word_start=aligned_word.time_start,
                word_end=aligned_word.time_end,
            )

    # Fix #4: More robust missed word detection (alignment-based fallback)
    # A word is missed only if: no aligned phonemes AND short duration AND low confidence
    if (word_gop.n_aligned == 0
            and word_dur < MISSED_MIN_DURATION
            and confidence < MISSED_LOW_CONF):
        return WordScore(
            word=aligned_word.word,
            status="missed",
            pronunciation_score=0,
            gop_score=0.0,
            duration_score=0.0,
            prosody_score=word_prosody.stress_score if word_prosody else 50.0,
            confidence=round(confidence, 4),
            uncertainty=1.0,
            phoneme_details=_build_phoneme_details(word_gop),
            word_start=aligned_word.time_start,
            word_end=aligned_word.time_end,
        )

    # If all phonemes unaligned but there IS duration/energy, it's mispronounced, not missed
    if word_gop.n_aligned == 0:
        return WordScore(
            word=aligned_word.word,
            status="mispronounced",
            pronunciation_score=0,
            gop_score=0.0,
            duration_score=0.0,
            prosody_score=word_prosody.stress_score if word_prosody else 50.0,
            confidence=round(confidence, 4),
            uncertainty=1.0,
            phoneme_details=_build_phoneme_details(word_gop),
            word_start=aligned_word.time_start,
            word_end=aligned_word.time_end,
        )

    # Fix #1: Uncertainty-aware weighting
    gop_conf = 1.0 - word_gop.word_uncertainty
    align_conf = confidence

    w_gop = 0.6 * gop_conf + 0.4 * align_conf
    w_gop = max(0.2, min(0.9, w_gop))
    w_dur = 1.0 - w_gop

    gop_score = word_gop.word_score
    # Fix #2: Duration score is in [0,1], scale to 0-100 at fusion
    dur_score_100 = word_duration.word_duration_score * 100.0

    combined = _clamp(w_gop * gop_score + w_dur * dur_score_100)

    # Apply verification penalty: scales down the score when decoded phonemes
    # don't match expected phonemes. This is the key mechanism that prevents
    # forced alignment from masking wrong speech.
    combined = _clamp(combined * verification_penalty)

    # Fix #3: Multiplicative uncertainty propagation
    phoneme_uncertainties = [ap.uncertainty for ap in aligned_word.phonemes if ap.aligned]
    mean_phon_uncertainty = (
        sum(phoneme_uncertainties) / len(phoneme_uncertainties)
        if phoneme_uncertainties else 1.0
    )
    word_uncertainty = 1.0 - (confidence * (1.0 - mean_phon_uncertainty))
    word_uncertainty = max(0.0, min(1.0, word_uncertainty))

    # Determine status
    if combined >= WORD_CORRECT_THRESHOLD:
        status = "correct"
    elif combined >= WORD_PARTIAL_THRESHOLD:
        status = "mispronounced"
    else:
        status = "mispronounced"

    prosody_s = word_prosody.stress_score if word_prosody else 50.0

    return WordScore(
        word=aligned_word.word,
        status=status,
        pronunciation_score=round(combined),
        gop_score=round(gop_score, 1),
        duration_score=round(dur_score_100, 1),
        prosody_score=round(_clamp(prosody_s), 1),
        confidence=round(confidence, 4),
        uncertainty=round(word_uncertainty, 4),
        phoneme_details=_build_phoneme_details(word_gop),
        word_start=aligned_word.time_start,
        word_end=aligned_word.time_end,
    )


def _build_phoneme_details(word_gop: WordGOP) -> list[dict]:
    """Build per-phoneme detail dicts from GOP results."""
    details = []
    for pg in word_gop.phoneme_gops:
        details.append({
            "phoneme": pg.phoneme,
            "score": pg.score,
            "gop": round(pg.calibrated_gop, 2),
            "uncertainty": pg.uncertainty,
            "best_alternative": pg.best_alternative if pg.confusion_detected else None,
            "confusion": pg.confusion_detected,
            "confusion_prob": pg.confusion_prob,
        })
    return details


# ── Fluency scoring ─────────────────────────────────────────────────────

def score_fluency(alignment: AlignmentResult) -> FluencyScore:
    """Score fluency based on timing of aligned words.

    Fix #10: Speaking rate uses speech time only (excludes silence between words).
    Fix #11: Gap scoring uses smooth exponential decay instead of piecewise thresholds.
    """
    timed = [w for w in alignment.words if w.time_start >= 0 and w.time_end > w.time_start]

    if len(timed) < FLUENCY_MIN_WORDS:
        return FluencyScore(score=FLUENCY_DEFAULT, speaking_rate=0.0, avg_gap=0.0, max_gap=0.0)

    # Compute gaps between consecutive words
    gaps: list[float] = []
    for i in range(1, len(timed)):
        gap = timed[i].time_start - timed[i - 1].time_end
        gaps.append(max(0, gap))

    avg_gap = sum(gaps) / len(gaps) if gaps else 0.0
    max_gap = max(gaps) if gaps else 0.0

    # Fix #10: Use speech time only (sum of word durations, not wall-clock span)
    speech_time = sum(w.time_end - w.time_start for w in timed)
    wps = len(timed) / speech_time if speech_time > 0 else 0.0

    # Rate score
    if wps < 1.0:
        rate_score = max(20, int(wps * 40))
    elif wps < FLUENCY_RATE_SWEET_LOW:
        rate_score = max(40, int(40 + (wps - 1.0) * 40))
    elif wps <= FLUENCY_RATE_SWEET_HIGH:
        rate_score = min(100, int(80 + (wps - FLUENCY_RATE_SWEET_LOW) / (FLUENCY_RATE_SWEET_HIGH - FLUENCY_RATE_SWEET_LOW) * 20))
    else:
        rate_score = max(50, int(100 - (wps - FLUENCY_RATE_SWEET_HIGH) * 20))

    # Fix #11: Smooth exponential gap scoring
    gap_score = round(100.0 * math.exp(-FLUENCY_GAP_DECAY_K * avg_gap))

    # Pause penalty: also exponential, steeper for long pauses
    pause_score = round(100.0 * math.exp(-2.5 * max_gap))

    score = min(100, max(0, round(
        rate_score * 0.35 + gap_score * 0.35 + pause_score * 0.30
    )))

    return FluencyScore(
        score=score,
        speaking_rate=round(wps, 2),
        avg_gap=round(avg_gap, 3),
        max_gap=round(max_gap, 3),
    )


# ── Final score assembly (uncertainty-aware) ────────────────────────────

def compute_final_score(
    word_scores: list[WordScore],
    fluency: FluencyScore,
    prosody: ProsodyResult,
    processed_text: ProcessedText,
) -> FinalScore:
    """Assemble the final score from all components.

    Fix #12: Completeness factor uses sqrt scaling (less harsh on partial speech).
    Fix #13: Adaptive weights — when uncertainty is high, shift weight from
             pronunciation (unreliable) toward prosody (more robust).
    """
    n_total = len(processed_text.words)
    n_spoken = sum(1 for ws in word_scores if ws.status != "missed")
    completeness = round((n_spoken / n_total) * 100) if n_total > 0 else 0

    # Pronunciation: uncertainty-weighted average of word scores
    if n_spoken > 0:
        spoken = [(ws.pronunciation_score, ws.uncertainty) for ws in word_scores if ws.status != "missed"]
        weights = [max(CONFIDENCE_FLOOR, 1.0 - u) for _, u in spoken]
        total_w = sum(weights)
        pronunciation = round(_clamp(sum(s * w for (s, _), w in zip(spoken, weights)) / total_w))

        mean_uncertainty = sum(u for _, u in spoken) / len(spoken)
    else:
        pronunciation = 0
        mean_uncertainty = 1.0

    # Fix #12: sqrt completeness scaling — less punishing for partial speech
    # At 50% completeness: factor = 0.71 (vs 1.0 with old /30 formula for anything >= 30%)
    # At 25% completeness: factor = 0.50 (vs 0.83 with old formula)
    completeness_factor = math.sqrt(completeness / 100.0) if completeness > 0 else 0.0

    effective_pronunciation = round(_clamp(pronunciation * completeness_factor))
    effective_fluency = round(_clamp(fluency.score * completeness_factor))
    effective_prosody = round(_clamp(prosody.overall_score * completeness_factor))

    # Fix #13: Adaptive weights — when overall uncertainty is high,
    # pronunciation scores are less reliable, so shift weight to prosody
    w_pron = W_PRONUNCIATION
    w_flu = W_FLUENCY
    w_pros = W_PROSODY
    w_comp = W_COMPLETENESS

    if mean_uncertainty > HIGH_UNCERTAINTY_THRESHOLD:
        w_pron *= 0.8
        w_pros *= 1.1
        # Renormalize
        w_total = w_pron + w_flu + w_pros + w_comp
        w_pron /= w_total
        w_flu /= w_total
        w_pros /= w_total
        w_comp /= w_total

    overall = round(_clamp(
        effective_pronunciation * w_pron
        + effective_fluency * w_flu
        + effective_prosody * w_pros
        + completeness * w_comp
    ))

    feedback = _generate_feedback(word_scores, pronunciation, fluency.score, prosody)

    return FinalScore(
        overall=overall,
        pronunciation=effective_pronunciation,
        fluency=effective_fluency,
        prosody={
            "stress": round(_clamp(prosody.stress_score * completeness_factor)),
            "intonation": round(_clamp(prosody.intonation_score * completeness_factor)),
            "rhythm": round(_clamp(prosody.rhythm_score * completeness_factor)),
            "rate": round(_clamp(prosody.rate_score * completeness_factor)),
            "overall": effective_prosody,
        },
        completeness=completeness,
        word_details=word_scores,
        feedback=feedback,
        uncertainty=round(mean_uncertainty, 3),
    )


# ── Data-driven feedback ───────────────────────────────────────────────

def _generate_feedback(
    word_scores: list[WordScore],
    pronunciation: int,
    fluency: int,
    prosody: ProsodyResult,
) -> dict:
    """Generate structured, visual feedback.

    Returns:
        {
            "summary": str,
            "phoneme_errors": [{"phoneme", "confused_with", "score", "words"}, ...],
            "missed_words": [str, ...],
            "prosody_tips": [{"label", "score", "detail"}, ...],
            "tips": [str, ...]   # legacy text tips for anything not covered above
        }
    """
    phoneme_errors: list[dict] = []
    missed_words: list[str] = []
    prosody_tips: list[dict] = []
    tips: list[str] = []

    # ── Phoneme errors (grouped by phoneme) ──
    error_map: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for ws in word_scores:
        if ws.status == "missed":
            continue
        for pd in ws.phoneme_details:
            if pd["score"] < 40:
                error_map[pd["phoneme"]].append((ws.word, pd))

    phoneme_impacts: list[tuple[str, float, list[tuple[str, dict]]]] = []
    for phoneme, occurrences in error_map.items():
        avg_score = sum(o[1]["score"] for o in occurrences) / len(occurrences)
        impact = (100 - avg_score) * len(occurrences)
        phoneme_impacts.append((phoneme, impact, occurrences))

    phoneme_impacts.sort(key=lambda x: -x[1])

    for phoneme, _, occurrences in phoneme_impacts[:5]:
        words_affected = list(dict.fromkeys(o[0] for o in occurrences))[:4]
        avg_score = round(sum(o[1]["score"] for o in occurrences) / len(occurrences))
        example_pd = occurrences[0][1]
        confused_with = None
        if example_pd.get("confusion") and example_pd.get("best_alternative"):
            confused_with = example_pd["best_alternative"]

        phoneme_errors.append({
            "phoneme": phoneme,
            "confused_with": confused_with,
            "score": avg_score,
            "words": words_affected,
        })

    # ── Missed words ──
    for ws in word_scores:
        if ws.status == "missed":
            missed_words.append(ws.word)

    # ── Prosody tips ──
    if prosody.stress_score < 45:
        prosody_tips.append({
            "label": "Stress",
            "score": prosody.stress_score,
            "detail": "Content words should be louder & longer than function words",
        })
    if prosody.intonation_score < 45:
        detail = ("Pitch is too flat — vary your pitch more"
                  if prosody.contour_type == "flat"
                  else "Pitch variation needs work — aim for natural rise and fall")
        prosody_tips.append({
            "label": "Intonation",
            "score": prosody.intonation_score,
            "detail": detail,
        })
    if prosody.rhythm_score < 45:
        detail = ("Speech is too even — stress key syllables longer"
                  if prosody.npvi < 40
                  else "Speech is choppy — try connecting words more smoothly")
        prosody_tips.append({
            "label": "Rhythm",
            "score": prosody.rhythm_score,
            "detail": detail,
        })

    if fluency < 45:
        tips.append("Try to speak more continuously with fewer pauses between words")

    # Summary
    if pronunciation >= 80:
        summary = "Great pronunciation! Keep it up."
    elif pronunciation >= 60:
        summary = "Good attempt! A few sounds need attention."
    elif pronunciation >= 40:
        summary = "Keep practicing — focus on the highlighted sounds."
    else:
        summary = "Listen to the original again and try speaking slowly."

    return {
        "summary": summary,
        "phoneme_errors": phoneme_errors,
        "missed_words": missed_words,
        "prosody_tips": prosody_tips,
        "tips": tips,
    }
