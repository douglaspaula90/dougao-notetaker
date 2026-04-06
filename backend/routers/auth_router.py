from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from auth import login

router = APIRouter()


class LoginRequest(BaseModel):
    api_key: str


@router.post("/login")
async def do_login(body: LoginRequest):
    valid = await login(body.api_key)
    if not valid:
        raise HTTPException(status_code=401, detail="Chave invalida")
    return {"authenticated": True}
