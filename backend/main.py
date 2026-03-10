from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from database.models import create_tables
from routers import meetings, audio
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

app.include_router(meetings.router, prefix="/api/meetings", tags=["meetings"])
app.include_router(audio.router, prefix="/api/audio", tags=["audio"])

@app.get("/health")
async def health():
    return {"status": "ok", "service": "DougãoCast"}
