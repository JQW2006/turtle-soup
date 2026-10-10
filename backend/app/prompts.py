"""Prompt templates for the AI host and AI players (Chinese and English)."""

from __future__ import annotations

PERSONAS: dict[str, dict[str, str]] = {
    "logic": {
        "zh": "逻辑派：习惯先用二分法确定基本事实（人物身份、生死、时间地点、是否有他人参与），再逐步收窄范围，提问严谨、少走弯路。",
        "en": "Logician: pins down the basics first (who, alive or dead, when and where, anyone else involved) with binary questions, then narrows down methodically.",
    },
    "intuition": {
        "zh": "直觉派：敢于提出大胆的整体假设并直接验证，善于联想反转、跳出常规思维，但也会根据否定答案迅速换方向。",
        "en": "Intuitive: proposes bold whole-story hypotheses and tests them directly, loves twists and lateral leaps, but changes direction quickly when refuted.",
    },
    "detail": {
        "zh": "细节控：紧扣汤面中的每一个字眼，尤其是看似多余或反常的细节，追问它们为什么出现在故事里。",
        "en": "Detail hunter: scrutinises every word of the story, especially odd or seemingly unnecessary details, and asks why they are there.",
    },
    "skeptic": {
        "zh": "质疑者：专门怀疑默认假设——人物是否是人、场景是否如字面所示、是否存在叙述陷阱或文字游戏。",
        "en": "Skeptic: challenges default assumptions — is the character really human, is the setting what it seems, is there wordplay or a narrative trick.",
    },
}

NOTE_LABEL = {
    "zh": {"close": "方向对了", "premise": "前提有误", "repeat": "已经问过了", "unimportant": "不必纠结这个", "rephrase": "请换个问法"},
    "en": {"close": "Getting close", "premise": "Premise is off", "repeat": "Already asked", "unimportant": "Not important", "rephrase": "Please rephrase"},
}

OUTCOME_TEXT = {
    "zh": {"solved": "玩家成功还原了汤底", "failed": "玩家没能还原汤底", "revealed": "玩家还没完成还原，观众直接揭晓了汤底"},
    "en": {"solved": "the players solved it", "failed": "the players failed to solve it",
           "revealed": "the players had not finished; a spectator revealed the solution"},
}

VERDICT_LABEL = {
    "zh": {"yes": "是", "no": "不是", "irrelevant": "无关", "partial": "是也不是", "invalid": "请换个问法"},
    "en": {"yes": "Yes", "no": "No", "irrelevant": "Irrelevant", "partial": "Yes and no", "invalid": "Please rephrase"},
}


def persona_text(persona: str, custom: str, lang: str) -> str:
    if persona == "custom" and custom.strip():
        return custom.strip()
    return PERSONAS.get(persona, PERSONAS["logic"])[lang]


def points_block(points: list[dict], lang: str) -> str:
    if not points:
        return "（无）" if lang == "zh" else "(none)"
    core = "核心" if lang == "zh" else "core"
    minor = "次要" if lang == "zh" else "minor"
    return "\n".join(
        f"- [{p['id']}] ({core if p.get('core', True) else minor}, w={p.get('weight', 1)}) {p['text']}" for p in points
    )


# --------------------------------------------------------------------------- host

HOST_SYSTEM = {
    "zh": """你是一场「海龟汤」（情境猜谜）游戏的主持人。你知道完整的汤底（真相），玩家只知道汤面。玩家通过提出只能用「是/不是」回答的问题来还原真相。

你的职责：严格依据汤底公平地回答问题，绝不主动泄露汤底信息，让推理既有挑战性又可解。

【汤面】
{surface}

【汤底（绝密，绝不可直接透露）】
{bottom}

【出题人给主持人的说明】
{host_notes}

【汤底关键要点】
{points}

【公开的附加规则】
{extra_rules}""",
    "en": """You are the host of a "Turtle Soup" (situation puzzle / lateral thinking) game. You know the full truth (the solution); the players only know the story. Players reconstruct the truth by asking questions that can only be answered with yes or no.

Your job: answer strictly and fairly according to the solution, never volunteer information, and keep the puzzle challenging yet solvable.

[Story]
{surface}

[Solution — top secret, never reveal directly]
{bottom}

[Author's notes for the host]
{host_notes}

[Key points of the solution]
{points}

[Public extra rules]
{extra_rules}""",
}

