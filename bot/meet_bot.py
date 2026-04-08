"""
meet_bot.py — Headless Chrome bot that joins Google Meet as "Dougao Notetaker",
records audio via PulseAudio virtual sink, then sends to the backend pipeline.
"""

import asyncio
import logging
import os
import subprocess
import signal
import tempfile
import uuid
from pathlib import Path
from datetime import datetime, timezone

import httpx
from pyppeteer import launch

logger = logging.getLogger(__name__)

BOT_EMAIL    = os.environ["BOT_GOOGLE_EMAIL"]     # dougaonotetaker@gmail.com
BOT_PASSWORD = os.environ["BOT_GOOGLE_PASSWORD"]
BOT_NAME     = "Dougao Notetaker 🎙️"
API_BASE     = os.environ.get("API_BASE", "http://backend:8000/api")
API_KEY      = os.environ.get("APP_API_KEY", "")
AUDIO_DIR    = Path("/data/bot-audio")
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# How long after all other participants leave to stay (seconds)
LINGER_AFTER_EMPTY_SECS = int(os.getenv("LINGER_AFTER_EMPTY_SECS", "30"))


class MeetBot:
    def __init__(self, meeting: dict):
        self.meeting    = meeting
        self.browser    = None
        self.page       = None
        self.pulse_sink = None
        self.ffmpeg_proc: subprocess.Popen | None = None
        self.audio_path: Path | None = None
        self._recording = False

    # ── Public entry point ──────────────────────────────────────────────────

    async def run(self):
        logger.info(f"🤖 Bot starting for: {self.meeting['title']}")
        try:
            self._setup_pulse()
            await self._launch_browser()
            await self._join_meet_as_visitor()
            self._start_recording()
            await self._wait_for_meeting_end()
        except Exception as e:
            logger.error(f"Bot error: {e}", exc_info=True)
        finally:
            await self._finish()

    # ── PulseAudio virtual sink ─────────────────────────────────────────────

    def _setup_pulse(self):
        """Create a virtual PulseAudio sink to capture Chrome's audio output."""
        sink_name = f"dougao_{uuid.uuid4().hex[:8]}"
        subprocess.run(
            ["pactl", "load-module", "module-null-sink",
             f"sink_name={sink_name}", "sink_properties=device.description=DougaoCapture"],
            check=True, capture_output=True
        )
        self.pulse_sink = sink_name
        logger.info(f"PulseAudio sink created: {sink_name}")

    def _cleanup_pulse(self):
        if self.pulse_sink:
            subprocess.run(
                ["pactl", "unload-module", f"sink_name={self.pulse_sink}"],
                capture_output=True
            )

    # ── Recording ───────────────────────────────────────────────────────────

    def _start_recording(self):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.audio_path = AUDIO_DIR / f"meeting_{ts}.mp3"

        # Record from PulseAudio monitor source (captures what Chrome plays)
        monitor_source = f"{self.pulse_sink}.monitor"

        self.ffmpeg_proc = subprocess.Popen([
            "ffmpeg", "-y",
            "-f", "pulse", "-i", monitor_source,
            "-ar", "16000", "-ac", "1", "-b:a", "64k",
            str(self.audio_path)
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        self._recording = True
        logger.info(f"🔴 Recording started → {self.audio_path}")

    def _stop_recording(self):
        if self.ffmpeg_proc:
            self.ffmpeg_proc.send_signal(signal.SIGINT)
            self.ffmpeg_proc.wait(timeout=10)
            self.ffmpeg_proc = None
        self._recording = False
        logger.info(f"⏹ Recording stopped: {self.audio_path}")

    # ── Browser & Google Login ───────────────────────────────────────────────

    async def _launch_browser(self):
        profile_dir = f"/tmp/dougao-profile-{uuid.uuid4().hex[:8]}"
        self.browser = await launch(
            headless=False,  # Use headful mode with Xvfb (avoids Google bot detection)
            executablePath="/usr/bin/chromium",
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-software-rasterizer",
                "--disable-blink-features=AutomationControlled",
                # Route audio to our PulseAudio sink
                f"--alsa-output-device=pulse:{self.pulse_sink}",
                # Grant mic/camera permissions silently
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                f"--user-data-dir={profile_dir}",
                "--window-size=1280,720",
                # Make Chrome look like a real browser
                "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            ],
            userDataDir=profile_dir,
        )
        self.page = await self.browser.newPage()
        await self.page.setViewport({"width": 1280, "height": 720})

        # Remove automation flags that Google detects
        await self.page.evaluateOnNewDocument("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            delete navigator.__proto__.webdriver;
        """)

        # Grant permissions for the Meet origin
        try:
            context = self.browser.browserContexts[0]
            await context.overridePermissions(
                "https://meet.google.com",
                ["microphone", "camera", "notifications"]
            )
        except Exception as e:
            logger.warning(f"Could not set permissions (non-fatal): {e}")
        logger.info("Browser launched")

    async def _login_google(self):
        """Log in to Google with the bot account."""
        logger.info(f"Logging in as {BOT_EMAIL}...")
        await self.page.goto("https://accounts.google.com/signin", {"waitUntil": "networkidle2"})

        # Email
        await self.page.waitForSelector('input[type="email"]', {"timeout": 30000})
        await self.page.type('input[type="email"]', BOT_EMAIL, {"delay": 80})
        await asyncio.sleep(1)
        await self.page.keyboard.press("Enter")
        await asyncio.sleep(3)

        # Take screenshot to debug what Google is showing
        try:
            await self.page.screenshot({"path": "/data/debug_after_email.png"})
            logger.info("Debug screenshot saved: /data/debug_after_email.png")
        except Exception:
            pass

        # Password - try multiple selectors
        password_selectors = [
            'input[type="password"]',
            'input[name="Passwd"]',
            'input[name="password"]',
            '#password input',
        ]
        password_field = None
        for sel in password_selectors:
            try:
                await self.page.waitForSelector(sel, {"visible": True, "timeout": 10000})
                password_field = sel
                break
            except Exception:
                continue

        if not password_field:
            await self.page.screenshot({"path": "/data/debug_no_password.png"})
            page_url = self.page.url
            logger.error(f"Password field not found. Current URL: {page_url}")
            raise RuntimeError("Could not find password field")

        await self.page.type(password_field, BOT_PASSWORD, {"delay": 80})
        await asyncio.sleep(1)
        await self.page.keyboard.press("Enter")

        await asyncio.sleep(5)

        # Check if login succeeded or if there's a challenge
        try:
            await self.page.screenshot({"path": "/data/debug_after_login.png"})
            logger.info("Debug screenshot saved: /data/debug_after_login.png")
        except Exception:
            pass

        current_url = self.page.url
        if "challenge" in current_url or "signin" in current_url:
            logger.warning(f"Google may be showing a challenge. URL: {current_url}")

        logger.info("✅ Logged in to Google")

    # ── Google Meet (visitor mode — no login needed) ─────────────────────────

    async def _join_meet_as_visitor(self):
        """Join Google Meet as a visitor (no Google login required)."""
        url = self.meeting["meet_url"]
        logger.info(f"Navigating to {url} (visitor mode)")
        await self.page.goto(url, {"waitUntil": "networkidle2", "timeout": 30000})

        await asyncio.sleep(5)

        # Dismiss any cookie/consent banners
        await self._dismiss_dialogs()

        # Take screenshot to see current state
        try:
            await self.page.screenshot({"path": "/data/debug_meet_visitor.png"})
            logger.info("Debug screenshot: /data/debug_meet_visitor.png")
        except Exception:
            pass

        # Enter name in the "Your name" field (visitor mode)
        name_entered = False
        name_selectors = [
            'input[placeholder="Your name"]',
            'input[placeholder="Seu nome"]',
            'input[aria-label="Your name"]',
            'input[aria-label="Seu nome"]',
            'input[type="text"]',
        ]
        for sel in name_selectors:
            try:
                name_input = await self.page.querySelector(sel)
                if name_input:
                    await name_input.click({"clickCount": 3})
                    await name_input.type(BOT_NAME, {"delay": 40})
                    name_entered = True
                    logger.info(f"Entered name: {BOT_NAME}")
                    break
            except Exception:
                continue

        if not name_entered:
            logger.warning("Could not find name input field")

        await asyncio.sleep(1)

        # Turn off camera and mic before joining
        await self._mute_before_join()

        await asyncio.sleep(1)

        # Take screenshot before clicking join
        try:
            await self.page.screenshot({"path": "/data/debug_meet_prejoin.png"})
            logger.info("Debug screenshot: /data/debug_meet_prejoin.png")
        except Exception:
            pass

        # Click join / ask to join button
        joined = await self._click_join_button()
        if not joined:
            await self.page.screenshot({"path": "/data/debug_meet_no_join.png"})
            logger.error("Could not find join button. Check /data/debug_meet_no_join.png")
            raise RuntimeError("Could not find join button in Google Meet")

        await asyncio.sleep(5)
        logger.info(f"✅ Joined (or requested to join): {self.meeting['title']}")

    async def _join_meet(self):
        url = self.meeting["meet_url"]
        logger.info(f"Navigating to {url}")
        await self.page.goto(url, {"waitUntil": "networkidle2", "timeout": 30000})

        await asyncio.sleep(3)

        # Dismiss any cookie/consent banners
        await self._dismiss_dialogs()

        # Turn off camera and microphone before joining
        await self._mute_before_join()

        # Change display name if prompted
        await self._set_display_name()

        # Take screenshot of Meet pre-join screen
        try:
            await self.page.screenshot({"path": "/data/debug_meet_prejoin.png"})
            logger.info("Debug screenshot saved: /data/debug_meet_prejoin.png")
        except Exception:
            pass

        # Click "Join now" / "Participar agora"
        joined = await self._click_join_button()
        if not joined:
            await self.page.screenshot({"path": "/data/debug_meet_no_join.png"})
            logger.error("Check /data/debug_meet_no_join.png")
            raise RuntimeError("Could not find join button in Google Meet")

        await asyncio.sleep(5)
        logger.info(f"✅ Joined meeting: {self.meeting['title']}")

    async def _dismiss_dialogs(self):
        dismiss_selectors = [
            '[data-mdc-dialog-action="accept"]',
            'button[jsname="V67aGc"]',  # "Got it" buttons
        ]
        for sel in dismiss_selectors:
            try:
                btn = await self.page.querySelector(sel)
                if btn:
                    await btn.click()
                    await asyncio.sleep(0.5)
            except Exception:
                pass

    async def _mute_before_join(self):
        """Ensure mic and camera are off before joining."""
        # Try to click mic/cam toggle buttons in the pre-join screen
        mute_selectors = [
            '[data-is-muted="false"][data-tooltip*="microphone"]',
            '[data-is-muted="false"][data-tooltip*="camera"]',
            '[aria-label*="Turn off microphone"]',
            '[aria-label*="Turn off camera"]',
        ]
        for sel in mute_selectors:
            try:
                btn = await self.page.querySelector(sel)
                if btn:
                    await btn.click()
                    await asyncio.sleep(0.3)
            except Exception:
                pass

    async def _set_display_name(self):
        """Set bot display name if the name input is shown."""
        try:
            name_input = await self.page.querySelector('input[placeholder*="name"], input[aria-label*="name"]')
            if name_input:
                await name_input.click({"clickCount": 3})
                await name_input.type(BOT_NAME, {"delay": 40})
                await asyncio.sleep(0.5)
        except Exception:
            pass

    async def _click_join_button(self) -> bool:
        """Click the join button. Tries multiple selectors."""
        join_selectors = [
            # English
            'button[jsname="Qx7uuf"]',
            '//button[contains(., "Join now")]',
            '//button[contains(., "Ask to join")]',
            # Portuguese
            '//button[contains(., "Participar agora")]',
            '//button[contains(., "Pedir para participar")]',
            # Generic fallback
            '[data-idom-class*="join"]',
        ]

        for sel in join_selectors:
            try:
                if sel.startswith("//"):
                    btns = await self.page.xpath(sel)
                    if btns:
                        await btns[0].click()
                        return True
                else:
                    btn = await self.page.querySelector(sel)
                    if btn:
                        await btn.click()
                        return True
            except Exception:
                continue

        return False

    # ── Wait for meeting to end ─────────────────────────────────────────────

    async def _wait_for_meeting_end(self):
        """
        Poll the page to detect when the meeting ends:
        - All other participants leave
        - Meeting end screen appears
        - Max duration exceeded (based on calendar end time)
        """
        meeting_end = self.meeting["end"]
        linger_started = None

        logger.info("⏳ Waiting for meeting to end...")

        while True:
            await asyncio.sleep(15)

            # Check if meeting already ended (end screen shown)
            if await self._is_meeting_ended():
                logger.info("Meeting end screen detected")
                break

            # Check if we're past the scheduled end time (+15min buffer)
            now = datetime.now(tz=timezone.utc)
            if meeting_end and (now - meeting_end).total_seconds() > 900:
                logger.info("Meeting exceeded scheduled end time, leaving")
                break

            # Check participant count
            participant_count = await self._get_participant_count()
            if participant_count <= 1:  # only the bot
                if linger_started is None:
                    linger_started = asyncio.get_event_loop().time()
                    logger.info(f"Alone in meeting, will leave in {LINGER_AFTER_EMPTY_SECS}s")
                elif asyncio.get_event_loop().time() - linger_started > LINGER_AFTER_EMPTY_SECS:
                    logger.info("Meeting appears empty, leaving")
                    break
            else:
                linger_started = None  # reset if others rejoin

    async def _is_meeting_ended(self) -> bool:
        end_selectors = [
            '[data-call-ended="true"]',
            '//h1[contains(., "left the call")]',
            '//h1[contains(., "saiu da chamada")]',
            '//div[contains(., "Your meeting ended")]',
            '//div[contains(., "Sua reunião terminou")]',
            '//div[contains(., "You left the meeting")]',
            '//div[contains(., "Você saiu da reunião")]',
            '//div[contains(., "The meeting has ended")]',
            '//div[contains(., "A reunião terminou")]',
            '//button[contains(., "Return to home screen")]',
            '//button[contains(., "Voltar para a tela inicial")]',
            '//button[contains(., "Rejoin")]',
            '//button[contains(., "Voltar para a reunião")]',
        ]
        for sel in end_selectors:
            try:
                if sel.startswith("//"):
                    els = await self.page.xpath(sel)
                    if els:
                        return True
                else:
                    el = await self.page.querySelector(sel)
                    if el:
                        return True
            except Exception:
                pass

        # Check if current URL changed away from meet
        try:
            url = self.page.url
            if url and "meet.google.com" not in url:
                return True
        except Exception:
            pass

        return False

    async def _get_participant_count(self) -> int:
        try:
            # Meet shows participant count in a badge
            el = await self.page.querySelector('[data-participant-count], [data-count]')
            if el:
                text = await self.page.evaluate("el => el.textContent", el)
                return int(text.strip())
        except Exception:
            pass
        return 99  # unknown = assume not empty

    # ── Cleanup & upload ────────────────────────────────────────────────────

    async def _finish(self):
        logger.info("🏁 Meeting finished, cleaning up...")

        self._stop_recording()

        if self.browser:
            await self.browser.close()

        self._cleanup_pulse()

        # Upload to backend pipeline
        if self.audio_path and self.audio_path.exists():
            file_size_mb = self.audio_path.stat().st_size / 1024 / 1024
            logger.info(f"Uploading {file_size_mb:.1f}MB audio to backend...")
            await self._upload_audio()
        else:
            logger.warning("No audio file to upload")

    async def _upload_audio(self):
        max_retries = 4
        for attempt in range(1, max_retries + 1):
            try:
                headers = {}
                if API_KEY:
                    headers["Authorization"] = f"Bearer {API_KEY}"
                async with httpx.AsyncClient(timeout=300) as client:
                    with open(self.audio_path, "rb") as f:
                        response = await client.post(
                            f"{API_BASE}/audio/upload",
                            files={"file": (self.audio_path.name, f, "audio/mpeg")},
                            data={
                                "title": self.meeting["title"],
                                "speaker_names": "{}",
                            },
                            headers=headers,
                        )
                    response.raise_for_status()
                    result = response.json()
                    logger.info(f"✅ Uploaded! meeting_id={result['meeting_id']}")
                    self.audio_path.unlink(missing_ok=True)
                    return

            except Exception as e:
                wait = 2 ** attempt
                logger.error(f"Upload attempt {attempt}/{max_retries} failed: {e}")
                if attempt < max_retries:
                    logger.info(f"Retrying in {wait}s...")
                    await asyncio.sleep(wait)
                else:
                    logger.error(f"All upload attempts failed. Audio preserved at: {self.audio_path}")
