# 参与贡献 · Contributing

感谢你愿意改进海龟汤！ / Thanks for helping improve Turtle Soup!

## 开发环境 · Setup

需要 Python 3.11+ 和 Node.js 20+。 / You need Python 3.11+ and Node.js 20+.

```bash
cp .env.example .env        # 填入 DEEPSEEK_API_KEY / set DEEPSEEK_API_KEY
make install
make dev                    # API :8000 + web :5173 (hot reload)
```

后端测试使用脚本化的假 LLM，不需要 API Key，也不会产生费用。
Backend tests use a scripted fake LLM: no API key needed, no cost.

## 提交前 · Before you open a PR

```bash
make lint     # ruff + oxlint + TypeScript
make test     # pytest
```

- 一个 PR 只做一件事，描述里写清动机和改动。 / Keep each PR focused and explain the why.
- 改了界面请附截图（深色和浅色主题各一张更好）。 / For UI changes, attach screenshots (ideally both themes).
- 界面文案同时更新 `frontend/src/lib/i18n.tsx` 里的中文和英文。 / Update both Chinese and English strings in `frontend/src/lib/i18n.tsx`.
- 修改提示词（`backend/app/prompts.py`）时请同时修改中英文两个版本。 / Prompt changes should cover both languages.

## 视觉风格 · Visual style

界面是“黑底手绘绘本”风格，相关的 SVG 滤镜和角色头像都在 `frontend/src/components/ink.tsx`：

- 需要手绘描边的元素把背景和边框画在 `::before` 上并加 `filter: url(#ink-rough)`，文字本身不要套滤镜，保持清晰。
- 颜色只用 `global.css` 里的变量（`--paper`、`--chalk`、`--narration`、`--quote`、`--blood` 等），两套主题会自动适配。
- 新增角色头像请沿用 100×100 视图框、`#16120f` 墨线和 `ink-sticker` 滤镜。

The UI uses a hand-drawn noir picture-book style. Its SVG filters and character portraits live in `frontend/src/components/ink.tsx`. Draw wobbly outlines on a `::before` layer with `filter: url(#ink-rough)` so text stays crisp, and use only the colour variables from `global.css` so both themes keep working.

## 内置题库 · Built-in puzzles

编辑 `backend/scripts/gen_seed.py` 后运行 `python backend/scripts/gen_seed.py`。请只提交原创或公有领域的题目。
Edit `backend/scripts/gen_seed.py` and run it. Only contribute original or public-domain puzzles.

## 许可 · License

提交贡献即表示你同意以 [MIT](LICENSE) 许可发布你的代码。
By contributing you agree that your contributions are licensed under [MIT](LICENSE).
