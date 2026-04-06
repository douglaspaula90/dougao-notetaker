"""
calendar_watcher.py — Monitors douglas.paula@medway.com.br calendar
and triggers the Meet bot for upcoming meetings.
"""

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from googleapiclient.discovery import build
from google_auth import get_calendar_credentials

logger = logging.getLogger(__name__)

TIMEZONE = ZoneInfo("America/Sao_Paulo")
# How many minutes before a meeting to join
JOIN_BEFORE_MINUTES = int(os.getenv("JOIN_BEFORE_MINUTES", "2"))
# Minimum meeting duration to record (avoid 1:1 quick calls if desired)
MIN_DURATION_MINUTES = int(os.getenv("MIN_DURATION_MINUTES", "0"))

def get_upcoming_meetings(minutes_ahead: int = 60) -> list[dict]:
    """
    Returns Google Meet meetings starting in the next `minutes_ahead` minutes.
    """
    creds = get_calendar_credentials()
    service = build("calendar", "v3", credentials=creds)

    now = datetime.now(tz=timezone.utc)
    time_max = now + timedelta(minutes=minutes_ahead)

    result = service.events().list(
        calendarId="primary",
        timeMin=now.isoformat(),
        timeMax=time_max.isoformat(),
        singleEvents=True,
        orderBy="startTime",
    ).execute()

    meetings = []
    for event in result.get("items", []):
        # Only events with a Google Meet link
        meet_link = _extract_meet_link(event)
        if not meet_link:
            continue

        start = _parse_time(event["start"])
        end   = _parse_time(event["end"])

        if not start or not end:
            continue

        duration_mins = (end - start).total_seconds() / 60
        if duration_mins < MIN_DURATION_MINUTES:
            continue

        meetings.append({
            "id":         event["id"],
            "title":      event.get("summary", "Reunião sem título"),
            "start":      start,
            "end":        end,
            "meet_url":   meet_link,
            "organizer":  event.get("organizer", {}).get("email", ""),
            "attendees":  [
                a["email"] for a in event.get("attendees", [])
                if not a.get("resource", False)
            ],
        })

    return meetings


def _extract_meet_link(event: dict) -> str | None:
    """Extract Google Meet URL from event."""
    # Preferred: entryPoints
    conf = event.get("conferenceData", {})
    for ep in conf.get("entryPoints", []):
        if ep.get("entryPointType") == "video":
            return ep.get("uri")

    # Fallback: hangoutLink
    if event.get("hangoutLink"):
        return event["hangoutLink"]

    # Fallback: scan description/location
    for field in ("description", "location"):
        text = event.get(field, "") or ""
        import re
        match = re.search(r"https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}", text)
        if match:
            return match.group(0)

    return None


def _parse_time(time_obj: dict) -> datetime | None:
    """Parse event start/end — handles both dateTime and all-day date."""
    if "dateTime" in time_obj:
        return datetime.fromisoformat(time_obj["dateTime"])
    # All-day events have no time — skip
    return None


class CalendarWatcher:
    """
    Polls Google Calendar every minute and schedules bot launches.
    """

    def __init__(self, on_meeting_start):
        self.on_meeting_start = on_meeting_start  # async callback(meeting)
        self._scheduled: set[str] = set()         # event IDs already scheduled

    async def run(self):
        logger.info("📅 Calendar watcher started (polling every 60s)")
        consecutive_errors = 0
        while True:
            try:
                await self._check()
                consecutive_errors = 0
            except Exception as e:
                consecutive_errors += 1
                backoff = min(60 * consecutive_errors, 600)
                logger.error(f"Calendar check error ({consecutive_errors}x): {e}", exc_info=True)
                if consecutive_errors >= 5:
                    logger.warning(f"Multiple calendar errors. Backing off {backoff}s.")
                await asyncio.sleep(backoff)
                continue
            await asyncio.sleep(60)

    async def _check(self):
        meetings = get_upcoming_meetings(minutes_ahead=65)
        now = datetime.now(tz=timezone.utc)

        for m in meetings:
            if m["id"] in self._scheduled:
                continue

            # Time until meeting starts
            seconds_until = (m["start"] - now).total_seconds()
            join_at_seconds = seconds_until - (JOIN_BEFORE_MINUTES * 60)

            if join_at_seconds < 0:
                # Already started and we missed the window — join immediately if < 30min in
                if seconds_until > -1800:
                    logger.info(f"Joining ongoing meeting: {m['title']}")
                    self._scheduled.add(m["id"])
                    asyncio.create_task(self.on_meeting_start(m))
                continue

            logger.info(
                f"📅 Scheduled: '{m['title']}' in "
                f"{join_at_seconds/60:.1f}min → {m['meet_url']}"
            )
            self._scheduled.add(m["id"])
            asyncio.create_task(self._delayed_start(m, join_at_seconds))

    async def _delayed_start(self, meeting: dict, delay_seconds: float):
        await asyncio.sleep(delay_seconds)
        logger.info(f"🚀 Time to join: {meeting['title']}")
        await self.on_meeting_start(meeting)
