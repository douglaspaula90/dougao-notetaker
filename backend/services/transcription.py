import openai
import os
from pathlib import Path
import subprocess
import logging

logger = logging.getLogger(__name__)
_client = None

def _get_client():
    global _client
    if _client is None:
        _client = openai.AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client

async def convert_to_mp3(input_path: str) -> str:
    """Convert any audio format to mp3 using ffmpeg."""
    output_path = input_path.rsplit(".", 1)[0] + ".mp3"
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-vn", "-ar", "16000", "-ac", "1", "-b:a", "64k", output_path],
        capture_output=True, text=True
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg error: {proc.stderr}")
    return output_path


def get_audio_duration_seconds(path: str) -> float:
    """
    Ground-truth audio length via ffprobe. Independent of Whisper, which
    hallucinates text (and bogus timestamps) when fed silence/empty audio.
    Returns 0.0 if it can't be determined.
    """
    try:
        proc = subprocess.run(
            ["ffprobe", "-v", "error",
             "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True
        )
        out = (proc.stdout or "").strip()
        return float(out) if out else 0.0
    except Exception as e:
        logger.warning(f"ffprobe duration failed for {path}: {e}")
        return 0.0

async def transcribe_audio(audio_path: str) -> list[dict]:
    """
    Transcribe audio using Whisper API.
    Returns list of segments: [{start, end, text}]
    Cost: ~$0.006/min
    """
    path = Path(audio_path)

    # Convert to mp3 if needed
    if path.suffix.lower() not in (".mp3", ".wav", ".m4a", ".ogg"):
        logger.info(f"Converting {path.suffix} to mp3...")
        audio_path = await convert_to_mp3(audio_path)

    logger.info(f"Sending to Whisper API: {audio_path}")

    with open(audio_path, "rb") as f:
        response = await _get_client().audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
            language="pt"  # Brazilian Portuguese — change if needed
        )

    segments = []
    for seg in response.segments:
        segments.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": seg.text.strip()
        })

    logger.info(f"Transcription done: {len(segments)} segments")
    return segments
