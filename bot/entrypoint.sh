#!/bin/bash
set -e

echo "🎙️  Dougao Notetaker container starting..."

# ── Start virtual display (Xvfb) ─────────────────────────────────────────────
# Chrome needs a display even in headless mode for some features
Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX &
export DISPLAY=:99
echo "✅ Xvfb started on :99"

# ── Start PulseAudio ──────────────────────────────────────────────────────────
pulseaudio --system --disallow-exit --disallow-module-loading=false \
           --log-target=stderr --log-level=warn &
sleep 2
echo "✅ PulseAudio started"

# ── Load null sink module (fallback — bots also create their own) ─────────────
pactl load-module module-null-sink sink_name=default_sink \
      sink_properties=device.description=DefaultCapture || true

# ── Start the bot ─────────────────────────────────────────────────────────────
echo "🚀 Starting calendar watcher..."
exec python main.py
