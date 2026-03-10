from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks, HTTPException
from pathlib import Path
import uuid
import shutil
import json
import logging

from database.models import create_meeting
from services.pipeline import process_meeting

router = APIRouter()
logger = logging.getLogger(__name__)

UPLOAD_DIR = Path("/data/audio")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

@router.post("/upload")
async def upload_audio(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(default="Reunião sem título"),
    speaker_names: str = Form(default="{}")  # JSON: {"SPEAKER_00": "João", ...}
):
    """
    Receives an audio file from the Chrome extension.
    Saves it and kicks off the processing pipeline in background.
    """
    meeting_id = str(uuid.uuid4())
    
    # Validate file type
    allowed = {".webm", ".mp3", ".wav", ".m4a", ".ogg", ".mp4"}
    suffix = Path(file.filename).suffix.lower() if file.filename else ".webm"
    if suffix not in allowed:
        raise HTTPException(400, f"Unsupported format: {suffix}")

    audio_path = UPLOAD_DIR / f"{meeting_id}{suffix}"

    # Save uploaded file
    with open(audio_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    file_size_mb = audio_path.stat().st_size / 1024 / 1024
    logger.info(f"Received audio: {file.filename} ({file_size_mb:.1f} MB) → {audio_path}")

    # Parse speaker names mapping
    try:
        names = json.loads(speaker_names) if speaker_names else {}
    except Exception:
        names = {}

    # Create meeting record
    meeting = await create_meeting(meeting_id, title, str(audio_path))

    # Kick off background processing
    background_tasks.add_task(process_meeting, meeting_id, str(audio_path), title, names)

    return {
        "meeting_id": meeting_id,
        "title": title,
        "status": "processing",
        "message": "Upload recebido! Processando em background..."
    }

@router.get("/status/{meeting_id}")
async def get_status(meeting_id: str):
    from database.models import get_meeting
    meeting = await get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(404, "Meeting not found")
    return {"meeting_id": meeting_id, "status": meeting["status"]}
