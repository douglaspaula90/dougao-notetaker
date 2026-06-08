import asyncio
import json
import logging
import os
import traceback
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from services.transcription import transcribe_audio, get_audio_duration_seconds
from services.diarization import diarize_audio, merge_transcript_with_speakers
from services.summarization import summarize_meeting
from services.email_service import send_meeting_email
from database.models import update_meeting, get_meeting

logger = logging.getLogger(__name__)
executor = ThreadPoolExecutor(max_workers=2)

# Anti-hallucination guard. Whisper invents text when given silence/empty
# audio (the headless-bot recordings were silent → fake "summaries" + 0 min).
# A real meeting has both meaningful length AND meaningful speech.
MIN_MEETING_SECONDS = int(os.getenv("MIN_MEETING_SECONDS", "20"))
MIN_TRANSCRIPT_WORDS = int(os.getenv("MIN_TRANSCRIPT_WORDS", "15"))


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

    # ── 1.5 Anti-hallucination guard ───────────────────────────────────────
    # Whisper fabricates plausible text from silence. Before we let GPT build
    # a summary (and email it!), require BOTH a real audio length and real
    # speech content. ffprobe gives ground-truth duration, immune to the
    # bogus timestamps Whisper emits on silent input.
    real_duration = get_audio_duration_seconds(audio_path)
    total_text = " ".join(s.get("text", "") for s in transcript_segments).strip()
    word_count = len(total_text.split())

    if real_duration < MIN_MEETING_SECONDS or word_count < MIN_TRANSCRIPT_WORDS:
        msg = (
            f"Áudio sem conteúdo real (duração {real_duration:.0f}s, "
            f"{word_count} palavras transcritas). Provável silêncio ou captura "
            f"vazia — resumo e e-mail NÃO foram gerados para evitar alucinação. "
            f"Grave novamente com áudio audível (mínimo {MIN_MEETING_SECONDS}s "
            f"e {MIN_TRANSCRIPT_WORDS} palavras)."
        )
        logger.warning(f"[{meeting_id}] ⏭ Conteúdo insuficiente — pulando resumo/email: {msg}")
        await update_meeting(
            meeting_id,
            status="error",
            error_stage="no_content",
            error_message=msg,
            duration_seconds=int(real_duration),
            transcript=json.dumps(transcript_segments, ensure_ascii=False),
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
