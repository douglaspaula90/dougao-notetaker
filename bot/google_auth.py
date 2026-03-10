"""
google_auth.py — One-time setup to authorize Google Calendar access.

Run this ONCE on your local machine:
    python google_auth.py

It will open a browser, ask you to log in with douglas.paula@medway.com.br,
and save a token.json file. Upload that file to your VPS.
"""

import os
import json
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
TOKEN_PATH = "/data/token.json"
CREDS_PATH = "/data/credentials.json"

def get_calendar_credentials() -> Credentials:
    """
    Load or refresh Google Calendar credentials.
    On first run, opens browser for OAuth consent.
    """
    creds = None

    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDS_PATH):
                raise FileNotFoundError(
                    f"Missing {CREDS_PATH}.\n"
                    "Download it from Google Cloud Console:\n"
                    "  console.cloud.google.com → APIs & Services → Credentials\n"
                    "  → Create OAuth 2.0 Client ID (Desktop app) → Download JSON\n"
                    "  → Save as /data/credentials.json"
                )
            flow = InstalledAppFlow.from_client_secrets_file(CREDS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)

        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())

    return creds


if __name__ == "__main__":
    print("🔐 Iniciando autorização do Google Calendar...")
    creds = get_calendar_credentials()
    print(f"✅ Autorizado! Token salvo em {TOKEN_PATH}")
    print("Copie o arquivo token.json para /data/ na sua VPS.")
