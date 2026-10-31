import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_session
from ..llm import DeepSeekLLM, LLMError, invalidate_profiles_cache, profiles_source, resolve_profiles, runtime_config
from ..models import Setting
from ..schemas import ModelProfileOut, SettingsIn, SettingsOut

router = APIRouter(prefix="/settings", tags=["settings"])


def _mask(key: str) -> str:
    return f"{key[:5]}…{key[-4:]}" if len(key) > 12 else ("•" * len(key))


def _out() -> SettingsOut:
    cfg = runtime_config()
    key = cfg["api_key"]
    try:
        profiles, default = resolve_profiles()
        profile_items = [
            ModelProfileOut(
                id=p.id, label=p.label, api_key="", base_url=p.base_url, model=p.model,
                api_key_set=bool(p.api_key), api_key_preview=_mask(p.api_key) if p.api_key else "",
            )
            for p in profiles
        ]
        source = profiles_source()
    except LLMError:  # stored profiles are broken — surface the error rather than 500
        profile_items, default, source = [], "", "db"
    return SettingsOut(
        api_key_set=bool(key),
        api_key_preview=_mask(key) if key else "",
        api_key_source=cfg["api_key_source"],
        base_url=cfg["base_url"],
        model=cfg["model"],
        access_token_required=bool(get_settings().app_access_token),
        locked=get_settings().settings_locked,
        profiles=profile_items,
        default_profile=default,
        profiles_source=source,
    )


@router.get("", response_model=SettingsOut)
def read_settings():
    return _out()


@router.put("", response_model=SettingsOut)
def write_settings(body: SettingsIn, db: Session = Depends(get_session)):
    if get_settings().settings_locked:
        raise HTTPException(403, "settings are locked on this server")
    legacy_fields = body.model_dump(exclude_none=True, exclude={"profiles", "default_profile"})
    if legacy_fields and profiles_source() != "legacy":
        # These fields feed the legacy single-model fallback only; while profiles are
        # active (db or env) writing them would silently do nothing. Refuse instead.
        raise HTTPException(
            400, "legacy single-model fields are ignored while model profiles are active; edit the profiles instead"
        )
    for key, value in legacy_fields.items():
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

    if body.profiles is not None:
        if not body.profiles:
            # An empty list clears the DB override entirely and falls back to
            # .env MODEL_PROFILES (or the legacy single-model config).
            for k in ("model_profiles", "default_model"):
                row = db.get(Setting, k)
                if row:
                    db.delete(row)
        else:
            items = [p.model_dump() for p in body.profiles]
            ids = [it["id"] for it in items]
            if len(ids) != len(set(ids)):
                raise HTTPException(400, "duplicate model profile ids")
            default = (body.default_profile or "").strip() or ids[0]
            if default not in ids:
                raise HTTPException(400, f"default profile {default!r} is not in the list")
            # An empty api_key means "keep the key already stored for this profile id".
            try:
                current = {p.id: p for p in resolve_profiles()[0]}
            except LLMError:
                current = {}
            for it in items:
                if not it["api_key"] and it["id"] in current:
                    it["api_key"] = current[it["id"]].api_key
                it["label"] = it["label"] or it["model"]
            db.merge(Setting(key="model_profiles", value=json.dumps(items, ensure_ascii=False)))
            db.merge(Setting(key="default_model", value=default))
    elif body.default_profile is not None and body.default_profile.strip():
        db.merge(Setting(key="default_model", value=body.default_profile.strip()))

    db.commit()
    invalidate_profiles_cache()
    return _out()


@router.post("/test")
async def test_connection(profile: str = Query(default="")):
    if get_settings().settings_locked:
        raise HTTPException(403, "settings are locked on this server")
    try:
        model = await DeepSeekLLM().ping(profile or None)
    except LLMError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # network errors, bad base url, ...
        raise HTTPException(400, f"{type(e).__name__}: {e}") from e
    return {"ok": True, "model": model}
