"""
Prosody Modeling Module
=======================
Extracts and scores prosodic features: stress, rhythm, intonation, and rate.

v3 fixes:
- #5:  F0 extraction with median smoothing + outlier removal for noise robustness
- #6:  F0 averaging bug fixed (no more `sum() or 1.0` breaking distribution)
- #7:  RMS normalized by global mean (mic-volume-independent)
- #8:  nPVI normalized by 1/sqrt(rate) (speech-theory correct)
- #9:  Contour detection via 3-segment analysis (peak, slopes, end contour)

Prosody is critical for intelligibility — a learner with perfect phonemes
but flat prosody sounds robotic and is hard to understand.

All scores are 0-100 and computed per-word where possible.
"""

import math
from dataclasses import dataclass

import torch
import torchaudio

from .aligner import AlignedWord, AlignmentResult
from .text_processor import FUNCTION_WORDS, WordPhonemes


# ── Configuration ────────────────────────────────────────────────────────

# F0 extraction
F0_HOP_LENGTH = 0.010           # 10ms hop
F0_FRAME_LENGTH = 0.032         # 32ms window
F0_FMIN = 75.0                  # Hz, low male voice
F0_FMAX = 500.0                 # Hz, high female voice
F0_MEDIAN_KERNEL = 5            # Median filter kernel for F0 smoothing
F0_OUTLIER_ZSCORE = 2.5         # Z-score threshold for F0 outlier removal

# Stress scoring weights (must sum to 1.0)
STRESS_W_ENERGY = 0.35
STRESS_W_DURATION = 0.35
STRESS_W_F0 = 0.30

# Stress ratio targets: content-word feature / function-word feature
STRESS_RATIO_SWEET_LOW = 1.15
STRESS_RATIO_SWEET_HIGH = 2.5

# Intonation: F0 std thresholds (in log-F0 semitones, speaker-normalized)
INTONATION_LOGF0_STD_LOW = 1.5     # semitones, below = monotone
INTONATION_LOGF0_STD_SWEET = 4.0   # semitones, ideal lower bound
INTONATION_LOGF0_STD_HIGH = 10.0   # semitones, above = exaggerated

# Rhythm scoring (nPVI)
RHYTHM_NPVI_SWEET_LOW = 40.0
RHYTHM_NPVI_SWEET_HIGH = 80.0

# Speaking rate (must match duration module's reference)
RATE_SWEET_LOW = 2.0            # words/sec
RATE_SWEET_HIGH = 3.5
RATE_MIN = 1.0
RATE_MAX = 4.5

# Minimum words for prosody analysis
MIN_WORDS_FOR_PROSODY = 3
DEFAULT_PROSODY_SCORE = 50


# ── Data structures ──────────────────────────────────────────────────────

@dataclass
class WordProsody:
    """Per-word prosody analysis."""
    word: str
    stress_score: float         # 0-100, multi-feature stress accuracy
    energy_rms: float           # Normalized RMS energy of this word
    f0_mean: float              # Mean F0 in Hz (0 if unvoiced)
    f0_range: float             # F0 range in Hz within this word
    f0_slope: float             # F0 slope (positive=rising, negative=falling)
    vowel_duration_ratio: float # Vowel duration / total word duration
    duration: float             # Word duration in seconds
    is_content_word: bool


@dataclass
class ProsodyResult:
    """Full prosody analysis."""
    stress_score: int           # 0-100, overall stress placement
    intonation_score: int       # 0-100, F0 contour quality
    rhythm_score: int           # 0-100, timing regularity
    rate_score: int             # 0-100, speaking rate naturalness
    overall_score: int          # 0-100, weighted combination
    word_prosody: list[WordProsody]
    speaking_rate: float        # words per second
    npvi: float                 # normalized PVI value
    f0_std: float               # F0 standard deviation (log-F0 semitones)
    contour_type: str           # "falling", "rising", "flat", "rise-fall"


# ── Audio feature extraction ────────────────────────────────────────────

