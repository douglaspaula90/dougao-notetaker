from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx
import os
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

BOT_API = os.environ.get("BOT_API", "http://bot:8080")
APP_API_KEY = os.environ.get("APP_API_KEY", "")


class JoinRequest(BaseModel):
    meet_url: str
    title: str = "Reuniao"


@router.post("/join")
async def join_meeting(body: JoinRequest):
    """Send bot to join a Google Meet meeting."""
    if "meet.google.com" not in body.meet_url:
        raise HTTPException(400, "URL must be a Google Meet link")

    try:
        headers = {}
        if APP_API_KEY:
            headers["Authorization"] = f"Bearer {APP_API_KEY}"

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{BOT_API}/join",
                json={"meet_url": body.meet_url, "title": body.title},
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Bot service unavailable")
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, e.response.text)
