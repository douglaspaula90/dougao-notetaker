from fastapi import APIRouter, HTTPException, Query
from database.models import list_meetings, get_meeting, search_meetings
import json

router = APIRouter()

def parse_meeting(m: dict) -> dict:
    """Parse JSON fields and clean up for API response."""
    if m.get("transcript"):
        try:
            m["transcript"] = json.loads(m["transcript"])
        except Exception:
            pass

    if m.get("participants"):
        try:
            m["participants"] = json.loads(m["participants"])
        except Exception:
            pass

    if m.get("action_items"):
        try:
            m["action_items"] = json.loads(m["action_items"])
        except Exception:
            pass

    # summary field contains full JSON summary data
    if m.get("summary"):
        try:
            m["summary_data"] = json.loads(m["summary"])
            m["summary"] = m["summary_data"].get("summary", "")
        except Exception:
            m["summary_data"] = {}

    return m

@router.get("/")
async def get_meetings(q: str = Query(default=None, description="Search by keyword")):
    if q and q.strip():
        meetings = await search_meetings(q.strip())
    else:
        meetings = await list_meetings()
    return [parse_meeting(m) for m in meetings]

@router.get("/{meeting_id}")
async def get_meeting_detail(meeting_id: str):
    meeting = await get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return parse_meeting(meeting)

@router.delete("/{meeting_id}")
async def delete_meeting(meeting_id: str):
    meeting = await get_meeting(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    from database.models import DB_PATH
    import aiosqlite
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))
        await db.commit()
    return {"deleted": True}