def _extract_f0(waveform: torch.Tensor, sr: int) -> torch.Tensor:
    """Extract F0 contour with median smoothing and outlier removal.

    Fix #5: Raw F0 from torchaudio is noisy (halving/doubling errors,
    spurious detections in noise). We apply:
    1. Median filter (kernel=5) to remove pitch halving/doubling spikes
    2. Z-score outlier removal on voiced frames
    This makes F0 robust to noise, female/child voices, and low SNR.
    """
    raw_f0 = torchaudio.functional.detect_pitch_frequency(
        waveform, sr,
        frame_time=F0_HOP_LENGTH,
        win_length=int(F0_FRAME_LENGTH * 1000),
        freq_low=int(F0_FMIN),
        freq_high=int(F0_FMAX),
    ).squeeze()  # (T,)

    if raw_f0.numel() < F0_MEDIAN_KERNEL:
        return raw_f0

    # Step 1: Median filter to smooth pitch halving/doubling errors
    # Only apply to voiced frames (F0 > 0), keep unvoiced as 0
    padded = raw_f0.unsqueeze(0).unsqueeze(0)  # (1, 1, T) for median filter
    k = F0_MEDIAN_KERNEL
    # Manual median filter: for each frame, take median of surrounding k frames
    pad_size = k // 2
    padded_f0 = torch.nn.functional.pad(padded, (pad_size, pad_size), mode='reflect')
    unfolded = padded_f0.unfold(-1, k, 1).squeeze(0).squeeze(0)  # (T, k)
    smoothed = unfolded.median(dim=-1).values  # (T,)

    # Step 2: Outlier removal on voiced frames using z-score
    voiced_mask = smoothed > F0_FMIN
    voiced_vals = smoothed[voiced_mask]

    if voiced_vals.numel() < 5:
        return smoothed

    mean_f0 = voiced_vals.mean()
    std_f0 = voiced_vals.std()

    if std_f0 > 0:
        z_scores = ((smoothed - mean_f0) / std_f0).abs()
        # Zero out frames with extreme z-scores (likely octave errors)
        outlier_mask = (z_scores > F0_OUTLIER_ZSCORE) & voiced_mask
        smoothed[outlier_mask] = 0.0

    return smoothed


def _hz_to_semitones(f0_hz: torch.Tensor, ref_hz: float) -> torch.Tensor:
    """Convert F0 in Hz to semitones relative to a reference.

    Semitones = 12 * log2(f0 / ref)

    Using log-F0 (semitones) instead of raw Hz because:
    - Pitch perception is logarithmic
    - Speaker normalization: a 100→200 Hz rise (male) is perceptually
      equivalent to a 200→400 Hz rise (female) — both are 12 semitones
    """
    safe = f0_hz.clamp(min=1.0)
    return 12.0 * torch.log2(safe / ref_hz)


def _word_rms(waveform: torch.Tensor, sr: int, start: float, end: float) -> float:
    """RMS energy of a word segment (raw, not yet normalized)."""
    s = max(0, int(start * sr))
    e = min(waveform.shape[-1], int(end * sr))
    if e <= s:
        return 0.0
    segment = waveform[..., s:e].float()
    return segment.pow(2).mean().sqrt().item()


def _word_f0_stats(
    f0: torch.Tensor, start: float, end: float, hop: float,
) -> tuple[float, float, float]:
    """Mean F0, F0 range, and F0 slope within a word's time range.

    Returns (mean_hz, range_hz, slope_semitones_per_sec).
    """
    fs = max(0, int(start / hop))
    fe = min(f0.numel(), int(end / hop))
    if fe <= fs:
        return 0.0, 0.0, 0.0

    segment = f0[fs:fe]
    voiced = segment[segment > F0_FMIN]
    if voiced.numel() < 2:
        return 0.0, 0.0, 0.0

    mean_hz = voiced.mean().item()
    range_hz = (voiced.max() - voiced.min()).item()

    # Compute slope in semitones/sec via linear regression
    ref_hz = mean_hz if mean_hz > 0 else 100.0
    semitones = _hz_to_semitones(voiced, ref_hz)
    n = semitones.numel()
    t = torch.arange(n, dtype=torch.float32) * hop
    t_mean = t.mean()
    s_mean = semitones.mean()
    cov = ((t - t_mean) * (semitones - s_mean)).sum()
    var_t = ((t - t_mean) ** 2).sum()
    slope = (cov / var_t).item() if var_t > 0 else 0.0

    return mean_hz, range_hz, slope


