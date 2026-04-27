"""
Pipeline Orchestrator
=====================
Coordinates all modules into a single pronunciation assessment pipeline.

Flow:
    1. Audio → phoneme model → frame-level log-probs + waveform
    1b. Audio → ASR model → English word transcript (what user actually said)
    2. Reference text → text_processor → phoneme sequence with stress
    2b. ASR transcript vs reference → word-level verification
    3. (phonemes, log-probs) → aligner → CTC forced alignment with posteriors
    4. Aligned segments → gop → calibrated pronunciation scores
    5. Aligned segments + stress + rate → duration → context-aware timing scores
    6. Audio + alignment → prosody → multi-feature stress/rhythm/intonation
    7. All scores + verification → scoring → uncertainty-aware fused final output

Two models:
- Phoneme model: frame-level IPA posteriors for alignment + GOP scoring
- ASR model: English word transcript for verifying what was actually said
"""

import hashlib

from .acoustic_model import AcousticModel, ASRModel, AcousticOutput
from .text_processor import ProcessedText, process_text, WordPhonemes
from .aligner import align_utterance, AlignmentResult
from .gop import compute_word_gop, WordGOP
from .duration import score_word_duration, WordDuration
from .prosody import analyze_prosody, ProsodyResult
from .scoring import (
    score_word, score_fluency, compute_final_score,
    WordScore, FluencyScore, FinalScore,
)
from .verification import verify_utterance, verify_word as verify_single_word, VerificationResult


# ── Singleton models ───────────────────────────────────────────────────

_acoustic_model = AcousticModel()
_asr_model = ASRModel()

# ── Acoustic output cache ──────────────────────────────────────────────

_acoustic_cache: dict[str, AcousticOutput] = {}


