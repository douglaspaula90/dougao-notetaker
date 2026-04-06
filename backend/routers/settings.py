import json
import logging
from pathlib import Path
from fastapi import APIRouter

router = APIRouter()
logger = logging.getLogger(__name__)

SETTINGS_PATH = Path("/data/settings.json")

DEFAULT_SETTINGS = {
    "notification_email": "",
    "send_to_all_participants": False,
    "auto_record": True,
    "language": "pt",
}


def _load() -> dict:
    if SETTINGS_PATH.exists():
        try:
            return json.loads(SETTINGS_PATH.read_text())
        except Exception:
            pass
    return DEFAULT_SETTINGS.copy()


def _save(settings: dict):
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(settings, indent=2, ensure_ascii=False))


@router.get("/")
async def get_settings():
    return _load()


@router.put("/")
async def update_settings(body: dict):
    current = _load()
    current.update(body)
    _save(current)
    logger.info(f"Settings updated: {current}")
    return current
