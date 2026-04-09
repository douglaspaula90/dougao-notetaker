#!/bin/bash
set -e

echo "🎙️  Dougao Notetaker container starting..."

# ── Start virtual display (Xvfb) ─────────────────────────────────────────────
Xvfb :99 -screen 0 1280x720x24 -ac +extension GLX &
export DISPLAY=:99
echo "✅ Xvfb started on :99"

# ── Start PulseAudio in user mode ────────────────────────────────────────────
export PULSE_RUNTIME_PATH=/tmp/pulse
export PULSE_SERVER=unix:/tmp/pulse/native
mkdir -p /tmp/pulse
pulseaudio --daemonize --exit-idle-time=-1 \
           --log-target=stderr --log-level=warn \
           --disallow-exit --disallow-module-loading=false || true
sleep 2
echo "✅ PulseAudio started"

# ── Load default null sink ───────────────────────────────────────────────────
pactl load-module module-null-sink sink_name=default_sink \
      sink_properties=device.description=DefaultCapture || true
pactl set-default-sink default_sink || true

# ── Start the bot ─────────────────────────────────────────────────────────
echo "🚀 Starting bot API (manual mode)..."
exec python main.py
