"""
Acoustic Modeling Layer
=======================
Two models:
1. Phoneme model (wav2vec2-lv-60-espeak-cv-ft): frame-level IPA posteriors
   for forced alignment, GOP computation, and pronunciation scoring.
2. ASR model (Whisper): English word transcription for verifying what the
   user actually said. Whisper has a built-in language model so it produces
   real English words (not character-level gibberish like wav2vec2-base-960h).

Why two models:
- The phoneme model outputs IPA — you can't reliably convert IPA back to
  English words for transcript verification.
- The ASR model outputs English words — tells us WHAT was said.

CRITICAL: The ASR model must NEVER receive the reference text as a prompt
or conditioning signal. Doing so causes Whisper to hallucinate the reference
regardless of what was actually spoken. The ASR must be completely blind to
the expected text.
"""

import os
import re
import zlib
from dataclasses import dataclass

import torch
import torchaudio
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor, WhisperProcessor, WhisperForConditionalGeneration


@dataclass
class AcousticOutput:
    """Frame-level acoustic model output."""
    log_probs: torch.Tensor         # (T, C) log-softmax over phoneme vocab
    frame_duration: float            # seconds per CTC frame
    audio_duration: float            # total audio length in seconds
    vocab: dict[str, int]            # token → id mapping
    id_to_token: dict[int, str]      # id → token mapping
    pad_id: int                      # padding/blank token id
    waveform: torch.Tensor           # (1, N) mono 16kHz waveform
    sample_rate: int                 # always 16000


class AcousticModel:
    """Wav2vec2-CTC acoustic model for phoneme posterior estimation."""

    def __init__(self):
        self.model: Wav2Vec2ForCTC | None = None
        self.processor: Wav2Vec2Processor | None = None
        self._vocab: dict[str, int] = {}
        self._id_to_token: dict[int, str] = {}
        self._pad_id: int = 0

    def load(self):
        """Load the wav2vec2 model. Call once at startup."""
        model_name = os.getenv(
            "PHONEME_MODEL", "facebook/wav2vec2-lv-60-espeak-cv-ft"
        )
        print(f"[AcousticModel] Loading '{model_name}'...")
        self.processor = Wav2Vec2Processor.from_pretrained(model_name)
        self.model = Wav2Vec2ForCTC.from_pretrained(model_name)
        self.model.eval()

        self._vocab = self.processor.tokenizer.get_vocab()
        self._id_to_token = {v: k for k, v in self._vocab.items()}
        self._pad_id = self.processor.tokenizer.pad_token_id
        print(f"[AcousticModel] Loaded. Vocab size: {len(self._vocab)}")

    @property
    def vocab(self) -> dict[str, int]:
        return self._vocab

    @property
    def id_to_token(self) -> dict[int, str]:
        return self._id_to_token

    @property
    def pad_id(self) -> int:
        return self._pad_id

    def process_audio(self, wav_path: str) -> AcousticOutput:
        """Run acoustic model on audio file.

        Handles:
        - Any sample rate (resamples to 16kHz)
        - Stereo→mono conversion
        - Returns log-probabilities (not raw logits or softmax)

        The log_probs tensor is (T, C) where T is the number of CTC frames
        and C is the vocabulary size. Each frame has a proper log-probability
        distribution over all phoneme tokens.
        """
        waveform, sr = torchaudio.load(wav_path)

        # Mono conversion
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)

        # Resample to 16kHz
        if sr != 16000:
            waveform = torchaudio.functional.resample(waveform, sr, 16000)
            sr = 16000

        audio_duration = waveform.shape[1] / sr

        # Run model
        inputs = self.processor(
            waveform.squeeze().numpy(),
            sampling_rate=16000,
            return_tensors="pt",
            padding=True,
        )

        with torch.no_grad():
            logits = self.model(**inputs).logits  # (1, T, C)

        # Log-softmax for proper log-probabilities
        log_probs = torch.log_softmax(logits, dim=-1).squeeze(0)  # (T, C)

        num_frames = log_probs.shape[0]
        frame_duration = audio_duration / num_frames

        return AcousticOutput(
            log_probs=log_probs,
            frame_duration=frame_duration,
            audio_duration=audio_duration,
            vocab=self._vocab,
            id_to_token=self._id_to_token,
            pad_id=self._pad_id,
            waveform=waveform,
            sample_rate=sr,
        )

    @staticmethod
    def greedy_decode(log_probs: torch.Tensor, id_to_token: dict[int, str], pad_id: int) -> list[str]:
        """CTC greedy decode: log_probs → actual phoneme sequence.

        Takes argmax per frame, collapses repeats, removes blanks.
        Returns the phoneme sequence the model *actually heard*,
        independent of any reference text.
        """
        ids = log_probs.argmax(dim=-1).tolist()  # (T,)

        # CTC collapse: merge consecutive duplicates, remove blanks
        decoded: list[str] = []
        prev_id = -1
        for frame_id in ids:
            if frame_id == prev_id:
                continue
            prev_id = frame_id
            if frame_id == pad_id:
                continue
            token = id_to_token.get(frame_id, "")
            if token and token not in ("<pad>", "<s>", "</s>", "<unk>"):
                decoded.append(token)

        return decoded


