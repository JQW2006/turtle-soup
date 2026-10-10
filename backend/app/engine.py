"""Game engine: one asyncio task per running game drives the turn loop.

Every observable thing that happens in a game is an Event persisted to the
database and broadcast to subscribers (SSE). The mutable game state lives in
``Game.state`` and is saved after each change, so a game can be resumed after
a server restart.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import UTC, datetime
from typing import Any

from . import prompts as P
from .db import session_scope
from .llm import LLMError, get_llm
from .models import Event, Game, now
from .scoring import build_report

log = logging.getLogger(__name__)

VERDICTS = {"yes", "no", "irrelevant", "partial", "invalid"}
NOTES = {"close", "premise", "repeat", "unimportant", "rephrase"}
PLAYER_COLORS = ["#2563eb", "#d97706", "#059669", "#db2777"]


def initial_state(delay: float, paused: bool) -> dict[str, Any]:
    return {
        "paused": paused,
        "delay": delay,
        "phase": "playing",  # playing | final | finished
        "turn": 0,
        "questions_used": 0,
        "guesses_used": 0,
        "hints_used": 0,
        "stale": 0,
        "revealed": {},  # point id -> event seq that established it
        "best_coverage": 0.0,
        "final_done": [],
        "pending": None,  # unresolved host action, survives restarts
        "waiting": None,  # human input the engine is blocked on
        "solved_by": None,
        "notes": {},  # player id -> last private analysis
        "tokens": {"prompt": 0, "completion": 0, "calls": 0},
        "actions": 0,
        "started_at": datetime.now(UTC).isoformat(),
        "error": None,
        "report": None,
    }


def _clip(s: Any, n: int) -> str:
    s = str(s or "").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


class HumanInput:
    """A future the engine awaits while a human acts."""

    def __init__(self, kind: str, **info: Any) -> None:
        self.kind = kind
        self.info = info
        self.future: asyncio.Future = asyncio.get_running_loop().create_future()


class GameRunner:
    def __init__(self, game: Game, events: list[Event]) -> None:
        self.id = game.id
        self.puzzle_id = game.puzzle_id
        self.puzzle: dict = dict(game.puzzle)
        self.config: dict = dict(game.config)
        self.state: dict = dict(game.state)
        self.status = game.status
        self.events: list[dict] = [self._event_dict(e) for e in events]
        self.lang: str = self.config.get("language", "zh")
        self.players: list[dict] = self.config["players"]
        self.rules: dict = self.config["rules"]
        self.subscribers: set[asyncio.Queue] = set()
        self.task: asyncio.Task | None = None
        self.wake = asyncio.Event()
        self.step_budget = 0
        self.human: HumanInput | None = None
        self.activity: dict | None = None
        self._emit_lock = asyncio.Lock()
        self.turn_lock = asyncio.Lock()

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _event_dict(e: Event) -> dict:
        return {
            "seq": e.seq,
            "type": e.type,
            "actor": e.actor,
            "data": e.data,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }

    @property
    def points(self) -> list[dict]:
        return self.puzzle.get("points") or []

    def player(self, pid: str) -> dict | None:
        return next((p for p in self.players if p["id"] == pid), None)

    def name_of(self, actor: str) -> str:
        if actor == "host":
            return "主持人" if self.lang == "zh" else "Host"
        if actor == "human":
            return "观众" if self.lang == "zh" else "Spectator"
        p = self.player(actor)
        return p["name"] if p else actor

    def left(self, used_key: str, limit_key: str) -> int | None:
        limit = self.rules.get(limit_key, 0)
        if limit <= 0:
            return None
        return max(0, limit - self.state[used_key])

    def hints_left(self) -> int:
        return max(0, self.rules.get("max_hints", 0) - self.state["hints_used"])

    def public_state(self) -> dict:
        return {
            **self.state,
            "status": self.status,
            "running": bool(self.task and not self.task.done()),
            "activity": self.activity,
            "questions_left": self.left("questions_used", "max_questions"),
            "guesses_left": self.left("guesses_used", "max_guesses"),
            "hints_left": self.hints_left(),
            "progress": self.progress(),
        }

    def progress(self) -> float:
        total = sum(p.get("weight", 1) for p in self.points)
        if not total:
            return 0.0
        got = sum(p.get("weight", 1) for p in self.points if p["id"] in self.state["revealed"])
        return round(got / total, 3)

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "puzzle_id": self.puzzle_id,
            "puzzle": self.puzzle,
            "config": self.config,
            "state": self.public_state(),
            "events": self.events,
        }

    # ------------------------------------------------------------------ persistence & broadcast

    def _broadcast(self, msg: dict) -> None:
        for q in list(self.subscribers):
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(msg)

    def save_state(self, **game_fields: Any) -> None:
        with session_scope() as db:
            g = db.get(Game, self.id)
            if g is None:
                return
            g.state = dict(self.state)
            g.puzzle = dict(self.puzzle)
            for k, v in game_fields.items():
                setattr(g, k, v)
        self._broadcast({"type": "state", "state": self.public_state()})

    async def emit(self, type_: str, actor: str, data: dict) -> dict:
        async with self._emit_lock:
            seq = (self.events[-1]["seq"] + 1) if self.events else 1
            with session_scope() as db:
                ev = Event(game_id=self.id, seq=seq, type=type_, actor=actor, data=data, created_at=now())
                db.add(ev)
                db.flush()
                d = self._event_dict(ev)
            self.events.append(d)
            self._broadcast({"type": "event", "event": d})
            return d

    def update_event(self, seq: int, data: dict) -> dict:
        ev = next(e for e in self.events if e["seq"] == seq)
        ev["data"] = data
        with session_scope() as db:
            row = db.query(Event).filter_by(game_id=self.id, seq=seq).one()
            row.data = data
        self._broadcast({"type": "event_update", "event": ev})
        return ev

    def set_activity(self, actor: str | None, kind: str = "") -> None:
        self.activity = {"actor": actor, "kind": kind} if actor else None
        self._broadcast({"type": "activity", "activity": self.activity})

    def _track(self, usage: dict) -> None:
        t = self.state["tokens"]
        t["prompt"] += usage.get("prompt", 0)
        t["completion"] += usage.get("completion", 0)
        t["calls"] += 1

    async def _llm(self, system: str, user: str, effort: str, max_tokens: int = 16384, temperature: float = 0.7):
        res = await get_llm().json(system, user, effort=effort, max_tokens=max_tokens, temperature=temperature)
        self._track(res.usage)
        return res

    # ------------------------------------------------------------------ transcript

    def transcript(self, upto: int | None = None) -> str:
        zh = self.lang == "zh"
        labels = P.VERDICT_LABEL[self.lang]
        answers = {e["data"].get("reply_to"): e for e in self.events if e["type"] in ("answer", "judgement")}
        lines: list[str] = []
        for e in self.events:
            if upto is not None and e["seq"] >= upto:
                break
            t, d, who = e["type"], e["data"], self.name_of(e["actor"])
            if t == "question":
                a = answers.get(e["seq"])
                if not a:
                    continue
                ad = a["data"]
                tail = labels[ad["verdict"]]
                if ad.get("key"):
                    tail += "（关键）" if zh else " (key)"
                if ad.get("note"):
                    tail += f" — {P.NOTE_LABEL[self.lang].get(ad['note'], ad['note'])}"
                lines.append(f"#{e['seq']} {who}{'问' if zh else ' asks'}: {d['text']} → {tail}")
            elif t == "discussion":
                lines.append(f"#{e['seq']} {who}{'说' if zh else ' says'}: {d['text']}")
            elif t == "guess":
                a = answers.get(e["seq"])
                if not a:
                    continue
                ok = a["data"]["correct"]
                verdict = ("正确" if ok else "不正确") if zh else ("Correct" if ok else "Incorrect")
                fb = a["data"].get("feedback", "")
                lines.append(f"#{e['seq']} {who}{'猜测' if zh else ' guesses'}: {d['text']} → {verdict}. {fb}")
            elif t == "hint":
                lines.append(f"#{e['seq']} {'提示' if zh else 'Hint'}: {d['text']}")
        if not lines:
            return "（还没有任何提问）" if zh else "(no questions yet)"
        return "\n".join(lines)

    def host_system(self) -> str:
        none = "（无）" if self.lang == "zh" else "(none)"
        return P.HOST_SYSTEM[self.lang].format(
            surface=self.puzzle["surface"],
            bottom=self.puzzle["bottom"],
            host_notes=self.puzzle.get("host_notes") or none,
            points=P.points_block(self.points, self.lang),
            extra_rules=self.rules.get("extra_rules") or none,
        )

    def player_system(self, p: dict) -> str:
        others = [o["name"] for o in self.players if o["id"] != p["id"]]
        zh = self.lang == "zh"
        extra = self.rules.get("extra_rules", "").strip()
        extra_line = (f"- 本局附加规则：{extra}\n" if zh else f"- Extra rules for this game: {extra}\n") if extra else ""
        return P.PLAYER_SYSTEM[self.lang].format(
            n_players=len(self.players),
            name=p["name"],
            persona=P.persona_text(p.get("persona", "logic"), p.get("custom_persona", ""), self.lang),
            teammates="、".join(others) if zh and others else (", ".join(others) if others else ("无" if zh else "none")),
            extra_rules=extra_line,
            surface=self.puzzle["surface"],
        )

    # ------------------------------------------------------------------ lifecycle

    def start(self) -> None:
        if self.status != "active" or (self.task and not self.task.done()):
            return
        self.task = asyncio.create_task(self._run(), name=f"game-{self.id}")

    async def stop(self) -> None:
        if self.task and not self.task.done():
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.task
        if self.human and not self.human.future.done():
            self.human.future.cancel()
        self.human = None

    async def _run(self) -> None:
        try:
            if not self.points:
                await self._prepare_points()
            if not self.events:
                await self._opening()
            while self.state["phase"] != "finished":
                await self._gate()
                async with self.turn_lock:
                    await self._resolve_pending()
                    if self.state["phase"] == "finished":
                        break
                    await self._turn()
                    self.state["actions"] += 1
                    self.state["error"] = None
                    self.save_state()
                    if self.state["actions"] > self._action_cap():
                        await self._finish("failed")
                        break
                if self.state["phase"] != "finished":
                    await self._sleep()
        except asyncio.CancelledError:
            raise
        except LLMError as e:
            await self._fail(str(e))
        except Exception as e:  # pragma: no cover - defensive
            log.exception("game %s crashed", self.id)
            await self._fail(f"{type(e).__name__}: {e}")
        finally:
            self.set_activity(None)

    async def _fail(self, message: str) -> None:
        self.state["paused"] = True
        self.state["error"] = message
        self.state["waiting"] = None
        self.human = None
        await self.emit("error", "system", {"message": message})
        self.save_state()

    def _action_cap(self) -> int:
        mq = self.rules.get("max_questions") or 200
        return mq * 3 + 60

    async def _gate(self) -> None:
        while self.state["paused"] and self.step_budget <= 0:
            self.wake.clear()
            await self.wake.wait()
        if self.state["paused"]:
            self.step_budget -= 1

    async def _sleep(self) -> None:
        delay = float(self.state.get("delay", 0))
        if delay <= 0 or self.state["paused"]:
            return
        self.wake.clear()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self.wake.wait(), timeout=delay)

    async def wait_human(self, kind: str, **info: Any) -> Any:
        self.human = HumanInput(kind, **info)
        self.state["waiting"] = {"kind": kind, **info}
        self.set_activity(None)
        self.save_state()
        try:
            return await self.human.future
        finally:
            self.human = None
            self.state["waiting"] = None
            self.save_state()

    # ------------------------------------------------------------------ setup

    async def _prepare_points(self) -> None:
        self.set_activity("host", "preparing")
        pts = await generate_points(self.puzzle, self.lang, self.config["host"].get("effort", "high"), self._track)
        self.puzzle["points"] = pts
        self.save_state()
        self._broadcast({"type": "puzzle", "puzzle": self.puzzle})

    async def _opening(self) -> None:
        r = self.rules
        await self.emit(
            "opening",
            "host",
            {
                "surface": self.puzzle["surface"],
                "max_questions": r.get("max_questions", 0),
                "max_guesses": r.get("max_guesses", 0),
                "max_hints": r.get("max_hints", 0),
                "extra_rules": r.get("extra_rules", ""),
            },
        )

    # ------------------------------------------------------------------ turns

    def _current_player(self) -> dict:
        if self.state["phase"] == "final":
            for p in self.players:
                if p["id"] not in self.state["final_done"]:
                    return p
        return self.players[self.state["turn"] % len(self.players)]

    async def _turn(self) -> None:
        p = self._current_player()
        final = self.state["phase"] == "final"
        if p["kind"] == "human":
            act = await self.wait_human("player", actor=p["id"], final=final)
            action, text = act["action"], act.get("text", "").strip()
        else:
            action, text = await self._ai_player(p, final)

        if final:
            action = "guess"
        if action == "ask" and text:
            q = await self.emit("question", p["id"], {"text": text, "analysis": self.state["notes"].get(p["id"], "")})
            self.state["pending"] = {"kind": "answer", "seq": q["seq"], "actor": p["id"]}
        elif action == "guess" and text:
            g = await self.emit("guess", p["id"], {"text": text, "final": final})
            self.state["pending"] = {"kind": "judge", "seq": g["seq"], "actor": p["id"], "final": final}
        elif action == "hint":
            if self.rules.get("allow_hint_requests", True) and self.hints_left() > 0:
                self.state["pending"] = {"kind": "hint", "source": "requested", "actor": p["id"]}
            else:
                await self.emit("system", "system", {"code": "no_hints", "actor": p["id"]})
                self._advance()
        else:
            await self.emit("system", "system", {"code": "pass", "actor": p["id"]})
            if final:
                self.state["final_done"].append(p["id"])
                await self._check_final_end()
            else:
                self._advance()
        self.save_state()
        await self._resolve_pending()

    def _advance(self) -> None:
        if self.state["phase"] == "playing":
            self.state["turn"] = (self.state["turn"] + 1) % len(self.players)

    async def _ai_player(self, p: dict, final: bool) -> tuple[str, str]:
        zh = self.lang == "zh"
        unl = "不限" if zh else "unlimited"
        q_left, g_left = self.left("questions_used", "max_questions"), self.left("guesses_used", "max_guesses")
        h_left = self.hints_left() if self.rules.get("allow_hint_requests", True) else 0
        note = self.state["notes"].get(p["id"])
        own = (f"你上一轮的思路：{note}" if zh else f"Your notes from last turn: {note}") if note else ""
        user = P.PLAYER_TURN[self.lang].format(
            transcript=self.transcript(),
            q_left=unl if q_left is None else q_left,
            g_left=unl if g_left is None else g_left,
            h_left=h_left,
            own_notes=own,
            final_note=P.FINAL_NOTE[self.lang] if final else "",
            name=p["name"],
        )
        self.set_activity(p["id"], "thinking")
        res = await self._llm(self.player_system(p), user, p.get("effort", "low"), temperature=0.9)
        self.set_activity(None)
        d = res.data
        analysis = _clip(d.get("analysis"), 600)
        self.state["notes"][p["id"]] = analysis
        say = _clip(d.get("say"), 120)
        action = str(d.get("action", "ask")).strip().lower()
        content = _clip(d.get("content"), 1200)
        if action not in ("ask", "guess", "hint"):
            action = "ask"
        if action in ("ask", "guess") and not content:
            action = "hint" if action == "ask" else "ask"
        if say and self.rules.get("allow_discussion", True) and not final:
            await self.emit("discussion", p["id"], {"text": say})
        if action == "guess" and self.left("guesses_used", "max_guesses") == 0 and not final:
            action = "ask"
        return action, content

    # ------------------------------------------------------------------ host side

    async def _resolve_pending(self) -> None:
        pend = self.state.get("pending")
        if not pend:
            return
        if pend["kind"] == "answer":
            await self._answer(pend)
        elif pend["kind"] == "judge":
            await self._judge(pend)
        elif pend["kind"] == "hint":
            await self.give_hint(pend.get("source", "requested"), pend.get("actor"))
            self.state["pending"] = None
            if pend.get("source") == "requested":
                self._advance()
        self.save_state()

    def _event(self, seq: int) -> dict:
        return next(e for e in self.events if e["seq"] == seq)

    async def ai_answer(self, q: dict) -> dict:
        confirmed = ", ".join(k for k in self.state["revealed"]) or ("（无）" if self.lang == "zh" else "(none)")
        user = P.HOST_ANSWER[self.lang].format(
            transcript=self.transcript(upto=q["seq"]), confirmed=confirmed,
            player=self.name_of(q["actor"]), question=q["data"]["text"],
        )
        res = await self._llm(self.host_system(), user, self.config["host"].get("effort", "high"), temperature=0.2)
        d = res.data
        verdict = str(d.get("verdict", "")).strip().lower()
        if verdict not in VERDICTS:
            verdict = "irrelevant"
        ids = {p["id"] for p in self.points}
        return {
            "verdict": verdict,
            "note": note if (note := str(d.get("note") or "").strip().lower()) in NOTES else "",
            "key": bool(d.get("key")) and verdict != "invalid",
            "points": [x for x in d.get("points") or [] if x in ids] if verdict != "invalid" else [],
            "analysis": _clip(d.get("analysis"), 600),
        }

    async def _answer(self, pend: dict) -> None:
        q = self._event(pend["seq"])
        if self.config["host"]["kind"] == "human":
            r = await self.wait_human("host_answer", seq=q["seq"], actor=q["actor"])
            out = {"verdict": r["verdict"], "note": _clip(r.get("note"), 40), "key": r.get("key", False),
                   "points": r.get("points", []), "analysis": ""}
        else:
            self.set_activity("host", "answering")
            out = await self.ai_answer(q)
            self.set_activity(None)
        new_pts = [x for x in out["points"] if x not in self.state["revealed"]]
        counted = out["verdict"] != "invalid"
        if counted:
            self.state["questions_used"] += 1
        qnum = self.state["questions_used"] if counted else None
        a = await self.emit("answer", "host", {**out, "points": new_pts, "reply_to": q["seq"], "qnum": qnum})
        for x in new_pts:
            self.state["revealed"][x] = a["seq"]
        if counted:
            self.state["stale"] = 0 if new_pts else self.state["stale"] + 1
        self.state["pending"] = None
        self._advance()
        self.save_state()
        await self._after_answer()

    async def _after_answer(self) -> None:
        mq = self.rules.get("max_questions", 0)
        if mq and self.state["questions_used"] >= mq and self.state["phase"] == "playing":
            if self.rules.get("final_round", True):
                self.state["phase"] = "final"
                await self.emit("system", "system", {"code": "final_round"})
            else:
                await self._finish("failed")
            return
        n = self.rules.get("auto_hint_after", 0)
        if n and self.state["stale"] >= n and self.hints_left() > 0 and self.state["phase"] == "playing":
            await self.give_hint("auto")

    async def ai_judge(self, g: dict) -> dict:
        user = P.HOST_JUDGE[self.lang].format(
            transcript=self.transcript(upto=g["seq"]), player=self.name_of(g["actor"]), guess=g["data"]["text"]
        )
        res = await self._llm(self.host_system(), user, self.config["host"].get("effort", "high"), temperature=0.2)
        d = res.data
        ids = {p["id"] for p in self.points}
        matched = [x for x in d.get("matched") or [] if x in ids]
        core = {p["id"] for p in self.points if p.get("core", True)}
        correct = bool(d.get("correct")) or (bool(core) and core <= set(matched))
        return {"correct": correct, "matched": matched, "feedback": _clip(d.get("feedback"), 200),
                "analysis": _clip(d.get("analysis"), 600)}

    def coverage(self, matched: list[str]) -> float:
        total = sum(p.get("weight", 1) for p in self.points) or 1
        return round(sum(p.get("weight", 1) for p in self.points if p["id"] in matched) / total, 3)

    async def _judge(self, pend: dict) -> None:
        g = self._event(pend["seq"])
        final = pend.get("final", False)
        if self.config["host"]["kind"] == "human":
            r = await self.wait_human("host_judge", seq=g["seq"], actor=g["actor"])
            out = {"correct": r["correct"], "matched": r.get("matched", []),
                   "feedback": _clip(r.get("feedback"), 200), "analysis": ""}
        else:
            self.set_activity("host", "judging")
            out = await self.ai_judge(g)
            self.set_activity(None)
        cov = 1.0 if out["correct"] else self.coverage(out["matched"])
        j = await self.emit("judgement", "host", {**out, "coverage": cov, "reply_to": g["seq"], "final": final})
        for x in out["matched"]:
            self.state["revealed"].setdefault(x, j["seq"])
        self.state["best_coverage"] = max(self.state["best_coverage"], cov)
        self.state["pending"] = None
        if out["correct"]:
            self.state["solved_by"] = g["actor"]
            await self._finish("solved")
            return
        if final:
            self.state["final_done"].append(g["actor"])
            await self._check_final_end()
            return
        self.state["guesses_used"] += 1
        self._advance()
        mg = self.rules.get("max_guesses", 0)
        if mg and self.state["guesses_used"] >= mg:
            await self.emit("system", "system", {"code": "guesses_exhausted"})
            await self._finish("failed")

    async def _check_final_end(self) -> None:
        if all(p["id"] in self.state["final_done"] for p in self.players):
            await self._finish("failed")

    async def ai_hint(self) -> str:
        unrevealed = [p for p in self.points if p["id"] not in self.state["revealed"]]
        user = P.HOST_HINT[self.lang].format(
            transcript=self.transcript(),
            unrevealed=P.points_block(unrevealed, self.lang),
            n=self.state["hints_used"] + 1,
            total=self.rules.get("max_hints", 0) or 1,
        )
        res = await self._llm(self.host_system(), user, self.config["host"].get("effort", "high"), temperature=0.5)
        return _clip(res.data.get("hint"), 200)

    async def give_hint(self, source: str, requested_by: str | None = None, text: str = "") -> dict | None:
        """source: auto | requested | spectator."""
        if self.hints_left() <= 0:
            await self.emit("system", "system", {"code": "no_hints", "actor": requested_by})
            return None
        if not text:
            if self.config["host"]["kind"] == "human" and source != "spectator":
                r = await self.wait_human("host_hint", source=source, actor=requested_by)
                if r.get("skip"):
                    await self.emit("system", "system", {"code": "hint_declined", "actor": requested_by})
                    if source == "auto":
                        self.state["stale"] = 0
                    return None
                text = (r.get("text") or "").strip()
            if not text:
                self.set_activity("host", "hinting")
                text = await self.ai_hint()
                self.set_activity(None)
        self.state["hints_used"] += 1
        self.state["stale"] = 0
        ev = await self.emit(
            "hint", "host", {"text": text, "source": source, "requested_by": requested_by, "n": self.state["hints_used"]}
        )
        self.save_state()
        return ev

    # ------------------------------------------------------------------ finish

    async def _finish(self, outcome: str) -> None:
        if self.state["phase"] == "finished":
            return
        self.state["phase"] = "finished"
        self.state["pending"] = None
        self.state["waiting"] = None
        self.state["finished_at"] = datetime.now(UTC).isoformat()
        review: dict = {}
        if self.config["host"]["kind"] == "ai" or any(p["kind"] == "ai" for p in self.players):
            self.set_activity("host", "reviewing")
            try:
                user = P.HOST_REVIEW[self.lang].format(outcome=P.OUTCOME_TEXT[self.lang][outcome], transcript=self.transcript())
                res = await self._llm(self.host_system(), user, "low", temperature=0.6)
                review = res.data
            except LLMError as e:
                log.warning("review generation failed: %s", e)
            self.set_activity(None)
        report = build_report(self, outcome, review)
        self.state["report"] = report
        await self.emit("reveal", "host", {"outcome": outcome, "bottom": self.puzzle["bottom"]})
        self.status = "finished"
        self.save_state(status="finished", outcome=outcome, finished_at=now())

    async def end_by_human(self) -> None:
        """Spectator gives up / reveals the answer."""
        if self.status != "active":
            return
        await self.stop()
        await self._finish("revealed")


# ---------------------------------------------------------------------------- registry


class Registry:
    def __init__(self) -> None:
        self.runners: dict[str, GameRunner] = {}
        self._lock = asyncio.Lock()

    async def get(self, game_id: str) -> GameRunner | None:
        async with self._lock:
            r = self.runners.get(game_id)
            if r:
                return r
            with session_scope() as db:
                g = db.get(Game, game_id)
                if not g:
                    return None
                events = db.query(Event).filter_by(game_id=game_id).order_by(Event.seq).all()
                r = GameRunner(g, events)
            self.runners[game_id] = r
            r.start()
            return r

    async def drop(self, game_id: str) -> None:
        r = self.runners.pop(game_id, None)
        if r:
            await r.stop()

    async def shutdown(self) -> None:
        for r in list(self.runners.values()):
            await r.stop()
        self.runners.clear()


registry = Registry()


def pause_all_active() -> None:
    """On startup, park games that were running when the server stopped."""
    with session_scope() as db:
        for g in db.query(Game).filter_by(status="active"):
            st = dict(g.state)
            st["paused"] = True
            st["waiting"] = None
            g.state = st


# ---------------------------------------------------------------------------- authoring helpers


async def generate_points(puzzle: dict, lang: str, effort: str = "high", track=None) -> list[dict]:
    none = "（无）" if lang == "zh" else "(none)"
    user = P.ANALYZE_POINTS[lang].format(
        surface=puzzle.get("surface") or none, bottom=puzzle["bottom"], host_notes=puzzle.get("host_notes") or none
    )
    res = await get_llm().json("You output strict JSON.", user, effort=effort, temperature=0.3)
    if track:
        track(res.usage)
    out = []
    for i, p in enumerate(res.data.get("points") or [], 1):
        text = _clip(p.get("text") if isinstance(p, dict) else p, 120)
        if not text:
            continue
        weight = p.get("weight", 2) if isinstance(p, dict) else 2
        try:
            weight = min(5, max(1, int(weight)))
        except (TypeError, ValueError):
            weight = 2
        core = bool(p.get("core", True)) if isinstance(p, dict) else True
        out.append({"id": f"k{i}", "text": text, "core": core, "weight": weight})
    if not out:
        out = [{"id": "k1", "text": _clip(puzzle["bottom"], 120), "core": True, "weight": 5}]
    return out


async def review_puzzle(puzzle: dict, lang: str) -> dict:
    none = "（无）" if lang == "zh" else "(none)"
    user = P.REVIEW_PUZZLE[lang].format(
        surface=puzzle.get("surface") or none, bottom=puzzle["bottom"], host_notes=puzzle.get("host_notes") or none
    )
    res = await get_llm().json("You output strict JSON.", user, effort="high", temperature=0.3)
    d = res.data
    issues = []
    for it in d.get("issues") or []:
        if isinstance(it, dict) and it.get("text"):
            lvl = it.get("level") if it.get("level") in ("error", "warn", "info") else "info"
            issues.append({"level": lvl, "text": _clip(it["text"], 300)})
    try:
        diff = min(5, max(1, int(d.get("difficulty", 3))))
    except (TypeError, ValueError):
        diff = 3
    return {
        "verdict": _clip(d.get("verdict"), 200),
        "issues": issues,
        "difficulty": diff,
        "color": d.get("color") if d.get("color") in ("clear", "red") else "clear",
        "genre": d.get("genre") if d.get("genre") in ("honkaku", "henkaku") else "honkaku",
        "title": _clip(d.get("title"), 40),
    }
