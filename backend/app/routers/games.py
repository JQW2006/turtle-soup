import asyncio
import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from ..db import get_session
from ..engine import PLAYER_COLORS, GameRunner, initial_state, registry
from ..export import game_markdown
from ..llm import LLMError
from ..models import Game, Puzzle
from ..schemas import (
    ControlIn,
    GameCreate,
    GameSummary,
    HintIn,
    HostAnswerIn,
    HostHintIn,
    HostJudgeIn,
    OverrideIn,
    PlayerActionIn,
    SpeedIn,
)

router = APIRouter(prefix="/games", tags=["games"])


async def _runner(gid: str) -> GameRunner:
    r = await registry.get(gid)
    if not r:
        raise HTTPException(404, "game not found")
    return r


def _active(r: GameRunner) -> None:
    if r.status != "active":
        raise HTTPException(409, "game is finished")


@router.post("", status_code=201)
async def create_game(body: GameCreate, db: Session = Depends(get_session)):
    pz = db.get(Puzzle, body.puzzle_id)
    if not pz:
        raise HTTPException(404, "puzzle not found")
    lang = body.language or pz.language
    players = []
    for i, p in enumerate(body.players):
        d = p.model_dump()
        d["id"] = f"p{i + 1}"
        d["color"] = d["color"] or PLAYER_COLORS[i % len(PLAYER_COLORS)]
        players.append(d)
    if body.host.kind == "human" and all(p["kind"] == "human" for p in players):
        raise HTTPException(400, "a game needs at least one AI participant")
    snapshot = {
        "title": pz.title, "surface": pz.surface, "bottom": pz.bottom, "host_notes": pz.host_notes,
        "points": pz.points or [], "color": pz.color, "genre": pz.genre, "difficulty": pz.difficulty,
    }
    config = {"language": lang, "host": body.host.model_dump(), "players": players, "rules": body.rules.model_dump()}
    g = Game(puzzle_id=pz.id, puzzle=snapshot, config=config, state=initial_state(body.delay, body.start_paused))
    pz.play_count = (pz.play_count or 0) + 1
    db.add(g)
    db.commit()
    await registry.get(g.id)
    return {"id": g.id}


@router.get("", response_model=list[GameSummary])
def list_games(db: Session = Depends(get_session)):
    out = []
    for g in db.query(Game).order_by(Game.created_at.desc()).limit(200):
        rep = (g.state or {}).get("report") or {}
        out.append(
            GameSummary(
                id=g.id, puzzle_id=g.puzzle_id, title=g.puzzle.get("title", ""), status=g.status, outcome=g.outcome,
                rating=rep.get("rating"), score=rep.get("score"), questions_used=g.state.get("questions_used", 0),
                player_names=[p["name"] for p in g.config["players"]], host_kind=g.config["host"]["kind"],
                created_at=g.created_at, finished_at=g.finished_at,
            )
        )
    return out


@router.get("/{gid}")
async def get_game(gid: str):
    return (await _runner(gid)).snapshot()


@router.delete("/{gid}", status_code=204)
async def delete_game(gid: str, db: Session = Depends(get_session)):
    await registry.drop(gid)
    g = db.get(Game, gid)
    if not g:
        raise HTTPException(404, "game not found")
    db.delete(g)
    db.commit()


@router.get("/{gid}/stream")
async def stream(gid: str, request: Request):
    r = await _runner(gid)
    q: asyncio.Queue = asyncio.Queue(maxsize=1000)
    r.subscribers.add(q)

    async def gen():
        try:
            yield {"event": "message", "data": json.dumps({"type": "snapshot", **r.snapshot()}, ensure_ascii=False)}
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                except TimeoutError:
                    yield {"event": "ping", "data": "{}"}
                    continue
                yield {"event": "message", "data": json.dumps(msg, ensure_ascii=False, default=str)}
        finally:
            r.subscribers.discard(q)

    return EventSourceResponse(gen())


@router.post("/{gid}/control")
async def control(gid: str, body: ControlIn):
    r = await _runner(gid)
    _active(r)
    if body.action == "pause":
        r.state["paused"] = True
    elif body.action == "resume":
        r.state["paused"] = False
        r.state["error"] = None
        r.start()
    elif body.action == "step":
        r.state["paused"] = True
        r.state["error"] = None
        r.step_budget += 1
        r.start()
    elif body.action == "end":
        await r.end_by_human()
        return r.public_state()
    r.wake.set()
    r.save_state()
    return r.public_state()


