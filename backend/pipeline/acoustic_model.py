"""
Acoustic Modeling Layer
=======================
Two models:
1. Phoneme model (wav2vec2-lv-60-espeak-cv-ft): frame-level IPA posteriors
   for forced alignment, GOP computation, and pronunciation scoring.
2. ASR model (wav2vec2-base-960h): English word transcription for verifying
   what the user actually said. Without this, forced alignment always
   "succeeds" regardless of input.

Why two models:
- The phoneme model outputs IPA — you can't reliably convert IPA back to
  English words for transcript verification.
- The ASR model outputs English letters/words — tells us WHAT was said.
- Both are wav2vec2 CTC, same architecture, shared loading code.
"""

import os
import re
from dataclasses import dataclass

import torch
import torchaudio
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor


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


class ASRModel:
    """Word-level ASR model for transcript verification.

    Uses wav2vec2-base-960h which outputs English letters, giving us
    actual English words to compare against the reference text.
    This is the ONLY reliable way to know what the user said.
    """

    def __init__(self):
        self.model: Wav2Vec2ForCTC | None = None
        self.processor: Wav2Vec2Processor | None = None

    def load(self):
        """Load the ASR model. Call once at startup."""
        model_name = os.getenv(
            "ASR_MODEL", "facebook/wav2vec2-base-960h"
        )
        print(f"[ASRModel] Loading '{model_name}'...")
        self.processor = Wav2Vec2Processor.from_pretrained(model_name)
        self.model = Wav2Vec2ForCTC.from_pretrained(model_name)
        self.model.eval()
        print(f"[ASRModel] Loaded.")

    def transcribe(self, waveform: torch.Tensor, sample_rate: int) -> str:
        """Transcribe audio to English text.

        Args:
            waveform: (1, N) mono waveform (any sample rate, will resample)
            sample_rate: sample rate of waveform

        Returns:
            Lowercase English transcript, e.g. "hello what's your name"
        """
        if self.model is None or self.processor is None:
            return ""

        # Resample to 16kHz if needed
        if sample_rate != 16000:
            waveform = torchaudio.functional.resample(waveform, sample_rate, 16000)

        inputs = self.processor(
            waveform.squeeze().numpy(),
            sampling_rate=16000,
            return_tensors="pt",
            padding=True,
        )

        with torch.no_grad():
            logits = self.model(**inputs).logits

        predicted_ids = torch.argmax(logits, dim=-1)
        transcript = self.processor.batch_decode(predicted_ids)[0]

        # Clean up: lowercase, collapse whitespace, strip
        transcript = transcript.lower().strip()
        transcript = re.sub(r'\s+', ' ', transcript)
        return transcript