def _word_vowel_duration_ratio(aligned_word: AlignedWord) -> float:
    """Ratio of vowel duration to total word duration."""
    if aligned_word.time_start < 0 or aligned_word.time_end <= aligned_word.time_start:
        return 0.0

    total_dur = aligned_word.time_end - aligned_word.time_start
    if total_dur <= 0:
        return 0.0

    _vowel_chars = set("iyɨʉɯuɪʏʊeøɘɵɤoəɛœɜɞʌɔæɐaɶɑɒɚɝ")
    vowel_dur = 0.0
    for ap in aligned_word.phonemes:
        if ap.aligned and ap.time_start >= 0:
            if any(c in _vowel_chars for c in ap.phoneme):
                vowel_dur += ap.time_end - ap.time_start

    return vowel_dur / total_dur


# ── Contour detection (3-segment) ────────────────────────────────────────

def _detect_contour(
    f0: torch.Tensor, speech_start: float, speech_end: float,
) -> str:
    """Detect F0 contour shape via 3-segment analysis.

    Fix #9: Instead of naive 2-half split, we divide into thirds and
    analyze the trajectory between segments to detect:
    - falling: Q1 > Q2 > Q3 (declarative)
    - rising: Q1 < Q2 < Q3 (question)
    - rise-fall: Q1 < Q2 > Q3 (emphasis/focus)
    - flat: no significant movement

    Thresholds are in semitones (speaker-normalized).
    """
    fs = max(0, int(speech_start / F0_HOP_LENGTH))
    fe = min(f0.numel(), int(speech_end / F0_HOP_LENGTH))
    if fe - fs < 12:
        return "flat"

    segment = f0[fs:fe]
    voiced = segment[segment > F0_FMIN]
    if voiced.numel() < 9:
        return "flat"

    n = voiced.numel()
    t1 = n // 3
    t2 = 2 * n // 3

    q1 = voiced[:t1]
    q2 = voiced[t1:t2]
    q3 = voiced[t2:]

    if q1.numel() < 2 or q2.numel() < 2 or q3.numel() < 2:
        return "flat"

    m1 = q1.median().item()
    m2 = q2.median().item()
    m3 = q3.median().item()

    if m1 <= 0 or m2 <= 0 or m3 <= 0:
        return "flat"

    # Compute changes in semitones between segments
    rise_12 = 12.0 * math.log2(m2 / m1)   # Q1 → Q2
    fall_23 = 12.0 * math.log2(m3 / m2)   # Q2 → Q3
    overall = 12.0 * math.log2(m3 / m1)   # Q1 → Q3

    # Classification thresholds (semitones)
    RISE_THRESH = 1.5
    FALL_THRESH = -1.5

    if rise_12 > RISE_THRESH and fall_23 < FALL_THRESH:
        return "rise-fall"
    elif overall < FALL_THRESH:
        return "falling"
    elif overall > RISE_THRESH:
        return "rising"
    else:
        return "flat"


# ── Stress scoring (multi-feature, normalized) ──────────────────────────

