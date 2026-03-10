FROM python:3.11-slim

# ── System dependencies ──────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y \
    # Chromium headless
    chromium \
    chromium-driver \
    # Audio: PulseAudio virtual sink + ffmpeg recorder
    pulseaudio \
    ffmpeg \
    # Misc
    curl \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# ── Python deps ──────────────────────────────────────────────────────────────
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── PulseAudio config ────────────────────────────────────────────────────────
# Run PulseAudio as a system daemon (no user session needed in container)
RUN mkdir -p /run/pulse
COPY pulse/client.conf /etc/pulse/client.conf
COPY pulse/daemon.conf /etc/pulse/daemon.conf

COPY . .

# ── Entrypoint ───────────────────────────────────────────────────────────────
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
