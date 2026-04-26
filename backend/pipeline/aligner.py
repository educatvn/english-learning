"""
Forced Alignment Layer
======================
CTC-based forced alignment using Viterbi decoding on the wav2vec2 lattice.

Why CTC forced alignment instead of MFA or Whisper timestamps:
- Uses the SAME model that computes posteriors for GOP → no model mismatch
- Frame-accurate phoneme boundaries (20ms resolution)
- Handles slight transcript/audio mismatch via CTC blank topology
- No external tool dependencies (MFA requires separate install + lexicon)

The alignment maps a sequence of expected phonemes to CTC frames, producing
per-phoneme time boundaries. This is the foundation for GOP, duration, and
prosody scoring.

CTC topology: blank, phone[0], blank, phone[1], ..., blank
Each phoneme can self-loop (repeat frames) and transition through optional blanks.

v2 additions:
- Per-phoneme posterior confidence (mean P(phone|frame) over aligned frames)
- Per-phoneme uncertainty (normalized entropy of frame posteriors)
- Word confidence as posterior-weighted average (not just aligned ratio)
"""

import math
from dataclasses import dataclass

import torch

from .text_processor import normalize_phoneme_list, _PHONE_ALIASES


# ── Data structures ──────────────────────────────────────────────────────

@dataclass
class AlignedPhoneme:
    """A single phoneme aligned to a time range in the audio."""
    phoneme: str            # Normalized phoneme symbol
    frame_start: int        # First CTC frame (inclusive)
    frame_end: int          # Last CTC frame (exclusive)
    time_start: float       # Start time in seconds
    time_end: float         # End time in seconds
    log_prob: float         # Average log-probability of this phoneme in its frames
    aligned: bool           # True if successfully aligned (False = fallback)
    posterior: float        # Mean P(phoneme|frame) over aligned frames [0-1]
    uncertainty: float      # Normalized entropy of frame posteriors [0-1], higher = less certain


@dataclass
class AlignedWord:
    """Word-level alignment result."""
    word: str
    phonemes: list[AlignedPhoneme]
    time_start: float
    time_end: float
    confidence: float       # Alignment confidence (0-1), posterior-weighted


@dataclass
class AlignmentResult:
    """Full alignment output."""
    words: list[AlignedWord]
    total_frames: int
    frame_duration: float
    alignment_confidence: float     # Overall alignment quality (0-1)


# ── Phoneme → vocab ID resolution ────────────────────────────────────────

_REVERSE_ALIASES: dict[str, list[str]] = {}
for _raw, _norm in _PHONE_ALIASES.items():
    _REVERSE_ALIASES.setdefault(_norm, []).append(_raw)


def resolve_phone_id(phone: str, vocab: dict[str, int]) -> int | None:
    """Find the wav2vec2 vocab id for a normalized phoneme."""
    if phone in vocab:
        return vocab[phone]
    for raw in _REVERSE_ALIASES.get(phone, ()):
        if raw in vocab:
            return vocab[raw]
    return None


def resolve_phone_ids(
    phones: list[str], vocab: dict[str, int],
) -> tuple[list[int], list[str], list[int]]:
    """Resolve normalized phonemes to vocab ids.

    Returns (ids, resolved_phones, original_indices) — only phonemes
    mappable to the vocabulary are included.
    """
    ids: list[int] = []
    resolved: list[str] = []
    indices: list[int] = []
    for idx, p in enumerate(phones):
        pid = resolve_phone_id(p, vocab)
        if pid is not None:
            ids.append(pid)
            resolved.append(p)
            indices.append(idx)
    return ids, resolved, indices


# ── Frame-level posterior & uncertainty ─────────────────────────────────

def _compute_frame_stats(
    log_probs: torch.Tensor,
    frame_start: int,
    frame_end: int,
    phone_id: int,
) -> tuple[float, float]:
    """Compute posterior confidence and uncertainty for a phoneme segment.

    Args:
        log_probs: (T, C) full log-probability tensor
        frame_start: first frame (inclusive)
        frame_end: last frame (exclusive)
        phone_id: vocab ID of the expected phoneme

    Returns:
        (posterior, uncertainty):
        - posterior: mean P(phone|frame) — how strongly the model sees this phoneme
        - uncertainty: mean normalized entropy — how spread the posterior is
    """
    if frame_start < 0 or frame_end <= frame_start:
        return 0.0, 1.0

    segment = log_probs[frame_start:frame_end]  # (N, C)
    n_classes = segment.shape[1]

    # Posterior: mean probability of expected phoneme across frames
    posterior = segment[:, phone_id].exp().mean().item()

    # Uncertainty: mean entropy of full distribution, normalized to [0,1]
    # H = -sum(p * log(p)), max H = log(C)
    probs = segment.exp()  # (N, C)
    frame_entropy = -(probs * segment).sum(dim=-1)  # (N,)
    mean_entropy = frame_entropy.mean().item()
    max_entropy = math.log(n_classes) if n_classes > 1 else 1.0
    uncertainty = min(1.0, mean_entropy / max_entropy)

    return posterior, uncertainty


