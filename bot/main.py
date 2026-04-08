"""
main.py — Dougao Notetaker bot entrypoint.
Watches for manual bot invocations via API and launches the Meet bot.
"""

import asyncio
import logging
import os
from aiohttp import web
from meet_bot import MeetBot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

active_meetings: set[str] = set()
API_KEY = os.environ.get("APP_API_KEY", "")


async def handle_join(request):
    """POST /join — manually trigger bot to join a meeting."""
    # Auth check
    auth = request.headers.get("Authorization", "")
    if API_KEY and not auth.endswith(API_KEY):
        return web.json_response({"error": "Unauthorized"}, status=401)

    data = await request.json()
    meet_url = data.get("meet_url", "").strip()
    title = data.get("title", "Reuniao").strip()

    if not meet_url or "meet.google.com" not in meet_url:
        return web.json_response({"error": "Invalid meet_url"}, status=400)

    if meet_url in active_meetings:
        return web.json_response({"error": "Bot already in this meeting"}, status=409)

    active_meetings.add(meet_url)

    async def run_bot():
        try:
            meeting = {
                "id": meet_url,
                "title": title,
                "meet_url": meet_url,
                "end": None,
            }
            bot = MeetBot(meeting)
            await bot.run()
        finally:
            active_meetings.discard(meet_url)

    asyncio.create_task(run_bot())
    return web.json_response({"status": "joining", "meet_url": meet_url, "title": title})


async def handle_health(request):
    return web.json_response({"status": "ok", "active_meetings": len(active_meetings)})


async def main():
    logger.info("🎙️  Dougao Notetaker starting up (manual mode)...")
    logger.info(f"   API backend : {os.environ.get('API_BASE', 'http://backend:8000/api')}")

    app = web.Application()
    app.router.add_post("/join", handle_join)
    app.router.add_get("/health", handle_health)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8080)
    await site.start()
    logger.info("🚀 Bot API running on port 8080 (manual mode - waiting for /join requests)")

    # Keep running forever
    while True:
        await asyncio.sleep(3600)


if __name__ == "__main__":
    asyncio.run(main())
