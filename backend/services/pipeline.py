import asyncio
import json
import logging
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from services.transcription import transcribe_audio
from services.diarization import diarize_audio, merge_transcript_with_speakers
from services.summarization import summarize_meeting
from services.email_service import send_meeting_email
from database.models import update_meeting, get_meeting

logger = logging.getLogger(__name__)
executor = ThreadPoolExecutor(max_workers=2)

async def process_meeting(
    meeting_id: str,
    audio_path: str,
    title: str,
    speaker_names: dict | None = None
):
    """
    Full pipeline: audio → transcription → diarization → summary → save
    Runs in background after audio upload.
    """
    try:
        logger.info(f"[{meeting_id}] Starting pipeline...")
        await update_meeting(meeting_id, status="processing")

        # 1. Transcribe with Whisper
        logger.info(f"[{meeting_id}] Step 1/3: Transcribing...")
        transcript_segments = await transcribe_audio(audio_path)

        # 2. Diarize (identify speakers) — runs in thread (CPU-bound)
        logger.info(f"[{meeting_id}] Step 2/3: Identifying speakers...")
        loop = asyncio.get_event_loop()
        diarization_segments = await loop.run_in_executor(
            executor, diarize_audio, audio_path
        )

        # 3. Merge transcript + speakers
        merged = merge_transcript_with_speakers(
            transcript_segments,
            diarization_segments,
            speaker_names
        )

        # Extract unique participants
        participants = list(set(s["speaker"] for s in merged if s["speaker"] != "Unknown"))

        # Calculate duration
        duration = int(merged[-1]["end"]) if merged else 0

        # 4. Generate summary with GPT-4o mini
        logger.info(f"[{meeting_id}] Step 3/3: Generating summary...")
        summary_data = await summarize_meeting(merged, title)

        # 5. Save everything (summary field stores full JSON data)
        await update_meeting(
            meeting_id,
            status="done",
            transcript=json.dumps(merged, ensure_ascii=False),
            summary=json.dumps(summary_data, ensure_ascii=False),
            action_items=json.dumps(summary_data.get("action_items", []), ensure_ascii=False),
            participants=json.dumps(participants, ensure_ascii=False),
            duration_seconds=duration,
        )

        logger.info(f"[{meeting_id}] ✅ Pipeline complete!")

        # Send email notification
        try:
            updated_meeting = await get_meeting(meeting_id)
            await send_meeting_email(updated_meeting, summary_data)
        except Exception as email_err:
            logger.error(f"[{meeting_id}] Email notification failed: {email_err}")

    except Exception as e:
        logger.error(f"[{meeting_id}] ❌ Pipeline failed: {e}", exc_info=True)
        await update_meeting(meeting_id, status="error")
