from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pipeline.main import load_models, assess_pronunciation, assess_word
import subprocess
import tempfile
import os


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_models()
    yield


app = FastAPI(title="Speaking Practice API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _to_wav(input_path: str) -> str:
    """Convert uploaded audio to 16kHz mono WAV. Returns path to wav file."""
    # Always write to a new temp wav file to avoid path conflicts
    wav_fd, wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(wav_fd)

    result = subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-ar", "16000", "-ac", "1", "-f", "wav", wav_path],
        capture_output=True,
    )
    if result.returncode != 0:
        # Clean up the empty wav file
        try:
            os.unlink(wav_path)
        except OSError:
            pass
        raise RuntimeError(
            f"ffmpeg conversion failed (rc={result.returncode}): "
            f"{result.stderr.decode(errors='replace')[:300]}"
        )
    return wav_path


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    reference_text: str = Form(...),
):
    suffix = os.path.splitext(audio.filename or "audio.webm")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await audio.read()
        tmp.write(content)
        tmp_path = tmp.name

    wav_path = None
    try:
        wav_path = _to_wav(tmp_path)
        return assess_pronunciation(wav_path, reference_text)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        if wav_path:
            try:
                os.unlink(wav_path)
            except OSError:
                pass


@app.post("/transcribe-word")
async def transcribe_word_endpoint(
    audio: UploadFile = File(...),
    word: str = Form(...),
):
    suffix = os.path.splitext(audio.filename or "audio.webm")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await audio.read()
        tmp.write(content)
        tmp_path = tmp.name

    wav_path = None
    try:
        wav_path = _to_wav(tmp_path)
        return assess_word(wav_path, word)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        if wav_path:
            try:
                os.unlink(wav_path)
            except OSError:
                pass
