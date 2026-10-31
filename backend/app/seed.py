import json
from pathlib import Path

from . import prompts as P
from .db import session_scope
from .models import Character, Puzzle, Setting

DATA = Path(__file__).parent / "data" / "puzzles.json"

# Builtin host/player templates shown on the Characters page. Prompt and name/intro keep
# both languages ({"zh","en"} JSON); model_id is deliberately NOT listed here — a user's
# model choice for a builtin character must survive content updates (see upsert below).
BUILTIN_CHARACTERS: list[dict] = [
    {
        "id": "builtin-host", "kind": "host", "portrait": "detective", "color": "",
        "name": {"zh": "标准主持人", "en": "Standard Host"},
        "intro": {"zh": "严格依据汤底公平回答，只说是/不是/无关，绝不主动泄底。",
                  "en": "Answers strictly and fairly from the solution, never volunteers hints."},
        "prompt": "",
    },
    {
        "id": "builtin-logic", "kind": "player", "portrait": "6", "color": "#2563eb",
        "name": {"zh": "逻辑派", "en": "Logician"},
        "intro": {"zh": "二分法确定基本事实，再逐步收窄范围，提问严谨、少走弯路。",
                  "en": "Pins down the basics with binary questions, then narrows methodically."},
        "prompt": P.PERSONAS["logic"],
    },
    {
        "id": "builtin-intuition", "kind": "player", "portrait": "3", "color": "#d97706",
        "name": {"zh": "直觉派", "en": "Intuitive"},
        "intro": {"zh": "敢提大胆的整体假设并直接验证，善于联想反转、跳出常规思维。",
                  "en": "Tests bold whole-story hypotheses, loves twists and lateral leaps."},
        "prompt": P.PERSONAS["intuition"],
    },
    {
        "id": "builtin-detail", "kind": "player", "portrait": "5", "color": "#059669",
        "name": {"zh": "细节控", "en": "Detail Hunter"},
        "intro": {"zh": "紧扣汤面的每一个字眼，尤其是看似多余或反常的细节。",
                  "en": "Scrutinises every word of the story, especially the odd details."},
        "prompt": P.PERSONAS["detail"],
    },
    {
        "id": "builtin-skeptic", "kind": "player", "portrait": "4", "color": "#db2777",
        "name": {"zh": "质疑者", "en": "Skeptic"},
        "intro": {"zh": "专门怀疑默认假设：人物是否是人、场景是否如字面所示。",
                  "en": "Challenges default assumptions: is anything what it seems?"},
        "prompt": P.PERSONAS["skeptic"],
    },
]


def seed_builtin() -> int:
    """Insert the bundled classic puzzles once, on first launch."""
    with session_scope() as db:
        if db.get(Setting, "seeded"):
            return 0
        items = json.loads(DATA.read_text(encoding="utf-8"))
        for it in items:
            db.add(Puzzle(**it, source="builtin"))
        db.add(Setting(key="seeded", value="1"))
        return len(items)


def seed_characters() -> int:
    """Upsert builtin characters on every startup; keep the user's model_id choice."""
    with session_scope() as db:
        for it in BUILTIN_CHARACTERS:
            row = db.get(Character, it["id"])
            fields = {
                "kind": it["kind"],
                "name": json.dumps(it["name"], ensure_ascii=False),
                "intro": json.dumps(it["intro"], ensure_ascii=False),
                "prompt": json.dumps(it["prompt"], ensure_ascii=False) if it["prompt"] else "",
                "portrait": it["portrait"],
                "color": it.get("color", ""),
                "builtin": 1,
            }
            if row:
                for k, v in fields.items():
                    setattr(row, k, v)
            else:
                db.add(Character(id=it["id"], model_id="", **fields))
        return len(BUILTIN_CHARACTERS)