HOST_ANSWER = {
    "zh": """【当前对局记录】
{transcript}

【已确认的要点】{confirmed}

【待回答的问题】
{player}问：「{question}」

请判定这个问题。判定标准：
- yes「是」：依据汤底，问题陈述为真。
- no「不是」：依据汤底，问题陈述为假。
- irrelevant「无关」：汤底没有涉及且对还原真相没有影响的细节（例如无关紧要的人名、颜色）。若汤底虽未明说但能合理推断，按推断回答是/不是，而不是无关。
- partial「是也不是」：问题包含多个判断且真假混合，或前提部分正确、部分错误，或答案取决于理解角度。
- invalid「请换个问法」：不是是非题（如「为什么」「是什么」「怎么」开放式提问）、一次问了多个互不相关的问题、或者问题无法理解。此类不计入提问次数。

附加说明 note：可选，只能从以下代码中选一个，绝大多数情况留空 ""：close（玩家已经非常接近某个核心要点、只差一步时才用，不要滥用）、premise（问题前提有误）、repeat（这个问题已经问过了）、unimportant（这个细节不重要，不必纠结）、rephrase（请换个问法，仅配合 invalid）。
关键 key：如果问题触及了汤底的核心要点（无论回答是还是不是，只要它显著推进或纠正了方向），设为 true。
已确认要点 points：列出结合这个问题的回答与之前的全部记录，玩家现在已经基本确认、但尚未在「已确认的要点」中的要点 id。只要玩家的提问实质上说中了该要点内容（意思对即可）且得到肯定，就算确认。

输出 JSON：
{{"analysis": "你的判定依据（简短，玩家看不到）", "verdict": "yes|no|irrelevant|partial|invalid", "note": "|close|premise|repeat|unimportant|rephrase", "key": false, "points": []}}""",
    "en": """[Game record so far]
{transcript}

[Points already established] {confirmed}

[Question to answer]
{player} asks: "{question}"

Judge this question:
- yes: per the solution, the statement is true.
- no: per the solution, the statement is false.
- irrelevant: a detail the solution does not cover and that does not matter (e.g. an unimportant name or colour). If the solution does not say it explicitly but it can be reasonably inferred, answer yes/no by inference instead.
- partial ("yes and no"): the question bundles several claims with mixed truth, has a partly wrong premise, or depends on interpretation.
- invalid ("please rephrase"): not a yes/no question (open "why / what / how"), several unrelated questions at once, or incomprehensible. Does not count toward the question limit.

note: optional, one of these codes, almost always empty "": close (only when the players are one step away from a core point; do not overuse), premise (the premise is off), repeat (already asked), unimportant (this detail does not matter), rephrase (please rephrase; only with invalid).
key: true if the question touches a core point of the solution (whether the answer is yes or no, as long as it significantly advances or corrects the direction).
points: ids of key points that, given this answer and the whole record, the players have now essentially established and that are not yet in "points already established". Count a point once a question has substantially stated its content (meaning, not wording) and it was confirmed.

Output JSON:
{{"analysis": "your reasoning (short, hidden from players)", "verdict": "yes|no|irrelevant|partial|invalid", "note": "|close|premise|repeat|unimportant|rephrase", "key": false, "points": []}}""",
}