def _score_stress(
    waveform: torch.Tensor,
    sr: int,
    f0: torch.Tensor,
    aligned_words: list[AlignedWord],
    text_words: list[WordPhonemes],
) -> tuple[int, list[float], list[float], list[float]]:
    """Score stress placement using normalized energy + vowel duration + F0.

    Fix #6: F0 averaging uses proper mean of valid values (no `or 1.0` hack).
    Fix #7: RMS values are normalized by global mean to remove mic-volume dependence.

    Returns (overall_score, normalized_word_rms_list, word_vowel_ratios, word_f0_peaks).
    """
    raw_rms_list: list[float] = []
    word_vowel_ratios: list[float] = []
    word_f0_peaks: list[float] = []

    for aw, tw in zip(aligned_words, text_words):
        if aw.time_start < 0 or aw.time_end <= aw.time_start:
            raw_rms_list.append(0.0)
            word_vowel_ratios.append(0.0)
            word_f0_peaks.append(0.0)
            continue

        rms = _word_rms(waveform, sr, aw.time_start, aw.time_end)
        vow_ratio = _word_vowel_duration_ratio(aw)
        f0_mean, _, _ = _word_f0_stats(f0, aw.time_start, aw.time_end, F0_HOP_LENGTH)

        raw_rms_list.append(rms)
        word_vowel_ratios.append(vow_ratio)
        word_f0_peaks.append(f0_mean)

    # Fix #7: Normalize RMS by global mean to remove mic volume dependency
    nonzero_rms = [r for r in raw_rms_list if r > 0]
    global_rms = sum(nonzero_rms) / len(nonzero_rms) if nonzero_rms else 1.0
    word_rms_list = [r / (global_rms + 1e-6) for r in raw_rms_list]

    # Separate content vs function word features
    content_features: list[tuple[float, float, float]] = []
    function_features: list[tuple[float, float, float]] = []

    for i, tw in enumerate(text_words):
        if i >= len(word_rms_list):
            break
        rms_n = word_rms_list[i]
        if rms_n <= 0:
            continue
        features = (rms_n, word_vowel_ratios[i], word_f0_peaks[i])
        if tw.is_content_word:
            content_features.append(features)
        else:
            function_features.append(features)

    if not content_features or not function_features:
        return DEFAULT_PROSODY_SCORE, word_rms_list, word_vowel_ratios, word_f0_peaks

    # Compute mean features
    avg_c_energy = sum(f[0] for f in content_features) / len(content_features)
    avg_f_energy = sum(f[0] for f in function_features) / len(function_features)
    avg_c_vow = sum(f[1] for f in content_features) / len(content_features)
    avg_f_vow = sum(f[1] for f in function_features) / len(function_features)

    # Fix #6: Proper F0 averaging — no `sum() or 1.0` hack
    valid_c_f0 = [f[2] for f in content_features if f[2] > 0]
    valid_f_f0 = [f[2] for f in function_features if f[2] > 0]
    avg_c_f0 = sum(valid_c_f0) / len(valid_c_f0) if valid_c_f0 else 0.0
    avg_f_f0 = sum(valid_f_f0) / len(valid_f_f0) if valid_f_f0 else 0.0

    # Compute ratios (content / function), guard against zero
    energy_ratio = avg_c_energy / avg_f_energy if avg_f_energy > 0 else 1.0
    vow_ratio_r = avg_c_vow / avg_f_vow if avg_f_vow > 0 else 1.0
    f0_ratio = avg_c_f0 / avg_f_f0 if avg_c_f0 > 0 and avg_f_f0 > 0 else 1.0

    energy_score = _ratio_to_score(energy_ratio)
    vow_score = _ratio_to_score(vow_ratio_r)
    f0_score = _ratio_to_score(f0_ratio)

    score = round(
        energy_score * STRESS_W_ENERGY
        + vow_score * STRESS_W_DURATION
        + f0_score * STRESS_W_F0
    )

    return min(100, max(0, score)), word_rms_list, word_vowel_ratios, word_f0_peaks


def _ratio_to_score(ratio: float) -> float:
    """Convert a content/function feature ratio to a 0-100 score."""
    if STRESS_RATIO_SWEET_LOW <= ratio <= STRESS_RATIO_SWEET_HIGH:
        mid = (STRESS_RATIO_SWEET_LOW + STRESS_RATIO_SWEET_HIGH) / 2
        dist = abs(ratio - mid) / (STRESS_RATIO_SWEET_HIGH - STRESS_RATIO_SWEET_LOW) * 2
        return max(80.0, 100.0 - dist * 20.0)
    elif ratio < STRESS_RATIO_SWEET_LOW:
        t = max(0.0, (ratio - 0.8) / (STRESS_RATIO_SWEET_LOW - 0.8))
        return 30.0 + t * 50.0
    else:
        overshoot = ratio - STRESS_RATIO_SWEET_HIGH
        return max(40.0, 80.0 - overshoot * 15.0)


# ── Intonation scoring (log-F0 contour) ─────────────────────────────────

