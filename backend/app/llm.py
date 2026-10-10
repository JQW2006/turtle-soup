"""Thin async wrapper around the DeepSeek (OpenAI-compatible) chat API."""

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


class LLMError(RuntimeError):
    pass


@dataclass
class LLMResult:
    data: dict[str, Any]
    reasoning: str = ""
    usage: dict[str, int] = field(default_factory=dict)


class LLM(Protocol):
    async def json(
        self, system: str, user: str, *, effort: str = "low", max_tokens: int = 2048, temperature: float = 0.7
    ) -> LLMResult: ...


def runtime_config() -> dict[str, str]:
    """Effective connection settings: values saved in the UI override .env."""
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
        self._client: AsyncOpenAI | None = None
        self._client_key: tuple[str, str] | None = None

    def _get_client(self) -> tuple[AsyncOpenAI, str]:
        cfg = runtime_config()
        if not cfg["api_key"]:
            raise LLMError("DeepSeek API key is not configured")
        key = (cfg["api_key"], cfg["base_url"])
        if self._client is None or self._client_key != key:
            s = get_settings()
            self._client = AsyncOpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"], timeout=s.llm_timeout, max_retries=0)
            self._client_key = key
        return self._client, cfg["model"]

    async def json(
        self, system: str, user: str, *, effort: str = "low", max_tokens: int = 16384, temperature: float = 0.7
    ) -> LLMResult:
        client, model = self._get_client()
        retries = get_settings().llm_max_retries
        last: Exception | None = None
        for attempt in range(retries):
            started = time.monotonic()
            try:
                resp = await client.chat.completions.create(
                    model=model,
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
                log.info("llm ok effort=%s %.1fs tokens=%s", effort, time.monotonic() - started, usage)
                return LLMResult(data=data, reasoning=getattr(msg, "reasoning_content", None) or "", usage=usage)
            except (APIError, json.JSONDecodeError, IndexError) as e:
                last = e
                status = getattr(e, "status_code", None)
                if status in (401, 403):
                    raise LLMError(f"Authentication failed ({status}): check the API key") from e
                log.warning("LLM call failed (attempt %s/%s): %s", attempt + 1, retries, e)
                if not isinstance(e, json.JSONDecodeError):
                    await asyncio.sleep(min(2**attempt, 8))
        raise LLMError(f"LLM call failed after {retries} attempts: {last}")

    async def ping(self) -> str:
        client, model = self._get_client()
        resp = await client.chat.completions.create(
            model=model,
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
