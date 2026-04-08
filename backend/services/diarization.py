import os
import logging
from pathlib import Path
from pyannote.audio import Pipeline
import torch

logger = logging.getLogger(__name__)

_pipeline = None

def get_pipeline() -> Pipeline:
    global _pipeline
    if _pipeline is None:
        hf_token = os.environ.get("HUGGINGFACE_TOKEN")
        if not hf_token:
            raise RuntimeError("HUGGINGFACE_TOKEN not set. Get a free token at huggingface.co")
        logger.info("Loading pyannote diarization model (first run may take a while)...")
        _pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=hf_token
        )
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _pipeline = _pipeline.to(torch.device(device))
        logger.info(f"Diarization model loaded on {device}")
    return _pipeline

def diarize_audio(audio_path: str) -> list[dict]:
    """
    Identify who spoke when.
    Returns list of: [{speaker, start, end}]
    """
    pipeline = get_pipeline()
    logger.info(f"Running diarization on {audio_path}...")

    diarization = pipeline(audio_path)

    segments = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segments.append({
            "speaker": speaker,   # e.g. "SPEAKER_00", "SPEAKER_01"
            "start": round(turn.start, 2),
            "end": round(turn.end, 2)
        })

    logger.info(f"Diarization done: found {len(set(s['speaker'] for s in segments))} speakers")
    return segments

def merge_transcript_with_speakers(
    transcript_segments: list[dict],
    diarization_segments: list[dict],
    speaker_names: dict | None = None
) -> list[dict]:
    """
    Combine Whisper segments with pyannote speaker labels.
    speaker_names: optional mapping like {"SPEAKER_00": "João", "SPEAKER_01": "Maria"}
    """
    merged = []

    for t_seg in transcript_segments:
        t_mid = (t_seg["start"] + t_seg["end"]) / 2

        # Find the diarization segment that overlaps most with this transcript segment
        best_speaker = "Unknown"
        best_overlap = 0.0

        for d_seg in diarization_segments:
            overlap_start = max(t_seg["start"], d_seg["start"])
            overlap_end = min(t_seg["end"], d_seg["end"])
            overlap = max(0.0, overlap_end - overlap_start)

            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = d_seg["speaker"]

        # Map to friendly name if provided
        display_name = best_speaker
        if speaker_names and best_speaker in speaker_names:
            display_name = speaker_names[best_speaker]

        merged.append({
            "start": t_seg["start"],
            "end": t_seg["end"],
            "speaker": display_name,
            "speaker_id": best_speaker,
            "text": t_seg["text"]
        })

    # Merge consecutive segments from the same speaker
    if not merged:
        return merged

    collapsed = [merged[0].copy()]
    for seg in merged[1:]:
        prev = collapsed[-1]
        if seg["speaker_id"] == prev["speaker_id"] and (seg["start"] - prev["end"]) < 1.5:
            prev["text"] += " " + seg["text"]
            prev["end"] = seg["end"]
        else:
            collapsed.append(seg.copy())

    return collapsed