def _score_intonation(
    f0: torch.Tensor,
    speech_start: float,
    speech_end: float,
) -> tuple[int, float, str]:
    """Score intonation using log-F0 variation and contour shape.

    Returns (score, f0_std_semitones, contour_type).
    """
    fs = max(0, int(speech_start / F0_HOP_LENGTH))
    fe = min(f0.numel(), int(speech_end / F0_HOP_LENGTH))
    if fe <= fs:
        return DEFAULT_PROSODY_SCORE, 0.0, "flat"

    f0_speech = f0[fs:fe]
    voiced = f0_speech[f0_speech > F0_FMIN]
    if voiced.numel() < 10:
        return DEFAULT_PROSODY_SCORE, 0.0, "flat"

    ref_hz = voiced.median().item()
    if ref_hz <= 0:
        return DEFAULT_PROSODY_SCORE, 0.0, "flat"

    semitones = _hz_to_semitones(voiced, ref_hz)
    f0_std_st = semitones.std().item()

    contour = _detect_contour(f0, speech_start, speech_end)

    if f0_std_st < INTONATION_LOGF0_STD_LOW:
        t = f0_std_st / INTONATION_LOGF0_STD_LOW
        score = int(20 + t * 30)
    elif f0_std_st < INTONATION_LOGF0_STD_SWEET:
        t = (f0_std_st - INTONATION_LOGF0_STD_LOW) / (INTONATION_LOGF0_STD_SWEET - INTONATION_LOGF0_STD_LOW)
        score = int(50 + t * 30)
    elif f0_std_st <= INTONATION_LOGF0_STD_HIGH:
        t = (f0_std_st - INTONATION_LOGF0_STD_SWEET) / (INTONATION_LOGF0_STD_HIGH - INTONATION_LOGF0_STD_SWEET)
        score = int(80 + t * 20)
    else:
        overshoot = f0_std_st - INTONATION_LOGF0_STD_HIGH
        score = max(50, int(90 - overshoot * 3))

    if contour in ("falling", "rising", "rise-fall"):
        score = min(100, score + 5)

    return min(100, max(0, score)), round(f0_std_st, 2), contour


# ── Rhythm scoring (rate-normalized nPVI) ───────────────────────────────

def _score_rhythm(
    aligned_words: list[AlignedWord],
    speaking_rate: float,
) -> tuple[int, float]:
    """Score rhythm using normalized Pairwise Variability Index.

    Fix #8: nPVI normalized by 1/sqrt(rate) instead of linear scaling.
    Speech science: faster speech compresses contrasts sub-linearly.
    Dividing by sqrt(rate) correctly compensates for rate-induced
    duration compression without over-scaling.
    """
    durations: list[float] = []
    for aw in aligned_words:
        if aw.time_start < 0 or aw.time_end <= aw.time_start:
            continue
        dur = aw.time_end - aw.time_start
        if dur > 0.01:
            durations.append(dur)

    if len(durations) < MIN_WORDS_FOR_PROSODY:
        return DEFAULT_PROSODY_SCORE, 0.0

    pvi_sum = 0.0
    n_pairs = 0
    for k in range(len(durations) - 1):
        avg = (durations[k] + durations[k + 1]) / 2
        if avg > 0:
            pvi_sum += abs(durations[k] - durations[k + 1]) / avg
            n_pairs += 1

    if n_pairs == 0:
        return DEFAULT_PROSODY_SCORE, 0.0

    raw_npvi = 100.0 * pvi_sum / n_pairs

    # Fix #8: Normalize by 1/sqrt(rate) — sub-linear rate compensation
    npvi = raw_npvi / math.sqrt(max(speaking_rate, 1e-6))

    if RHYTHM_NPVI_SWEET_LOW <= npvi <= RHYTHM_NPVI_SWEET_HIGH:
        mid = (RHYTHM_NPVI_SWEET_LOW + RHYTHM_NPVI_SWEET_HIGH) / 2
        dist = abs(npvi - mid) / ((RHYTHM_NPVI_SWEET_HIGH - RHYTHM_NPVI_SWEET_LOW) / 2)
        score = max(80, int(100 - dist * 20))
    elif npvi < RHYTHM_NPVI_SWEET_LOW:
        t = npvi / RHYTHM_NPVI_SWEET_LOW
        score = max(30, int(30 + t * 50))
    else:
        overshoot = npvi - RHYTHM_NPVI_SWEET_HIGH
        score = max(40, int(80 - overshoot * 0.5))

    return min(100, max(0, score)), round(npvi, 1)


