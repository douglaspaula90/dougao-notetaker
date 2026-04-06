import os
import secrets
import hashlib
import logging
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

logger = logging.getLogger(__name__)

# Simple API key auth — good enough for a personal tool.
# Set APP_API_KEY in .env. If not set, auth is disabled (open access).

_security = HTTPBearer(auto_error=False)


def _get_api_key() -> str | None:
    return os.environ.get("APP_API_KEY")


async def verify_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_security),
):
    api_key = _get_api_key()

    # If no API key configured, skip auth (dev mode)
    if not api_key:
        return

    # Check Authorization: Bearer <key>
    if credentials and secrets.compare_digest(credentials.credentials, api_key):
        return

    # Also check query param ?api_key=... (for simple integrations)
    query_key = request.query_params.get("api_key")
    if query_key and secrets.compare_digest(query_key, api_key):
        return

    raise HTTPException(status_code=401, detail="Invalid or missing API key")


# Login endpoint — validates key and returns it back (for frontend to store)
async def login(api_key: str) -> bool:
    expected = _get_api_key()
    if not expected:
        return True  # No auth configured
    return secrets.compare_digest(api_key, expected)
