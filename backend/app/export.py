"""Render a finished (or ongoing) game as Markdown."""

from __future__ import annotations

from .prompts import NOTE_LABEL, VERDICT_LABEL

T = {
    "zh": {
        "surface": "汤面", "bottom": "汤底", "record": "对局记录", "result": "结果", "score": "评分",
        "points": "关键要点", "review": "主持人复盘", "players": "玩家", "host": "主持人",
        "ai": "AI", "human": "人类", "hint": "提示", "guess": "猜测", "correct": "正确", "wrong": "不正确",
        "key": "关键", "final": "最终作答",
        "outcomes": {"solved": "成功还原", "failed": "未能还原", "revealed": "直接揭晓"},
        "system": {"final_round": "提问次数用完，进入最终作答。", "guesses_exhausted": "猜测次数已用完。",
                   "no_hints": "没有可用的提示。", "pass": "跳过了本轮。", "hint_declined": "主持人没有给出提示。"},
    },
    "en": {
        "surface": "Story", "bottom": "Solution", "record": "Transcript", "result": "Result", "score": "Score",
        "points": "Key points", "review": "Host review", "players": "Players", "host": "Host",
        "ai": "AI", "human": "Human", "hint": "Hint", "guess": "Guess", "correct": "Correct", "wrong": "Incorrect",
        "key": "key", "final": "Final answer",
        "outcomes": {"solved": "Solved", "failed": "Not solved", "revealed": "Revealed"},
        "system": {"final_round": "Question limit reached — final answers.", "guesses_exhausted": "No guesses left.",
                   "no_hints": "No hints available.", "pass": "passed.", "hint_declined": "The host gave no hint."},
    },
}


def game_markdown(snap: dict) -> str:
    puzzle, cfg, st, events = snap["puzzle"], snap["config"], snap["state"], snap["events"]
    lang = cfg.get("language", "zh")
    t, labels = T[lang], VERDICT_LABEL[lang]
    names = {p["id"]: p["name"] for p in cfg["players"]}
    names["host"] = t["host"]
    answers = {e["data"].get("reply_to"): e for e in events if e["type"] in ("answer", "judgement")}

    out = [f"# {puzzle['title']}", "", f"## {t['surface']}", "", puzzle["surface"], ""]
    out += [f"**{t['players']}**: " + ", ".join(f"{p['name']} ({t[p['kind']]})" for p in cfg["players"])
            + f" · **{t['host']}**: {t[cfg['host']['kind']]}", ""]
    out += [f"## {t['record']}", ""]
    for e in events:
        d, who = e["data"], names.get(e["actor"], e["actor"])
        if e["type"] == "question":
            a = answers.get(e["seq"])
            ans = ""
            if a:
                ans = f" → **{labels[a['data']['verdict']]}**"
                if a["data"].get("key"):
                    ans += f" ({t['key']})"
                if a["data"].get("note"):
                    ans += f" — {NOTE_LABEL[lang].get(a['data']['note'], a['data']['note'])}"
            out.append(f"{e['seq']}. **{who}**: {d['text']}{ans}")
        elif e["type"] == "discussion":
            out.append(f"{e['seq']}. _{who}: {d['text']}_")
        elif e["type"] == "guess":
            a = answers.get(e["seq"])
            label = t["final"] if d.get("final") else t["guess"]
            res = ""
            if a:
                res = f"\n   → **{t['correct'] if a['data']['correct'] else t['wrong']}** {a['data'].get('feedback', '')}"
            out.append(f"{e['seq']}. **{who}** [{label}]: {d['text']}{res}")
        elif e["type"] == "hint":
            out.append(f"{e['seq']}. > **{t['hint']}**: {d['text']}")
        elif e["type"] == "system":
            msg = t["system"].get(d.get("code"), d.get("code"))
            actor = names.get(d.get("actor") or "", "")
            out.append(f"{e['seq']}. · {actor} {msg}".replace("  ", " "))
    out.append("")

    rep = st.get("report")
    if rep:
        out += [f"## {t['bottom']}", "", puzzle["bottom"], ""]
        out += [f"## {t['result']}", "", f"{t['outcomes'].get(rep['outcome'], rep['outcome'])} · "
                f"{t['score']} {rep['score']} ({rep['rating']})", ""]
        out += [f"### {t['points']}", ""]
        out += [f"- [{'x' if p['revealed'] else ' '}] {p['text']}" for p in rep["points"]]
        if rep["review"].get("summary"):
            out += ["", f"### {t['review']}", "", rep["review"]["summary"]]
            if rep["review"].get("misdirections"):
                out += ["", rep["review"]["misdirections"]]
        out.append("")
    return "\n".join(out)