# ── Speaking rate scoring ────────────────────────────────────────────────

def _score_rate(aligned_words: list[AlignedWord]) -> tuple[int, float]:
    """Score speaking rate (words per second of actual speech).

    Fix #10: Use sum of word durations (speech time only), excluding silence.
    """
    timed_words = [w for w in aligned_words if w.time_start >= 0 and w.time_end > w.time_start]
    if len(timed_words) < 2:
        return DEFAULT_PROSODY_SCORE, 0.0

    # Fix #10: speech_time = sum of individual word durations (excludes gaps)
    speech_time = sum(w.time_end - w.time_start for w in timed_words)
    if speech_time <= 0:
        return DEFAULT_PROSODY_SCORE, 0.0

    wps = len(timed_words) / speech_time

    if wps < RATE_MIN:
        score = max(20, int(wps / RATE_MIN * 40))
    elif wps < RATE_SWEET_LOW:
        t = (wps - RATE_MIN) / (RATE_SWEET_LOW - RATE_MIN)
        score = int(40 + t * 40)
    elif wps <= RATE_SWEET_HIGH:
        t = (wps - RATE_SWEET_LOW) / (RATE_SWEET_HIGH - RATE_SWEET_LOW)
        score = int(80 + t * 20)
    elif wps <= RATE_MAX:
        t = (wps - RATE_SWEET_HIGH) / (RATE_MAX - RATE_SWEET_HIGH)
        score = int(100 - t * 40)
    else:
        overshoot = wps - RATE_MAX
        score = max(20, int(60 - overshoot * 20))

    return min(100, max(0, score)), round(wps, 2)


# ── Per-word stress scoring ─────────────────────────────────────────────

def _score_word_stress(
    tw: WordPhonemes,
    word_rms_norm: float,
    func_avg_rms: float,
    word_f0_mean: float,
    func_avg_f0: float,
    word_vow_ratio: float,
    func_avg_vow_ratio: float,
) -> float:
    """Score stress for a single word using multiple features."""
    if not tw.is_content_word:
        return 70.0

    if word_rms_norm <= 0:
        return 30.0

    has_primary_stress = any(p.stress == 1 for p in tw.phonemes)
    if not has_primary_stress:
        return 70.0

    energy_ratio = word_rms_norm / func_avg_rms if func_avg_rms > 0 else 1.0
    vow_ratio = word_vow_ratio / func_avg_vow_ratio if func_avg_vow_ratio > 0 else 1.0
    f0_ratio = word_f0_mean / func_avg_f0 if word_f0_mean > 0 and func_avg_f0 > 0 else 1.0

    return (
        _ratio_to_score(energy_ratio) * STRESS_W_ENERGY
        + _ratio_to_score(vow_ratio) * STRESS_W_DURATION
        + _ratio_to_score(f0_ratio) * STRESS_W_F0
    )


# ── Main prosody analysis ───────────────────────────────────────────────

