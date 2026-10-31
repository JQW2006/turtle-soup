"""Model profiles + character library: resolution, CRUD, builtin protection, game integration."""

import json

from app import llm as llm_mod
from app.db import session_scope
from app.models import Setting


async def _put_profiles(client, profiles, default=""):
    body = {"profiles": profiles}
    if default:
        body["default_profile"] = default
    return await client.put("/api/settings", json=body)


async def _mk_puzzle(client) -> str:
    r = await client.post("/api/puzzles", json={"title": "T", "surface": "s", "bottom": "b",
                                                "points": [{"id": "k1", "text": "A", "core": True}]})
    return r.json()["id"]


async def _run_until_ask(client, gid, tries: int = 40) -> dict:
    import asyncio

    for _ in range(tries):
        snap = (await client.get(f"/api/games/{gid}")).json()
        if any(e["type"] == "answer" for e in snap["events"]):
            return snap
        await asyncio.sleep(0.05)
    raise AssertionError("timeout waiting for first answer")


# --------------------------------------------------------------------------- profiles


async def test_profiles_legacy_fallback(client):
    from app.config import get_settings

    s = get_settings()
    old = s.model_profiles
    s.model_profiles = ""
    try:
        out = (await client.get("/api/settings")).json()
        assert out["profiles_source"] == "legacy"
        assert out["default_profile"] == "default"
        assert len(out["profiles"]) == 1 and out["profiles"][0]["api_key_set"]
        assert out["profiles"][0]["api_key"] == ""  # never echoed back
        profiles, default = llm_mod.resolve_profiles()
        assert default == "default" and profiles[0].api_key == "test-key"
    finally:
        s.model_profiles = old


async def test_profiles_from_env(client):
    from app.config import get_settings

    s = get_settings()
    s.model_profiles = json.dumps([
        {"id": "a", "api_key": "k1", "base_url": "https://x", "model": "m-a"},
        {"id": "b", "api_key": "k2", "base_url": "https://y", "model": "m-b"},
    ])
    s.default_model = "b"
    try:
        out = (await client.get("/api/settings")).json()
        assert out["profiles_source"] == "env" and out["default_profile"] == "b"
        assert [p["id"] for p in out["profiles"]] == ["a", "b"]
        p = llm_mod.get_profile("a")
        assert p.model == "m-a" and p.label == "m-a"  # label falls back to model
        assert llm_mod.get_profile().id == "b"  # default
    finally:
        s.model_profiles = ""
        s.default_model = ""


async def test_profiles_db_replaces_env_and_keeps_keys(client):
    from app.config import get_settings

    s = get_settings()
    s.model_profiles = json.dumps([{"id": "env-only", "api_key": "e", "model": "m"}])
    try:
        # save via API; empty api_key on id "a" inherits the key stored for "a" (here: none, stays empty)
        r = await _put_profiles(client, [
            {"id": "a", "api_key": "ka", "base_url": "https://a", "model": "ma", "label": "A"},
            {"id": "b", "api_key": "", "base_url": "https://b", "model": "mb", "label": "B"},
        ], default="a")
        assert r.status_code == 200
        out = r.json()
        assert out["profiles_source"] == "db" and out["default_profile"] == "a"
        # b had no previous key -> empty key rejected at call time but list still fine
        assert out["profiles"][1]["api_key_set"] is False

        # resend with empty keys: existing keys must survive
        r = await _put_profiles(client, [
            {"id": "a", "api_key": "", "base_url": "https://a", "model": "ma2"},
        ], default="a")
        assert llm_mod.get_profile("a").api_key == "ka"
        assert llm_mod.get_profile("a").model == "ma2"
        assert llm_mod.get_profile().id == "a"

        # validation: duplicate ids / bad default; an empty list clears the override (see below)
        assert (await _put_profiles(client, [
            {"id": "x", "api_key": "k", "model": "m"}, {"id": "x", "api_key": "k", "model": "m"},
        ])).status_code == 400
        assert (await _put_profiles(client, [{"id": "x", "api_key": "k", "model": "m"}], default="nope")).status_code == 400
    finally:
        s.model_profiles = ""
        s.default_model = ""
        with session_scope() as db:
            for k in ("model_profiles", "default_model"):
                row = db.get(Setting, k)
                if row:
                    db.delete(row)


async def test_profiles_stale_id_and_bad_default_fall_back(client):
    r = await _put_profiles(client, [
        {"id": "a", "api_key": "ka", "base_url": "https://a", "model": "ma"},
        {"id": "b", "api_key": "kb", "base_url": "https://b", "model": "mb"},
    ], default="a")
    assert r.status_code == 200
    try:
        # a stale reference (e.g. snapshotted into a running game) must not raise
        assert llm_mod.get_profile("ghost").id == "a"
        # a default_model that matches nothing falls back to the first profile
        with session_scope() as db:
            db.merge(Setting(key="default_model", value="nope"))
        llm_mod.invalidate_profiles_cache()
        assert llm_mod.get_profile().id == "a"
    finally:
        with session_scope() as db:
            for k in ("model_profiles", "default_model"):
                row = db.get(Setting, k)
                if row:
                    db.delete(row)


async def test_profiles_clear_and_legacy_rejected(client):
    r = await _put_profiles(client, [{"id": "only", "api_key": "k", "base_url": "https://x", "model": "m"}])
    assert r.status_code == 200 and r.json()["profiles_source"] == "db"
    try:
        # legacy single-model fields are refused while profiles are active
        assert (await client.put("/api/settings", json={"api_key": "zzz"})).status_code == 400
        assert (await client.put("/api/settings", json={"model": "other"})).status_code == 400
        # an empty list clears the DB override and falls back to env/legacy
        r = await _put_profiles(client, [])
        assert r.status_code == 200 and r.json()["profiles_source"] != "db"
        # legacy fields are accepted again once profiles are gone
        assert (await client.put("/api/settings", json={"model": "deepseek-v4-pro"})).status_code == 200
    finally:
        await client.put("/api/settings", json={"model": ""})
        with session_scope() as db:
            for k in ("model_profiles", "default_model"):
                row = db.get(Setting, k)
                if row:
                    db.delete(row)


# --------------------------------------------------------------------------- characters


async def test_builtin_characters_seeded(client):
    items = (await client.get("/api/characters")).json()
    ids = {c["id"] for c in items}
    assert {"builtin-host", "builtin-logic", "builtin-intuition", "builtin-detail", "builtin-skeptic"} <= ids
    assert all(c["builtin"] for c in items if c["id"].startswith("builtin-"))
    hosts = (await client.get("/api/characters?kind=host")).json()
    assert len(hosts) >= 1 and all(c["kind"] == "host" for c in hosts)
    # builtin player prompt keeps both languages
    logic = next(c for c in items if c["id"] == "builtin-logic")
    assert "逻辑派" in json.loads(logic["prompt"])["zh"]


async def test_character_crud_and_builtin_protection(client):
    body = {"kind": "player", "name": "福尔摩斯", "intro": "侦探", "prompt": "先证伪再求证", "portrait": "6",
            "color": "#123456", "model_id": ""}
    r = await client.post("/api/characters", json=body)
    assert r.status_code == 201
    c = r.json()
    assert c["builtin"] is False and c["model_id"] == ""
    assert (await client.get(f"/api/characters/{c['id']}")).json()["name"] == "福尔摩斯"

    r = await client.put(f"/api/characters/{c['id']}", json={**body, "name": "华生"})
    assert r.json()["name"] == "华生"

    r = await client.post(f"/api/characters/{c['id']}/duplicate")
    assert r.status_code == 201 and r.json()["builtin"] is False and r.json()["name"].startswith("华生")
    dup = r.json()

    # bad portrait / color / model rejected
    assert (await client.post("/api/characters", json={**body, "portrait": "9"})).status_code == 422
    assert (await client.post("/api/characters", json={**body, "color": "red"})).status_code == 422
    assert (await client.post("/api/characters", json={**body, "model_id": "ghost"})).status_code == 400

    # builtin: content immutable, model assignable, delete forbidden
    assert (await client.put("/api/characters/builtin-logic", json={**body, "name": "x"})).status_code == 403
    assert (await client.delete("/api/characters/builtin-logic")).status_code == 403
    r = await client.patch("/api/characters/builtin-logic/model", json={"model_id": ""})
    assert r.status_code == 200

    assert (await client.delete(f"/api/characters/{c['id']}")).status_code == 200
    assert (await client.delete(f"/api/characters/{dup['id']}")).status_code == 200


# --------------------------------------------------------------------------- game integration


async def test_game_with_character_snapshot_and_model_routing(client, fake_llm):
    r = await _put_profiles(client, [
        {"id": "m1", "api_key": "k1", "base_url": "https://one", "model": "model-one", "label": "One"},
        {"id": "m2", "api_key": "k2", "base_url": "https://two", "model": "model-two", "label": "Two"},
    ], default="m1")
    assert r.status_code == 200

    r = await client.post("/api/characters", json={
        "kind": "player", "name": "神探", "intro": "", "prompt": "先问生死",
        "portrait": "6", "color": "", "model_id": "m2"})
    ch = r.json()
    r = await client.post("/api/characters", json={
        "kind": "host", "name": "毒舌主持", "intro": "", "prompt": "回答带讥讽",
        "portrait": "detective", "color": "", "model_id": "m2"})
    host_ch = r.json()

    try:
        pid = await _mk_puzzle(client)
        r = await client.post("/api/games", json={
            "puzzle_id": pid,
            "host": {"kind": "ai", "effort": "high", "character_id": host_ch["id"]},
            "players": [{"name": "P1", "kind": "ai", "character_id": ch["id"], "effort": "low"}],
            "delay": 0,
        })
        assert r.status_code == 201
        gid = r.json()["id"]
        snap = await _run_until_ask(client, gid)

        p = snap["config"]["players"][0]
        assert p["character_prompt"] == "先问生死" and p["model_id"] == "m2" and p["portrait"] == "6"
        assert snap["config"]["host"]["host_style"] == "回答带讥讽"
        assert snap["config"]["host"]["model_id"] == "m2"

        # the fake llm must have received the character's profile for every in-game call
        assert "m2" in fake_llm.profiles

        # prompt actually contains the character persona and host style
        runner = None
        from app.engine import registry
        runner = await registry.get(gid)
        assert "先问生死" in runner.player_system(runner.players[0])
        assert "回答带讥讽" in runner.host_system()

        # unknown character id is ignored gracefully
        r = await client.post("/api/games", json={
            "puzzle_id": pid,
            "host": {"kind": "ai"},
            "players": [{"name": "P1", "kind": "ai", "character_id": "ghost", "effort": "low"}],
            "delay": 0,
        })
        assert r.status_code == 201
        snap = (await client.get(f"/api/games/{r.json()['id']}")).json()
        p = snap["config"]["players"][0]
        assert p["character_id"] == "" and p["character_prompt"] == "" and p["model_id"] == ""
    finally:
        with session_scope() as db:
            for k in ("model_profiles", "default_model"):
                row = db.get(Setting, k)
                if row:
                    db.delete(row)
        from app.config import get_settings

        get_settings().model_profiles = ""
