"""
ASR Verification Module
=======================
Compares ASR word-level transcript against reference text to verify
what the user actually said.

This is the simple, correct approach:
    1. ASR model (wav2vec2-base-960h) → English word transcript
    2. Normalize both transcript and reference (lowercase, strip punctuation)
    3. Word-level edit distance alignment
    4. Each reference word → matched / substituted / missed

No phoneme comparison. No sliding windows. Just word matching.
"""

import re
from dataclasses import dataclass


# ── Configuration ────────────────────────────────────────────────────────

# Penalty for words not found in transcript
PENALTY_MISSED = 0.0
PENALTY_SUBSTITUTED = 0.1
PENALTY_MATCHED = 1.0


# ── Data structures ──────────────────────────────────────────────────────

@dataclass
class WordVerification:
    """Verification result for a single word."""
    word: str
    is_verified: bool       # True if word was found in transcript
    penalty: float          # 0-1 multiplier for GOP score
    heard_as: str | None    # What ASR heard instead (if substituted)


@dataclass
class VerificationResult:
    """Full verification of an utterance."""
    transcript: str                         # What ASR actually heard (English words)
    word_verifications: list[WordVerification]
    overall_match: float                    # 0-1, fraction of words matched


# ── Text normalization ───────────────────────────────────────────────────

def _normalize_text(text: str) -> list[str]:
    """Normalize text to word list: lowercase, strip punctuation."""
    text = text.lower()
    text = re.sub(r"[^a-z'\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text.split() if text else []


# ── Word-level alignment (edit distance DP) ──────────────────────────────

def _align_words(
    reference: list[str],
    transcript: list[str],
) -> list[str]:
    """Align reference words against transcript words using edit distance.

    Returns a list of length len(reference), where each element is:
    - "match": word found in transcript at expected position
    - "sub:X": word was substituted with X
    - "miss": word not found

    Uses standard Levenshtein DP with backtracking.
    """
    n = len(reference)
    m = len(transcript)

    # DP table
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if reference[i - 1] == transcript[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(
                    dp[i - 1][j],       # delete (ref word missing from transcript)
                    dp[i][j - 1],       # insert (extra word in transcript)
                    dp[i - 1][j - 1],   # substitute
                )

    # Backtrack
    result = ["miss"] * n
    i, j = n, m
    while i > 0 and j > 0:
        if reference[i - 1] == transcript[j - 1] and dp[i][j] == dp[i - 1][j - 1]:
            result[i - 1] = "match"
            i -= 1
            j -= 1
        elif dp[i][j] == dp[i - 1][j - 1] + 1:
            # substitution
            result[i - 1] = f"sub:{transcript[j - 1]}"
            i -= 1
            j -= 1
        elif dp[i][j] == dp[i][j - 1] + 1:
            # insertion (extra word in transcript, skip it)
            j -= 1
        else:
            # deletion (ref word missing)
            result[i - 1] = "miss"
            i -= 1

    return result


# ── Main verification ────────────────────────────────────────────────────

def verify_utterance(
    asr_transcript: str,
    reference_text: str,
    reference_words: list[str],
) -> VerificationResult:
    """Verify ASR transcript against reference text.

    Args:
        asr_transcript: What the ASR model heard (English words)
        reference_text: The original reference text
        reference_words: List of words from text processor (may differ from
                        raw reference due to contraction expansion etc.)

    Returns:
        VerificationResult with per-word match status.
    """
    ref_norm = [w.lower() for w in reference_words]
    trans_norm = _normalize_text(asr_transcript)

    if not ref_norm:
        return VerificationResult(
            transcript=asr_transcript,
            word_verifications=[],
            overall_match=0.0,
        )

    if not trans_norm:
        # ASR heard nothing
        return VerificationResult(
            transcript=asr_transcript,
            word_verifications=[
                WordVerification(
                    word=w, is_verified=False,
                    penalty=PENALTY_MISSED, heard_as=None,
                )
                for w in reference_words
            ],
            overall_match=0.0,
        )

    alignment = _align_words(ref_norm, trans_norm)

    word_verifications: list[WordVerification] = []
    n_matched = 0

    for i, (orig_word, status) in enumerate(zip(reference_words, alignment)):
        if status == "match":
            word_verifications.append(WordVerification(
                word=orig_word,
                is_verified=True,
                penalty=PENALTY_MATCHED,
                heard_as=None,
            ))
            n_matched += 1
        elif status.startswith("sub:"):
            heard = status[4:]
            word_verifications.append(WordVerification(
                word=orig_word,
                is_verified=False,
                penalty=PENALTY_SUBSTITUTED,
                heard_as=heard,
            ))
        else:
            word_verifications.append(WordVerification(
                word=orig_word,
                is_verified=False,
                penalty=PENALTY_MISSED,
                heard_as=None,
            ))

    overall = n_matched / len(ref_norm) if ref_norm else 0.0

    return VerificationResult(
        transcript=asr_transcript,
        word_verifications=word_verifications,
        overall_match=round(overall, 3),
    )


def verify_word(
    asr_transcript: str,
    word: str,
) -> WordVerification:
    """Verify a single word (for word practice mode)."""
    trans_words = _normalize_text(asr_transcript)
    target = word.lower().strip()

    if target in trans_words:
        return WordVerification(
            word=word, is_verified=True,
            penalty=PENALTY_MATCHED, heard_as=None,
        )

    if trans_words:
        return WordVerification(
            word=word, is_verified=False,
            penalty=PENALTY_SUBSTITUTED,
            heard_as=" ".join(trans_words),
        )

    return WordVerification(
        word=word, is_verified=False,
        penalty=PENALTY_MISSED, heard_as=None,
    )