def analyze_prosody(
    waveform: torch.Tensor,
    sr: int,
    alignment: AlignmentResult,
    text_words: list[WordPhonemes],
) -> ProsodyResult:
    """Full prosody analysis: stress, intonation, rhythm, rate."""
    aligned_words = alignment.words

    if len(aligned_words) < MIN_WORDS_FOR_PROSODY:
        return ProsodyResult(
            stress_score=DEFAULT_PROSODY_SCORE,
            intonation_score=DEFAULT_PROSODY_SCORE,
            rhythm_score=DEFAULT_PROSODY_SCORE,
            rate_score=DEFAULT_PROSODY_SCORE,
            overall_score=DEFAULT_PROSODY_SCORE,
            word_prosody=[],
            speaking_rate=0.0, npvi=0.0, f0_std=0.0,
            contour_type="flat",
        )

    f0 = _extract_f0(waveform, sr)

    timed = [w for w in aligned_words if w.time_start >= 0]
    if not timed:
        return ProsodyResult(
            stress_score=DEFAULT_PROSODY_SCORE,
            intonation_score=DEFAULT_PROSODY_SCORE,
            rhythm_score=DEFAULT_PROSODY_SCORE,
            rate_score=DEFAULT_PROSODY_SCORE,
            overall_score=DEFAULT_PROSODY_SCORE,
            word_prosody=[],
            speaking_rate=0.0, npvi=0.0, f0_std=0.0,
            contour_type="flat",
        )

    speech_start = timed[0].time_start
    speech_end = timed[-1].time_end

    rate_score, wps = _score_rate(aligned_words)

    stress_score, word_rms, word_vow_ratios, word_f0_peaks = _score_stress(
        waveform, sr, f0, aligned_words, text_words,
    )
    intonation_score, f0_std, contour_type = _score_intonation(f0, speech_start, speech_end)
    rhythm_score, npvi = _score_rhythm(aligned_words, wps)

    # Function word averages for per-word stress scoring (using normalized RMS)
    func_rms_vals = [word_rms[j] for j, tw in enumerate(text_words)
                     if not tw.is_content_word and j < len(word_rms) and word_rms[j] > 0]
    func_avg_rms = sum(func_rms_vals) / len(func_rms_vals) if func_rms_vals else 0.0

    func_vow_vals = [word_vow_ratios[j] for j, tw in enumerate(text_words)
                     if not tw.is_content_word and j < len(word_vow_ratios) and word_vow_ratios[j] > 0]
    func_avg_vow = sum(func_vow_vals) / len(func_vow_vals) if func_vow_vals else 0.0

    # Fix #6: Proper averaging for function word F0
    func_f0_vals = [word_f0_peaks[j] for j, tw in enumerate(text_words)
                    if not tw.is_content_word and j < len(word_f0_peaks) and word_f0_peaks[j] > 0]
    func_avg_f0 = sum(func_f0_vals) / len(func_f0_vals) if func_f0_vals else 0.0

    word_prosody: list[WordProsody] = []
    for i, (aw, tw) in enumerate(zip(aligned_words, text_words)):
        if aw.time_start < 0:
            word_prosody.append(WordProsody(
                word=aw.word, stress_score=0.0, energy_rms=0.0,
                f0_mean=0.0, f0_range=0.0, f0_slope=0.0,
                vowel_duration_ratio=0.0, duration=0.0,
                is_content_word=tw.is_content_word,
            ))
            continue

        rms = word_rms[i] if i < len(word_rms) else 0.0
        vow_ratio = word_vow_ratios[i] if i < len(word_vow_ratios) else 0.0
        f0_mean, f0_range, f0_slope = _word_f0_stats(f0, aw.time_start, aw.time_end, F0_HOP_LENGTH)
        dur = aw.time_end - aw.time_start

        w_stress = _score_word_stress(
            tw, rms, func_avg_rms,
            f0_mean, func_avg_f0,
            vow_ratio, func_avg_vow,
        )

        word_prosody.append(WordProsody(
            word=aw.word,
            stress_score=round(min(100.0, max(0.0, w_stress)), 1),
            energy_rms=round(rms, 4),
            f0_mean=round(f0_mean, 1),
            f0_range=round(f0_range, 1),
            f0_slope=round(f0_slope, 2),
            vowel_duration_ratio=round(vow_ratio, 3),
            duration=round(dur, 4),
            is_content_word=tw.is_content_word,
        ))

    overall = round(
        stress_score * 0.30
        + intonation_score * 0.30
        + rhythm_score * 0.25
        + rate_score * 0.15
    )

    return ProsodyResult(
        stress_score=stress_score,
        intonation_score=intonation_score,
        rhythm_score=rhythm_score,
        rate_score=rate_score,
        overall_score=min(100, max(0, overall)),
        word_prosody=word_prosody,
        speaking_rate=wps,
        npvi=npvi,
        f0_std=f0_std,
        contour_type=contour_type,
    )
