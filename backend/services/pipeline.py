import asyncio
import json
import logging
import traceback
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from services.transcription import transcribe_audio
from services.diarization import diarize_audio, merge_transcript_with_speakers
from services.summarization import summarize_meeting
from services.email_service import send_meeting_email
from database.models import update_meeting, get_meeting

logger = logging.getLogger(__name__)
executor = ThreadPoolExecutor(max_workers=2)


def _format_err(stage: str, exc: Exception) -> str:
    """Human-friendly one-liner used for the UI + saved in DB."""
    return f"{stage} falhou: {type(exc).__name__}: {exc}"


async def process_meeting(
    meeting_id: str,
    audio_path: str,
    title: str,
    speaker_names: dict | None = None
):
    """
    Full pipeline: audio → transcription → (diarization?) → summary → email.

    Hard failures (Whisper, summary) abort and mark status=error with details.
    Soft failures (diarization, email) are logged and skipped so the user
    still gets a transcript + summary.
    """
    logger.info(f"[{meeting_id}] Starting pipeline...")
    await update_meeting(meeting_id, status="processing")

    # ── 1. Transcribe with Whisper (hard requirement) ──────────────────────
    try:
        logger.info(f"[{meeting_id}] Step 1/3: Transcribing...")
        transcript_segments = await transcribe_audio(audio_path)
    except Exception as exc:
        msg = _format_err("Transcrição (Whisper)", exc)
        logger.error(f"[{meeting_id}] ❌ {msg}", exc_info=True)
        await update_meeting(
            meeting_id,
            status="error",
            error_stage="transcription",
            error_message=msg,
        )
        return

    if not transcript_segments:
        msg = "Transcrição retornou vazia — áudio sem voz audível ou silêncio total."
        logger.error(f"[{meeting_id}] ❌ {msg}")
        await update_meeting(
            meeting_id,
            status="error",
            error_stage="transcription",
            error_message=msg,
        )
        return

    # ── 2. Diarize (soft — if it fails, mark everyone Unknown) ─────────────
    diarization_segments: list[dict] = []
    diarization_warning: str | None = None
    try:
        logger.info(f"[{meeting_id}] Step 2/3: Identifying speakers...")
        loop = asyncio.get_event_loop()
        diarization_segments = await loop.run_in_executor(
            executor, diarize_audio, audio_path
        )
    except Exception as exc:
        diarization_warning = _format_err("Diarização (pyannote)", exc)
        logger.warning(
            f"[{meeting_id}] ⚠ {diarization_warning} — continuando sem identificação de speakers",
            exc_info=True,
        )

    # ── 3. Merge transcript + (maybe empty) speaker labels ─────────────────
    merged = merge_transcript_with_speakers(
        transcript_segments,
        diarization_segments,
        speaker_names,
    )
    participants = list(
        set(s["speaker"] for s in merged if s["speaker"] not in ("Unknown", None))
    )
    duration = int(merged[-1]["end"]) if merged else 0

    # ── 4. Generate summary with GPT (hard requirement) ────────────────────
    try:
        logger.info(f"[{meeting_id}] Step 3/3: Generating summary...")
        summary_data = await summarize_meeting(merged, title)
    except Exception as exc:
        msg = _format_err("Resumo (GPT)", exc)
        logger.error(f"[{meeting_id}] ❌ {msg}", exc_info=True)
        # Even if summary fails, persist the transcript so the user can read it.
        await update_meeting(
            meeting_id,
            status="error",
            error_stage="summary",
            error_message=msg,
            transcript=json.dumps(merged, ensure_ascii=False),
            participants=json.dumps(participants, ensure_ascii=False),
            duration_seconds=duration,
        )
        return

    # ── 5. Persist everything as 'done' ────────────────────────────────────
    await update_meeting(
        meeting_id,
        status="done",
        transcript=json.dumps(merged, ensure_ascii=False),
        summary=json.dumps(summary_data, ensure_ascii=False),
        action_items=json.dumps(summary_data.get("action_items", []), ensure_ascii=False),
        participants=json.dumps(participants, ensure_ascii=False),
        duration_seconds=duration,
        # Diarization warning, if any, is surfaced but doesn't change status.
        error_message=diarization_warning,
        error_stage="diarization" if diarization_warning else None,
    )
    logger.info(f"[{meeting_id}] ✅ Pipeline complete!")

    # ── 6. Email notification (soft — failure doesn't change status) ───────
    try:
        updated_meeting = await get_meeting(meeting_id)
        await send_meeting_email(updated_meeting, summary_data)
    except Exception as exc:
        logger.error(
            f"[{meeting_id}] ⚠ Email notification failed: {exc}", exc_info=True
        )
