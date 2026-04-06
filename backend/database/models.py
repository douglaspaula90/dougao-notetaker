import aiosqlite
import json
from datetime import datetime
from pathlib import Path

DB_PATH = Path("/data/dougaocast.db")

async def create_tables():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS meetings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                date TEXT NOT NULL,
                duration_seconds INTEGER DEFAULT 0,
                status TEXT DEFAULT 'processing',  -- processing | done | error
                participants TEXT DEFAULT '[]',    -- JSON array of names
                audio_path TEXT,
                transcript TEXT,                   -- JSON array of segments
                summary TEXT,
                action_items TEXT DEFAULT '[]',    -- JSON array
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        await db.commit()

async def get_db():
    return aiosqlite.connect(DB_PATH)

# ── CRUD ────────────────────────────────────────────────────────────────────

async def create_meeting(meeting_id: str, title: str, audio_path: str) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO meetings (id, title, date, audio_path) VALUES (?, ?, ?, ?)",
            (meeting_id, title, datetime.utcnow().isoformat(), audio_path)
        )
        await db.commit()
    return await get_meeting(meeting_id)

async def get_meeting(meeting_id: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)) as cur:
            row = await cur.fetchone()
            if row:
                return dict(row)
    return None

async def list_meetings() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM meetings ORDER BY created_at DESC") as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]

async def search_meetings(query: str) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        like = f"%{query}%"
        async with db.execute(
            """SELECT * FROM meetings
               WHERE title LIKE ? OR transcript LIKE ? OR summary LIKE ? OR participants LIKE ?
               ORDER BY created_at DESC""",
            (like, like, like, like)
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def update_meeting(meeting_id: str, **kwargs):
    if not kwargs:
        return
    sets = ", ".join(f"{k} = ?" for k in kwargs)
    values = list(kwargs.values()) + [meeting_id]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE meetings SET {sets} WHERE id = ?", values)
        await db.commit()