def _file_hash(path: str) -> str:
    """Compute SHA-256 hash of a file for cache keying."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _get_acoustic(wav_path: str) -> AcousticOutput:
    """Get acoustic output, using cache if the same file was already processed."""
    key = _file_hash(wav_path)
    if key in _acoustic_cache:
        return _acoustic_cache[key]
    result = _acoustic_model.process_audio(wav_path)
    _acoustic_cache.clear()
    _acoustic_cache[key] = result
    return result


def load_models():
    """Load all models. Call once at startup."""
    _acoustic_model.load()
    _asr_model.load()


# ── Speaking rate helper ─────────────────────────────────────────────────

def _compute_utterance_wps(alignment: AlignmentResult) -> float:
    """Compute utterance-level speaking rate (words/sec)."""
    timed = [w for w in alignment.words if w.time_start >= 0 and w.time_end > w.time_start]
    if len(timed) < 2:
        return 0.0
    total_time = timed[-1].time_end - timed[0].time_start
    return len(timed) / total_time if total_time > 0 else 0.0


# ── Core pipeline ────────────────────────────────────────────────────────

def assess_pronunciation(
    wav_path: str,
    reference_text: str,
) -> dict:
    """Run the full pronunciation assessment pipeline."""
    # [1] Phoneme model: audio → frame-level posteriors
    acoustic: AcousticOutput = _get_acoustic(wav_path)

    # [1b] ASR model: audio → English word transcript + per-word confidence
    asr_result = _asr_model.transcribe(acoustic.waveform, acoustic.sample_rate)
    asr_transcript = asr_result.text
    word_confidences = asr_result.word_confidences

    # [2] Text processing: reference → phoneme sequence with stress
    processed: ProcessedText = process_text(reference_text)

    if not processed.words:
        return {
            "reference": reference_text,
            "transcript": asr_transcript,
            "score": {"overall": 0, "pronunciation": 0, "fluency": 0,
                      "prosody": {"stress": 50, "intonation": 50, "rhythm": 50, "rate": 50, "overall": 50},
                      "completeness": 0, "word_details": []},
            "feedback": {"summary": "Could not process the reference text.", "tips": []},
        }

    # [2b] Verify: does ASR transcript match the reference? (word-level)
    # Pass word_confidences so that Whisper LM auto-corrections are detected
    ref_word_list = [wp.word for wp in processed.words]
    verification: VerificationResult = verify_utterance(
        asr_transcript, reference_text, ref_word_list, word_confidences,
    )

    # [3] CTC forced alignment: phonemes → audio frames (with posteriors)
    alignment: AlignmentResult = align_utterance(
        flat_phonemes=processed.flat_phonemes,
        word_boundaries=processed.word_boundaries,
        words=processed.words,
        log_probs=acoustic.log_probs,
        vocab=acoustic.vocab,
        blank_id=acoustic.pad_id,
        frame_duration=acoustic.frame_duration,
    )

    # [4] GOP: per-word pronunciation quality
    word_gops: list[WordGOP] = []
    for aw in alignment.words:
        wg = compute_word_gop(
            acoustic.log_probs, aw, acoustic.vocab, acoustic.id_to_token,
        )
        word_gops.append(wg)

    # [5] Duration: context-aware timing analysis
    utterance_wps = _compute_utterance_wps(alignment)
    word_durations: list[WordDuration] = []
    for i, aw in enumerate(alignment.words):
        wp = processed.words[i] if i < len(processed.words) else None
        wd = score_word_duration(aw, word_phonemes=wp, utterance_wps=utterance_wps)
        word_durations.append(wd)

    # [6] Prosody: stress, intonation, rhythm, rate
    prosody: ProsodyResult = analyze_prosody(
        acoustic.waveform, acoustic.sample_rate,
        alignment, processed.words,
    )

    # [7] Fusion: score combination WITH verification penalties
    word_scores: list[WordScore] = []
    for i, aw in enumerate(alignment.words):
        wp = prosody.word_prosody[i] if i < len(prosody.word_prosody) else None
        wv = verification.word_verifications[i] if i < len(verification.word_verifications) else None
        ws = score_word(aw, word_gops[i], word_durations[i], wp, wv)
        word_scores.append(ws)

    fluency: FluencyScore = score_fluency(alignment)

    final: FinalScore = compute_final_score(
        word_scores, fluency, prosody, processed,
    )

    # [8] Build response
    return _build_response(reference_text, final, verification, prosody)


def assess_word(wav_path: str, word: str) -> dict:
    """Run pronunciation assessment for a single word."""
    acoustic = _get_acoustic(wav_path)
    processed = process_text(word)

    if not processed.words:
        return {
            "word": word,
            "transcript": "",
            "status": "missed",
            "pronunciation_score": 0,
            "expected_phonemes": "",
            "recognized_phonemes": "",
            "heard_as": None,
        }

    # ASR: what did the user actually say?
    asr_result = _asr_model.transcribe(acoustic.waveform, acoustic.sample_rate)
    asr_transcript = asr_result.text
    wv = verify_single_word(asr_transcript, word)

    alignment = align_utterance(
        flat_phonemes=processed.flat_phonemes,
        word_boundaries=processed.word_boundaries,
        words=processed.words,
        log_probs=acoustic.log_probs,
        vocab=acoustic.vocab,
        blank_id=acoustic.pad_id,
        frame_duration=acoustic.frame_duration,
    )

    if not alignment.words:
        return {
            "word": word,
            "transcript": asr_transcript,
            "status": "missed",
            "pronunciation_score": 0,
            "expected_phonemes": " ".join(processed.flat_phonemes),
            "recognized_phonemes": "",
            "heard_as": asr_transcript if asr_transcript else None,
        }

    aw = alignment.words[0]
    wg = compute_word_gop(acoustic.log_probs, aw, acoustic.vocab, acoustic.id_to_token)
    wp = processed.words[0] if processed.words else None
    wd = score_word_duration(aw, word_phonemes=wp, utterance_wps=0.0)
    ws = score_word(aw, wg, wd, None, wv)

    expected_phones = " ".join(pd["phoneme"] for pd in ws.phoneme_details)
    recognized_phones = " ".join(
        pd.get("best_alternative") or pd["phoneme"]
        for pd in ws.phoneme_details
        if pd.get("score", 0) > 0
    )

    return {
        "word": word,
        "transcript": asr_transcript,
        "status": ws.status,
        "pronunciation_score": ws.pronunciation_score,
        "expected_phonemes": expected_phones,
        "recognized_phonemes": recognized_phones,
        "heard_as": wv.heard_as,
        "phoneme_alignment": ws.phoneme_details,
    }


# ── Response formatting ─────────────────────────────────────────────────

def _build_response(
    reference_text: str,
    final: FinalScore,
    verification: VerificationResult,
    prosody: ProsodyResult | None = None,
) -> dict:
    """Format the final score into the API response."""
    n_total = len(final.word_details)
    n_matched = sum(1 for ws in final.word_details if ws.status != "missed")

    # Transcript = what ASR actually heard (English words)
    transcript = verification.transcript

    word_details = []
    for i, ws in enumerate(final.word_details):
        expected_phones = " ".join(pd["phoneme"] for pd in ws.phoneme_details)
        recognized_phones = " ".join(
            pd.get("best_alternative") or pd["phoneme"]
            for pd in ws.phoneme_details
            if pd.get("score", 0) > 0
        )

        # heard_as from verification
        heard_as = None
        if i < len(verification.word_verifications):
            heard_as = verification.word_verifications[i].heard_as

        # Per-word prosody details
        word_prosody = None
        if prosody and i < len(prosody.word_prosody):
            wp = prosody.word_prosody[i]
            word_prosody = {
                "stress_score": wp.stress_score,
                "energy": round(wp.energy_rms, 3),
                "pitch": round(wp.f0_mean, 1),
                "pitch_range": round(wp.f0_range, 1),
                "vowel_duration": round(wp.vowel_duration_ratio, 3),
                "is_content_word": wp.is_content_word,
            }

        word_details.append({
            "word": ws.word,
            "status": ws.status,
            "heard_as": heard_as,
            "pronunciation_score": ws.pronunciation_score,
            "prosody_score": ws.prosody_score,
            "prosody_details": word_prosody,
            "expected_phonemes": expected_phones,
            "recognized_phonemes": recognized_phones,
            "confidence": round(ws.confidence * 100),
            "uncertainty": round(ws.uncertainty * 100),
            "phoneme_alignment": ws.phoneme_details,
            "word_start": ws.word_start,
            "word_end": ws.word_end,
        })

    return {
        "transcript": transcript,
        "reference": reference_text,
        "score": {
            "accuracy": final.completeness,
            "pronunciation": final.pronunciation,
            "fluency": final.fluency,
            "prosody": final.prosody,
            "overall": final.overall,
            "word_details": word_details,
            "matched": n_matched,
            "total": n_total,
            "uncertainty": round(final.uncertainty * 100),
        },
        "feedback": final.feedback,
    }
