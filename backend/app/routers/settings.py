from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_session
from ..llm import DeepSeekLLM, LLMError, runtime_config
from ..models import Setting
from ..schemas import SettingsIn, SettingsOut

router = APIRouter(prefix="/settings", tags=["settings"])


def _out() -> SettingsOut:
    cfg = runtime_config()
    key = cfg["api_key"]
    return SettingsOut(
        api_key_set=bool(key),
        api_key_preview=f"{key[:5]}…{key[-4:]}" if len(key) > 12 else ("•" * len(key)),
        api_key_source=cfg["api_key_source"],
        base_url=cfg["base_url"],
        model=cfg["model"],
        access_token_required=bool(get_settings().app_access_token),
        locked=get_settings().settings_locked,
    )


@router.get("", response_model=SettingsOut)
def read_settings():
    return _out()


@router.put("", response_model=SettingsOut)
def write_settings(body: SettingsIn, db: Session = Depends(get_session)):
    if get_settings().settings_locked:
        raise HTTPException(403, "settings are locked on this server")
    for key, value in body.model_dump(exclude_none=True).items():
        value = value.strip()
        row = db.get(Setting, key)
        if not value:  # empty string clears the override and falls back to .env
            if row:
                db.delete(row)
            continue
        if row:
            row.value = value
        else:
            db.add(Setting(key=key, value=value))
    db.commit()
    return _out()


@router.post("/test")
async def test_connection():
    if get_settings().settings_locked:
        raise HTTPException(403, "settings are locked on this server")
    try:
        model = await DeepSeekLLM().ping()
    except LLMError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # network errors, bad base url, ...
        raise HTTPException(400, f"{type(e).__name__}: {e}") from e
    return {"ok": True, "model": model}
