async def test_builtin_seeded(client):
    r = await client.get("/api/puzzles?source=builtin")
    items = r.json()
    assert len(items) >= 20
    assert all(p["points"] for p in items)
    zh = (await client.get("/api/puzzles?language=zh&source=builtin")).json()
    assert zh and all(p["language"] == "zh" for p in zh)


async def test_crud_import_export(client):
    body = {"title": "  Fish ", "surface": "s", "bottom": "b", "points": [{"id": "", "text": "x"}, {"id": "", "text": "y"}]}
    r = await client.post("/api/puzzles", json=body)
    assert r.status_code == 201
    p = r.json()
    assert p["title"] == "Fish" and [x["id"] for x in p["points"]] == ["k1", "k2"]

    r = await client.put(f"/api/puzzles/{p['id']}", json={**body, "title": "Fish 2"})
    assert r.json()["title"] == "Fish 2"

    r = await client.post(f"/api/puzzles/{p['id']}/duplicate")
    assert r.status_code == 201 and "副本" in r.json()["title"]

    r = await client.post("/api/puzzles", json={"title": "", "surface": "s", "bottom": "b"})
    assert r.status_code == 422

    exp = (await client.get(f"/api/puzzles/export?ids={p['id']}")).json()
    assert exp["puzzles"][0]["title"] == "Fish 2"
    r = await client.post("/api/puzzles/import", json={"puzzles": exp["puzzles"] + [{"title": "bad"}]})
    assert r.json()["created"] == 1 and len(r.json()["errors"]) == 1

    assert (await client.delete(f"/api/puzzles/{p['id']}")).status_code == 204
    assert (await client.get(f"/api/puzzles/{p['id']}")).status_code == 404


async def test_analyze(client, fake_llm):
    r = await client.post("/api/puzzles/analyze/points", json={"surface": "s", "bottom": "b"})
    assert [p["id"] for p in r.json()["points"]] == ["k1", "k2"]
    r = await client.post("/api/puzzles/analyze/review", json={"surface": "s", "bottom": "b"})
    assert r.json()["color"] == "red" and r.json()["issues"][0]["level"] == "warn"


async def test_settings(client):
    r = await client.get("/api/settings")
    assert r.json()["api_key_source"] == "env"
    r = await client.put("/api/settings", json={"model": "deepseek-v4-pro"})
    assert r.json()["model"] == "deepseek-v4-pro"
    r = await client.put("/api/settings", json={"model": ""})
    assert r.json()["model"] == "deepseek-flash"


async def test_access_token(client):
    from app.config import get_settings

    s = get_settings()
    s.app_access_token = "secret"
    try:
        assert (await client.get("/api/puzzles")).status_code == 401
        assert (await client.get("/api/puzzles", headers={"X-Access-Token": "secret"})).status_code == 200
        assert (await client.get("/api/puzzles?token=secret")).status_code == 200
        assert (await client.get("/api/health")).status_code == 200
    finally:
        s.app_access_token = ""


async def test_settings_locked(client):
    from app.config import get_settings

    s = get_settings()
    s.settings_locked = True
    try:
        assert (await client.put("/api/settings", json={"base_url": "http://evil"})).status_code == 403
        assert (await client.post("/api/settings/test")).status_code == 403
        assert (await client.get("/api/settings")).json()["locked"] is True
    finally:
        s.settings_locked = False
