import json
from pathlib import Path

from .db import session_scope
from .models import Puzzle, Setting

DATA = Path(__file__).parent / "data" / "puzzles.json"


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
