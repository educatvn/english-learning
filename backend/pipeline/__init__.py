"""
Production-grade English pronunciation assessment pipeline v2.

Architecture:
    Text → [text_processor] → phoneme sequence with stress markers
    Audio → [acoustic_model] → frame-level phoneme posteriors (wav2vec2-CTC)
    (text phonemes, audio posteriors) → [aligner] → CTC forced alignment
    Aligned segments → [gop] → calibrated GOP scores
    Aligned segments → [duration] → duration ratio scores
    Audio + alignment → [prosody] → stress, rhythm, intonation scores
    All scores → [scoring] → fused final scores with uncertainty

No Whisper. No seq2seq. No cascade errors.
"""
