from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from database.models import create_tables
from routers import meetings, audio
from routers.auth_router import router as auth_router
from routers.settings import router as settings_router
from routers.bot import router as bot_router
from auth import verify_auth
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🎙️  DougãoCast starting up...")
    await create_tables()
    yield
    logger.info("DougãoCast shutting down.")

app = FastAPI(
    title="DougãoCast API",
    description="Meeting transcription, diarization and summarization",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(meetings.router, prefix="/api/meetings", tags=["meetings"], dependencies=[Depends(verify_auth)])
app.include_router(audio.router, prefix="/api/audio", tags=["audio"], dependencies=[Depends(verify_auth)])
app.include_router(settings_router, prefix="/api/settings", tags=["settings"], dependencies=[Depends(verify_auth)])
app.include_router(bot_router, prefix="/api/bot", tags=["bot"], dependencies=[Depends(verify_auth)])

@app.get("/health")
async def health():
    return {"status": "ok", "service": "DougãoCast"}
