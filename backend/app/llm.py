"""Thin async wrapper around OpenAI-compatible chat APIs with multiple model profiles."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from openai import APIError, AsyncOpenAI

from .config import get_settings
from .db import session_scope
from .models import Setting

log = logging.getLogger(__name__)

DEFAULT_PROFILE_ID = "default"


class LLMError(RuntimeError):
    pass


@dataclass
class ModelProfile:
    id: str
    label: str
    api_key: str
    base_url: str
    model: str


@dataclass
class LLMResult:
    data: dict[str, Any]
    reasoning: str = ""
    usage: dict[str, int] = field(default_factory=dict)


class LLM(Protocol):
    async def json(
        self, system: str, user: str, *, effort: str = "low", max_tokens: int = 2048, temperature: float = 0.7,
        profile_id: str | None = None,
    ) -> LLMResult: ...


def runtime_config() -> dict[str, str]:
    """Legacy single-model settings: values saved in the UI override .env."""
    s = get_settings()
    cfg = {"api_key": s.deepseek_api_key, "base_url": s.deepseek_base_url, "model": s.deepseek_model}
    source = "env" if s.deepseek_api_key else "none"
    with session_scope() as db:
        for row in db.query(Setting).filter(Setting.key.in_(["api_key", "base_url", "model"])):
            if row.value:
                cfg[row.key] = row.value
                if row.key == "api_key":
                    source = "db"
    cfg["api_key_source"] = source
    return cfg


def _parse_profile_items(raw: str) -> list[dict[str, str]]:
    try:
        items = json.loads(raw)
    except json.JSONDecodeError as e:
        raise LLMError(f"model profiles are not valid JSON: {e}") from e
    if not isinstance(items, list) or not items:
        raise LLMError("model profiles must be a non-empty JSON array")
    seen: set[str] = set()
    for it in items:
        if not isinstance(it, dict):
            raise LLMError("each model profile must be an object")
        pid = str(it.get("id", "")).strip()
        model = str(it.get("model", "")).strip()
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,32}", pid):
            raise LLMError(f"invalid profile id: {pid!r}")
        if not model:
            raise LLMError(f"profile {pid!r} is missing a model name")
        if pid in seen:
            raise LLMError(f"duplicate profile id: {pid}")
        seen.add(pid)
        it["id"] = pid
        it["model"] = model
        it["label"] = str(it.get("label", "")).strip() or model
        it["api_key"] = str(it.get("api_key", "")).strip()
        it["base_url"] = str(it.get("base_url", "")).strip()
        if not it["base_url"]:
            raise LLMError(f"profile {pid!r} is missing base_url (be explicit: a missing URL must not be guessed)")
    return items


def _raw_profiles() -> tuple[str, str, str]:
    """(raw JSON, default profile id, source) from DB > env, with source in {db, env, legacy}."""
    s = get_settings()
    with session_scope() as db:
        db_profiles = db.get(Setting, "model_profiles")
        db_default = db.get(Setting, "default_model")
        raw = db_profiles.value if db_profiles and db_profiles.value else s.model_profiles
        default = (db_default.value if db_default else "") or s.default_model
        source = "db" if db_profiles and db_profiles.value else ("env" if raw else "legacy")
    return raw, default, source


_profiles_cache: tuple[float, tuple[list[ModelProfile], str, str]] | None = None
_PROFILES_TTL = 5.0  # seconds; invalidated eagerly on settings writes


def invalidate_profiles_cache() -> None:
    global _profiles_cache
    _profiles_cache = None


def resolve_profiles() -> tuple[list[ModelProfile], str]:
    """Effective model profiles: DB (Settings UI) > MODEL_PROFILES env > legacy single config.

    Returns (profiles, default_profile_id). Cached briefly: every LLM call resolves
    its profile, and the SQLite round-trips would otherwise be pure overhead.
    """
    global _profiles_cache
    now = time.monotonic()
    if _profiles_cache is not None and now - _profiles_cache[0] < _PROFILES_TTL:
        profiles, default, _ = _profiles_cache[1]
        return profiles, default

    raw, default, source = _raw_profiles()
    if raw:
        profiles = [ModelProfile(**{k: it[k] for k in ("id", "label", "api_key", "base_url", "model")})
                    for it in _parse_profile_items(raw)]
    else:
        # Legacy fallback: synthesise a single profile from the pre-profiles config.
        cfg = runtime_config()
        profiles = [ModelProfile(id=DEFAULT_PROFILE_ID, label=cfg["model"], api_key=cfg["api_key"],
                                 base_url=cfg["base_url"], model=cfg["model"])]
        default = DEFAULT_PROFILE_ID
    if not default or default not in {p.id for p in profiles}:
        default = profiles[0].id
    _profiles_cache = (now, (profiles, default, source))
    return profiles, default


def profiles_source() -> str:
    """Where the effective profiles came from: db | env | legacy."""
    if _profiles_cache is not None and time.monotonic() - _profiles_cache[0] < _PROFILES_TTL:
        return _profiles_cache[1][2]
    resolve_profiles()
    assert _profiles_cache is not None
    return _profiles_cache[1][2]


def get_profile(profile_id: str | None = None) -> ModelProfile:
    """Resolve a profile by id. Unknown ids fall back to the default instead of raising:
    a stale model_id is snapshotted into running games, and silently switching models
    beats killing the game with an error."""
    profiles, default = resolve_profiles()
    chosen = next((p for p in profiles if p.id == default), profiles[0])
    if profile_id and profile_id != chosen.id:
        for p in profiles:
            if p.id == profile_id:
                return p
        log.warning("model profile %r no longer exists; falling back to default %r", profile_id, chosen.id)
    return chosen


def effort_params(effort: str) -> dict[str, Any]:
    """Map an effort level to request params: off disables thinking, low/high/max set reasoning effort."""
    if effort == "off":
        return {"thinking": {"type": "disabled"}}
    return {"reasoning_effort": effort}


_JSON_BLOCK = re.compile(r"\{.*\}", re.S)


def parse_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = _JSON_BLOCK.search(text)
        if not m:
            raise
        data = json.loads(m.group(0))
    if not isinstance(data, dict):
        raise json.JSONDecodeError("not an object", text, 0)
    return data


class DeepSeekLLM:
    def __init__(self) -> None:
        self._clients: dict[tuple[str, str], AsyncOpenAI] = {}

    def _get_client(self, profile: ModelProfile) -> AsyncOpenAI:
        if not profile.api_key:
            raise LLMError(f"model profile {profile.id!r} has no API key configured")
        key = (profile.api_key, profile.base_url)
        if key not in self._clients:
            s = get_settings()
            self._clients[key] = AsyncOpenAI(
                api_key=profile.api_key, base_url=profile.base_url, timeout=s.llm_timeout, max_retries=0
            )
        return self._clients[key]

    async def json(
        self, system: str, user: str, *, effort: str = "low", max_tokens: int = 16384, temperature: float = 0.7,
        profile_id: str | None = None,
    ) -> LLMResult:
        profile = get_profile(profile_id)
        client = self._get_client(profile)
        retries = get_settings().llm_max_retries
        last: Exception | None = None
        for attempt in range(retries):
            started = time.monotonic()
            try:
                resp = await client.chat.completions.create(
                    model=profile.model,
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                    response_format={"type": "json_object"},
                    max_tokens=max_tokens,
                    temperature=temperature,
                    extra_body=effort_params(effort),
                )
                choice = resp.choices[0]
                msg = choice.message
                if choice.finish_reason == "length" or not (msg.content or "").strip():
                    # Reasoning ate the budget: retry with more room.
                    max_tokens = min(max_tokens * 2, 65536)
                    raise json.JSONDecodeError(f"truncated output (finish_reason={choice.finish_reason})", "", 0)
                data = parse_json(msg.content or "")
                usage = {}
                if resp.usage:
                    usage = {"prompt": resp.usage.prompt_tokens or 0, "completion": resp.usage.completion_tokens or 0}
                log.info("llm ok profile=%s effort=%s %.1fs tokens=%s", profile.id, effort, time.monotonic() - started, usage)
                return LLMResult(data=data, reasoning=getattr(msg, "reasoning_content", None) or "", usage=usage)
            except (APIError, json.JSONDecodeError, IndexError) as e:
                last = e
                status = getattr(e, "status_code", None)
                if status in (401, 403):
                    raise LLMError(f"Authentication failed ({status}): check the API key for profile {profile.id!r}") from e
                log.warning("LLM call failed (attempt %s/%s): %s", attempt + 1, retries, e)
                if not isinstance(e, json.JSONDecodeError):
                    await asyncio.sleep(min(2**attempt, 8))
        raise LLMError(f"LLM call failed after {retries} attempts: {last}")

    async def ping(self, profile_id: str | None = None) -> str:
        profile = get_profile(profile_id)
        client = self._get_client(profile)
        resp = await client.chat.completions.create(
            model=profile.model,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=16,
            extra_body=effort_params("off"),
        )
        return resp.model


_default: LLM | None = None


def get_llm() -> LLM:
    global _default
    if _default is None:
        _default = DeepSeekLLM()
    return _default


def set_llm(llm: LLM | None) -> None:
    """Swap the global LLM (used by tests)."""
    global _default
    _default = llm
