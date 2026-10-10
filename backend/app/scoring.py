"""Post-game scoring and report."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover
    from .engine import GameRunner

RATINGS = [(90, "S"), (75, "A"), (60, "B"), (40, "C"), (0, "D")]


def rating_for(score: int) -> str:
    return next(r for threshold, r in RATINGS if score >= threshold)


def compute_score(*, solved: bool, coverage: float, questions_used: int, max_questions: int,
                  hints_used: int, wrong_guesses: int) -> dict[str, Any]:
    """Transparent score: start from 100 when solved, or from coverage otherwise."""
    q_ref = max_questions if max_questions > 0 else 60
    q_ratio = min(1.0, questions_used / q_ref) if q_ref else 0.0
    if solved:
        base = 100
        q_pen = round(30 * q_ratio)
        h_pen = 8 * hints_used
        g_pen = 6 * wrong_guesses
        score = max(40, base - q_pen - h_pen - g_pen)
    else:
        base = round(60 * coverage)
        q_pen = 0
        h_pen = 5 * hints_used
        g_pen = 0
        score = max(0, base - h_pen)
    return {
        "score": score,
        "rating": rating_for(score),
        "breakdown": {"base": base, "questions": -q_pen, "hints": -h_pen, "guesses": -g_pen},
    }


def build_report(r: GameRunner, outcome: str, review: dict) -> dict[str, Any]:
    st = r.state
    events = r.events
    answers = {e["data"].get("reply_to"): e for e in events if e["type"] in ("answer", "judgement")}

    verdicts = {"yes": 0, "no": 0, "irrelevant": 0, "partial": 0, "invalid": 0}
    per: dict[str, dict[str, Any]] = {
        p["id"]: {"id": p["id"], "name": p["name"], "kind": p["kind"], "questions": 0, "key": 0, "yes": 0,
                  "discussions": 0, "guesses": 0, "points": 0}
        for p in r.players
    }
    key_questions: list[int] = []
    wrong_guesses = 0
    for e in events:
        pid = e["actor"]
        if e["type"] == "question":
            a = answers.get(e["seq"])
            if not a:
                continue
            v = a["data"]["verdict"]
            verdicts[v] = verdicts.get(v, 0) + 1
            if pid in per and v != "invalid":
                per[pid]["questions"] += 1
                per[pid]["yes"] += v == "yes"
                if a["data"].get("key"):
                    per[pid]["key"] += 1
            if a["data"].get("key"):
                key_questions.append(e["seq"])
            if pid in per:
                per[pid]["points"] += len(a["data"].get("points") or [])
        elif e["type"] == "discussion" and pid in per:
            per[pid]["discussions"] += 1
        elif e["type"] == "guess" and pid in per:
            per[pid]["guesses"] += 1
            a = answers.get(e["seq"])
            if a and not a["data"]["correct"] and not e["data"].get("final"):
                wrong_guesses += 1

    solved = outcome == "solved"
    coverage = 1.0 if solved else max(st.get("best_coverage", 0.0), r.progress())
    score = compute_score(
        solved=solved,
        coverage=coverage,
        questions_used=st["questions_used"],
        max_questions=r.rules.get("max_questions", 0),
        hints_used=st["hints_used"],
        wrong_guesses=wrong_guesses,
    )

    points = []
    for p in r.points:
        seq = st["revealed"].get(p["id"])
        by = None
        if seq is not None:
            src = next((e for e in events if e["seq"] == seq), None)
            if src and src["data"].get("reply_to"):
                by = next((e["actor"] for e in events if e["seq"] == src["data"]["reply_to"]), None)
        points.append({**p, "revealed": seq is not None or solved, "seq": seq, "by": by})

    started = st.get("started_at")
    finished = st.get("finished_at")
    duration = None
    if started and finished:
        duration = int((datetime.fromisoformat(finished) - datetime.fromisoformat(started)).total_seconds())

    turning = [int(x) for x in review.get("turning_points") or [] if str(x).isdigit()]
    valid_q = {e["seq"] for e in events if e["type"] == "question"}
    turning = [x for x in turning if x in valid_q][:4]

    return {
        "outcome": outcome,
        "solved_by": st.get("solved_by"),
        "coverage": round(coverage, 3),
        **score,
        "stats": {
            "questions": st["questions_used"],
            "hints": st["hints_used"],
            "guesses": st["guesses_used"],
            "wrong_guesses": wrong_guesses,
            "verdicts": verdicts,
            "duration": duration,
            "tokens": st.get("tokens", {}),
        },
        "points": points,
        "players": list(per.values()),
        "key_questions": key_questions,
        "review": {
            "summary": str(review.get("summary") or "")[:600],
            "turning_points": turning,
            "misdirections": str(review.get("misdirections") or "")[:300],
            "mvp": str(review.get("mvp") or "")[:40],
        },
    }
