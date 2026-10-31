import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_session
from ..llm import resolve_profiles
from ..models import Character, new_id
from ..schemas import CharacterIn, CharacterModelIn, CharacterOut

router = APIRouter(prefix="/characters", tags=["characters"])


def _copy_name(raw: str) -> str:
    """Bilingual builtin names are {"zh","en"} JSON blobs; keep them bilingual when copying.
    Truncate by the *serialised* length so the result still passes name <= 64 on next save."""
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        d = None
    if isinstance(d, dict) and ("zh" in d or "en" in d):
        zh, en = f"{d.get('zh', '')} 副本", f"{d.get('en', '')} copy"
        while zh and en and len(json.dumps({"zh": zh, "en": en}, ensure_ascii=False)) > 64:
            if len(zh) >= len(en):
                zh = zh[:-1]
            else:
                en = en[:-1]
        return json.dumps({"zh": zh or "副本", "en": en or "copy"}, ensure_ascii=False)
    return f"{raw} copy"[:64]


def _validate_model_id(model_id: str) -> None:
    if not model_id:
        return
    try:
        profiles, _ = resolve_profiles()
    except Exception as e:  # invalid stored profiles JSON
        raise HTTPException(400, f"cannot resolve model profiles: {e}") from e
    if model_id not in {p.id for p in profiles}:
        raise HTTPException(400, f"unknown model: {model_id}")


def _get(db: Session, cid: str) -> Character:
    row = db.get(Character, cid)
    if not row:
        raise HTTPException(404, "character not found")
    return row


@router.get("", response_model=list[CharacterOut])
def list_characters(kind: str = "", db: Session = Depends(get_session)):
    q = db.query(Character)
    if kind in ("host", "player"):
        q = q.filter_by(kind=kind)
    rows = q.all()
    # builtin templates first, then custom, each group by creation time
    rows.sort(key=lambda r: (not bool(r.builtin), r.created_at.isoformat() if r.created_at else ""))
    return rows


@router.post("", response_model=CharacterOut, status_code=201)
def create_character(body: CharacterIn, db: Session = Depends(get_session)):
    _validate_model_id(body.model_id)
    row = Character(id=new_id(), builtin=0, **body.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{cid}", response_model=CharacterOut)
def get_character(cid: str, db: Session = Depends(get_session)):
    return _get(db, cid)


@router.put("/{cid}", response_model=CharacterOut)
def update_character(cid: str, body: CharacterIn, db: Session = Depends(get_session)):
    row = _get(db, cid)
    if row.builtin:
        raise HTTPException(403, "builtin characters are read-only; only the model can be changed")
    _validate_model_id(body.model_id)
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{cid}/model", response_model=CharacterOut)
def set_character_model(cid: str, body: CharacterModelIn, db: Session = Depends(get_session)):
    """The only field a builtin character may change; custom characters may use it too."""
    row = _get(db, cid)
    _validate_model_id(body.model_id)
    row.model_id = body.model_id
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{cid}")
def delete_character(cid: str, db: Session = Depends(get_session)):
    row = _get(db, cid)
    if row.builtin:
        raise HTTPException(403, "builtin characters cannot be deleted")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/{cid}/duplicate", response_model=CharacterOut, status_code=201)
def duplicate_character(cid: str, db: Session = Depends(get_session)):
    src = _get(db, cid)
    copy = Character(
        id=new_id(),
        kind=src.kind,
        name=_copy_name(src.name),
        intro=src.intro,
        prompt=src.prompt,
        portrait=src.portrait,
        color=src.color,
        model_id="",
        builtin=0,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy
