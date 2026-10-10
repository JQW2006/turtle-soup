from datetime import UTC, datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db import get_session
from ..engine import generate_points, review_puzzle
from ..llm import LLMError
from ..models import Puzzle
from ..schemas import AnalyzeIn, PuzzleIn, PuzzleOut

router = APIRouter(prefix="/puzzles", tags=["puzzles"])

EXPORT_FIELDS = ("title", "surface", "bottom", "host_notes", "points", "tags", "color", "genre", "difficulty", "language")


def _normalize_points(points: list) -> list[dict]:
    """Ensure point ids are unique and stable (k1, k2, ...)."""
    out, seen = [], set()
    for i, p in enumerate(points, 1):
        d = p.model_dump() if hasattr(p, "model_dump") else dict(p)
        pid = (d.get("id") or "").strip()
        if not pid or pid in seen:
            pid = f"k{i}"
            while pid in seen:
                pid += "_"
        seen.add(pid)
        d["id"] = pid
        out.append(d)
    return out


def _get(db: Session, pid: str) -> Puzzle:
    p = db.get(Puzzle, pid)
    if not p:
        raise HTTPException(404, "puzzle not found")
    return p


@router.get("", response_model=list[PuzzleOut])
def list_puzzles(
    q: str = "",
    language: str | None = None,
    color: str | None = None,
    genre: str | None = None,
    source: str | None = None,
    db: Session = Depends(get_session),
):
    query = db.query(Puzzle)
    if q:
        like = f"%{q}%"
        query = query.filter(or_(Puzzle.title.like(like), Puzzle.surface.like(like)))
    if language:
        query = query.filter(Puzzle.language == language)
    if color:
        query = query.filter(Puzzle.color == color)
    if genre:
        query = query.filter(Puzzle.genre == genre)
    if source:
        query = query.filter(Puzzle.source == source)
    return query.order_by(Puzzle.source.desc(), Puzzle.updated_at.desc()).all()


@router.post("", response_model=PuzzleOut, status_code=201)
def create_puzzle(body: PuzzleIn, db: Session = Depends(get_session)):
    data = body.model_dump()
    data["points"] = _normalize_points(body.points)
    p = Puzzle(**data, source="user")
    db.add(p)
    db.commit()
    return p


@router.get("/export")
def export_puzzles(ids: str = Query(default=""), db: Session = Depends(get_session)):
    query = db.query(Puzzle)
    if ids:
        query = query.filter(Puzzle.id.in_(ids.split(",")))
    items = [{k: getattr(p, k) for k in EXPORT_FIELDS} for p in query.all()]
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    return JSONResponse(
        {"format": "turtle-soup/puzzles", "version": 1, "puzzles": items},
        headers={"Content-Disposition": f'attachment; filename="puzzles-{stamp}.json"'},
    )


@router.post("/import")
def import_puzzles(payload: dict | list = Body(...), db: Session = Depends(get_session)):
    items = payload.get("puzzles", []) if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        raise HTTPException(400, "expected a list of puzzles")
    created, errors = 0, []
    for i, raw in enumerate(items):
        try:
            body = PuzzleIn.model_validate(raw)
        except ValidationError as e:
            errors.append({"index": i, "error": e.errors(include_url=False)[0].get("msg", "invalid")})
            continue
        data = body.model_dump()
        data["points"] = _normalize_points(body.points)
        db.add(Puzzle(**data, source="user"))
        created += 1
    db.commit()
    return {"created": created, "errors": errors}


@router.post("/analyze/points")
async def analyze_points(body: AnalyzeIn):
    try:
        return {"points": await generate_points(body.model_dump(), body.language)}
    except LLMError as e:
        raise HTTPException(502, str(e)) from e


@router.post("/analyze/review")
async def analyze_review(body: AnalyzeIn):
    try:
        return await review_puzzle(body.model_dump(), body.language)
    except LLMError as e:
        raise HTTPException(502, str(e)) from e


@router.get("/{pid}", response_model=PuzzleOut)
def get_puzzle(pid: str, db: Session = Depends(get_session)):
    return _get(db, pid)


@router.put("/{pid}", response_model=PuzzleOut)
def update_puzzle(pid: str, body: PuzzleIn, db: Session = Depends(get_session)):
    p = _get(db, pid)
    data = body.model_dump()
    data["points"] = _normalize_points(body.points)
    for k, v in data.items():
        setattr(p, k, v)
    db.commit()
    return p


@router.post("/{pid}/duplicate", response_model=PuzzleOut, status_code=201)
def duplicate_puzzle(pid: str, db: Session = Depends(get_session)):
    src = _get(db, pid)
    data = {k: getattr(src, k) for k in EXPORT_FIELDS}
    data["title"] = f"{src.title} (copy)" if src.language == "en" else f"{src.title}（副本）"
    p = Puzzle(**data, source="user")
    db.add(p)
    db.commit()
    return p


@router.delete("/{pid}", status_code=204)
def delete_puzzle(pid: str, db: Session = Depends(get_session)):
    db.delete(_get(db, pid))
    db.commit()