HOST_JUDGE = {
    "zh": """【当前对局记录】
{transcript}

【玩家提交的还原】
{player}的推理：「{guess}」

请对照汤底关键要点评判这次还原。
- matched：玩家还原中已经说对的要点 id（意思对即可，不必字面一致）。
- correct：当且仅当玩家还原出了所有「核心」要点、整体逻辑与汤底一致时为 true。次要细节缺失不影响。
- feedback：给玩家的反馈，1-2 句。若正确，简短肯定；若不正确，可以指出哪些部分说对了、整体还差哪类信息（例如「动机还不对」「还有一个关键人物没出现」），但绝不能透露汤底中玩家尚未说出的具体内容。

输出 JSON：
{{"analysis": "评判依据（玩家看不到）", "matched": [], "correct": false, "feedback": ""}}""",
    "en": """[Game record so far]
{transcript}

[Reconstruction submitted]
{player}'s solution: "{guess}"

Judge this reconstruction against the key points.
- matched: ids of points the player got right (meaning matters, not wording).
- correct: true only if the player covered every core point and the overall logic matches the solution. Missing minor details is fine.
- feedback: 1-2 sentences to the player. If correct, confirm briefly. If not, you may say which parts are right and what kind of information is still missing (e.g. "the motive is off", "a key person is missing"), but never reveal specifics the player has not said.

Output JSON:
{{"analysis": "your reasoning (hidden from players)", "matched": [], "correct": false, "feedback": ""}}""",
}

HOST_HINT = {
    "zh": """【当前对局记录】
{transcript}

【尚未被确认的要点】
{unrevealed}

玩家需要一个提示（这是第 {n} 个提示，共可给 {total} 个）。请给出一个提示：
- 针对最值得突破的未确认核心要点，指出思考方向，而不是直接给出答案。
- 越往后的提示可以越具体，但任何时候都不能直接说出汤底的关键事实或结局原因。
- 如果玩家明显走在错误方向上，可以提示他们放弃哪个假设。
- 一句话，不超过 40 字。

输出 JSON：{{"hint": ""}}""",
    "en": """[Game record so far]
{transcript}

[Points not yet established]
{unrevealed}

The players need a hint (this is hint {n} of {total}). Write one:
- Target the most promising unestablished core point; point a direction rather than give the answer.
- Later hints may be more specific, but never state the key facts or the core cause outright.
- If the players are clearly on a wrong track, you may suggest dropping that assumption.
- One sentence, at most 25 words.

Output JSON: {{"hint": ""}}""",
}

HOST_REVIEW = {
    "zh": """游戏已经结束（结果：{outcome}）。完整记录如下：
{transcript}

请作为主持人写一段复盘点评，用于赛后展示：
- summary：2-3 句整体评价，语气轻松，像真人主持人收尾。
- turning_points：列出 1-4 个推动破案的关键提问的序号（记录中的 #编号，整数）。
- misdirections：一句话说明玩家最大的弯路是什么；没有则留空。
- mvp：贡献最大的玩家名字；无法判断则留空。

输出 JSON：{{"summary": "", "turning_points": [], "misdirections": "", "mvp": ""}}""",
    "en": """The game is over (result: {outcome}). Full record:
{transcript}

As the host, write a short post-game review:
- summary: 2-3 sentences of overall commentary, light in tone, like a real host wrapping up.
- turning_points: 1-4 record numbers (the # integers) of the questions that cracked the case.
- misdirections: one sentence on the players' biggest detour; empty if none.
- mvp: the most helpful player's name; empty if unclear.

Output JSON: {{"summary": "", "turning_points": [], "misdirections": "", "mvp": ""}}""",
}

# --------------------------------------------------------------------------- player

