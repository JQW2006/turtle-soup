from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Language = Literal["zh", "en"]
Effort = Literal["off", "low", "high", "max"]
Verdict = Literal["yes", "no", "irrelevant", "partial", "invalid"]


# ---------- puzzles ----------


class Point(BaseModel):
    id: str
    text: str
    weight: int = Field(default=1, ge=1, le=5)
    core: bool = True


class PuzzleIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    surface: str = Field(min_length=1)
    bottom: str = Field(min_length=1)
    host_notes: str = ""
    points: list[Point] = []
    tags: list[str] = []
    color: Literal["clear", "red"] = "clear"
    genre: Literal["honkaku", "henkaku"] = "honkaku"
    difficulty: int = Field(default=3, ge=1, le=5)
    language: Language = "zh"

    @field_validator("title", "surface", "bottom")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v


class PuzzleOut(PuzzleIn):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source: str
    play_count: int
    created_at: datetime
    updated_at: datetime


class AnalyzeIn(BaseModel):
    surface: str = ""
    bottom: str = Field(min_length=1)
    host_notes: str = ""
    language: Language = "zh"


# ---------- games ----------


class PlayerConfig(BaseModel):
    id: str = ""
    name: str = Field(min_length=1, max_length=24)
    kind: Literal["ai", "human"] = "ai"
    persona: str = "logic"
    custom_persona: str = ""
    effort: Effort = "off"
    color: str = ""
    character_id: str = ""  # character library reference; snapshot at game start
    portrait: str = ""      # portrait id captured from the character at game start
    model_id: str = ""      # model profile captured from the character at game start


class HostConfig(BaseModel):
    kind: Literal["ai", "human"] = "ai"
    effort: Effort = "high"
    character_id: str = ""
    portrait: str = ""
    model_id: str = ""
    host_style: str = ""    # host character prompt snapshot (appended to HOST_SYSTEM)


class Rules(BaseModel):
    max_questions: int = Field(default=60, ge=0, le=500)  # 0 = unlimited
    max_guesses: int = Field(default=3, ge=0, le=50)  # 0 = unlimited
    max_hints: int = Field(default=3, ge=0, le=20)
    auto_hint_after: int = Field(default=8, ge=0, le=100)  # stale questions before auto hint; 0 = off
    allow_hint_requests: bool = True
    allow_discussion: bool = True
    final_round: bool = True
    extra_rules: str = ""


class GameCreate(BaseModel):
    puzzle_id: str
    language: Language | None = None
    host: HostConfig = HostConfig()
    players: list[PlayerConfig] = Field(min_length=1, max_length=4)
    rules: Rules = Rules()
    delay: float = Field(default=1.5, ge=0, le=30)
    start_paused: bool = False

    @field_validator("players")
    @classmethod
    def _one_human(cls, v: list[PlayerConfig]) -> list[PlayerConfig]:
        if sum(p.kind == "human" for p in v) > 1:
            raise ValueError("at most one human player")
        return v


class GameSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    puzzle_id: str | None
    title: str
    status: str
    outcome: str | None
    rating: str | None
    score: int | None
    questions_used: int
    player_names: list[str]
    host_kind: str
    created_at: datetime
    finished_at: datetime | None


# ---------- human actions ----------


class ControlIn(BaseModel):
    action: Literal["pause", "resume", "step", "end"]


class SpeedIn(BaseModel):
    delay: float = Field(ge=0, le=30)


class HintIn(BaseModel):
    text: str = ""  # empty -> let the AI host write one


class PlayerActionIn(BaseModel):
    action: Literal["ask", "guess", "say", "hint", "pass"]
    text: str = ""


class HostAnswerIn(BaseModel):
    verdict: Verdict
    key: bool = False
    note: str = ""
    points: list[str] = []


class HostJudgeIn(BaseModel):
    correct: bool
    matched: list[str] = []
    feedback: str = ""


class HostHintIn(BaseModel):
    text: str = ""
    skip: bool = False
    use_ai: bool = False


class OverrideIn(BaseModel):
    verdict: Verdict
    key: bool | None = None
    note: str | None = None


# ---------- settings ----------


class ModelProfileIn(BaseModel):
    id: str = Field(min_length=1, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str = Field(default="", max_length=64)
    api_key: str = ""
    base_url: str = "https://api.deepseek.com"
    model: str = Field(min_length=1, max_length=128)


class ModelProfileOut(ModelProfileIn):
    api_key_set: bool = False
    api_key_preview: str = ""


class SettingsIn(BaseModel):
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None
    profiles: list[ModelProfileIn] | None = None  # replaces all profiles when present
    default_profile: str | None = None


class SettingsOut(BaseModel):
    api_key_set: bool
    api_key_preview: str
    api_key_source: Literal["db", "env", "none"]
    base_url: str
    model: str
    access_token_required: bool
    locked: bool = False
    profiles: list[ModelProfileOut] = []
    default_profile: str = ""
    profiles_source: Literal["db", "env", "legacy"] = "legacy"


# ---------- characters ----------


class CharacterIn(BaseModel):
    kind: Literal["host", "player"]
    name: str = Field(min_length=1, max_length=64)
    intro: str = Field(default="", max_length=500)
    prompt: str = Field(default="", max_length=4000)
    portrait: str = Field(default="", pattern=r"^([0-7]|detective)?$")
    color: str = Field(default="", pattern=r"^#[0-9a-fA-F]{6}$|^$")
    model_id: str = Field(default="", max_length=32)

    @field_validator("name", "intro", "prompt")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class CharacterModelIn(BaseModel):
    model_id: str = Field(default="", max_length=32)


class CharacterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    name: str
    intro: str
    prompt: str
    portrait: str
    color: str
    model_id: str
    builtin: bool
    created_at: datetime