@router.post("/{gid}/speed")
async def speed(gid: str, body: SpeedIn):
    r = await _runner(gid)
    r.state["delay"] = body.delay
    r.wake.set()
    r.save_state()
    return r.public_state()


@router.post("/{gid}/hint")
async def spectator_hint(gid: str, body: HintIn):
    """A spectator injects a hint, or asks the AI host for one."""
    r = await _runner(gid)
    _active(r)
    if r.hints_left() <= 0:
        raise HTTPException(409, "no hints left")
    try:
        if r.human is not None:
            ev = await r.give_hint("spectator", None, body.text.strip())
        else:
            async with r.turn_lock:
                ev = await r.give_hint("spectator", None, body.text.strip())
    except LLMError as e:
        raise HTTPException(502, str(e)) from e
    return ev


def _resolve(r: GameRunner, kind: str, value: dict) -> None:
    if not r.human or r.human.kind != kind or r.human.future.done():
        raise HTTPException(409, f"not waiting for {kind}")
    r.human.future.set_result(value)


@router.post("/{gid}/player")
async def player_action(gid: str, body: PlayerActionIn):
    r = await _runner(gid)
    _active(r)
    human = next((p for p in r.players if p["kind"] == "human"), None)
    if not human:
        raise HTTPException(400, "no human player in this game")
    text = body.text.strip()
    if body.action == "say":
        if not text:
            raise HTTPException(400, "empty message")
        return await r.emit("discussion", human["id"], {"text": text[:300]})
    if body.action in ("ask", "guess") and not text:
        raise HTTPException(400, "empty text")
    if r.human and r.human.info.get("final") and body.action not in ("guess", "pass"):
        raise HTTPException(409, "final round: submit a guess")
    _resolve(r, "player", {"action": body.action, "text": text[:1200]})
    return {"ok": True}


@router.post("/{gid}/host/answer")
async def host_answer(gid: str, body: HostAnswerIn):
    r = await _runner(gid)
    _resolve(r, "host_answer", body.model_dump())
    return {"ok": True}


@router.post("/{gid}/host/judge")
async def host_judge(gid: str, body: HostJudgeIn):
    r = await _runner(gid)
    _resolve(r, "host_judge", body.model_dump())
    return {"ok": True}


@router.post("/{gid}/host/hint")
async def host_hint(gid: str, body: HostHintIn):
    r = await _runner(gid)
    _resolve(r, "host_hint", {"text": "" if body.use_ai else body.text, "skip": body.skip})
    return {"ok": True}


@router.post("/{gid}/suggest")
async def suggest(gid: str):
    """For a human host: what would the AI host answer to the pending question/guess?"""
    r = await _runner(gid)
    w = r.state.get("waiting") or {}
    try:
        if w.get("kind") == "host_answer":
            return {"kind": "answer", **(await r.ai_answer(r._event(w["seq"])))}
        if w.get("kind") == "host_judge":
            return {"kind": "judge", **(await r.ai_judge(r._event(w["seq"])))}
        if w.get("kind") == "host_hint":
            return {"kind": "hint", "text": await r.ai_hint()}
    except LLMError as e:
        raise HTTPException(502, str(e)) from e
    raise HTTPException(409, "nothing to suggest")


@router.post("/{gid}/events/{seq}/override")
async def override(gid: str, seq: int, body: OverrideIn):
    """Correct the host's verdict on a question."""
    r = await _runner(gid)
    ev = next((e for e in r.events if e["seq"] == seq and e["type"] == "answer"), None)
    if not ev:
        raise HTTPException(404, "answer not found")
    data = dict(ev["data"])
    was_counted = data["verdict"] != "invalid"
    now_counted = body.verdict != "invalid"
    data.setdefault("original_verdict", data["verdict"])
    data["verdict"] = body.verdict
    data["overridden"] = True
    if body.key is not None:
        data["key"] = body.key
    if body.note is not None:
        data["note"] = body.note[:40]
    if r.status == "active" and was_counted != now_counted:
        r.state["questions_used"] += 1 if now_counted else -1
    r.update_event(seq, data)
    r.save_state()
    return ev


@router.get("/{gid}/export")
async def export(gid: str, format: str = "md"):
    r = await _runner(gid)
    snap = r.snapshot()
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    if format == "json":
        return JSONResponse(
            json.loads(json.dumps(snap, default=str)),
            headers={"Content-Disposition": f'attachment; filename="game-{gid}-{stamp}.json"'},
        )
    return PlainTextResponse(
        game_markdown(snap),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="game-{gid}-{stamp}.md"'},
    )