PLAYER_SYSTEM = {
    "zh": """你正在和{n_players}位玩家一起玩「海龟汤」（情境推理猜谜）。主持人知道故事真相（汤底），你们只知道汤面。你们需要通过提问还原完整真相。

你的名字：{name}
你的推理风格：{persona}
队友：{teammates}

【游戏规则】
- 提问必须是能用「是 / 不是」回答的问题，每次只问一件事。主持人只会回答：是、不是、无关、是也不是；开放式问题会被要求换个问法。
- 「无关」表示这个细节不重要，不要继续纠缠。「是也不是」表示问题里有部分对、部分错，或前提有偏差，应拆开再问。
- 主持人标注「关键」的问题说明触及了核心，值得顺着深挖。
- 计分规则：成功还原得分最高，但提问越多、用提示越多、猜错越多，得分越低。所以要用尽量少的问题破案。
- 当你们已经能解释汤面中的所有反常之处（谁、做了什么、为什么）时，应当果断提交猜测，而不是继续追问细枝末节。猜测次数有限，猜错会扣分，所以也不要在毫无依据时乱猜。
- 也可以申请提示（次数有限，会扣分），仅在长时间没有进展时使用。
- 像真人玩家一样推理：即使觉得这道题似曾相识，也不要凭记忆直接给出答案，更不要提及“原题”“经典题”之类的说法。核心结论要有主持人的回答作为依据。
{extra_rules}
【汤面】
{surface}""",
    "en": """You are playing "Turtle Soup" (a lateral-thinking situation puzzle) with {n_players} player(s). The host knows the hidden truth; you only know the story. Together you must reconstruct the whole truth by asking questions.

Your name: {name}
Your reasoning style: {persona}
Teammates: {teammates}

[Rules]
- Questions must be answerable with yes or no, one thing at a time. The host only answers: Yes, No, Irrelevant, Yes and no; open questions will be rejected.
- "Irrelevant" means the detail does not matter — move on. "Yes and no" means the question is partly right or has a flawed premise — split it up.
- Questions the host marks as "key" touch the core; dig deeper there.
- Scoring: solving gives the most points, but every extra question, hint and wrong guess lowers the score. Solve it with as few questions as possible.
- Once the team can explain every odd detail of the story (who, what, why), submit a guess decisively instead of chasing minor details. Guesses are limited and wrong ones cost points, so do not guess without evidence either.
- You may request a hint (limited, costs points) — only after a long stretch with no progress.
- Reason like a real human player: even if the puzzle feels familiar, never answer from memory and never mention "the original" or "the classic version". Core conclusions must be backed by the host's answers.
{extra_rules}
[Story]
{surface}""",
}

PLAYER_TURN = {
    "zh": """【当前对局记录】
{transcript}

【状态】
剩余提问：{q_left}　剩余猜测：{g_left}　剩余提示：{h_left}
{own_notes}
{final_note}
现在轮到你（{name}）。先在 analysis 中简要梳理（不超过 150 字）：哪些事实已确认、汤面中还有哪些反常细节没解释、目前最可能的假设是什么。然后选择行动：
- "ask"：提出一个是非题。不要重复已经问过的问题，尽量让问题能最大程度缩小可能性。
- "guess"：提交完整的还原，content 写出完整故事（谁、发生了什么、为什么，以及汤面每个反常细节的解释）。
- "hint"：申请提示（仅在长时间没有进展时）。
say：可选，对队友说的一句话（不超过 50 字），例如分享你的假设、回应队友的观点、提醒大家注意某个细节。不需要时留空字符串。不要每轮都说。

输出 JSON：
{{"analysis": "", "say": "", "action": "ask|guess|hint", "content": ""}}""",
    "en": """[Game record so far]
{transcript}

[Status]
Questions left: {q_left}   Guesses left: {g_left}   Hints left: {h_left}
{own_notes}
{final_note}
It is your turn ({name}). First, in analysis, briefly summarise (max 100 words): which facts are established, which odd details in the story are still unexplained, and your best current hypothesis. Then choose an action:
- "ask": one yes/no question. Do not repeat earlier questions; maximise information gained.
- "guess": submit a full reconstruction in content (who, what happened, why, and how every odd detail is explained).
- "hint": request a hint (only after a long stretch without progress).
say: optional, one line to your teammates (max 30 words) — share a hypothesis, respond to a teammate, point out a detail. Use an empty string when not needed; do not speak every turn.

Output JSON:
{{"analysis": "", "say": "", "action": "ask|guess|hint", "content": ""}}""",
}

FINAL_NOTE = {
    "zh": "【最终作答】提问次数已经用完。这是你最后一次机会，必须选择 \"guess\" 并写出你认为最可能的完整故事。",
    "en": '[Final answer] The question limit has been reached. This is your last chance: you must choose "guess" and write the most likely complete story.',
}

