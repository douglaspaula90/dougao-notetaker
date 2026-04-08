#!/bin/bash
set -e

echo "🎙️  Dougao Notetaker container starting..."

# ── Start virtual display (Xvfb) ─────────────────────────────────────────────
Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX &
export DISPLAY=:99
echo "✅ Xvfb started on :99"

# ── Start PulseAudio in user mode ────────────────────────────────────────────
# System mode has auth issues; use user mode instead
export PULSE_RUNTIME_PATH=/tmp/pulse
mkdir -p /tmp/pulse
pulseaudio --daemonize --exit-idle-time=-1 \
           --log-target=stderr --log-level=warn \
           --disallow-exit --disallow-module-loading=false || true
sleep 2
echo "✅ PulseAudio started"

# ── Load null sink module (fallback) ─────────────────────────────────────────
pactl load-module module-null-sink sink_name=default_sink \
      sink_properties=device.description=DefaultCapture || true

# ── Start the bot ─────────────────────────────────────────────────────────────
echo "🚀 Starting calendar watcher..."
exec python main.py
