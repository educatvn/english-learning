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

# Whisper confidence: below this log-prob, word is likely mispronounced
# even though Whisper's LM auto-corrected it to a real English word.
WORD_LOW_CONFIDENCE = -0.5
PENALTY_LOW_CONFIDENCE = 0.3   # Penalty for low-confidence matches


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
) -> tuple[list[str], list[int]]:
    """Align reference words against transcript words using edit distance.

    Returns:
        statuses: list of length len(reference), each element is:
            - "match": word found in transcript at expected position
            - "sub:X": word was substituted with X
            - "miss": word not found
        trans_indices: list of length len(reference), the transcript word
            index that each reference word matched/substituted with (-1 if missed).
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

    # Backtrack — also track which transcript index each ref word aligned to
    result = ["miss"] * n
    trans_indices = [-1] * n
    i, j = n, m
    while i > 0 and j > 0:
        if reference[i - 1] == transcript[j - 1] and dp[i][j] == dp[i - 1][j - 1]:
            result[i - 1] = "match"
            trans_indices[i - 1] = j - 1
            i -= 1
            j -= 1
        elif dp[i][j] == dp[i - 1][j - 1] + 1:
            result[i - 1] = f"sub:{transcript[j - 1]}"
            trans_indices[i - 1] = j - 1
            i -= 1
            j -= 1
        elif dp[i][j] == dp[i][j - 1] + 1:
            j -= 1
        else:
            result[i - 1] = "miss"
            i -= 1

    return result, trans_indices


# ── Main verification ────────────────────────────────────────────────────

def verify_utterance(
    asr_transcript: str,
    reference_text: str,
    reference_words: list[str],
    word_confidences: list[float] | None = None,
) -> VerificationResult:
    """Verify ASR transcript against reference text.

    Args:
        asr_transcript: What the ASR model heard (English words)
        reference_text: The original reference text
        reference_words: List of words from text processor
        word_confidences: Per-word Whisper log-prob confidence (aligned with
            words in asr_transcript). Used to detect mispronunciations that
            Whisper's LM auto-corrected: if a word matches but confidence
            is low, apply a penalty instead of full match.

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

    statuses, trans_indices = _align_words(ref_norm, trans_norm)

    word_verifications: list[WordVerification] = []
    n_matched = 0

    for i, (orig_word, status) in enumerate(zip(reference_words, statuses)):
        if status == "match":
            # Check Whisper per-word confidence for this transcript word.
            # If confidence is low, Whisper's LM likely auto-corrected a
            # mispronunciation → reduce penalty to flag it.
            penalty = PENALTY_MATCHED
            ti = trans_indices[i]
            if word_confidences and 0 <= ti < len(word_confidences):
                conf = word_confidences[ti]
                if conf < WORD_LOW_CONFIDENCE:
                    penalty = PENALTY_LOW_CONFIDENCE

            word_verifications.append(WordVerification(
                word=orig_word,
                is_verified=penalty >= PENALTY_MATCHED,
                penalty=penalty,
                heard_as=None,
            ))
            if penalty >= PENALTY_MATCHED:
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