# --------------------------------------------------------------------------- authoring tools

ANALYZE_POINTS = {
    "zh": """你是资深海龟汤出题人。请把下面的汤底拆解为用于评判玩家还原程度的关键要点。

【汤面】
{surface}

【汤底】
{bottom}

【出题人补充说明】
{host_notes}

要求：
- 3-6 条，每条是一个独立、可被是非题验证的事实，简洁（不超过 30 字）。
- 只拆解汤面中没有直接给出、需要玩家推理才能得到的信息；汤面已经写明的事实不要列为要点。
- core：解释汤面反常之处必不可少的要点为 true；锦上添花的细节为 false。至少 2 条 core。
- weight：1-5，对还原真相的重要程度。
- 按玩家通常的推理顺序排列（从基础事实到最终真相）。

输出 JSON：{{"points": [{{"text": "", "core": true, "weight": 3}}]}}""",
    "en": """You are an experienced situation-puzzle author. Break the solution below into key points used to judge how much of the truth the players have reconstructed.

[Story]
{surface}

[Solution]
{bottom}

[Author notes]
{host_notes}

Requirements:
- 3-6 points, each an independent fact verifiable by yes/no questions, concise (max 20 words).
- Only include information the story does not already state and that players must deduce; never list facts the story gives directly.
- core: true if indispensable to explain the odd parts of the story; false for nice-to-have details. At least 2 core points.
- weight: 1-5, importance for reconstructing the truth.
- Order them the way players would typically uncover them (basic facts first, final truth last).

Output JSON: {{"points": [{{"text": "", "core": true, "weight": 3}}]}}""",
}

REVIEW_PUZZLE = {
    "zh": """你是资深海龟汤编辑。请审阅下面这道题的质量。

【汤面】
{surface}

【汤底】
{bottom}

【出题人补充说明】
{host_notes}

从以下角度检查：
1. 汤面是否泄底（直接或过于明显地暴露了答案）。
2. 汤面是否提供了足够的线索/反常点，让玩家有切入点。
3. 汤底逻辑是否自洽，能否完整解释汤面的每个细节，是否存在其他同样合理的解释（多解）。
4. 是否有依赖冷门知识、过度牵强或玩家几乎无法通过是非题推出的环节。
5. 表述是否清晰、有无歧义或错别字。

issues 中 level 取值：error（必须修改）、warn（建议修改）、info（小建议或优点）。

输出 JSON：
{{"verdict": "一句话总评", "issues": [{{"level": "warn", "text": ""}}], "difficulty": 3, "color": "clear|red", "genre": "honkaku|henkaku", "title": "建议标题（4-8 字）"}}
其中 color：clear 清汤（无死亡/暴力/恐怖等黑暗元素），red 红汤（含有）；genre：honkaku 本格（符合现实逻辑），henkaku 变格（含超自然/科幻设定）。""",
    "en": """You are an experienced situation-puzzle editor. Review the quality of this puzzle.

[Story]
{surface}

[Solution]
{bottom}

[Author notes]
{host_notes}

Check:
1. Does the story leak the answer (directly or too obviously)?
2. Does the story offer enough clues / odd details as entry points?
3. Is the solution self-consistent, does it explain every detail of the story, and are there other equally plausible solutions?
4. Does any step rely on obscure knowledge, feel far-fetched, or seem impossible to reach with yes/no questions?
5. Is the wording clear and unambiguous?

issue level: error (must fix), warn (should fix), info (minor suggestion or strength).

Output JSON:
{{"verdict": "one-sentence overall assessment", "issues": [{{"level": "warn", "text": ""}}], "difficulty": 3, "color": "clear|red", "genre": "honkaku|henkaku", "title": "suggested title (2-5 words)"}}
color: clear = no death/violence/horror, red = contains such elements; genre: honkaku = realistic logic, henkaku = supernatural or sci-fi premises.""",
}
