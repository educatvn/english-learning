# Speaking Practice Backend

Local pronunciation scoring server. Zero cost — all models run on your machine.

## Architecture

```
Audio (user speaks)
   ↓
[1] ASR (Whisper)          → transcript + word timestamps
   ↓
[2] Phoneme Recognition    → what phonemes were actually spoken
   (wav2vec2-espeak)         with timing + confidence
   ↓
[3] G2P (espeak-ng)        → what phonemes were expected
   ↓
[4] Scoring Engine         → accuracy + pronunciation + fluency
```

## Prerequisites

**macOS:**

```bash
brew install espeak-ng ffmpeg
```

**Ubuntu/Debian:**

```bash
sudo apt install espeak-ng ffmpeg
```

## Setup (one-time)

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install PyTorch (CPU-only, smaller download)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install other dependencies
pip install -r requirements.txt

# Copy config (optional — defaults work fine)
cp .env.example .env
```

First startup downloads models (~1.5GB total, cached for future runs):
- Whisper `base` (~150MB)
- wav2vec2-lv-60-espeak-cv-ft (~1.2GB)

## Run

```bash
cd backend
source venv/bin/activate
KMP_DUPLICATE_LIB_OK=TRUE uvicorn main:app --reload --port 8000
```

Server starts at `http://localhost:8000`.

> **Note:** `KMP_DUPLICATE_LIB_OK=TRUE` is needed on macOS to avoid OpenMP conflicts between PyTorch and faster-whisper.

## API

### `GET /health`

```json
{"status": "ok"}
```

### `POST /transcribe`

**Form data:**
- `audio` — audio file (webm, wav, mp3, etc.)
- `reference_text` — the sentence the user was supposed to read

**Response:**

```json
{
  "transcript": "what whisper heard",
  "reference": "original sentence",
  "score": {
    "accuracy": 85,
    "pronunciation": 72,
    "fluency": 90,
    "overall": 80,
    "word_details": [
      {
        "word": "hello",
        "status": "correct",
        "heard_as": null,
        "pronunciation_score": 95,
        "expected_phonemes": "h ə l oʊ",
        "recognized_phonemes": "h ɛ l oʊ",
        "confidence": 88
      }
    ],
    "matched": 4,
    "total": 5
  },
  "feedback": {
    "summary": "Good attempt! A few words need work.",
    "tips": [
      "'beautiful': expected /b j uː t ɪ f əl/, heard /b uː t ɪ f oʊ/"
    ]
  }
}
```

### Score breakdown

| Score           | What it measures                                          |
|-----------------|-----------------------------------------------------------|
| `accuracy`      | % of words detected by Whisper (did they say the right words?) |
| `pronunciation` | Phoneme-level match (did they pronounce each word correctly?) |
| `fluency`       | Speech rate + pauses (did they speak naturally?)           |
| `overall`       | Weighted: 30% accuracy + 50% pronunciation + 20% fluency  |

## Test

```bash
curl -X POST http://localhost:8000/transcribe \
  -F "audio=@test.wav" \
  -F "reference_text=The weather is beautiful today"
```

## Config (.env)

| Variable        | Default                                    | Description            |
|-----------------|--------------------------------------------|------------------------|
| `WHISPER_MODEL` | `base`                                     | tiny/base/small/medium |
| `WHISPER_DEVICE`| `cpu`                                      | cpu or cuda            |
| `PHONEME_MODEL` | `facebook/wav2vec2-lv-60-espeak-cv-ft`     | HuggingFace model ID   |
