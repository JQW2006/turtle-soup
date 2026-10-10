import asyncio

from app.engine import registry
from app.scoring import compute_score, rating_for

PLAYERS = [{"name": "A", "kind": "ai"}, {"name": "B", "kind": "ai", "persona": "intuition"}]


async def _puzzle(client, **kw) -> str:
    body = {"title": "T", "surface": "S", "bottom": "B", "language": "zh", **kw}
    r = await client.post("/api/puzzles", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _wait(cond, timeout=5.0):
    for _ in range(int(timeout / 0.02)):
        if cond():
            return
        await asyncio.sleep(0.02)
    raise AssertionError("timeout")


async def _create(client, **kw) -> tuple[str, object]:
    pid = await _puzzle(client)
    body = {"puzzle_id": pid, "players": PLAYERS, "delay": 0, **kw}
    r = await client.post("/api/games", json=body)
    assert r.status_code == 201, r.text
    gid = r.json()["id"]
    return gid, await registry.get(gid)


async def test_full_game_solved(client, fake_llm):
    gid, runner = await _create(client)
    await _wait(lambda: runner.status == "finished")
    types = [e["type"] for e in runner.events]
    assert types[0] == "opening"
    assert types.count("question") == 2 and types.count("answer") == 2
    assert types[-1] == "reveal"
    rep = runner.state["report"]
    assert rep["outcome"] == "solved" and rep["solved_by"] == "p1"
    assert runner.puzzle["points"][0]["id"] == "k1"  # generated at game start
    assert rep["stats"]["questions"] == 2
    assert rep["review"]["summary"] == "good game"

    r = await client.get(f"/api/games/{gid}/export?format=md")
    assert r.status_code == 200 and "# T" in r.text
    games = (await client.get("/api/games")).json()
    assert games[0]["id"] == gid and games[0]["rating"]


async def test_guess_limit_fails(client, fake_llm):
    fake_llm.correct = False
    fake_llm.asks_before_guess = 0
    gid, runner = await _create(client, rules={"max_guesses": 2})
    await _wait(lambda: runner.status == "finished")
    assert runner.state["report"]["outcome"] == "failed"
    assert runner.state["guesses_used"] == 2


async def test_question_limit_final_round(client, fake_llm):
    fake_llm.asks_before_guess = 100
    fake_llm.correct = False
    gid, runner = await _create(client, rules={"max_questions": 3, "final_round": True})
    await _wait(lambda: runner.status == "finished")
    assert runner.state["questions_used"] == 3
    finals = [e for e in runner.events if e["type"] == "guess" and e["data"]["final"]]
    assert len(finals) == 2
    assert any(e["type"] == "system" and e["data"]["code"] == "final_round" for e in runner.events)


async def test_invalid_questions_do_not_count_and_auto_hint(client, fake_llm):
    fake_llm.verdict = "irrelevant"
    fake_llm.asks_before_guess = 4
    gid, runner = await _create(client, rules={"auto_hint_after": 2, "max_hints": 1})
    await _wait(lambda: runner.status == "finished")
    hints = [e for e in runner.events if e["type"] == "hint"]
    # first answer reveals k1 (fake host always claims k1), later answers are stale
    assert len(hints) == 1 and hints[0]["data"]["source"] == "auto"


async def test_pause_step_and_human_player(client, fake_llm):
    players = [{"name": "Me", "kind": "human"}, {"name": "Bot", "kind": "ai"}]
    pid = await _puzzle(client)
    r = await client.post("/api/games", json={"puzzle_id": pid, "players": players, "delay": 0, "start_paused": True})
    gid = r.json()["id"]
    runner = await registry.get(gid)
    await asyncio.sleep(0.1)
    assert [e["type"] for e in runner.events] == ["opening"]  # paused right after the opening

    await client.post(f"/api/games/{gid}/control", json={"action": "step"})
    await _wait(lambda: (runner.state.get("waiting") or {}).get("kind") == "player")

    r = await client.post(f"/api/games/{gid}/player", json={"action": "say", "text": "hello team"})
    assert r.status_code == 200
    r = await client.post(f"/api/games/{gid}/player", json={"action": "ask", "text": "Is it a fish?"})
    assert r.status_code == 200
    await _wait(lambda: any(e["type"] == "answer" for e in runner.events))
    await asyncio.sleep(0.1)
    # still paused: the AI player must not have acted yet
    assert not any(e["type"] == "question" and e["actor"] == "p2" for e in runner.events)

    await client.post(f"/api/games/{gid}/control", json={"action": "end"})
    assert runner.status == "finished"
    assert runner.state["report"]["outcome"] == "revealed"


async def test_human_host(client, fake_llm):
    fake_llm.asks_before_guess = 1
    gid, runner = await _create(client, host={"kind": "human"})
    await _wait(lambda: (runner.state.get("waiting") or {}).get("kind") == "host_answer")
    r = await client.post(f"/api/games/{gid}/suggest")
    assert r.json()["verdict"] == "yes"
    await client.post(f"/api/games/{gid}/host/answer", json={"verdict": "no", "key": True, "points": []})
    await _wait(lambda: (runner.state.get("waiting") or {}).get("kind") == "host_judge")
    await client.post(f"/api/games/{gid}/host/judge", json={"correct": True, "matched": ["k1"], "feedback": "yes!"})
    await _wait(lambda: runner.status == "finished")
    assert runner.state["report"]["outcome"] == "solved"


async def test_override_and_spectator_hint(client, fake_llm):
    fake_llm.asks_before_guess = 100
    gid, runner = await _create(client, start_paused=True)
    await client.post(f"/api/games/{gid}/control", json={"action": "step"})
    await _wait(lambda: any(e["type"] == "answer" for e in runner.events))
    await asyncio.sleep(0.05)
    ans = next(e for e in runner.events if e["type"] == "answer")
    assert runner.state["questions_used"] == 1
    r = await client.post(f"/api/games/{gid}/events/{ans['seq']}/override", json={"verdict": "invalid"})
    assert r.status_code == 200
    assert runner.state["questions_used"] == 0
    assert ans["data"]["original_verdict"] == "yes"

    r = await client.post(f"/api/games/{gid}/hint", json={"text": "look closer"})
    assert r.status_code == 200 and r.json()["data"]["source"] == "spectator"
    assert runner.state["hints_used"] == 1
    r = await client.post(f"/api/games/{gid}/hint", json={})
    assert r.json()["data"]["text"] == "think about the sea"
    await client.post(f"/api/games/{gid}/control", json={"action": "end"})


async def test_stream_snapshot(client, fake_llm):
    gid, runner = await _create(client)
    await _wait(lambda: runner.status == "finished")
    snap = runner.snapshot()
    assert snap["state"]["status"] == "finished" and snap["events"]


def test_scoring():
    s = compute_score(solved=True, coverage=1, questions_used=30, max_questions=60, hints_used=1, wrong_guesses=1)
    assert s["score"] == 100 - 15 - 8 - 6 and s["rating"] == "B"
    s = compute_score(solved=False, coverage=0.5, questions_used=60, max_questions=60, hints_used=2, wrong_guesses=0)
    assert s["score"] == 20 and s["rating"] == "D"
    assert rating_for(95) == "S"
