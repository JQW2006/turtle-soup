import os
import tempfile
from pathlib import Path

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{Path(_tmp) / 'test.db'}"
os.environ["DEEPSEEK_API_KEY"] = "test-key"
os.environ["APP_ACCESS_TOKEN"] = ""
os.environ["SETTINGS_LOCKED"] = "false"
os.environ["DEEPSEEK_MODEL"] = "deepseek-flash"
os.environ["DEEPSEEK_BASE_URL"] = "https://api.deepseek.com"

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app import llm as llm_mod  # noqa: E402
from app.engine import registry  # noqa: E402
from app.llm import LLMResult  # noqa: E402
from app.main import app  # noqa: E402


class FakeLLM:
    """Scripted LLM: players ask a few questions and then guess; the host says yes."""

    def __init__(self, asks_before_guess: int = 2, correct: bool = True, verdict: str = "yes", say: str = ""):
        self.asks_before_guess = asks_before_guess
        self.correct = correct
        self.verdict = verdict
        self.say = say
        self.calls: list[str] = []
        self.player_turns = 0

    async def json(self, system, user, *, effort="low", max_tokens=2048, temperature=0.7):
        if "拆解" in user or "Break the solution" in user:
            kind, data = "points", {"points": [{"text": "A", "core": True, "weight": 3}, {"text": "B", "core": False, "weight": 1}]}
        elif "审阅" in user or "Review the quality" in user:
            kind, data = "review_puzzle", {"verdict": "ok", "issues": [{"level": "warn", "text": "x"}], "difficulty": 2,
                                           "color": "red", "genre": "honkaku", "title": "T"}
        elif "复盘" in user or "post-game review" in user:
            kind, data = "review", {"summary": "good game", "turning_points": [3], "misdirections": "", "mvp": "A"}
        elif '"action"' in user:
            kind, data = self._player(user)
        elif '"hint"' in user:
            kind, data = "hint", {"hint": "think about the sea"}
        elif '"matched"' in user:
            kind, data = "judge", {"analysis": "", "matched": ["k1"] if self.correct else [], "correct": self.correct, "feedback": "fb"}
        elif '"verdict"' in user:
            kind, data = "answer", {"analysis": "", "verdict": self.verdict, "note": "", "key": True, "points": ["k1"]}
        else:
            raise AssertionError(f"unexpected prompt: {user[:200]}")
        self.calls.append(kind)
        return LLMResult(data=data, usage={"prompt": 10, "completion": 5})

    def _player(self, user):
        self.player_turns += 1
        final = "【最终作答】" in user or "[Final answer]" in user
        if final or self.player_turns > self.asks_before_guess:
            return "player", {"analysis": "a", "say": self.say, "action": "guess", "content": "the story"}
        return "player", {"analysis": "a", "say": self.say, "action": "ask", "content": f"q{self.player_turns}?"}

@pytest.fixture
def fake_llm():
    f = FakeLLM()
    llm_mod.set_llm(f)
    yield f
    llm_mod.set_llm(None)

@pytest.fixture
async def client():
    async with app.router.lifespan_context(app), AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    await registry.shutdown()