@dataclass
class TranscriptResult:
    """Whisper transcript with per-word confidence scores."""
    text: str                       # Full transcript (lowercase)
    word_confidences: list[float]   # Per-word avg log-prob (aligned with words in text)


class ASRModel:
    """Word-level ASR model for transcript verification using Whisper.

    Whisper has a built-in language model, producing real English words
    instead of character-level noise. This makes verification reliable.

    IMPORTANT: Whisper's LM auto-corrects mispronunciations — it may
    output "much" even when the user clearly mispronounced it. To catch
    this, we extract per-word confidence (token log-probs). Words that
    Whisper "corrected" will have LOW confidence despite matching the
    reference text. The verification layer uses this to penalize them.

    CRITICAL ANTI-HALLUCINATION MEASURES:
    - NEVER pass reference text as initial_prompt or decoder conditioning.
    - Detect and flag hallucinated outputs via compression ratio and
      avg log-probability thresholds.
    - If audio is too short or silent, return empty string.
    """

    # Hallucination detection thresholds
    COMPRESSION_RATIO_THRESHOLD = 2.4   # Whisper default; repetitive = hallucinated
    AVG_LOGPROB_THRESHOLD = -1.5        # Below this = very unreliable
    MIN_AUDIO_SECONDS = 0.3             # Reject audio shorter than 300ms

    # Per-word confidence: below this log-prob, word is likely mispronounced
    # even if Whisper's LM auto-corrected the text output
    WORD_LOW_CONFIDENCE = -0.5

    def __init__(self):
        self.model: WhisperForConditionalGeneration | None = None
        self.processor: WhisperProcessor | None = None

    def load(self):
        """Load the Whisper model. Call once at startup."""
        model_name = os.getenv(
            "ASR_MODEL", "openai/whisper-base"
        )
        print(f"[ASRModel] Loading Whisper '{model_name}'...")
        self.processor = WhisperProcessor.from_pretrained(model_name)
        self.model = WhisperForConditionalGeneration.from_pretrained(model_name)
        self.model.eval()
        print(f"[ASRModel] Whisper loaded.")

    def transcribe(self, waveform: torch.Tensor, sample_rate: int) -> TranscriptResult:
        """Transcribe audio to English text using Whisper.

        Returns TranscriptResult with:
        - text: the transcript string
        - word_confidences: per-word average token log-probability.
          High (close to 0) = confident. Low (< -0.5) = uncertain/mispronounced.

        Whisper's LM will auto-correct mispronunciations in the TEXT,
        but the log-probs reveal the acoustic uncertainty. A word like
        "much" that was mispronounced will have a low log-prob even
        though Whisper outputs the correct spelling.
        """
        empty = TranscriptResult(text="", word_confidences=[])

        if self.model is None or self.processor is None:
            return empty

        # Resample to 16kHz if needed
        if sample_rate != 16000:
            waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)
            sample_rate = 16000

        # Reject too-short audio
        duration = waveform.shape[-1] / sample_rate
        if duration < self.MIN_AUDIO_SECONDS:
            return empty

        # Prepare input features (mel spectrogram)
        input_features = self.processor(
            waveform.squeeze().numpy(),
            sampling_rate=16000,
            return_tensors="pt",
        ).input_features

        # Generate with scores for confidence extraction
        # NO initial_prompt, NO decoder_input_ids conditioning
        # condition_on_prev_tokens=False: reduce LM auto-correction so
        # mispronunciations are less likely to be "fixed" by the LM
        with torch.no_grad():
            output = self.model.generate(
                input_features,
                language="en",
                task="transcribe",
                condition_on_prev_tokens=False,
                return_dict_in_generate=True,
                output_scores=True,
            )

        token_ids = output.sequences[0]
        transcript = self.processor.decode(token_ids, skip_special_tokens=True)

        # Anti-hallucination check 1: compression ratio
        if transcript.strip():
            text_bytes = transcript.encode("utf-8")
            compressed = zlib.compress(text_bytes)
            compression_ratio = len(text_bytes) / max(len(compressed), 1)
            if compression_ratio > self.COMPRESSION_RATIO_THRESHOLD:
                print(f"[ASRModel] Hallucination: compression_ratio={compression_ratio:.2f}, rejecting")
                return empty

        if not output.scores:
            transcript = transcript.lower().strip()
            transcript = re.sub(r'\s+', ' ', transcript)
            return TranscriptResult(text=transcript, word_confidences=[])

        # Extract per-token log-probabilities
        prompt_len = len(token_ids) - len(output.scores)
        generated_ids = token_ids[prompt_len:]
        token_logprobs: list[float] = []
        for i, score in enumerate(output.scores):
            lp = torch.log_softmax(score, dim=-1)
            token_id = generated_ids[i].item()
            token_logprobs.append(lp[0, token_id].item())

        # Anti-hallucination check 2: average log-probability
        if token_logprobs:
            avg_logprob = sum(token_logprobs) / len(token_logprobs)
            print(f"[ASRModel] transcript='{transcript.strip()[:80]}' avg_logprob={avg_logprob:.2f}")
            if avg_logprob < self.AVG_LOGPROB_THRESHOLD:
                print(f"[ASRModel] Low confidence, rejecting")
                return empty

        # Map tokens → words with per-word confidence
        # Whisper tokens: space-prefixed tokens start a new word (e.g. " much")
        tokenizer = self.processor.tokenizer
        eos_id = tokenizer.eos_token_id
        words: list[str] = []
        word_logprobs: list[list[float]] = []
        current_text = ""
        current_probs: list[float] = []

        for i, tid in enumerate(generated_ids.tolist()):
            if tid == eos_id:
                break
            token_text = tokenizer.decode([tid])
            if token_text.startswith(" ") and current_text.strip():
                # Previous word complete
                words.append(current_text.strip().lower())
                word_logprobs.append(current_probs)
                current_text = token_text
                current_probs = [token_logprobs[i]]
            else:
                current_text += token_text
                current_probs.append(token_logprobs[i])

        if current_text.strip():
            words.append(current_text.strip().lower())
            word_logprobs.append(current_probs)

        # Compute per-word average log-prob
        word_confidences = [
            sum(probs) / len(probs) if probs else -float('inf')
            for probs in word_logprobs
        ]

        # Build transcript: annotate low-confidence words with [?]
        # so users can see which words Whisper was uncertain about
        display_words: list[str] = []
        for w, c in zip(words, word_confidences):
            flag = " ← LOW" if c < self.WORD_LOW_CONFIDENCE else ""
            print(f"  [{w}] conf={c:.2f}{flag}")
            if c < self.WORD_LOW_CONFIDENCE:
                display_words.append(f"{w}(?)")
            else:
                display_words.append(w)

        transcript_text = " ".join(display_words)
        transcript_text = re.sub(r'\s+', ' ', transcript_text).strip()

        return TranscriptResult(text=transcript_text, word_confidences=word_confidences)