# ── CTC Viterbi forced alignment ────────────────────────────────────────

def ctc_force_align(
    log_probs: torch.Tensor,
    phone_ids: list[int],
    blank_id: int,
    frame_start: int = 0,
    frame_end: int = -1,
) -> list[tuple[int, int, float]]:
    """CTC forced alignment via Viterbi on a frame range.

    CTC topology: blank, phone[0], blank, phone[1], ..., blank
    Each state can self-loop and transition to next state.
    Skip-blank transitions allowed when adjacent phonemes differ.

    Args:
        log_probs: (T, C) log-softmax output
        phone_ids: vocab ids of expected phonemes
        blank_id: CTC blank token id
        frame_start: first frame (inclusive)
        frame_end: last frame (exclusive), -1 = end

    Returns:
        List of (start_frame, end_frame, avg_log_prob) per phoneme.
        Frames are absolute indices. Unaligned phonemes get (-1, -1, -inf).
    """
    if frame_end < 0:
        frame_end = log_probs.shape[0]

    if not phone_ids or frame_start >= frame_end:
        return [(-1, -1, float("-inf"))] * len(phone_ids)

    T = frame_end - frame_start
    S = len(phone_ids)
    num_states = 2 * S + 1
    NEG_INF = float("-inf")

    # State token mapping: even=blank, odd=phoneme
    state_tokens = torch.zeros(num_states, dtype=torch.long)
    for i in range(S):
        state_tokens[2 * i] = blank_id
        state_tokens[2 * i + 1] = phone_ids[i]
    state_tokens[-1] = blank_id

    # Precompute emissions: (T, num_states)
    frame_slice = log_probs[frame_start:frame_end]
    emissions = frame_slice[:, state_tokens]

    # DP tables
    dp = torch.full((T, num_states), NEG_INF)
    bp = torch.zeros((T, num_states), dtype=torch.long)

    # Initialize: can start at state 0 (blank) or state 1 (first phone)
    dp[0, 0] = emissions[0, 0]
    if num_states > 1:
        dp[0, 1] = emissions[0, 1]

    # Skip-blank transitions: allowed when state_tokens[s] != state_tokens[s-2]
    can_skip = torch.zeros(num_states, dtype=torch.bool)
    for s in range(2, num_states):
        can_skip[s] = state_tokens[s] != state_tokens[s - 2]

    # Forward pass
    for t in range(1, T):
        emit = emissions[t]

        # Self-loop
        score_self = dp[t - 1].clone()
        source = torch.arange(num_states, dtype=torch.long)

        # From previous state (s-1)
        score_prev = torch.full((num_states,), NEG_INF)
        score_prev[1:] = dp[t - 1, :-1]
        better_prev = score_prev > score_self
        score_self = torch.where(better_prev, score_prev, score_self)
        source = torch.where(better_prev, source - 1, source)

        # Skip blank (s-2)
        score_skip = torch.full((num_states,), NEG_INF)
        score_skip[2:] = dp[t - 1, :-2]
        better_skip = can_skip & (score_skip > score_self)
        score_self = torch.where(better_skip, score_skip, score_self)
        source = torch.where(better_skip, source - 2, source)

        dp[t] = score_self + emit
        bp[t] = source

    # Best final state
    final_states = [num_states - 1, num_states - 2] if num_states >= 2 else [0]
    best_state = max(final_states, key=lambda s: dp[T - 1, s].item())

    # Traceback
    state_seq = torch.zeros(T, dtype=torch.long)
    state_seq[T - 1] = best_state
    for t in range(T - 2, -1, -1):
        state_seq[t] = bp[t + 1, state_seq[t + 1]]

    # Extract per-phoneme segments
    state_seq_list = state_seq.tolist()
    segments: list[tuple[int, int, float]] = []

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
            abs_start = frame_start + first
            abs_end = frame_start + last + 1
            # Compute average log-prob for this phoneme in its frames
            phone_lp = frame_slice[first:last + 1, 2 * i + 1]
            avg_lp = phone_lp.mean().item()
            segments.append((abs_start, abs_end, avg_lp))
        else:
            segments.append((-1, -1, NEG_INF))

    return segments


# ── Full alignment pipeline ─────────────────────────────────────────────

