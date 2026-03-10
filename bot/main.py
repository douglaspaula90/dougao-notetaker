"""
main.py — Dougao Notetaker bot entrypoint.
Watches Google Calendar and launches the Meet bot for each meeting.
"""

import asyncio
import logging
import os
from calendar_watcher import CalendarWatcher
from meet_bot import MeetBot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

# Track active bots to avoid joining the same meeting twice
active_meetings: set[str] = set()


async def on_meeting_start(meeting: dict):
    meeting_id = meeting["id"]

    if meeting_id in active_meetings:
        logger.info(f"Already in meeting {meeting['title']}, skipping")
        return

    active_meetings.add(meeting_id)
    try:
        bot = MeetBot(meeting)
        await bot.run()
    finally:
        active_meetings.discard(meeting_id)


async def main():
    logger.info("🎙️  Dougao Notetaker starting up...")
    logger.info(f"   Bot account : {os.environ.get('BOT_GOOGLE_EMAIL')}")
    logger.info(f"   API backend : {os.environ.get('API_BASE', 'http://backend:8000/api')}")
    logger.info(f"   Join before : {os.environ.get('JOIN_BEFORE_MINUTES', '2')} min")

    watcher = CalendarWatcher(on_meeting_start=on_meeting_start)
    await watcher.run()


if __name__ == "__main__":
    asyncio.run(main())