def align_utterance(
    flat_phonemes: list[str],
    word_boundaries: list[tuple[int, int]],
    words: list,  # list[WordPhonemes]
    log_probs: torch.Tensor,
    vocab: dict[str, int],
    blank_id: int,
    frame_duration: float,
) -> AlignmentResult:
    """Align an entire utterance: all words and phonemes at once.

    Strategy:
    1. Align the FULL phoneme sequence globally (not per-word).
       This is critical because CTC alignment needs global context —
       per-word alignment would lose inter-word coarticulation.
    2. Then slice the global alignment into per-word segments using
       the word_boundaries mapping.
    3. Compute per-phoneme posterior and uncertainty from frame posteriors.
    4. Word confidence = mean phoneme posterior (not just aligned ratio).
    """
    total_frames = log_probs.shape[0]

    if not flat_phonemes:
        return AlignmentResult(
            words=[], total_frames=total_frames,
            frame_duration=frame_duration, alignment_confidence=0.0,
        )

    # Resolve all phonemes to vocab ids
    phone_ids, resolved_phones, resolved_indices = resolve_phone_ids(
        flat_phonemes, vocab,
    )

    if not phone_ids:
        # No phonemes could be resolved — return empty alignment
        empty_words = []
        for i, w in enumerate(words):
            start, end = word_boundaries[i]
            n_phones = end - start
            empty_words.append(AlignedWord(
                word=w.word,
                phonemes=[
                    AlignedPhoneme(
                        phoneme=flat_phonemes[start + j] if start + j < len(flat_phonemes) else "?",
                        frame_start=-1, frame_end=-1,
                        time_start=-1, time_end=-1,
                        log_prob=float("-inf"), aligned=False,
                        posterior=0.0, uncertainty=1.0,
                    )
                    for j in range(n_phones)
                ],
                time_start=-1, time_end=-1, confidence=0.0,
            ))
        return AlignmentResult(
            words=empty_words, total_frames=total_frames,
            frame_duration=frame_duration, alignment_confidence=0.0,
        )

    # Global CTC forced alignment
    segments = ctc_force_align(log_probs, phone_ids, blank_id)

    # Build index: flat_phoneme_idx → (segment_data, phone_id)
    seg_map: dict[int, tuple[int, int, float, int]] = {}
    for k, flat_idx in enumerate(resolved_indices):
        fs, fe, lp = segments[k]
        seg_map[flat_idx] = (fs, fe, lp, phone_ids[k])

    # Compute alignment confidence from posteriors
    all_posteriors: list[float] = []

    # Slice into per-word alignment
    aligned_words: list[AlignedWord] = []

    for i, w in enumerate(words):
        wb_start, wb_end = word_boundaries[i]
        word_phonemes: list[AlignedPhoneme] = []
        word_frame_start = total_frames
        word_frame_end = 0
        word_posteriors: list[float] = []

        for flat_idx in range(wb_start, wb_end):
            phone = flat_phonemes[flat_idx]
            if flat_idx in seg_map:
                fs, fe, lp, pid = seg_map[flat_idx]
                if fs >= 0:
                    word_frame_start = min(word_frame_start, fs)
                    word_frame_end = max(word_frame_end, fe)

                    # Compute frame-level posterior and uncertainty
                    posterior, uncertainty = _compute_frame_stats(
                        log_probs, fs, fe, pid,
                    )
                    word_posteriors.append(posterior)
                    all_posteriors.append(posterior)

                    word_phonemes.append(AlignedPhoneme(
                        phoneme=phone,
                        frame_start=fs, frame_end=fe,
                        time_start=round(fs * frame_duration, 4),
                        time_end=round(fe * frame_duration, 4),
                        log_prob=lp, aligned=True,
                        posterior=round(posterior, 4),
                        uncertainty=round(uncertainty, 4),
                    ))
                else:
                    word_phonemes.append(AlignedPhoneme(
                        phoneme=phone,
                        frame_start=-1, frame_end=-1,
                        time_start=-1, time_end=-1,
                        log_prob=float("-inf"), aligned=False,
                        posterior=0.0, uncertainty=1.0,
                    ))
            else:
                # Phoneme not in vocab — unaligned
                word_phonemes.append(AlignedPhoneme(
                    phoneme=phone,
                    frame_start=-1, frame_end=-1,
                    time_start=-1, time_end=-1,
                    log_prob=float("-inf"), aligned=False,
                    posterior=0.0, uncertainty=1.0,
                ))

        # Word confidence: mean posterior of aligned phonemes
        # This is more informative than the binary aligned/total ratio
        if word_posteriors:
            word_conf = sum(word_posteriors) / len(word_posteriors)
        else:
            word_conf = 0.0

        if word_frame_start < word_frame_end:
            ws = round(word_frame_start * frame_duration, 4)
            we = round(word_frame_end * frame_duration, 4)
        else:
            ws, we = -1.0, -1.0

        aligned_words.append(AlignedWord(
            word=w.word,
            phonemes=word_phonemes,
            time_start=ws, time_end=we,
            confidence=round(word_conf, 4),
        ))

    # Overall alignment confidence: mean posterior across all aligned phonemes
    alignment_confidence = (
        sum(all_posteriors) / len(all_posteriors) if all_posteriors else 0.0
    )

    return AlignmentResult(
        words=aligned_words,
        total_frames=total_frames,
        frame_duration=frame_duration,
        alignment_confidence=round(alignment_confidence, 4),
    )
